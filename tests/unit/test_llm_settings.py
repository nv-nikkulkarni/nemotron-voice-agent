# SPDX-License-Identifier: Apache-2.0
"""Sampling validation, session isolation, and actual model request boundaries."""

# ruff: noqa: D101, D102, D103, D107
import asyncio
from functools import wraps
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.services.nvidia.llm import NvidiaLLMSettings

import llm_settings as state
import server
from examples.frontend_backend_agent.src.stage_metrics import _open_out_of_band_stream
from examples.omni_assistant.nvidia_omni_multimodal_service import NvidiaOmniSettings
from examples.shared.sampling_llm import SamplingNvidiaLLMService, SamplingOmniLLMService

GENERIC = "generic-frontend-backend-agent"
OMNI = "omni-assistant-subagents"
SID = "abc012def345"


def _async_test(function):
    @wraps(function)
    def run(*args, **kwargs):
        return asyncio.run(function(*args, **kwargs))

    return run


@pytest.fixture(autouse=True)
def isolated_state(monkeypatch):
    monkeypatch.setenv("NVIDIA_API_KEY", "unit-test")
    monkeypatch.setattr(state.client, "is_enabled", lambda: False)
    state._local.clear()
    state._local_expiry.clear()
    yield
    state._local.clear()
    state._local_expiry.clear()


def config(mode=GENERIC, settings=None):
    return server._sanitize_session_config({"pipeline_mode": mode, "llm_settings": settings or {}})


@pytest.mark.parametrize(
    "value",
    [
        None,
        [],
        {"speaker": {}},
        {"frontend": None},
        {"frontend": {"model": 1}},
        {"frontend": {"temperature": True}},
        {"frontend": {"temperature": float("nan")}},
        {"frontend": {"temperature": float("inf")}},
        {"frontend": {"temperature": 10**1000}},
        {"frontend": {"temperature": "0.5"}},
        {"frontend": {"temperature": -0.1}},
        {"frontend": {"temperature": 2.1}},
        {"backend": {"top_p": 0}},
        {"backend": {"top_p": 1.1}},
        {"backend": {"top_k": 0}},
        {"backend": {"top_k": -2}},
        {"backend": {"top_k": 1.5}},
        {"backend": {"max_tokens": 63}},
        {"backend": {"max_tokens": 32769}},
        {"backend": {"max_tokens": 1024.1}},
        {"backend": {"frequency_penalty": 3}},
        {"backend": {"repetition_penalty": 0}},
    ],
)
def test_rejects_invalid_sampling(value):
    with pytest.raises(ValueError):
        state.validate_settings(value, GENERIC)


def test_sanitizer_preserves_role_settings_and_deployed_defaults():
    settings = {"frontend": {"temperature": 0, "top_p": 0.8}, "backend": {"max_tokens": 1024}}
    cfg = config(settings=settings)
    assert cfg["llm_settings"] == settings
    specs = {role["key"]: role for role in state.role_specs(cfg)}
    assert specs["frontend"]["defaults"]["temperature"] == 0
    assert specs["frontend"]["defaults"]["max_tokens"] == 512
    assert specs["backend"]["defaults"]["max_tokens"] == 2048
    assert state.role_specs(config(OMNI))[0]["defaults"]["top_k"] == 1
    with pytest.raises(ValueError):
        config(OMNI, {"frontend": {"temperature": 0.5}})


def test_atomic_revision_isolation_reset_and_teardown():
    state.initialize(SID, config())
    state.initialize("abc012def346", config())
    first = state.replace(SID, {"frontend": {"temperature": 1}}, 0)
    first["settings"]["frontend"]["temperature"] = 2
    assert state.read(SID)["settings"]["frontend"]["temperature"] == 1
    assert state.read("abc012def346")["settings"] == {}
    with pytest.raises(state.SettingsConflict):
        state.replace(SID, {}, 0)
    assert state.replace(SID, {}, 1)["settings"] == {}
    state.close(SID)
    assert state.read(SID) is None
    with pytest.raises(LookupError):
        state.replace(SID, {}, 2)


