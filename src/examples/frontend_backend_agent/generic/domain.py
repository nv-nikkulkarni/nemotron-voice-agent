# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause

"""Generic-assistant domain specification for the shared voice pipeline."""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from examples.frontend_backend_agent.generic.backend import GenericThinkerBackend
from examples.frontend_backend_agent.generic.planner import NvidiaGenericPlanner
from examples.frontend_backend_agent.generic.tools import TOOLS, TOOLS_SCHEMA, resolve_enabled_tools
from examples.frontend_backend_agent.src.domain import DomainBuildContext, DomainSpec
from utils import parse_env_float


def _runtime_context(timezone: str = "UTC") -> str:
    now = datetime.now(ZoneInfo(timezone))
    return (
        "\n\nRuntime context:\n"
        f"- The local date is {now.date().isoformat()}.\n"
        f"- The local timezone is {timezone}.\n"
        "- No current clock reading is supplied here. Always obtain it through call_backend.\n"
        "- Delegate current, recent, forecast, or otherwise changing facts instead of answering from memory."
    )


def _session_runtime_context(body: Mapping[str, Any]) -> str:
    return _runtime_context(str(body.get("client_timezone") or "UTC"))


def _build_backend(context: DomainBuildContext) -> GenericThinkerBackend:
    enabled_tools = resolve_enabled_tools(context.tool_names)
    enabled_specs = tuple(TOOLS[name] for name in enabled_tools)
    planner = NvidiaGenericPlanner(
        llm=context.thinker_llm,
        system_prompt=context.thinker_prompt,
        enabled_tools=enabled_specs,
        max_tokens=context.thinker_max_tokens,
        stage_metrics=context.stage_metrics,
        model_name=context.thinker_model_name,
    )
    return GenericThinkerBackend(
        planner=planner,
        tools=TOOLS,
        enabled_tools=enabled_tools,
        overall_timeout_seconds=parse_env_float("GENERIC_BACKEND_TIMEOUT_SECONDS", 40.0, min_value=1.0),
        planner_timeout_seconds=parse_env_float("GENERIC_PLANNER_TIMEOUT_SECONDS", 6.0, min_value=1.0),
        on_tool_started=context.on_tool_started,
        stage_metrics=context.stage_metrics,
        backend_history_turn_limit=context.backend_history_turn_limit,
    )


def _neutral_progress(query: str) -> str:
    del query
    return "Let me check that."


def create_domain_spec() -> DomainSpec:
    """Return the generic domain's prompts, tools, backend, and speech policy."""
    return DomainSpec(
        key="generic",
        label="Generic Assistant",
        thinker_prompt_key="generic_thinker",
        talker_tools_schema=TOOLS_SCHEMA,
        build_backend=_build_backend,
        runtime_context=_runtime_context,
        filler_policy="code_authored",
        filler_selector=_neutral_progress,
        tool_registry=TOOLS,
        max_query_chars=2000,
        talker_protocol_prompt_key="generic_talker",
        session_runtime_context=_session_runtime_context,
    )
