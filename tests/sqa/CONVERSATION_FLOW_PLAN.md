# Conversation Flow Plan — 30-Client Concurrent Switching Stability

Companion to `SQA_TEST_PLAN.md`. Defines exactly what each of the 30 clients does, the
switching pattern, the query banks, and the per-turn verification. Implemented in
`concurrent_stability.mjs`.

## Orchestration

- **30 clients**, each an **independent Chromium process** bound to its **own** PulseAudio
  slot (`createAudioSlot(i)` → `mic_i`/`vmic_i`/`spk_i`, `launchBrowser({env: slot.env})`).
  Contexts-in-one-browser can't isolate audio (env is per-process), so it must be 30 processes.
- Queries are **pre-synthesized once** (inference-hub TTS) into WAVs and reused across
  clients (played into each client's own mic sink) — avoids the TTS rate limit under 30-way.
- **True simultaneity via a barrier:** every client starts a generic session first; each
  blocks at a barrier once `live`; when all 30 are `live` the barrier releases and the
  conversation phase begins — so 30 real WS conversations are provably in flight at once.
- Verification uses the app's **own transcript** (`.transcript-message` bubbles: `domUser`,
  `domBot`) as the reliable backbone, **plus** inference-hub **ASR** on the bot's captured
  audio (`transcribeBot`) to independently "understand" the spoken answer (per the request).

## Per-client flow (repeats for `ROUNDS`)

```
setup: slot i → browser → goto → (stagger i·150ms)

round r:
  ── GENERIC ──────────────────────────────────────────────
  selectExample(generic, super) → Start → wait live
    · r==0: hit the BARRIER (sync all 30 at first-live)
    · wait for greeting to render + go quiet
  for q in 1..QPER:  turn(generic_query[i,r,q])  → VERIFY
  END (variant): on ~1/3 of rounds, END **mid-turn** — speak the next query then
      immediately click End WITHOUT waiting for the bot (tests interrupt teardown);
      otherwise a clean End after the last answer.
  dismiss feedback → back to landing

  ── SWITCH → OMNI (the known-fragile path) ───────────────
  selectExample(omni) → Start → wait live
    · GUARD: watch for stuck-on-"Starting" (documented bug in debug_omni_stuck.mjs);
      if not live within timeout → record a HANG finding (client + round), attempt
      recovery (the connect-fix should recover to idle), and continue.
  for q in 1..QPER:  turn(omni_query[i,r,q])  → VERIFY
  END (variant mid-turn or clean) → dismiss → back to landing

teardown: final End if live → close context + browser
```

So each client performs `ROUNDS × 2` example sessions with `ROUNDS × 2` End→Start
**switches**, half of them generic↔omni, and a fraction ended **mid-turn**.

## Query banks

**Generic (factual, exercises web_search + the tool-error fix):** each client gets a
**distinct** rotation (city weather, stock/commodity prices, capitals, dates, currency)
so a leaked answer from another client is detectable. Each query has an `expectRe`
(a number/unit/name that a correct answer should contain).

**Omni-subagents (voice-only — no attachment needed):** short stories, mental math,
counting, timeless general knowledge (e.g. "What is seventeen times twenty-three?",
"Tell me a one-sentence story about a robot", "Name three primary colors"). Each has an
`expectRe` where deterministic (math/colors), else just "non-empty, intelligible".

## Per-turn verification (every turn, every client)

| Check | Rule |
|---|---|
| **Response present** | `botSpoke` AND (`domBot` or `botAsr`) non-empty |
| **No error leak** | text matches none of `/(HTTP\s*\d\|status code\|web search failed\|traceback\|exception\|\bundefined\b\|NaN)/i` and is not a raw code |
| **Relevance** | `expectRe.test(domBot + botAsr)` when defined, else "present" |
| **Isolation** | `domUser` for the turn ≈ this client's query; answer doesn't contain another client's unique token |
| **No hang** | turn returns within cap; a no-onset/no-bubble within cap = HANG finding |
| **Health** | `window.__session.phase === 'live'` after the turn (unless a deliberate End step) |

## Findings captured

Every failed check → a finding `{client, round, example, query, domBot, botAsr, botSpoke,
latencyS, phase, errors[], kind}`. Plus per-client: WS opens/closes, console/page errors,
switch count, hang count. Aggregate: connect success, turn pass rate, cross-talk leaks,
hangs, WS drops, error totals, latency p50/p95/max, and a ranked unique-findings list.

## Pass / fail

**PASS** = 30/30 connect; ≥99% turns valid, on-topic, leak-free; 0 hangs; 0 cross-talk
leaks; 0 WS drops outside deliberate End; 0 unhandled console/page errors; latency bounded.
**FAIL** on any hang, spoken error/stack, cross-talk leak, mid-turn WS drop, stuck overlay,
crash/5xx, or a systematic wrong-answer pattern.
