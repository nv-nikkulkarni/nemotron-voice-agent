# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause

"""Object key builders for session-capture artifacts.

One unified key namespace used by every backend (local filesystem or S3), so
switching SESSION_STORE_BACKEND never changes what a caller passes in.
"""

from __future__ import annotations

_SID_ALPHABET = "0123456789abcdefABCDEF"


def sanitize_sid(raw: object) -> str:
    """Reduce a client-supplied session id to the hex-only form used as a key.

    Session ids are server-minted hex (``uuid4().hex[:12]``, see server.py), but
    ``session_id`` arrives as a raw query parameter on ``/api/offer`` and
    ``/api/ws``, so a client can send ANY string. That value is used to build
    filesystem paths and object keys, so it must be reduced to a safe alphabet
    at every entry point -- dropping ``.``, ``/`` and every other character
    that could escape the intended directory/prefix. Returns "" for input with
    no usable characters, which callers treat as "no session to capture".
    """
    return "".join(c for c in str(raw) if c in _SID_ALPHABET)[:32]


def _require_sid(sid: str) -> str:
    # Defense in depth behind sanitize_sid(): key builders are the last place a
    # bad sid can turn into a path, so anything that isn't already the sanitized
    # hex form fails loudly rather than silently escaping the store root.
    #
    # Two distinct escapes are blocked here:
    #  - "" would make session_prefix() return "sessions//", which
    #    LocalBackend.delete_prefix resolves to the "sessions/" ROOT -- wiping
    #    every session for every user in one call.
    #  - "../.." (or any path separator) would escape the store root entirely
    #    on the put/get path, which -- unlike delete_prefix -- has no
    #    normalization of its own (LocalBackend._path only strips a leading "/").
    if not sid or any(c not in _SID_ALPHABET for c in sid):
        raise ValueError(f"session_store key functions require a hex session id, got {sid!r}")
    return sid


def session_prefix(sid: str) -> str:
    """Return the prefix under which all of a session's objects live."""
    return f"sessions/{_require_sid(sid)}/"


def log_key(sid: str) -> str:
    """Return the key for a session's assembled log file."""
    return f"sessions/{_require_sid(sid)}/session.log"


def transcript_key(sid: str) -> str:
    """Return the key for a session's transcript."""
    return f"sessions/{_require_sid(sid)}/transcript.txt"


def audio_prefix(sid: str) -> str:
    """Return the prefix under which a session's recorded audio turns live."""
    return f"sessions/{_require_sid(sid)}/audio/"


def audio_key(sid: str, kind: str, idx: int) -> str:
    """``kind`` is "asr" or "tts"; ``idx`` is the per-kind turn index."""
    return f"sessions/{_require_sid(sid)}/audio/{kind}_{idx:03d}.wav"
