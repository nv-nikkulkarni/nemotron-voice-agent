# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause

"""Cross-pod coordination for session-capture finalization.

Two independent events must both happen before a session can be finalized —
the pipeline finishing (log + audio written) and the browser's consent POST —
and either can arrive first, on any pod. This module tracks that with a tiny
Redis hash (reuses the session_bus connection; no new Redis client) plus an
owner-token lock so exactly one pod finalizes a given session, and a caller
that dies mid-finalize can never accidentally release a DIFFERENT caller's
lock (the earlier boolean-flag lock had exactly that bug: any caller could
delete any other caller's lock via a plain ``DEL``, breaking exactly-once).

Without Redis (session_bus.client.is_enabled() False — single pod, no
REDIS_URL) this falls back to an in-memory dict, same "no Redis -> in-memory,
single-process" contract as session_bus's own stores. At replicas=1 both
events always arrive in the same process anyway, so this fallback reproduces
exactly the calling pattern the code had before this module existed.
"""

from __future__ import annotations

import threading
import time
import uuid

from session_bus import client as _bus

from . import settings

# Released via a Lua compare-and-delete so a caller can only release the lock it
# actually holds -- never a different caller's lock acquired after this one's
# token expired or was otherwise superseded.
_RELEASE_LOCK_SCRIPT = """
if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
else
    return 0
end
"""

_lock = threading.Lock()
_local_state: dict[str, dict[str, str]] = {}
_local_state_updated_at: dict[str, float] = {}
_local_locks: dict[str, str] = {}  # sid -> owner token


def _key(sid: str) -> str:
    return f"cap:{sid}"


def _lock_key(sid: str) -> str:
    return f"cap:lock:{sid}"


def mark_pipeline_done(sid: str) -> None:
    """Record that the pipeline has finished writing this session's log + audio."""
    _set(sid, pipeline_done="1")


def mark_consent(sid: str, *, consent: bool, has_transcript: bool) -> None:
    """Record the browser's consent decision (and whether a transcript arrived)."""
    _set(sid, consent="true" if consent else "false", consent_done="1", has_transcript="1" if has_transcript else "0")


def set_last_error(sid: str, reason: str) -> None:
    """Record why the most recent finalize attempt failed (e.g. ``"timeout"``).

    Read by ``maybe_finalize``'s give-up path to decide whether it's safe to
    delete a session's source objects: NOT safe after an upload timeout, since
    NGC may already have received the version (a slow ``ngc`` process finishing
    server-side after our client gave up) -- deleting the sources in that case
    destroys a session that IS archived, and a retry would just fail again on
    "version already exists".
    """
    _set(sid, last_error=reason)


def mark_attempt(sid: str) -> int:
    """Increment and return this session's finalize-attempt counter (for retry limits)."""
    if _bus.is_enabled():
        c = _bus.sync_client()
        n = c.hincrby(_key(sid), "attempts", 1)
        c.hset(_key(sid), "updated_at", str(time.time()))
        c.expire(_key(sid), settings.CAP_STATE_TTL)
        return int(n)
    with _lock:
        entry = _local_state.setdefault(sid, {})
        n = int(entry.get("attempts", "0")) + 1
        entry["attempts"] = str(n)
        _local_state_updated_at[sid] = time.time()
        return n


def _set(sid: str, **fields: str) -> None:
    if _bus.is_enabled():
        c = _bus.sync_client()
        c.hset(_key(sid), mapping={**fields, "updated_at": str(time.time())})
        c.expire(_key(sid), settings.CAP_STATE_TTL)
        return
    with _lock:
        _local_state.setdefault(sid, {}).update(fields)
        _local_state_updated_at[sid] = time.time()


def get(sid: str) -> dict[str, str]:
    """Return the session's coordination state (decoded str->str), or {} if none yet."""
    if _bus.is_enabled():
        raw = _bus.sync_client().hgetall(_key(sid))
        return {k.decode(): v.decode() for k, v in raw.items()}
    with _lock:
        return dict(_local_state.get(sid, {}))


def is_ready(state: dict[str, str]) -> bool:
    """Both required signals have arrived — the session can be finalized."""
    return state.get("pipeline_done") == "1" and state.get("consent_done") == "1"


