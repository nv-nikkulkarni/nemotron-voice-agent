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
| `captured_session_regressions.mjs` | Real-audio replays of captured NVCF/Astra sessions `52f301234e8c` and `499162cb3960`, covering private narration and stale dynamic answers. |
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
./sqa.sh captured-sessions
./sqa.sh repeated-expect-tool
./sqa.sh corner
./sqa.sh webcam
./sqa.sh capture
./sqa.sh pronunciation
./sqa.sh concurrent 4
./sqa.sh video
./sqa.sh shell             # interactive debug
```
The container needs `--network host` (handled by `sqa.sh`) to reach the local UI.
Each invocation receives a UTC run ID and writes reports, screenshots, and audio
under the ignored `out/<run-id>/` directory. Set `SQA_RUN_ID` only when you need
a stable external identifier. A later phase or rerun does not overwrite earlier
evidence.
Versioned qualification summaries live in `reports/`; older completed runs live in
`reports/archive/`.

## Captured Session Regressions

The `captured-sessions` suite reconstructs two observed NVCF/Astra failures with
deterministic `espeak-ng` query audio. It still sends the audio through the virtual
microphone, application ASR, agent pipeline, application TTS, and browser speaker.

- Session `52f301234e8c` passes when the application hears the incomplete stock-price
  request, the agent asks for the ticker or company, the bot speaks, and neither private
  narration nor serialized internal calls appear in the answer.
- Session `499162cb3960` passes when every prompt retains its required meaning in
  application ASR, every turn produces bot audio, all 3 latest-answer challenge turns use
  a web or search tool, no answer presents 2022 as the latest result, and the final
  verification does not contradict a newer grounded year.

The suite also requires zero unexpected browser console errors and WebSocket closures. It
writes `artifacts/captured-session-regressions/captured_session_regressions_report.json`.
Raw audio and generated reports remain ignored. Passing this focused suite does not replace
the comprehensive, concurrency, guardrail, webcam, capture, reconnect, or pronunciation
release gates.
