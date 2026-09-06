# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause

# ruff: noqa: D100, D101, D102, D103

"""Tests run against the LOCAL (no-Redis) fallback.

REDIS_URL is unset in this suite, so session_bus.client.is_enabled() is
False and every state.py call takes the in-memory branch. The Redis-specific
behavior (owner-token lock via Lua CAS, TTL-backed expiry) is exercised
against a real Redis by tests/session_capture/test_cross_pod.sh, since it
needs an actual multi-pod setup to mean anything -- these unit tests cover
the LOGIC once, on whichever backend is available in CI.
"""

import time
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

from session_capture import state


def _sid(name: str) -> str:
    # Unique-enough hex id per test so module-global local state never
    # collides between tests running in the same process.
    return "".join(f"{ord(c):02x}" for c in name)[:32]


def test_mark_and_is_ready() -> None:
    sid = _sid("ready")
    state.clear_state(sid)
    assert not state.is_ready(state.get(sid))
    state.mark_pipeline_done(sid)
    assert not state.is_ready(state.get(sid))
    state.mark_consent(sid, consent=True, has_transcript=False)
    assert state.is_ready(state.get(sid))
    state.clear_state(sid)


def test_mark_consent_records_fields() -> None:
    sid = _sid("consentfields")
    state.clear_state(sid)
    state.mark_consent(sid, consent=True, has_transcript=True)
    st = state.get(sid)
    assert st["consent"] == "true"
    assert st["consent_done"] == "1"
    assert st["has_transcript"] == "1"
    state.clear_state(sid)


def test_exactly_once_second_acquire_fails_while_first_holds() -> None:
    # B3 regression: the lock must genuinely exclude a second caller while
    # the first still holds it.
    sid = _sid("lockexcl")
    state.clear_state(sid)
    token_a = state.try_acquire_lock(sid)
    assert token_a is not None
    token_b = state.try_acquire_lock(sid)
    assert token_b is None
    state.release_lock(sid, token_a)
    state.clear_state(sid)


def test_bogus_release_does_not_free_someone_elses_lock() -> None:
    # B3 regression: the earlier boolean-flag lock let ANY caller release ANY
    # other caller's lock via a plain DEL. The owner-token + compare-and-swap
    # release must refuse to release a lock it doesn't hold the token for.
    sid = _sid("lockcas")
    state.clear_state(sid)
    token_a = state.try_acquire_lock(sid)
    assert token_a is not None
    state.release_lock(sid, "not-the-real-token")
    # The real lock must still be held.
    assert state.try_acquire_lock(sid) is None
    state.release_lock(sid, token_a)
    assert state.try_acquire_lock(sid) is not None


def test_release_then_reacquire_succeeds() -> None:
    sid = _sid("lockcycle")
    state.clear_state(sid)
    token_a = state.try_acquire_lock(sid)
    state.release_lock(sid, token_a)
    token_b = state.try_acquire_lock(sid)
    assert token_b is not None
    state.release_lock(sid, token_b)


def test_exactly_one_winner_under_real_thread_contention() -> None:
    """Exercise simultaneous callers instead of a sequential lock interleave."""
    sid = _sid("threadrace")
    state.clear_state(sid)
    contenders = 32
    barrier = Barrier(contenders)

    def compete() -> str | None:
        barrier.wait(timeout=5)
        return state.try_acquire_lock(sid)

    with ThreadPoolExecutor(max_workers=contenders) as pool:
        tokens = list(pool.map(lambda _index: compete(), range(contenders)))

    winners = [token for token in tokens if token is not None]
    assert len(winners) == 1
    assert state.try_acquire_lock(sid) is None
    state.release_lock(sid, winners[0])
    state.clear_state(sid)


def test_clear_state_does_not_touch_the_lock() -> None:
    # Split responsibility (see state.clear_state's docstring): clearing the
    # coordination hash must never release a lock a caller still holds --
    # otherwise a slow finalizer's lock could be stolen mid-finalize by
    # clear_state() called from an unrelated path.
    sid = _sid("clearvslock")
    state.clear_state(sid)
    token = state.try_acquire_lock(sid)
    state.mark_pipeline_done(sid)
    state.clear_state(sid)
    assert state.get(sid) == {}
    assert state.try_acquire_lock(sid) is None  # still held by `token`
    state.release_lock(sid, token)


def test_mark_attempt_increments() -> None:
    sid = _sid("attempts")
    state.clear_state(sid)
    assert state.mark_attempt(sid) == 1
    assert state.mark_attempt(sid) == 2
    assert state.get(sid)["attempts"] == "2"
    state.clear_state(sid)


def test_set_last_error() -> None:
    sid = _sid("lasterror")
    state.clear_state(sid)
    state.set_last_error(sid, "timeout")
    assert state.get(sid)["last_error"] == "timeout"
    state.clear_state(sid)


def test_seconds_since_update_is_none_before_any_update() -> None:
    sid = _sid("neverupdated")
    state.clear_state(sid)
    assert state.seconds_since_update(sid) is None


def test_seconds_since_update_grows_and_resets_on_new_update() -> None:
    sid = _sid("agegrows")
    state.clear_state(sid)
    state.mark_pipeline_done(sid)
    age0 = state.seconds_since_update(sid)
    assert age0 is not None
    time.sleep(0.05)
    age1 = state.seconds_since_update(sid)
    assert age1 > age0
    state.mark_consent(sid, consent=True, has_transcript=False)  # resets updated_at
    age2 = state.seconds_since_update(sid)
    assert age2 < age1
    state.clear_state(sid)


def test_all_pending_sids_reflects_local_state() -> None:
    sid = _sid("pendinglist")
    state.clear_state(sid)
    assert sid not in state.all_pending_sids()
    state.mark_pipeline_done(sid)
    assert sid in state.all_pending_sids()
    state.clear_state(sid)
    assert sid not in state.all_pending_sids()


def test_local_state_expires_like_redis_ttl(monkeypatch) -> None:
    # D12 regression: without Redis, _local_state previously had NO bound at
    # all. This mirrors Redis's own TTL expiry (a session's coordination
    # entry disappears after CAP_STATE_TTL of inactivity) so a long-lived pod
    # in local mode can't accumulate stuck partial-state entries forever.
    monkeypatch.setattr(state.settings, "CAP_STATE_TTL", 0.05)
    sid = _sid("localexpire")
    state.clear_state(sid)
    state.mark_pipeline_done(sid)
    assert sid in state.all_pending_sids()
    time.sleep(0.08)
    assert sid not in state.all_pending_sids()
