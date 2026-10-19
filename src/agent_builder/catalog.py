# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Load what the deployment offers a custom agent from the voice agent's catalog endpoints."""

from __future__ import annotations

import time
from collections.abc import Awaitable, Callable
from typing import Any

import httpx
from loguru import logger

from agent_builder.schema import BASE_EXAMPLE, Catalog

CACHE_SECONDS = 600
Fetch = Callable[[str, dict[str, str]], Awaitable[Any]]


def _entries(payload: object, key: str) -> list[dict]:
    items = payload.get(key) if isinstance(payload, dict) else None
    return [item for item in items or [] if isinstance(item, dict) and isinstance(item.get("id"), str)]


def _languages(entry: dict) -> list[str]:
    raw = entry.get("supported_languages")
    return [code for code in raw if isinstance(code, str)] if isinstance(raw, list) else []


def _voice_map(payload: object) -> dict[str, dict[str, Any]]:
    voices = payload.get("voices") if isinstance(payload, dict) else None
    result: dict[str, dict[str, Any]] = {}
    for voice in voices or []:
        if isinstance(voice, str):
            result[voice] = {"name": voice}
        elif isinstance(voice, dict):
            voice_id = voice.get("id") or voice.get("voice_id") or voice.get("name")
            if isinstance(voice_id, str) and voice_id:
                result[voice_id] = {
                    "name": str(voice.get("name") or voice.get("label") or voice_id),
                    "language": str(voice.get("language") or voice.get("language_code") or ""),
                }
    return result


def _language_codes(payload: object) -> tuple[str, ...]:
    languages = payload.get("languages") if isinstance(payload, dict) else None
    codes: list[str] = []
    for language in languages or []:
        code = language if isinstance(language, str) else (language or {}).get("code") or (language or {}).get("id")
        if isinstance(code, str) and code and code not in codes:
            codes.append(code)
    return tuple(codes)


def parse_catalog(services: object, tools: object, tts_config: object) -> Catalog:
    """Build a ``Catalog`` from the ``/api/services``, ``/api/tools``, and ``/api/tts-config`` payloads."""
    services = services if isinstance(services, dict) else {}
    llm = {entry["id"]: entry for entry in _entries(services, "llm")}
    thinkers = _entries(services, "thinker-llm") or list(llm.values())
    catalog = Catalog(
        languages=_language_codes(tts_config),
        talkers={key: {"name": entry.get("name", key), "languages": _languages(entry)} for key, entry in llm.items()},
        backends={entry["id"]: {"name": entry.get("name", entry["id"])} for entry in thinkers},
        asr={entry["id"]: {"name": entry.get("name", entry["id"])} for entry in _entries(services, "asr")},
        tts={entry["id"]: {"name": entry.get("name", entry["id"])} for entry in _entries(services, "tts")},
        voices=_voice_map(tts_config),
        tools={
            tool["name"]: str(tool.get("description") or "")
            for tool in (tools if isinstance(tools, list) else [])
            if isinstance(tool, dict) and isinstance(tool.get("name"), str)
        },
    )
    return catalog


def tts_config_params(services: object) -> dict[str, str]:
    """Query for ``/api/tts-config`` that names the example's default ASR and TTS.

    Without them the voice agent returns no languages or voices: the language list is the
    intersection of what the selected ASR and TTS services support.
    """
    asr = _entries(services, "asr")
    tts = _entries(services, "tts")
    params = {"pipeline_mode": BASE_EXAMPLE}
    if asr:
        params.update(
            {
                "asr_server": asr[0].get("server"),
                "asr_model": asr[0].get("model"),
                "asr_function_id": asr[0].get("function_id"),
            }
        )
    if tts:
        params.update(
            {
                "server": tts[0].get("server"),
                "voice_id": tts[0].get("voice_id"),
                "function_id": tts[0].get("function_id"),
                "model": tts[0].get("model"),
            }
        )
    return {key: str(value) for key, value in params.items() if value}


class CatalogLoader:
    """Fetch and cache the catalog for the base example."""

    def __init__(self, base_url: str, *, fetch: Fetch | None = None, headers: dict[str, str] | None = None) -> None:
        """Create a loader for the voice agent at ``base_url``; tests inject ``fetch``."""
        self._base_url = base_url.rstrip("/")
        self._headers = headers or {}
        self._fetch = fetch or self._http_fetch
        self._cached: Catalog | None = None
        self._loaded_at = 0.0

    async def _http_fetch(self, path: str, params: dict[str, str]) -> Any:
        # The language catalog can wait on the speech services to answer, so allow it time.
        async with httpx.AsyncClient(timeout=60.0, headers=self._headers) as client:
            response = await client.get(f"{self._base_url}{path}", params=params)
            response.raise_for_status()
            return response.json()

    async def get(self) -> Catalog:
        """Return the cached catalog, refreshing it when stale; keep serving the old one if a refresh fails."""
        if self._cached is not None and time.monotonic() - self._loaded_at < CACHE_SECONDS:
            return self._cached
        params = {"pipeline_mode": BASE_EXAMPLE}
        try:
            services = await self._fetch("/api/services", params)
            tools = await self._fetch("/api/tools", params)
            tts_config = await self._fetch("/api/tts-config", tts_config_params(services))
        except Exception as exc:
            if self._cached is not None:
                logger.warning(f"Catalog refresh failed, serving the previous catalog: {exc}")
                return self._cached
            raise
        self._cached = parse_catalog(services, tools, tts_config)
        self._loaded_at = time.monotonic()
        return self._cached
