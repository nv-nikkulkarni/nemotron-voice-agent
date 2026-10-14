# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause

# ruff: noqa: D101, D102, D103, D107

"""Connection and cold-start retry tests for the Redis session bus."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from session_bus import client


@pytest.fixture(autouse=True)
def reset_clients(monkeypatch):
    monkeypatch.setattr(client, "_sync", None)
    monkeypatch.setattr(client, "_async", None)
    monkeypatch.setattr(client, "REDIS_URL", "redis://redis:6379/0")
    monkeypatch.setattr(client, "BUS_INIT_RETRY_DELAY_SECS", 0)
    yield
    client._sync = None
    client._async = None


def test_init_retries_cold_start_then_enables_bus(monkeypatch) -> None:
    attempts = 0

    class SyncRedis:
        def ping(self) -> None:
            nonlocal attempts
            attempts += 1
            if attempts < 3:
                raise ConnectionError("redis is still starting")

    sync_instances: list[SyncRedis] = []

    def sync_from_url(*_args, **_kwargs):
        instance = SyncRedis()
        sync_instances.append(instance)
        return instance

    async_instance = SimpleNamespace()
    monkeypatch.setattr(client, "redis", SimpleNamespace(Redis=SimpleNamespace(from_url=sync_from_url)))
    monkeypatch.setattr(
        client, "aredis", SimpleNamespace(Redis=SimpleNamespace(from_url=lambda *_args, **_kwargs: async_instance))
    )
    monkeypatch.setattr(client, "BUS_INIT_RETRY_TIMEOUT_SECS", 5)
    monkeypatch.setattr(client.time, "sleep", lambda _seconds: None)

    client.init_from_env()

    assert attempts == 3
    assert client.sync_client() is sync_instances[-1]
    assert client.async_client() is async_instance
    assert client.is_enabled()


def test_init_gives_up_cleanly_when_deadline_is_zero(monkeypatch) -> None:
    class UnavailableRedis:
        def ping(self) -> None:
            raise ConnectionError("unavailable")

    monkeypatch.setattr(
        client,
        "redis",
        SimpleNamespace(Redis=SimpleNamespace(from_url=lambda *_args, **_kwargs: UnavailableRedis())),
    )
    monkeypatch.setattr(
        client, "aredis", SimpleNamespace(Redis=SimpleNamespace(from_url=lambda *_args, **_kwargs: SimpleNamespace()))
    )
    monkeypatch.setattr(client, "BUS_INIT_RETRY_TIMEOUT_SECS", 0)

    client.init_from_env()

    assert not client.is_enabled()
    assert client.async_client() is None
