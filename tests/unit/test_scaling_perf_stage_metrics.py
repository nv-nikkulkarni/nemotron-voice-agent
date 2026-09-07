# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause

"""Focused tests for scaling-perf RTVI stage metric collection."""

from __future__ import annotations

import asyncio
import importlib.util
import sys
from pathlib import Path


def _load_benchmark_module():
    path = Path("benchmarking_tools/scaling-perf/benchmark.py")
    spec = importlib.util.spec_from_file_location("scaling_perf_stage_test", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class _Logger:
    async def log(self, message: str) -> None:
        del message


def _metric(
    processor: str,
    value: float,
    *,
    stage: str,
    turn_id: str,
    invocation_id: str,
    outcome: str | None = None,
    tool_name: str | None = None,
) -> dict:
    item = {
        "processor": processor,
        "value": value,
        "stage": stage,
        "turn_id": turn_id,
        "invocation_id": invocation_id,
        "attempt": 1,
    }
    if outcome is not None:
        item["outcome"] = outcome
    if tool_name is not None:
        item["tool_name"] = tool_name
    return item


def test_perf_client_collects_all_correlated_stage_metrics_from_nested_rtvi_event() -> None:
    """Collect, correlate, and deduplicate all seven metrics from the WebSocket envelope."""
    module = _load_benchmark_module()
    client = module.PerfClient(
        stream_id="client-test",
        host="localhost",
        port=8000,
        audio_files=[],
        start_delay=0,
        metrics_start_time=None,
        session_end_time=None,
        test_duration=1,
        reverse_barge_in_threshold=0,
        audio_output_path=None,
        logger=_Logger(),
    )
    client.collecting_metrics = True

    metrics = {
        "ttfb": [
            _metric(
                "frontend_tool_selection_llm",
                0.1,
                stage="frontend_tool_selection",
                turn_id="turn-1",
                invocation_id="front-1",
            ),
            _metric("backend_thinker_llm", 0.2, stage="backend_thinker", turn_id="turn-1", invocation_id="thinker-1"),
            _metric(
                "frontend_final_response_llm",
                0.3,
                stage="frontend_final_response",
                turn_id="turn-1",
                invocation_id="final-1",
            ),
        ],
        "processing": [
            _metric(
                "frontend_tool_selection_llm",
                0.4,
                stage="frontend_tool_selection",
                turn_id="turn-1",
                invocation_id="front-1",
                outcome="success",
            ),
            _metric(
                "backend_thinker_llm",
                0.5,
                stage="backend_thinker",
                turn_id="turn-1",
                invocation_id="thinker-1",
                outcome="success",
            ),
            _metric(
                "backend_tool_call.web_search",
                0.6,
                stage="backend_tool_call",
                turn_id="turn-1",
                invocation_id="tool-1",
                outcome="success",
                tool_name="web_search",
            ),
            _metric(
                "frontend_final_response_llm",
                0.7,
                stage="frontend_final_response",
                turn_id="turn-1",
                invocation_id="final-1",
                outcome="success",
            ),
        ],
    }
    event = {"type": "server-message", "data": {"type": "metrics", "data": metrics}}

    asyncio.run(client._process_server_message(event))
    asyncio.run(client._process_server_message(event))

    expected = module.SERVER_METRIC_KEYS[-7:]
    assert [client.server_metric_samples[key] for key in expected] == [
        [0.1],
        [0.4],
        [0.2],
        [0.5],
        [0.6],
        [0.3],
        [0.7],
    ]
    assert len(client.stage_metric_events) == 7
    assert {item["turn_id"] for item in client.stage_metric_events} == {"turn-1"}
    assert (
        next(item for item in client.stage_metric_events if item["key"] == "backend_tool_call_latency")["tool_name"]
        == "web_search"
    )


def test_perf_client_accepts_sdk_style_metrics_payload() -> None:
    """Accept the direct payload shape exposed by RTVI client SDK callbacks."""
    module = _load_benchmark_module()
    payload = {
        "ttfb": [
            _metric("backend_thinker_llm", 0.25, stage="backend_thinker", turn_id="turn-2", invocation_id="thinker-2")
        ]
    }

    assert module._rtvi_metrics_payload(payload) == payload
    assert module._rtvi_metrics_payload({"type": "unrelated", "data": payload}) is None
