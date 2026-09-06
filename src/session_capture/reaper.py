# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause

"""Periodic sweep with two jobs: retry stuck-ready sessions, and abandon stale ones.

1. Retry: a session whose Redis coordination state shows BOTH signals present
   (``state.is_ready``) but that never finalized — e.g. the caller that should
   have run ``maybe_finalize`` was killed mid-run (pod eviction, OOM) — is
   retried here. Self-healing and cheap: ``maybe_finalize`` is idempotent (a
   session mid-finalize on another pod is simply skipped this round, since the
   lock is held).

2. Abandon: a session stuck with only ONE signal for longer than
   ``REAPER_ORPHAN_SECS`` (the other will never arrive — a crashed pod, a
   browser that never POSTs) has its artifacts deleted and its state cleared
   via ``capture.abandon_stale``, which uses the same lock ``maybe_finalize``
   does so it can never race a real finalize.

Deliberately NOT swept here: a session that finalized successfully in
"local-only" mode (``SESSION_CAPTURE_NGC`` unset) has no Redis state left —
by design, since session_store IS its archive in that mode. Sweeping "any
object prefix with no live state" would delete those intentionally-retained
archives; this reaper only ever acts on sessions that STILL have live
coordination state, so a completed archive is never touched.
"""

from __future__ import annotations

import asyncio

from loguru import logger

from . import settings, state
from .capture import abandon_stale, maybe_finalize, run_finalize

_task: asyncio.Task | None = None


async def _sweep_once() -> None:
    for sid in state.all_pending_sids():
        current = state.get(sid)
        if state.is_ready(current):
            logger.info(f"session-capture: reaper retrying stuck-ready session {sid}")
            await run_finalize(maybe_finalize, sid)
            continue
        age = state.seconds_since_update(sid)
        if age is not None and age >= settings.REAPER_ORPHAN_SECS:
            await run_finalize(abandon_stale, sid)


async def _run() -> None:
    try:
        while True:
            await asyncio.sleep(settings.REAPER_INTERVAL_SECS)
            try:
                await _sweep_once()
            except Exception as exc:  # noqa: BLE001 - a sweep failure must not kill the reaper
                logger.warning(f"session-capture: reaper sweep error: {exc}")
    except asyncio.CancelledError:
        pass


def start() -> None:
    """Start the reaper as a background task. No-op if disabled or already running."""
    global _task
    if _task is not None and not _task.done():
        return
    if not settings.enabled() or settings.REAPER_INTERVAL_SECS <= 0:
        return
    _task = asyncio.get_running_loop().create_task(_run())
    logger.info(f"session-capture: reaper started (interval={settings.REAPER_INTERVAL_SECS}s)")


def stop() -> None:
    """Cancel the reaper task, if running."""
    global _task
    if _task is not None:
        _task.cancel()
        _task = None
