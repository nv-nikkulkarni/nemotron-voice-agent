# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause
"""Minimal, dependency-free codec for the pipecat WebSocket ``Frame`` wire format.

This is a byte-exact reimplementation of the protobuf schema shipped by
``@pipecat-ai/websocket-transport`` (``ProtobufFrameSerializer``) and consumed by
the server's ``pipecat.serializers.protobuf.ProtobufFrameSerializer``. Field
numbers/types were read straight out of the client bundle so the wire format is
guaranteed to match both ends. Schema::

    message TextFrame          { uint64 id=1; string name=2; string text=3; }
    message AudioRawFrame      { uint64 id=1; string name=2; bytes audio=3;
                                 uint32 sample_rate=4; uint32 num_channels=5;
                                 optional uint64 pts=6; }
    message TranscriptionFrame { uint64 id=1; string name=2; string text=3;
                                 string user_id=4; string timestamp=5; }
    message MessageFrame       { string data=1; }   // data = JSON (RTVI msg)
    message Frame {
      oneof frame { TextFrame text=1; AudioRawFrame audio=2;
                    TranscriptionFrame transcription=3; MessageFrame message=4; }
    }

We hand-roll the (very small) protobuf wire format instead of pulling in the
heavyweight ``pipecat-ai`` package + a protoc toolchain. Only the fields the
harness needs are decoded; everything else is skipped safely.

Run ``python pcframes.py`` to execute the round-trip self-test.
"""
from __future__ import annotations

WIRE_VARINT = 0
WIRE_64BIT = 1
WIRE_LEN = 2
WIRE_32BIT = 5

# Frame oneof field numbers.
FRAME_TEXT = 1
FRAME_AUDIO = 2
FRAME_TRANSCRIPTION = 3
FRAME_MESSAGE = 4
_FRAME_KIND = {
    FRAME_TEXT: "text",
    FRAME_AUDIO: "audio",
    FRAME_TRANSCRIPTION: "transcription",
    FRAME_MESSAGE: "message",
}


# --------------------------------------------------------------------------- #
# Low-level protobuf wire helpers
# --------------------------------------------------------------------------- #
def _read_varint(buf: bytes, pos: int) -> tuple[int, int]:
    result = 0
    shift = 0
    while True:
        b = buf[pos]
        pos += 1
        result |= (b & 0x7F) << shift
        if not (b & 0x80):
            return result, pos
        shift += 7


def _iter_fields(buf: bytes):
    """Yield ``(field_no, wire_type, value)``.

    ``value`` is an ``int`` for varint fields and a ``bytes`` slice for
    length-delimited / fixed-width fields.
    """
    pos, n = 0, len(buf)
    while pos < n:
        tag, pos = _read_varint(buf, pos)
        field_no, wire = tag >> 3, tag & 0x7
        if wire == WIRE_VARINT:
            val, pos = _read_varint(buf, pos)
            yield field_no, wire, val
        elif wire == WIRE_LEN:
            length, pos = _read_varint(buf, pos)
            yield field_no, wire, buf[pos:pos + length]
            pos += length
        elif wire == WIRE_64BIT:
            yield field_no, wire, buf[pos:pos + 8]
            pos += 8
        elif wire == WIRE_32BIT:
            yield field_no, wire, buf[pos:pos + 4]
            pos += 4
        else:
            raise ValueError(f"unsupported protobuf wire type {wire}")


def _write_varint(value: int) -> bytes:
    out = bytearray()
    value &= (1 << 64) - 1  # unsigned
    while True:
        b = value & 0x7F
        value >>= 7
        if value:
            out.append(b | 0x80)
        else:
            out.append(b)
            return bytes(out)


def _tag(field_no: int, wire: int) -> bytes:
    return _write_varint((field_no << 3) | wire)


def _len_delim(field_no: int, payload: bytes) -> bytes:
    return _tag(field_no, WIRE_LEN) + _write_varint(len(payload)) + payload


def _varint_field(field_no: int, value: int) -> bytes:
    return _tag(field_no, WIRE_VARINT) + _write_varint(value)


def _string_field(field_no: int, s: str) -> bytes:
    return _len_delim(field_no, s.encode("utf-8"))


# --------------------------------------------------------------------------- #
# Encoders (client -> server)
# --------------------------------------------------------------------------- #
def encode_audio_frame(pcm_bytes: bytes, sample_rate: int = 16000,
                       num_channels: int = 1, name: str = "audio",
                       frame_id: int = 0) -> bytes:
    """Serialize PCM16 bytes as a ``Frame{ audio: AudioRawFrame }``.

    The server maps ``AudioRawFrame`` -> ``InputAudioRawFrame`` regardless of the
    ``name`` field, so this is exactly what the browser recorder sends.
    """
    inner = bytearray()
    if frame_id:
        inner += _varint_field(1, frame_id)
    if name:
        inner += _string_field(2, name)
    inner += _len_delim(3, pcm_bytes)          # audio bytes
    inner += _varint_field(4, sample_rate)     # sample_rate
    inner += _varint_field(5, num_channels)    # num_channels
    return _len_delim(FRAME_AUDIO, bytes(inner))


