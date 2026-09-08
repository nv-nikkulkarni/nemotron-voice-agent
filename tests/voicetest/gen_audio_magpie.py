# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause
"""Generate the test query WAVs using the CLOUD Magpie TTS (NVIDIA Inference Hub)
instead of Piper — more natural speech = a more realistic ASR stress test.

  POST https://inference-api.nvidia.com/v1/audio/nvidia/magpie-tts-multilingual-357m/synthesize
  -> audio/wav (16-bit mono, 22050 Hz). We resample to 16 kHz and pad with silence.

Usage:
  NVIDIA_API_KEY=nvapi-... uv run python tests/voicetest/gen_audio_magpie.py [slug ...]
"""
from __future__ import annotations

import io
import os
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np
import soxr

from gen_audio import UTTERANCES, TARGET_RATE, LEAD_SILENCE_S, TRAIL_SILENCE_S, AUDIO_DIR, _write_wav

ENDPOINT = "https://inference-api.nvidia.com/v1/audio/nvidia/magpie-tts-multilingual-357m/synthesize"
VOICE = "Magpie-Multilingual.EN-US.Aria"
API_KEY = os.environ.get("NVIDIA_API_KEY", "").strip()


def _synthesize(text: str) -> bytes:
    """Call the Inference Hub Magpie TTS via curl and return WAV bytes."""
    cmd = [
        "curl", "-sS", "--fail-with-body", "-m", "60", "--location", ENDPOINT,
        "--header", f"Authorization: Bearer {API_KEY}",
        "--header", "Accept: audio/wav",
        "--form", f"text={text}",
        "--form", "language=en-US",
        "--form", f"voice={VOICE}",
        "--form", "encoding=LINEAR_PCM",
    ]
    proc = subprocess.run(cmd, capture_output=True)
    if proc.returncode != 0 or not proc.stdout[:4] == b"RIFF":
        raise RuntimeError(f"synth failed ({proc.returncode}): {proc.stdout[:300]!r} {proc.stderr[:200]!r}")
    return proc.stdout


def _to_16k_i16(wav_bytes: bytes) -> np.ndarray:
    with wave.open(io.BytesIO(wav_bytes), "rb") as w:
        rate, ch, n = w.getframerate(), w.getnchannels(), w.getnframes()
        raw = w.readframes(n)
    audio = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    if ch > 1:
        audio = audio.reshape(-1, ch).mean(axis=1)
    if rate != TARGET_RATE:
        audio = soxr.resample(audio, rate, TARGET_RATE)
    lead = np.zeros(int(LEAD_SILENCE_S * TARGET_RATE), dtype=np.float32)
    trail = np.zeros(int(TRAIL_SILENCE_S * TARGET_RATE), dtype=np.float32)
    audio = np.clip(np.concatenate([lead, audio, trail]), -1.0, 1.0)
    return (audio * 32767.0).astype("<i2")


def main() -> None:
    if not API_KEY:
        sys.exit("ERROR: set NVIDIA_API_KEY")
    slugs = sys.argv[1:] or list(UTTERANCES)
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Generating WAVs via CLOUD Magpie TTS -> {AUDIO_DIR} @ {TARGET_RATE} Hz")
    for slug in slugs:
        if slug not in UTTERANCES:
            print(f"  ! unknown slug '{slug}'", file=sys.stderr)
            continue
        text = UTTERANCES[slug]
        try:
            samples = _to_16k_i16(_synthesize(text))
        except Exception as exc:  # noqa: BLE001
            print(f"  {slug:16s} FAILED: {exc}", file=sys.stderr)
            continue
        out = AUDIO_DIR / f"{slug}.wav"
        _write_wav(out, samples)
        print(f'  {out.name:18s} {len(samples)/TARGET_RATE:5.2f}s  "{text}"')


if __name__ == "__main__":
    main()
