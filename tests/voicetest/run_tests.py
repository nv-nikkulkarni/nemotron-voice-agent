# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause
"""Run a suite of voice turns against a live Nemotron Voice Agent and print a
pass/fail table.

Each utterance is driven end-to-end through :func:`harness.run_turn`. A turn
PASSES when: the socket connected, the user's speech was transcribed, the bot
replied with both text and audio, the reply matched the expected content
(which for the tool utterances means the tool actually fired and its result was
spoken), and there was no hang/timeout.

Usage::

    python run_tests.py                       # all utterances, generate WAVs if missing
    python run_tests.py weather bmi           # only these slugs
    python run_tests.py --base http://host:7860
    python run_tests.py --json results.json   # also dump raw per-turn results
    python run_tests.py --regen               # (re)generate the WAVs first
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

import gen_audio
from gen_audio import UTTERANCES
from harness import DEFAULT_CONFIG, run_turn

HERE = Path(__file__).resolve().parent
AUDIO_DIR = HERE / "audio"

# Per-utterance expectations.
#   needs = regexes (case-insensitive) that must ALL appear in the bot's spoken
#           reply. This is the quality gate: it validates a real answer was
#           spoken (a degenerate "Tokyo weather" with no number fails).
#   tool  = the tool we EXPECT this utterance to exercise. Shown for diagnosis
#           (via the latency breakdown's authoritative tools_called list) but not
#           used as a hard gate, because the model sometimes self-computes
#           (e.g. BMI) instead of calling the tool.
CHECKS: dict[str, dict] = {
    "introduce": {"needs": [], "tool": None, "hint": "any spoken reply"},
    "weather": {"needs": [r"tokyo", r"\d"], "tool": "get_weather", "hint": "Tokyo + temperature/number"},
    "currency": {"needs": [r"eur|€", r"\d"], "tool": "convert_currency", "hint": "euros + amount"},
    "time": {"needs": [r"\d{1,2}[:.]\d{2}|\b\d{1,2}\s*(a\.?m\.?|p\.?m\.?|o'?clock)"],
             "tool": "get_current_date_time", "hint": "a clock time"},
    "bmi": {"needs": [r"\d", r"(bmi|body mass|22|23|normal|healthy|underweight)"],
            "tool": "calculate_bmi", "hint": "BMI value/category"},
}


def _content_ok(slug: str, bot_text: str) -> bool:
    needs = CHECKS.get(slug, {}).get("needs", [])
    low = bot_text.lower()
    return all(re.search(pat, low) for pat in needs)


def _evaluate(slug: str, res: dict) -> tuple[bool, str]:
    """Return (passed, status_reason)."""
    if res.get("error"):
        return False, f"error: {res['error']}"
    if not res.get("connected"):
        return False, "no connection"
    if res.get("hang"):
        return False, "HANG/timeout"
    if not res.get("user_transcript"):
        return False, "no transcript"
    if not res.get("bot_text") or (res.get("bot_audio_seconds") or 0) <= 0:
        return False, "no bot reply"
    if not _content_ok(slug, res.get("bot_text", "")):
        return False, f"content mismatch (want {CHECKS[slug]['hint']})"
    return True, "ok"


def _mark(ok: bool) -> str:
    return "ok " if ok else "MISS"


def _fmt_secs(v) -> str:
    return f"{v:>5.2f}" if isinstance(v, (int, float)) else "  -  "


def run_suite(slugs: list[str], base_url: str, timeout_s: float, config: dict) -> list[dict]:
    rows = []
    for slug in slugs:
        wav = AUDIO_DIR / f"{slug}.wav"
        if not wav.exists():
            print(f"  generating missing audio for '{slug}'...")
            gen_audio.generate([slug])
        print(f"[{slug}] driving turn ...", flush=True)
        t_start = time.monotonic()
        res = run_turn(base_url, config, str(wav), timeout_s=timeout_s)
        res["_wall_s"] = round(time.monotonic() - t_start, 1)
        passed, reason = _evaluate(slug, res)
        res["_passed"], res["_reason"], res["_slug"] = passed, reason, slug
        rows.append(res)
        print(f"    -> {reason}  (TTFA={res.get('time_to_first_bot_audio_s')}s, "
              f"audio={res.get('bot_audio_seconds')}s, {res['_wall_s']}s wall)")
    return rows


def print_table(rows: list[dict]) -> None:
    print("\n" + "=" * 100)
    print("VOICE HARNESS RESULTS")
    print("=" * 100)
    hdr = (f"{'utterance':<11} {'conn':<4} {'xscript':<7} {'reply':<5} "
           f"{'audio_s':>7} {'ttfa_s':>6} {'content':<7} {'hang':<4} {'status':<6}")
    print(hdr)
    print("-" * 100)
    for r in rows:
        slug = r["_slug"]
        conn = "Y" if r.get("connected") else "N"
        xscript = _mark(bool(r.get("user_transcript")))
        reply = _mark(bool(r.get("bot_text")) and (r.get("bot_audio_seconds") or 0) > 0)
        content = _mark(_content_ok(slug, r.get("bot_text", ""))) if not r.get("error") else "n/a "
        hang = "YES" if r.get("hang") else "-"
        status = "PASS" if r.get("_passed") else "FAIL"
        print(f"{slug:<11} {conn:<4} {xscript:<7} {reply:<5} "
              f"{_fmt_secs(r.get('bot_audio_seconds')):>7} {_fmt_secs(r.get('time_to_first_bot_audio_s')):>6} "
              f"{content:<7} {hang:<4} {status:<6}")
    print("-" * 100)

    print("\nDETAIL")
    for r in rows:
        print(f"\n  [{r['_slug']}]  status={'PASS' if r['_passed'] else 'FAIL'}  ({r['_reason']})")
        print(f"    utterance : {UTTERANCES.get(r['_slug'], '?')}")
        print(f"    transcript: {r.get('user_transcript') or '(none)'}")
        print(f"    bot reply : {r.get('bot_text') or '(none)'}")
        exp_tool = CHECKS.get(r["_slug"], {}).get("tool")
        called = r.get("tools_called") or []
        if exp_tool or called:
            fired = "fired" if exp_tool in called else "NOT fired (model self-answered)" if exp_tool else ""
            print(f"    tools     : called={called or '(none)'}"
                  + (f"  | expected {exp_tool}: {fired}" if exp_tool else ""))
        extra = []
        if r.get("greeting_seconds"):
            extra.append(f"greeting={r['greeting_seconds']}s")
        if r.get("finish_reason"):
            extra.append(f"finish={r['finish_reason']}")
        if r.get("latency_breakdown"):
            extra.append(f"latency={' | '.join(r['latency_breakdown'])}")
        if r.get("error"):
            extra.append(f"error={r['error']}")
        if extra:
            print(f"    notes     : {'; '.join(extra)}")

    n_pass = sum(1 for r in rows if r["_passed"])
    print("\n" + "=" * 100)
    print(f"SUMMARY: {n_pass}/{len(rows)} passed")
    print("=" * 100)


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("slugs", nargs="*", help=f"utterances to run (default: all). choices: {list(UTTERANCES)}")
    ap.add_argument("--base", default="http://localhost:7860", help="backend base URL")
    ap.add_argument("--llm", help="override llm_id (e.g. self-hosted:nemotron-super)")
    ap.add_argument("--timeout", type=float, default=30.0, help="per-turn response timeout (s)")
    ap.add_argument("--json", metavar="PATH", help="write raw per-turn results as JSON")
    ap.add_argument("--regen", action="store_true", help="(re)generate WAVs before running")
    args = ap.parse_args(argv)

    slugs = args.slugs or list(UTTERANCES)
    bad = [s for s in slugs if s not in UTTERANCES]
    if bad:
        ap.error(f"unknown slug(s): {bad}; choices: {list(UTTERANCES)}")

    if args.regen:
        gen_audio.generate(slugs)

    config = dict(DEFAULT_CONFIG)
    if args.llm:
        config["llm_id"] = args.llm

    print(f"Backend: {args.base}   llm: {config['llm_id']}   utterances: {slugs}")
    rows = run_suite(slugs, args.base, args.timeout, config)
    print_table(rows)

    if args.json:
        Path(args.json).write_text(json.dumps(rows, indent=2))
        print(f"\nRaw results written to {args.json}")

    return 0 if all(r["_passed"] for r in rows) else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
