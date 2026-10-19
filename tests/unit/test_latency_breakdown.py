# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause

# ruff: noqa: D103

"""Tests for the Frontend/Backend ``latency-breakdown`` message and the speech-gate hold."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import patch

from pipecat.frames.frames import (
    FunctionCallsStartedFrame,
    LLMFullResponseEndFrame,
    LLMFullResponseStartFrame,
    LLMTextFrame,
)
from pipecat.observers.user_bot_latency_observer import (
    LatencyBreakdown,
    LatencyContribution,
    LatencyOwnerKind,
    MeasuredFrom,
)
from pipecat.processors.frame_processor import FrameDirection

from examples.frontend_backend_agent.pipeline import latency_breakdown_message
from examples.shared.tool_call_speech_gate import ToolCallSpeechGate


def _part(key: str, start: float, duration: float, kind: LatencyOwnerKind) -> LatencyContribution:
    return LatencyContribution(
        key=key,
        label=key.replace("_", " "),
        owner=f"owner:{key}",
        owner_kind=kind,
        start_time=start,
        duration_secs=duration,
    )


def _breakdown() -> LatencyBreakdown:
    parts = [
        _part("endpointing_wait", 100.0, 0.8, LatencyOwnerKind.SETTING),
        _part("transcription", 100.8, 0.12, LatencyOwnerKind.SERVICE),
        _part("llm_inference", 100.92, 0.31, LatencyOwnerKind.SERVICE),
        _part("pipeline", 101.23, 0.02, LatencyOwnerKind.PIPELINE),
        _part("speech_synthesis", 101.25, 0.15, LatencyOwnerKind.SERVICE),
    ]
    return LatencyBreakdown(
        contributions=parts,
        total_secs=sum(part.duration_secs for part in parts),
        measured_from=MeasuredFrom.USER_SILENCE,
        user_turn_start_time=100.0,
        user_turn_secs=0.92,
    )


def test_contributions_are_ordered_and_sum_to_the_total() -> None:
    message = latency_breakdown_message(
        _breakdown(), vad_stop_secs=0.8, smart_turn_stop_secs=2.0, speech_gate_hold_secs=0.042
    )

    assert message["type"] == "latency-breakdown"
    assert message["measured_from"] == "user_silence"
    assert [part["key"] for part in message["contributions"]][:2] == ["endpointing_wait", "transcription"]
    assert sum(part["duration_ms"] for part in message["contributions"]) == message["total_ms"] == 1400
    assert message["contributions"][0]["offset_ms"] == 0
    assert message["contributions"][2] == {
        "key": "llm_inference",
        "label": "llm inference",
        "owner": "owner:llm_inference",
        "owner_kind": "service",
        "offset_ms": 920,
        "duration_ms": 310,
    }
    assert message["config"] == {"vad_stop_ms": 800, "smart_turn_stop_ms": 2000}
    assert message["speech_gate_hold_ms"] == 42


def test_legacy_fields_stay_for_older_clients() -> None:
    message = latency_breakdown_message(
        _breakdown(), vad_stop_secs=0.8, smart_turn_stop_secs=2.0, speech_gate_hold_secs=None
    )

    assert message["vad_smart_turn"] == 0.92
    assert message["events"] == ["User turn: 0.920s"]
    assert message["speech_gate_hold_ms"] is None


def test_empty_breakdown_is_still_a_valid_message() -> None:
    message = latency_breakdown_message(
        LatencyBreakdown(), vad_stop_secs=0.8, smart_turn_stop_secs=2.0, speech_gate_hold_secs=None
    )

    assert (message["contributions"], message["total_ms"], message["vad_smart_turn"]) == ([], 0, None)


async def _feed(gate: ToolCallSpeechGate, frames: list) -> None:
    async def _push(_frame, _direction=FrameDirection.DOWNSTREAM) -> None:
        return None

    gate.push_frame = _push
    for frame in frames:
        await gate.process_frame(frame, FrameDirection.DOWNSTREAM)


def test_speech_gate_records_how_long_a_spoken_reply_was_held() -> None:
    gate = ToolCallSpeechGate()
    clock = SimpleNamespace(monotonic=iter([10.0, 10.25]).__next__)
    with patch("examples.shared.tool_call_speech_gate.time", clock):
        asyncio.run(
            _feed(
                gate,
                [
                    LLMFullResponseStartFrame(),
                    LLMTextFrame("Hello"),
                    LLMTextFrame(" there."),
                    LLMFullResponseEndFrame(),
                ],
            )
        )

    assert gate.last_hold_secs == 0.25


def test_speech_gate_hold_is_cleared_by_a_tool_call_response() -> None:
    gate = ToolCallSpeechGate()
    gate.last_hold_secs = 0.5
    asyncio.run(
        _feed(
            gate,
            [
                LLMFullResponseStartFrame(),
                LLMTextFrame("let me check"),
                FunctionCallsStartedFrame(function_calls=[]),
                LLMFullResponseEndFrame(),
            ],
        )
    )

    assert gate.last_hold_secs is None
