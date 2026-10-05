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
| `functional.mjs` | Landing actions, cards, fixed model roles, explicit capture choices, optional recording, conversation settings, session lifecycle (start→end→thanks→restart), **upload validation**, and visual diff. |
| `demo-feedback.mjs` | Focused prompt persistence, voice preview, Generic follow-ups and brief speech, Generic/Omni architecture, optional zero-shot sample, and capture acknowledgement checks. |
| `pre-session-configuration.mjs` | Four launch actions, prompt persistence, voice-card and IPA previews, capture-dialog cancellation, device-only conversation settings, mobile layout, optional zero-shot sample, and one spoken exchange with capture acknowledgement. |
| `llm-settings.mjs` | Responsive per-role model controls, validation, saved settings, draft cancellation, Generic/Omni live apply and reset, real spoken turns, and ended-session state cleanup. |
| `voice-studio.mjs` | Responsive studios, capture-dialog cancellation without microphone acquisition, IPA persistence and assistant isolation, real previews, optional zero-shot sample, Generic/Omni welcomes, capture choices, brief header hints, and reconnect permission. |
| `converse.mjs` | Real multi-turn **spoken** conversations (generic + omni); verifies each turn via ASR + DOM, tools, latency, dialogue context. |
| `concurrent.mjs` | N isolated sessions at once; distinct session IDs, all connect + hear greeting, 0 errors. |
| `comprehensive.mjs` | Seven Generic tools, Omni voice/media/webcam, UI lifecycle, and eight mixed sessions; retains per-turn evidence and phase checkpoints. |
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
the server. `GET /api/tools` exposes the allowed ToolSpecs under **Tools** before
starting. **Voice** opens the speech studio. **Audio settings** appears only on
the conversation page and opens microphone and speaker selectors. The client
sends the selected tools for the next session; the server never accepts a tool
outside the registry allowlist. Release suites assert the exact Generic catalog
(`get_weather`, `get_stock_price`, `get_current_time`, `show_architecture`,
`web_search`, `calculate_bmi`, and `generate_random_number`) before exercising native tool calls. The harness also
fails when a UI-claimed tool control is missing or does not reflect selection.

The shared `selectExample()` helper prepares **Tools** and **Voice** without
connecting. `startConversation()` selects the capture choice in the pre-start
dialog, then waits for the connection. Capture defaults to declined in the
harness; pass `consent: true` to qualify a retained capture.

