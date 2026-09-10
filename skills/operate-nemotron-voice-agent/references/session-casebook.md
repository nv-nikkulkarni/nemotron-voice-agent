# Session Casebook

## Contents

1. [Evidence Rules](#evidence-rules)
2. [Capture and Multi-Replica Sessions](#capture-and-multi-replica-sessions)
3. [Generic Tool and Grounding Sessions](#generic-tool-and-grounding-sessions)
4. [TTS and Audio Sessions](#tts-and-audio-sessions)
5. [Reasoning, Safety, and Prompt Sessions](#reasoning-safety-and-prompt-sessions)
6. [Turn and Interruption Sessions](#turn-and-interruption-sessions)
7. [How to Investigate a New Session](#how-to-investigate-a-new-session)

## Evidence Rules

Treat session IDs as correlation handles, not conclusions.

- **Archive-verified:** the NGC archive/logs/audio/transcript were inspected.
- **Report-verified:** a checked-in report or deterministic regression records the facts.
- **Chat-supported:** the prior investigation recorded a conclusion, but the raw archive
  is not currently present.
- **Symptom-only:** the user supplied the symptom/ID but the archive was unavailable or
  the investigation did not reach a durable conclusion.

Never upgrade chat-supported or symptom-only history to verified. Re-query
`0491162300748285/session-captures:<session-id>` with an authorized NGC key when a current
decision depends on it.

## Capture and Multi-Replica Sessions

### `2c08ede077a0`

Evidence: archive-verified at the time of investigation.

- NGC upload completed; archive was approximately 2.98 MB.
- It was a Generic session, not Omni.
- The capture contained complete logs/transcript, nine ASR items, eight TTS items, and no
  recorded runtime errors.
- Tool behavior observed in this session completed normally.

Do not cite it as proof of multiworker Omni webcam behavior because it did not use Omni.

### `6c16aeaa26c7` and `e11b95753c03`

Evidence: chat-supported, incomplete.

These were nominated as Omni/multiworker capture candidates. At the inspected point they
were absent or pending and did not provide evidence that webcam plus capture passed across
replicas. Re-query before drawing a present-day conclusion.

### `62d6f51152de`

Evidence: chat-supported incident.

A consented, normally ended production session did not appear as an NGC version. This was
one of the primary capture-reliability cases. The mitigation introduced an acknowledged,
deduplicated browser capture coordinator, bounded retry/teardown wait, two-signal Redis
state, retained no-artifact failures, and explicit terminal outcome logs.

### `0111d3c101c3`

Evidence: archive-verified at the time of investigation.

- Viking 0.1.140/app 2.0.68; 16 turns.
- Archive upload completed at about 6.15 MB with 16 ASR and 20 TTS items.
- Pending/failed capture queues returned to zero.
- The browser issued duplicate capture POSTs that landed on different replicas; Redis
  coordination still produced exactly one archive.

This is strong idempotency/cross-replica capture evidence for one session, not the full
20-session capture matrix.

### `de91f2cf7010`

Evidence: report-verified focused Viking test.

A 120 ms non-verbal tone was injected during long web-search speech. The session completed
with one user message, no `user-interruption-trigger`, and an uploaded capture. This proves
the synthetic false-interruption case, not human microphone barge-in under every accent or
noise profile.

## Generic Tool and Grounding Sessions

### `490381164925`

Evidence: archive-verified historical investigation.

- Capture uploaded with valid WAV and no runtime error.
- Five tools started; four completed; one was canceled after continued speech.
- Santa Clara was resolved to Cuba in one provider path.
- Lightning skipped tools for several date/time, California weather, news, political,
  OpenClaw, and report questions, then fabricated California weather.

Primary finding: nondeterministic/incorrect Talker routing, not Redis failure. Later prompt
hardening, temperature zero, liveness/replay guards, and repeated tool matrices target it.

### `35644d0bbe01`

Evidence: archive-verified historical investigation.

- Google stock worked.
- A technology-stack phrase was misrecognized and the identity answer repeated.
- A combined NVIDIA/weather request produced no tools.
- Speech fabricated an NVIDIA quote and Santa Clara temperature inconsistent with a later
  live result.

Primary finding: missing delegation and ungrounded current data. Do not treat a plausible
number as success without a current native tool call.

### `95d62568cbb3`

Evidence: archive-verified historical investigation.

- Pune weather and USD values were initially spoken without tools.
- An explicit “Fetch latest” turn did use web search and returned a substantially different
  exchange value.
- Search took roughly 8.2 seconds and end-to-end roughly 9.2 seconds.

Primary finding: stale/direct live-data answer until explicit lookup. Prompt rules now
force current/latest/challenge follow-ups to delegate.

### `079b3a5dcc3b`

Evidence: chat-supported detailed investigation.

- USD/INR was answered directly with a stale value.
- “Check the latest” produced a promise to check but no tool or final answer.
- Only “go ahead” triggered a lookup and returned a newer value.
- A World Cup search did call Perplexity, but the provider returned a fluent false answer
  that was trusted and contaminated later context.

Mitigation requested for the routing part was prompt-only: current/latest, stale-answer
challenge, and “go ahead” examples. No Python router or memory redesign was added. The
provider-truth problem remains a limitation: structurally non-empty Sonar output is still
trusted without independent evidence validation.

### `de340eea4ab5`

Evidence: symptom-only/chat-supported architecture analysis; exact archive unavailable.

Reported symptom: delegated work appeared stuck until the user explicitly told it to stop.
The relevant structural risks were nested timeout ownership and older UI/backend lifecycle
paths that could leave a pending tool indication longer than the inner provider work.
Mitigation established an ordered 45-second outer callback, 40-second backend, bounded
planner deadline, 20-second web deadline, and one grounded terminal failure. Do not claim a
single exact root cause for this session without recovering the archive and logs.

### `52f301234e8c`

Evidence: report-verified regression fixture.

An incomplete stock-price interaction leaked private/internal narration into the visible
transcript. Lightning reasoning was configured off, but output can still contain planning-
like prose; configuration is not an output safety guarantee.

The regression requires audible user-safe clarification, no private narration, and no
serialized internal tool calls. Prompt boundaries plus the private-mechanics output guard
mitigate it.

### `499162cb3960`

Evidence: report-verified regression fixture.

The agent returned an old answer during repeated “latest/current/verify” challenges. The
regression requires a fresh web/search call for all three challenge turns, audio every turn,
no presentation of 2022 as latest, and no contradiction of the newer grounded year.

### `ed26e5a8c564`

Evidence: chat-supported, live-model mitigation verified.

After a BMI result, “But how did you calculate my BMI?” caused Lightning to replay the
cached number. The cached-replay guard rejected it twice and emitted a generic dead-end.
The prompt incorrectly made every BMI mention sound like a new computation.

Fix: scope mandatory delegation to requests that compute a new BMI. A methodology question
is stable DIRECT explanation: weight in kilograms divided by height in metres squared,
without replaying the user's number or invoking a new calculation. Historical validation
recorded 10/10 scenario replay, 140/140 Talker matrix, and 7/7 prompt tests.

## TTS and Audio Sessions

### `b7eedb41e403`

Evidence: archive-verified historical RCA.

Chatterbox sounded broken because it inherited Magpie's `stitched` synthesis mode. Long
multi-sentence chunks were interleaved/poorly segmented, making speech unnatural. The fix
selected provider-specific settings, enforced Chatterbox `per_sentence`, applied a
defensive model rule, and bounded dense text to about 240 characters.

This was application configuration, not a reason to redeploy the TTS NIM.

### Slowed, low-pitch “male” Magpie audio

Evidence: reproduced historical UI issue, not tied to one retained session ID.

The browser played 22.05 kHz TTS samples as 16 kHz. That stretches time and lowers pitch.
Fix the player metadata/rate initialization from `/api/deployment`; do not retune or
redeploy Magpie.

## Reasoning, Safety, and Prompt Sessions

### Why reasoning-like text can leak when Talker thinking is off

`thinking: false` disables the model's explicit reasoning mode/trace protocol. It does not
mathematically prevent ordinary output tokens from saying “I will delegate” or narrating a
plan. Treat output guards and prompt examples as the protection boundary.

### `0111d3c101c3` guard overreach

The same archived session contained both successful and problematic behavior:

- Pune/NVIDIA/Santa Clara/F1 search worked;
- one response disclosed internal delegation behavior;
- the safety/mechanics boundary then became sticky and refused public NVIDIA/Hugging Face
  news multiple times;
- a generic educational question about backend architecture was overblocked;
- some answers used Markdown or were too long; and
- multilingual capability was overstated.

Mitigation should reset refusal on a new public topic and detect first-person disclosure
of private operations rather than banning ordinary terms such as “backend.” Add focused
tests before changing the regex; broadening it can worsen the problem.

## Turn and Interruption Sessions

### “There is nothing pending right now” during barge-in

This happened when the backend had already completed by the time the explicit cancel call
ran, even though audible speech was still being interrupted. The backend task registry was
truthful but incomplete for the user experience.

The mitigation tracks speech-only interruption. If the user interrupted active bot speech,
cancel acknowledges “Okay, I stopped that.” A true cancel with no backend work and no
interrupted speech keeps “There is nothing pending right now.”

Stopping audio requires both server and browser work: Pipecat interruption frames stop
future synthesis, and `TurnAwareDailyMediaManager.userStartedSpeaking()` clears already
buffered browser audio.

### No welcome after starting session two without refresh

The first greeting of a reconnected session was tagged with the old bot-audio epoch and
discarded. Later turn audio used new state and played. Advance the epoch before reconnect,
clear transient UI/audio state, mint a new session ID, and assert the second greeting is
audible.

## How to Investigate a New Session

1. Verify the exact session ID and environment/version.
2. Query NGC resource status without exposing the key.
3. Download the exact archive to a controlled ignored directory.
4. Verify checksum, file list, non-empty transcript/log/audio, and capture terminal state.
5. Align user audio, app ASR, Talker action, tool lifecycle, provider result, TTS request,
   WebSocket frames, browser transcript, and independent ASR on timestamps.
6. Check Redis/SeaweedFS only when media/capture crossed replicas.
7. Classify input, product, provider, oracle, browser, and deployment failures separately.
8. Record confidence and missing evidence.
9. Add a deterministic regression if the source behavior is actionable.
10. Keep raw archives/WAV outside Git; commit only concise findings and code/tests.
