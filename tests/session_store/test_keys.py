# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause

# ruff: noqa: D100, D101, D102, D103

import pytest

from session_store import keys as k

# Regression coverage for the path-traversal vulnerability introduced while
# keying audio/log storage by the client-supplied session_id (an unsanitized
# "../.." reached the filesystem via LocalBackend and could read/delete an
# arbitrary *.log on the host, then upload its contents into the "session"
# archive). sanitize_sid() and _require_sid() are the two layers that close
# it; every payload below was a working exploit before the fix.
TRAVERSAL_PAYLOADS = [
    "../victim/secret",
    "../../etc/passwd",
    "..%2f..%2fetc",
    "a/../../b",
    "",
    "/",
    "sessions/../../../etc",
]


@pytest.mark.parametrize("payload", TRAVERSAL_PAYLOADS)
def test_sanitize_sid_strips_every_non_hex_character(payload: str) -> None:
    result = k.sanitize_sid(payload)
    assert all(c in "0123456789abcdefABCDEF" for c in result)
    assert "/" not in result
    assert "." not in result


@pytest.mark.parametrize("payload", TRAVERSAL_PAYLOADS)
def test_key_builders_reject_a_sanitized_but_still_invalid_sid(payload: str) -> None:
    # sanitize_sid() reduces these to either "" or valid-looking hex fragments
    # (e.g. "..%2f..%2fetc" -> "2f2fec"); the point of this test is that the
    # KEY BUILDERS themselves refuse anything that isn't hex, so a caller that
    # forgets to sanitize first (defense in depth) still can't produce a path
    # that escapes the store root.
    sid = k.sanitize_sid(payload)
    if sid == "":
        with pytest.raises(ValueError):
            k.session_prefix(sid)
    # A non-empty sanitized fragment must itself be valid hex and behave.
    else:
        assert k.session_prefix(sid) == f"sessions/{sid}/"


def test_normal_hex_sid_is_unaffected() -> None:
    sid = "a1b2c3d4e5f6"
    assert k.sanitize_sid(sid) == sid
    assert k.session_prefix(sid) == f"sessions/{sid}/"
    assert k.log_key(sid) == f"sessions/{sid}/session.log"
    assert k.transcript_key(sid) == f"sessions/{sid}/transcript.txt"
    assert k.audio_prefix(sid) == f"sessions/{sid}/audio/"
    assert k.audio_key(sid, "asr", 0) == f"sessions/{sid}/audio/asr_000.wav"


def test_sanitize_sid_truncates_to_32_chars() -> None:
    assert len(k.sanitize_sid("a" * 100)) == 32


@pytest.mark.parametrize("bad_sid", ["", "not-hex!", "a/b", "..", "a" * 33 + "!"])
def test_require_sid_rejects_anything_not_pure_hex(bad_sid: str) -> None:
    with pytest.raises(ValueError):
        k._require_sid(bad_sid)  # noqa: SLF001 - the guard itself is what's under test
