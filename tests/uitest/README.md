# UI + pipeline end-to-end test (real browser, real voice)

Unlike `tests/voicetest/` (which hits `/api/ws` directly and never opens a browser),
this drives the **actual demo UI in Chromium via Playwright** — so it exercises the
UI *and* the pipeline together, the way a user does: it **speaks, listens, presses
buttons, times the reaction, catches glitches/bugs, and visual-diffs the UI**.

There are two entry points:

| | file | what it does |
|---|---|---|
| **single scenario** | `ui_test.cjs` + `run.sh` | one query (planet / generic / Nano) — the original PoC |
| **regression suite** | `ui_suite.cjs` + `run_suite.sh` | **many** scenarios (both examples, both models) + latency budgets + console/HTTP/WS asserts + **visual-diff** vs committed baselines |

## How it works
- **Speak** — Chromium is launched with `--use-file-for-fake-audio-capture=<wav>`,
  so `getUserMedia()` returns a real voice WAV as the mic. The *real* UI captures
  and streams it through the *real* pipeline (ASR → LLM → TTS). One browser per
  scenario (the fake-mic path is a launch arg).
- **Listen** — an injected init-script splices an `AnalyserNode` before the audio
  destination and records an RMS timeline → bot-speech onset, segments, mid-speech
  **dropouts** (300–1200 ms gaps), and level.
- **Press buttons** — Playwright picks the example card + model, clicks Start / End,
  opens Settings, toggles the TTS engine.
- **Reaction time** — reads the app's own `END-TO-END LATENCY` readout and asserts
  it against a per-category **budget**; cross-checks with the independent audio onset.
- **Bugs/glitches** — per scenario: console errors (incl. the `Unknown frame kind`
  regression, called out explicitly), failed / 4xx-5xx requests, non-clean WebSocket
  closes, DOM assertions, and screenshots (`out/*.png`).
- **Visual diff** — a dedicated pass screenshots the (animation-frozen) landing +
  settings pages and compares them to committed baselines in `baseline/` with
  `pixelmatch`; a diff image lands in `out/<name>.diff.png` and a >0.6 % change is
  reported.

## Run the suite
```bash
# 1) build the fake-mic WAVs + scenarios.json from tests/voicetest/quality_spec
python prep_mics.py --default          # ~6 representative scenarios (fast)
#   python prep_mics.py --all          # all 40 queries
#   python prep_mics.py --slugs g_know_planet,o_count5

# 2) run against the live UI (defaults to http://localhost:7862 on viking)
sh run_suite.sh                        # or:  sh run_suite.sh https://<astra-url>
#   UPDATE_BASELINE=1 sh run_suite.sh  # (re)capture the visual baselines
```
`scenarios.json` is the single source of scenarios (built from `quality_spec.py`):
each entry carries the example/model to drive, the fake-mic WAV, an expected-answer
regex, and a latency budget. Output: a console summary + `out/suite_report.json`
(per-scenario PASS/FAIL, latency, audio analysis, warnings) and screenshots. Exit
code is non-zero if any **hard** assertion failed (CI-friendly).

### What's a hard fail vs a warning
- **hard** (fails the run): never connected · no bot audio · no/over-budget latency ·
  any console error (incl. `Unknown frame kind`) · HTTP ≥ 400 · non-clean WS close.
- **warn** (recorded, doesn't fail): mid-speech dropouts · expected-answer regex not
  found in the transcript (omni is speech-to-speech and may not surface bot text) ·
  End didn't show the thank-you modal.

## Verified findings (viking)
```
g_know_planet (generic/Nano): connected 2.85s, latency 0.68s, bot spoke, answer "Jupiter"
End -> thank-you modal ; Settings TTS switch [Magpie, Chatterbox] present + toggles
```
**Real bug it caught (now fixed):** a recurring console error
`Failed to deserialize incoming message: Unknown frame kind`. Root cause: the server
(pipecat 1.5.0) serializes an `InterruptionFrame` as protobuf `Frame` oneof **field
5**, but the bundled client (`@pipecat-ai/websocket-transport` 1.7.0 in client-js
1.12.0) only knows fields 1–4 and only decodes `audio`+`message`. Fixed in
`astra_client/src/demo/safeSerializer.ts` (`SafeProtobufFrameSerializer`, wired in
`App.tsx`) — it skips unknown frame kinds instead of throwing. The suite is the
regression gate: it flags the error on the old UI bundle and goes green once the
rebuilt UI ships.

**A second real bug (source fixed; Viking rerun pending):** comprehensive Phase D
showed valid server TTS and bot lifecycle events while the browser Pulse monitor
remained near silence after an interruption. The WebSocket transport remembers
interrupted player IDs, but every later PCM response previously reused
`"default"`. `TurnAwareDailyMediaManager` now assigns one `bot-turn-N` ID per
turn and advances it after interruption. The focused regression verifies that
the response after barge-in reaches a fresh player track; Phase D remains the
required runtime gate.

## Notes / extend
- **Barge-in matters**: if the utterance overlaps the greeting the turn won't
  complete cleanly. `prep_mics.py` pads a long lead (>greeting) + long trail.
- **Baselines** live in `baseline/` (committed) and are captured by the same
  Playwright container, so rendering is deterministic across runs. Delete one (or
  `UPDATE_BASELINE=1`) to recapture after an intentional UI change.
- **Headless audio**: works here (the WebAudio graph runs without a physical output).
  For real bot-audio capture + Whisper intelligibility scoring, add `xvfb-run` + a
  PulseAudio null-sink recorded with ffmpeg.
- **Scale**: `prep_mics.py --all` builds all 40 `quality_spec` scenarios; the suite
  runs whatever is in `scenarios.json`.
```
