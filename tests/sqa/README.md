# SQA harness — real-browser, real-voice testing

A self-contained container that tests the deployed Nemotron Voice Agent the way a
human QA would: it opens the actual browser UI, **speaks** to it, **listens** to
the replies, clicks every control, runs concurrent users, and records a video —
**with no changes to the app**.

## What's inside
`Dockerfile` builds on the Playwright image and adds **PulseAudio + ffmpeg + Xvfb**.
`run.sh` (in-container bootstrap) starts a virtual display and a virtual audio graph:

```
 TTS (gpt-4o-mini-tts) --paplay--> mic_sink --monitor--> VirtMic --> Chromium getUserMedia --> app ASR
 app TTS --> Chromium --> spk_sink --record--> ffmpeg --> parakeet ASR (verify what the bot said)
```

External voice/ears use the NVIDIA inference hub (`inference-api.nvidia.com`) with the
same `sk-*` key as `web_search`: `gpt-4o-mini-tts` (voice `coral`) and
`parakeet-1-1b-ctc-en-us` (ASR). See `lib/audio.mjs`.

## Suites
| file | what it does |
|---|---|
| `functional.mjs` | Exhaustive DOM: landing, cards, model toggle, Beta badge, consent/record toggles, settings, session lifecycle (start→end→thanks→restart), **upload validation**, visual diff. |
| `converse.mjs` | Real multi-turn **spoken** conversations (generic + omni); verifies each turn via ASR + DOM, tools, latency, dialogue context. |
| `concurrent.mjs` | N isolated sessions at once; distinct session IDs, all connect + hear greeting, 0 errors. |
| `comprehensive.mjs` | Full Generic tool, Omni media/webcam, UI lifecycle, and mixed eight-session qualification. |
| `repeated_expect_tool_matrix.mjs` | Repeated live-data delegation with independent bot ASR, grounded-result waits, silence checks, and cross-session leakage checks. |
| `prod_remediation_corner_cases.mjs` | API failures, cancellation, bounded multi-tool speech, and isolated safety/grounding probes. |
| `robustness.mjs` | Barge-in, graceful End, forced WebSocket close, Reconnect, and unique replacement-session checks. |
| `webcam_baseline_concurrency.mjs` | Four simultaneous Omni sessions with distinct visual baselines, bot-audio assertions, and scene-leakage detection. |
| `capture_lifecycle_matrix.mjs` | Twenty consented sessions, five explicit declines, long-session, pagehide, and forced-drop capture acknowledgement evidence. Correlate its session IDs with NGC separately. |
| `record_video.mjs` | Records a spoken Generic-Assistant conversation to `video/generic_conversation.mp4` (screen + both voices). |
| `selftest_audio.mjs`, `probe.mjs`, `diag_mic.mjs` | Layered bring-up checks (audio loopback → single turn → mic routing). |
| `lib/harness.mjs`, `lib/audio.mjs` | Shared browser + ASR/TTS helpers. |

## Run
```bash
docker build -t sqa-harness -f Dockerfile .
export SQA_KEY=sk-...                 # inference-hub key
export SQA_BASE=http://localhost:7862 # default
./sqa.sh functional
./sqa.sh converse both     # or: generic | omni
./sqa.sh concurrent 4
./sqa.sh video
./sqa.sh shell             # interactive debug
```
The container needs `--network host` (handled by `sqa.sh`) to reach the local UI.
Generated reports and screenshots land in ignored local output directories.
Versioned qualification summaries live in `reports/`; older completed runs live in
`reports/archive/`.
