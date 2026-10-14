# SPDX-License-Identifier: BSD-2-Clause
"""Regression coverage for demo prompt, speech, and follow-up failures."""

# ruff: noqa: D103
import asyncio
import base64
import io
import json
import wave
from dataclasses import replace
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import numpy as np
import pytest
from pipecat.processors.aggregators.llm_context import LLMContext

from examples.frontend_backend_agent.generic import services, speech
from examples.frontend_backend_agent.generic.backend import GenericThinkerBackend
from examples.frontend_backend_agent.generic.result_formatters import format_tool_result
from examples.frontend_backend_agent.generic.tools import TOOLS
from examples.frontend_backend_agent.pipeline import _apply_chat_history_sliding_window
from examples.shared.demo_speech import apply_approved_timing, validate_voice_sample
from examples.shared.nemotron_speech_text_filter import NemotronSpeechTextFilter


def sample(seconds=5, *, channels=1, rate=22050, silent=False):
    data = io.BytesIO()
    with wave.open(data, "wb") as audio:
        audio.setnchannels(channels)
        audio.setsampwidth(2)
        audio.setframerate(rate)
        values = (
            np.zeros(int(rate * seconds * channels), dtype="<i2")
            if silent
            else np.full(int(rate * seconds * channels), 500, dtype="<i2")
        )
        audio.writeframes(values.tobytes())
    return base64.b64encode(data.getvalue()).decode()


def test_sample_validation_rejects_paths_bad_formats_durations_and_silence():
    assert validate_voice_sample(sample()).startswith(b"RIFF")
    for value in [
        "/etc/passwd",
        "a" * 1340001,
        sample(2),
        sample(11),
        sample(channels=2),
        sample(rate=16000),
        sample(silent=True),
    ]:
        with pytest.raises(ValueError):
            validate_voice_sample(value)


