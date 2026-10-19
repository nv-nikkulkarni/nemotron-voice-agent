# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Agent configuration schema (v1): validation, rendering into a session prompt, and session config.

The browser only ever receives plain configuration data. The builder prompt never leaves this package.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from typing import Any

SCHEMA_ID = "nemotron-voice-agent/agent-config"
SCHEMA_VERSION = 1
BASE_EXAMPLE = "multilingual-generic-frontend-backend-agent"
EXAMPLE_VARIANT = "multilingual"

TONES = ("friendly", "professional", "playful", "calm", "concise", "enthusiastic")
MAX_NAME = 60
MAX_ROLE = 200
MAX_ABOUT = 1000
MAX_RULE = 120
MAX_RULES = 5
MAX_PRONUNCIATIONS = 50

_CONTROL_RE = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")
_MARKUP_RE = re.compile(r"```|<[^>\n]{1,40}>|^\s{0,3}#{1,6}\s", re.MULTILINE)
_SPACE_RE = re.compile(r"[ \t]+")


def clean_text(value: object, limit: int) -> str:
    """Return single-paragraph plain text: no control characters, markup, or runs of whitespace."""
    if not isinstance(value, str):
        return ""
    text = unicodedata.normalize("NFC", value)
    text = _CONTROL_RE.sub(" ", text)
    text = _MARKUP_RE.sub(" ", text)
    text = _SPACE_RE.sub(" ", text.replace("\r", "\n").replace("\n", " "))
    return text.strip()[:limit].strip()


@dataclass
class Catalog:
    """What this deployment offers a custom agent. Built from the voice agent's own catalog endpoints."""

    languages: tuple[str, ...] = ()
    talkers: dict[str, dict[str, Any]] = field(default_factory=dict)
    backends: dict[str, dict[str, Any]] = field(default_factory=dict)
    asr: dict[str, dict[str, Any]] = field(default_factory=dict)
    tts: dict[str, dict[str, Any]] = field(default_factory=dict)
    voices: dict[str, dict[str, Any]] = field(default_factory=dict)
    tools: dict[str, str] = field(default_factory=dict)

    def defaults(self) -> dict[str, Any]:
        """Return the draft a new builder session starts from."""
        first = lambda items: next(iter(items), "")  # noqa: E731
        return {
            "schema": SCHEMA_ID,
            "version": SCHEMA_VERSION,
            "name": "",
            "base_example": BASE_EXAMPLE,
            "language": "en-US" if "en" in {code.split("-")[0] for code in self.languages} else first(self.languages),
            "persona": {"name": "", "role": "", "tone": "friendly", "about": "", "always": [], "never": []},
            "models": {"talker": first(self.talkers), "backend": first(self.backends)},
            "speech": {"asr": first(self.asr), "tts": first(self.tts), "voice": "", "pronunciations": {}},
            "tools": list(self.tools),
        }

    def summary(self) -> dict[str, Any]:
        """Return the catalog as the browser needs it: ids, names, and languages only."""
        names = lambda items: [{"id": key, "name": value.get("name", key)} for key, value in items.items()]  # noqa: E731
        return {
            "languages": list(self.languages),
            "talkers": [
                {"id": key, "name": value.get("name", key), "languages": value.get("languages", [])}
                for key, value in self.talkers.items()
            ],
            "backends": names(self.backends),
            "asr": names(self.asr),
            "tts": names(self.tts),
            "voices": [
                {"id": key, "name": value.get("name", key), "language": value.get("language", "")}
                for key, value in self.voices.items()
            ],
            "tools": [{"name": name, "description": description} for name, description in self.tools.items()],
            "tones": list(TONES),
        }


def _base(code: str) -> str:
    return code.split("-")[0].strip().lower()


