# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause

"""Atomic validation and deterministic execution of generic-domain plans."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from loguru import logger

from examples.frontend_backend_agent.generic.result_formatters import (
    combine_tool_results,
    disabled_tool,
    format_tool_result,
    invalid_parameters,
    missing_parameters,
    unsupported_request,
)
from examples.frontend_backend_agent.generic.services import TOOL_SERVICES

MAX_PARALLEL_TOOL_CALLS = 3
_TOOL_TIMEOUTS = {
    "get_weather": 12.0,
    "get_stock_price": 12.0,
    "web_search": 30.0,
    "calculate_bmi": 1.0,
    "generate_random_number": 1.0,
}
_PARAMS = {
    "get_weather": (frozenset({"city"}), frozenset({"units"})),
    "get_stock_price": (frozenset({"company_name"}), frozenset()),
    "web_search": (frozenset({"query"}), frozenset()),
    "calculate_bmi": (frozenset({"weight_kg", "height_m"}), frozenset()),
    "generate_random_number": (frozenset(), frozenset({"min", "max"})),
}


@dataclass(slots=True, frozen=True)
class ValidatedToolCall:
    """One allowlisted call whose structure is safe to execute."""

    name: str
    arguments: dict[str, Any]


class PlanValidationError(ValueError):
    """A rejected model plan; no tool may execute after this exception."""


def _raw_calls(plan: dict[str, Any]) -> list[dict[str, Any]]:
    raw = plan.get("tool_calls")
    if raw is None and plan.get("tool"):
        raw = [plan]
    if not isinstance(raw, list):
        return []
    if len(raw) > MAX_PARALLEL_TOOL_CALLS:
        raise PlanValidationError("too many tool calls")
    if any(not isinstance(item, dict) for item in raw):
        raise PlanValidationError("tool calls must be objects")
    return [dict(item) for item in raw]


def validate_plan(plan: dict[str, Any], enabled_tools: frozenset[str]) -> list[ValidatedToolCall]:
    """Validate the whole plan before allowing any external side effect."""
    calls: list[ValidatedToolCall] = []
    for raw in _raw_calls(plan):
        name = str(raw.get("tool") or "").strip()
        if name not in TOOL_SERVICES:
            raise PlanValidationError(f"unknown tool: {name}")
        if name not in enabled_tools:
            raise PlanValidationError(f"disabled tool: {name}")
        arguments = raw.get("params")
        if arguments is None:
            arguments = {}
        if not isinstance(arguments, dict):
            raise PlanValidationError(f"invalid params for {name}")
        required, optional = _PARAMS[name]
        if set(arguments) - required - optional:
            raise PlanValidationError(f"unexpected params for {name}")
        calls.append(ValidatedToolCall(name=name, arguments=dict(arguments)))
    return calls


def _valid_text(value: object, *, max_length: int) -> bool:
    return isinstance(value, str) and 0 < len(value.strip()) <= max_length


def _validate_values(call: ValidatedToolCall) -> list[str]:
    required, _ = _PARAMS[call.name]
    missing = [name for name in sorted(required) if call.arguments.get(name) in (None, "")]
    if missing:
        return missing
    if call.name == "get_weather":
        if not _valid_text(call.arguments.get("city"), max_length=200):
            raise ValueError("invalid city")
        units = call.arguments.get("units", "celsius")
        if not isinstance(units, str) or units.lower() not in {"celsius", "fahrenheit"}:
            raise ValueError("invalid weather units")
    elif call.name == "get_stock_price":
        if not _valid_text(call.arguments.get("company_name"), max_length=200):
            raise ValueError("invalid company")
    elif call.name == "web_search":
        if not _valid_text(call.arguments.get("query"), max_length=1000):
            raise ValueError("invalid search query")
    elif call.name == "calculate_bmi":
        weight = call.arguments.get("weight_kg")
        height = call.arguments.get("height_m")
        if isinstance(weight, bool) or not isinstance(weight, int | float) or not 1 <= float(weight) <= 1000:
            raise ValueError("invalid weight")
        if isinstance(height, bool) or not isinstance(height, int | float) or not 0.3 <= float(height) <= 4:
            raise ValueError("invalid height")
    elif call.name == "generate_random_number":
        low = call.arguments.get("min", 1)
        high = call.arguments.get("max", 100)
        if isinstance(low, bool) or not isinstance(low, int):
            raise ValueError("invalid minimum")
        if isinstance(high, bool) or not isinstance(high, int):
            raise ValueError("invalid maximum")
        if low > high or low < -1_000_000_000 or high > 1_000_000_000:
            raise ValueError("invalid random range")
    return []


async def _execute(
    call: ValidatedToolCall,
    on_tool_started: Callable[[str], Awaitable[None]] | None,
) -> dict[str, Any]:
    try:
        if on_tool_started:
            await on_tool_started(call.name)
        data = await asyncio.wait_for(TOOL_SERVICES[call.name](call.arguments), timeout=_TOOL_TIMEOUTS[call.name])
        return format_tool_result(call.name, call.arguments, data)
    except asyncio.CancelledError:
        raise
    except TimeoutError:
        logger.warning(f"generic domain tool {call.name} timed out")
        return format_tool_result(
            call.name,
            call.arguments,
            {"status": "unavailable", "assistant_should_say": "That check timed out. Would you like me to retry?"},
        )
    except (TypeError, ValueError):
        return invalid_parameters(call.name)
    except Exception as exc:  # noqa: BLE001 - fail closed at the tool boundary
        logger.warning(f"generic domain tool {call.name} failed: {type(exc).__name__}")
        return format_tool_result(
            call.name,
            call.arguments,
            {"status": "unavailable", "assistant_should_say": "I couldn't complete that check right now."},
        )


def _response_hint(plan: dict[str, Any], enabled_tools: frozenset[str]) -> dict[str, Any]:
    """Convert only the closed response-hint vocabulary into deterministic speech."""
    reason = str(plan.get("reason") or "")
    context = str(plan.get("context") or "")
    if reason == "params_missing":
        requested = plan.get("params_needed")
        if context not in _PARAMS or not isinstance(requested, list) or not requested:
            raise PlanValidationError("invalid missing-parameter hint")
        names = list(dict.fromkeys(str(item) for item in requested))
        required, _ = _PARAMS[context]
        if len(names) > 4 or any(name not in required for name in names):
            raise PlanValidationError("invalid missing-parameter fields")
        return missing_parameters(context, names)
    if reason == "tool_disabled":
        if context not in _PARAMS or context in enabled_tools:
            raise PlanValidationError("invalid disabled-tool hint")
        return disabled_tool(context)
    if reason == "unsupported_request" and context in {"", "general"}:
        return unsupported_request()
    raise PlanValidationError("unknown response hint")


async def dispatch_plan(
    plan: dict[str, Any],
    enabled_tools: tuple[str, ...],
    *,
    on_tool_started: Callable[[str], Awaitable[None]] | None = None,
) -> dict[str, Any]:
    """Validate, then run at most three independent read-only tools in parallel."""
    enabled = frozenset(enabled_tools)
    if plan.get("tool") == "response_hint" and not plan.get("tool_calls"):
        return _response_hint(plan, enabled)
    try:
        calls = validate_plan(plan, enabled)
    except PlanValidationError as exc:
        message = str(exc)
        logger.warning(f"generic domain plan rejected: {message}")
        if message.startswith("disabled tool:"):
            return disabled_tool(message.split(":", 1)[1].strip())
        raise
    if not calls:
        return unsupported_request()
    # Preflight every call before the first side effect. A malformed member of
    # a multi-tool plan prevents all other members from running.
    for call in calls:
        try:
            missing = _validate_values(call)
        except (TypeError, ValueError):
            return invalid_parameters(call.name)
        if missing:
            return missing_parameters(call.name, missing)
    payloads = await asyncio.gather(*(_execute(call, on_tool_started) for call in calls))
    return payloads[0] if len(payloads) == 1 else combine_tool_results(payloads)
