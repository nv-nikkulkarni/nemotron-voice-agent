# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""FastAPI app for the agent builder. The browser sends data only; every model parameter and prompt is fixed here."""

from __future__ import annotations

import asyncio
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from loguru import logger
from pydantic import BaseModel, Field, field_validator

from agent_builder.catalog import CatalogLoader
from agent_builder.guard import (
    OFF_TOPIC_REPLY,
    REFUSED_REPLY,
    UNAVAILABLE_REPLY,
    RateLimiter,
    clean_user_message,
    echoes_prompt,
    looks_like_injection,
)
from agent_builder.llm import BuilderLLM, NvcfBuilderLLM, moderate
from agent_builder.schema import (
    MAX_ABOUT,
    MAX_NAME,
    MAX_ROLE,
    TONES,
    Catalog,
    merge_updates,
    missing_fields,
    normalize_config,
    to_session_config,
)
from agent_builder.sessions import BuilderSession, SessionStore
from agent_builder.signing import SIGNING_KEY_ENV, sign_persona

SYSTEM_PROMPT = (Path(__file__).with_name("system_prompt.md")).read_text(encoding="utf-8")
GREETING = (
    "Hi! I'll help you design your own voice agent. Tell me what it should do and who it is for, "
    "for example a friendly travel guide that speaks Hindi."
)
MAX_TURNS = 40
TURN_DEADLINE_SECONDS = 75.0  # under the UI proxy's 90 s read timeout
MAX_BODY_BYTES = 16 * 1024
MAX_CONFIG_CHARS = 20_000
MAX_REFUSALS = 5
HISTORY_MESSAGES = 12


@dataclass
class Settings:
    """Builder configuration read from the environment."""

    llm_url: str
    llm_api_key: str
    llm_model: str
    llm_function_version_id: str
    voice_agent_url: str
    rate_limit_per_minute: int
    signing_key: str = ""

    @classmethod
    def from_env(cls) -> Settings:
        """Read the settings from ``BUILDER_*`` and ``VOICE_AGENT_URL``; the key falls back to ``NVIDIA_API_KEY``."""
        return cls(
            llm_url=os.environ["BUILDER_LLM_URL"],
            llm_api_key=os.getenv("BUILDER_LLM_API_KEY") or os.environ["NVIDIA_API_KEY"],
            llm_model=os.getenv("BUILDER_LLM_MODEL", "nvidia/nemotron-3.5-super-vl-120b-a12b"),
            llm_function_version_id=os.getenv("BUILDER_LLM_FUNCTION_VERSION_ID", ""),
            voice_agent_url=os.environ["VOICE_AGENT_URL"],
            rate_limit_per_minute=int(os.getenv("BUILDER_RATE_LIMIT_PER_MINUTE", "20")),
            signing_key=os.getenv(SIGNING_KEY_ENV, "").strip(),
        )


class TurnRequest(BaseModel):
    """One chat message from the browser."""

    session_id: str = Field(max_length=64)
    message: str = Field(max_length=2000)


class ValidateRequest(BaseModel):
    """An agent configuration to check, for example one loaded from a file."""

    config: dict[str, Any]

    @field_validator("config")
    @classmethod
    def _bounded(cls, value: dict[str, Any]) -> dict[str, Any]:
        if len(json.dumps(value, ensure_ascii=False, default=str)) > MAX_CONFIG_CHARS:
            raise ValueError("The configuration is too large.")
        return value


class LoadRequest(ValidateRequest):
    """An agent configuration that replaces the draft of a builder session."""

    session_id: str = Field(max_length=64)