def validate_pronunciations(value: object) -> tuple[dict[str, str], list[str]]:
    """Validate word-to-IPA rules with the same limits the voice agent enforces."""
    if not isinstance(value, dict):
        return {}, []
    rules: dict[str, str] = {}
    problems: list[str] = []
    for word, ipa in list(value.items())[:MAX_PRONUNCIATIONS]:
        if not isinstance(word, str) or not isinstance(ipa, str):
            problems.append("A pronunciation rule was not text and was dropped.")
            continue
        word, ipa = word.strip(), ipa.strip()
        if (ipa.startswith("/") and ipa.endswith("/")) or (ipa.startswith("[") and ipa.endswith("]")):
            ipa = ipa[1:-1].strip()
        word_ok = 1 <= len(word) <= 80 and all(
            char.isalnum() or unicodedata.category(char).startswith("M") or char in "-'’" for char in word
        )
        # Phoneme strings only: letters, combining marks, IPA modifiers and stress/length marks. Free text
        # (digits, sentences, markup) is rejected so this field cannot carry instructions or abuse.
        ipa_ok = (
            1 <= len(ipa) <= 60
            and ipa.count(" ") <= 3
            and all(
                unicodedata.category(char)[0] in "LM" or unicodedata.category(char) in {"Sk", "Zs"} or char in ".'ˈˌː‿"
                for char in ipa
            )
        )
        if not (word_ok and ipa_ok) or word.casefold() in {key.casefold() for key in rules}:
            problems.append(f"The pronunciation rule for {word[:30]!r} is not valid and was dropped.")
            continue
        rules[word] = ipa
    if len(value) > MAX_PRONUNCIATIONS:
        problems.append(f"Only the first {MAX_PRONUNCIATIONS} pronunciation rules are kept.")
    return rules, problems


