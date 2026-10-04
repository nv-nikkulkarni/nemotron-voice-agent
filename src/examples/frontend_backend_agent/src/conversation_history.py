# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause

"""Bound session dialogue supplied to a delegated backend request."""

from __future__ import annotations

import os
import re
from collections import deque

DEFAULT_BACKEND_HISTORY_TURN_LIMIT = 8
MAX_BACKEND_HISTORY_TURN_LIMIT = 20
MAX_BACKEND_HISTORY_CHARS = 32_000
MAX_BACKEND_HISTORY_MESSAGES = 128
_TRUNCATION_MARKER = "\n[Conversation message shortened to fit the history budget.]\n"


def validate_backend_history_turn_limit(value: object) -> int:
    """Accept an integer or decimal integer string in the supported range."""
    if isinstance(value, str) and re.fullmatch(r"[0-9]{1,2}", value.strip()):
        value = int(value.strip())
    if type(value) is not int or not 1 <= value <= MAX_BACKEND_HISTORY_TURN_LIMIT:
        raise ValueError(f"backend_history_turn_limit must be an integer from 1 to {MAX_BACKEND_HISTORY_TURN_LIMIT}")
    return value


def backend_history_turn_limit_default() -> int:
    """Read the deployment default without changing session overrides."""
    return validate_backend_history_turn_limit(
        os.getenv("BACKEND_HISTORY_TURN_LIMIT", "").strip() or DEFAULT_BACKEND_HISTORY_TURN_LIMIT
    )


def bounded_conversation_history(messages: object, turn_limit: int) -> list[dict[str, str]]:
    """Keep recent user-led turns, excluding prompts, tool traffic, and orphan replies.

    Normal turns remain complete. Drop oldest turns first for the character and
    message budgets. If the newest turn alone exceeds a budget, preserve its user
    request first and fit its newest replies into the remaining space. The rare
    oversized user request keeps its beginning and end with an explicit marker.
    Returned dictionaries are independent of the caller's mutable context.
    """
    turn_limit = validate_backend_history_turn_limit(turn_limit)
    if not isinstance(messages, list | tuple):
        return []
    turns: deque[list[dict[str, str]]] = deque(maxlen=turn_limit)
    current: list[dict[str, str]] | None = None
    for message in messages:
        if not isinstance(message, dict):
            continue
        role, content = message.get("role"), message.get("content")
        if role == "user":
            current = None
        if (
            not isinstance(role, str)
            or role not in {"user", "assistant"}
            or not isinstance(content, str)
            or not content.strip()
            or message.get("tool_calls")
            or message.get("function_call")
        ):
            continue
        item = {"role": role, "content": content}
        if role == "user":
            current = [item]
            turns.append(current)
        elif current is not None:
            current.append(item)

    if not turns:
        return []
    selected: list[list[dict[str, str]]] = []
    chars = count = 0
    for turn in reversed(turns):
        turn_chars = sum(len(item["content"]) for item in turn)
        if chars + turn_chars > MAX_BACKEND_HISTORY_CHARS or count + len(turn) > MAX_BACKEND_HISTORY_MESSAGES:
            if not selected:
                selected.append(_fit_latest_turn(turn))
            break
        selected.append(turn)
        chars += turn_chars
        count += len(turn)
    return [item for turn in reversed(selected) for item in turn]


def _shorten(text: str, budget: int) -> str:
    if len(text) <= budget:
        return text
    if budget <= len(_TRUNCATION_MARKER):
        return text[:budget]
    available = budget - len(_TRUNCATION_MARKER)
    head = (available + 1) // 2
    tail = available - head
    return text[:head] + _TRUNCATION_MARKER + (text[-tail:] if tail else "")


def _fit_latest_turn(turn: list[dict[str, str]]) -> list[dict[str, str]]:
    user = {"role": "user", "content": _shorten(turn[0]["content"], MAX_BACKEND_HISTORY_CHARS)}
    remaining = MAX_BACKEND_HISTORY_CHARS - len(user["content"])
    replies: list[dict[str, str]] = []
    for item in reversed(turn[1:]):
        if remaining <= 0 or len(replies) >= MAX_BACKEND_HISTORY_MESSAGES - 1:
            break
        content = _shorten(item["content"], remaining)
        replies.append({"role": "assistant", "content": content})
        remaining -= len(content)
    return [user, *reversed(replies)]
