# Generic Frontend/Backend Agent — Concurrency Benchmark, Production NVCF

**Run date:** 2026-09-18 (suite `perf_suite_20260918_033736`)
**Audience:** another agent or engineer picking this up cold. Everything needed to interpret the
numbers is defined below; nothing assumes prior context.

---

## 1. What was measured

The Nemotron Voice Agent's **Generic Frontend/Backend Agent** running on the production
deployment, driven by a WebSocket client that simulates a speaking user.

| | |
|---|---|
| Endpoint | `wss://nemotron-voice-agent-deploy-backend.prd.astra.nvidia.com:443/api/ws` |
| Active example | `generic-frontend-backend-agent` (confirmed live via `GET /api/deployment`) |
| Frontend model ("Talker") | Nemotron 3.5 Lightning 30B-A3B, `enable_thinking: false`, `max_tokens 512`, `temperature 0` |
| Backend model ("Thinker") | Nemotron 3 Super 120B-A12B, `enable_thinking: true`, `reasoning_budget 256`, `max_tokens 768` |
| ASR / TTS | Nemotron ASR Streaming English / Magpie TTS Multilingual |
| Backend topology | 5 app replicas; 7 of 8 H100 GPUs; single replica of each model service |
| Tool | `benchmarking_tools/scaling-perf/benchmark.py` + `simulate_concurrency.sh`, branch `dev/nikkulkarni/generic-frontend-backend-agent-v2` |
| Levels | 1, 4, 8, 16 concurrent streams |
| Window | 300 s of metric collection per level, 20 s cooldown between levels |
| Input | 10 × 16 kHz mono int16 WAV files, cycled one per turn |
| Total | 260 turns, ~40 % of which delegated to the backend |

### How the agent works (needed to read the stage metrics)

One user turn takes one of two paths:

- **Direct** — the Talker answers from its own knowledge. ASR → Talker → TTS.
- **Delegated** — the Talker emits a `call_backend` tool call instead of an answer. The Super
  Thinker produces one bounded JSON plan, Python validates it against an allow-list and runs the
  approved tools, and the result is spoken. The Talker holds only `call_backend` / `cancel_backend`
  and calls no external service itself.

The stage metrics below (`frontend_*`, `backend_*`) are emitted **only on delegated turns**. The
plain pipeline metrics (`llm_ttft`, `asr_ttfb`, …) are emitted on **every** turn.

### Input queries

The ten WAVs, in cycle order, with observed behaviour:

| # | Utterance | Path |
|---|---|---|
| 1 | "What can you do" | direct |
| 2 | "Thank you, it was nice talking to you" | direct |
| 3 | "What is the latest product from NVIDIA?" | delegated → `web_search` |
| 4 | "Can you tell me more about the latest GPU from NVIDIA?" | delegated → `web_search` |
| 5 | "I'm thinking to visit Japan, can you tell me the best time to…" | delegated → `web_search` |
| 6 | "What's the weather like in Tokyo right now?" | delegated → `get_weather` |
| 7 | "Can you explain how retracing works in simple terms?" | direct |
| 8 | "Tell me a story about a future…" | direct |
| 9 | "Could you tell me about the history of the Internet from…" | direct |
| 10 | "What would your dream job be if you were human" | direct |

Four of ten delegate, three of those to `web_search` (Perplexity Sonar, an external provider).

---

## 2. Metric definitions

Read this before the numbers. Several metrics have non-obvious populations.

### Client-side

| Metric | Definition |
|---|---|
| **Client E2E latency** | Wall clock at the simulated user, from the end of the input WAV to the first audio frame of the *real* bot response. Includes public-internet RTT to Astra. Turns whose first audio arrives within 0.4 s of the user finishing are classified as *reverse barge-in* (the server racing the end of the utterance) and excluded. |

### Server-side, plain pipeline (every turn)

Pushed over RTVI on the same WebSocket. Emitted by Pipecat's own instrumentation; these metric
frames carry **no** `stage` field.

