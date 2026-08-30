# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause
"""Quality test for BOTH demo examples against the live NVCF deployment (via the
local nvcf-ui proxy). Drives cloud-Magpie-synthesized voice queries end-to-end,
using Chatterbox TTS for the bot voice, and reports transcript / answer / tools /
Chatterbox streaming latency per turn.

  uv run python tests/voicetest/run_quality_test.py [--base URL] [slug ...]
"""
from __future__ import annotations

import argparse
import json
import re
import time
from pathlib import Path

from harness import run_turn

HERE = Path(__file__).resolve().parent
AUDIO = HERE / "audio"

CB = ("self-hosted:chatterbox-multilingual-tts", "Chatterbox-Multilingual.en-US.Male")


def gcfg(llm: str = "self-hosted:nemotron-nano") -> dict:
    return {
        "pipeline_mode": "generic-assistant",
        "llm_id": llm,
        "asr_id": "self-hosted:nemotron-asr-streaming-english",
        "tts_id": CB[0], "tts_voice_id": CB[1],
        "prompt_key": "generic_assistant",
    }


def ocfg() -> dict:
    return {
        "pipeline_mode": "omni-assistant-subagents",
        "llm_id": "self-hosted:nemotron-omni-nvfp4",
        "tts_id": CB[0], "tts_voice_id": CB[1],
        "prompt_key": "generic_omni_assistant",
    }


# slug -> (example, config, expected_tool, needs[] regexes that must ALL match)
TESTS: dict[str, tuple] = {
    # ---- generic-assistant: knowledge + 7 tools + format ----
    "introduce": ("generic", gcfg(), None, []),
    "knowledge": ("generic", gcfg(), None, [r"paris"]),
    "weather": ("generic", gcfg(), "get_weather", [r"tokyo", r"\d"]),
    "currency": ("generic", gcfg(), "convert_currency", [r"eur|euro|€", r"\d"]),
    "bmi": ("generic", gcfg(), "calculate_bmi", [r"\d", r"bmi|body mass|22|23|normal|healthy"]),
    "stock": ("generic", gcfg(), "get_stock_price", [r"\d"]),
    "time": ("generic", gcfg(), "get_current_date_time", [r"\d"]),
    "random": ("generic", gcfg(), "generate_random_number", [r"\d"]),
    "news": ("generic", gcfg(), "get_news_headlines", []),
    # ---- omni-assistant-subagents: completeness + turn-actions + camera-off ----
    "omni_count": ("omni", ocfg(), None, [r"one.*two.*three.*four.*five"]),
    "omni_howto": ("omni", ocfg(), None, [r"first|step|then"]),
    "omni_story": ("omni", ocfg(), None, [r"\w+"]),
    "omni_knowledge": ("omni", ocfg(), None, [r"jupiter"]),
    "omni_math": ("omni", ocfg(), None, [r"391"]),
    "omni_camera": ("omni", ocfg(), None, [r"can.?t see|camera|turn (it|the camera) on|not.*see|don.?t see"]),
}


def needs_ok(needs: list[str], text: str) -> bool:
    low = text.lower()
    return all(re.search(p, low) for p in needs)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:7862")
    ap.add_argument("--out", default=str(HERE / "quality_results.json"))
    ap.add_argument("slugs", nargs="*")
    args = ap.parse_args()

    slugs = args.slugs or list(TESTS)
    results = []
    print(f"\n=== Voice quality test — base={args.base} — TTS=Chatterbox — {len(slugs)} turns ===\n")
    for slug in slugs:
        ex, cfg, tool, needs = TESTS[slug]
        wav = str(AUDIO / f"{slug}.wav")
        t0 = time.time()
        try:
            res = run_turn(args.base, cfg, wav, timeout_s=50)
        except Exception as exc:  # noqa: BLE001
            res = {"error": f"{type(exc).__name__}: {exc}"}
        wall = round(time.time() - t0, 1)
        res.update({"_slug": slug, "_example": ex, "_tool": tool, "_needs": needs, "_wall": wall})
        results.append(res)

        err = res.get("error")
        transcript = res.get("user_transcript", "")
        bot = res.get("bot_text", "")
        ttfa = res.get("time_to_first_bot_audio_s")
        audio_s = res.get("bot_audio_seconds", 0.0)
        tools = res.get("tools_called", [])
        content = needs_ok(needs, bot) if not err else False
        tool_ok = (tool in tools) if tool else None
        status = "ERR " if err else ("PASS" if content and not res.get("hang") else "FAIL")
        print(f"[{status}] {slug:15s} ({ex})")
        if err:
            print(f"        error: {err}")
        else:
            print(f'        heard : "{transcript}"')
            print(f'        said  : "{bot}"')
            print(f"        ttfa={ttfa}s  botAudio={audio_s}s  tools={tools or '-'}  toolExp={tool or '-'}({tool_ok})  wall={wall}s")
        print()

    Path(args.out).write_text(json.dumps(results, indent=2))
    # summary
    npass = sum(1 for r in results if not r.get("error") and not r.get("hang")
                and needs_ok(r["_needs"], r.get("bot_text", "")))
    print(f"=== SUMMARY: {npass}/{len(results)} passed — raw -> {args.out} ===")


if __name__ == "__main__":
    main()
