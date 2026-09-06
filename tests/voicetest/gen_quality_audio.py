# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause
"""Synthesize the 40 exhaustive-suite query WAVs (from quality_spec.QUERIES) with
Piper, 16 kHz mono PCM16, into tests/voicetest/audio/<slug>.wav.

Reuses the Piper synth + resample helpers from gen_audio.py so the audio is
identical in character to the existing suite.
"""
from __future__ import annotations

from pathlib import Path

from piper import PiperVoice

import gen_audio
from quality_spec import QUERIES

HERE = Path(__file__).resolve().parent
AUDIO_DIR = HERE / "audio"


def main() -> int:
    gen_audio._ensure_model()
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    voice = PiperVoice.load(str(gen_audio.MODEL_PATH))
    print(f"Synthesizing {len(QUERIES)} query WAVs @ 16 kHz mono PCM16 -> {AUDIO_DIR}")
    for q in QUERIES:
        samples = gen_audio._synthesize_16k(voice, q["text"])
        out = AUDIO_DIR / f"{q['slug']}.wav"
        gen_audio._write_wav(out, samples)
        dur = len(samples) / gen_audio.TARGET_RATE
        print(f"  {q['slug']:18s} {dur:5.2f}s  \"{q['text'][:60]}\"")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
