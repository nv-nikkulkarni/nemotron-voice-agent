# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause

# ruff: noqa: D103

"""Tests for the Multilingual Generic Frontend Backend Assistant example."""

from __future__ import annotations

import json
import os
from unittest.mock import patch

import pytest

import examples_registry
from examples.frontend_backend_agent import pipeline
from examples.frontend_backend_agent.src import tool_handlers
from examples.frontend_backend_agent.src.session_language import text_in_language
from utils import load_prompt_catalog, render_prompt_addon

EXAMPLE = "multilingual-generic-frontend-backend-agent"


def test_registry_entry_offers_the_requested_models() -> None:
    example = examples_registry.EXAMPLES[EXAMPLE]

    assert example["capabilities"] == ["session_languages"]
    assert example["services"]["llm"] == ["gemma-4-31b", "nemotron-super-vl", "nemotron-lightning"]
    assert example["services"]["thinker-llm"][0] == "nemotron-super-vl"
    assert example["services"]["asr"][0] == "nemotron-asr-streaming-multilingual"
    assert example["domain_profile"] == "generic"
    assert example["defaults"]["default_session_language"] == "en-US"


@pytest.mark.parametrize("recipe", ["server", "single-gpu"])
def test_self_hosted_defaults_use_gemma_talker_and_multilingual_asr(recipe: str) -> None:
    with patch.dict(os.environ, {"SERVICE_RECIPE": recipe, "NVIDIA_API_KEY": ""}):
        defaults = examples_registry.metadata(examples_registry._lookup_by_key(EXAMPLE))["defaults"]

    assert defaults["llm"][0]["id"] == "self-hosted:gemma-4-31b"
    assert defaults["asr"][0]["id"] == "self-hosted:nemotron-asr-streaming-multilingual"


def test_server_recipe_thinker_defaults_to_super_vl() -> None:
    with patch.dict(os.environ, {"SERVICE_RECIPE": "server", "NVIDIA_API_KEY": ""}):
        defaults = examples_registry.metadata(examples_registry._lookup_by_key(EXAMPLE))["defaults"]

    assert defaults["thinker-llm"][0]["id"] == "self-hosted:nemotron-super-vl"


def test_session_language_is_locked_from_the_client_choice() -> None:
    body = {"pipeline_mode": EXAMPLE, "asr_language_code": "es-US"}

    assert pipeline._resolve_session_language(body, {}) == "es-US"


@pytest.mark.parametrize("code", ["", "auto", "AUTO"])
def test_session_language_falls_back_to_the_registry_default(code: str) -> None:
    body = {"pipeline_mode": EXAMPLE, "asr_language_code": code}

    assert pipeline._resolve_session_language(body, {"language_code": "auto"}) == "en-US"


def test_examples_without_session_languages_stay_unlocked() -> None:
    body = {"pipeline_mode": "generic-frontend-backend-agent", "asr_language_code": "fr-FR"}

    assert pipeline._resolve_session_language(body, {}) == ""


def test_llm_language_support_follows_the_selected_model() -> None:
    assert "ja" in pipeline._selected_llm_supported_languages({"llm_id": "self-hosted:nemotron-lightning"}, {})
    assert pipeline._selected_llm_supported_languages({"llm_id": "custom-1"}, {"supported_languages": ["en"]}) is None
    with pytest.raises(ValueError, match="Unknown built-in LLM"):
        pipeline._selected_llm_supported_languages({"llm_id": "self-hosted:missing"}, {})


@pytest.mark.parametrize(
    "key",
    [pipeline.FIXED_SESSION_LANGUAGE_ADDON_KEY, pipeline.THINKER_SESSION_LANGUAGE_ADDON_KEY],
)
def test_language_addons_render_the_language_name(key: str) -> None:
    rendered = render_prompt_addon(
        "BASE", load_prompt_catalog(pipeline.__file__), key, {"fixed_language_name": "German (Deutsch)"}
    )

    assert rendered.startswith("BASE")
    assert "German (Deutsch)" in rendered
    assert "{fixed_language_name}" not in rendered