def test_pronunciation_edits_fresh_word_alignment_only():
    rate = 22050
    prefix = np.full(rate // 2, 600, dtype="<i2")
    word = (np.sin(np.arange(rate) * 2 * np.pi * 200 / rate) * 6000).astype("<i2")
    gap = np.zeros(rate // 5, dtype="<i2")
    suffix = np.full(rate // 2, 800, dtype="<i2")
    raw = np.concatenate((prefix, word, gap, suffix)).tobytes()
    timings = [
        SimpleNamespace(word="Nemotron", start_time=500, end_time=1500),
        SimpleNamespace(word="three", start_time=1700, end_time=2200),
    ]
    result = apply_approved_timing(raw, timings, rate)
    assert result.startswith(prefix.tobytes())
    assert result.endswith(suffix.tobytes())
    assert len(raw) - len(result) > int(rate * 0.30) * 2
    assert apply_approved_timing(raw, [SimpleNamespace(word="Nemotron", start_time=5000, end_time=6000)], rate) == raw
    assert apply_approved_timing(raw, [], rate) == raw


def test_markdown_cleanup_preserves_numbers_and_comparisons():
    text = "## **Weather**\n- It's -5.2 degrees. [Details](https://example.test). 3 < 4. <break/>"
    result = asyncio.run(NemotronSpeechTextFilter().filter(text))
    assert "Weather" in result and "-5.2" in result and "3 < 4" in result
    for marker in ["**", "##", "https://", "break", "- It's"]:
        assert marker not in result


def test_clock_iana_zone_and_dst_are_fresh():
    instant = datetime(2026, 7, 1, 12, 34, tzinfo=UTC)
    with patch.object(services, "datetime") as clock:
        clock.now.return_value = instant
        result = asyncio.run(services.get_current_time({"timezone": "America/New_York"}))
    assert result["time"] == "8:34 AM" and result["datetime"].endswith("-04:00")
    assert speech.current_time({}, result) == "It's 8:34 AM EDT."
    with patch.object(services, "datetime") as clock:
        clock.now.return_value = instant
        result = asyncio.run(services.get_current_time({"timezone": "Asia/Kathmandu"}))
    assert result["timezone"] == "Asia/Kathmandu"
    assert speech.current_time({}, result) == "It's 6:19 PM UTC plus 5 hours and 45 minutes."
    assert asyncio.run(services.get_current_time({"timezone": "Invalid/zone"}))["status"] == "not_found"


def test_followup_keeps_user_referents_and_fetches_again():
    class Planner:
        def __init__(self):
            self.states = []

        async def plan(self, *, query, state):
            self.states.append(state)
            return {"tool": "get_stock_price", "params": {"company_name": "NVIDIA"}}

    async def scenario():
        planner = Planner()
        quote = AsyncMock(return_value={"status": "success", "company": "NVIDIA", "symbol": "NVDA", "price": 100})
        tools = {"get_stock_price": replace(TOOLS["get_stock_price"], run=quote)}
        backend = GenericThinkerBackend(planner=planner, enabled_tools=("get_stock_price",), tools=tools)
        history = [
            {"role": "user", "content": "What's NVIDIA's price?"},
            {"role": "assistant", "content": "A prior quote."},
        ]
        for _ in range(2):
            result = await backend.call("Check that company again", slots={"conversation_context": history})
            assert result["status"] == "success"
        assert quote.call_count == 2
        assert planner.states[0]["conversation_context"] == history
        assert planner.states[1]["prior_tool_results"] == []

    asyncio.run(scenario())


def test_history_window_keeps_whole_turn_with_tool_roles():
    messages = [{"role": "system", "content": "policy"}]
    for index in range(5):
        messages.extend(
            [
                {"role": "user", "content": str(index)},
                {"role": "assistant", "tool_calls": []},
                {"role": "tool", "content": str(index)},
                {"role": "assistant", "content": "done"},
            ]
        )
    context = LLMContext(messages)
    _apply_chat_history_sliding_window(context, 1, 2)
    result = context.get_messages()
    assert result[1] == {"role": "user", "content": "3"}
    assert len(result) == 9


def test_stock_retry_budget_fits_dispatcher_deadline():
    assert (
        services._FINNHUB_TIMEOUT.read * 4 + services._FINNHUB_RETRY_BACKOFF_SECONDS * 2
        < TOOLS["get_stock_price"].timeout_s
    )


def test_prompt_config_rejects_oversize_and_invalid_timezone():
    import server

    for config in [
        {"prompt_content": "a" * 32001},
        {"thinker_prompt_content": []},
        {"client_timezone": "Bad/zone"},
    ]:
        with pytest.raises(ValueError):
            server._sanitize_session_config({"pipeline_mode": "generic-frontend-backend-agent", **config})
    config = server._sanitize_session_config(
        {
            "pipeline_mode": "generic-frontend-backend-agent",
            "thinker_prompt_content": "Demo planner instructions",
            "persistent_prompt": "Halloween persona",
            "client_timezone": "Asia/Kolkata",
        }
    )
    assert config["thinker_prompt_content"] == "Demo planner instructions"
    assert config["persistent_prompt"] == "Halloween persona"
    assert config["client_timezone"] == "Asia/Kolkata"


def test_architecture_images_are_code_owned_and_allowlisted():
    from fastapi.testclient import TestClient

    import server

    client = TestClient(server.create_app())
    for name in ["generic", "omni"]:
        response = client.get(f"/api/architecture/{name}.svg")
        assert response.status_code == 200 and "image/svg+xml" in response.headers["content-type"]
        assert "<script" not in response.text and "https://" not in response.text
    assert client.get("/api/architecture/arbitrary.svg").status_code == 404


def test_clock_uses_session_timezone_without_model_supplied_argument():
    from examples.frontend_backend_agent.src.tools import ToolContext

    result = asyncio.run(
        TOOLS["get_current_time"].run({}, ToolContext(backend=SimpleNamespace(client_timezone="Asia/Kolkata")))
    )
    assert result["timezone"] == "Asia/Kolkata" and result["datetime"].endswith("+05:30")


def test_reference_voice_uses_zeroshot_model_voice_and_rejects_other_engines():
    from pipecat.services.nvidia.tts import NvidiaTTSSettings

    from examples.shared.demo_speech import DemoNvidiaTTSService

    voice_sample = validate_voice_sample(sample())
    service = DemoNvidiaTTSService(
        server="localhost:50051",
        use_ssl=False,
        model_function_map={"model_name": "magpie-tts-zeroshot"},
        settings=NvidiaTTSSettings(voice="Magpie-ZeroShot-Multilingual.EN-US.Female"),
        voice_sample=voice_sample,
    )
    assert service._settings.voice == "Magpie-ZeroShot-Multilingual"
    assert service._zero_shot_audio_prompt_data == voice_sample
    with pytest.raises(ValueError, match="Magpie Zero-shot"):
        DemoNvidiaTTSService(
            model_function_map={"model_name": "chatterbox-tts-multilingual"}, voice_sample=voice_sample
        )


def test_timezone_database_is_available_without_host_zoneinfo():
    import os
    import subprocess
    import sys

    subprocess.run(
        [
            sys.executable,
            "-c",
            "from zoneinfo import ZoneInfo; assert ZoneInfo('Asia/Calcutta'); assert ZoneInfo('America/New_York')",
        ],
        env={**os.environ, "PYTHONTZPATH": ""},
        check=True,
        capture_output=True,
    )


def test_generic_runtime_context_uses_browser_zone_and_requires_fresh_clock():
    from examples.frontend_backend_agent.generic.domain import _runtime_context

    context = _runtime_context("Asia/Calcutta")
    assert "local timezone is Asia/Calcutta" in context
    assert "Always obtain it through call_backend" in context


def test_search_default_is_one_complete_sentence_and_detail_is_explicit():
    first = "NVIDIA announced U.S. availability at 233.95 dollars on Sept. 28."
    second = "Another company also announced an update."
    data = {"status": "success", "answer": first + " " + second + " A third update follows."}
    brief = format_tool_result(TOOLS["web_search"], {"query": "one NVIDIA headline"}, data)
    detailed = format_tool_result(TOOLS["web_search"], {"query": "NVIDIA details", "details": True}, data)
    assert brief["response_text"] == first
    assert detailed["response_text"] == first + " " + second
    assert brief["data"]["result"] == data


@pytest.mark.parametrize("quote", ['"', "”", "’"])
def test_search_default_ends_after_a_quoted_headline(quote):
    first = f"NVIDIA announced “An update in the U.S.{quote}"
    data = {"status": "success", "answer": first + " Another headline follows."}
    result = format_tool_result(TOOLS["web_search"], {"query": "one headline"}, data)
    # A closing quote followed by a new capitalized sentence ends even U.S.
    assert result["response_text"] == first
    first = f"NVIDIA announced “A launch today.{quote}"
    data["answer"] = first + " Another headline follows."
    result = format_tool_result(TOOLS["web_search"], {"query": "one headline"}, data)
    assert result["response_text"] == first


def test_session_dialogue_evidence_excludes_examples_and_keeps_context_unchanged():
    from examples.frontend_backend_agent.src.reliable_talker import _session_dialogue_context

    messages = [{"role": "user", "content": "Example NVIDIA headline"}]
    messages += [{"role": "user", "content": "x" * 1500} for _ in range(10)]
    messages += [
        {"role": "assistant", "content": None, "tool_calls": [{"id": "one"}]},
        {"role": "tool", "content": "private raw tool data"},
        {"role": "user", "content": "What about Anthropic?"},
        {"role": "assistant", "content": "An Anthropic update."},
        {"role": "user", "content": "Another headline about that same company?"},
    ]
    original = LLMContext(messages, tools=[], tool_choice="auto")
    bounded = _session_dialogue_context(original, 1)
    reminder = next(
        item
        for item in bounded.get_messages()
        if str(item.get("content", "")).startswith("Current session dialogue evidence")
    )
    assert [item for item in bounded.get_messages() if item is not reminder] == messages
    assert bounded.get_messages()[-1] == messages[-1]
    assert original.get_messages() == messages
    assert reminder["role"] == "system" and "untrusted quoted JSON" in reminder["content"]
    from examples.frontend_backend_agent.src.response_policy import GENERIC_SPOKEN_RESPONSE_POLICY

    assert GENERIC_SPOKEN_RESPONSE_POLICY in reminder["content"]
    evidence = json.loads(reminder["content"].rsplit("\n", 1)[1])
    dialogue = evidence["recent_dialogue"]
    assert len(dialogue) == 8 and all(len(item["content"]) <= 1000 for item in dialogue)
    assert dialogue[-3]["content"] == "What about Anthropic?"
    assert evidence["latest_user_request"] == "Another headline about that same company?"
    assert "Example NVIDIA" not in str(evidence) and "private raw tool data" not in str(evidence)
    assert bounded.tools == original.tools and bounded.tool_choice == original.tool_choice


@pytest.mark.parametrize("async_result", [False, True])
def test_followup_evidence_preserves_all_native_protocol_history(async_result):
    from examples.frontend_backend_agent.src.reliable_talker import _session_dialogue_context

    prefix = [
        {"role": "assistant", "content": None, "tool_calls": [{"id": "example"}]},
        {"role": "tool", "tool_call_id": "example", "content": "demonstration"},
    ]
    result = json.dumps({"tool": "web_search", "status": "success", "response_text": "NVIDIA news."})
    settled = [{"role": "tool", "tool_call_id": "completed", "content": result}]
    if async_result:
        settled = [
            {
                "role": "tool",
                "tool_call_id": "completed",
                "content": json.dumps({"type": "async_tool", "status": "running", "tool_call_id": "completed"}),
            },
            {
                "role": "developer",
                "content": json.dumps(
                    {"type": "async_tool", "status": "finished", "tool_call_id": "completed", "result": result}
                ),
            },
        ]
    messages = prefix + [
        {"role": "user", "content": "NVIDIA news?"},
        {"role": "assistant", "content": None, "tool_calls": [{"id": "completed"}]},
        *settled,
        {"role": "assistant", "content": "NVIDIA news."},
        {"role": "assistant", "content": None, "tool_calls": [{"id": "pending"}]},
        {
            "role": "tool",
            "tool_call_id": "pending",
            "content": json.dumps({"type": "async_tool", "status": "running", "tool_call_id": "pending"}),
        },
        {"role": "user", "content": "What about Anthropic?"},
        {"role": "assistant", "content": None, "tool_calls": [{"id": "current"}]},
        {"role": "tool", "tool_call_id": "current", "content": result},
    ]
    context = LLMContext(messages, tools=[], tool_choice="auto")
    projection = _session_dialogue_context(context, len(prefix))
    projected = projection.get_messages()
    assert context.get_messages() == messages
    assert projected[: len(prefix)] == prefix
    reminders = [message for message in projected if message not in messages]
    assert len(reminders) == 1 and reminders[0]["role"] == "system"
    assert [message for message in projected if message is not reminders[0]] == messages
    assert projected[-3:] == messages[-3:]
    assert projected[-4] is reminders[0]
    assert projection.tools == context.tools and projection.tool_choice == context.tool_choice


def test_empty_planner_completion_retries_once_before_execution():
    from examples.frontend_backend_agent.generic.planner import EmptyPlanError

    async def scenario():
        planner = SimpleNamespace(
            plan=AsyncMock(
                side_effect=[
                    EmptyPlanError("No visible plan"),
                    {"tool": "get_stock_price", "params": {"company_name": "NVIDIA"}},
                ]
            )
        )
        quote = AsyncMock(return_value={"status": "success", "company": "NVIDIA", "symbol": "NVDA", "price": 100})
        tools = {"get_stock_price": replace(TOOLS["get_stock_price"], run=quote)}
        backend = GenericThinkerBackend(planner=planner, enabled_tools=("get_stock_price",), tools=tools)
        result = await backend.call("Check NVIDIA price")
        assert result["status"] == "success" and quote.call_count == 1
        assert planner.plan.call_count == 2
        assert [call.kwargs["state"]["planner_attempt"] for call in planner.plan.call_args_list] == [1, 2]

    asyncio.run(scenario())