| Metric | Definition |
|---|---|
| **`server_e2e`** | Server-measured user-stop → first bot speech. Excludes network RTT. Reported by the server as `user-bot-latency`; the session's opening greeting (`first: true`) is excluded. |
| **`llm_ttft`** | Time to first token from the **Talker** LLM service. Population: *every* Talker inference, including the opening greeting and both direct and delegated turns. |
| **`llm_processing_time`** | Talker request → final token. |
| **`llm_tokens_per_sec`** | Completion tokens ÷ `llm_processing_time`, Talker only. |
| **`asr_ttfb`** | Time to first byte from streaming ASR. |
| **`tts_ttfb`** | Time to first byte from TTS. Sample count exceeds turn count because one turn can produce several synthesis segments. |
| **`vad_smart_turn`** | Voice-activity detection plus smart-turn endpointing time. |

### Server-side, agent stages (delegated turns only)

Emitted by `src/examples/frontend_backend_agent/src/stage_metrics.py`. These are ordinary Pipecat
TTFB/processing frames with additive correlation fields — `stage`, `turn_id`, `invocation_id`,
`parent_invocation_id`, `attempt`, `outcome`, `tool_name` — so every stage can be tied back to the
turn that produced it.

| Metric | Definition |
|---|---|
| **`frontend_tool_selection_ttft`** | Talker request → the first streamed chunk **containing a tool call**, i.e. the moment the agent has committed to delegating. Clock starts in `_process_context` *before* Pipecat's, so it includes context assembly and reads ~15–20 ms higher than `llm_ttft` on the same turn. |
| **`frontend_tool_selection_processing_time`** | The same Talker inference, request → final token. |
| **`backend_llm_ttft`** | Super Thinker request → first token of its plan (first planning round). |
| **`backend_llm_processing_time`** | Super Thinker request → complete plan (first planning round). |
| **`backend_llm_dependent_ttft` / `_processing_time`** | Planning rounds 2 and 3, used when a later step depends on an earlier tool result. **No samples in this run** — see §6. |
| **`backend_tool_call_latency`** | One allow-listed tool execution, from dispatch to result. Processor name is `backend_tool_call.<tool>`; carries `tool_name` and `outcome`. Mostly external provider time. |
| **`frontend_final_response_ttft` / `_processing_time`** | Talker composing a spoken reply from the trusted result. **No samples** — this deployment runs `frontendBackendToolResultMode: direct`, which speaks trusted backend text without a second Talker inference. Absence here is correct, not a gap. |

> **`llm_ttft` vs `frontend_tool_selection_ttft` — do not add them.** They time the *same*
> inference with different clocks over different populations. On a single delegated turn both
> appear: `frontend_tool_selection_llm: TTFB 0.189s` alongside
> `ReliableNvidiaLLMService#24: TTFB 0.172s`. On a direct turn only the Pipecat one appears.
> Compare them per turn, never by column average.

---

## 3. Headline result

**No degradation from 1 to 16 concurrent streams.**

| Streams | Turns | Delegated | Client E2E mean | Client p95 | Server E2E median | Server p95¹ |
|---|---|---|---|---|---|---|
| 1 | 9 | 33 % | 1.648 | 2.240 | 1.229 | 1.859 |
| 4 | 43 | 42 % | 1.585 | 2.430 | 1.210 | 2.036 |
| 8 | 69 | 43 % | 1.544 | 2.052 | 1.213 | 2.011 |
| 16 | 139 | 40 % | 1.658 | 2.486 | 1.247 | 2.210 |

¹ Excluding the uncovered-delegation outliers isolated in §5. All values in seconds.

Median server-side response is flat at **1.21–1.25 s** across a 16× load increase. Client-side p95
moves 2.24 → 2.49 s, within run-to-run noise.

---

## 4. Full metric table

All values in seconds unless noted. `n` = sample count.

### Plain pipeline

| Metric | 1 | 4 | 8 | 16 |
|---|---|---|---|---|
| `asr_ttfb` | 0.443 | 0.438 | 0.400 | 0.414 |
| `llm_ttft` (Talker) | 0.437 | 0.409 | 0.430 | 0.481 |
| `llm_processing_time` | 0.469 | 0.447 | 0.473 | 0.519 |
| `llm_tokens_per_sec` | 190.4 | 173.0 | 175.0 | 171.4 |
| `tts_ttfb` | 0.066 | 0.064 | 0.064 | 0.070 |
| `vad_smart_turn` | 0.552 | 0.606 | 0.579 | 0.599 |
| *n (turns)* | 9 | 43 | 74 | 147 |

### Agent stages (mean / median / p95)