def test_language_addons_are_hidden_agent_prompts() -> None:
    assert {"fixed_session_language_addon", "thinker_session_language_addon"} <= set(
        examples_registry.EXAMPLES[EXAMPLE]["agent_prompt_keys"]
    )


def test_tool_handler_module_has_no_direct_delivery_mode() -> None:
    assert not hasattr(tool_handlers, "_tool_result_mode")
    assert not hasattr(tool_handlers, "_should_deliver_directly")
    assert "force_tool_result_mode" not in tool_handlers.build_handlers.__code__.co_varnames


def test_hindi_variant_locks_the_session_whatever_the_client_sends() -> None:
    body = {"pipeline_mode": EXAMPLE, "example_variant": "hindi", "asr_language_code": "fr-FR"}

    variant = pipeline._resolve_variant(body)

    assert variant is not None and variant["llm"] == "gemma-4-31b"
    assert pipeline._resolve_session_language(body, {}, variant) == "hi-IN"


def test_multilingual_variant_keeps_the_client_language() -> None:
    body = {"pipeline_mode": EXAMPLE, "example_variant": "multilingual", "asr_language_code": "ja-JP"}

    assert pipeline._resolve_session_language(body, {}, pipeline._resolve_variant(body)) == "ja-JP"


def test_unknown_variant_is_ignored() -> None:
    body = {"pipeline_mode": EXAMPLE, "example_variant": "klingon", "asr_language_code": "de-DE"}

    variant = pipeline._resolve_variant(body)

    assert variant is None
    assert pipeline._resolve_session_language(body, {}, variant) == "de-DE"


def test_variants_are_published_to_the_client() -> None:
    meta = examples_registry.metadata(examples_registry.find(EXAMPLE, ignore_lock=True))

    assert [variant["id"] for variant in meta["variants"]] == ["hindi", "multilingual"]
    hindi = meta["variants"][0]
    assert (hindi["session_language"], hindi["llm"]) == ("hi-IN", "gemma-4-31b")
    assert hindi["tts_voice"] == "Leo"


def test_variant_voice_name_picks_the_catalog_voice_for_the_language(monkeypatch) -> None:
    from examples.shared import prewarm

    catalog = {
        "voices": [
            {"id": "Magpie-Multilingual.HI-IN.Aria", "name": "Aria", "language": "hi-IN"},
            {"id": "Magpie-Multilingual.HI-IN.Leo", "name": "Leo", "language": "hi-IN"},
            {"id": "Magpie-Multilingual.EN-US.Leo", "name": "Leo", "language": "en-US"},
        ]
    }
    monkeypatch.setattr(prewarm, "load_voice_map", lambda **_: {"hi-in": "Magpie-Multilingual.HI-IN.Aria"})
    monkeypatch.setattr(prewarm, "config_store", {"tts": catalog})

    assert (
        prewarm.resolve_voice_for_language("hi-IN", "", preferred_voice_name="Leo") == "Magpie-Multilingual.HI-IN.Leo"
    )
    assert prewarm.resolve_voice_for_language("hi-IN", "") == "Magpie-Multilingual.HI-IN.Aria"


def test_variant_llm_must_be_offered_by_the_example() -> None:
    entry = {"label": "x", "bot": "m:bot", "services": {"llm": ["nemotron-lightning"]}}
    entry["variants"] = {"hindi": {"label": "Hindi", "llm": "gemma-4-31b"}}

    with pytest.raises(RuntimeError, match="not listed under services.llm"):
        examples_registry._parse_example("demo", entry)


def test_variant_rejects_unknown_fields() -> None:
    entry = {"label": "x", "bot": "m:bot", "services": {"llm": ["nemotron-lightning"]}}
    entry["variants"] = {"hindi": {"label": "Hindi", "voice": "x"}}

    with pytest.raises(RuntimeError, match="unsupported fields"):
        examples_registry._parse_example("demo", entry)


