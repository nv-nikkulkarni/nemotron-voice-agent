# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause
"""Batch-build fake-mic WAVs + emit scenarios.json for the multi-scenario UI suite.

Single source of truth is `tests/voicetest/quality_spec.py` (the 40-query voice
suite). For each requested query we:
  * pad its raw utterance (../voicetest/audio/<slug>.wav) with lead+trail silence
    and resample to 48 kHz mono PCM16 -> audio/<slug>_48k.wav (Chromium fake mic);
  * record how to drive the UI (which example card + model) and how to score it
    (expected-answer regex + a per-category latency budget) into scenarios.json.

`ui_suite.cjs` then reads scenarios.json and runs exactly the built scenarios.

  python prep_mics.py --default      # ~6 representative scenarios (fast)
  python prep_mics.py --all          # all 40
  python prep_mics.py --slugs g_know_planet,o_count5,o_think_batball
"""
import argparse
import json
import os
import sys
import wave

import numpy as np
import soxr

HERE = os.path.dirname(os.path.abspath(__file__))
VOICE = os.path.join(HERE, "..", "voicetest")
sys.path.insert(0, VOICE)
from quality_spec import QUERIES  # noqa: E402

# A fast, representative cross-section: knowledge, a tool call, identity/format,
# an omni "respond" (multi-clause), omni camera-off (headless has no webcam), and
# an omni "think" puzzle. Covers both examples + both models' code paths.
DEFAULT = ["g_know_planet", "g_weather_tokyo", "g_introduce",
           "o_count5", "o_camera_see", "o_think_batball"]

# Latency guard-rails (seconds) by category prefix — generous on purpose. This is
# a regression smoke test, not the latency benchmark (voicetest does that); the
# budget only catches gross regressions.
BUDGETS = {"tool": 10.0, "knowledge": 8.0, "format": 8.0, "respond": 14.0,
           "camera_off": 10.0, "clarify": 10.0, "think": 16.0}


def budget_for(category: str) -> float:
    key = category.split(":", 1)[0]
    return BUDGETS.get(key, 12.0)


def load_mono(path: str):
    with wave.open(path, "rb") as w:
        r = w.getframerate()
        ch = w.getnchannels()
        a = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float32) / 32768.0
    if ch == 2:
        a = a.reshape(-1, 2).mean(1)
    return a, r


def build_mic(utt_path: str, out_path: str, lead: float, trail: float) -> float:
    utt, r = load_mono(utt_path)
    utt48 = soxr.resample(utt, r, 48000) if r != 48000 else utt
    mic = np.concatenate([
        np.zeros(int(lead * 48000), np.float32),
        utt48,
        np.zeros(int(trail * 48000), np.float32),
    ])
    pcm = (np.clip(mic, -1, 1) * 32767).astype("<i2")
    with wave.open(out_path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(48000)
        w.writeframes(pcm.tobytes())
    return len(utt48) / 48000.0


def main() -> int:
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--default", action="store_true", help="build the representative subset")
    g.add_argument("--all", action="store_true", help="build all 40 queries")
    g.add_argument("--slugs", help="comma-separated slugs to build")
    ap.add_argument("--lead", type=float, default=10.0, help="lead silence secs (> greeting)")
    ap.add_argument("--trail", type=float, default=45.0, help="trail silence secs (avoid 2nd loop)")
    args = ap.parse_args()

    if args.all:
        want = [q["slug"] for q in QUERIES]
    elif args.slugs:
        want = [s.strip() for s in args.slugs.split(",") if s.strip()]
    else:
        want = DEFAULT  # default

    by_slug = {q["slug"]: q for q in QUERIES}
    audio_dir = os.path.join(HERE, "audio")
    os.makedirs(audio_dir, exist_ok=True)

    scenarios = []
    for slug in want:
        q = by_slug.get(slug)
        if not q:
            print(f"  ! unknown slug {slug!r} (not in quality_spec); skipping")
            continue
        src = os.path.join(VOICE, "audio", f"{slug}.wav")
        if not os.path.exists(src):
            print(f"  ! missing utterance wav {src}; skipping")
            continue
        out = os.path.join(audio_dir, f"{slug}_48k.wav")
        dur = build_mic(src, out, args.lead, args.trail)
        example = "generic" if q["example"] == "generic" else "omni"
        scenarios.append({
            "slug": slug,
            "example": example,                       # generic | omni  -> which card
            "model": "nano" if example == "generic" else None,  # generic LLM is swappable
            "mic": f"audio/{slug}_48k.wav",
            "utteranceLandsAtS": args.lead,
            "category": q["category"],
            "expect": q["content"],                   # case-insensitive answer regex (may be None)
            "budgetS": budget_for(q["category"]),
            "text": q["text"],
        })
        print(f"  ✓ {slug:18s} {q['example']:7s} {q['category']:22s} utt={dur:4.1f}s -> {os.path.basename(out)}")

    spec = {"lead": args.lead, "trail": args.trail, "scenarios": scenarios}
    with open(os.path.join(HERE, "scenarios.json"), "w") as f:
        json.dump(spec, f, indent=2)
    print(f"\nwrote scenarios.json: {len(scenarios)} scenario(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
