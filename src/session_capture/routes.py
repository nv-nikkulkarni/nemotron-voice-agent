# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause

"""Session-capture HTTP routes. Registered on the FastAPI app only when enabled.

Moved verbatim (behavior-preserving) from ``server.py``'s inline
``/api/session-capture`` and ``/api/session-capture/status`` routes.
"""

from __future__ import annotations

import asyncio
import json

from fastapi import BackgroundTasks, FastAPI, Request
from fastapi.responses import JSONResponse
from loguru import logger

import session_store
from session_store import keys as store_keys

from . import settings, state
from .capture import maybe_finalize, status


def _eager_discard(sid: str) -> None:
    """Delete a declined session's artifacts immediately (see the route below)."""
    try:
        session_store.backend().delete_prefix(store_keys.session_prefix(sid))
    except Exception as exc:  # noqa: BLE001 - store backends raise their own exception types (botocore, OSError, ...)
        logger.warning(f"session-capture: eager discard failed for {sid}: {exc}")


def register_routes(app: FastAPI) -> None:
    """Register the session-capture routes, or do nothing when disabled.

    When ``SESSION_CAPTURE_ENABLED`` is false this is a no-op: the routes are
    never added to the app, so the feature "doesn't show up" at all. NOTE:
    server.py's SPA catch-all (``@app.get("/{path:path}")``) intercepts every
    unregistered ``/api/*`` path and returns ``null``/200 rather than a real
    404 (pre-existing behavior, unrelated to this module) -- so "not
    registered" shows up as that generic ``null`` body, not a 404 status. Use
    ``[r.path for r in app.routes]`` in a test if you need to assert
    non-registration directly.
    """
    if not settings.enabled():
        return

    # ---- Session capture (consent + transcript) ----
    # The UI POSTs {session_id, consent, transcript} at session end. This POST
    # can land on ANY pod (not necessarily the one that ran the pipeline), so
    # the transcript is written to the shared session_store and the consent
    # decision is recorded in the small Redis coordination state, then
    # maybe_finalize is tried — it only proceeds once the pipeline side has
    # ALSO signaled done (see capture.mark_pipeline_finished), regardless of
    # which of the two arrives first or which pod either one runs on.
    @app.post("/api/session-capture")
    async def session_capture(request: Request, background_tasks: BackgroundTasks):
        try:
            body = await request.json()
        except (ValueError, json.JSONDecodeError):
            return JSONResponse(status_code=400, content={"detail": "invalid JSON"})
        sid = store_keys.sanitize_sid(body.get("session_id", ""))
        if not sid:
            return JSONResponse(status_code=400, content={"detail": "no session_id"})
        consent = bool(body.get("consent"))
        transcript = body.get("transcript")
        has_transcript = consent and isinstance(transcript, str) and bool(transcript.strip())

        if settings.REQUIRE_CONSENT and not consent:
            # Eager discard: delete the declined session's artifacts NOW rather
            # than waiting for the pipeline-done signal
            # (capture.mark_pipeline_finished), which may never arrive -- a
            # crashed pod, a browser that closed before the pipeline tore down.
            # Idempotent (delete_prefix on an already-empty or not-yet-written
            # prefix is a harmless no-op) and safe even mid-session: if the
            # pipeline is still writing, _finalize's own denial branch runs this
            # again once pipeline_done arrives, cleaning up whatever landed in
            # between. Backgrounded (Starlette runs sync tasks in a threadpool):
            # delete_prefix does blocking store I/O, never safe on the loop.
            background_tasks.add_task(_eager_discard, sid)
        elif has_transcript:
            try:
                backend = session_store.backend()
                transcript_bytes = transcript[:200000].encode("utf-8")
                await asyncio.to_thread(backend.put, store_keys.transcript_key(sid), transcript_bytes)
            except Exception as exc:  # noqa: BLE001 - store backends raise their own exception types (botocore, OSError, ...)
                logger.warning(f"session-capture: transcript write failed for {sid}: {exc}")
                return JSONResponse(status_code=500, content={"detail": "write failed"})

        # Blocking Redis I/O (hset+expire) -- offloaded so a slow/blackholed
        # Redis can't stall the shared event loop for every session on this pod.
        await asyncio.to_thread(state.mark_consent, sid, consent=consent, has_transcript=has_transcript)
        logger.info(f"session-capture: {sid} consent={consent} transcript={'y' if has_transcript else 'n'}")
        background_tasks.add_task(maybe_finalize, sid)
        return {"ok": True}

    @app.get("/api/session-capture/status")
    async def session_capture_status():
        """Introspect capture readiness (backend, pending sessions). Ops/debug."""
        # status() -> state.all_pending_sids() does a full Redis SCAN; blocking.
        return await asyncio.to_thread(status)