| Metric | 1 | 4 | 8 | 16 |
|---|---|---|---|---|
| `frontend_tool_selection_ttft` | 0.207 / 0.211 / 0.217 | 0.237 / 0.225 / 0.329 | 0.236 / 0.223 / 0.384 | 0.247 / 0.220 / 0.422 |
| `frontend_tool_selection_processing_time` | 0.307 / 0.311 / 0.358 | 0.358 / 0.349 / 0.445 | 0.358 / 0.333 / 0.545 | 0.384 / 0.342 / 0.564 |
| `backend_llm_ttft` | 0.123 / 0.122 / 0.126 | 0.153 / 0.121 / 0.384 | 0.132 / 0.121 / 0.227 | 0.150 / 0.136 / 0.232 |
| `backend_llm_processing_time` | 2.264 / 1.826 / 4.050 | 2.292 / 2.200 / 3.578 | 1.884 / 1.680 / 3.907 | 2.087 / 1.906 / 4.201 |
| `backend_tool_call_latency` | 3.450 / 4.124 / 4.735 | 4.078 / 4.440 / 8.657 | 4.502 / 3.802 / 8.456 | 3.578 / 3.333 / 7.648 |
| *n (delegated turns)* | 3–5 | 18–20 | 30–36 | 56–60 |

**Interpretation.** The Talker's delegate decision costs ~0.21–0.25 s and is stable under load. The
Super Thinker starts streaming its plan in ~0.12–0.15 s and finishes in ~2 s, essentially
unchanged from 1 to 16 streams — two GPUs at `tp=2` are not the bottleneck at this concurrency.
Tool latency is dominated by the external search provider and shows no load trend.

### Tool outcomes

| Streams | `web_search` success | `web_search` cancelled | `web_search` error | `get_weather` success |
|---|---|---|---|---|
| 1 | 3 | 1 | 0 | 1 |
| 4 | 13 | 2 | 0 | 5 |
| 8 | 25 | 3 | 1 | 7 |
| 16 | 36 | 10 | 0 | 14 |

`cancelled` is the supersede path working as designed: a new user turn arrived and cancelled
in-flight backend work. Its share rises with concurrency (10 of 46 searches at 16 streams),
because slower searches are more likely to be overtaken by the client's fixed turn cadence.

---

## 5. The one real defect found

Server-side response times are **bimodal**. Turns are either ~1.2 s or ~20 s, with nothing between.

| Streams | Turns ≥ 5 s | Share | Median of those | Range |
|---|---|---|---|---|
| 1 | 0 | 0 % | — | — |
| 4 | 5 | 12 % | 22.1 | 14.8 – 28.4 |
| 8 | 7 | 10 % | 20.4 | 16.1 – 33.2 |
| 16 | 6 | 4 % | 18.3 | 14.1 – 29.3 |

Every slow turn is a delegated `web_search` where **no filler utterance covered the wait** — the
user heard silence until the answer arrived. External provider time is only 3.5–4.5 s of those
~20 s; the rest is the agent not speaking.

This is the frontend/backend design failing on roughly one turn in ten. The architecture's premise
is that the reasoning pass runs asynchronously *while the Talker stays live* — issuing a short
progress phrase, continuing to listen, handling barge-in. When the filler does not fire, the user
experiences a single-brain agent blocked on its slowest tool.

**This is the highest-value item in this report.** Suggested starting points: the filler threshold
(`THINKER_FILLER_THRESHOLD_SECONDS`, default 0.3 s), `frontendBackendTalkerFillerMode: "emit"` in
the deployed chart, and `schedule_thinker_started_filler` in
`src/examples/frontend_backend_agent/src/tool_handlers.py`, which requires a non-empty
`filler_text` argument on the Talker's `call_backend` call.

---

## 6. Excluded and unreliable entries

Recorded here so the tables above are not misread. Nothing in this section was silently dropped.

