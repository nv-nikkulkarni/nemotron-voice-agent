#!/usr/bin/env python3
# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause
"""Standalone tool-calling accuracy eval across models.

Replays the EXACT edd3f29 generic-assistant system prompt + tool schemas from the repo,
against the EXACT user queries captured from a real failing session (8cd1ddf29797), via
direct calls to the NVIDIA inference gateway. Measures, per model:

  1) single-turn tool decision (temp 0)  — does the model call the right tool per query?
  2) reliability on the core queries (temp 0.7 x N) — how often does it call it?

Usage:  NV_INFERENCE_KEY=sk-... python3 tests/model_eval/tool_eval.py
"""
import concurrent.futures as cf
import json
import os
import re
import time
import urllib.error
import urllib.request

BASE = "https://inference-api.nvidia.com/v1/chat/completions"
KEY = os.environ["NV_INFERENCE_KEY"]
REPO = os.path.join(os.path.dirname(__file__), "..", "..")

MODELS = [
    "nvidia/nvidia/nemotron-3.5-lightning",
    "nvidia/nvidia/nemotron-3-ultra-nvfp4",
    "nvidia/nvidia/nemotron-3-super-v3",
    "nvidia/openai/gpt-oss-20b",
    "aws/anthropic/claude-haiku-4-5-v1",
]

# --- EXACT system prompt from the shipped UI (edd3f29 dedicated-tool routing) ---
_src = open(os.path.join(REPO, "astra_client/src/demo/promptOverrides.ts")).read()
SYSTEM = re.search(r"const GENERIC_ASSISTANT = `(.*?)`;", _src, re.S).group(1)

# --- Tool schemas (OpenAI format) mirroring src/examples/generic/tools.yaml (tools_available) ---
TOOLS = [
    {"type": "function", "function": {"name": "get_weather",
        "description": "Get the current weather for a given city.",
        "parameters": {"type": "object", "properties": {
            "city": {"type": "string", "description": "The city name, e.g. London, New York, Tokyo"},
            "units": {"type": "string", "description": "Temperature units: 'celsius' or 'fahrenheit', defaults to celsius"}},
            "required": ["city"]}}},
    {"type": "function", "function": {"name": "get_stock_price",
        "description": "Get the current live stock price for a company by name or ticker.",
        "parameters": {"type": "object", "properties": {
            "company_name": {"type": "string", "description": "Company name or stock ticker, e.g. Apple, Tesla, NVIDIA, or AAPL"}},
            "required": ["company_name"]}}},
    {"type": "function", "function": {"name": "web_search",
        "description": "Search the live web (via Perplexity Sonar) for current, real-time, or recent information — news, prices, scores, events, or any fact that may be beyond your training or that you don't reliably know. Prefer this whenever the user asks about something current, live, or recent.",
        "parameters": {"type": "object", "properties": {
            "query": {"type": "string", "description": "The natural-language search query describing what to look up."}},
            "required": ["query"]}}},
    {"type": "function", "function": {"name": "calculate_bmi",
        "description": "Calculate the Body Mass Index (BMI) given weight and height.",
        "parameters": {"type": "object", "properties": {
            "weight_kg": {"type": "number"}, "height_m": {"type": "number"}}, "required": ["weight_kg", "height_m"]}}},
    {"type": "function", "function": {"name": "generate_random_number",
        "description": "Generate a random number within a specified range.",
        "parameters": {"type": "object", "properties": {"min": {"type": "number"}, "max": {"type": "number"}}, "required": []}}},
]

# --- EXACT user turns from session 8cd1ddf29797 (garbled ASR preserved), with the tool a
#     correct voice-agent SHOULD call. None = no tool (stop / too-vague). "web_search?" =
#     web_search is the ideal but a clarify (no tool) is acceptable given garbled/vague input. ---
QUERIES = [
    ("What is the weather in Pune", "get_weather", True),
    ("What is the stock price of NVIDIA", "get_stock_price", True),
    ("What is the stock price of NVIDIA?", "get_stock_price", True),
    ("What is the latest stock price of NVIDIA?", "get_stock_price", True),
    ("Can you tell me something about Air India Fucket to Teleflight", "web_search", False),
    ("Can you tell me something about Air India Fukuet to Tele flight", "web_search", False),
    ("Can you stop?", None, True),
    ("Can you tell me about the recent incident of turbulence on the Fukuet two Delhi flight?", "web_search", False),
    ("For this", None, False),
    ("Can you stop", None, True),
    ("Can you search the web for this", None, False),
]
CORE = QUERIES[:4]  # the clear ones the real session failed (weather + 3x NVIDIA stock)


