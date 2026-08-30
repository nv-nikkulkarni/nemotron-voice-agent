# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause

# ruff: noqa: D100, D101, D102, D103, D107

"""Consent-decline eager discard (session_capture.routes._eager_discard).

Full HTTP-level route wiring (FastAPI request -> background task scheduling)
is covered by tests/sqa/ against a real running app; these are unit tests of
the discard logic itself, which is what actually matters for the privacy
guarantee (B4/D4): a declined session's artifacts must be deleted even if
the pipeline-done signal never arrives.
"""

import session_store.client as ssc
from session_capture import routes, state
from session_store import keys as k


def _sid(name: str) -> str:
    return "".join(f"{ord(c):02x}" for c in name)[:32]


class FakeBackend:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.raise_on_delete_prefix: Exception | None = None

    def put(self, key: str, data: bytes) -> None:
        self.objects[key] = data

    def get(self, key: str) -> bytes | None:
        return self.objects.get(key)

    def list(self, prefix: str) -> list[str]:
        return sorted(x for x in self.objects if x.startswith(prefix))

    def delete_prefix(self, prefix: str) -> None:
        if self.raise_on_delete_prefix is not None:
            raise self.raise_on_delete_prefix
        for key in list(self.objects):
            if key.startswith(prefix):
                del self.objects[key]

    def exists(self, key: str) -> bool:
        return key in self.objects

    def delete(self, key: str) -> None:
        self.objects.pop(key, None)


def test_eager_discard_deletes_even_when_pipeline_done_never_arrives(monkeypatch) -> None:
    # B4/D13 regression: the ORIGINAL bug -- deletion only ever happened
    # inside _finalize's denial branch, which required pipeline_done. If the
    # pipeline pod crashed before signaling, a declined session's audio was
    # retained forever. Eager discard must not depend on that signal at all.
    backend = FakeBackend()
    monkeypatch.setattr(ssc, "_backend", backend)
    sid = _sid("neverpipelinedone")
    state.clear_state(sid)
    backend.put(k.log_key(sid), b"partial log, pipeline never finished")
    backend.put(k.audio_key(sid, "asr", 0), b"audio the user declined to share")
    # Deliberately: state.mark_pipeline_done(sid) is NEVER called.

    routes._eager_discard(sid)

    assert backend.list(k.session_prefix(sid)) == []


def test_eager_discard_on_empty_prefix_is_a_noop(monkeypatch) -> None:
    backend = FakeBackend()
    monkeypatch.setattr(ssc, "_backend", backend)
    sid = _sid("nothingwritten")
    routes._eager_discard(sid)  # must not raise even though nothing exists
    assert backend.list(k.session_prefix(sid)) == []


def test_eager_discard_failure_is_swallowed_and_logged_not_raised(monkeypatch) -> None:
    # _eager_discard runs as a Starlette BackgroundTask; an uncaught exception
    # there would just be logged by Starlette anyway, but the function itself
    # must not propagate -- it's fire-and-forget by design.
    backend = FakeBackend()
    backend.raise_on_delete_prefix = RuntimeError("store outage")
    monkeypatch.setattr(ssc, "_backend", backend)
    sid = _sid("discardfails")
    backend.put(k.log_key(sid), b"data")
    routes._eager_discard(sid)  # must not raise
