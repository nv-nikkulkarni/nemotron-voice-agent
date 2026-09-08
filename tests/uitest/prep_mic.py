# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause
"""Build a fake-mic WAV for Chromium's `--use-file-for-fake-audio-capture`.

Chromium LOOPS the file as the microphone, so we pad a real utterance with:
  * lead silence  — long enough that the utterance lands AFTER the opening
    greeting finishes (otherwise it "barges in" and the turn never completes);
  * trail silence — long enough that the file doesn't loop back and fire a
    second turn mid-measurement.
Output is 48 kHz mono PCM16 (the format Chromium's fake capture is happiest with).

  python prep_mic.py --utterance ../voicetest/audio/g_know_planet.wav \
      --out audio/mic_planet_48k.wav --lead 10 --trail 45
"""
import argparse
import wave
import numpy as np
import soxr


def load_mono(path: str):
    with wave.open(path, "rb") as w:
        r = w.getframerate()
        ch = w.getnchannels()
        a = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float32) / 32768.0
    if ch == 2:
        a = a.reshape(-1, 2).mean(1)
    return a, r


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--utterance", required=True, help="a 16 kHz mono PCM16 WAV of the query")
    ap.add_argument("--out", required=True)
    ap.add_argument("--lead", type=float, default=10.0, help="lead silence secs (> greeting length)")
    ap.add_argument("--trail", type=float, default=45.0, help="trail silence secs (avoid a 2nd loop)")
    args = ap.parse_args()

    utt, r = load_mono(args.utterance)
    utt48 = soxr.resample(utt, r, 48000) if r != 48000 else utt
    mic = np.concatenate([
        np.zeros(int(args.lead * 48000), np.float32),
        utt48,
        np.zeros(int(args.trail * 48000), np.float32),
    ])
    pcm = (np.clip(mic, -1, 1) * 32767).astype("<i2")
    with wave.open(args.out, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(48000)
        w.writeframes(pcm.tobytes())
    print(f"wrote {args.out}: {len(mic)/48000:.0f}s @48kHz (utterance at {args.lead}s, len {len(utt48)/48000:.1f}s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
