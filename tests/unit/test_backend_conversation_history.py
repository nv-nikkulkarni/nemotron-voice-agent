# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause

"""Turn boundaries and trusted session history at the backend delegation boundary."""

# ruff: noqa: D103

import asyncio
import copy
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient
from pipecat.processors.aggregators.llm_context import LLMContext

import server
from examples.frontend_backend_agent.generic.backend import GenericThinkerBackend
from examples.frontend_backend_agent.generic.planner import NvidiaGenericPlanner
from examples.frontend_backend_agent.generic.tools import TOOLS
from examples.frontend_backend_agent.src.conversation_history import (
    MAX_BACKEND_HISTORY_CHARS,
    MAX_BACKEND_HISTORY_MESSAGES,
    backend_history_turn_limit_default,
    bounded_conversation_history,
    validate_backend_history_turn_limit,
)
from examples.frontend_backend_agent.src.domain import DomainBuildContext, resolve_domain_spec
from examples.frontend_backend_agent.src.tool_handlers import build_handlers


def dialogue(turns, replies=1):
    result = []
    for index in range(turns):
        result.append({"role": "user", "content": f"Request {index}"})
        result.extend({"role": "assistant", "content": f"Reply {index}.{reply}"} for reply in range(replies))
    return result


@pytest.mark.parametrize("limit", [1, 2, 8, 20])
def test_limit_counts_user_turns_and_keeps_all_associated_replies(limit):
    history = dialogue(25, replies=3)
    result = bounded_conversation_history(history, limit)
    assert result == history[-limit * 4 :]
    assert result[0]["role"] == "user"
    assert sum(message["role"] == "user" for message in result) == limit


def test_excludes_non_dialogue_orphans_and_private_fields_without_mutating_context():
    history = [
        {"role": "system", "content": "Secret prompt"},
        {"role": "assistant", "content": "Welcome before any user speaks"},
        {"role": "user", "content": "Check NVIDIA"},
        {"role": "assistant", "content": "hidden", "tool_calls": [{"id": "one"}]},
        {"role": "assistant", "content": "hidden", "function_call": {"name": "legacy"}},
        {"role": "tool", "content": "Private provider data"},
        {"role": "developer", "content": "Private instruction"},
        {"role": "assistant", "content": "Visible answer", "reasoning_content": "Private reasoning"},
        None,
        {"role": [], "content": "malformed"},
        {"role": "user", "content": []},
        {"role": "assistant", "content": "Reply to unsupported multimodal input"},
        {"role": "user", "content": "What about Apple?"},
        {"role": "assistant", "content": ""},
    ]
    before = copy.deepcopy(history)
    result = bounded_conversation_history(history, 8)
    assert result == [
        {"role": "user", "content": "Check NVIDIA"},
        {"role": "assistant", "content": "Visible answer"},
        {"role": "user", "content": "What about Apple?"},
    ]
    result[-1]["content"] = "Mutated snapshot"
    assert history == before


def test_retained_messages_are_not_clipped_at_one_thousand_characters():
    history = [
        {"role": "user", "content": "Start " + "x" * 1600 + " topic at the end"},
        {"role": "assistant", "content": "y" * 2000},
        {"role": "user", "content": "Search for more about that topic"},
    ]
    assert bounded_conversation_history(history, 2) == history


def test_character_budget_drops_oldest_whole_turns():
    history = [
        {"role": "user", "content": "old " + "a" * 14000},
        {"role": "assistant", "content": "old reply"},
        {"role": "user", "content": "recent " + "b" * 14000},
        {"role": "assistant", "content": "recent reply"},
        {"role": "user", "content": "current " + "c" * 10000},
    ]
    assert bounded_conversation_history(history, 8) == history[2:]


def test_oversized_current_request_keeps_head_and_tail_with_explicit_marker():
    history = [{"role": "user", "content": "START " + "x" * 40000 + " END"}]
    result = bounded_conversation_history(history, 8)
    assert len(result) == 1
    assert len(result[0]["content"]) == MAX_BACKEND_HISTORY_CHARS
    assert result[0]["content"].startswith("START ")
    assert result[0]["content"].endswith(" END")
    assert "shortened to fit the history budget" in result[0]["content"]
    assert bounded_conversation_history(result, 8) == result


