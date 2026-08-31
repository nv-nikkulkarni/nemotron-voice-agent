# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause

"""Session-capture configuration, entirely from environment variables.

No NGC org, resource name, or filesystem path is hardcoded anywhere in this
package — every value here is read from the environment (in turn set by Helm
values / docker-compose / .env). ``ENABLED`` is the top-level kill switch: when
false, ``session_capture.register_routes`` is a no-op and the capture HTTP
routes never exist (404, not "disabled" 200s).
"""

from __future__ import annotations

import os

from loguru import logger


def _bool(name: str, default: str) -> bool:
    return os.getenv(name, default).strip().lower() == "true"


ENABLED = _bool("SESSION_CAPTURE_ENABLED", "false")
# Release deployments can require successful NGC publication instead of
# accepting the development-only local archive mode.  This is deliberately a
# separate switch from ENABLED so local contributors can still exercise capture
# without an NGC destination, while Helm-qualified environments fail closed.
UPLOAD_REQUIRED = _bool("SESSION_CAPTURE_UPLOAD_REQUIRED", "false")

# "<org>/<resource>", e.g. "example-org/session-captures". Empty is allowed only
# in development local-archive mode; UPLOAD_REQUIRED makes it a startup error.
NGC_RESOURCE = os.environ.get("SESSION_CAPTURE_NGC", "").strip()
NGC_CLI_BIN = os.environ.get("NGC_CLI_BIN", "/app/ngc-cli/ngc")
REQUIRE_CONSENT = _bool("SESSION_CAPTURE_REQUIRE_CONSENT", "true")

CAPTURE_PATH = os.environ.get("SESSION_CAPTURE_PATH", "").strip()
# LOG_PATH is a LOCAL scratch directory for the per-session log's hot append path
# (one line per log call — never worth a network write). The finished file is
# uploaded to session_store exactly once, at session teardown; see capture.py.
LOG_PATH = os.environ.get("SESSION_LOG_PATH", "").strip()

# --- Replica-safe finalization (Redis-coordinated; see state.py) ---
# How long the small per-session coordination hash (consent/pipeline-done flags)
# lives in Redis before it's considered abandoned. Independent of session_bus.TTL.
CAP_STATE_TTL = int(os.environ.get("SESSION_CAPTURE_STATE_TTL", "3600"))
# The finalize lock's hold time. Must exceed the worst-case finalize duration
# (tar assembly + object reads + the upload subprocess's own 300s timeout,
# capture.py's _upload) -- a lock that expires mid-finalize lets a second
# caller (another pod, or the reaper) start a concurrent finalize on the same
# session. 900s = the 300s upload timeout plus headroom for tar/read time.
CAP_LOCK_TTL = int(os.environ.get("SESSION_CAPTURE_LOCK_TTL", "900"))
# Reaper: sweep for sessions whose state is old enough to be abandoned (pod died,
# consent never arrived, etc.) and finalize/GC them. 0 disables the reaper.
REAPER_INTERVAL_SECS = int(os.environ.get("SESSION_CAPTURE_REAPER_INTERVAL_SECS", "300"))
REAPER_ORPHAN_SECS = int(os.environ.get("SESSION_CAPTURE_ORPHAN_TTL_SECS", "900"))

if REAPER_ORPHAN_SECS >= CAP_STATE_TTL:
    # The coordination hash TTLs out (and disappears from the reaper's SCAN) at
    # CAP_STATE_TTL. A session can only be swept as "stale" while its state
    # still exists, so ORPHAN_SECS >= CAP_STATE_TTL means the sweep condition
    # can never be satisfied while the session is still visible -- the reaper's
    # stale-abandon path becomes silently unreachable. Clamp rather than merely
    # warn: a misconfigured deployment should not quietly lose GC coverage.
    _clamped = max(1, CAP_STATE_TTL // 2)
    logger.error(
        f"session-capture: SESSION_CAPTURE_ORPHAN_TTL_SECS ({REAPER_ORPHAN_SECS}) must be < "
        f"SESSION_CAPTURE_STATE_TTL ({CAP_STATE_TTL}) or the reaper's stale-session sweep can "
        f"never fire; clamping to {_clamped}s"
    )
    REAPER_ORPHAN_SECS = _clamped
# Give up retrying a session's finalize after this many failed attempts (real I/O
# errors or a failed upload -- NOT a locally-retained "NGC not configured"
# session, which succeeds on its first attempt and isn't retried at all). After
# the limit, capture.maybe_finalize discards the session's artifacts rather than
# retrying forever.
MAX_FINALIZE_ATTEMPTS = int(os.environ.get("SESSION_CAPTURE_MAX_FINALIZE_ATTEMPTS", "5"))


def ngc_org() -> str:
    """Return the NGC org portion of NGC_RESOURCE, or "" if unset."""
    return NGC_RESOURCE.split("/")[0] if NGC_RESOURCE else ""


def enabled() -> bool:
    """Return whether the session-capture feature is enabled at all."""
    return ENABLED


def upload_required() -> bool:
    """Return whether capture must be publishable to NGC at runtime."""
    return ENABLED and UPLOAD_REQUIRED
