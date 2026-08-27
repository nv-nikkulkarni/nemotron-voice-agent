# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause

"""Talker-visible and internal-tool contracts for the generic domain."""

from __future__ import annotations

from pipecat.adapters.schemas.tools_schema import AdapterType, ToolsSchema

INTERNAL_TOOL_NAMES = (
    "get_weather",
    "get_stock_price",
    "web_search",
    "calculate_bmi",
    "generate_random_number",
)
INTERNAL_TOOL_NAME_SET = frozenset(INTERNAL_TOOL_NAMES)

CALL_BACKEND_TOOL: dict = {
    "type": "function",
    "function": {
        "name": "call_backend",
        "description": (
            "Delegate one self-contained request that requires current or externally verified data, "
            "a deterministic calculation, or explicit random generation. Do not speak in the same turn."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 2000,
                    "description": (
                        "The complete current request, with necessary conversational context and the user's "
                        "latest corrections."
                    ),
                }
            },
            "required": ["query"],
            "additionalProperties": False,
        },
    },
}

CANCEL_BACKEND_TOOL: dict = {
    "type": "function",
    "function": {
        "name": "cancel_backend",
        "description": (
            "Cancel in-progress delegated work when the user says stop, cancel, never mind, ignore that, "
            "or otherwise withdraws the pending request. Do not speak in the same turn."
        ),
        "parameters": {
            "type": "object",
            "properties": {},
            "required": [],
            "additionalProperties": False,
        },
    },
}

TOOLS_SCHEMA = ToolsSchema(
    standard_tools=[],
    custom_tools={AdapterType.OPENAI: [CALL_BACKEND_TOOL, CANCEL_BACKEND_TOOL]},
)


def resolve_enabled_tools(raw_override: object, prompt_tools: tuple[str, ...]) -> tuple[str, ...]:
    """Resolve a session subset against the immutable generic-tool allowlist."""
    if isinstance(raw_override, str) and raw_override.strip():
        requested = [] if raw_override.strip().lower() == "none" else raw_override.split(",")
    elif isinstance(raw_override, list):
        requested = raw_override
    else:
        requested = list(prompt_tools)
    normalized = (str(item).strip() for item in requested)
    return tuple(dict.fromkeys(name for name in normalized if name in INTERNAL_TOOL_NAME_SET))
