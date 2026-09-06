# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause
"""Reproduce 'Chatterbox TTS breaks' under CONCURRENCY — launch several simultaneous
sessions per round (all synthesizing via Chatterbox at once) and flag breaks.
Usage:  python repro_chatterbox_concurrent.py [concurrency] [rounds] [base_url]"""
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor

import harness

CONC = int(sys.argv[1]) if len(sys.argv) > 1 else 6
ROUNDS = int(sys.argv[2]) if len(sys.argv) > 2 else 5
BASE = sys.argv[3] if len(sys.argv) > 3 else "http://localhost:7860"

CFG = {
    "pipeline_mode": "generic-assistant",
    "llm_id": "self-hosted:nemotron-nano",
    "asr_id": "self-hosted:nemotron-asr-streaming-english",
    "tts_id": "self-hosted:chatterbox-multilingual-tts",
    "tts_voice_id": "Chatterbox-Multilingual.en-US.Male",
    "prompt_key": "generic_assistant",
}
QUERIES = ["g_know_planet", "g_introduce", "g_weather_tokyo", "g_news_tech",
           "g_stock_nvda", "g_time_london", "g_currency_usd_eur", "g_bmi_70"]
AUD = os.path.join(os.path.dirname(__file__), "audio")


def one(i):
    q = QUERIES[i % len(QUERIES)]
    r = harness.run_turn(BASE, CFG, os.path.join(AUD, f"{q}.wav"), timeout_s=45, warmup_budget_s=30)
    text = (r.get("bot_text") or "").strip()
    audio = r.get("bot_audio_seconds", 0.0) or 0.0
    broke = (bool(text) and audio < 0.30) or bool(r.get("error")) or bool(r.get("hang"))
    return dict(q=q, sid=r.get("session_id", "?"), audio=audio, greet=r.get("greeting_seconds", 0.0),
                ttfa=r.get("time_to_first_bot_audio_s"), stopped=r.get("bot_stopped_cleanly"),
                err=r.get("error"), hang=r.get("hang"), text=text[:44], broke=broke,
                greet_audio=(r.get("greeting_seconds", 0.0) or 0.0))


print(f"=== Chatterbox CONCURRENCY repro — {CONC} parallel x {ROUNDS} rounds = {CONC*ROUNDS} turns vs {BASE} ===\n", flush=True)
allr = []
n = 0
for rnd in range(ROUNDS):
    with ThreadPoolExecutor(max_workers=CONC) as ex:
        batch = list(ex.map(one, range(n, n + CONC)))
    n += CONC
    for r in batch:
        tag = ">>> BREAK" if r["broke"] else ("~greet0" if r["greet_audio"] < 0.1 else "ok")
        print(f"  rnd{rnd} {r['q']:16s} sid={r['sid']} greet={r['greet']:>5}s audio={r['audio']:>5}s "
              f"ttfa={r['ttfa']} stop={r['stopped']} err={r['err']} '{r['text']}'  {tag}", flush=True)
    allr.extend(batch)
    print(f"  --- round {rnd} done ({sum(1 for r in batch if r['broke'])} broke) ---", flush=True)

fails = [r for r in allr if r["broke"]]
print(f"\n=== {len(fails)}/{len(allr)} turns broke (concurrency {CONC}) ===", flush=True)
for f in fails:
    print(f"  BREAK {f['q']} sid={f['sid']} audio={f['audio']}s greet={f['greet']}s err={f['err']} hang={f['hang']} text='{f['text']}'", flush=True)
OUT = os.path.join(os.path.dirname(__file__), "chatterbox_out")
os.makedirs(OUT, exist_ok=True)
with open(os.path.join(OUT, "repro_concurrent_results.json"), "w") as fh:
    json.dump(allr, fh, indent=2)
print(f"\nfailing sids: {[f['sid'] for f in fails]}", flush=True)
