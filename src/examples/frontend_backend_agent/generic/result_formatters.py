# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause

"""Deterministic, TTS-safe formatting for trusted generic-tool results."""

from __future__ import annotations

import re
from typing import Any

from examples.frontend_backend_agent.src.protocol import response_hint, tool_result

_UNSPEAKABLE_RE = re.compile(r"(?:</?(?:think|tool_call|function|parameter)[^>]*>|```|[*#]{2,})", re.IGNORECASE)
_SPACE_RE = re.compile(r"\s+")


def _speech_text(value: object, *, max_length: int = 1200) -> str:
    return _SPACE_RE.sub(" ", _UNSPEAKABLE_RE.sub(" ", str(value or ""))).strip()[:max_length]


def missing_parameters(tool: str, names: list[str]) -> dict[str, Any]:
    """Return a deterministic clarification for missing required fields."""
    labels = {
        "city": "the city or location",
        "company_name": "the company name or stock ticker",
        "query": "what you would like me to look up",
        "weight_kg": "your weight in kilograms",
        "height_m": "your height in metres",
    }
    readable = [labels.get(name, name.replace("_", " ")) for name in names]
    requested = readable[0] if len(readable) == 1 else f"{', '.join(readable[:-1])} and {readable[-1]}"
    return response_hint(
        reason="params_missing",
        action="req_params",
        params_needed=names,
        response_text=f"Please tell me {requested}.",
        context=tool,
    )


def invalid_parameters(tool: str) -> dict[str, Any]:
    """Return a safe clarification without relaying validator internals."""
    return response_hint(
        reason="params_invalid",
        action="req_params",
        response_text="I couldn't use those details. Could you restate them with the units or range you want?",
        context=tool,
    )


def disabled_tool(tool: str) -> dict[str, Any]:
    """Explain a disabled capability without exposing implementation details."""
    return response_hint(
        reason="tool_disabled",
        action="unsupported",
        response_text="That capability is not enabled for this session.",
        context=tool,
    )


def unsupported_request() -> dict[str, Any]:
    """Describe the fixed generic capabilities available to the backend."""
    return response_hint(
        reason="unsupported_request",
        action="answer_directly",
        response_text=(
            "I can check current weather and stock prices, search the live web, calculate BMI, "
            "or generate a random number."
        ),
        context="general",
    )


def planner_failure() -> dict[str, Any]:
    """Return a non-sensitive fallback for malformed or failed plans."""
    return response_hint(
        reason="planner_error",
        action="retry",
        response_text="I couldn't complete that request reliably. Please say it again and I'll retry.",
        context="general",
    )


def timeout_failure() -> dict[str, Any]:
    """Return a bounded-deadline fallback."""
    return response_hint(
        reason="timeout",
        action="retry",
        response_text="That check took too long, so I stopped it. Would you like me to try again?",
        context="general",
    )


def format_tool_result(tool: str, arguments: dict[str, Any], data: dict[str, Any]) -> dict[str, Any]:
    """Build speech only from validated arguments and returned service data."""
    status = str(data.get("status") or "error")
    if status == "unavailable":
        text = _speech_text(data.get("assistant_should_say")) or "I couldn't complete that check right now."
    elif status == "not_found":
        text = _speech_text(data.get("message")) or "I couldn't find a matching result."
    elif status != "success":
        text = "I couldn't complete that check right now. Would you like me to try again?"
    elif tool == "get_weather":
        city = _speech_text(data.get("city"), max_length=120) or "that location"
        condition = _speech_text(data.get("condition"), max_length=100) or "reported conditions"
        unit = _speech_text(data.get("temperature_unit"), max_length=2) or "C"
        text = f"In {city}, it's {data.get('temperature')} degrees {unit} with {condition.lower()}"
        if data.get("feels_like") is not None:
            text += f", and it feels like {data.get('feels_like')} degrees {unit}"
        text += "."
    elif tool == "get_stock_price":
        company = _speech_text(data.get("company"), max_length=120) or "That company"
        symbol = _speech_text(data.get("symbol"), max_length=16)
        ticker_label = f", ticker {symbol}," if symbol else ""
        currency = _speech_text(data.get("currency"), max_length=8) or "USD"
        text = f"{company}{ticker_label} is trading at {data.get('price')} {currency}."
    elif tool == "web_search":
        text = _speech_text(data.get("answer")) or "I couldn't find a verified answer for that."
    elif tool == "calculate_bmi":
        text = (
            f"Your BMI is {data.get('bmi')}, which falls in the {data.get('category')} category. "
            "BMI is a screening measure, not a diagnosis."
        )
    elif tool == "generate_random_number":
        text = f"Your random number between {data.get('min')} and {data.get('max')} is {data.get('result')}."
    else:
        text = "I completed the check."
    return tool_result(
        tool=tool,
        status=status,
        data={"arguments": arguments, "result": data},
        response_text=_speech_text(text),
        context=tool,
    )


def combine_tool_results(payloads: list[dict[str, Any]]) -> dict[str, Any]:
    """Combine payloads in planner order without introducing model-authored facts."""
    text = _speech_text(" ".join(str(payload.get("response_text") or "") for payload in payloads), max_length=1800)
    statuses = [str(payload.get("status") or "error") for payload in payloads]
    status = "success" if statuses and all(item == "success" for item in statuses) else "partial"
    return tool_result(
        tool="multi_tool",
        status=status,
        data={"results": payloads},
        response_text=text or "I finished checking those details.",
        context="multi_tool",
    )
