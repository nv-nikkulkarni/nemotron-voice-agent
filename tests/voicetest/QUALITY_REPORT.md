# Nemotron Voice Agent — Exhaustive Conversation-Quality Report

**Target:** the all-local demo deployed on the viking-prod cluster (chart 0.1.39 /
app `demo7`), driven over the real WebSocket transport, TTS = **Chatterbox** (the
deploy default).
**Date:** 2026-07-30. **Harness:** `tests/voicetest/` (headless RTVI client).
**Scope:** 60 voice turns — 20 generic-assistant on **Nano**, 20 the same on
**Super** (the Generic card's default), 20 **omni-assistant-subagents**.

> TL;DR — **The pipeline plumbing is healthy; conversation quality is
> LLM-bound.** Warm, the pipeline is fast and reliable (welcome ≈ 0.9 s, response
> ≈ 1.1–1.5 s, **0 hangs**, TTS acoustically clean). Every notable defect traces
> to the **language model**, not ASR/TTS/transport:
> 1. **Cold start** — the first-ever inference has a **36 s** (Nano) / **~50 s**
>    (Omni) LLM TTFB, so the *first user's* welcome message hangs. Warms to < 1 s.
> 2. **Nano tool-calling is unreliable** — fires the right tool in **5/14**
>    queries; the fallback hallucinates or speaks unspeakable text (raw ISO
>    timestamps, `calculate_bmi with weight_kg=80…`, full-precision floats).
>    **Super fires 12/14 and speaks cleanly.**
> 3. **Omni prompt contamination** — "how to make coffee" and "how to tie
>    shoelaces" both answered about **mounting a GoPro on a tripod** (the prompt's
>    few-shot example), and one answer degenerated into **gibberish** ("Aishichai…").
> 4. **Tools return mock/static data** (no API keys) — answers sound right but are
>    fake/stale.

---

## 1. Method (how this was measured)

