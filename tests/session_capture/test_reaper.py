# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause

# ruff: noqa: D100, D101, D102, D103, D107

"""reaper._sweep_once tests.

Runs against the local (no-Redis) state fallback and a fake object-store
backend. Uses unittest.IsolatedAsyncioTestCase (stdlib, no pytest-asyncio
dependency) since _sweep_once is a coroutine -- matches the pattern already
used by tests/unit/test_activity_check.py.
"""

import asyncio
import unittest
from unittest.mock import patch

import session_store.client as ssc
from session_capture import capture, reaper, settings, state
from session_store import keys as k


def _sid(name: str) -> str:
    return "".join(f"{ord(c):02x}" for c in name)[:32]


class FakeBackend:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    def put(self, key: str, data: bytes) -> None:
        self.objects[key] = data

    def get(self, key: str) -> bytes | None:
        return self.objects.get(key)

    def list(self, prefix: str) -> list[str]:
        return sorted(x for x in self.objects if x.startswith(prefix))

    def delete_prefix(self, prefix: str) -> None:
        for key in list(self.objects):
            if key.startswith(prefix):
                del self.objects[key]

    def exists(self, key: str) -> bool:
        return key in self.objects

    def delete(self, key: str) -> None:
        self.objects.pop(key, None)


class ReaperSweepTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.backend = FakeBackend()
        self._patches = [
            patch.object(ssc, "_backend", self.backend),
            patch.object(ssc, "_is_s3", False),
            patch.object(settings, "ENABLED", True),
            patch.object(settings, "NGC_RESOURCE", ""),
            patch.object(settings, "MAX_FINALIZE_ATTEMPTS", 5),
            # Same RATIO as the shipped defaults (900 < 3600), scaled down so
            # the test runs in milliseconds. This is the exact relationship
            # whose violation made the D2 stale-sweep unreachable: ORPHAN_SECS
            # must stay below CAP_STATE_TTL or a stuck session's age can never
            # reach the threshold before its Redis-equivalent state expires.
            patch.object(settings, "CAP_STATE_TTL", 0.5),
            patch.object(settings, "REAPER_ORPHAN_SECS", 0.05),
        ]
        for p in self._patches:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in self._patches])

    async def test_stuck_partial_session_is_abandoned_after_the_orphan_window(self) -> None:
        # D2 regression: reproduces the exact arithmetic that made this
        # unreachable when ORPHAN_SECS >= CAP_STATE_TTL.
        sid = _sid("stuckpartial")
        state.clear_state(sid)
        self.backend.put(k.log_key(sid), b"orphan log, consent never arrived")
        state.mark_pipeline_done(sid)  # only ONE signal

        await asyncio.sleep(0.08)  # exceed REAPER_ORPHAN_SECS
        await reaper._sweep_once()

        self.assertEqual(state.get(sid), {})
        self.assertEqual(self.backend.list(k.session_prefix(sid)), [])

    async def test_completed_local_only_archive_is_never_touched(self) -> None:
        # A session that finalized successfully in local-only mode (NGC
        # unset) has no coordination state left -- by design, since
        # session_store IS its archive in that mode. The reaper must never
        # sweep it just because enough time has passed.
        sid = _sid("completedarchive")
        state.clear_state(sid)
        self.backend.put(k.log_key(sid), b"archived forever")
        state.mark_pipeline_done(sid)
        state.mark_consent(sid, consent=True, has_transcript=False)
        capture.maybe_finalize(sid)  # NGC unset -> succeeds, state cleared, objects retained
        self.assertEqual(state.get(sid), {})
        self.assertEqual(self.backend.list(k.session_prefix(sid)), [k.log_key(sid)])

        await asyncio.sleep(0.08)  # well past the (scaled) orphan window
        await reaper._sweep_once()

        # Untouched: no state existed for the reaper to find in the first place.
        self.assertEqual(self.backend.list(k.session_prefix(sid)), [k.log_key(sid)])

    async def test_ready_but_stuck_session_is_retried(self) -> None:
        # Both signals landed but finalize never ran (e.g. the caller that
        # should have run it was killed mid-request). The reaper's ready-sweep
        # branch must retry it.
        sid = _sid("readystuck")
        state.clear_state(sid)
        self.backend.put(k.log_key(sid), b"log")
        state.mark_pipeline_done(sid)
        state.mark_consent(sid, consent=True, has_transcript=False)

        await reaper._sweep_once()

        self.assertEqual(state.get(sid), {})
        self.assertEqual(self.backend.list(k.session_prefix(sid)), [k.log_key(sid)])

    async def test_fresh_partial_session_is_not_abandoned_early(self) -> None:
        sid = _sid("freshpartial")
        state.clear_state(sid)
        state.mark_pipeline_done(sid)

        await reaper._sweep_once()  # immediately -- well within the orphan window

        self.assertNotEqual(state.get(sid), {}, "must not abandon a session that just started waiting")
        state.clear_state(sid)
