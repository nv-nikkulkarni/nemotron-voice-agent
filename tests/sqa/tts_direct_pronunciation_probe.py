"""Synthesize exact registry terms directly through the deployed TTS clients."""

from __future__ import annotations

import json
import os
import wave
from pathlib import Path

import yaml

from examples.shared.prewarm import _create_tts_service
from utils import load_ipa_dictionary

REGISTRY = Path(os.getenv("TTS_IPA_FILE_PATH", "/app/src/examples/shared/pronunciation_registry.yaml"))
OUTPUT = Path(os.getenv("TTS_PROBE_OUTPUT", "/tmp/tts-direct-pronunciation"))
SAMPLE_RATE = 16_000
HIGH_RISK = (
    "NVIDIA",
    "Nemotron",
    "NVCF",
    "NGC",
    "Riva",
    "Magpie",
    "Redis",
    "SeaweedFS",
    "Finnhub",
    "vLLM",
    "H100",
    "Hyderabad",
    "Bengaluru",
    "Dakar",
    "Lagos",
    "Azerbaijan",
    "Jensen",
    "Narendra",
    "NVDA",
    "ChatGPT",
    "OpenAI",
)


def synthesize(server: str, voice: str, model: str, text: str, dictionary: dict[str, str]) -> bytes:
    """Return 16 kHz PCM synthesized directly by one deployed TTS service."""
    service = _create_tts_service(server, voice, model=model)
    service._initialize_client()
    responses = service._service.synthesize_online(
        text,
        service._settings.voice,
        service._settings.language,
        sample_rate_hz=SAMPLE_RATE,
        zero_shot_audio_prompt_file=None,
        zero_shot_quality=service._settings.quality,
        custom_dictionary=dictionary,
    )
    return b"".join(response.audio for response in responses)


def write_wav(path: Path, audio: bytes) -> None:
    """Wrap raw mono PCM in a WAV container for ASR and listening review."""
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(SAMPLE_RATE)
        wav.writeframes(audio)


def main() -> None:
    """Generate category coverage plus high-risk Magpie and Chatterbox clips."""
    raw = yaml.safe_load(REGISTRY.read_text(encoding="utf-8"))
    entries = raw["entries"]
    category_representatives = {entry["category"]: grapheme for grapheme, entry in entries.items()}
    terms = list(dict.fromkeys((*category_representatives.values(), *HIGH_RISK)))
    dictionary = load_ipa_dictionary("magpie-tts-multilingual") or {}
    OUTPUT.mkdir(parents=True, exist_ok=True)
    records: list[dict[str, object]] = []
    for index, term in enumerate(terms, start=1):
        audio = synthesize(
            "tts-service:50051",
            "Magpie-Multilingual.EN-US.Aria",
            "magpie-tts-multilingual",
            term,
            dictionary,
        )
        filename = f"magpie_{index:02d}_{term.lower().replace(' ', '_')}.wav"
        write_wav(OUTPUT / filename, audio)
        records.append(
            {
                "term": term,
                "category": entries[term]["category"],
                "tts": "magpie",
                "dictionary_entries": len(dictionary),
                "bytes": len(audio),
                "wav": filename,
            }
        )

    # Chatterbox is a dictionary-exclusion smoke only; its client receives {}.
    for index, term in enumerate(("NVIDIA", "Magpie", "Chatterbox"), start=1):
        audio = synthesize(
            "chatterbox-tts-service:50051",
            "Chatterbox-Multilingual.en-US.Male",
            "chatterbox-tts-multilingual",
            term,
            {},
        )
        filename = f"chatterbox_{index:02d}_{term.lower()}.wav"
        write_wav(OUTPUT / filename, audio)
        records.append(
            {
                "term": term,
                "category": entries[term]["category"],
                "tts": "chatterbox",
                "dictionary_entries": 0,
                "bytes": len(audio),
                "wav": filename,
            }
        )

    manifest = {
        "schema_version": 1,
        "registry": str(REGISTRY),
        "sample_rate_hz": SAMPLE_RATE,
        "category_representatives": category_representatives,
        "records": records,
    }
    (OUTPUT / "direct_pronunciation_manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(OUTPUT), "clips": len(records), "categories": len(category_representatives)}))


if __name__ == "__main__":
    main()