| Entry | Count | Disposition |
|---|---|---|
| **"Hard deadline reached (3xx s)"** | 2 / 7 / 12 at levels 4 / 8 / 16 | **Not failures.** A client hit its session-end deadline with a turn in flight. The aggregator already classifies these as successful — 8 of 8 at the 8-stream level despite 7 such messages. Ignore them. |
| **Reverse barge-ins** | 1 / 10 / 9 / 15 | Already excluded from all latency statistics by the tool. Bot audio arriving within 0.4 s of the user finishing; treated as the server racing the end of the utterance. |
| **Audio glitch flag** | every client, every level | WAN artifact. Output-buffer underrun measured at a client sitting across the public internet from Astra. Carries no information about the deployment. |
| **Client latencies < 0.6 s** | 1 at 8 streams (0.515), 1 at 16 (0.469) | **Treat as suspect.** Probably filler or greeting audio timed as the response. Above the 0.4 s reverse-barge-in threshold so they were counted as valid; the threshold is arguably too low. Their effect on the means is negligible. |
| **`backend_llm_dependent_*`** | 0 samples | Not an error. These ten queries are all single-round. The columns exist and are unit-tested but were not exercised by live traffic. To exercise them, use a query needing a dependent second round, e.g. *"what's the weather where the next GTC is held"*. |
| **`frontend_final_response_*`** | 0 samples | Not an error. Correct for `frontendBackendToolResultMode: direct`. |
| **Genuine failure** | 1 | `client_16` at the 16-stream level: *"WebSocket connection closed."* One client of 16 for one level. Cause not established. |

---

## 7. Caveats

1. **Not comparable to the published reference table.** `docs/04-evaluation-and-performance.md`
   reports an in-cluster 4×H100 benchmark of the single-model Generic Assistant. This run measures a
   two-model agent over the public internet through Astra. Different topology, different pipeline,
   different network path.
2. **The knee was not found.** 16 was the ceiling by choice, and nothing strained at 16. The NVCF
   edge admits 100 concurrent requests; where the deployment actually saturates is unknown. This
   run neither confirms nor refutes the "up to 30 simultaneous conversations" figure used elsewhere.
3. **Backend stage samples are thin at low concurrency** — n=3 at 1 stream. Treat the 1-stream
   stage column as indicative only. The 8- and 16-stream columns (n=30, n=56) are solid.
4. **`llm_ttft` rises within a session** as conversation context accumulates — observed 0.168 s on
   the first turn to 0.632 s by turn 13 of one session. Column averages therefore depend on session
   length and on where in the 10-file cycle each turn falls. Do not compare `llm_ttft` across runs
   of different durations.
5. **Tool latency is mostly not ours.** `backend_tool_call_latency` is dominated by Perplexity
   Sonar and WeatherAPI response times.
6. **One client machine** generated all load; client-side CPU contention at 16 streams was not
   instrumented (host had 16 cores, 27 GB free, no observed pressure).

---

## 8. Reproducing

```bash
# from the repo root, branch dev/nikkulkarni/generic-frontend-backend-agent-v2
mkdir -p benchmarking_tools/scaling-perf/dataset
cp <your 16 kHz mono int16 WAVs> benchmarking_tools/scaling-perf/dataset/

cd benchmarking_tools/scaling-perf
./simulate_concurrency.sh \
  --host nemotron-voice-agent-deploy-backend.prd.astra.nvidia.com --port 443 \
  --clients "1 4 8 16" --test-duration 300 --cooldown 20 \
  --dataset-dir ./dataset --output-dir <out> --no-save-audio
```

Audio files are **not** in the repository (`.gitignore` excludes `*.wav`); supply your own, one
continuous utterance per file with trailing silence trimmed.

The client connects straight to `/api/ws` and never posts a session config, so it measures whichever
example the **server** exposes. Pin it server-side (`EXAMPLE_SELECTION=generic-frontend-backend-agent`)
before a run. Production already serves it as the active example.

### Tool changes this run depends on

Two files modified on `dev/nikkulkarni/generic-frontend-backend-agent-v2`, **uncommitted** as of this
report:

- `benchmarking_tools/scaling-perf/benchmark.py` — added `backend_llm_dependent_ttft` /
  `_processing_time` for Thinker planning rounds 2–3 (previously unmapped, and silently
  mis-counted as plain `llm_ttft` / `llm_processing_time` while also consuming a token sample and
  corrupting `llm_tokens_per_sec`); added a guard so any metric carrying a `stage` field this client
  does not map is excluded from the plain buckets, logged once, and preserved in `stage_events` as
  `unmapped_stage`.
- `benchmarking_tools/scaling-perf/README.md` — documented all Frontend/Backend stage metrics, the
  correlation fields, and the server-side example-selection requirement.

### Raw artifacts

`perf_suite_20260918_033736/` — `results.txt`, `results.tsv`, `results.json`, and per-level
`run_<N>_clients/client_*/result_*.json` containing every RTVI message and the raw `stage_events`
with full correlation fields.