## Run
```bash
docker build -t sqa-harness -f Dockerfile .
export SQA_KEY=sk-...                 # inference-hub key
export SQA_BASE=http://localhost:7862 # default
./sqa.sh functional
./sqa.sh converse both     # or: generic | omni
./sqa.sh comprehensive all # or: A | B | C | D
./sqa.sh demo-feedback
./sqa.sh pre-session-configuration
./sqa.sh voice-studio
./sqa.sh llm-settings
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

The [October 05 backend history dev report](reports/BACKEND_HISTORY_DEV_2026-10-05.md)
records the configurable Generic user-turn window, deployment identities,
focused voice checks, and qualification limits.
The [October 05 backend history staging report](reports/BACKEND_HISTORY_STAGING_2026-10-05.md)
records isolated NVCF/Astra staging, the H200 placement, dynamic filler, exact
artifact/control-plane identities, and failed or incomplete qualification gates.
The [comprehensive Astra staging report](reports/COMPREHENSIVE_ASTRA_STAGING_2026-10-05.md)
tracks the separate four-phase run, raw outcomes, speech/capture evidence, and
qualification limits.
The [main Astra staging UI cutover report](reports/MAIN_STAGING_UI_CUTOVER_2026-10-05.md)
records the main staging cutover, full-browser stock-answer failure, capture
and protection checks, retained rollback, and qualification limits.

## Comprehensive Dev Checks

Run all four phases against the target UI from the repository root:

```bash
SQA_BASE=http://localhost:7880 bash tests/sqa/sqa.sh comprehensive all
```

Supply `SQA_KEY` through your environment. Use `A`, `B`, `C`, or `D` instead of
`all` to run one phase. Give each invocation a separate output directory.
The suite covers these scripted checks:

| Phase | Scope |
| --- | --- |
| A | 17 Generic Lightning turns, the exact seven-tool server catalog, native tool calls, repeated weather and stock requests, and a loaded Generic architecture image. |
| B | 13 Omni voice turns, one uploaded-image description, and one description of controlled JPEG webcam frames. |
| C | Generic-to-Omni switching, pre-session prompt editing and submission after restart, the configuration inspector, and a consented session with capture status checks. |
| D | Eight simultaneous Generic/Omni sessions, two spoken turns each, unique session IDs, audible responses, and checks for another session's code word. |

The harness waits for the welcome to settle before speaking, including the
consented capture session. **Prompts** opens directly from the launch bar after
example selection; it does not require dismissing a configuration dialog.
Unexpected console errors, bad HTTP responses, WebSocket closures, and guarded
wait timeouts fail the applicable phase.

Omni image and webcam descriptions must identify whole-word **red** and
**square**, in either order, or **BANANA 42** / **banana forty two** from the
controlled fixture. An acknowledgement such as “the image you shared” is
insufficient. The uploaded-image check separately requires HTTP `200`; a spoken
reply cannot substitute for successful upload.

`comprehensive_report.json` preserves each full harness turn record, including
application transcripts, independent bot recognition, audio paths, and timing.
`comprehensive_summary.md` contains phase outcomes and the per-tool table.
Both files update after every completed phase and again at completion. An
unfinished report displays **RUNNING**; completed phases alone do not establish
that all requested phases passed. The architecture check also writes
`A-architecture.png`.

Stock answer checks require a numeric quote with USD/dollars/`$`, or a
“trading at” / “priced at” number. Earlier fixtures can match “price” in progress
speech without a numeric quote; preserve their raw result and supplementary
semantic failure separately. A fixture match and audible response alone do not
establish complete semantic or acoustic acceptance.

Phase D checks literal code words from other sessions. Its raw pass does not
require an exact echo of each authored code word. Review input audio,
application transcripts, and replies separately to assess speech-recognition
fidelity.

Phase C checks the capture endpoint, configured store, and bounded pending
backlog. It does not prove that a particular archive reached NGC. Correlate
consented session IDs with archive storage separately. This suite does not replace
the repeated-tool matrix, capture lifecycle matrix, pronunciation listening,
robustness tests, or other release gates. It does not promote a deployment.

The [October 04 comprehensive dev report](reports/COMPREHENSIVE_DEV_2026-10-04.md)
records the completed four-phase run, raw failures, separate input-fidelity
findings, capture readback, and repository-check gaps.
The [web-search root cause analysis](reports/WEB_SEARCH_RCA_DEV_2026-10-04.md)
records the original planner clarification, a controlled transcript comparison,
and current Sonar Pro provider verification.

## Pre-Session Configuration Checks

From the repository root, set `SQA_BASE` to the target UI and use the existing
inference-gateway credential in `SQA_KEY`, then run:

```bash
bash tests/sqa/sqa.sh pre-session-configuration
```

The focused suite checks **Prompts**, **Tools**, **Voice**, and
**Start conversation** in the launch bar, plus prompt edits across reloads.
It verifies voice search, native radio-keyboard selection, 2 audible preset
previews, and an audible preview carrying a saved IPA rule. Phone checks keep
**Prompts** and **Voice** aligned and reject horizontal overflow.

Before connecting, **Audio settings** and **Agent configuration** must be absent.
Pressing **Escape** in the capture dialog must cancel the start, avoid creating
session configuration, and return focus to **Start conversation**. During a
session, the brief header hints disappear and **Audio settings** opens only
microphone and speaker selectors.

Set `SQA_VOICE_SAMPLE` to a host reference file to include saved zero-shot
sample preview, removal, and reload checks. It verifies the saved file
persists while its use checkbox resets off, then explicitly enables it again.
The launcher uses the sample mount described below; the deployment must offer Magpie Zeroshot. The suite
also checks selected Aria and edited role prompts in actual session
configuration, 1 real spoken exchange with capture acknowledgement, and Omni
configuration. It writes `pre-session-configuration-report.json`, screenshots,
and audio under `SQA_OUT`. This focused suite does not replace release suites
or human listening acceptance.

## LLM Settings Acceptance Checks

Run the focused model-control suite from the repository root:

```bash
SQA_BASE=http://localhost:7880 bash tests/sqa/sqa.sh llm-settings
```

Use an externally supplied `SQA_KEY` with inference-hub access for the harness's
speech generator and independent speech recognizer. The target must expose
Generic Frontend/Backend Agent and Omni Assistant Subagents with their model
services ready. Both real voice sessions run by default.

The suite checks the settings dialog at widths of 1,440, 1,024, 768, 390, and
320 pixels. It validates Generic's independent role controls, invalid-input
feedback, explicit **Save settings**, persistence across reloads, and cancellation
of an unapplied draft. Omni exposes all four role cards, with advanced top-k
controls that can override its greedy default. The landing launch bar keeps its
four actions; **LLM settings** opens from **Tools** before connecting. During
both live sessions, the suite checks that **LLM**, **Agent configuration**,
**Audio settings**, and **End** fit within the 390- and 320-pixel viewports.

During separate Generic and Omni sessions, the suite checks saved settings in
the submitted session configuration. It then opens **LLM** in the conversation
header, applies new values, and verifies a successful PUT and current revision.
It waits for the welcome to finish before speaking to the real agent. The
Generic turn asks for the current time in Tokyo and requires a native
`get_current_time` call through the updated backend planner. The Omni turn
requests a brief greeting. Application speech recognition must preserve the
intended request. A visible reply, audible response audio, and independent bot
speech recognition must succeed.
**Reset all** must restore defaults after applying. After **End**, the live
settings endpoint must return HTTP `404`. Reports and screenshots are written
under `SQA_OUT`, including `llm-settings-report.json`. Failed-turn evidence is
retained. Catalog GETs intentionally canceled while closing or navigating away
from the dialog are recorded separately; failed session operations fail the suite.

The backend request-boundary checks live in `tests/unit/test_llm_settings.py`:

```bash
uv run pytest tests/unit/test_llm_settings.py -v
```

These checks validate bounded numeric fields, session isolation, revision
conflicts, reset, and teardown. They also inspect mocked native planner and
multimodal requests, including all four Omni roles, and confirm that an
in-flight request keeps its snapshot while a later request receives the update.
The browser suite checks real Generic and Omni speech; it does not exercise
every uploaded-media or webcam inference path.

The [LLM Settings dev qualification report](reports/LLM_SETTINGS_DEV_2026-10-04.md)
records exact artifact identities, targeted spoken checks, and remaining release
gates.

## Voice Studio Acceptance Checks

From the repository root, target the UI with `SQA_BASE` and run the live
studio checks through the existing launcher:

```bash
bash tests/sqa/sqa.sh voice-studio
```

The suite checks layouts at 1,440, 1,024, 768, 390, and 320 pixels wide. It
verifies tool and voice selection, IPA validation and reload persistence,
assistant-specific rules, and preserved edits when choosing an engine without
IPA support. Cancelling the capture dialog must restore focus without creating
a session or acquiring the microphone.

Live checks synthesize a preset preview carrying the saved IPA rule, then start
Generic and Omni sessions with different capture choices. They require audible
welcomes, capture acknowledgements, device-only **Audio settings**, the
**Agent configuration** inspector, and small header hints that disappear after
2 seconds. Reconnecting after an involuntary end must request capture
permission again. These checks do not establish human pronunciation acceptance
or prove that a consented archive reached NGC.

Set `SQA_VOICE_SAMPLE` to a host speech file to include zero-shot upload,
reload, preview, and removal checks. The deployment must offer Magpie Zeroshot.
The saved clip survives reloads; explicitly enable its use again before preview.
The launcher mounts the reference file using the sample procedure below.
Reports and screenshots are written under the launcher's run-specific output
directory, including `voice-studio-report.json`.

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
For both architecture turns, the input transcript must match the spoken
request “Show me your architecture.” The suite separately checks a spoken
diagram description and a rendered Generic or Omni image. A correct image or
answer alone does not establish input transcription acceptance.
The Generic and optional cloned-voice product turns require the exact reply
“Nemotron 3 Diarization,” ignoring case and allowing only an optional final
period or exclamation mark. “Three” or “Diorization” in the reply fails this
text gate. It does not establish human pronunciation acceptance.
The suite also checks “Codex and spinner” and concise speech without Markdown
markers. The capability reply must contain at most 25 words. Sales Cloud,
speaker diarization, and small-talk replies must each contain at most 35 words.
These fixture assertions do not establish a guaranteed runtime word limit.

A separate turn checks a reproducible 1.7 s pause inside an unfinished Tokyo weather request. The fixture trims
only detected edge silence and requires measured interior silence from
1.65 to 1.8 s at a -35 dB threshold. `pauseTiming` records the target,
inserted, and measured durations. Assistant audio onset must follow the full
input WAV duration, and the request must remain 1 user turn. This gate uses distinct `frontend_tool_selection`
turn IDs from parsed RTVI stage-correlation metadata, surfaced through the
browser's `nva:frontend-selection` event. It requires exactly 1 recorded `get_weather`
tool event, and rejects example-city filler such as Pune, Nairobi, or Reykjavik.
The correlation check works across transports and mirrors no raw audio or
prompt contents. Missing correlation metadata fails the gate. A single visible transcript bubble
alone does not establish that the request remained 1 real turn. Every completed session
requires capture teardown acknowledgement. After the Generic conversation,
the suite restores both default prompts and checks that persistent instructions
remain. The optional sample branch checks upload, explicit sample activation,
disabled voice presets, and session configuration with the restored prompts
and enabled sample. It records a Halloween greeting and a cloned-voice
“Nemotron 3 Diarization” turn.

Preview checks inspect the WAV Blob used by the browser audio player and
require playback to start. They prefer Aria and Diego when both are available,
otherwise the first 2 catalog voices. A missing Chromium DevTools response
body does not invalidate a valid player Blob. The suite selects the Aria voice
card before starting and verifies its session configuration. During the ready
Generic session, it checks that **Settings** contains exactly 2 audio-device
selectors and no voice, engine, or tool controls. Agent options stay in the
pre-session setup flow.

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