- **Queries** (`quality_spec.py`): 20 per example, each grounded in that example's
  system prompt. Generic covers all **7 tools ×2**, general knowledge, and
  identity/format. Omni covers the prompt's own contract — respond-completeness
  (count / ten-sentence story / how-to steps / math / knowledge), **camera-off**
  handling (headless = no webcam → must say it can't see), **clarify** on an
  ambiguous referent, and **think** on hard puzzles.
- **Query audio**: synthesized offline with **Piper** (`en_US-lessac-medium`,
  16 kHz mono) — real intelligible speech (`gen_quality_audio.py`).
- **Driving** (`harness.py` + `run_quality_suite.py`): one fresh WebSocket session
  per query — POST `/api/session-config`, send RTVI `client-ready`, wait out the
  opening greeting, stream the WAV as 20 ms PCM frames in real time, let Silero VAD
  fire end-of-turn, collect the reply. Each pipeline is **warmed** with 2 throwaway
  turns first (cold-start captured separately).
- **Captured per turn**: bot TTS audio (WAV), **welcome latency** = client-ready →
  first greeting audio, **response latency (TTFA)** = end-of-user-speech → first
  bot audio chunk, bot text, tools fired, the pipeline's own per-stage latency
  breakdown, and wall-clock epochs.
- **"Listening"** (`analyze_quality.py`): every one of the 60 bot WAVs is
  transcribed by an **independent ASR** (faster-whisper `base.en`) and compared to
  what the bot intended to say (token-F1 = "intelligibility"), plus acoustic
  metrics (RMS, clipping, leading/trailing/internal silence, dropouts) and
  streaming metrics (inter-chunk arrival gaps).
- **Correlation** (`correlate_logs.py`): each turn's epoch window is matched
  against the app / LLM / TTS / ASR / Omni pod logs to attribute every defect.

All raw artifacts are in `tests/voicetest/results/` (60 `*.turn.wav`,
`analysis.json`, `correlation.json`, `quality_results.json`, `logs/`).

---

## 2. Latency — answers "why is the welcome slow?" and "why the lags?"

### Cold start (the real "slow welcome" cause)
The **first inference after a (re)start** pays a one-time cost the prewarmer does
**not** cover (it warms TTS, not the LLM generate path):

| model | first-ever LLM TTFB | effect | after 1–2 turns |
|-------|--------------------:|--------|-----------------:|
| Nano  | **36.1 s** (`NvidiaLLMService TTFB: 36.090s` in app log) | welcome message never arrived → session **hung/timeout** | **0.9 s** |
| Omni  | **~50 s** (first turn wall 64 s) | greeting slid past the warm-up window | **1.7 s** |
| Super | ~cold ≈ tens of s (warms same way) | — | **0.95 s** |

The large system+tools prompt (**1211 tokens**) is loaded and the engine warms its
CUDA graphs / KV cache on that first call. **This is exactly why the first user
waits ~30–50 s for the bot to say hello.**

### Warm, steady-state (20 turns each)
| pass | welcome (median / p90 / max) | response TTFA (median / p90 / max) | hangs |
|------|------------------------------:|-----------------------------------:|:-----:|
| generic-**nano**  | **0.91 / 0.99 / 1.14 s** | **1.12 / 1.77 / 3.84 s** | 0 |
| generic-**super** | **0.95 / 1.06 / 1.13 s** | **1.48 / 1.94 / 1.97 s** | 0 |
| **omni**          | **1.72 / 2.71 / 2.83 s** | **3.02 / 5.15 / 5.97 s** | 0 |

Per-stage TTFB when warm (pipeline's own breakdown): **ASR ≈ 0.47 s, LLM ≈
0.14–0.16 s, TTS ≈ 0.45 s** — all excellent and consistent across passes.

**Lag sources, ranked:** (1) cold start (one-time, dominant); (2) **Omni is
inherently 2–3× slower** than the cascade (joint ASR+LLM reasoning model) — this
is the model, not the pipeline; (3) **Super verbosity** — correct but long answers
(stock reply = **22 s** of audio) delay *completion*, not first-audio; (4) two
~0.5 s streaming hitches across 60 turns (sentence boundaries) — negligible.

---

## 3. Reliability — answers "why did it not respond sometimes?"

**Warm: zero no-responses in 60 turns.** The **only** no-response in the whole
exercise was the **cold-start first turn** (36 s Nano LLM TTFB exceeded the client
timeout → WebSocketDisconnect while the reply was still generating). Once warm,
every turn produced audio. (Nano's tool *misses* still respond — just with the
wrong content; see §5.)

---

## 4. Audio quality — answers "why was the TTS audio broken?"

**Chatterbox TTS itself is clean.** Across 60 turns: RMS ≈ −15 dBFS (healthy),
clipping ≈ 0.0001–0.0002 (a handful of samples, inaudible), no leading/trailing
silence problems, and **no true mid-word dropouts**. What *sounds* broken has two
non-TTS causes:

| what you hear | count | real cause |
|---------------|:-----:|------------|
| **Genuine gibberish** — `o_days_leap`: after "There are 366 days in a leap year." the audio continues **10+ s** of "Aishichai! …they asked coming asks…" | **1 / 60** | **Omni LLM token degeneration** (repetition into foreign-looking tokens); Chatterbox faithfully voiced garbage text. |
| **Garbled-sounding** — Nano speaks raw ISO `2023-10-05T14:30Z`, `calculate_bmi with weight_kg=80…`, `BMI = 24.691358024691358` | 2–3 (Nano) | **LLM emits unspeakable text** (no rounding, leaked tool-call syntax, machine formats). TTS is fine; the *text* is unsayable. |
| **"Dropouts" in long replies** — Super stock/weather (0.36–0.56 s gaps) | ~6 (cosmetic) | **Natural inter-sentence pauses** in verbose multi-sentence answers. Not defects; a side-effect of verbosity. |
| **low intel on counting/math** (o_count5, o_math) | metric only | **whisper renders spoken "one two three" as "1 2 3"** → false mismatch. Audio is correct. |

**Net genuinely-broken audio: 1/60**, and its root cause is the Omni model, not
the TTS engine.

---

## 5. Conversation correctness (the dominant quality gap)

### Generic — tool firing (ground-truthed from `'role':'tool'` in the LLM context)
| | Nano | Super |
|--|:----:|:-----:|
| correct tool fired | **5 / 14** | **12 / 14** |
| Nano failure modes | hallucinated weather "30 °C" (no call); ISO timestamp for "time"; **"I need the age range"** for a currency query; **spoke the function-call syntax**; full-precision float | Super's 2 "misses" self-answered **correctly** (BMI 24.69; random "6") |

- **Nano** is the low-latency default *pipeline* choice but a poor tool-caller; its
  non-tool fallback is frequently wrong or unspeakable. **The demo card already
  defaults Generic → Super**, which is the right call: Super fires tools reliably
  and speaks naturally.
- **Format drift (both):** the prompt asks for **one sentence / no special
  characters / rounded values**. Nano leaks machine formats; Super is **verbose**
  (10–22 s multi-sentence answers for stock/weather/currency). Neither honors the
  one-sentence contract for tool results.
- **`generate_random_number`** → both models answer just **"6"** (0.3 s) — abrupt,
  no sentence framing.

### Omni — behavior contract (`generic_omni_assistant` prompt)
Good: **respond-completeness works** — count 1–5 / 1–10 verbatim, a full
ten-sentence story (46 s), math (17×23 → "three hundred ninety-one"), knowledge,
and **camera-off** handled 2/3 ("I can't see anything right now because the camera
is off"), **clarify** correct ("What would you like help with?"), and one hard
puzzle right (widgets → "five minutes").

Bad:
- **Prompt contamination (P1):** `o_howto_coffee` and `o_howto_shoes` **both**
  answered about **mounting a GoPro on a tripod** — copied verbatim from the
  prompt's own few-shot example (`"How do I mount the GoPro on the tripod?"`). The
  example is too "sticky."
- **Reasoning miss:** bat-and-ball → *"I don't know how much the ball costs"*
  (should be 5¢). The `think` escalation didn't recover it.
- **Degeneration → gibberish audio:** `o_days_leap` (see §4).
- **camera-off inconsistency:** `o_camera_holding` gave a clarify instead of
  "camera is off."

---

## 6. Model comparison

| dimension | Nano (cascade) | Super (cascade) | Omni (speech-to-speech) |
|-----------|:--------------:|:---------------:|:-----------------------:|
| welcome (warm) | **0.91 s** | 0.95 s | 1.72 s |
| response TTFA (warm) | **1.12 s** | 1.48 s | 3.02 s |
| tool reliability | 5/14 ❌ | **12/14 ✅** | n/a |
| speaks cleanly | ❌ (leaks formats) | **✅** | mostly (1 degeneration) |
| verbosity | terse/ok | **too verbose** | ok |
| best for | latency | **default / quality** | multimodal, completeness |

---

## 7. Root-cause summary

| # | Symptom | Root cause | Evidence |
|---|---------|-----------|----------|
| R1 | Welcome takes 30–50 s for the first user | **LLM cold start** (first inference warms CUDA graphs / KV on a 1211-token prompt); prewarmer warms TTS only | `NvidiaLLMService TTFB: 36.090s`; omni first turn 64 s wall |
| R2 | Wrong/absent answers, "didn't use the tool" | **Nano tool-calling unreliability**; small model | 5/14 tool firing; hallucinated weather/time/currency |
| R3 | "Broken"/robotic audio on some replies | **LLM emits unspeakable text** (ISO, floats, tool-call syntax) | `2023-10-05T14:30Z`, `BMI = 24.691358024691358` |
| R4 | 10+ s of gibberish in one omni reply | **Omni token degeneration** (repetition) | `o_days_leap` heard: "Aishichai… " |
| R5 | Both how-to questions answered about a GoPro | **Prompt few-shot example is too sticky** | `o_howto_coffee/shoes` → tripod steps |
| R6 | Data sounds stale/fake | **Tools return mock data** (no API keys) | `"source":"mock","Live weather unavailable… set WEATHERAPI_KEY"` |
| R7 | Long, multi-sentence spoken answers | **Super verbosity** vs one-sentence prompt | stock reply 22 s / 15 s |

---

## 8. Mitigation plan & action items

Ordered by impact. **Config/prompt/chart-first** (no app-source changes) per the
project rule; source changes flagged explicitly and only where they're the right
fix.

### P0 — kill the cold-start welcome hang (biggest single UX win)
- **A1 (chart):** extend the existing **prewarmer** to warm the **LLM generate
  path**, not just TTS — POST a tiny `/v1/chat/completions` to each enabled LLM
  (Nano, Super, Omni) at startup and on an interval, using the **real system+tools
  prompt** so the 1211-token context is warmed. This turns the first user's 36 s /
  50 s into < 2 s. *Chart-only, matches the "prewarm lives in the chart" decision.*
- **A2 (config):** raise the client/first-connect timeout and add a "warming up…"
  UI state so an unwarmed first hit degrades gracefully instead of hanging.
- **A3 (ops):** keep at least one session warmed (synthetic heartbeat) so idle
  eviction never re-cold-starts during a demo.

### P1 — conversation correctness
- **A4 (config, already partly done):** keep **Generic → Super** as the card
  default (Super: 12/14 tools, clean speech). Consider hiding Nano behind an
  "experimental / low-latency" label. *Done for default; add the label.*
- **A5 (prompt):** fix the **Omni GoPro contamination** — replace the sticky
  `"mount the GoPro on the tripod"` few-shot in `generic_omni_assistant` with a
  neutral, clearly-hypothetical example, or add "do not reuse the example's
  subject; answer the user's actual topic." *Prompt file = config.*
- **A6 (config → extra_params):** reduce **Omni degeneration** — raise
  `repetition_penalty` (1.05 → ~1.15), add stop sequences, and cap `max_tokens`
  for the speaker turn so a repetition loop can't run 10 s. *`services.*.yaml`
  extra_params = config.*
- **A7 (prompt):** tighten **spoken-format** compliance — for tool results,
  instruct "state the value in one spoken sentence, round to 1–2 decimals, never
  output ISO timestamps, code, or function syntax." Helps Nano *and* Super
  verbosity.

### P2 — data realism & polish
- **A8 (secrets/env):** set **`WEATHERAPI_KEY`** and the stock/news keys via the
  cluster Secret so tools return **live** data instead of mock. *Env/secret =
  config.*
- **A9 (source, only if A7 insufficient):** the shipped **`NemotronSpeechTextFilter`**
  is the correct place to *guarantee* speakability — extend it to normalize ISO
  timestamps → spoken dates, round bare floats, and strip any leaked
  `name(args=…)` tool syntax before TTS. This is a **speech-quality safety net**,
  justified as a real defect fix if prompting alone can't stop Nano.
- **A10 (prompt/UX):** frame trivial one-token answers ("6") as a short sentence
  ("Your number is 6.") for a less abrupt feel.
- **A11 (perf, optional):** if Omni's 3 s TTFA matters for the demo, evaluate
  disabling its reasoning for simple turns or a smaller draft — but its
  completeness is good; latency is the only knock.

### Verify-after
Re-run `python run_quality_suite.py` + `analyze_quality.py` after A1/A5/A6/A8 and
confirm: first-turn welcome < 2 s, Omni how-to answers on-topic, no gibberish
tail, tools return live values.

---

## 9. Appendix — per-query results

See `results/per_query_table.txt` for all 60 turns (welcome / TTFA / audio-secs /
intelligibility / tool-fired / content-ok / flags), and `results/*.turn.wav` for
the captured audio. Reproduce end-to-end:

```bash
python tests/voicetest/gen_quality_audio.py          # 40 query WAVs
python tests/voicetest/run_quality_suite.py          # drive 60 turns, capture audio
python tests/voicetest/analyze_quality.py            # transcribe + acoustic/streaming analysis
python tests/voicetest/correlate_logs.py             # attribute defects to pod-log events
```
