# SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause

"""RTVI protocol client for scaling-perf."""

# ruff: noqa: D101,D102,D103,D105,D107

from __future__ import annotations

import asyncio
import datetime as dt
import json
from typing import Any

from benchmark_core import (
    SERVER_METRIC_KEYS,
    AudioFrame,
    FailedBotUtterance,
    ProtocolClient,
    ProtocolConnectionClosed,
    RunLogger,
)
from rtvi_transport import RTVIAudioFrame, RTVITransport, RTVITransportClosed

_STAGE_TTFB_METRICS = {
    "frontend_tool_selection_llm": "frontend_tool_selection_ttft",
    "backend_thinker_llm": "backend_llm_ttft",
    "frontend_final_response_llm": "frontend_final_response_ttft",
}
_STAGE_PROCESSING_METRICS = {
    "frontend_tool_selection_llm": "frontend_tool_selection_processing_time",
    "backend_thinker_llm": "backend_llm_processing_time",
    "frontend_final_response_llm": "frontend_final_response_processing_time",
}
_STAGE_EVENT_FIELDS = (
    "stage",
    "turn_id",
    "invocation_id",
    "parent_invocation_id",
    "attempt",
    "outcome",
    "tool_name",
)


def _unwrap_rtvi_message(message: dict[str, Any]) -> dict[str, Any]:
    """Unwrap transport ``server-message`` envelopes without losing RTVI data."""
    current = message
    for _ in range(3):
        if current.get("type") != "server-message" or not isinstance(current.get("data"), dict):
            break
        current = current["data"]
    return current


def _rtvi_metrics_payload(message: dict[str, Any]) -> dict[str, Any] | None:
    """Return metrics from either a wire message or an SDK-style event payload."""
    current = _unwrap_rtvi_message(message)
    if current.get("type") == "metrics":
        data = current.get("data")
        return data if isinstance(data, dict) else current
    if any(isinstance(current.get(bucket), list) for bucket in ("ttfb", "processing", "tokens")):
        return current
    return None


def categorize_processor(processor: str) -> str:
    name = processor.lower()
    if "asr" in name or "stt" in name or "transcription" in name:
        return "asr"
    if "tts" in name or "texttospeech" in name:
        return "tts"
    if "llm" in name:
        return "llm"
    return ""


