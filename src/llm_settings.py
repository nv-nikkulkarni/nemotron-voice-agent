# SPDX-FileCopyrightText: Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Validated, session-local sampling settings shared by all application replicas."""

from __future__ import annotations

import copy
import json
import math
import re
import threading
import time
from typing import Any

import examples_registry
from session_bus import client
from utils import load_service_entry, parse_env_float, parse_env_int, parse_json_dict

FIELDS = {
    "temperature": (0.0, 2.0),
    "top_p": (0.000001, 1.0),
    "max_tokens": (64, 32768),
    "top_k": (-1, 1000),
    "repetition_penalty": (0.1, 2.0),
    "frequency_penalty": (-2.0, 2.0),
    "presence_penalty": (-2.0, 2.0),
}
_local: dict[str, dict] = {}
_lock = threading.RLock()
_local_expiry: dict[str, float] = {}


class SettingsConflict(ValueError):
    """A concurrent update superseded the browser's settings revision."""


def role_keys(mode: str) -> tuple[str, ...]:
    """Return the model roles exposed by a supported example."""
    if mode == "generic-frontend-backend-agent":
        return ("frontend", "backend")
    if mode == "omni-assistant-subagents":
        return ("speaker", "thinker", "media", "webcam")
    return ()


def validate_settings(value: Any, mode: str) -> dict[str, dict[str, float | int]]:
    """Reject unknown roles, unsafe parameters, non-finite values, and invalid ranges."""
    if not isinstance(value, dict) or set(value) - set(role_keys(mode)):
        raise ValueError("llm_settings must contain only this example's model roles")
    result = {}
    for role, fields in value.items():
        if not isinstance(fields, dict) or set(fields) - set(FIELDS):
            raise ValueError(f"Unknown LLM setting for {role}")
        result[role] = {}
        for name, raw in fields.items():
            if (
                isinstance(raw, bool)
                or not isinstance(raw, int | float)
                or (isinstance(raw, float) and not math.isfinite(raw))
            ):
                raise ValueError(f"{role}.{name} must be a finite number")
            low, high = FIELDS[name]
            if not low <= raw <= high or (name == "top_k" and raw == 0):
                raise ValueError(f"{role}.{name} is outside its allowed range")
            if name in ("max_tokens", "top_k"):
                if int(raw) != raw:
                    raise ValueError(f"{role}.{name} must be an integer")
                raw = int(raw)
            result[role][name] = raw
    return result


def role_specs(config: dict) -> list[dict]:
    """Describe catalog/environment defaults without exposing endpoints or credentials."""
    mode = config.get("pipeline_mode", "")
    roles = role_keys(mode)
    result = []
    for role in roles:
        backend = role == "backend"
        prefix = "thinker_" if backend else ""
        category = "thinker-llm" if backend else "llm"
        keys = examples_registry.find(mode).get("defaults", {}).get(category, [])
        entry = load_service_entry(category, str(keys[0]) if keys else "")
        extra = parse_json_dict(config.get(prefix + "extra_params") or entry.get("extra_params", ""), "extra_params")
        extension = extra.get("extra_body") or {}
        defaults = {
            "temperature": 0.0,
            "top_p": 1.0,
            "max_tokens": 2048 if backend else 512,
            "top_k": -1,
            "repetition_penalty": 1.0,
            "frequency_penalty": 0.0,
            "presence_penalty": 0.0,
        }
        if mode == "omni-assistant-subagents":
            defaults.update(top_p=0.95)
            if role == "speaker":
                defaults.update(
                    temperature=parse_env_float("OMNI_TEMPERATURE", 0.7, min_value=0.0),
                    top_p=parse_env_float("OMNI_TOP_P", 0.95, min_value=0.0),
                    max_tokens=parse_env_int("OMNI_MAX_TOKENS", 8192, min_value=64),
                )
            elif role == "thinker":
                defaults.update(
                    temperature=parse_env_float("THINKER_TEMPERATURE", 0.6, min_value=0.0),
                    max_tokens=min(parse_env_int("THINKER_MAX_TOKENS", 16384, min_value=1024), 32768),
                )
            elif role == "media":
                defaults.update(
                    temperature=parse_env_float("MEDIA_ANALYZER_TEMPERATURE", 0.0, min_value=0.0),
                    max_tokens=parse_env_int("MEDIA_ANALYZER_MAX_TOKENS", 8192, min_value=256),
                )
            else:
                defaults.update(temperature=0.2, max_tokens=128)
        else:
            for name in ("temperature", "max_tokens"):
                raw = config.get(prefix + name, entry.get(name))
                if raw not in (None, ""):
                    defaults[name] = float(raw) if name == "temperature" else int(raw)
        for name in FIELDS:
            if name in extension:
                defaults[name] = extension[name]
            elif name in extra:
                defaults[name] = extra[name]
        labels = {
            "frontend": "Frontend · Talker",
            "backend": "Backend · Thinker",
            "speaker": "Speaker",
            "thinker": "Thinker",
            "media": "Media Analyzer",
            "webcam": "Webcam",
        }
        descriptions = {
            "frontend": "Fast spoken responses and tool delegation.",
            "backend": "Reasoning and tool planning.",
            "speaker": "Understands speech and chooses a response or handoff.",
            "thinker": "Deliberate reasoning for difficult turns.",
            "media": "Analyzes uploaded images, audio, and video.",
            "webcam": "Summarizes the live camera view.",
        }
        result.append(
            {
                "key": role,
                "label": labels[role],
                "description": descriptions[role],
                "model": config.get(prefix + "model_id") or entry.get("model_id", ""),
                "defaults": defaults,
            }
        )
    return result


