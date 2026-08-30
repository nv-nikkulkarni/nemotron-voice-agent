#!/usr/bin/env python3
# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause
"""Multi-turn replay of the EXACT failing session (8cd1ddf29797) across models.

Each model plays the assistant through the exact ordered user turns (ASR artifacts + the
history-summary turn preserved), generating its OWN responses with mock tool results fed
back on tool calls — i.e. "what if model X had served this session?". Run at production-like
temp 0.7 x N reps. Measures, per model: core tool-call rate under multi-turn contamination,
and format degradation (emoji / markdown lists / verbosity) that Super exhibited.

Usage:  NV_INFERENCE_KEY=sk-... python3 tests/model_eval/multiturn_replay.py
"""
import concurrent.futures as cf
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from tool_eval import MODELS, SYSTEM, call  # noqa: E402  (shares exact prompt+tools+client)

# Exact ordered user turns extracted from session 8cd1ddf29797 (index 0 = app history summary).
TURNS = json.load(open("/tmp/session_user_turns.json")) if os.path.exists("/tmp/session_user_turns.json") else [
    "Conversation summary of earlier turns: User requested an introduction from the assistant. Assistant responded with a greeting, identifying itself as Nemotron, a voice assistant created by NVIDIA, and offered assistance. No further tasks remain.",
    "What is the weather in Pune",
    "What is the stock price of NVIDIA",
    "What is the stock price of NVIDIA?",
    "What is the latest  stock price of NVIDIA?",
    "Can you tell me something about  Air India Fucket  to Teleflight",
    "Can you tell me something about  Air India Fukuet to  Tele flight",
    "Can you stop?",
    "Can you tell me about the recent incident of turbulence on the  Fukuet two Delhi flight?",
    "For this",
    "Can you stop",
    "Can you search the web for this",
]
# Expected tool per turn (None = no tool). Turn 0 is the summary (no tool).
EXPECT = [None, "get_weather", "get_stock_price", "get_stock_price", "get_stock_price",
          "web_search", "web_search", None, "web_search", None, None, None]
CORE_IDX = [1, 2, 3, 4]  # weather + 3x NVIDIA stock — the ones the real session hallucinated
N_REPS = 3
EMOJI_RE = re.compile(r"[\U0001F300-\U0001FAFF☀-➿←-⇿⬀-⯿]")
MDLIST_RE = re.compile(r"(?m)^\s*([-*•]|\d+\.)\s+\S")


def mock_result(name, args):
    if name == "get_weather":
        return {"city": args.get("city", ""), "condition": "Patchy rain nearby", "temperature": "25.5°C",
                "feels_like": "26.1°C", "humidity": "88%", "wind": "12 kph W", "source": "live (weatherapi)"}
    if name == "get_stock_price":
        c = args.get("company_name", "")
        sym = "NVDA" if "nvid" in c.lower() else (c[:4].upper() or "N/A")
        return {"company": c, "symbol": sym, "price": 224.09, "currency": "USD",
                "previous_close": 225.1, "change": -1.01, "source": "live (finnhub)"}
    if name == "web_search":
        return {"answer": "Concise factual summary from current web sources relevant to the query."}
    return {"ok": True}


def parse_args(tc):
    try:
        return json.loads(tc["function"].get("arguments") or "{}")
    except Exception:
        return {}


def replay(model, rep):
    """Run the whole conversation; return per-turn (tool_called, final_text)."""
    messages = [{"role": "system", "content": SYSTEM}]
    out = []
    for i, user in enumerate(TURNS):
        messages.append({"role": "user", "content": user})
        msg, err = call(model, messages, temperature=0.7, max_tokens=700)
        if err:
            out.append(("ERR", err[:40])); messages.append({"role": "assistant", "content": "(error)"}); continue
        tcs = msg.get("tool_calls") or []
        if tcs:
            called = tcs[0]["function"]["name"]
            # append assistant tool-call msg + tool results, then get the final spoken answer
            messages.append({"role": "assistant", "content": msg.get("content"), "tool_calls": tcs})
            for tc in tcs:
                messages.append({"role": "tool", "tool_call_id": tc.get("id", "call_x"),
                                 "content": json.dumps(mock_result(tc["function"]["name"], parse_args(tc)))})
            msg2, err2 = call(model, messages, temperature=0.7, max_tokens=700)
            final = (msg2.get("content") if msg2 else "") or ""
            messages.append({"role": "assistant", "content": final})
            out.append((called, final[:80]))
        else:
            final = msg.get("content") or ""
            messages.append({"role": "assistant", "content": final})
            out.append(("(none)", final[:80]))
    return out


def fmt_bad(text):
    return bool(EMOJI_RE.search(text)) or bool(MDLIST_RE.search(text)) or len(text.split()) > 40


def main():
    print(f"Multi-turn replay of session 8cd1ddf29797 | {len(TURNS)} turns | temp 0.7 x {N_REPS} reps")
    print(f"System prompt: {len(SYSTEM)} chars (edd3f29)\n")
    results = {}
    with cf.ThreadPoolExecutor(max_workers=15) as ex:
        futs = {ex.submit(replay, m, r): (m, r) for m in MODELS for r in range(N_REPS)}
        for fut in cf.as_completed(futs):
            m, r = futs[fut]; results[(m, r)] = fut.result()

    for m in MODELS:
        print("=" * 96)
        print(f"### {m}")
        core_hit = core_tot = 0
        allb_bad = allb_tot = 0
        for r in range(N_REPS):
            seq = results[(m, r)]
            core = "".join("Y" if (i < len(seq) and seq[i][0] == EXPECT[i]) else "." for i in CORE_IDX)
            core_hit += core.count("Y"); core_tot += len(CORE_IDX)
            print(f"  rep{r}: core[w,s,s,s]={core}  full-flow tools=" +
                  " ".join(f"{i}:{(seq[i][0] if i < len(seq) else '?')[:11]}" for i in range(len(TURNS))))
        # format degradation over the whole flow (all reps)
        for r in range(N_REPS):
            for i in range(1, len(TURNS)):  # skip summary turn
                txt = results[(m, r)][i][1] if i < len(results[(m, r)]) else ""
                allb_tot += 1; allb_bad += fmt_bad(txt)
        print(f"  => CORE tool-call under multi-turn: {core_hit}/{core_tot} = {100*core_hit//max(core_tot,1)}%"
              f"   | format-degraded answers: {allb_bad}/{allb_tot}")
        # show rep0 final answers for the core turns to eyeball hallucination/verbosity
        print("  sample (rep0) answers on core turns:")
        for i in CORE_IDX:
            seq = results[(m, 0)]
            if i < len(seq):
                print(f"     T{i} [{seq[i][0]}] {seq[i][1]!r}")
    print("=" * 96)


if __name__ == "__main__":
    main()