class RTVIClient(ProtocolClient):
    """RTVI WebSocket connection, framing, readiness, and metric parsing."""

    name = "rtvi"

    def __init__(
        self,
        *,
        stream_id: str,
        host: str,
        port: int,
        logger: RunLogger,
        connect_timeout: float,
        verify_tls: bool = True,
    ):
        self.stream_id = stream_id
        self.logger = logger
        self.connect_timeout = connect_timeout
        self.transport = RTVITransport(
            stream_id=stream_id,
            host=host,
            port=port,
            connect_timeout=connect_timeout,
            verify_tls=verify_tls,
        )
        self.uri = self.transport.uri
        self.server_metric_samples = {key: [] for key in SERVER_METRIC_KEYS}
        self.stage_metric_events: list[dict[str, Any]] = []
        self._seen_stage_metric_events: set[tuple[Any, ...]] = set()
        self.rtvi_messages: list[dict[str, Any]] = []
        self.collecting_metrics = False
        self._pending_llm_completion_tokens: list[float] = []

    @property
    def ready_log(self) -> None:
        return None

    async def __aenter__(self) -> RTVIClient:
        try:
            await self.transport.__aenter__()
        except RTVITransportClosed as exc:
            raise ProtocolConnectionClosed from exc
        await self.logger.log(f"{self.stream_id} websocket connected")
        await self.logger.log(f"{self.stream_id} sent RTVI client-ready")
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        await self.transport.__aexit__(exc_type, exc, tb)

    async def send_audio(self, frame: AudioFrame) -> None:
        try:
            await self.transport.send_audio(frame.audio, frame.sample_rate, frame.num_channels)
        except RTVITransportClosed as exc:
            raise ProtocolConnectionClosed from exc

    async def recv_audio(self, timeout: float | None = None) -> AudioFrame:
        deadline = None if timeout is None else asyncio.get_running_loop().time() + timeout
        while True:
            wait = None if deadline is None else max(0.0, deadline - asyncio.get_running_loop().time())
            if wait == 0:
                raise TimeoutError
            try:
                payload = await self.transport.recv(timeout=wait)
            except RTVITransportClosed as exc:
                raise ProtocolConnectionClosed from exc
            if isinstance(payload, RTVIAudioFrame):
                return AudioFrame(payload.audio, payload.sample_rate, payload.num_channels)
            await self.process_server_message(payload)

    async def process_server_message(self, message: dict) -> None:
        if not isinstance(message, dict):
            return
        message_type = str(message.get("type", "unknown"))
        self.rtvi_messages.append({"timestamp": dt.datetime.now().isoformat(), "type": message_type, "data": message})
        await self.logger.log(f"{self.stream_id} RTVI message: {json.dumps(message, sort_keys=True)}")
        message = _unwrap_rtvi_message(message)
        message_type = str(message.get("type", "unknown"))
        if message_type == "user-bot-latency":
            value = message.get("latency")
            if self.collecting_metrics and isinstance(value, (int, float)) and not message.get("first", False):
                self.server_metric_samples["server_e2e"].append(float(value))
            return
        if message_type == "latency-breakdown":
            value = message.get("vad_smart_turn")
            if self.collecting_metrics and isinstance(value, (int, float)):
                self.server_metric_samples["vad_smart_turn"].append(float(value))
            return
        metrics = _rtvi_metrics_payload(message)
        if not isinstance(metrics, dict) or not self.collecting_metrics:
            return
        for item in metrics.get("ttfb", []):
            if not isinstance(item, dict):
                continue
            value = item.get("value")
            processor = str(item.get("processor", ""))
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                stage_key = _STAGE_TTFB_METRICS.get(processor)
                if stage_key:
                    if self._record_stage_metric(stage_key, float(value), item, metric="ttft"):
                        self.server_metric_samples[stage_key].append(float(value))
                    continue
            category = categorize_processor(processor)
            if isinstance(value, (int, float)) and not isinstance(value, bool) and category:
                key = {"asr": "asr_ttfb", "llm": "llm_ttft", "tts": "tts_ttfb"}[category]
                self.server_metric_samples[key].append(float(value))
        for item in metrics.get("tokens", []):
            if not isinstance(item, dict):
                continue
            completion_tokens = item.get("completion_tokens")
            if isinstance(completion_tokens, (int, float)) and not isinstance(completion_tokens, bool):
                self._pending_llm_completion_tokens.append(float(completion_tokens))
        for item in metrics.get("processing", []):
            if not isinstance(item, dict):
                continue
            value = item.get("value")
            processor = str(item.get("processor", ""))
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                stage_key = _STAGE_PROCESSING_METRICS.get(processor)
                if stage_key:
                    if self._record_stage_metric(stage_key, float(value), item, metric="processing"):
                        self.server_metric_samples[stage_key].append(float(value))
                    continue
                if processor.startswith("backend_tool_call."):
                    if self._record_stage_metric("backend_tool_call_latency", float(value), item, metric="latency"):
                        self.server_metric_samples["backend_tool_call_latency"].append(float(value))
                    continue
            if (
                isinstance(value, (int, float))
                and not isinstance(value, bool)
                and categorize_processor(processor) == "llm"
            ):
                processing_time = float(value)
                self.server_metric_samples["llm_processing_time"].append(processing_time)
                if self._pending_llm_completion_tokens:
                    completion_tokens = self._pending_llm_completion_tokens.pop(0)
                    if processing_time > 0:
                        self.server_metric_samples["llm_tokens_per_sec"].append(completion_tokens / processing_time)

    def _record_stage_metric(self, key: str, value: float, item: dict[str, Any], *, metric: str) -> bool:
        """Preserve correlation metadata and suppress a duplicated wire event."""
        event: dict[str, Any] = {
            "key": key,
            "value": value,
            "metric": metric,
            "processor": str(item.get("processor", "")),
        }
        for field in _STAGE_EVENT_FIELDS:
            field_value = item.get(field)
            if field_value is not None:
                event[field] = field_value

        invocation_id = str(event.get("invocation_id", ""))
        fingerprint = (
            key,
            metric,
            str(event.get("turn_id", "")),
            invocation_id,
            event.get("attempt"),
            event.get("outcome"),
            value,
        )
        if invocation_id and fingerprint in self._seen_stage_metric_events:
            return False
        if invocation_id:
            self._seen_stage_metric_events.add(fingerprint)
        self.stage_metric_events.append(event)
        return True

    async def recover_turn(
        self,
        *,
        timeout: float,
        failure: FailedBotUtterance | None = None,
        intro_timeout: bool = False,
    ) -> None:
        del timeout
        if failure is not None or intro_timeout:
            return
        raise RuntimeError(
            "RTVI turn timed out without a synchronization event; reconnect before starting another turn"
        )

    def set_collecting_metrics(self, collecting: bool) -> None:
        self.collecting_metrics = collecting

    def result_artifacts(self) -> dict[str, list[dict[str, Any]]]:
        return {"rtvi_messages": self.rtvi_messages}