def output_schema(catalog: Catalog) -> dict[str, Any]:
    """JSON schema the builder model must answer with; ids are enums drawn from the catalog."""

    def enum(values: object, **extra: Any) -> dict[str, Any]:
        items = list(values)  # type: ignore[call-overload]
        return {"type": "string", "enum": items, **extra} if items else {"type": "string", "maxLength": 0}

    speech: dict[str, Any] = {
        "asr": enum(catalog.asr),
        "tts": enum(catalog.tts),
        "voice": enum(catalog.voices),
        "pronunciations": {
            "type": "object",
            "additionalProperties": {"type": "string", "maxLength": 60},
            "maxProperties": 50,
        },
    }
    return {
        "type": "object",
        "properties": {
            "intent": {"type": "string", "enum": ["build", "clarify", "off_topic", "refused"]},
            "reply": {"type": "string", "maxLength": 400},
            "updates": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "maxLength": MAX_NAME},
                    "language": enum(catalog.languages),
                    "persona": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string", "maxLength": MAX_NAME},
                            "role": {"type": "string", "maxLength": MAX_ROLE},
                            "tone": {"type": "string", "enum": list(TONES)},
                            "about": {"type": "string", "maxLength": MAX_ABOUT},
                            "always": {"type": "array", "items": {"type": "string", "maxLength": 120}, "maxItems": 5},
                            "never": {"type": "array", "items": {"type": "string", "maxLength": 120}, "maxItems": 5},
                        },
                        "additionalProperties": False,
                    },
                    "models": {
                        "type": "object",
                        "properties": {"talker": enum(catalog.talkers), "backend": enum(catalog.backends)},
                        "additionalProperties": False,
                    },
                    "speech": {"type": "object", "properties": speech, "additionalProperties": False},
                    "tools": {"type": "array", "items": enum(catalog.tools)},
                },
                "additionalProperties": False,
            },
        },
        "required": ["intent", "reply", "updates"],
        "additionalProperties": False,
    }


def _catalog_brief(catalog: Catalog) -> str:
    talkers = "; ".join(
        f"{key} ({value['name']}, speaks {', '.join(value['languages']) or 'many languages'})"
        for key, value in catalog.talkers.items()
    )
    return (
        "CATALOG (the only valid choices)\n"
        f"- languages: {', '.join(catalog.languages)}\n"
        f"- talker models: {talkers}\n"
        f"- backend models: {', '.join(f'{key} ({value["name"]})' for key, value in catalog.backends.items())}\n"
        f"- speech recognizers: {', '.join(catalog.asr)}\n"
        f"- voice engines: {', '.join(catalog.tts)}\n"
        f"- voices by language (each voice speaks one language; leave voice empty to use the default): "
        f"{_voices_brief(catalog)}\n"
        f"- tools: {', '.join(f'{name} ({text[:60]})' for name, text in catalog.tools.items())}\n"
        f"- tones: {', '.join(TONES)}"
    )


def _voices_brief(catalog: Catalog, per_language: int = 6) -> str:
    """List a few voices per language; each voice speaks one language."""
    grouped: dict[str, list[str]] = {}
    for voice_id, voice in catalog.voices.items():
        code = str(voice.get("language", "")) or "other"
        if len(grouped.setdefault(code, [])) < per_language:
            grouped[code].append(voice_id)
    return "; ".join(f"{code}: {', '.join(ids)}" for code, ids in grouped.items()) or "default voice only"


def _persona_text(config: dict[str, Any]) -> str:
    """Return the persona as labelled text, so moderation reads "never" rules as prohibitions."""
    persona = config["persona"]
    parts = [
        ("Agent name", persona["name"] or config.get("name", "")),
        ("Role and domain", persona["role"]),
        ("About", persona["about"]),
        ("The agent must ALWAYS", "; ".join(persona["always"])),
        ("The agent must NEVER", "; ".join(persona["never"])),
        (
            "Pronunciation rules",
            "; ".join(f"{word} is said as {ipa}" for word, ipa in config["speech"]["pronunciations"].items()),
        ),
    ]
    return "\n".join(f"{label}: {text}" for label, text in parts if text).strip()


def _public(config: dict[str, Any], warnings: list[str]) -> dict[str, Any]:
    return {
        "draft_config": config,
        "missing": missing_fields(config),
        "ready": not missing_fields(config),
        "warnings": warnings,
    }


