# SPDX-FileCopyrightText: Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Apply validated sampling snapshots at request boundaries without mutating services."""

from __future__ import annotations

import asyncio
from contextvars import ContextVar

from loguru import logger
from pipecat.services.nvidia.llm import NvidiaLLMService

from examples.omni_assistant.nvidia_omni_multimodal_service import NvidiaOmniLLMService
from llm_settings import read


class SessionSamplingMixin:
    """One immutable per-request snapshot for pipeline and worker inference paths."""

    def __init__(self, *args, sampling_session_id="", sampling_role="", sampling_initial=None, **kwargs):
        """Bind only this service's role; ordinary pipelines retain their current settings."""
        super().__init__(*args, **kwargs)
        self._sampling_session_id = sampling_session_id
        self._sampling_role = sampling_role
        self._sampling_initial = dict(sampling_initial or {})
        self._sampling_snapshot: ContextVar[dict | None] = ContextVar(f"sampling_{id(self)}", default=None)

    async def _sampling_values(self) -> dict:
        if self._sampling_snapshot.get() is not None:
            return self._sampling_snapshot.get()
        if not self._sampling_session_id:
            return self._sampling_initial
        document = await asyncio.to_thread(read, self._sampling_session_id)
        if document is None:
            return self._sampling_initial
        return document["settings"].get(self._sampling_role, {})

    def build_chat_completion_params(self, params_from_context):
        """Overlay only safe sampling fields, preserving tool, reasoning, and media contracts."""
        params = super().build_chat_completion_params(params_from_context)
        values = self._sampling_snapshot.get()
        if values is None:
            values = self._sampling_initial
        params.update({name: value for name, value in values.items() if name not in ("top_k", "repetition_penalty")})
        extra_body = dict(params.get("extra_body") or {})
        for name in ("top_k", "repetition_penalty"):
            if name in values:
                extra_body[name] = values[name]
        if "max_tokens" in values:
            params.pop("max_completion_tokens", None)
            if isinstance(extra_body.get("reasoning_budget"), int):
                extra_body["reasoning_budget"] = min(extra_body["reasoning_budget"], values["max_tokens"] - 1)
        if extra_body:
            params["extra_body"] = extra_body
        if values:
            logger.debug(
                "llm_sampling session={} role={} values={}", self._sampling_session_id, self._sampling_role, values
            )
        return params

    async def build_session_chat_completion_params(self, invocation_params):
        """Build a request snapshot for the instrumented planner's native streaming path."""
        token = self._sampling_snapshot.set(await self._sampling_values())
        try:
            return self.build_chat_completion_params(invocation_params)
        finally:
            self._sampling_snapshot.reset(token)

    async def get_chat_completions(self, context):
        """Freeze settings before creating a streaming request."""
        token = self._sampling_snapshot.set(await self._sampling_values())
        try:
            return await super().get_chat_completions(context)
        finally:
            self._sampling_snapshot.reset(token)

    async def run_inference(self, context, max_tokens=None, system_instruction=None, response_schema=None):
        """Respect a smaller internal retry budget without overriding the user's current limit."""
        values = await self._sampling_values()
        if "max_tokens" in values and max_tokens is not None:
            max_tokens = min(max_tokens, values["max_tokens"])
        token = self._sampling_snapshot.set(values)
        try:
            return await super().run_inference(context, max_tokens, system_instruction, response_schema=response_schema)
        finally:
            self._sampling_snapshot.reset(token)

    async def retry_active_audio_inference(self, context, *, correction_instruction, max_tokens=None):
        """Apply safe sampling to the Speaker's bounded audio correction request too."""
        values = await self._sampling_values()
        if "max_tokens" in values and max_tokens is not None:
            max_tokens = min(max_tokens, values["max_tokens"])
        token = self._sampling_snapshot.set(values)
        try:
            return await super().retry_active_audio_inference(
                context, correction_instruction=correction_instruction, max_tokens=max_tokens
            )
        finally:
            self._sampling_snapshot.reset(token)

    async def run_multimodal_inference(self, context, **kwargs):
        """Apply the same request snapshot to all Omni worker modalities."""
        values = await self._sampling_values()
        if "max_tokens" in values:
            kwargs["max_tokens"] = values["max_tokens"]
            if kwargs.get("reasoning_budget") is not None:
                kwargs["reasoning_budget"] = min(kwargs["reasoning_budget"], values["max_tokens"] - 1)
        if "temperature" in values:
            kwargs["temperature"] = values["temperature"]
        token = self._sampling_snapshot.set(values)
        try:
            return await super().run_multimodal_inference(context, **kwargs)
        finally:
            self._sampling_snapshot.reset(token)


class SamplingNvidiaLLMService(SessionSamplingMixin, NvidiaLLMService):
    """NVIDIA text inference with session sampling controls."""


class SamplingOmniLLMService(SessionSamplingMixin, NvidiaOmniLLMService):
    """NVIDIA multimodal inference with session sampling controls."""
