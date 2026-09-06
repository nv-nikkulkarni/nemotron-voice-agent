# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause

"""Backend selection for session-capture artifact storage.

Unlike the Redis session bus (which can be legitimately absent — "disabled"
means "fall back to in-memory, single pod"), session capture always needs
somewhere to put files once it's enabled at all, so this module always ends
up with a usable backend: SESSION_STORE_BACKEND=s3 tries S3Backend and falls
back to LocalBackend on any connection failure (same never-crash-the-app
philosophy as session_bus.client); the default ("local") skips S3 entirely.
"""

from __future__ import annotations

import os
import time

from loguru import logger

from .backends import LocalBackend, ObjectBackend

BACKEND_KIND = os.environ.get("SESSION_STORE_BACKEND", "local").strip().lower()
# Bounded retry for the common cold-start race: docker-compose/k8s start the app
# and the object-store container at roughly the same time, so the store may not
# be accepting connections yet on the app's first attempt. Without a retry,
# that single unlucky attempt permanently pins the process to LocalBackend for
# its entire lifetime (init_from_env only ever runs once, at startup) -- a
# silent, hard-to-diagnose fallback into per-pod storage.
#
# A wall-clock DEADLINE, not a fixed attempt count: boto3/botocore applies its
# own internal connection-level retry+backoff underneath each S3Backend.from_env()
# call (Config(retries={"max_attempts": 3}) in backends.py), so individual
# attempts here can themselves take anywhere from under a second to 10+
# seconds depending on WHY the connection is failing (refused vs. timeout) --
# an attempt count has no fixed relationship to elapsed time. 30s comfortably
# covers SeaweedFS's own cold start (measured ~15-20s from container start to
# accepting connections, container-to-container) with margin; not an
# ongoing-outage retry loop (an outage after successful startup is a separate,
# already-handled failure mode -- see backend()'s own warning path and every
# call site's exception handling).
_INIT_RETRY_TIMEOUT_SECS = float(os.environ.get("SESSION_STORE_INIT_RETRY_TIMEOUT_SECS", "30"))
_INIT_RETRY_DELAY_SECS = float(os.environ.get("SESSION_STORE_INIT_RETRY_DELAY_SECS", "1"))

_backend: ObjectBackend | None = None
_is_s3 = False


def backend() -> ObjectBackend:
    """Return the active backend. Always non-None once init_from_env() has run."""
    if _backend is None:
        if BACKEND_KIND == "s3":
            # SESSION_STORE_BACKEND=s3 is set, but init_from_env() never ran --
            # e.g. server.py's lifespan hasn't started yet, or a caller imported
            # this module directly (a unit test, a script). Writing to Local here
            # would silently and permanently mislabel this process as "local"
            # (nothing later re-checks BACKEND_KIND), breaking cross-pod capture
            # with no visible symptom other than files ending up on the wrong pod.
            logger.warning(
                "session_store: SESSION_STORE_BACKEND=s3 but init_from_env() has not run yet; "
                "falling back to a local backend for this call. If this repeats, session_store."
                "init_from_env() is not being called from app startup."
            )
        return LocalBackend.from_env()
    return _backend


def is_s3() -> bool:
    """Return whether the S3 backend is actually active (vs the local fallback)."""
    return _is_s3


def init_from_env() -> None:
    """Select and connect the backend. Called once from app startup."""
    global _backend, _is_s3
    if BACKEND_KIND == "s3":
        from .backends import S3Backend

        deadline = time.monotonic() + _INIT_RETRY_TIMEOUT_SECS
        attempt = 0
        last_exc: Exception | None = None
        while True:
            attempt += 1
            try:
                _backend = S3Backend.from_env()
                _is_s3 = True
                logger.info(f"session_store: connected to S3 backend (attempt {attempt})")
                return
            except Exception as exc:  # noqa: BLE001 - never let a store outage crash the app
                last_exc = exc
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                logger.warning(
                    f"session_store: S3 init attempt {attempt} failed ({exc}); "
                    f"retrying in {_INIT_RETRY_DELAY_SECS}s ({remaining:.0f}s left in retry window)"
                )
                time.sleep(min(_INIT_RETRY_DELAY_SECS, remaining))
        logger.error(
            f"session_store: S3 init failed after {attempt} attempts over "
            f"{_INIT_RETRY_TIMEOUT_SECS}s ({last_exc}); falling back to local backend"
        )
    _backend = LocalBackend.from_env()
    _is_s3 = False
    logger.info(f"session_store: using local backend (root={_backend.root})")