def test_hindi_tool_results_are_split_on_the_danda() -> None:
    from examples.frontend_backend_agent.generic.result_formatters import _sentences

    assert _sentences("दिल्ली में धूप है। तापमान तीस डिग्री है।") == ["दिल्ली में धूप है।", "तापमान तीस डिग्री है।"]


def test_weather_grounding_is_english_only() -> None:
    from types import SimpleNamespace

    from examples.frontend_backend_agent.src.reliable_talker import _post_result_invalid_reason

    delta = SimpleNamespace(content="दिल्ली में अभी तीस डिग्री सेल्सियस है।", tool_calls=None)
    chunks = [SimpleNamespace(choices=[SimpleNamespace(delta=delta)])]
    payload = {
        "type": "tool_result",
        "tool": "get_weather",
        "status": "success",
        "data": {"city": "Delhi", "temperature": 30, "temperature_unit": "C"},
    }

    assert _post_result_invalid_reason(chunks, payload) == "weather_grounding"
    assert _post_result_invalid_reason(chunks, payload, english_grounding=False) is None


def test_session_config_keeps_the_example_variant() -> None:
    from utils import filter_session_config

    assert filter_session_config({"pipeline_mode": EXAMPLE, "example_variant": "hindi"})["example_variant"] == "hindi"


def test_nvcf_invocation_hosts_use_the_invocation_key() -> None:
    from utils import nvidia_api_key

    env = {"NVIDIA_API_KEY": "nvapi-cloud", "NVCF_API_KEY": "nvapi-invoke"}
    with patch.dict(os.environ, env):
        assert nvidia_api_key(base_url="https://abc.invocation.api.nvcf.nvidia.com/v1") == "nvapi-invoke"
        assert nvidia_api_key(base_url="http://nvidia-llm:8000/v1") == "nvapi-cloud"
        assert nvidia_api_key() == "nvapi-cloud"
    with patch.dict(os.environ, {"NVIDIA_API_KEY": "nvapi-cloud", "NVCF_API_KEY": ""}):
        assert nvidia_api_key(base_url="https://abc.invocation.api.nvcf.nvidia.com/v1") == "nvapi-cloud"


@pytest.mark.parametrize(
    ("language", "query", "filler", "accepted"),
    [
        # Session 458a6adec133: an English filler in a Hindi session must not be spoken.
        ("hi-IN", "What can you do?", "Let me check what I can do.", False),
        ("hi-IN", "What can you do?", "मैं अभी देखता हूँ।", True),
        ("hi-IN", "दिल्ली में मौसम कैसा है?", "मैं दिल्ली का मौसम देख रहा हूँ।", True),
        ("ja-JP", "東京の天気は?", "Let me check the weather.", False),
        ("ja-JP", "東京の天気は?", "東京の天気を確認しますね。", True),
        ("es-US", "¿Qué tiempo hace en Madrid?", "Let me check Madrid weather.", False),
        ("es-US", "¿Qué tiempo hace en Madrid?", "Un momento, reviso el clima de Madrid.", True),
        ("hi-IN", "What can you do?", "मैं देखता हूँ, क्या मदद कर सकता हूँ?", False),
        ("hi-IN", "What can you do?", "मैं backend से पूछ रहा हूँ।", False),
        # English sessions keep the original grounded check.
        ("en-US", "What is the weather in Pune?", "Let me check Pune weather.", True),
        ("", "What is the weather in Pune?", "Let me check Pune weather.", True),
        ("en-US", "What is the weather in Pune?", "Let me check that for you.", False),
    ],
)
def test_talker_filler_follows_the_session_language(language: str, query: str, filler: str, accepted: bool) -> None:
    result = tool_handlers._validated_talker_filler(query, filler, language)

    assert (result == filler) is accepted