def call(model, messages, temperature=0.0, max_tokens=700, retries=3):
    body = {"model": model, "messages": messages, "tools": TOOLS, "tool_choice": "auto",
            "temperature": temperature, "max_tokens": max_tokens}
    data = json.dumps(body).encode()
    for attempt in range(retries):
        req = urllib.request.Request(BASE, data=data,
            headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.load(r)["choices"][0]["message"], None
        except urllib.error.HTTPError as e:
            txt = e.read()[:200].decode(errors="replace")
            if e.code in (429, 500, 502, 503, 504) and attempt < retries - 1:
                time.sleep(1.5 * (attempt + 1)); continue
            return None, f"HTTP {e.code}: {txt}"
        except Exception as e:  # noqa: BLE001
            if attempt < retries - 1:
                time.sleep(1.5 * (attempt + 1)); continue
            return None, f"{type(e).__name__}: {str(e)[:120]}"


def tool_names(msg):
    return [tc["function"]["name"] for tc in (msg.get("tool_calls") or [])]


def single_turn(model, query):
    msg, err = call(model, [{"role": "system", "content": SYSTEM}, {"role": "user", "content": query}])
    if err:
        return {"err": err}
    return {"tools": tool_names(msg), "content": (msg.get("content") or "")[:60]}


def reliability(model, query, n=5):
    hits = 0; results = []
    for _ in range(n):
        msg, err = call(model, [{"role": "system", "content": SYSTEM}, {"role": "user", "content": query}],
                        temperature=0.7)
        if err:
            results.append("ERR"); continue
        tn = tool_names(msg)
        results.append(",".join(tn) or "(none)")
    return results


def main():
    print(f"System prompt: {len(SYSTEM)} chars (edd3f29) | Tools: {[t['function']['name'] for t in TOOLS]}")
    print(f"Session: 8cd1ddf29797 | {len(QUERIES)} user turns | Models: {len(MODELS)}\n")

    # ---- 1) single-turn tool decision (temp 0) ----
    print("=" * 100)
    print("PART 1 — single-turn tool decision @ temp 0 (which tool does each model call per query?)")
    print("=" * 100)
    grid = {}
    with cf.ThreadPoolExecutor(max_workers=6) as ex:
        futs = {ex.submit(single_turn, m, q): (m, q) for m in MODELS for (q, _, _) in QUERIES}
        for fut in cf.as_completed(futs):
            m, q = futs[fut]; grid[(m, q)] = fut.result()

    for m in MODELS:
        print(f"\n### {m}")
        core_hit = tool_hit = tool_total = none_ok = none_total = 0
        for (q, exp, scored) in QUERIES:
            r = grid[(m, q)]
            got = ",".join(r.get("tools") or []) or "(no tool)"
            if "err" in r:
                mark = f"ERR {r['err'][:50]}"
            elif exp is None:
                ok = not r.get("tools"); none_total += scored; none_ok += scored and ok
                mark = "ok(no-tool)" if ok else f"OVER-CALLED {got}"
            else:
                hit = exp in (r.get("tools") or [])
                if scored:
                    tool_total += 1; tool_hit += hit
                    if (q, exp, scored) in [(c[0], c[1], c[2]) for c in CORE]:
                        core_hit += hit
                mark = "HIT" if hit else (f"WRONG {got}" if r.get("tools") else "MISS (answered from memory)")
            print(f"  [{(exp or 'none'):15s}] {q[:52]:52s} -> {mark}")
        print(f"  => CORE weather+stock: {core_hit}/4 | all scored tool-turns: {tool_hit}/{tool_total} | no-tool correct: {none_ok}/{none_total}")

    # ---- 2) reliability on core queries (temp 0.7 x N) ----
    print("\n" + "=" * 100)
    print("PART 2 — reliability on CORE queries @ temp 0.7, N=5 (how OFTEN is the right tool called?)")
    print("=" * 100)
    rel = {}
    with cf.ThreadPoolExecutor(max_workers=6) as ex:
        futs = {ex.submit(reliability, m, q, 5): (m, q, exp) for m in MODELS for (q, exp, _) in CORE}
        for fut in cf.as_completed(futs):
            m, q, exp = futs[fut]; rel[(m, q)] = (exp, fut.result())
    for m in MODELS:
        print(f"\n### {m}")
        tot_hit = tot = 0
        for (q, exp, _) in CORE:
            exp2, runs = rel[(m, q)]
            hits = sum(1 for r in runs if exp2 in r.split(","))
            tot_hit += hits; tot += len(runs)
            print(f"  {q[:48]:48s} exp={exp2:15s} {hits}/{len(runs)}  runs={runs}")
        print(f"  => CORE tool-call reliability: {tot_hit}/{tot} = {100*tot_hit//max(tot,1)}%")


if __name__ == "__main__":
    main()
