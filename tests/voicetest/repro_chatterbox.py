# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause
"""Reproduce 'Chatterbox TTS breaks' — run many turns through the deployed app with
Chatterbox TTS and flag turns where TTS failed (text produced but no/short audio, an
error, or a hang). Records each turn's session_id so failures can be grepped in the app
log.  Usage:  python repro_chatterbox.py [N] [base_url]"""
import json
import os
import sys
import time

import harness

BASE = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:7860"
N = int(sys.argv[1]) if len(sys.argv) > 1 else 20

CFG = {
    "pipeline_mode": "generic-assistant",
    "llm_id": "self-hosted:nemotron-nano",
    "asr_id": "self-hosted:nemotron-asr-streaming-english",
    "tts_id": "self-hosted:chatterbox-multilingual-tts",
    "tts_voice_id": "Chatterbox-Multilingual.en-US.Male",
    "prompt_key": "generic_assistant",
}
QUERIES = ["g_know_planet", "g_introduce", "g_weather_tokyo", "g_know_france",
           "g_stock_nvda", "g_bmi_70", "g_currency_usd_eur", "g_know_author",
           "g_time_london", "g_news_tech"]

# capture the session_id the harness mints per turn (== stream_id in the app log)
_sids = []
_orig_post = harness._post_session_config
def _spy(base, cfg):
    sid = _orig_post(base, cfg)
    _sids.append(sid)
    return sid
harness._post_session_config = _spy

OUT = os.path.join(os.path.dirname(__file__), "chatterbox_out")
os.makedirs(OUT, exist_ok=True)
results = []
print(f"=== Chatterbox TTS repro — {N} turns vs {BASE} ===\n", flush=True)
for i in range(N):
    q = QUERIES[i % len(QUERIES)]
    wav = os.path.join(os.path.dirname(__file__), "audio", f"{q}.wav")
    _sids.append(None)  # placeholder; _spy appends the real one, so track index
    idx = len(_sids) - 1
    r = harness.run_turn(BASE, CFG, wav, timeout_s=40, warmup_budget_s=25,
                         capture_prefix=os.path.join(OUT, f"turn_{i:02d}_{q}"))
    sid = _sids[-1] if _sids[-1] else "?"
    text = (r.get("bot_text") or "").strip()
    audio = r.get("bot_audio_seconds", 0.0) or 0.0
    err = r.get("error")
    hang = r.get("hang")
    stopped = r.get("bot_stopped_cleanly")
    ttfa = r.get("time_to_first_bot_audio_s")
    greet = r.get("greeting_seconds", 0.0)
    # a Chatterbox break: got a text reply but no (or trivially short) audio, or an error/hang
    tts_broke = (bool(text) and audio < 0.30) or bool(err) or bool(hang)
    tag = ">>> TTS BREAK" if tts_broke else "ok"
    results.append(dict(i=i, q=q, sid=sid, audio=audio, greet=greet, ttfa=ttfa,
                        stopped=stopped, err=err, hang=hang, text=text[:60], broke=tts_broke))
    print(f"[{i:02d}] {q:18s} sid={sid} greet={greet:>4}s turn_audio={audio:>5}s ttfa={ttfa} "
          f"stopped={stopped} text='{text[:44]}' err={err}  {tag}", flush=True)

fails = [r for r in results if r["broke"]]
print(f"\n=== {len(fails)}/{N} turns broke ===", flush=True)
for f in fails:
    print(f"  BREAK turn {f['i']:02d} {f['q']} sid={f['sid']} audio={f['audio']}s text='{f['text']}' err={f['err']} hang={f['hang']}", flush=True)
with open(os.path.join(OUT, "repro_results.json"), "w") as fh:
    json.dump(results, fh, indent=2)
print(f"\nresults -> {OUT}/repro_results.json  (failing sids: {[f['sid'] for f in fails]})", flush=True)