def test_language_addon_asks_for_fillers_in_the_session_language() -> None:
    catalog = load_prompt_catalog(pipeline.__file__)
    rendered = render_prompt_addon("", catalog, "fixed_session_language_addon", {"fixed_language_name": "Hindi"})

    assert "call_backend.filler_text in Hindi" in rendered


@pytest.mark.parametrize("language", ["hi-IN", "de-DE", "es-US", "fr-FR", "it-IT", "ja-JP", "ko-KR", "pt-BR", "zh-CN"])
def test_every_non_english_session_has_a_fallback_filler_in_its_language(language: str) -> None:
    filler = tool_handlers._session_fallback_filler(language)

    assert filler
    # The fallback must itself pass the session-language filler check.
    assert tool_handlers._validated_foreign_filler(filler, language.split("-")[0]) == filler


@pytest.mark.parametrize("language", ["", "en-US", "en-GB"])
def test_english_sessions_have_no_fallback_filler(language: str) -> None:
    assert tool_handlers._session_fallback_filler(language) == ""


@pytest.mark.parametrize(
    ("mode", "catalog_code", "expected"),
    [
        ("", "auto", "hi-IN"),
        ("auto", "auto", "auto"),
        ("locked", "auto", "hi-IN"),
        ("auto", "", "hi-IN"),
        ("auto", "hi-IN", "hi-IN"),
    ],
)
def test_fixed_sessions_keep_automatic_asr_when_supported(mode: str, catalog_code: str, expected: str) -> None:
    env = {"FRONTEND_BACKEND_FIXED_LANGUAGE_ASR": mode} if mode else {}
    with patch.dict(os.environ, env, clear=False):
        if not mode:
            os.environ.pop("FRONTEND_BACKEND_FIXED_LANGUAGE_ASR", None)
        assert pipeline._fixed_session_asr_language("hi-IN", {"language_code": catalog_code}) == expected


def test_unlocked_sessions_leave_the_asr_language_to_the_client() -> None:
    assert pipeline._fixed_session_asr_language("", {"language_code": "auto"}) == ""


@pytest.mark.parametrize(
    ("text", "language", "expected"),
    [
        # Replies from Hindi SQA session 41e2d1c05bd7.
        ("It's 6:46 PM IST.", "hi-IN", False),
        ("Here's my architecture.", "hi-IN", False),
        ("London is at 20.7 degrees Celsius with patchy rain nearby.", "hi-IN", False),
        ("NVIDIA, ticker NVDA, is trading at 221.3 USD.", "hi-IN", False),
        ("मुंबई में 28.9 डिग्री सेल्सियस है जिसमें धुंधली धुंध है।", "hi-IN", True),
        ("NVIDIA का शेयर 221.3 USD पर कारोबार कर रहा है।", "hi-IN", True),
        ("अभी शाम के 6:46 बजे हैं।", "hi-IN", True),
        ("Es sind gerade 18:46 Uhr.", "de-DE", True),
        ("It is 6:46 PM right now.", "de-DE", False),
        ("ただいま午後6時46分です。", "ja-JP", True),
        ("It's 6:46 PM IST.", "en-US", True),
        ("It's 6:46 PM IST.", "", True),
    ],
)
def test_text_in_language(text: str, language: str, expected: bool) -> None:
    from examples.frontend_backend_agent.src.session_language import text_in_language

    assert text_in_language(text, language) is expected


def test_english_post_result_reply_in_hindi_session_is_retried() -> None:
    from types import SimpleNamespace

    from examples.frontend_backend_agent.src.reliable_talker import _post_result_correction, _post_result_invalid_reason

    delta = SimpleNamespace(content="It's 6:46 PM IST.", tool_calls=None)
    chunks = [SimpleNamespace(choices=[SimpleNamespace(delta=delta)])]
    payload = {
        "type": "tool_result",
        "tool": "get_current_time",
        "status": "success",
        "response_text": "It's 6:46 PM IST.",
    }

    assert _post_result_invalid_reason(chunks, payload, session_language="hi-IN") == "wrong_language"
    assert _post_result_invalid_reason(chunks, payload, session_language="en-US") is None
    assert "Hindi" in _post_result_correction("wrong_language", "hi-IN")


