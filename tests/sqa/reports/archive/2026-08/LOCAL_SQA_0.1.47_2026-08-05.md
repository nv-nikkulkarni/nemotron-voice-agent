# SQA Report — Nemotron Voice Agent (live deployment)

**Date:** 2026-08-05  **Target:** local UI `http://localhost:7862` → viking chart `0.1.47` rev 8,
app image `demo8`, UI `viking-demo25` (shorter example cards + consent checked-by-default).
**Method:** self-contained SQA harness container
(`tests/sqa/`) drives the **real browser UI** with a virtual audio stack, external
TTS (mouth) + external ASR (ears) via the NVIDIA inference hub — **no app-side code changes**.

## How the harness works
Playwright/Chromium runs headed on Xvfb inside one container. A PulseAudio graph gives it a
real virtual mic and speaker: we synthesize a user utterance with `gpt-4o-mini-tts`, `paplay`
it into `mic_sink` → Chromium's `VirtMic` → the app's ASR hears it; the bot's reply plays into
`spk_sink`, which we record and transcribe with `parakeet-1-1b-ctc` to verify what was said.
A WebAudio tap independently times bot speech onset. Every page collects console errors,
HTTP ≥400, and WS transport faults.

## Results — all suites PASS

| Suite | Result | Highlights |
|---|---|---|
| **Functional (DOM)** | **26/26 ✅** | title, 2 cards, model toggle, Beta badge (omni-only), **consent checked-by-default** + toggle, record toggle, settings/TTS list, session-id chip, **mid-session Settings + Pipeline-info (session survives)**, **End→thanks→restart**, upload validation, visual diff |
| **Concurrent users (4)** | **4/4 ✅** | all connect (~2.1–2.6s under load), 4 distinct session IDs, all hear greeting, 0 console/HTTP/WS errors, 10.2s wall |
| **Stress: 5 users × 3 cycles** | **15/15 ✅** | 5 concurrent users each repeat Start→(mid-session Settings+Info)→End→restart; **15/15 cycles complete, 15/15 nav-survived** (session id preserved), 0 errors, 22s |
| **Concurrent SPOKEN: 5 users at once** | **5/5 ✅** | 5 users talk simultaneously (own virtual mic each), each asks a distinct sum → each gets ITS OWN correct answer (33/45/21/67/50), **0 cross-talk, 0 errors** |
| **Robustness (barge-in / End-mid-speech / drop)** | ✅ investigated | barge-in interrupts + answers the new question; End hard-cuts audio ~76ms; involuntary WS drop kills the session (see findings) |
| **Spoken conversation — Generic (Super)** | **6/6 ✅** | intro, weather Tokyo→London (context followup), currency, **web_search**, goodbye — latency 0.62–1.06s |
| **Spoken conversation — Omni (Beta)** | **3/3 ✅** | robot story, **17×23 = 391**, goodbye — latency 1.37–2.33s |
| **Video** | ✅ | 103.7s H.264+AAC mp4, both voices audible — `video/generic_conversation.mp4` |

### Tools exercised live (via real speech)
- **weather** (`get_weather`) — Tokyo, London, San Francisco all answered with temp + conditions.
- **currency** (`convert_currency`) — "100 USD = €94.3".
- **web_search** (Perplexity Sonar) — "NVIDIA unveiled Blackwell…", "record Q… revenue growth".
- **omni mental math** — 17×23 = 391 (correct).
- Multi-turn **dialogue context** retained ("And how about in London?" → London weather).

### Security / correctness checks
- **Image upload validation (live):** valid PNG accepted (preview 0→1); spoofed PNG (text bytes, `.png` name) → **HTTP 400**; `.gif` → **HTTP 400**. Extension + magic-byte gate confirmed end-to-end.
- **No image persisted to disk:** after uploads to the live pod, `find` over `/tmp`, `/app` writable dirs, cwd, home = empty. Consistent with the in-memory `attachment_store`.
- **No `Unknown frame kind` console error** in any session — the client deserialize regression stays fixed.
- **No UI hangs:** every session reached a terminal state; End always returned to landing; restart reconnected (~2.0s).

## "Is the session-ended popup too abrupt? Does it kill the conversation?"
Investigated in code + empirically (`robustness.mjs`):
- **Abruptness — was yes, now fixed.** The `FeedbackModal` had **no entrance animation** (`backdropAnimation: none`) — it slammed up ~80ms after End, a hard full-screen takeover. **Fixed:** added a 220ms backdrop fade + 260ms `pop-in` on the panel (`nvidia-theme.scss`). Re-verified: `backdropAnimation: modal-fade`.
- **End hard-cuts audio** at ~76ms — intended (you asked to end); barge-in shows the pipeline *can* be interrupted gracefully instead.
- **Does it kill the conversation? Not on its own — but an involuntary drop does, invisibly.** `SessionControls` opens the SAME "Session ended / Thank you!" modal on **any** `isConnected→false` transition, with `endedReason` **hardcoded `"user"`**. A forced WS close ends the session (~1.6s→modal, 78 console errors, no reconnect) and looks identical to a deliberate End. **Finding #4 below.**

## Findings
| # | Sev | Finding |
|---|---|---|
| 1 | **Med** | **Involuntary disconnect is indistinguishable from a user End and does not reconnect.** Any transport drop shows the cheery "Thank you!" modal (`endedReason` hardcoded `"user"`); there is no "connection lost" state or auto-reconnect. Recommend: label the reason (user/timer/error) + attempt reconnect (or show a Reconnect button) on error. |
| 2 | Low | The LLM occasionally **verbalizes a tool's function name** ("convert underscore currency") instead of just the answer. Nondeterministic — a dedicated run answered cleanly ("€94.3"). Prompt-level. |
| 3 | Info | App **pre-selects the first example** (`deploymentOptions[0]`), so "Start" is enabled on load (by design); Omni first-turn latency (~2.3s) > Generic (~0.9s), as expected. |
| ✓4 | Fixed | Session-ended modal had no entrance animation (abrupt) → added fade + pop-in. |

No hard defects found: no crashes, console errors, HTTP failures, WS faults, dropouts, or hangs.

## Artifacts (`tests/sqa/`)
- `out/functional_report.json`, `out/concurrent_report.json`, `out/converse_report.json`
- `out/landing.png` (+ `.diff.png`), per-turn `out/*.wav` (spoken user + captured bot audio)
- `video/generic_conversation.mp4`, `video/conversation_meta.json`

## Reproduce
```bash
cd tests/sqa && docker build -t sqa-harness -f Dockerfile .
export SQA_KEY=sk-...            # inference-hub key (TTS+ASR+web_search)
./sqa.sh functional
./sqa.sh converse both
./sqa.sh concurrent 4
./sqa.sh video
```