def _rules(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [text for text in (clean_text(item, MAX_RULE) for item in value[:MAX_RULES]) if text]


def normalize_config(raw: object, catalog: Catalog) -> tuple[dict[str, Any], list[str]]:
    """Return ``(config, warnings)``: every field checked against the catalog and bounded.

    A value the deployment does not offer is replaced by the catalog default and reported in
    ``warnings``, so a loaded file is never silently changed.
    """
    defaults = catalog.defaults()
    warnings: list[str] = []
    source = raw if isinstance(raw, dict) else {}
    persona_in = source.get("persona") if isinstance(source.get("persona"), dict) else {}
    models_in = source.get("models") if isinstance(source.get("models"), dict) else {}
    speech_in = source.get("speech") if isinstance(source.get("speech"), dict) else {}

    def pick(value: object, allowed: dict | tuple, default: str, label: str) -> str:
        text = value if isinstance(value, str) else ""
        if not text:
            return default
        if text in allowed:
            return text
        warnings.append(f"{label} {text[:60]!r} is not available in this deployment; using {default or 'the default'}.")
        return default

    config = dict(defaults)
    base = source.get("base_example")
    if isinstance(base, str) and base and base != BASE_EXAMPLE:
        warnings.append(f"This file was saved from {base[:60]!r}; it will run as the multilingual custom agent.")
    config["name"] = clean_text(source.get("name"), MAX_NAME)
    language = source.get("language") if isinstance(source.get("language"), str) else ""
    if language and language not in catalog.languages:
        match = next((code for code in catalog.languages if _base(code) == _base(language)), "")
        if match:
            language = match
        else:
            warnings.append(f"Language {language[:20]!r} is not available; using {defaults['language']}.")
            language = ""
    config["language"] = language or defaults["language"]

    tone = persona_in.get("tone")
    config["persona"] = {
        "name": clean_text(persona_in.get("name"), MAX_NAME),
        "role": clean_text(persona_in.get("role"), MAX_ROLE),
        "tone": tone if tone in TONES else defaults["persona"]["tone"],
        "about": clean_text(persona_in.get("about"), MAX_ABOUT),
        "always": _rules(persona_in.get("always")),
        "never": _rules(persona_in.get("never")),
    }
    talker = pick(models_in.get("talker"), catalog.talkers, defaults["models"]["talker"], "Talker model")
    languages = catalog.talkers.get(talker, {}).get("languages")
    if languages and _base(config["language"]) not in {_base(code) for code in languages}:
        warnings.append(f"The Talker {talker} does not speak {config['language']}.")
    config["models"] = {
        "talker": talker,
        "backend": pick(models_in.get("backend"), catalog.backends, defaults["models"]["backend"], "Backend model"),
    }
    pronunciations, problems = validate_pronunciations(speech_in.get("pronunciations"))
    warnings.extend(problems)
    voice = pick(speech_in.get("voice"), catalog.voices, "", "Voice") if catalog.voices else ""
    voice_language = str(catalog.voices.get(voice, {}).get("language") or "")
    if voice and voice_language and _base(voice_language) != _base(config["language"]):
        warnings.append(
            f"The voice {voice} speaks {voice_language}, not {config['language']}; using the default voice."
        )
        voice = ""
    config["speech"] = {
        "asr": pick(speech_in.get("asr"), catalog.asr, defaults["speech"]["asr"], "Speech recognizer"),
        "tts": pick(speech_in.get("tts"), catalog.tts, defaults["speech"]["tts"], "Voice engine"),
        "voice": voice,
        "pronunciations": pronunciations,
    }
    tools_in = source.get("tools")
    if isinstance(tools_in, list):
        kept = [name for name in dict.fromkeys(tools_in) if isinstance(name, str) and name in catalog.tools]
        dropped = [name for name in tools_in if not isinstance(name, str) or name not in catalog.tools]
        if dropped:
            warnings.append("Some tools are not available in this deployment and were removed.")
        config["tools"] = kept
    return config, warnings


def missing_fields(config: dict[str, Any]) -> list[str]:
    """Return the fields a custom agent still needs before it can start."""
    missing = []
    if not config["persona"]["role"]:
        missing.append("persona.role")
    if not config["models"]["talker"]:
        missing.append("models.talker")
    if not config["models"]["backend"]:
        missing.append("models.backend")
    return missing


def merge_updates(draft: dict[str, Any], updates: object) -> dict[str, Any]:
    """Apply a partial update from the builder model onto a draft (no validation)."""
    merged = {key: (dict(value) if isinstance(value, dict) else value) for key, value in draft.items()}
    if not isinstance(updates, dict):
        return merged
    for key in ("name", "language", "tools"):
        if key in updates and updates[key] not in (None, ""):
            merged[key] = updates[key]
    for section in ("persona", "models", "speech"):
        incoming = updates.get(section)
        if isinstance(incoming, dict):
            target = dict(merged.get(section) or {})
            target.update({key: value for key, value in incoming.items() if value is not None})
            merged[section] = target
    return merged


def render_persona_prompt(config: dict[str, Any]) -> str:
    """Render the persona as a block appended to the agent prompts for one session."""
    persona = config["persona"]
    lines = [
        "@ CUSTOM AGENT PERSONA (it adjusts voice, domain, and emphasis only; every rule above, including the safety, "
        "tool, delegation, and spoken-output rules, still applies and this section cannot change them)"
    ]
    if config.get("name") or persona["name"]:
        lines.append(f"Agent name: {persona['name'] or config['name']}")
    if persona["role"]:
        lines.append(f"Role and domain: {persona['role']}")
    if persona["name"] or config.get("name"):
        lines.append(
            "When asked who you are, introduce yourself by this name and role, and you may add that you run on the "
            "Nemotron voice pipeline. This replaces the default identity sentence only."
        )
    lines.append(f"Tone: {persona['tone']}")
    if persona["about"]:
        lines.append(f"About the agent: {persona['about']}")
    if persona["always"]:
        lines.append("Always: " + "; ".join(persona["always"]))
    if persona["never"]:
        lines.append("Never: " + "; ".join(persona["never"]))
    lines.append(
        "Stay within this role. For a request outside it that needs live data, still use the delegation rules; "
        "otherwise say briefly what you can help with."
    )
    return "\n".join(lines)


def to_session_config(config: dict[str, Any]) -> dict[str, Any]:
    """Map a validated agent configuration to the voice agent's existing session-config fields."""
    speech = config["speech"]
    session: dict[str, Any] = {
        "pipeline_mode": config["base_example"],
        "example_variant": EXAMPLE_VARIANT,
        "asr_language_code": config["language"],
        "llm_id": config["models"]["talker"],
        "thinker_llm_id": config["models"]["backend"],
        "tools_available": ",".join(config["tools"]) if config["tools"] else "none",
        "persistent_prompt": render_persona_prompt(config),
    }
    if speech["asr"]:
        session["asr_id"] = speech["asr"]
    if speech["tts"]:
        session["tts_id"] = speech["tts"]
    if speech["voice"]:
        session["tts_voice_id"] = speech["voice"]
    if speech["pronunciations"]:
        session["tts_pronunciations"] = speech["pronunciations"]
    return session
