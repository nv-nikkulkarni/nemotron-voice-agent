# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause

"""Redis-backed webcam + attachment ops, and the cross-pod notify loop.

These are plain functions called by the store shims (``attachment_store.py`` /
``webcam_frame_store.py``) only when ``session_bus.client.is_enabled()`` is
True. Each session's data lives in a Redis Stream keyed by session_id, so
``XADD`` from any pod is visible to ``XRANGE``/``XREVRANGE``/``XREAD`` on any
other pod — that visibility *is* the "any replica can serve any session"
guarantee this module exists for.

The listener mechanism doubles as the cross-pod notification: a per-session
``XREAD BLOCK`` task wakes on the next ``XADD`` from any pod and invokes the
same payload-free callback the in-memory store already used, so callers don't
need a new registration API.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from collections.abc import Callable
from datetime import UTC, datetime

from loguru import logger

try:
    from redis.exceptions import RedisError
    from redis.exceptions import TimeoutError as RedisTimeoutError
except ImportError:  # Redis remains optional when REDIS_URL is unset.

    class RedisError(Exception):
        """Fallback base when the optional redis package is unavailable."""

    class RedisTimeoutError(RedisError):
        """Fallback timeout when the optional redis package is unavailable."""


from attachment_store import Attachment
from webcam_frame_store import WebcamFrame

from . import client, codec

RING = int(os.environ.get("SESSION_BUS_WEBCAM_RING", "64"))
BLOCK_MS = int(os.environ.get("SESSION_BUS_BLOCK_MS", "5000"))
LISTENER_RETRY_DELAY_SECS = float(os.environ.get("SESSION_BUS_LISTENER_RETRY_DELAY_SECS", "0.25"))
LISTENER_RETRY_MAX_SECS = float(os.environ.get("SESSION_BUS_LISTENER_RETRY_MAX_SECS", "5"))

if client.SOCKET_TIMEOUT_SECS <= BLOCK_MS / 1000:
    logger.warning("session_bus: socket timeout should exceed XREAD block interval; listener retries will compensate")


# Atomic "delete only if the value still matches" — used so consume_capture_request
# can't race a concurrent caller into consuming a request that was already replaced.
_CONSUME_LUA = "if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('DEL', KEYS[1]); return 1 else return 0 end"


def _wc(session_id: str) -> str:
    return f"sb:wc:{session_id}"


def _att(session_id: str) -> str:
    return f"sb:att:{session_id}"


def _seq(kind: str, session_id: str) -> str:
    return f"sb:seq:{kind}:{session_id}"


def _capreq(session_id: str) -> str:
    return f"sb:capreq:{session_id}"


# ---------------------------------------------------------------------------
# Webcam frames
# ---------------------------------------------------------------------------


def store_webcam_frame(*, session_id: str, name: str, content_type: str, data: bytes) -> WebcamFrame:
    """Append one webcam frame to the session's Redis stream (ring-limited)."""
    c = client.sync_client()
    seq = c.incr(_seq("wc", session_id))
    frame = WebcamFrame(
        id=uuid.uuid4().hex,
        session_id=session_id,
        sequence=seq,
        name=name or "webcam-frame.jpg",
        content_type=content_type or "image/jpeg",
        data=data,
        created_at=datetime.now(UTC).isoformat(),
    )
    c.xadd(_wc(session_id), codec.frame_to_fields(frame), maxlen=RING, approximate=True)
    c.expire(_wc(session_id), client.TTL)
    c.expire(_seq("wc", session_id), client.TTL)
    return frame


def latest_webcam_frame(session_id: str) -> WebcamFrame | None:
    """Return the most recent webcam frame for a session, or None."""
    entries = client.sync_client().xrevrange(_wc(session_id), count=1)
    return codec.fields_to_frame(entries[0][1]) if entries else None


def recent_webcam_frames(session_id: str) -> list[WebcamFrame]:
    """Return all ring-buffered webcam frames for a session, oldest to newest.

    Callers apply their own ``max_seconds``/``max_count`` windowing on top of
    this (see the store shim), matching the in-memory implementation's split
    of responsibilities.
    """
    return [codec.fields_to_frame(fields) for _entry_id, fields in client.sync_client().xrange(_wc(session_id))]


def clear_webcam(session_id: str, *, keep_seq: bool = False) -> None:
    """Drop a session's webcam stream. ``keep_seq`` preserves the sequence counter."""
    keys = [_wc(session_id)]
    if not keep_seq:
        keys.append(_seq("wc", session_id))
    client.sync_client().delete(*keys)


# ---------------------------------------------------------------------------
# Attachments
# ---------------------------------------------------------------------------