def create_app(
    settings: Settings | None = None,
    *,
    llm: BuilderLLM | None = None,
    catalog_loader: CatalogLoader | None = None,
    store: SessionStore | None = None,
    signing_key: str = "",
) -> FastAPI:
    """Build the app. Tests pass fakes for the model, catalog, and session store."""
    if llm is None or catalog_loader is None:
        settings = settings or Settings.from_env()
    if llm is None:
        assert settings is not None
        headers = (
            {"nvcf-function-version-id": settings.llm_function_version_id} if settings.llm_function_version_id else {}
        )
        llm = NvcfBuilderLLM(
            url=settings.llm_url, api_key=settings.llm_api_key, model=settings.llm_model, headers=headers
        )
    if catalog_loader is None:
        assert settings is not None
        catalog_loader = CatalogLoader(settings.voice_agent_url)
    signing_key = (settings.signing_key if settings else "") or signing_key
    store = store or SessionStore()
    limiter = RateLimiter(settings.rate_limit_per_minute if settings else 20)
    app = FastAPI(title="Agent builder", docs_url=None, redoc_url=None, openapi_url=None)

    @app.middleware("http")
    async def cap_body(request: Request, call_next):
        declared = request.headers.get("content-length", "")
        if declared.isdigit() and int(declared) > MAX_BODY_BYTES:
            return JSONResponse({"detail": "Request too large."}, status_code=413)
        return await call_next(request)

    def client_key(request: Request) -> str:
        # The UI proxy sets X-Forwarded-For to the client address it resolved; the last hop is the
        # one our own proxy appended, so a caller cannot choose its own bucket by sending the header.
        forwarded = request.headers.get("x-forwarded-for", "").split(",")[-1].strip()
        return forwarded or (request.client.host if request.client else "unknown")

    def guard_rate(request: Request) -> None:
        if not limiter.allow(client_key(request)):
            raise HTTPException(status_code=429, detail="Too many requests. Please slow down.")

    async def load_catalog() -> Catalog:
        try:
            return await catalog_loader.get()
        except Exception as exc:
            logger.warning(f"Builder catalog unavailable: {exc}")
            raise HTTPException(status_code=503, detail="The model catalog is unavailable right now.") from exc

    @app.get("/builder-api/health")
    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/builder-api/catalog")
    async def get_catalog(request: Request) -> dict[str, Any]:
        guard_rate(request)
        return (await load_catalog()).summary()

    @app.post("/builder-api/session")
    async def new_session(request: Request) -> dict[str, Any]:
        guard_rate(request)
        catalog = await load_catalog()
        created = store.create(catalog.defaults(), owner=client_key(request))
        if created is None:
            raise HTTPException(status_code=503, detail="The builder is busy. Please try again shortly.")
        session_id, session = created
        config, warnings = normalize_config(session.draft, catalog)
        session.draft = config
        return {"session_id": session_id, "reply": GREETING, "catalog": catalog.summary(), **_public(config, warnings)}

    async def run_turn(session: BuilderSession, body: TurnRequest) -> dict[str, Any]:
        if session.turns >= MAX_TURNS or session.refusals >= MAX_REFUSALS:
            raise HTTPException(status_code=429, detail="This builder session has reached its limit. Start a new one.")
        message = clean_user_message(body.message)
        if not message:
            raise HTTPException(status_code=400, detail="Send a short text message.")
        catalog = await load_catalog()
        config, warnings = normalize_config(session.draft, catalog)

        def declined(reply: str, intent: str, why: str) -> dict[str, Any]:
            session.refusals += 1
            logger.bind(event="builder_refusal", intent=intent, why=why, session=body.session_id[:8]).info(
                f"builder refusal ({why})"
            )
            return {"reply": reply, "intent": intent, **_public(config, warnings)}

        if looks_like_injection(message):
            return declined(OFF_TOPIC_REPLY, "off_topic", "injection_pattern")

        brief = _catalog_brief(catalog)
        draft_json = json.dumps(config, ensure_ascii=False)
        state = f"{SYSTEM_PROMPT}\n\n{brief}\n\nCURRENT DRAFT\n{draft_json}"
        messages = [
            {"role": "system", "content": state},
            *session.history[-HISTORY_MESSAGES:],
            {"role": "user", "content": message},
        ]
        schema = output_schema(catalog)

        async def build_update() -> dict[str, Any]:
            # Reasoning tokens count toward max_tokens: give them room, and fall back to a
            # non-reasoning call (which cannot be cut off mid-thought) if the answer is unusable.
            try:
                return await llm.chat_json(messages, schema, name="agent_update", max_tokens=3000, think=True)
            except Exception as exc:
                logger.warning(f"Builder reasoning call failed, retrying without reasoning: {exc}")
                return await llm.chat_json(messages, schema, name="agent_update", max_tokens=1200, think=False)

        moderation, built = await asyncio.gather(moderate(llm, message), build_update(), return_exceptions=True)
        if isinstance(built, BaseException) or isinstance(moderation, BaseException):
            logger.warning(f"Builder model call failed: {built if isinstance(built, BaseException) else moderation}")
            return {"reply": UNAVAILABLE_REPLY, "intent": "clarify", **_public(config, warnings)}
        allowed, category = moderation
        if not allowed and category == "unavailable":
            # A safety-check outage is not the user's fault: do not count it as a refusal.
            return {"reply": UNAVAILABLE_REPLY, "intent": "clarify", **_public(config, warnings)}
        if not allowed:
            return declined(
                OFF_TOPIC_REPLY if category == "injection" else REFUSED_REPLY, "refused", f"moderation:{category}"
            )
        intent = built.get("intent")
        if intent == "off_topic":
            return declined(OFF_TOPIC_REPLY, "off_topic", "model_off_topic")
        if intent == "refused":
            return declined(REFUSED_REPLY, "refused", "model_refused")

        merged = merge_updates(config, built.get("updates"))
        candidate, candidate_warnings = normalize_config(merged, catalog)
        persona_text = _persona_text(candidate)
        if persona_text != _persona_text(config):
            if looks_like_injection(persona_text) or echoes_prompt(persona_text, SYSTEM_PROMPT, size=8):
                return declined(REFUSED_REPLY, "refused", "persona_pattern")
            persona_ok, persona_category = await moderate(llm, persona_text)
            if not persona_ok and persona_category == "unavailable":
                return {"reply": UNAVAILABLE_REPLY, "intent": "clarify", **_public(config, warnings)}
            if not persona_ok:
                return declined(REFUSED_REPLY, "refused", f"persona_moderation:{persona_category}")
        reply = (built.get("reply") or "").strip()
        reply = reply[:400]
        if not reply or echoes_prompt(reply, SYSTEM_PROMPT) or looks_like_injection(reply):
            reply = "Done. Anything else you'd like to change about your agent?"
        session.draft = candidate
        session.turns += 1
        session.history += [{"role": "user", "content": message}, {"role": "assistant", "content": reply}]
        session.history = session.history[-(HISTORY_MESSAGES * 2) :]
        return {
            "reply": reply,
            "intent": "build" if intent != "clarify" else "clarify",
            **_public(candidate, candidate_warnings),
        }

    @app.post("/builder-api/turn")
    async def turn(request: Request, body: TurnRequest) -> dict[str, Any]:
        guard_rate(request)
        session = store.get(body.session_id)
        if session is None:
            raise HTTPException(status_code=404, detail="Unknown or expired builder session.")
        # One request at a time per session, so parallel turns cannot pass the turn and refusal limits.
        async with session.lock:
            try:
                return await asyncio.wait_for(run_turn(session, body), TURN_DEADLINE_SECONDS)
            except TimeoutError:
                logger.warning("Builder turn timed out")
                config, warnings = normalize_config(session.draft, await load_catalog())
                return {"reply": UNAVAILABLE_REPLY, "intent": "clarify", **_public(config, warnings)}

    async def check(raw: dict[str, Any]) -> dict[str, Any]:
        catalog = await load_catalog()
        config, warnings = normalize_config(raw, catalog)
        persona_text = _persona_text(config)
        errors: list[str] = []
        if persona_text:
            if looks_like_injection(persona_text) or echoes_prompt(persona_text, SYSTEM_PROMPT, size=8):
                errors.append("The persona text tries to change the agent's safety rules.")
            else:
                allowed, category = await moderate(llm, persona_text)
                if not allowed and category == "unavailable":
                    errors.append("The safety check is unavailable right now. Please try again.")
                elif not allowed:
                    errors.append("The persona text is not acceptable for a voice agent.")
        result = {**_public(config, warnings), "errors": errors}
        if not errors and result["ready"]:
            session_config = to_session_config(config)
            if signing_key:
                # Proves to the voice agent that this persona passed the builder's checks.
                session_config["persona_token"] = sign_persona(signing_key, session_config["persistent_prompt"])
            result["session_config"] = session_config
        return result

    @app.post("/builder-api/validate")
    async def validate(request: Request, body: ValidateRequest) -> dict[str, Any]:
        guard_rate(request)
        return await check(body.config)

    @app.post("/builder-api/load")
    async def load(request: Request, body: LoadRequest) -> dict[str, Any]:
        guard_rate(request)
        session = store.get(body.session_id)
        if session is None:
            raise HTTPException(status_code=404, detail="Unknown or expired builder session.")
        async with session.lock:
            result = await check(body.config)
            if not result["errors"]:
                session.draft = result["draft_config"]
                session.history = []
        return result

    return app


def app_factory() -> FastAPI:
    """Entry point for ``uvicorn agent_builder.app:app_factory --factory``."""
    return create_app()