def encode_message_frame(data: str) -> bytes:
    """Serialize a JSON string as a ``Frame{ message: MessageFrame }`` (RTVI)."""
    return _len_delim(FRAME_MESSAGE, _string_field(1, data))


def encode_text_frame(text: str, name: str = "", frame_id: int = 0) -> bytes:
    """Serialize a ``Frame{ text: TextFrame }`` (unused by the harness, provided
    for completeness / testing)."""
    inner = bytearray()
    if frame_id:
        inner += _varint_field(1, frame_id)
    if name:
        inner += _string_field(2, name)
    if text:
        inner += _string_field(3, text)
    return _len_delim(FRAME_TEXT, bytes(inner))


# --------------------------------------------------------------------------- #
# Decoders (server -> client)
# --------------------------------------------------------------------------- #
def _decode_text(buf: bytes) -> dict:
    out = {"name": "", "text": ""}
    for f, w, v in _iter_fields(buf):
        if w != WIRE_LEN:
            continue
        if f == 2:
            out["name"] = v.decode("utf-8", "replace")
        elif f == 3:
            out["text"] = v.decode("utf-8", "replace")
    return out


def _decode_audio(buf: bytes) -> dict:
    out = {"audio": b"", "sample_rate": 0, "num_channels": 1}
    for f, w, v in _iter_fields(buf):
        if f == 3 and w == WIRE_LEN:
            out["audio"] = bytes(v)
        elif f == 4 and w == WIRE_VARINT:
            out["sample_rate"] = v
        elif f == 5 and w == WIRE_VARINT:
            out["num_channels"] = v
    return out


def _decode_transcription(buf: bytes) -> dict:
    out = {"name": "", "text": "", "user_id": "", "timestamp": ""}
    for f, w, v in _iter_fields(buf):
        if w != WIRE_LEN:
            continue
        if f == 2:
            out["name"] = v.decode("utf-8", "replace")
        elif f == 3:
            out["text"] = v.decode("utf-8", "replace")
        elif f == 4:
            out["user_id"] = v.decode("utf-8", "replace")
        elif f == 5:
            out["timestamp"] = v.decode("utf-8", "replace")
    return out


def _decode_message(buf: bytes) -> dict:
    out = {"data": ""}
    for f, w, v in _iter_fields(buf):
        if f == 1 and w == WIRE_LEN:
            out["data"] = v.decode("utf-8", "replace")
    return out


_SUBDECODERS = {
    "text": _decode_text,
    "audio": _decode_audio,
    "transcription": _decode_transcription,
    "message": _decode_message,
}


def decode_frame(buf: bytes) -> tuple[str | None, dict]:
    """Decode a top-level ``Frame``.

    Returns ``(kind, payload)`` where ``kind`` is one of
    ``text|audio|transcription|message`` (or ``None`` if the frame carried none
    of the known oneof members). ``payload`` is a dict of the decoded sub-fields.
    """
    for field_no, wire, val in _iter_fields(buf):
        if wire != WIRE_LEN:
            continue
        kind = _FRAME_KIND.get(field_no)
        if kind:
            return kind, _SUBDECODERS[kind](val)
    return None, {}


# --------------------------------------------------------------------------- #
# Self-test
# --------------------------------------------------------------------------- #
if __name__ == "__main__":
    import json

    # audio round-trip
    pcm = bytes(range(256)) * 4
    kind, p = decode_frame(encode_audio_frame(pcm, 16000, 1))
    assert kind == "audio", kind
    assert p["audio"] == pcm
    assert p["sample_rate"] == 16000 and p["num_channels"] == 1

    # message round-trip (RTVI client-ready-shaped)
    msg = {"label": "rtvi-ai", "type": "client-ready", "data": {"version": "1.4.0"}, "id": "abcd1234"}
    kind, p = decode_frame(encode_message_frame(json.dumps(msg)))
    assert kind == "message", kind
    assert json.loads(p["data"]) == msg

    # text round-trip
    kind, p = decode_frame(encode_text_frame("hello world", name="bot"))
    assert kind == "text" and p["text"] == "hello world" and p["name"] == "bot"

    # transcription decode (build a frame the way the server would)
    tf = _len_delim(FRAME_TRANSCRIPTION,
                    _string_field(3, "what is the weather") + _string_field(4, "user-1"))
    kind, p = decode_frame(tf)
    assert kind == "transcription" and p["text"] == "what is the weather" and p["user_id"] == "user-1"

    # varint edge cases
    for val in (0, 1, 127, 128, 16000, 2 ** 32 - 1, 2 ** 64 - 1):
        got, _ = _read_varint(_write_varint(val), 0)
        assert got == val, (val, got)

    print("pcframes self-test: OK")
