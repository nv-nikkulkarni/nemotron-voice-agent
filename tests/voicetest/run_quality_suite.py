# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause
"""Exhaustive voice-quality suite runner.

For each configured pass (generic-nano, omni, optional generic-super) it:
  1. WARMS the pipeline with a couple of throwaway turns (cold-start LLM TTFB can
     be tens of seconds on the first inference — measured separately, then
     excluded from steady-state numbers).
  2. Runs every query for that example over the real WebSocket transport, one
     fresh session per query (so every turn also yields a welcome-message
     latency sample), capturing:
       - the bot TTS audio (WAV) for greeting + measured turn,
       - welcome latency (time_to_greeting_audio_s),
       - response latency (time_to_first_bot_audio_s = end-of-user-speech ->
         first bot audio chunk),
       - the bot's spoken text, tools_called, the pipeline's own
         latency_breakdown, hang/finish_reason,
       - wall-clock epoch start/end (for cluster-log correlation).

Writes tests/voicetest/results/<pass>/<slug>.{turn,greeting}.wav + timing.json
and a combined tests/voicetest/results/quality_results.json.

Usage:
  python run_quality_suite.py [--base URL] [--passes generic-nano,omni,generic-super]
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import harness
from quality_spec import by_example

HERE = Path(__file__).resolve().parent
AUDIO_DIR = HERE / "audio"
RESULTS_DIR = HERE / "results"

CHATTERBOX = dict(tts_id="self-hosted:chatterbox-multilingual-tts",
                  tts_voice_id="Chatterbox-Multilingual.en-US.Male")

PASSES = {
    "generic-nano": dict(
        example="generic",
        config={"pipeline_mode": "generic-assistant",
                "llm_id": "self-hosted:nemotron-nano",
                "asr_id": "self-hosted:nemotron-asr-streaming-english",
                "prompt_key": "generic_assistant", **CHATTERBOX},
        timeout_s=60, warmup_budget_s=45,
    ),
    "generic-super": dict(
        example="generic",
        config={"pipeline_mode": "generic-assistant",
                "llm_id": "self-hosted:nemotron-super",
                "asr_id": "self-hosted:nemotron-asr-streaming-english",
                "prompt_key": "generic_assistant", **CHATTERBOX},
        timeout_s=90, warmup_budget_s=60,
    ),
    "omni": dict(
        example="omni",
        config={"pipeline_mode": "omni-assistant-subagents",
                "llm_id": "self-hosted:nemotron-omni-nvfp4",
                "prompt_key": "generic_omni_assistant", **CHATTERBOX},
        timeout_s=90, warmup_budget_s=60,
    ),
}

WARMUP_WAVS = ["g_know_france", "g_know_planet"]   # short, generic; just to warm


def _run_one(base, cfg, slug, outdir, timeout_s, warmup_budget_s):
    wav = str(AUDIO_DIR / f"{slug}.wav")
    prefix = str(outdir / slug)
    t0 = time.time()
    res = harness.run_turn(base, cfg, wav, timeout_s=timeout_s,
                           warmup_budget_s=warmup_budget_s, capture_prefix=prefix)
    res["t_start_epoch"] = round(t0, 3)
    res["t_end_epoch"] = round(time.time(), 3)
    return res


def run_pass(base, name, spec):
    example = spec["example"]
    cfg = spec["config"]
    outdir = RESULTS_DIR / name
    outdir.mkdir(parents=True, exist_ok=True)
    queries = by_example(example)
    print(f"\n{'='*70}\nPASS {name}  ({len(queries)} queries)  llm={cfg['llm_id']}\n{'='*70}", flush=True)

    # ---- warmup (capture cold-start, then discard) ----
    warm = []
    for i, slug in enumerate(WARMUP_WAVS if example == "generic" else ["o_count5", "o_know_planet"]):
        wav = str(AUDIO_DIR / f"{slug}.wav")
        t0 = time.time()
        r = harness.run_turn(base, cfg, wav, timeout_s=120, warmup_budget_s=110)
        r["slug"] = slug
        r["wall_s"] = round(time.time() - t0, 1)
        warm.append(r)
        print(f"  warmup {i+1} {slug}: greet_ttfa={r.get('time_to_greeting_audio_s')} "
              f"turn_ttfa={r.get('time_to_first_bot_audio_s')} hang={r.get('hang')} "
              f"({r['wall_s']}s wall)", flush=True)

    # ---- measured turns ----
    turns = []
    for q in queries:
        r = _run_one(base, cfg, q["slug"], outdir, spec["timeout_s"], spec["warmup_budget_s"])
        r.update({"slug": q["slug"], "example": q["example"], "category": q["category"],
                  "text": q["text"], "expect": q["expect"], "expect_tool": q["expect_tool"],
                  "content": q["content"]})
        turns.append(r)
        print(f"  {q['slug']:18s} welcome={str(r.get('time_to_greeting_audio_s')):>5} "
              f"ttfa={str(r.get('time_to_first_bot_audio_s')):>5} "
              f"audio_s={str(r.get('bot_audio_seconds')):>5} hang={str(r.get('hang')):>5} "
              f"tools={r.get('tools_called')} :: {(r.get('bot_text') or '')[:48]!r}", flush=True)
    return {"config": cfg, "warmup": warm, "turns": turns}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:7860")
    ap.add_argument("--passes", default="generic-nano,omni,generic-super")
    args = ap.parse_args()

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    out = {"generated_at": round(time.time(), 3), "base": args.base, "passes": {}}
    for name in [p.strip() for p in args.passes.split(",") if p.strip()]:
        if name not in PASSES:
            print(f"  ! unknown pass {name}")
            continue
        out["passes"][name] = run_pass(args.base, name, PASSES[name])
        # checkpoint after each pass
        with open(RESULTS_DIR / "quality_results.json", "w") as fh:
            json.dump(out, fh, indent=1)
    print(f"\nWrote {RESULTS_DIR/'quality_results.json'}")


if __name__ == "__main__":
    main()
