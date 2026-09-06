# SQA Test Plan — Concurrent Voice Stability (Generic Assistant + Omni Subagents)

**Target:** the staging NVCF function `d67e6989` (chart 0.1.54 / app 2.0.12) via the demo UI,
driven through the local NVCF-proxy (`http://localhost:7863`) and/or the Astra preview URL
`https://nemotron-voice-agent-preview-deploy-backend.stg.astra.nvidia.com`.

**Method:** 30 concurrent real browser clients (Playwright + Chromium), each with an
**independent** virtual mic/speaker, **speaking** queries via inference-hub TTS and
**verifying** responses via Parakeet ASR — the same real audio path a human user takes
(mic → ASR → LLM → TTS → speaker), no API shortcuts. Runs against the live NVCF NIM pipeline.

---

## 1. Objectives

1. Prove the UI + NVCF pipeline stay correct and responsive under **30 simultaneous real
   conversations**.
2. Exercise **rapid example switching** (generic-assistant ↔ omni-subagents), including
   **ending mid-turn** and immediately starting the other example, repeatedly.
3. Detect **any** defect class: wrong/empty/garbled answers, spoken tool-errors, hangs,
   stuck-on-Starting/Connecting, WS drops, unhandled console/page errors, audio dropouts,
   latency blow-ups, crashes, and cross-session bleed (one client hearing another's answer).
4. Capture per-turn + per-client metrics and produce a ranked defect report.

## 2. Environment & preconditions

| | |
|---|---|
| Staging fn | `d67e6989`, chart 0.1.54 / app 2.0.12, valid Perplexity key (post-restore) |
| Transports | WebSocket (NVCF WS gateway) |
| Examples under test | `generic-assistant`, `omni-assistant-subagents` |
| Host | 16 vCPU / 31 GB (27 free) — 30 headless Chromium + 30 audio graphs |
| Speak (TTS) | inference-hub TTS (per harness `lib/audio.mjs`) → each client's mic sink |
| Listen (ASR) | Parakeet ASR (per harness) ← each client's speaker monitor |
| Isolation | one PulseAudio mic_sink+virtmic and spk_sink **per client**; one Chromium pinned to each via `PULSE_SOURCE`/`PULSE_SINK` |

**Gate:** the throwaway bad-key version must be removed and `9eaef789` (valid key) ACTIVE,
so web_search returns real data (otherwise every factual answer is the graceful fallback).

## 3. Feature / behavior coverage

### A. Session lifecycle
- A1 Start conversation → reaches `live` within timeout (no stuck-on-Starting/Connecting).
- A2 End conversation → graceful teardown → returns to landing (`idle`), thank-you overlay.
- A3 End **mid-turn** (while bot is speaking / mid-response) → clean teardown, no hang.
- A4 Immediate re-Start after End (same and other example) → connects, no overlap/split-brain.
- A5 Rapid End↔Start toggling many times → no orphaned sockets, no zombie sessions.

### B. Example switching (the core stress)
- B1 generic → End → omni-subagents → Start → converse → End → generic … (ping-pong).
- B2 Switch **while a turn is in flight** (end before the bot finishes) then start the other.
- B3 Model/voice selection persists/reset correctly per example (Super LLM + Magpie default).
- B4 `/api/deployment` reflects the newly selected example each time.

### C. Conversation correctness (per turn, ASR-verified)
- C1 Bot **produces** an audible response (botSpoke=true) for every user turn.
- C2 Response is **on-topic / plausible** for the query (keyword / sanity checks).
- C3 **No tool-error leakage** — never speaks "HTTP", status codes, "web search failed",
  "error", "unavailable" verbatim, or a stack trace.
- C4 web_search-backed factual queries return **real data** (not the graceful fallback,
  since the key is valid) — e.g. a weather/price answer contains numbers/units.
- C5 No **cross-session bleed**: client N's answer matches client N's question only.
- C6 No **garbled/gibberish** TTS (ASR returns intelligible text; not empty/noise).
- C7 No **prompt contamination** (e.g. omni answering as generic or leaking system text).

### D. Robustness / erratic behavior
- D1 No **hang**: every turn yields a response or a clean timeout within N s (flagged).
- D2 No **WS drop** mid-session (ws closed count stays 0 unless End).
- D3 No **console/page errors** (esp. the `begin()`/"Unknown frame kind"/serializer errors).
- D4 No **stuck overlay** (buffering/thanks modal that never clears).
- D5 No **audio dropout** (bot starts but produces no audible samples).
- D6 Latency stays bounded and doesn't **run away** under 30-way load (record p50/p95/max).

### E. Concurrency integrity
- E1 **True simultaneity** — all 30 clients hold live WS at the same wall-clock moment
  (verified by overlapping "live" windows / a barrier before the conversation phase).
- E2 Pipeline serves all 30 without 5xx/refused/queue-timeouts at connect.
- E3 Fair-ish latency distribution (no client starved indefinitely).

### F. Capture side-effect (bonus)
- F1 Consented sessions produce a tarball in NGC `session-captures` (spot-check a few sids).

## 4. Per-turn verification pipeline

For each spoken turn the harness records: `{client, example, query, botSpoke, botAsr,
domBot, responseMs, wallMs, latencyS, wsOpen, wsClosed, phase, errors[]}` and applies:

1. **Response present** — botSpoke && (botAsr non-empty || domBot non-empty).
2. **No error leak** — domBot/botAsr match none of: `/(HTTP\s*\d|status code|web search failed|traceback|exception|undefined|NaN|\berror\b|unavailable)/i` (the last two only when NOT the intended graceful line).
3. **Relevance** — for factual queries, response contains an expected token (number/unit/name).
4. **Isolation** — domUser for the turn matches the query this client asked.
5. **Health** — phase ∈ {live} after turn (or a *deliberate* idle after an End step).

Any failed check → recorded as a finding with the full turn record + client id + timestamp.

## 5. Pass / fail criteria

- **PASS:** 30/30 clients complete their scripted flow; ≥99% of turns get a valid,
  on-topic, leak-free response; 0 hangs; 0 WS drops (outside deliberate End); 0 unhandled
  console/page errors; 0 cross-session bleed; latency p95 bounded (no runaway).
- **FAIL (any):** a hang, a spoken error/stack, a cross-session bleed, a WS drop mid-turn,
  a stuck overlay, a crash/5xx, or a systematic wrong-answer pattern.

## 6. Metrics reported

Per-client and aggregate: turns ok/fail, response p50/p95/max, WS opens/closes, error count
+ unique errors, hang count, switch count, and a latency-vs-time series to spot degradation
under sustained 30-way load. Plus a ranked list of every distinct finding.

## 7. Risks & limitations

- **Host CPU** — 30 headless Chromium + 30 audio graphs on 16 cores; if the *harness host*
  saturates, measured latency includes client-side contention (flagged separately from
  server latency, which we also read from RTVI where available).
- **ASR/TTS variance** — synthetic TTS + ASR can mis-transcribe; relevance checks are
  keyword-tolerant, and empty-ASR with a present `domBot` still counts as a response.
- **Omni-subagents media** — if the example needs an attachment for some intents, voice-only
  turns are scoped to intents it answers by voice (confirmed before the run).
- **Shared pipeline** — the NIM set is fixed (8 GPU); 30-way real-time load may legitimately
  raise latency — that is a *finding to characterize*, not necessarily a failure.
