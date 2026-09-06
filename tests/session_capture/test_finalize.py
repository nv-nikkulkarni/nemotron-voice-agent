# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause

# ruff: noqa: D100, D101, D102, D103, D107

"""capture.maybe_finalize / _finalize tests.

Exercised against a fake in-memory backend injected via
session_store.client._backend -- no real filesystem or network I/O.
Assertions are on OUTCOMES (state contents, object presence, temp-file
leaks), never on log messages: reading "assembled / upload skipped" as
success is exactly how the /tmp leak and the path-traversal bug were
originally missed.
"""

import glob
import os
import tempfile

import pytest

import session_store.client as ssc
from session_capture import capture, settings, state
from session_store import keys as k


def _sid(name: str) -> str:
    return "".join(f"{ord(c):02x}" for c in name)[:32]


class FakeBackend:
    """In-memory ObjectBackend double."""

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.raise_on_list: Exception | None = None
        self.raise_on_delete_prefix: Exception | None = None

    def put(self, key: str, data: bytes) -> None:
        self.objects[key] = data

    def get(self, key: str) -> bytes | None:
        return self.objects.get(key)

    def list(self, prefix: str) -> list[str]:
        if self.raise_on_list is not None:
            raise self.raise_on_list
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


@pytest.fixture(autouse=True)
def fake_backend(monkeypatch):
    backend = FakeBackend()
    monkeypatch.setattr(ssc, "_backend", backend)
    monkeypatch.setattr(ssc, "_is_s3", False)
    monkeypatch.setattr(settings, "ENABLED", True)
    monkeypatch.setattr(settings, "NGC_RESOURCE", "")
    monkeypatch.setattr(settings, "MAX_FINALIZE_ATTEMPTS", 2)
    yield backend


def _tar_leak_count() -> int:
    return len(glob.glob(os.path.join(tempfile.gettempdir(), "tmp*.tar.gz")))


def test_full_happy_path_local_archive_mode(fake_backend) -> None:
    sid = _sid("happy")
    state.clear_state(sid)
    fake_backend.put(k.log_key(sid), b"log")
    fake_backend.put(k.audio_key(sid, "asr", 0), b"wav")
    state.mark_pipeline_done(sid)
    state.mark_consent(sid, consent=True, has_transcript=False)

    before_leaks = _tar_leak_count()
    capture.maybe_finalize(sid)

    assert state.get(sid) == {}
    # NGC unset -> local-only archive mode: objects deliberately retained.
    assert set(fake_backend.list(k.session_prefix(sid))) == {
        k.log_key(sid),
        k.audio_key(sid, "asr", 0),
    }
    assert _tar_leak_count() == before_leaks, "no /tmp/*.tar.gz should survive a finalize"


def test_not_ready_is_a_noop(fake_backend) -> None:
    sid = _sid("notready")
    state.clear_state(sid)
    state.mark_pipeline_done(sid)  # only one signal
    capture.maybe_finalize(sid)
    assert state.get(sid) != {}  # untouched, still waiting for consent
    state.clear_state(sid)


def test_consent_denied_deletes_and_clears(fake_backend) -> None:
    sid = _sid("denied")
    state.clear_state(sid)
    fake_backend.put(k.log_key(sid), b"log")
    fake_backend.put(k.audio_key(sid, "asr", 0), b"wav")
    state.mark_pipeline_done(sid)
    state.mark_consent(sid, consent=False, has_transcript=False)

    capture.maybe_finalize(sid)

    assert state.get(sid) == {}
    assert fake_backend.list(k.session_prefix(sid)) == []


def test_consented_no_artifacts_is_retained_for_diagnosis(fake_backend) -> None:
    sid = _sid("noartifacts")
    state.clear_state(sid)
    state.mark_pipeline_done(sid)
    state.mark_consent(sid, consent=True, has_transcript=False)

    before_leaks = _tar_leak_count()
    capture.maybe_finalize(sid)  # attempt 1
    capture.maybe_finalize(sid)  # attempt 2 -> retained failure
    capture.maybe_finalize(sid)  # exhausted retained failure is a no-op

    st = state.get(sid)
    assert st != {}, "a consented capture with missing evidence must remain diagnosable"
    assert st.get("attempts") == "2"
    assert st.get("last_error") == "no_artifacts"
    assert _tar_leak_count() == before_leaks
    state.clear_state(sid)