def test_talker_projection_states_the_reply_language() -> None:
    payload = {"type": "tool_result", "tool": "get_current_time", "status": "success", "response_text": "It's 6:46 PM."}

    hindi = tool_handlers._talker_result_projection(payload, "hi-IN")
    english = tool_handlers._talker_result_projection(payload, "en-US")

    assert "Hindi" in hindi["reply_language"]
    assert "never read the English aloud" in hindi["reply_instruction"]
    assert "reply_language" not in english


def test_post_result_reply_that_only_repeats_the_filler_is_retried() -> None:
    from types import SimpleNamespace

    from examples.frontend_backend_agent.src.reliable_talker import _post_result_correction, _post_result_invalid_reason

    def chunks(text: str) -> list:
        return [SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content=text, tool_calls=None))])]

    payload = {"type": "tool_result", "tool": "generate_random_number", "status": "success", "response_text": "68."}
    filler = tool_handlers._session_fallback_filler("hi-IN")

    # Session 3be695b9a333 answered a finished random-number result with the filler again.
    assert _post_result_invalid_reason(chunks(filler), payload, session_language="hi-IN") == "filler_replay"
    assert _post_result_invalid_reason(chunks(f"{filler} आपकी संख्या 68 है।"), payload, session_language="hi-IN") is None
    assert "result itself" in _post_result_correction("filler_replay", "hi-IN")


@pytest.mark.parametrize(
    ("reply", "invalid"),
    [
        # Session 0c04a202e853: the Talker's own Hindi filler repeated as the final reply.
        ("मैं आर्किटेक्चर दिखाता हूँ", True),
        ("मैं आर्किटेक्चर दिखाता हूँ।", True),
        ("मैं आर्किटेक्चर दिखाता हूँ यह वाक् पहचान से बोलने तक की पाइपलाइन है।", True),
        ("यह वाक् पहचान से बोलने तक की पाइपलाइन है।", False),
    ],
)
def test_post_result_reply_must_not_repeat_the_spoken_filler(reply: str, invalid: bool) -> None:
    from types import SimpleNamespace

    from examples.frontend_backend_agent.src.reliable_talker import _post_result_invalid_reason

    chunks = [SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content=reply, tool_calls=None))])]
    payload = {"type": "tool_result", "tool": "show_architecture", "status": "success", "response_text": "Here."}

    reason = _post_result_invalid_reason(chunks, payload, session_language="hi-IN", spoken_filler="मैं आर्किटेक्चर दिखाता हूँ")
    assert (reason == "filler_replay") is invalid
    assert _post_result_invalid_reason(chunks, payload, session_language="en-US", spoken_filler=reply) is None


class _FakeCompletions:
    def __init__(self, reply: str | Exception) -> None:
        self.reply, self.calls = reply, []

    async def create(self, **kwargs):
        from types import SimpleNamespace

        self.calls.append(kwargs)
        if isinstance(self.reply, Exception):
            raise self.reply
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=self.reply))])


def _talker_with_client(reply: str | Exception):
    from types import SimpleNamespace

    from examples.frontend_backend_agent.src.reliable_talker import ReliableNvidiaLLMService

    talker = ReliableNvidiaLLMService.__new__(ReliableNvidiaLLMService)
    completions = _FakeCompletions(reply)
    talker._client = SimpleNamespace(chat=SimpleNamespace(completions=completions))
    talker._settings = SimpleNamespace(model="google/gemma-4-31b-it")
    return talker, completions