def seconds_since_update(sid: str) -> float | None:
    """Seconds since this session's coordination state last changed, or ``None`` if unknown.

    Used by the reaper to find sessions stuck with only one signal (the other
    will never arrive — a crashed pod, a browser that never POSTs).

    Reads an explicit ``updated_at`` field written by every ``_set``/
    ``mark_attempt`` call, rather than deriving age from the Redis key's TTL
    (``CAP_STATE_TTL - ttl_remaining``). That derivation is a trap: every
    update also RESETS the TTL, so age can never exceed ``CAP_STATE_TTL`` by
    construction -- if ``REAPER_ORPHAN_SECS`` is set to (or above)
    ``CAP_STATE_TTL``, "age >= threshold" becomes true only in the ~0.5s
    window before the key expires and vanishes from SCAN entirely, i.e.
    effectively never. An explicit timestamp has no such coupling.
    """
    if _bus.is_enabled():
        raw = _bus.sync_client().hget(_key(sid), "updated_at")
        if raw is None:
            return None
        return max(0.0, time.time() - float(raw))
    with _lock:
        updated_at = _local_state_updated_at.get(sid)
        return None if updated_at is None else max(0.0, time.time() - updated_at)


def try_acquire_lock(sid: str) -> str | None:
    """Exactly-once finalization lock; returns an owner token, or ``None`` if held.

    The token MUST be passed back to ``release_lock`` — releasing by sid alone
    (as the earlier version of this module did) lets a caller release a lock it
    doesn't own, letting a second caller finalize the same session.
    """
    token = uuid.uuid4().hex
    if _bus.is_enabled():
        ok = _bus.sync_client().set(_lock_key(sid), token, nx=True, ex=settings.CAP_LOCK_TTL)
        return token if ok else None
    with _lock:
        if sid in _local_locks:
            return None
        _local_locks[sid] = token
        return token


def release_lock(sid: str, token: str) -> None:
    """Release the lock for ``sid``, but only if ``token`` is still the current owner.

    A no-op if the lock was already released, already expired, or (should never
    happen, but this is the safety the compare-and-delete buys) is now held by a
    different caller — releasing blind would delete THEIR lock, not ours.
    """
    if _bus.is_enabled():
        _bus.sync_client().eval(_RELEASE_LOCK_SCRIPT, 1, _lock_key(sid), token)
        return
    with _lock:
        if _local_locks.get(sid) == token:
            del _local_locks[sid]


def clear_state(sid: str) -> None:
    """Drop a session's coordination hash. Never touches the lock (see release_lock).

    Call only once a session is fully handled: finalized successfully, denied
    and discarded, or abandoned after exceeding the retry limit. Deliberately
    separate from lock release so a failed finalize can keep its flags (for the
    next retry) while still releasing the lock for other callers to try.
    """
    if _bus.is_enabled():
        _bus.sync_client().delete(_key(sid))
        return
    with _lock:
        _local_state.pop(sid, None)
        _local_state_updated_at.pop(sid, None)


def _evict_expired_local_state() -> None:
    """Mirror Redis's own TTL expiry for the local (no-Redis) fallback.

    On Redis, ``cap:<sid>`` keys expire after ``CAP_STATE_TTL`` regardless of
    whether the reaper got to them first -- that's a known, accepted
    limitation (the reaper's docstring calls out exactly this race). Without
    Redis, ``_local_state`` had no equivalent bound at all, so a deployment
    running in local mode with the reaper disabled (``REAPER_INTERVAL_SECS=0``,
    a documented opt-out) would grow it forever. This applies the SAME bound
    Redis already has -- no more, no less: like Redis's TTL, it does NOT clean
    up store objects itself (that's the reaper's job when it runs in time);
    it only prevents unbounded growth of the coordination dict.

    Caller must hold ``_lock``.
    """
    cutoff = time.time() - settings.CAP_STATE_TTL
    expired = [sid for sid, ts in _local_state_updated_at.items() if ts < cutoff]
    for sid in expired:
        _local_state.pop(sid, None)
        _local_state_updated_at.pop(sid, None)


def all_pending_sids() -> list[str]:
    """List sessions with in-flight coordination state (for the reaper sweep).

    Uses SCAN (not KEYS) to avoid blocking Redis; acceptable at this scale
    since the "cap:*" keyspace is bounded by concurrent in-flight sessions,
    not by overall Redis size.
    """
    if _bus.is_enabled():
        c = _bus.sync_client()
        prefix = _key("")  # "cap:"
        sids: list[str] = []
        for raw_key in c.scan_iter(match=f"{prefix}*"):
            key = raw_key.decode()
            rest = key[len(prefix) :]
            if rest.startswith("lock:"):  # skip "cap:lock:<sid>" entries
                continue
            sids.append(rest)
        return sids
    with _lock:
        _evict_expired_local_state()
        return list(_local_state.keys())