def test_live_api_validation_and_revision(monkeypatch):
    state.initialize(SID, config())
    client = TestClient(server.create_app())
    defaults = client.get("/api/llm-settings", params={"pipeline_mode": GENERIC}).json()
    assert [role["key"] for role in defaults["roles"]] == ["frontend", "backend"]
    assert not any("base_url" in role for role in defaults["roles"])
    url = f"/api/sessions/{SID}/llm-settings"
    assert client.get(url).json()["revision"] == 0
    response = client.put(url, json={"settings": {"backend": {"temperature": 0.4, "max_tokens": 1500}}, "revision": 0})
    assert response.status_code == 200
    assert response.json()["revision"] == 1
    assert client.put(url, json={"settings": {}, "revision": 0}).status_code == 409
    for payload in [
        {"settings": {}, "revision": True},
        {"settings": {"backend": {"top_k": 0}}, "revision": 1},
        {"settings": {}, "revision": 1, "base_url": "https://bad.example"},
    ]:
        assert client.put(url, json=payload).status_code == 400
    assert client.put(url, content=b"x" * 16385).status_code == 400
    state.close(SID)
    assert client.get(url).status_code == 404
    assert client.put(url, json={"settings": {}, "revision": 1}).status_code == 404


def service(role, omni=False, initial=None):
    cls = SamplingOmniLLMService if omni else SamplingNvidiaLLMService
    settings_cls = NvidiaOmniSettings if omni else NvidiaLLMSettings
    return cls(
        api_key="unit-test",
        base_url="http://test.invalid/v1",
        settings=settings_cls(
            model="test-model",
            max_tokens=2048,
            temperature=0.0,
            extra={
                "extra_body": {"top_k": 1, "chat_template_kwargs": {"enable_thinking": True}, "reasoning_budget": 256}
            },
        ),
        sampling_session_id=SID,
        sampling_role=role,
        sampling_initial=initial,
    )


@_async_test
async def test_streamed_planner_applies_live_backend_values_and_reset():
    initial = {"max_tokens": 3000}
    state.initialize(SID, config(settings={"backend": initial}))
    llm = service("backend", initial=initial)
    mock = AsyncMock(return_value=object())
    llm._client.chat.completions.create = mock
    context = LLMContext([{"role": "user", "content": "Plan a task"}])
    state.replace(
        SID,
        {"backend": {"temperature": 0.45, "top_p": 0.8, "max_tokens": 128, "top_k": -1, "repetition_penalty": 1.1}},
        0,
    )
    await _open_out_of_band_stream(llm, context, max_tokens=None)
    params = mock.call_args.kwargs
    assert params["temperature"] == 0.45 and params["top_p"] == 0.8 and params["max_tokens"] == 128
    assert "max_completion_tokens" not in params
    assert params["extra_body"]["reasoning_budget"] == 127
    assert params["extra_body"]["top_k"] == -1
    assert params["extra_body"]["chat_template_kwargs"] == {"enable_thinking": True}
    state.replace(SID, {}, 1)
    await _open_out_of_band_stream(llm, context, max_tokens=None)
    assert mock.call_args.kwargs["max_tokens"] == 2048
    assert llm._settings.temperature == 0


@_async_test
async def test_inflight_request_keeps_snapshot_while_future_request_changes():
    state.initialize(SID, config())
    llm = service("frontend")
    entered, finish = asyncio.Event(), asyncio.Event()
    requests = []

    async def create(**kwargs):
        requests.append(kwargs)
        entered.set()
        await finish.wait()
        return object()

    llm._client.chat.completions.create = create
    context = LLMContext([{"role": "user", "content": "Hello"}])
    state.replace(SID, {"frontend": {"temperature": 0.2}}, 0)
    task = asyncio.create_task(llm.get_chat_completions(context))
    await entered.wait()
    state.replace(SID, {"frontend": {"temperature": 0.8}}, 1)
    assert requests[0]["temperature"] == 0.2
    finish.set()
    await task
    await llm.get_chat_completions(context)
    assert requests[1]["temperature"] == 0.8
    assert llm._settings.temperature == 0