def test_store_read_failure_is_retryable_not_cleared(fake_backend) -> None:
    sid = _sid("readfail")
    state.clear_state(sid)
    state.mark_pipeline_done(sid)
    state.mark_consent(sid, consent=True, has_transcript=False)
    fake_backend.raise_on_list = RuntimeError("store outage")

    capture.maybe_finalize(sid)

    st = state.get(sid)
    assert st != {}
    assert st["attempts"] == "1"


def test_ngc_configured_but_cli_missing_is_a_retryable_failure(fake_backend, monkeypatch) -> None:
    # D5 regression: NGC_RESOURCE set but the CLI missing must NOT be treated
    # as "local-only capture" (which silently succeeds and stops retrying) --
    # it's a misconfiguration that should keep failing loudly until fixed.
    monkeypatch.setattr(settings, "NGC_RESOURCE", "org/resource")
    monkeypatch.setattr(settings, "NGC_CLI_BIN", "/definitely/does/not/exist")
    sid = _sid("ngcmissing")
    state.clear_state(sid)
    fake_backend.put(k.log_key(sid), b"log")
    state.mark_pipeline_done(sid)
    state.mark_consent(sid, consent=True, has_transcript=False)

    capture.maybe_finalize(sid)

    st = state.get(sid)
    assert st != {}
    assert st["attempts"] == "1"
    # Must NOT have been silently treated as archived-and-done.
    assert fake_backend.list(k.session_prefix(sid)) != []


def test_upload_success_but_cleanup_failure_still_counts_as_success(fake_backend, monkeypatch) -> None:
    # D3 regression: a store error while deleting the now-redundant source
    # objects (AFTER a successful upload) must not be mistaken for "upload
    # failed" -- that would cause a duplicate NGC upload (a new version) on
    # the next retry attempt.
    monkeypatch.setattr(settings, "NGC_RESOURCE", "org/resource")
    monkeypatch.setattr(settings, "NGC_CLI_BIN", "/bin/true")  # os.path.exists() True
    monkeypatch.setenv("NGC_API_KEY", "test-registry-key")
    monkeypatch.setattr(capture, "_upload", lambda sid, tar_path: (True, "", False))
    sid = _sid("cleanupfail")
    state.clear_state(sid)
    fake_backend.put(k.log_key(sid), b"log")
    state.mark_pipeline_done(sid)
    state.mark_consent(sid, consent=True, has_transcript=False)
    fake_backend.raise_on_delete_prefix = RuntimeError("cleanup store error")

    before_leaks = _tar_leak_count()
    capture.maybe_finalize(sid)

    assert state.get(sid) == {}, "a successful upload must be treated as done, not retried"
    assert _tar_leak_count() == before_leaks


def test_upload_timeout_giveup_does_not_delete_or_clear(fake_backend, monkeypatch) -> None:
    # D9 regression: a client-side subprocess TIMEOUT does not mean the
    # upload definitely failed -- ngc may finish server-side regardless.
    # Deleting the source objects after giving up could destroy a session
    # that IS already archived in NGC.
    monkeypatch.setattr(settings, "NGC_RESOURCE", "org/resource")
    monkeypatch.setattr(settings, "NGC_CLI_BIN", "/bin/true")
    monkeypatch.setenv("NGC_API_KEY", "test-registry-key")
    monkeypatch.setattr(capture, "_upload", lambda sid, tar_path: (False, "timed out", True))
    sid = _sid("timeoutgiveup")
    state.clear_state(sid)
    fake_backend.put(k.log_key(sid), b"log")
    state.mark_pipeline_done(sid)
    state.mark_consent(sid, consent=True, has_transcript=False)

    capture.maybe_finalize(sid)  # attempt 1
    capture.maybe_finalize(sid)  # attempt 2 -> hits MAX_FINALIZE_ATTEMPTS, give-up path

    st = state.get(sid)
    assert st != {}, "state must be retained for manual review after a timeout give-up"
    assert st.get("last_error") == "timeout"
    assert fake_backend.list(k.session_prefix(sid)) != [], "objects must NOT be deleted after a timeout give-up"
    state.clear_state(sid)