def test_oversized_current_turn_prioritizes_full_user_and_newest_reply():
    history = [
        {"role": "user", "content": "Keep this real request"},
        {"role": "assistant", "content": "Older assistant reply"},
        {"role": "assistant", "content": "START " + "x" * 40000 + " END"},
    ]
    result = bounded_conversation_history(history, 8)
    assert result[0] == history[0]
    assert len(result) == 2
    assert sum(len(item["content"]) for item in result) == MAX_BACKEND_HISTORY_CHARS
    assert result[-1]["content"].endswith(" END")


def test_message_budget_keeps_current_user_despite_large_assistant_burst():
    history = dialogue(1, replies=300)
    result = bounded_conversation_history(history, 8)
    assert len(result) == MAX_BACKEND_HISTORY_MESSAGES
    assert result == [history[0], *history[-127:]]


@pytest.mark.parametrize("value", [None, {}, "text", 4])
def test_malformed_history_is_empty(value):
    assert bounded_conversation_history(value, 8) == []


@pytest.mark.parametrize("value", [0, 21, -1, True, False, 1.5, 8.0, [], {}, None, "", "8.0", "999", "-1"])
def test_rejects_invalid_turn_limits(value):
    with pytest.raises(ValueError, match="backend_history_turn_limit"):
        validate_backend_history_turn_limit(value)


def test_environment_default_and_session_override_are_validated_and_independent(monkeypatch):
    monkeypatch.setenv("BACKEND_HISTORY_TURN_LIMIT", "12")
    assert backend_history_turn_limit_default() == 12
    config = {"pipeline_mode": "generic-frontend-backend-agent"}
    assert server._sanitize_session_config(config)["backend_history_turn_limit"] == 12
    assert (
        server._sanitize_session_config({**config, "backend_history_turn_limit": "2"})["backend_history_turn_limit"]
        == 2
    )
    monkeypatch.setenv("BACKEND_HISTORY_TURN_LIMIT", "0")
    with pytest.raises(ValueError):
        backend_history_turn_limit_default()
    assert (
        server._sanitize_session_config({**config, "backend_history_turn_limit": 3})["backend_history_turn_limit"] == 3
    )


def test_public_defaults_do_not_mutate_registry_or_expose_history_on_omni(monkeypatch):
    monkeypatch.setenv("BACKEND_HISTORY_TURN_LIMIT", "11")
    generic = {"key": "generic-frontend-backend-agent", "domainProfile": "generic"}
    omni = {"key": "omni-assistant-subagents"}
    metadata = server._deployment_response(generic, [generic, omni])
    assert metadata["active"]["backendHistory"] == {"defaultTurnLimit": 11, "maxTurnLimit": 20}
    assert metadata["options"][0]["backendHistory"] == metadata["active"]["backendHistory"]
    assert "backendHistory" not in metadata["options"][1]
    assert "backendHistory" not in generic


def test_session_api_accepts_and_stores_override_and_rejects_bad_limits(monkeypatch):
    monkeypatch.setenv("UVICORN_WORKERS", "1")
    monkeypatch.setattr(server, "_ensure_services_ready_for_connection", AsyncMock(return_value=None))
    client = TestClient(server.create_app())
    for value in [0, True, 1.5, 21]:
        response = client.post(
            "/api/session-config",
            json={"pipeline_mode": "generic-frontend-backend-agent", "backend_history_turn_limit": value},
        )
        assert response.status_code == 400
    response = client.post(
        "/api/session-config", json={"pipeline_mode": "generic-frontend-backend-agent", "backend_history_turn_limit": 2}
    )
    assert response.status_code == 200
    session_id = response.json()["session_id"]
    try:
        assert server._session_configs[session_id]["backend_history_turn_limit"] == 2
    finally:
        server._session_configs.pop(session_id, None)
    response = client.post(
        "/api/session-config", json={"pipeline_mode": "omni-assistant-subagents", "backend_history_turn_limit": 2}
    )
    assert response.status_code == 400