def store_attachment(
    *,
    session_id: str,
    kind: str,
    name: str,
    content_type: str,
    data: bytes,
    source: str,
) -> Attachment:
    """Build and append one attachment to the session's Redis stream.

    Mirrors ``store_webcam_frame``: builds the dataclass (incl. sequence)
    internally so the store shim only needs already-validated fields.
    """
    c = client.sync_client()
    seq = c.incr(_seq("att", session_id))
    attachment = Attachment(
        id=uuid.uuid4().hex,
        session_id=session_id,
        sequence=seq,
        kind=kind,
        name=name or "attachment",
        content_type=content_type or f"{kind}/*",
        data=data,
        created_at=datetime.now(UTC).isoformat(),
        source=source or "upload",
    )
    c.xadd(_att(session_id), codec.att_to_fields(attachment), maxlen=64, approximate=True)
    c.expire(_att(session_id), client.TTL)
    c.expire(_seq("att", session_id), client.TTL)
    return attachment


def all_attachments(session_id: str) -> list[Attachment]:
    """Return every attachment for a session, oldest to newest."""
    return [codec.fields_to_att(fields) for _entry_id, fields in client.sync_client().xrange(_att(session_id))]


def remove_attachment(session_id: str, attachment_id: str) -> None:
    """Remove one attachment by id from the session's stream."""
    c = client.sync_client()
    for entry_id, fields in c.xrange(_att(session_id)):
        if fields.get(b"id", b"").decode() == attachment_id:
            c.xdel(_att(session_id), entry_id)
            return


def clear_attachments(session_id: str) -> None:
    """Drop a session's attachments and any outstanding capture request."""
    client.sync_client().delete(_att(session_id), _seq("att", session_id), _capreq(session_id))


def create_capture_request(session_id: str) -> str:
    """Create and register the only valid webcam capture request for a session."""
    request_id = uuid.uuid4().hex
    client.sync_client().set(_capreq(session_id), request_id, ex=client.TTL)
    return request_id


def consume_capture_request(session_id: str, request_id: str) -> bool:
    """Atomically consume a matching outstanding capture request."""
    return bool(client.sync_client().eval(_CONSUME_LUA, 1, _capreq(session_id), request_id))


# ---------------------------------------------------------------------------
# Cross-pod listener (== the notification mechanism)
# ---------------------------------------------------------------------------


def start_listener(stream_key: str, cb: Callable[[], None]) -> Callable[[], None]:
    """Start a background task that calls ``cb()`` on every new stream entry.

    Must be called from a running asyncio event loop (pipeline setup context).
    Returns an ``unregister`` callable that cancels the task, matching the
    in-memory store's ``register_*_listener`` return contract.
    """
    loop = asyncio.get_running_loop()
    task = loop.create_task(_listen(stream_key, cb))

    def unregister() -> None:
        task.cancel()

    return unregister


async def _listen(stream_key: str, cb: Callable[[], None]) -> None:
    """Notify for new entries and survive idle timeouts or transient Redis failures."""
    a = client.async_client()
    # Start at "0" (not "$"): the first XREAD returns every existing entry, so a
    # frame/attachment stored before this loop started blocking is never missed.
    # We then advance `last` past what we've seen and block for new arrivals.
    last = "0"
    retry_delay = max(0.0, LISTENER_RETRY_DELAY_SECS)
    while True:
        try:
            resp = await a.xread({stream_key: last}, block=BLOCK_MS)
        except asyncio.CancelledError:
            return
        except RedisTimeoutError:
            # A socket timeout is equivalent to an empty blocking read here. It
            # must never permanently disable cross-pod notifications.
            logger.debug(f"session_bus: listener {stream_key} idle socket timeout; continuing")
            continue
        except (RedisError, OSError) as exc:
            logger.warning(f"session_bus: listener {stream_key} transient error {exc}; retrying")
            try:
                await asyncio.sleep(retry_delay)
            except asyncio.CancelledError:
                return
            retry_delay = min(max(retry_delay * 2, 0.01), LISTENER_RETRY_MAX_SECS)
            continue
        except Exception as exc:  # noqa: BLE001 - a listener failure must not crash the pipeline
            logger.warning(f"session_bus: listener {stream_key} unexpected error {exc}; retrying")
            try:
                await asyncio.sleep(retry_delay)
            except asyncio.CancelledError:
                return
            retry_delay = min(max(retry_delay * 2, 0.01), LISTENER_RETRY_MAX_SECS)
            continue
        retry_delay = max(0.0, LISTENER_RETRY_DELAY_SECS)
        if not resp:
            continue
        for _key, entries in resp:
            last = entries[-1][0]
        try:
            cb()
        except Exception as exc:  # noqa: BLE001 - one callback must not kill the listener
            logger.warning(f"session_bus: listener {stream_key} callback error {exc}; continuing")
