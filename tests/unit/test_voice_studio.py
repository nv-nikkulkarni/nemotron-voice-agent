# SPDX-License-Identifier: BSD-2-Clause
"""Voice studio request boundaries and isolated pronunciation overrides."""

# ruff: noqa: D103
import json

import pytest
from fastapi.testclient import TestClient

import server
from utils import filter_session_config, resolve_ipa_dictionary, validate_pronunciation_overrides


@pytest.mark.parametrize(
    "value",
    [
        [],
        None,
        {"name": 1},
        {"two words": "tu"},
        {"x": "<speak>"},
        {"x": "AH0"},
        {"x": "a\n"},
        {"x": "a" * 201},
        {"A": "a", "a": "b"},
        {str(i): "a" for i in range(51)},
    ],
)
def test_invalid_pronunciation_requests_are_rejected(value):
    # Whitespace at the edges is normalized; internal controls are rejected.
    if value == {"x": "a\n"}:
        value = {"x": "a\nb"}
    with pytest.raises(ValueError):
        validate_pronunciation_overrides(value)


def test_override_updates_aliases_without_changing_default_or_other_session(monkeypatch, tmp_path):
    registry = tmp_path / "ipa.json"
    registry.write_text(json.dumps({"Nemotron": "old", "nemotron": "old", "NVIDIA": "unchanged"}))
    monkeypatch.setenv("TTS_IPA_FILE_PATH", str(registry))
    fixed = resolve_ipa_dictionary("magpie-tts-multilingual", {" nemotron ": "/ˈnimoʊˌtɹɑn/"})
    assert fixed["Nemotron"] == fixed["nemotron"] == "ˈnimoʊˌtɹɑn"
    assert fixed["NVIDIA"] == "unchanged"
    assert resolve_ipa_dictionary("magpie-tts-multilingual")["Nemotron"] == "old"
    assert resolve_ipa_dictionary("chatterbox-tts-multilingual", {"Nemotron": "a"}) is None
    assert json.loads(registry.read_text())["Nemotron"] == "old"


def test_no_deployer_file_still_allows_session_rules(monkeypatch):
    monkeypatch.delenv("TTS_IPA_FILE_PATH", raising=False)
    assert resolve_ipa_dictionary("magpie-tts-zeroshot", {"Codex": "ˈkoʊdɛks"}) == {
        "Codex": "ˈkoʊdɛks",
        "codex": "ˈkoʊdɛks",
    }


def test_catalog_hydration_preserves_structured_rules():
    config = filter_session_config({"tts_id": "cloud-nim:magpie-tts", "tts_pronunciations": {"Codex": "ˈkoʊdɛks"}})
    assert config["tts_pronunciations"] == {"Codex": "ˈkoʊdɛks"}


def test_preview_and_live_share_validation_and_defaults_endpoint(monkeypatch, tmp_path):
    registry = tmp_path / "ipa.json"
    registry.write_text(json.dumps({"Nemotron": "ˈnimoʊˌtɹɑn"}))
    monkeypatch.setenv("TTS_IPA_FILE_PATH", str(registry))
    client = TestClient(server.create_app())
    assert client.get("/api/tts/pronunciations").json() == {"entries": {"Nemotron": "ˈnimoʊˌtɹɑn"}}
    invalid = {
        "pipeline_mode": "generic-frontend-backend-agent",
        "tts_id": "cloud-nim:magpie-tts",
        "tts_pronunciations": {"two words": "tu"},
    }
    with pytest.raises(ValueError, match="single words"):
        server._sanitize_session_config(invalid)
    assert client.post("/api/tts/preview", json={**invalid, "text": "Hello"}).status_code == 400
