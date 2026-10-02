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
| `demo-feedback.mjs` | Focused prompt persistence, voice preview, Generic follow-ups and speech, Generic/Omni architecture, optional zero-shot sample, and capture acknowledgement checks. |
| `converse.mjs` | Real multi-turn **spoken** conversations (generic + omni); verifies each turn via ASR + DOM, tools, latency, dialogue context. |
| `concurrent.mjs` | N isolated sessions at once; distinct session IDs, all connect + hear greeting, 0 errors. |
| `comprehensive.mjs` | Full Generic tool, Omni media/webcam, UI lifecycle, and mixed eight-session qualification. |
| `captured_session_regressions.mjs` | Real-audio replays of captured NVCF/Astra sessions `52f301234e8c` and `499162cb3960`, covering private narration and stale dynamic answers. |
| `repeated_expect_tool_matrix.mjs` | Repeated live-data delegation with independent bot ASR, grounded-result waits, silence checks, and cross-session leakage checks. |
| `prod_remediation_corner_cases.mjs` | API failures, cancellation, bounded multi-tool speech, and isolated safety/grounding probes. |
| `robustness.mjs` | Barge-in, graceful End, forced WebSocket close, Reconnect, and unique replacement-session checks. |
| `test_teardown.mjs` | End and Start without a tab refresh; requires a new session ID plus transcript and audible welcome in the second session. |
| `webcam_baseline_concurrency.mjs` | Four simultaneous Omni sessions with distinct visual baselines, bot-audio assertions, and scene-leakage detection. |
| `capture_lifecycle_matrix.mjs` | Twenty consented sessions, five explicit declines, long-session, pagehide, and forced-drop capture acknowledgement evidence. Correlate its session IDs with NGC separately. |
| `record_video.mjs` | Records a spoken Generic-Assistant conversation to `video/generic_conversation.mp4` (screen + both voices). |
| `selftest_audio.mjs`, `probe.mjs`, `diag_mic.mjs` | Layered bring-up checks (audio loopback → single turn → mic routing). |
| `lib/harness.mjs`, `lib/audio.mjs` | Shared browser + ASR/TTS helpers. |

The Generic Frontend/Backend example owns its seven-tool maximum allowlist on
the server. `GET /api/tools` exposes the allowed ToolSpecs to the configuration
popup and **Settings**, which share the same checkboxes. The client sends the
selected subset for the next session; the server never accepts a tool outside
the registry allowlist. Release suites assert the exact Generic catalog
(`get_weather`, `get_stock_price`, `get_current_time`, `show_architecture`,
`web_search`, `calculate_bmi`, and `generate_random_number`) before exercising native tool calls. The harness also
fails when a UI-claimed tool control is missing or does not reflect selection.

## Run
```bash
docker build -t sqa-harness -f Dockerfile .
export SQA_KEY=sk-...                 # inference-hub key
export SQA_BASE=http://localhost:7862 # default
./sqa.sh functional
./sqa.sh converse both     # or: generic | omni
./sqa.sh demo-feedback
./sqa.sh captured-sessions
./sqa.sh repeated-expect-tool
./sqa.sh corner
./sqa.sh webcam
./sqa.sh capture
./sqa.sh pronunciation
./sqa.sh restart
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

## Demo Feedback Checks

Run `demo-feedback.mjs` through the launcher in the existing harness image.
From the repository root, set `SQA_BASE` to your target UI and use the existing
NVIDIA inference-gateway credential in `SQA_KEY`:

```bash
export SQA_BASE=http://localhost:7880
bash tests/sqa/sqa.sh demo-feedback
```

To exercise the optional sample session, set `SQA_VOICE_SAMPLE` to a host file
containing 3–10 seconds of clear reference speech before running the command.
The launcher mounts it read-only at `/sqa-voice-sample.wav` and passes that path
to the container. The deployment must offer Magpie Zeroshot. Without this
variable, sample-session checks are skipped. The launcher also supports
non-TTY automation.

`SQA_OUTPUT_ROOT` controls the host artifact root, and `SQA_RUN_ID` controls
the run subdirectory. By default, each invocation writes under
`tests/sqa/out/<run-id>/`. The launcher mounts this directory as `SQA_OUT`
inside the container.

The suite checks frontend persona and backend prompt edits across a reload,
2 catalog voice previews, a stock quote followed by a same-company refresh,
and a current-time request with the browser timezone set to `Asia/Kolkata`.
It asserts Chromium's `Asia/Calcutta` alias in session configuration and both
edited Generic role prompts. The spoken clock response must include
`HH:MM AM/PM` and match fresh browser-local time within 1 minute of either
turn start or completion. It requires a spoken zone label and rejects “slash”
or an IANA separator in the clock response.
It also checks spoken architecture descriptions and rendered Generic and Omni
images, “Nemotron 3 Diarization,”
“Codex and spinner,” concise speech without Markdown markers, and an inserted
0.65 s gap inside an unfinished Tokyo weather request. The actual WAV pause
also includes TTS trailing and leading padding. The suite records the largest
interior silence at a -35 dB threshold in `pauseTiming` and requires the full
request to remain 1 user turn. Every completed session
requires capture teardown acknowledgement. After the Generic conversation,
the suite restores both default prompts and checks that persistent instructions
remain. The optional sample branch checks upload, explicit sample activation,
disabled voice presets, and session configuration with the restored prompts
and enabled sample. It records a Halloween greeting and a cloned-voice
“Nemotron 3 Diarization” turn.

Preview checks inspect the WAV Blob used by the browser audio player and
require playback to start. They prefer Aria and Diego when both are available,
otherwise the first 2 catalog voices. A missing Chromium DevTools response
body does not invalidate a valid player Blob. During the ready Generic session,
the suite changes the preset to Aria, checks that engine radio controls stay
locked, and continues with the next spoken turn.

If a check fails while session-end controls remain available, the suite
attempts graceful ending and records the failed session's teardown state before
closing the browser. Inspect this state to confirm capture acknowledgement;
completed-session checks require `captureFlushed`.

Results, WAVs, and screenshots are written under `SQA_OUT`, including
`demo-feedback-report.json`. Session-config evidence contains only the
pipeline, timezone, prompt-edit and persistent-instruction flags, and encoded
sample length. It does not store prompt contents or reference sample data.
Inspect the recorded audio for pronunciation and
intended timbre. Passing these automated checks does not establish human
listening acceptance or replace the comprehensive and other release suites.

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
