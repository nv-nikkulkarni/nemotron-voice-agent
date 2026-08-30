# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause

"""Redis connection management for the session bus.

Only this module (and its siblings in ``session_bus``) import ``redis``. When
``REDIS_URL`` is unset, or the ``redis`` package is unavailable, the bus stays
disabled and every caller falls back to the pre-existing in-memory behavior —
this module never raises on missing configuration.
"""

from __future__ import annotations

import os
import time

from loguru import logger

try:
    import redis
    import redis.asyncio as aredis
except ImportError:  # redis is an optional dependency; unused when REDIS_URL is unset
    redis = None
    aredis = None

REDIS_URL = os.environ.get("REDIS_URL", "").strip()
TTL = int(os.environ.get("SESSION_BUS_TTL", "3600"))
# Without a socket timeout, a blackholed/unreachable Redis blocks a blocking
# call (e.g. session_capture.state's hset/hget/scan on a to_thread worker, or
# any accidental direct call from the event loop) until the OS-level TCP
# timeout -- minutes, not seconds. This bounds every call so a Redis outage
# fails fast and visibly instead of silently stalling capture indefinitely.
# Keep this comfortably above media.py's 5s XREAD BLOCK interval. Equal values
# race at the socket boundary and turn normal listener idleness into a timeout.
SOCKET_TIMEOUT_SECS = float(os.environ.get("SESSION_BUS_SOCKET_TIMEOUT_SECS", "15"))
# Bounded retry for the cold-start race: k8s/compose start the app and the Redis
# container at roughly the same time, so a single unlucky first attempt (Redis
# not accepting connections yet) previously pinned the process to in-memory
# mode for its ENTIRE lifetime (init_from_env only ever runs once, at startup).
# Deadline-based, not attempt-count-based -- see session_store.client's own
# copy of this pattern for why (network errors don't take a fixed time).
BUS_INIT_RETRY_TIMEOUT_SECS = float(os.environ.get("SESSION_BUS_INIT_RETRY_TIMEOUT_SECS", "30"))
BUS_INIT_RETRY_DELAY_SECS = float(os.environ.get("SESSION_BUS_INIT_RETRY_DELAY_SECS", "1"))

_sync = None  # redis.Redis | None
_async = None  # redis.asyncio.Redis | None


def is_enabled() -> bool:
    """Return whether the Redis session bus is connected and usable."""
    return _sync is not None


def sync_client():
    """Return the sync Redis client. Only valid when ``is_enabled()``."""
    return _sync


def async_client():
    """Return the async Redis client. Only valid when ``is_enabled()``."""
    return _async


def init_from_env() -> None:
    """Connect to Redis if ``REDIS_URL`` is set. Called once from app startup.

    Safe no-op when ``REDIS_URL`` is unset or the ``redis`` package is missing.
    Never raises: a connection failure logs and leaves the bus disabled so the
    app degrades to in-memory, single-pod behavior instead of crashing. Retries
    for up to ``BUS_INIT_RETRY_TIMEOUT_SECS`` before giving up, so losing the
    cold-start race against the Redis container doesn't disable the bus for
    the app's entire lifetime.
    """
    global _sync, _async
    if not REDIS_URL or redis is None:
        logger.info("session_bus: disabled (REDIS_URL unset) -> in-memory single-pod mode")
        return
    deadline = time.monotonic() + BUS_INIT_RETRY_TIMEOUT_SECS
    attempt = 0
    last_exc: Exception | None = None
    while True:
        attempt += 1
        try:
            _sync = redis.Redis.from_url(
                REDIS_URL, socket_timeout=SOCKET_TIMEOUT_SECS, socket_connect_timeout=SOCKET_TIMEOUT_SECS
            )
            _async = aredis.Redis.from_url(
                REDIS_URL, socket_timeout=SOCKET_TIMEOUT_SECS, socket_connect_timeout=SOCKET_TIMEOUT_SECS
            )
            _sync.ping()
            logger.info(f"session_bus: connected to Redis (ttl={TTL}s, attempt {attempt})")
            return
        except Exception as exc:  # noqa: BLE001 - never let a Redis outage crash the app
            last_exc = exc
            _sync = None
            _async = None
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            logger.warning(
                f"session_bus: init attempt {attempt} failed ({exc}); "
                f"retrying in {BUS_INIT_RETRY_DELAY_SECS}s ({remaining:.0f}s left in retry window)"
            )
            time.sleep(min(BUS_INIT_RETRY_DELAY_SECS, remaining))
    logger.error(
        f"session_bus: init failed after {attempt} attempts over "
        f"{BUS_INIT_RETRY_TIMEOUT_SECS}s ({last_exc}); falling back to in-memory"
    )


async def aclose() -> None:
    """Close the async client on app shutdown. Safe no-op when disabled."""
    if _async is not None:
        await _async.aclose()
