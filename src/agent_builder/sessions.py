# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Server-side builder conversations: the client can never supply or rewrite history."""

from __future__ import annotations

import asyncio
import secrets
import time
from dataclasses import dataclass, field
from typing import Any


@dataclass
class BuilderSession:
    """One builder conversation: the draft configuration, bounded history, and abuse counters."""

    draft: dict[str, Any]
    history: list[dict[str, str]] = field(default_factory=list)
    turns: int = 0
    refusals: int = 0
    owner: str = ""
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    created: float = field(default_factory=time.monotonic)
    touched: float = field(default_factory=time.monotonic)


class SessionStore:
    """In-memory sessions with a TTL, a global cap, and per-session turn and refusal limits."""

    def __init__(
        self,
        *,
        ttl_seconds: float = 1800.0,
        max_sessions: int = 500,
        max_per_owner: int = 3,
        clock=time.monotonic,
    ) -> None:
        """Keep up to ``max_sessions`` sessions (``max_per_owner`` each), expiring ``ttl_seconds`` after last use."""
        self._ttl = ttl_seconds
        self._per_owner = max_per_owner
        self._max = max_sessions
        self._clock = clock
        self._sessions: dict[str, BuilderSession] = {}

    def _expire(self) -> None:
        now = self._clock()
        for key in [key for key, value in self._sessions.items() if now - value.touched > self._ttl]:
            del self._sessions[key]

    def create(self, draft: dict[str, Any], owner: str = "") -> tuple[str, BuilderSession] | None:
        """Start a session from ``draft``; return ``None`` when the store is full.

        One client may hold only ``max_per_owner`` live sessions: its oldest is dropped first, so
        a single caller cannot fill the store and lock everyone else out.
        """
        self._expire()
        if owner:
            mine = [key for key, value in self._sessions.items() if value.owner == owner]
            for key in mine[: max(0, len(mine) - self._per_owner + 1)]:
                del self._sessions[key]
        if len(self._sessions) >= self._max:
            return None
        session_id = secrets.token_urlsafe(18)
        session = BuilderSession(draft=draft, owner=owner, created=self._clock(), touched=self._clock())
        self._sessions[session_id] = session
        return session_id, session

    def get(self, session_id: str) -> BuilderSession | None:
        """Return a live session and refresh its expiry, or ``None``."""
        self._expire()
        session = self._sessions.get(session_id)
        if session is not None:
            session.touched = self._clock()
        return session

    def __len__(self) -> int:
        """Return the number of live sessions."""
        return len(self._sessions)