def test_upload_failure_giveup_does_not_delete_or_retry_forever(fake_backend, monkeypatch) -> None:
    """Auth/config upload failures retain evidence after exhausting retries."""
    monkeypatch.setattr(settings, "NGC_RESOURCE", "org/resource")
    monkeypatch.setattr(settings, "NGC_CLI_BIN", "/bin/true")
    monkeypatch.setattr(settings, "MAX_FINALIZE_ATTEMPTS", 2)
    monkeypatch.setenv("NGC_API_KEY", "test-registry-key")
    calls = 0

    def fail_upload(sid, tar_path):
        nonlocal calls
        calls += 1
        return False, "403 forbidden", False

    monkeypatch.setattr(capture, "_upload", fail_upload)
    sid = _sid("uploadfailuregiveup")
    state.clear_state(sid)
    fake_backend.put(k.log_key(sid), b"log")
    state.mark_pipeline_done(sid)
    state.mark_consent(sid, consent=True, has_transcript=False)

    capture.maybe_finalize(sid)
    capture.maybe_finalize(sid)
    capture.maybe_finalize(sid)  # exhausted state is a no-op, not another upload

    st = state.get(sid)
    assert st.get("attempts") == "2"
    assert st.get("last_error") == "upload_failed"
    assert calls == 2
    assert fake_backend.list(k.session_prefix(sid)) != []
    state.clear_state(sid)


def test_status_distinguishes_dedicated_ngc_key_from_fallback(monkeypatch) -> None:
    monkeypatch.delenv("NGC_API_KEY", raising=False)
    monkeypatch.setenv("NVIDIA_API_KEY", "inference-only")

    without_dedicated = capture.status()
    assert without_dedicated["ngc_key_present"] is False
    assert without_dedicated["ngc_registry_key_present"] is False
    assert without_dedicated["nvidia_fallback_key_present"] is True
    assert without_dedicated["ngc_key_source"] == "nvidia_api_key_fallback"

    monkeypatch.setenv("NGC_API_KEY", "registry-key")
    with_dedicated = capture.status()
    assert with_dedicated["ngc_key_present"] is True
    assert with_dedicated["ngc_registry_key_present"] is True
    assert with_dedicated["ngc_key_source"] == "ngc_api_key"


def test_giveup_whose_own_discard_fails_keeps_state_for_retry(fake_backend) -> None:
    # D8 regression: if the give-up path's OWN cleanup attempt also fails,
    # state must be retained (not cleared) -- clearing here would make the
    # leftover objects invisible to every retry/GC path forever, since they
    # all key off live coordination state.
    sid = _sid("giveupdiscardfails")
    state.clear_state(sid)
    state.mark_pipeline_done(sid)
    state.mark_consent(sid, consent=True, has_transcript=False)
    fake_backend.raise_on_list = RuntimeError("store down")
    fake_backend.raise_on_delete_prefix = RuntimeError("store down too")

    capture.maybe_finalize(sid)  # attempt 1 fails
    capture.maybe_finalize(sid)  # attempt 2 -> give-up, discard ALSO fails

    st = state.get(sid)
    assert st != {}, "state must survive so the next sweep can retry the discard"
    state.clear_state(sid)


def test_giveup_deletes_and_clears_when_no_special_error(fake_backend) -> None:
    sid = _sid("plaingiveup")
    state.clear_state(sid)
    fake_backend.put(k.log_key(sid), b"log")
    state.mark_pipeline_done(sid)
    state.mark_consent(sid, consent=True, has_transcript=False)
    fake_backend.raise_on_list = RuntimeError("store down")

    capture.maybe_finalize(sid)  # attempt 1 -> retry
    capture.maybe_finalize(sid)  # attempt 2 -> give-up (last_error is NOT "timeout")

    assert state.get(sid) == {}
    fake_backend.raise_on_list = None  # the store recovered; only the assertion needs to read it now
    assert fake_backend.list(k.session_prefix(sid)) == []


def test_exactly_once_under_concurrent_style_interleave(fake_backend) -> None:
    # B3 regression, capture-level: simulates the interleaving that broke the
    # old boolean-flag lock -- caller A finalizes and releases (with ITS OWN
    # token); caller B must not be able to piggyback on a lock it never held.
    sid = _sid("interleave")
    state.clear_state(sid)
    token_a = state.try_acquire_lock(sid)
    assert token_a is not None
    token_b = state.try_acquire_lock(sid)
    assert token_b is None, "a second caller must not acquire while the first still holds the lock"
    state.release_lock(sid, token_a)
    state.clear_state(sid)