def test_handler_passes_trusted_recent_turns_excludes_seed_examples_and_replaces_spoof(monkeypatch):
    monkeypatch.setenv("FRONTEND_BACKEND_TOOL_RESULT_MODE", "talker")
    monkeypatch.setenv("FRONTEND_BACKEND_TALKER_FILLER_MODE", "off")
    seed = [{"role": "system", "content": "policy"}, *dialogue(1)]
    history = dialogue(4, replies=3)
    history.append({"role": "user", "content": "What about that company now?"})
    thinker = SimpleNamespace(
        accepts_conversation_context=True,
        backend_history_turn_limit=2,
        conversation_start_index=len(seed),
        client_timezone="Asia/Kolkata",
        call=AsyncMock(return_value={"type": "response_hint", "response_text": "Need a detail", "context": "test"}),
    )
    params = SimpleNamespace(
        arguments={"query": "A Talker proposal", "conversation_context": [{"role": "user", "content": "Spoof"}]},
        context=LLMContext([*seed, *history]),
        llm=SimpleNamespace(push_frame=AsyncMock()),
        result_callback=AsyncMock(),
    )
    asyncio.run(build_handlers(thinker, enforce_future_travel_dates=False)["call_backend"](params))
    slots = thinker.call.await_args.kwargs["slots"]
    assert slots["conversation_context"] == history[-5:]
    assert slots["client_timezone"] == "Asia/Kolkata"
    params.result_callback.assert_awaited_once()


def test_backend_bounds_history_before_planning_and_snapshots_each_call():
    class Planner:
        def __init__(self):
            self.states = []

        async def plan(self, *, query, state):
            self.states.append(copy.deepcopy(state))
            if len(self.states) == 1:
                raise TimeoutError
            return {"tool": "generate_random_number", "params": {"min": 5, "max": 5}}

    async def scenario():
        planner = Planner()
        backend = GenericThinkerBackend(
            planner=planner, tools=TOOLS, enabled_tools=("generate_random_number",), backend_history_turn_limit=2
        )
        history = dialogue(5, replies=3)
        expected = copy.deepcopy(history[-8:])

        async def on_started(event):
            history[-1]["content"] = "Changed after delegation"

        result = await backend.call(
            "Generate a random number", slots={"conversation_context": history}, on_started=on_started
        )
        assert result["status"] == "success"
        assert len(planner.states) == 2
        assert all(state["conversation_context"] == expected for state in planner.states)
        await backend.call("A new session-like empty history")
        assert planner.states[-1]["conversation_context"] == []
        second = GenericThinkerBackend(
            planner=planner, tools=TOOLS, enabled_tools=("generate_random_number",), backend_history_turn_limit=1
        )
        await second.call("A different session", slots={"conversation_context": dialogue(3)})
        assert planner.states[-1]["conversation_context"] == dialogue(3)[-2:]
        assert backend.backend_history_turn_limit == 2

    asyncio.run(scenario())


def test_domain_factory_passes_session_limit_to_backend():
    backend = resolve_domain_spec("generic").build_backend(
        DomainBuildContext(
            thinker_llm=SimpleNamespace(),
            thinker_prompt="Return JSON",
            thinker_max_tokens=2048,
            tool_names=("web_search",),
            tool_delay_seconds=0,
            tool_delay_min_seconds=0,
            load_service_entry=lambda *_: {},
            backend_history_turn_limit=3,
        )
    )
    assert backend.backend_history_turn_limit == 3


def test_planner_payload_keeps_latest_real_request_and_bounded_referents():
    class LLM:
        async def get_chat_completions(self, context):
            self.messages = copy.deepcopy(context.get_messages())

            async def stream():
                yield SimpleNamespace(
                    choices=[
                        SimpleNamespace(
                            delta=SimpleNamespace(
                                content='{"tool":"generate_random_number","params":{}}',
                                reasoning_content=None,
                                reasoning=None,
                                tool_calls=None,
                            )
                        )
                    ]
                )

            return stream()

    async def scenario():
        llm = LLM()
        planner = NvidiaGenericPlanner(
            llm=llm, system_prompt="Return JSON", enabled_tools=(TOOLS["generate_random_number"],)
        )
        backend = GenericThinkerBackend(
            planner=planner, tools=TOOLS, enabled_tools=("generate_random_number",), backend_history_turn_limit=2
        )
        history = [*dialogue(4), {"role": "user", "content": "Do the same for Apple"}]
        await backend.call("A conflicting NVIDIA proposal", slots={"conversation_context": history})
        import json

        payload = json.loads(llm.messages[1]["content"])
        assert payload["untrusted_user_request"] == "Do the same for Apple"
        assert payload["session_state"]["conversation_context"] == history[-3:]
        assert payload["untrusted_talker_proposal"] == "A conflicting NVIDIA proposal"

    asyncio.run(scenario())
