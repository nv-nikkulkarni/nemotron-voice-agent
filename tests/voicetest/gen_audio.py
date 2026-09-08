# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause
"""Generate 16 kHz mono PCM16 WAVs of the test utterances with Piper (offline TTS).

Piper synthesizes at the model's native rate (22050 Hz for en_US-lessac-medium);
we downsample to 16000 Hz with ``soxr`` (high quality) because that is the rate
the voice-agent pipeline (ASR + WebSocket transport) expects.

Usage::

    python gen_audio.py               # generate every utterance
    python gen_audio.py weather bmi   # only the named slugs
    python gen_audio.py --list        # list slugs and exit
"""
from __future__ import annotations

import sys
import wave
from pathlib import Path

import numpy as np
import soxr
from piper import PiperVoice

HERE = Path(__file__).resolve().parent
AUDIO_DIR = HERE / "audio"
VOICE_NAME = "en_US-lessac-medium"
MODEL_PATH = HERE / "models" / f"{VOICE_NAME}.onnx"

TARGET_RATE = 16000
LEAD_SILENCE_S = 0.15   # brief silence padding so VAD sees a clean onset
TRAIL_SILENCE_S = 0.15

# slug -> spoken text. Slugs are the stable keys used by run_tests.py.
UTTERANCES: dict[str, str] = {
    # --- generic-assistant: general knowledge + each of the 7 tools + format ---
    "introduce": "Hello, please introduce yourself.",
    "knowledge": "What is the capital of France?",
    "weather": "What's the weather in Tokyo?",
    "currency": "Convert one hundred dollars to euros.",
    "bmi": "What is my B M I if I weigh seventy kilograms and am one point seven five meters tall?",
    "stock": "What is the current stock price of Nvidia?",
    "time": "What time is it in London?",
    "random": "Give me a random number between one and ten.",
    "news": "What are the latest business news headlines?",
    # --- omni-assistant-subagents: completeness + turn-actions + camera-off ---
    "omni_count": "Please count from one to five.",
    "omni_howto": "How do I make a good cup of coffee? Walk me through the steps.",
    "omni_story": "Tell me a ten sentence story about a curious robot.",
    "omni_knowledge": "What is the largest planet in our solar system?",
    "omni_math": "What is seventeen times twenty three?",
    "omni_camera": "What do you see right now on my camera?",
}


def _synthesize_16k(voice: PiperVoice, text: str) -> np.ndarray:
    """Synthesize ``text`` and return an int16 mono array at ``TARGET_RATE``."""
    chunks = []
    src_rate = TARGET_RATE
    for chunk in voice.synthesize(text):
        src_rate = chunk.sample_rate
        chunks.append(chunk.audio_float_array.astype(np.float32))
    if not chunks:
        raise RuntimeError(f"Piper produced no audio for: {text!r}")
    audio = np.concatenate(chunks)
    if src_rate != TARGET_RATE:
        audio = soxr.resample(audio, src_rate, TARGET_RATE)
    lead = np.zeros(int(LEAD_SILENCE_S * TARGET_RATE), dtype=np.float32)
    trail = np.zeros(int(TRAIL_SILENCE_S * TARGET_RATE), dtype=np.float32)
    audio = np.concatenate([lead, audio, trail])
    audio = np.clip(audio, -1.0, 1.0)
    return (audio * 32767.0).astype("<i2")


def _write_wav(path: Path, samples_i16: np.ndarray) -> None:
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(TARGET_RATE)
        w.writeframes(samples_i16.tobytes())


def _ensure_model() -> None:
    if MODEL_PATH.exists():
        return
    print(f"Piper voice '{VOICE_NAME}' not found; downloading to {MODEL_PATH.parent} ...")
    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    try:
        from piper.download_voices import download_voice
        download_voice(VOICE_NAME, MODEL_PATH.parent)
    except Exception as exc:  # noqa: BLE001
        raise SystemExit(
            f"Failed to auto-download Piper voice: {exc}\n"
            f"Download it manually with:\n"
            f"  python -m piper.download_voices {VOICE_NAME} --download-dir {MODEL_PATH.parent}"
        )


def generate(slugs: list[str] | None = None) -> list[Path]:
    _ensure_model()
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    todo = slugs or list(UTTERANCES)
    voice = PiperVoice.load(str(MODEL_PATH))
    written = []
    for slug in todo:
        if slug not in UTTERANCES:
            print(f"  ! unknown slug '{slug}' (skipped)", file=sys.stderr)
            continue
        text = UTTERANCES[slug]
        samples = _synthesize_16k(voice, text)
        out = AUDIO_DIR / f"{slug}.wav"
        _write_wav(out, samples)
        dur = len(samples) / TARGET_RATE
        print(f"  {out.name:16s} {dur:5.2f}s  \"{text}\"")
        written.append(out)
    return written


def main(argv: list[str]) -> int:
    if "--list" in argv:
        for slug, text in UTTERANCES.items():
            print(f"{slug:12s} {text}")
        return 0
    slugs = [a for a in argv if not a.startswith("-")] or None
    print(f"Generating WAVs into {AUDIO_DIR} @ {TARGET_RATE} Hz mono PCM16")
    generate(slugs)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
