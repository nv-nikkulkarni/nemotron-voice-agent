# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Input, output, and abuse guards for the builder chat."""

from __future__ import annotations

import re
import time
from collections import defaultdict, deque

from agent_builder.schema import clean_text

MAX_MESSAGE_CHARS = 500
OFF_TOPIC_REPLY = (
    "I can only help you design your voice agent: its persona, domain, tone, language, models, voice, and tools. "
    "What kind of agent would you like to build?"
)
REFUSED_REPLY = (
    "I can't help with that. I can build agents for helpful, lawful purposes. "
    "Tell me what kind of assistant you would like instead."
)
UNAVAILABLE_REPLY = "The builder is unavailable right now. Please try again in a moment."

_INJECTION_RE = re.compile(
    r"ignore\s+(?:all\s+|any\s+|the\s+|your\s+)?(?:previous|prior|above|earlier)|"
    r"(?:system|developer|hidden|initial)\s+(?:prompt|message|instructions?)|"
    r"reveal\s+(?:your|the)\s+(?:prompt|instructions|rules)|"
    r"you\s+are\s+now\b|\bjailbreak\b|\bdan\s+mode\b|\bdeveloper\s+mode\b|"
    r"disregard\s+(?:your|the|all)|override\s+(?:your|the)\s+(?:rules|instructions|safety)|"
    r"</?(?:system|assistant|tool|developer)>|<\|[a-z_]+\|>",
    re.IGNORECASE,
)


def clean_user_message(message: object) -> str:
    """Return the message as bounded plain text, or an empty string when it cannot be used."""
    if not isinstance(message, str):
        return ""
    return clean_text(message, MAX_MESSAGE_CHARS)


def looks_like_injection(text: str) -> bool:
    """Return whether text tries to read, replace, or override the builder's instructions."""
    return bool(_INJECTION_RE.search(text))


def _shingles(text: str, size: int) -> set[tuple[str, ...]]:
    words = re.findall(r"\w+", text.casefold())
    return {tuple(words[i : i + size]) for i in range(max(0, len(words) - size + 1))}


def echoes_prompt(text: str, prompt: str, *, size: int = 10) -> bool:
    """Return whether ``text`` repeats a run of ``size`` consecutive words of the builder prompt."""
    return bool(_shingles(text, size) & _shingles(prompt, size))


class RateLimiter:
    """Sliding-window limiter keyed by client address."""

    def __init__(self, limit: int, window_seconds: float = 60.0, *, clock=time.monotonic) -> None:
        """Allow ``limit`` hits per key in each ``window_seconds`` window."""
        self._limit = limit
        self._window = window_seconds
        self._clock = clock
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, key: str) -> bool:
        """Record a hit for ``key`` and return whether it is within the limit."""
        now = self._clock()
        hits = self._hits[key]
        while hits and now - hits[0] > self._window:
            hits.popleft()
        if len(hits) >= self._limit:
            return False
        hits.append(now)
        if len(self._hits) > 10_000:
            self._hits = defaultdict(deque, {k: v for k, v in self._hits.items() if v and now - v[-1] <= self._window})
        return True
