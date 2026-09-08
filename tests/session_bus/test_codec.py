# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause

# ruff: noqa: D103

"""Unit tests for session_bus.codec — round-trip serialization with no Redis needed.

Run with: PYTHONPATH=src uv run pytest tests/session_bus/test_codec.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from attachment_store import Attachment  # noqa: E402
from session_bus import codec  # noqa: E402
from webcam_frame_store import WebcamFrame  # noqa: E402


def _fields_as_redis_would_return(fields: dict) -> dict:
    """Simulate what redis-py hands back: bytes keys, bytes values."""
    out = {}
    for k, v in fields.items():
        out[k.encode()] = v if isinstance(v, bytes) else str(v).encode()
    return out


def test_webcam_frame_round_trip():
    original = WebcamFrame(
        id="abc123",
        session_id="sess1",
        sequence=7,
        name="frame.jpg",
        content_type="image/jpeg",
        data=b"\xff\xd8\xff\x00binaryjpegbytes",
        created_at="2026-08-17T00:00:00+00:00",
    )
    fields = codec.frame_to_fields(original)
    assert fields["data"] == original.data  # bytes payload passed through, not stringified
    roundtripped = codec.fields_to_frame(_fields_as_redis_would_return(fields))
    assert roundtripped == original


def test_attachment_round_trip():
    original = Attachment(
        id="att1",
        session_id="sess2",
        sequence=3,
        kind="image",
        name="upload.png",
        content_type="image/png",
        data=b"\x89PNG\r\n\x1a\n\x00binarypngbytes",
        created_at="2026-08-17T00:00:01+00:00",
        source="upload",
    )
    fields = codec.att_to_fields(original)
    assert fields["data"] == original.data
    roundtripped = codec.fields_to_att(_fields_as_redis_would_return(fields))
    assert roundtripped == original


def test_attachment_capture_source_preserved():
    original = Attachment(
        id="att2",
        session_id="sess3",
        sequence=1,
        kind="image",
        name="capture.jpg",
        content_type="image/jpeg",
        data=b"\xff\xd8\xff\x00capture",
        created_at="2026-08-17T00:00:02+00:00",
        source="capture",
    )
    roundtripped = codec.fields_to_att(_fields_as_redis_would_return(codec.att_to_fields(original)))
    assert roundtripped.source == "capture"


if __name__ == "__main__":
    test_webcam_frame_round_trip()
    test_attachment_round_trip()
    test_attachment_capture_source_preserved()
    print("All codec round-trip tests PASSED")