@_async_test
@pytest.mark.parametrize("role", ["speaker", "thinker", "media", "webcam"])
async def test_all_omni_roles_use_live_sampling_for_worker_requests(role):
    state.initialize(SID, config(OMNI))
    llm = service(role, omni=True)
    completion = SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content="Result", reasoning_content=""), finish_reason="stop")]
    )
    mock = AsyncMock(return_value=completion)
    llm._client.chat.completions.create = mock
    state.replace(SID, {role: {"temperature": 0.35, "top_p": 0.75, "max_tokens": 128, "top_k": -1}}, 0)
    context = LLMContext([{"role": "user", "content": "Analyze this"}])
    await llm.run_multimodal_inference(context, max_tokens=8192, temperature=0.0, reasoning_budget=4096)
    params = mock.call_args.kwargs
    assert params["max_tokens"] == 128 and params["temperature"] == 0.35 and params["top_p"] == 0.75
    assert params["extra_body"]["reasoning_budget"] == 127
    assert params["extra_body"]["top_k"] == -1


def test_redis_snapshot_is_shared_and_stale_updates_are_rejected(monkeypatch):
    import json

    from redis.exceptions import WatchError

    class PipelineFake:
        def __init__(self, redis):
            self.redis = redis
            self.commands = []

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def watch(self, key):
            pass

        def get(self, key):
            return self.redis.get(key)

        def multi(self):
            pass

        def set(self, key, value, *, ex):
            self.commands.append((key, value, ex))

        def execute(self):
            if self.redis.conflict:
                raise WatchError()
            for key, value, ex in self.commands:
                self.redis.set(key, value, ex=ex)

    class RedisFake:
        def __init__(self):
            self.values = {}
            self.expirations = []
            self.conflict = False

        def set(self, key, value, *, ex, nx=False):
            self.expirations.append(ex)
            if not nx or key not in self.values:
                self.values[key] = value

        def get(self, key):
            return self.values.get(key)

        def delete(self, key):
            self.values.pop(key, None)

        def pipeline(self):
            return PipelineFake(self)

    redis = RedisFake()
    monkeypatch.setattr(state.client, "is_enabled", lambda: True)
    monkeypatch.setattr(state.client, "sync_client", lambda: redis)
    state.initialize(SID, config())
    state.initialize(SID, config(settings={"frontend": {"temperature": 2}}))
    state._local.clear()
    state._local_expiry.clear()
    assert state.read(SID)["settings"] == {}
    assert state.replace(SID, {"backend": {"temperature": 0.3}}, 0)["revision"] == 1
    assert json.loads(redis.values[f"sb:llm:{SID}"])["settings"]["backend"]["temperature"] == 0.3
    with pytest.raises(state.SettingsConflict):
        state.replace(SID, {}, 0)
    redis.conflict = True
    with pytest.raises(state.SettingsConflict):
        state.replace(SID, {}, 1)
    assert state.read(SID)["revision"] == 1
    assert state.read(SID)["settings"] == {"backend": {"temperature": 0.3}}
    assert all(ttl == state.client.TTL for ttl in redis.expirations)
    state.close(SID)
    assert state.read(SID) is None


def test_local_pending_session_expires_without_connecting(monkeypatch):
    now = [0.0]
    monkeypatch.setattr(state.time, "monotonic", lambda: now[0])
    state.initialize(SID, config())
    assert state.read(SID)
    now[0] = state.client.TTL + 1
    assert state.read(SID) is None
    with pytest.raises(LookupError):
        state.replace(SID, {}, 0)


@_async_test
async def test_speaker_audio_correction_uses_current_values_and_bounded_retry_budget():
    state.initialize(SID, config(OMNI))
    llm = service("speaker", omni=True)
    llm._active_turn_parts = [{"type": "input_audio", "input_audio": {"data": "AAAA", "format": "wav"}}]
    completion = SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="Result"))])
    mock = AsyncMock(return_value=completion)
    llm._client.chat.completions.create = mock
    state.replace(SID, {"speaker": {"temperature": 0.25, "max_tokens": 128}}, 0)
    await llm.retry_active_audio_inference(
        LLMContext([{"role": "user", "content": "Hello"}]),
        correction_instruction="Retry the transcript",
        max_tokens=2048,
    )
    assert mock.call_args.kwargs["temperature"] == 0.25
    assert mock.call_args.kwargs["max_tokens"] == 128
