# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause
"""The 40-query exhaustive voice-quality suite (20 generic-assistant + 20 omni).

Every query is grounded in the two example system prompts:

  * generic-assistant  (src/examples/generic/prompts.yaml :: generic_assistant)
    - 7 tools: convert_currency, calculate_bmi, get_current_date_time,
      get_stock_price, generate_random_number, get_weather, get_news_headlines
    - general knowledge, one-sentence spoken format.

  * omni-assistant-subagents (src/examples/omni_assistant_subagents/prompts.yaml
    :: generic_omni_assistant) - speech-to-speech Omni model + subagents.
    - respond completeness (count/story/how-to/math/knowledge), camera-off
      handling (no webcam in a headless run -> must say it can't see), clarify
      on an ambiguous referent, think on a genuinely hard puzzle.

Each entry:
  slug            stable key / wav filename
  example         "generic" | "omni"
  text            the spoken utterance (Piper synthesizes this)
  category        grouping for the report
  expect_tool     tool the generic pipeline SHOULD call (None if n/a)
  expect          short behavior tag: tool|knowledge|format|respond|camera_off|
                  clarify|think
  content         case-insensitive regex the bot reply should match to count as
                  "answered correctly" (None => only non-empty is required).
                  Kept lenient on purpose: we score usefulness, not exact wording.
"""
from __future__ import annotations

