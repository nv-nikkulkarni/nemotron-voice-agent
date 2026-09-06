# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause

# ruff: noqa: D101, D102, D103, D107

"""Behavior tests for the Redis-backed media/session-sharing operations."""

from __future__ import annotations

import asyncio
from collections import defaultdict

from session_bus import media


class FakeRedis:
    def __init__(self) -> None:
        self.values: dict[str, object] = {}
        self.streams: dict[str, list[tuple[bytes, dict]]] = defaultdict(list)
        self.expirations: list[tuple[str, int]] = []

    def incr(self, key: str) -> int:
        value = int(self.values.get(key, 0)) + 1
        self.values[key] = value
        return value

    def xadd(self, key: str, fields: dict, *, maxlen: int, approximate: bool) -> bytes:
        del approximate
        entry_id = f"{len(self.streams[key]) + 1}-0".encode()
        encoded = {
            (k.encode() if isinstance(k, str) else k): (v if isinstance(v, bytes) else str(v).encode())
            for k, v in fields.items()
        }
        self.streams[key].append((entry_id, encoded))
        self.streams[key] = self.streams[key][-maxlen:]
        return entry_id

    def expire(self, key: str, ttl: int) -> None:
        self.expirations.append((key, ttl))

    def xrevrange(self, key: str, *, count: int) -> list[tuple[bytes, dict]]:
        return list(reversed(self.streams[key]))[:count]

    def xrange(self, key: str) -> list[tuple[bytes, dict]]:
        return list(self.streams[key])

    def xdel(self, key: str, entry_id: bytes) -> None:
        self.streams[key] = [entry for entry in self.streams[key] if entry[0] != entry_id]

    def delete(self, *keys: str) -> None:
        for key in keys:
            self.values.pop(key, None)
            self.streams.pop(key, None)

    def set(self, key: str, value: str, *, ex: int) -> None:
        del ex
        self.values[key] = value

    def eval(self, _script: str, _num_keys: int, key: str, expected: str) -> int:
        if self.values.get(key) != expected:
            return 0
        del self.values[key]
        return 1


def test_webcam_ring_round_trip_and_session_isolation(monkeypatch) -> None:
    redis = FakeRedis()
    monkeypatch.setattr(media.client, "sync_client", lambda: redis)
    monkeypatch.setattr(media, "RING", 2)

    first = media.store_webcam_frame(session_id="alpha", name="1.jpg", content_type="image/jpeg", data=b"one")
    second = media.store_webcam_frame(session_id="alpha", name="2.jpg", content_type="image/jpeg", data=b"two")
    third = media.store_webcam_frame(session_id="alpha", name="3.jpg", content_type="image/jpeg", data=b"three")
    other = media.store_webcam_frame(session_id="beta", name="b.jpg", content_type="image/jpeg", data=b"beta")

    assert [frame.data for frame in media.recent_webcam_frames("alpha")] == [b"two", b"three"]
    assert media.latest_webcam_frame("alpha") == third
    assert media.latest_webcam_frame("beta") == other
    assert first.session_id == second.session_id == third.session_id == "alpha"
    assert {key for key, _ttl in redis.expirations} >= {"sb:wc:alpha", "sb:seq:wc:alpha"}

    media.clear_webcam("alpha", keep_seq=True)
    assert media.recent_webcam_frames("alpha") == []
    assert redis.values["sb:seq:wc:alpha"] == 3
    assert media.latest_webcam_frame("beta") == other


def test_attachment_lifecycle_and_atomic_capture_request(monkeypatch) -> None:
    redis = FakeRedis()
    monkeypatch.setattr(media.client, "sync_client", lambda: redis)

    upload = media.store_attachment(
        session_id="alpha", kind="image", name="a.png", content_type="image/png", data=b"png", source="upload"
    )
    capture = media.store_attachment(
        session_id="alpha", kind="image", name="c.jpg", content_type="image/jpeg", data=b"jpg", source="capture"
    )
    other = media.store_attachment(
        session_id="beta", kind="audio", name="b.wav", content_type="audio/wav", data=b"wav", source="upload"
    )

    assert media.all_attachments("alpha") == [upload, capture]
    assert media.all_attachments("beta") == [other]
    media.remove_attachment("alpha", upload.id)
    assert media.all_attachments("alpha") == [capture]

    request = media.create_capture_request("alpha")
    assert not media.consume_capture_request("alpha", "wrong-request")
    assert media.consume_capture_request("alpha", request)
    assert not media.consume_capture_request("alpha", request)

    media.clear_attachments("alpha")
    assert media.all_attachments("alpha") == []
    assert media.all_attachments("beta") == [other]


def test_listener_survives_idle_timeout_and_transient_failure(monkeypatch) -> None:
    class FakeAsyncRedis:
        def __init__(self) -> None:
            self.calls = 0

        async def xread(self, streams, *, block):
            assert block == media.BLOCK_MS
            self.calls += 1
            if self.calls == 1:
                assert streams == {"sb:wc:alpha": "0"}
                raise media.RedisTimeoutError("normal idle boundary")
            if self.calls == 2:
                assert streams == {"sb:wc:alpha": "0"}
                raise OSError("temporary connection reset")
            if self.calls == 3:
                assert streams == {"sb:wc:alpha": "0"}
                return [(b"sb:wc:alpha", [(b"1-0", {})])]
            assert streams == {"sb:wc:alpha": b"1-0"}
            await asyncio.Event().wait()

    async def scenario() -> None:
        redis = FakeAsyncRedis()
        notified = asyncio.Event()
        monkeypatch.setattr(media.client, "async_client", lambda: redis)
        monkeypatch.setattr(media, "LISTENER_RETRY_DELAY_SECS", 0)
        monkeypatch.setattr(media, "LISTENER_RETRY_MAX_SECS", 0)

        task = asyncio.create_task(media._listen("sb:wc:alpha", notified.set))
        await asyncio.wait_for(notified.wait(), timeout=1)
        task.cancel()
        await task

        assert redis.calls >= 3

    asyncio.run(scenario())


def test_listener_survives_callback_failure(monkeypatch) -> None:
    class FakeAsyncRedis:
        def __init__(self) -> None:
            self.calls = 0

        async def xread(self, streams, *, block):
            del streams, block
            self.calls += 1
            if self.calls == 1:
                return [(b"sb:wc:alpha", [(b"1-0", {})])]
            if self.calls == 2:
                return [(b"sb:wc:alpha", [(b"2-0", {})])]
            await asyncio.Event().wait()

    async def scenario() -> None:
        redis = FakeAsyncRedis()
        notified = asyncio.Event()
        callback_calls = 0
        monkeypatch.setattr(media.client, "async_client", lambda: redis)

        def callback() -> None:
            nonlocal callback_calls
            callback_calls += 1
            if callback_calls == 1:
                raise RuntimeError("consumer temporarily unavailable")
            notified.set()

        task = asyncio.create_task(media._listen("sb:wc:alpha", callback))
        await asyncio.wait_for(notified.wait(), timeout=1)
        task.cancel()
        await task

        assert callback_calls == 2

    asyncio.run(scenario())
