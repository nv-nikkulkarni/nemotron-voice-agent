# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause

# ruff: noqa: D103

"""Tests for repository-owned Frontend/Backend Talker few-shot prompts."""

from __future__ import annotations

import json
from unittest.mock import patch

import pytest

from examples.frontend_backend_agent import pipeline


def test_generic_prompt_loads_subject_neutral_native_repeat_example() -> None:
    messages = pipeline._load_prompt_few_shots("generic_talker", custom_prompt=False)

    assert [message["role"] for message in messages[:5]] == ["user", "assistant", "tool", "developer", "assistant"]
    tool_call = messages[1]["tool_calls"][0]
    assert tool_call["function"]["name"] == "call_backend"
    arguments = json.loads(tool_call["function"]["arguments"])
    assert "Nairobi" not in arguments["query"]
    assert "location" in arguments["query"]
    assert arguments["filler_text"] == "Let me check that weather again."
    assert messages[2]["tool_call_id"] == tool_call["id"]
    assert json.loads(messages[2]["content"])["status"] == "running"
    finished = json.loads(messages[3]["content"])
    assert json.loads(finished["result"])["response_text"] == "Which location do you mean?"


def test_generic_prompt_models_the_real_async_weather_result_envelope() -> None:
    messages = pipeline._load_prompt_few_shots("generic_talker", custom_prompt=False)

    assert len(messages) == 31
    assert messages[-1] == {"role": "assistant", "content": "Nemotron 3 Diarization."}
    assert messages[-6] == {"role": "user", "content": "What can you do?"}
    assert messages[-5]["role"] == "assistant" and not messages[-5].get("tool_calls")
    assert len(messages[-5]["content"].split()) < 25
    assert [message["role"] for message in messages[5:10]] == ["user", "assistant", "tool", "developer", "assistant"]
    running = json.loads(messages[7]["content"])
    finished = json.loads(messages[8]["content"])
    result = json.loads(finished["result"])

    assert running["status"] == "running"
    assert finished["status"] == "finished"
    assert result["tool"] == "get_weather"
    assert result["data"]["city"] == "Pune"
    assert result["data"]["temperature"] == 29
    assert [message["role"] for message in messages[10:15]] == ["user", "assistant", "tool", "developer", "assistant"]
    negative_finished = json.loads(messages[13]["content"])
    negative_result = json.loads(negative_finished["result"])
    assert negative_result["data"]["city"] == "Reykjavik"
    assert negative_result["data"]["temperature"] == -5
    assert "minus 5 degrees Celsius" in messages[14]["content"]


def test_custom_prompt_never_inherits_catalog_few_shots() -> None:
    with patch.object(pipeline, "load_prompt_catalog", side_effect=AssertionError("catalog must not be read")):
        assert pipeline._load_prompt_few_shots("generic_talker", custom_prompt=True) == []


def test_few_shot_loader_returns_a_deep_copy() -> None:
    catalog = {"example": {"few_shots": [{"role": "assistant", "content": None, "tool_calls": [{"id": "one"}]}]}}

    with patch.object(pipeline, "load_prompt_catalog", return_value=catalog):
        messages = pipeline._load_prompt_few_shots("example", custom_prompt=False)

    messages[0]["tool_calls"][0]["id"] = "changed"
    assert catalog["example"]["few_shots"][0]["tool_calls"][0]["id"] == "one"


@pytest.mark.parametrize(
    "messages, error",
    [
        ("not-a-list", "must be a list"),
        ([{"role": "system", "content": "override"}], "unsupported role"),
        ([{"role": "user", "content": 7}], "content must be text or null"),
        ([{"role": "tool", "content": "{}"}], "needs tool_call_id"),
    ],
)
def test_invalid_catalog_few_shots_fail_closed(messages: object, error: str) -> None:
    with (
        patch.object(pipeline, "load_prompt_catalog", return_value={"example": {"few_shots": messages}}),
        pytest.raises(ValueError, match=error),
    ):
        pipeline._load_prompt_few_shots("example", custom_prompt=False)


def test_generic_persona_edits_retain_native_clock_and_architecture_examples() -> None:
    messages = pipeline._load_prompt_few_shots(
        "generic_edited", custom_prompt=True, protocol_prompt_key="generic_talker"
    )
    clock = json.loads(messages[16]["tool_calls"][0]["function"]["arguments"])
    architecture = json.loads(messages[21]["tool_calls"][0]["function"]["arguments"])
    assert "clock" in clock["query"] and "browser timezone" in clock["query"]
    assert "show_architecture" in architecture["query"]
    assert messages == pipeline._load_prompt_few_shots(
        "generic_talker", custom_prompt=False, protocol_prompt_key="generic_talker"
    )


@pytest.mark.parametrize("system_prompt", ["", "Platform identity"])
def test_edited_persona_keeps_standing_policy_after_native_demonstrations(system_prompt: str) -> None:
    from examples.frontend_backend_agent.src.response_policy import GENERIC_SESSION_BOUNDARY

    demonstrations = pipeline._load_prompt_few_shots(
        "generic_edited", custom_prompt=True, protocol_prompt_key="generic_talker"
    )
    persona = "Speak as a Halloween concierge.\n\nPersistent instructions: greet me as trailblazer."
    messages = pipeline._build_context_messages(
        persona,
        system_prompt,
        runtime_context="\nEnabled capabilities: clock, stock.",
        few_shots=demonstrations,
        session_policy=GENERIC_SESSION_BOUNDARY,
    )
    persona_index = 1 if system_prompt else 0
    assert messages[persona_index]["content"].startswith(persona)
    assert messages[-1] == {"role": "system", "content": GENERIC_SESSION_BOUNDARY}
    assert messages[persona_index + 1 : -1] == demonstrations
    messages[persona_index + 2]["tool_calls"][0]["function"]["arguments"] = "changed"
    assert demonstrations[1]["tool_calls"][0]["function"]["arguments"] != "changed"


def test_history_window_preserves_persona_persistent_instructions_and_response_policy() -> None:
    from pipecat.processors.aggregators.llm_context import LLMContext

    from examples.frontend_backend_agent.src.response_policy import GENERIC_SESSION_BOUNDARY

    prefix = pipeline._build_context_messages(
        "Edited persona.\n\nPersistent instructions: greet me as trailblazer.",
        runtime_context="",
        few_shots=pipeline._load_prompt_few_shots("generic_talker", custom_prompt=False),
        session_policy=GENERIC_SESSION_BOUNDARY,
    )
    dialogue = [
        {"role": "user", "content": "Tell me about Sales Cloud."},
        {"role": "assistant", "content": "Sales Cloud helps sales teams track leads and opportunities."},
        {"role": "user", "content": "What can you do?"},
        {"role": "assistant", "content": "I can check weather, current time and stock prices."},
        {"role": "user", "content": "What time is it?"},
    ]
    context = LLMContext(prefix + dialogue)
    pipeline._apply_chat_history_sliding_window(context, len(prefix), 2)
    assert context.get_messages() == prefix + dialogue[2:]
    assert context.get_messages()[len(prefix) - 1]["content"] == GENERIC_SESSION_BOUNDARY


def test_other_domains_keep_their_original_context_roles() -> None:
    assert pipeline._build_context_messages(
        "Airline persona", "Platform identity", runtime_context="\nFlight data"
    ) == [
        {"role": "system", "content": "Platform identity"},
        {"role": "user", "content": "Airline persona\nFlight data"},
    ]