QUERIES: list[dict] = [
    # ===================== generic-assistant (20) =====================
    # ---- tools: 2 utterances per tool (14) ----
    dict(slug="g_weather_tokyo",   example="generic", category="tool:get_weather",
         text="What's the weather in Tokyo?",
         expect_tool="get_weather", expect="tool",
         content=r"tokyo|temperature|\d"),
    dict(slug="g_weather_london",  example="generic", category="tool:get_weather",
         text="What is the weather like in London today?",
         expect_tool="get_weather", expect="tool",
         content=r"london|temperature|\d"),
    dict(slug="g_currency_usd_eur", example="generic", category="tool:convert_currency",
         text="Convert one hundred dollars to euros.",
         expect_tool="convert_currency", expect="tool",
         content=r"euro|\d"),
    dict(slug="g_currency_gbp_jpy", example="generic", category="tool:convert_currency",
         text="How much is fifty British pounds in Japanese yen?",
         expect_tool="convert_currency", expect="tool",
         content=r"yen|\d"),
    dict(slug="g_bmi_70",          example="generic", category="tool:calculate_bmi",
         text="What is my B M I if I weigh seventy kilograms and am one point seven five meters tall?",
         expect_tool="calculate_bmi", expect="tool",
         content=r"\d"),
    dict(slug="g_bmi_80",          example="generic", category="tool:calculate_bmi",
         text="Calculate my body mass index for eighty kilograms and one point eight meters.",
         expect_tool="calculate_bmi", expect="tool",
         content=r"\d"),
    dict(slug="g_time_london",     example="generic", category="tool:get_current_date_time",
         text="What time is it in London right now?",
         expect_tool="get_current_date_time", expect="tool",
         content=r"\d|london|time"),
    dict(slug="g_time_tokyo",      example="generic", category="tool:get_current_date_time",
         text="What is the current time in Tokyo?",
         expect_tool="get_current_date_time", expect="tool",
         content=r"\d|tokyo|time"),
    dict(slug="g_stock_nvda",      example="generic", category="tool:get_stock_price",
         text="What is the current stock price of Nvidia?",
         expect_tool="get_stock_price", expect="tool",
         content=r"\d|dollar|price"),
    dict(slug="g_stock_aapl",      example="generic", category="tool:get_stock_price",
         text="How much is Apple stock trading at right now?",
         expect_tool="get_stock_price", expect="tool",
         content=r"\d|dollar|price"),
    dict(slug="g_random_1_10",     example="generic", category="tool:generate_random_number",
         text="Give me a random number between one and ten.",
         expect_tool="generate_random_number", expect="tool",
         content=r"\d|one|two|three|four|five|six|seven|eight|nine|ten"),
    dict(slug="g_random_1_100",    example="generic", category="tool:generate_random_number",
         text="Pick a random number from one to one hundred.",
         expect_tool="generate_random_number", expect="tool",
         content=r"\d|number"),
    dict(slug="g_news_business",   example="generic", category="tool:get_news_headlines",
         text="What are the latest business news headlines?",
         expect_tool="get_news_headlines", expect="tool",
         content=r"\w{4,}"),
    dict(slug="g_news_tech",       example="generic", category="tool:get_news_headlines",
         text="Give me today's top technology news headlines.",
         expect_tool="get_news_headlines", expect="tool",
         content=r"\w{4,}"),
    # ---- general knowledge, plain LLM (4) ----
    dict(slug="g_know_france",     example="generic", category="knowledge",
         text="What is the capital of France?",
         expect_tool=None, expect="knowledge", content=r"paris"),
    dict(slug="g_know_planet",     example="generic", category="knowledge",
         text="What is the largest planet in our solar system?",
         expect_tool=None, expect="knowledge", content=r"jupiter"),
    dict(slug="g_know_author",     example="generic", category="knowledge",
         text="Who wrote the play Romeo and Juliet?",
         expect_tool=None, expect="knowledge", content=r"shakespeare"),
    dict(slug="g_know_boil",       example="generic", category="knowledge",
         text="At what temperature in Celsius does water boil?",
         expect_tool=None, expect="knowledge", content=r"100|hundred"),
    # ---- identity + format (2) ----
    dict(slug="g_introduce",       example="generic", category="format",
         text="Hello, please introduce yourself.",
         expect_tool=None, expect="format", content=r"nemotron|nvidia|assist"),
    dict(slug="g_greeting",        example="generic", category="format",
         text="Hi there, how are you doing today?",
         expect_tool=None, expect="format", content=r"\w{3,}"),

    # ===================== omni-assistant-subagents (20) =====================
    # ---- respond completeness (13) ----
    dict(slug="o_count5",          example="omni", category="respond:count",
         text="Please count from one to five.",
         expect_tool=None, expect="respond",
         content=r"one.*two.*three.*four.*five"),
    dict(slug="o_count10",         example="omni", category="respond:count",
         text="Count out loud from one to ten for me.",
         expect_tool=None, expect="respond",
         content=r"one.*two.*three.*four.*five.*six.*seven.*eight.*nine.*ten"),
    dict(slug="o_story",           example="omni", category="respond:story",
         text="Tell me a ten sentence story about a curious robot.",
         expect_tool=None, expect="respond", content=r"(\w+[.!?]\s+){5,}"),
    dict(slug="o_howto_coffee",    example="omni", category="respond:howto",
         text="How do I make a good cup of coffee? Walk me through the steps.",
         expect_tool=None, expect="respond", content=r"first|then|next|finally|step"),
    dict(slug="o_howto_shoes",     example="omni", category="respond:howto",
         text="How do I tie my shoelaces? Give me the steps in order.",
         expect_tool=None, expect="respond", content=r"first|then|next|finally|loop|cross"),
    dict(slug="o_math_17x23",      example="omni", category="respond:math",
         text="What is seventeen times twenty three?",
         expect_tool=None, expect="respond", content=r"391|three hundred ninety"),
    dict(slug="o_math_div",        example="omni", category="respond:math",
         text="What is one hundred forty four divided by twelve?",
         expect_tool=None, expect="respond", content=r"\b12\b|twelve"),
    dict(slug="o_math_pct",        example="omni", category="respond:math",
         text="What is twenty five percent of eighty?",
         expect_tool=None, expect="respond", content=r"\b20\b|twenty"),
    dict(slug="o_know_planet",     example="omni", category="respond:knowledge",
         text="What is the largest planet in our solar system?",
         expect_tool=None, expect="respond", content=r"jupiter"),
    dict(slug="o_know_capital",    example="omni", category="respond:knowledge",
         text="What is the capital city of Japan?",
         expect_tool=None, expect="respond", content=r"tokyo"),
    dict(slug="o_explain_photo",   example="omni", category="respond:explain",
         text="Briefly explain how photosynthesis works.",
         expect_tool=None, expect="respond", content=r"light|sun|plant|energy|carbon"),
    dict(slug="o_colors",          example="omni", category="respond:knowledge",
         text="Name the three primary colors.",
         expect_tool=None, expect="respond", content=r"red|blue|yellow"),
    dict(slug="o_days_leap",       example="omni", category="respond:knowledge",
         text="How many days are there in a leap year?",
         expect_tool=None, expect="respond", content=r"366|three hundred sixty"),
    # ---- camera-off / live-visual (no webcam in a headless run) (3) ----
    dict(slug="o_camera_see",      example="omni", category="camera_off",
         text="What do you see on my camera right now?",
         expect_tool=None, expect="camera_off",
         content=r"can'?t see|cannot see|camera|turn (it|your)|not see|no (live )?view"),
    dict(slug="o_camera_canyou",   example="omni", category="camera_off",
         text="Can you see me right now?",
         expect_tool=None, expect="camera_off",
         content=r"can'?t see|cannot see|camera|turn (it|your)|not see|no (live )?view"),
    dict(slug="o_camera_holding",  example="omni", category="camera_off",
         text="What am I holding up in my hand right now?",
         expect_tool=None, expect="camera_off",
         content=r"can'?t see|cannot see|camera|turn (it|your)|not see|no (live )?view"),
    # ---- clarify on an ambiguous referent (1) ----
    dict(slug="o_clarify",         example="omni", category="clarify",
         text="Can you help me with it?",
         expect_tool=None, expect="clarify",
         content=r"\?|what|which|help with|more detail|specif"),
    # ---- think: genuinely hard puzzles (2) ----
    dict(slug="o_think_widgets",   example="omni", category="think",
         text="If it takes five machines five minutes to make five widgets, how long would one hundred machines take to make one hundred widgets?",
         expect_tool=None, expect="think", content=r"five|5"),
    dict(slug="o_think_batball",   example="omni", category="think",
         text="A bat and a ball cost one dollar and ten cents together, and the bat costs one dollar more than the ball. How much does the ball cost?",
         expect_tool=None, expect="think", content=r"five cents|0\.05|\bfive\b|\b5\b"),
    # ---- identity (1) ----
    dict(slug="o_introduce",       example="omni", category="format",
         text="Hello, please introduce yourself.",
         expect_tool=None, expect="format", content=r"nvidia|assistant|help"),
]


def by_example(example: str) -> list[dict]:
    return [q for q in QUERIES if q["example"] == example]


if __name__ == "__main__":
    g = by_example("generic")
    o = by_example("omni")
    print(f"generic: {len(g)}   omni: {len(o)}   total: {len(QUERIES)}")
    for q in QUERIES:
        print(f"  {q['example']:7s} {q['slug']:18s} {q['category']:26s} {q['text']}")