def _key(sid: str) -> str:
    if not re.fullmatch(r"[0-9a-f]{12,32}", sid):
        raise ValueError("Invalid session ID")
    return f"sb:llm:{sid}"


def initialize(sid: str, config: dict) -> None:
    """Create a bounded-lived settings document when the session is minted."""
    roles = role_specs(config)
    if not sid or not roles:
        return
    document = {
        "roles": roles,
        "settings": validate_settings(config.get("llm_settings", {}), config["pipeline_mode"]),
        "pipeline_mode": config["pipeline_mode"],
        "revision": 0,
    }
    key = _key(sid)
    if client.is_enabled():
        client.sync_client().set(key, json.dumps(document), ex=client.TTL, nx=True)
    else:
        with _lock:
            now = time.monotonic()
            for expired in [name for name, deadline in _local_expiry.items() if deadline <= now]:
                _local.pop(expired, None)
                _local_expiry.pop(expired, None)
            _local.setdefault(key, document)
            _local_expiry.setdefault(key, now + client.TTL)


def read(sid: str) -> dict | None:
    """Read an independent snapshot; absence means the session ended or expired."""
    key = _key(sid)
    if client.is_enabled():
        raw = client.sync_client().get(key)
        return json.loads(raw) if raw else None
    with _lock:
        if _local_expiry.get(key, 0) <= time.monotonic():
            _local.pop(key, None)
            _local_expiry.pop(key, None)
        return copy.deepcopy(_local.get(key))


def replace(sid: str, settings: Any, revision: Any) -> dict:
    """Replace overrides atomically, rejecting stale updates rather than losing edits."""
    if isinstance(revision, bool) or not isinstance(revision, int) or revision < 0:
        raise ValueError("revision must be a non-negative integer")
    key = _key(sid)

    def updated(document):
        if document is None:
            raise LookupError("Session ended or expired")
        if document["revision"] != revision:
            raise SettingsConflict("Settings changed elsewhere. Reopen this panel and try again.")
        document["settings"] = validate_settings(settings, document["pipeline_mode"])
        document["revision"] += 1
        return document

    if client.is_enabled():
        from redis.exceptions import WatchError

        with client.sync_client().pipeline() as pipe:
            try:
                pipe.watch(key)
                raw = pipe.get(key)
                document = updated(json.loads(raw) if raw else None)
                pipe.multi()
                pipe.set(key, json.dumps(document), ex=client.TTL)
                pipe.execute()
                return document
            except WatchError as exc:
                raise SettingsConflict("Settings changed elsewhere. Reopen this panel and try again.") from exc
    with _lock:
        document = updated(read(sid))
        _local[key] = document
        _local_expiry[key] = time.monotonic() + client.TTL
        return copy.deepcopy(document)


def close(sid: str) -> None:
    """Remove live settings after teardown; retained captures do not contain this state."""
    if not sid:
        return
    key = _key(sid)
    if client.is_enabled():
        client.sync_client().delete(key)
    else:
        with _lock:
            _local.pop(key, None)
            _local_expiry.pop(key, None)