@pytest.mark.parametrize(
    ("reply", "language", "expected", "called"),
    [
        # Session 10afa77bc7e7 spoke this English fallback in a Hindi session.
        ("1 से 100 के बीच आपकी यादृच्छिक संख्या 52 है।", "hi-IN", "1 से 100 के बीच आपकी यादृच्छिक संख्या 52 है।", True),
        ("Your random number between 1 and 100 is 52.", "hi-IN", "", True),
        (RuntimeError("boom"), "hi-IN", "", True),
        ("unused", "en-US", "", False),
    ],
)
def test_last_resort_fallback_is_translated_for_the_session(reply, language: str, expected: str, called: bool) -> None:
    import asyncio

    talker, completions = _talker_with_client(reply)

    result = asyncio.run(talker._translate_for_session("Your random number between 1 and 100 is 52.", language))

    assert result == expected
    assert bool(completions.calls) is called


MULTILINGUAL_PROMPT_KEYS = ("hindi_talker", "hindi_thinker", "multilingual_talker", "multilingual_thinker")


def test_language_prompts_are_hidden_agent_prompts_of_the_example() -> None:
    assert set(MULTILINGUAL_PROMPT_KEYS) <= set(examples_registry.EXAMPLES[EXAMPLE]["agent_prompt_keys"])


def test_variants_point_at_their_own_prompt_pair() -> None:
    hindi = examples_registry.find_variant(EXAMPLE, "hindi")
    multi = examples_registry.find_variant(EXAMPLE, "multilingual")

    assert (hindi["talker_prompt_addon"], hindi["thinker_prompt_addon"]) == ("hindi_talker", "hindi_thinker")
    assert (multi["talker_prompt_addon"], multi["thinker_prompt_addon"]) == (
        "multilingual_talker",
        "multilingual_thinker",
    )


def test_variant_few_shots_replace_the_english_demonstrations() -> None:
    hindi = examples_registry.find_variant(EXAMPLE, "hindi")
    key = pipeline._talker_protocol_prompt_key("generic_talker", hindi)
    shots = pipeline._load_prompt_few_shots("generic_talker", custom_prompt=False, protocol_prompt_key=key)

    assert key == "hindi_talker"
    spoken = [m["content"] for m in shots if m["role"] == "assistant" and m["content"]]
    assert spoken and all(text_in_language(text, "hi-IN") for text in spoken)
    calls = [m["tool_calls"][0]["function"] for m in shots if m["role"] == "assistant" and m.get("tool_calls")]
    assert calls and all(call["name"] == "call_backend" for call in calls)
    for call in calls:
        arguments = json.loads(call["arguments"])
        assert text_in_language(arguments["filler_text"], "hi-IN")
        assert text_in_language(arguments["query"], "hi-IN")


def test_domain_demonstrations_are_used_without_a_variant_prompt() -> None:
    assert pipeline._talker_protocol_prompt_key("generic_talker", None) == "generic_talker"


def test_every_demonstration_result_is_a_valid_async_tool_envelope() -> None:
    for key in ("hindi_talker", "multilingual_talker"):
        shots = pipeline._load_prompt_few_shots(key, custom_prompt=False, protocol_prompt_key=key)
        running = {m["tool_call_id"] for m in shots if m["role"] == "tool"}
        finished = {json.loads(m["content"])["tool_call_id"] for m in shots if m["role"] == "developer"}
        issued = {m["tool_calls"][0]["id"] for m in shots if m["role"] == "assistant" and m.get("tool_calls")}
        assert running == finished == issued


def test_thinker_sections_keep_the_plan_in_english() -> None:
    catalog = load_prompt_catalog(pipeline.__file__)
    for key in ("hindi_thinker", "multilingual_thinker"):
        content = catalog[key]["content"]
        assert "Never put" in content and "Latin" in content
        assert "response_text" in content
    assert "{fixed_language_name}" in catalog["multilingual_thinker"]["content"]
    assert "{fixed_language_name}" in catalog["multilingual_talker"]["content"]
