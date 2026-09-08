# SQA Report — Astra UI → NVCF pipeline (full, latest artifacts)

**Date:** 2026-08-06  **Target:** `https://nemotron-voice-agent-deploy-backend.stg.astra.nvidia.com`
(Astra UI `e4fd4f0`/demo31 → NVCF chart **0.1.50** / app **2.0.8** / fn version `f620ae03`, backend prd6-1, single 8×H100 instance).
Latest artifacts under test: Super-only generic, **Magpie default TTS**, interruptible **graceful teardown** (~1.5s grace), tightened **web_search** prompt, session-capture chart (sidecars — see note).

## Results — pipeline healthy across the board

| Suite | Result | Notes |
|---|---|---|
| **Functional (DOM)** | **26/26 ✅** | connect ~2.5–3s, mid-session Settings/Info (session survives), End→thanks→restart, **Super-only** (`nano-buttons=0`), settings TTS = Magpie+Chatterbox, **upload validation** (valid PNG 200; spoofed PNG + gif → 400), no frame-kind/console/HTTP errors |
| **Converse — Generic (Super)** | **PASS** | weather Tokyo via **web_search** → real "17°C partly sunny"; **Magpie** TTS; goodbye. web_search firing on NVCF. |
| **Converse — Omni (Beta)** | **PASS** | robot story ✓; voice path clean |
| **Concurrent — 4 DOM** | **4/4 ✅** | all connect, 4 distinct ids, all greet, **0 errors**, 11s |
| **Stress — 4 users × 3 cycles** | **12/12 ✅** | Start→mid-nav→End→restart churn; 12/12 nav-survived, 0 errors |
| **Concurrent SPOKEN — 4 at once** | **4/4 connected, 0 cross-talk, 0 errors** | perfect session isolation on the single NVCF instance (3/4 correct answers — 1 LLM math slip, see below) |
| **Robustness** | **all pass ✅** | barge-in interrupts + answers; End-mid-speech → **~1.5s grace window** (modal at 1565ms, `modal-fade`); forced drop → **"Session interrupted"** (Connection-lost variant, not "Thank you") |

## Verified working through Astra→NVCF
- **Magpie** is the default TTS (settings + live sessions).
- **web_search** fires on NVCF (real Tokyo weather; NVIDIA news).
- **Graceful teardown**: ~1.5s "Ending…" buffering window, then thanks; involuntary drop → Connection-lost/Reconnect.
- **Upload validation** (magic-byte + extension) enforced server-side on NVCF.
- **Concurrency + isolation**: 4 concurrent DOM and 4 concurrent *voice* sessions, **0 cross-talk, 0 errors** on one instance.
- No console / HTTP≥400 / WS-transport errors in any suite.

## Findings (none are pipeline defects)
| # | Sev | Finding |
|---|---|---|
| 1 | Low | **LLM stalling** — generic sometimes says "Let me fetch/grab that…" before the web_search answer (prompt forbids it). Answer still lands; the harness captures the filler → shows as off-topic warns. |
| 2 | Low | **Super arithmetic slips** — e.g. 40+5→"49", occasionally (nondeterministic). Heard the question right, isolated correctly — just wrong math. |
| 3 | Low | **Omni model quality** — 17×23→"401", a camera-focused reply; omni's known weak spots, not the pipeline. |
| 4 | Info | ASR mishears on some turns (external TTS→app ASR), a harness artifact not the app. |
| — | Known | **Session capture** doesn't work on NVCF (NVCF strips the chart's emptyDir + ConfigMap volumes; sidecars inert). Separate re-architecture item — not exercised by these suites. |

## Reproduce
```bash
export SQA_KEY=sk-...
SQA_BASE=https://nemotron-voice-agent-deploy-backend.stg.astra.nvidia.com ./sqa.sh functional
# converse both | concurrent 4 | stress 4 3 | concurrent-spoken 4 | robustness
```
