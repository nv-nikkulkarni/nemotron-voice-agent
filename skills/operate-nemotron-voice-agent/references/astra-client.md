# Astra Client

## Contents

1. [Purpose](#purpose)
2. [Landing and Example Selection](#landing-and-example-selection)
3. [Configuration](#configuration)
4. [Live Conversation Layout](#live-conversation-layout)
5. [Session Lifecycle](#session-lifecycle)
6. [Latency Visualization](#latency-visualization)
7. [Omni-Specific Behavior](#omni-specific-behavior)
8. [Capture and Feedback](#capture-and-feedback)
9. [Astra Packaging and Proxy](#astra-packaging-and-proxy)
10. [UI Regression Checklist](#ui-regression-checklist)

## Purpose

`astra_client/` is the curated React, TypeScript, and Vite client used by the local demo
and Astra. It started from the original `client/` but intentionally removed unrelated
features and added a polished NVIDIA-themed experience, animation, tool labels, session
capture, deployment metadata, and latency inspection.

Avoid broad visual redesign. Normal future changes should be prompt labels, example
structure, observability, accessibility, or targeted layout fixes. Keep the original
`client/` separate unless the change deliberately applies to both.

## Landing and Example Selection

The curated deployment exposes two primary examples:

- Generic Frontend/Backend Agent; and
- Omni Subagents.

The whole example card is clickable. The card does not contain separate Select or Configure
buttons; the persistent launch bar below the cards owns Configure and Start. This avoids the
old bug where only a narrow card sub-area selected Omni.

On landing, show a small non-blocking five-second hint such as “Click ? for a tour.” Do not
open an intrusive Yes/No invitation automatically. The `?` control starts the six-step
landing tour. Hide the tour control while a session is starting, live, or stopping. There
is no live-session tour.

## Configuration

The settings/configuration surface:

- contains no local model URL field;
- obtains tool availability from `/api/tools`;
- shows Generic tool checkboxes in the example configuration popup;
- represents the current selected subset, not merely the example's default list; and
- cannot widen the server-owned ToolSpec allowlist.

Selecting a TTS option changes app configuration only. It does not deploy a NIM. Magpie
can receive the IPA pronunciation dictionary; current Chatterbox integration does not.

## Live Conversation Layout

The live screen keeps:

- NVIDIA/Nemotron header and deployed timestamp;
- central animated Conversation Orb;
- transcript below/around the orb;
- compact tool-call labels;
- compact latency trigger below the orb;
- Mute and End controls; and
- session identifier for support/capture correlation.

The `TIME LEFT` tile is a compact square near the top-right session information. The
default limit is 600 seconds (`10:00`) and is configurable through
`DEMO_SESSION_SECONDS`. It appears only while live, uses an absolute deadline, and produces
visual warning states around 60 and 15 seconds.

For Omni, move the timer into the conversation column so it does not overlap the webcam
Chunk selector. Keep responsive fallbacks for narrower viewports.

The compact latency trigger remains below the orb. Only the expanded breakdown is anchored
inside the unused right-side area on wide screens. It expands downward within a bounded,
scrollable card; on small screens it moves below the trigger. Do not move the trigger to the
right just because the expansion belongs there.

## Session Lifecycle

Starting a session:

1. POST `/api/session-config` with the selected example, model services, tools, and safe
   prompt override fields.
2. Receive a server-generated short session ID and advertised audio sample rates.
3. Create the RTVI/WebSocket client using those rates.
4. Connect through `/api/ws?session_id=...`.
5. Play and render the greeting.

Use the current UI or checked-in SQA/voice harness to construct this request. Do not copy a
stale hand-written JSON example into a live environment: example keys, selected services,
and tool fields have changed over the project's history.

Ending a session uses the normal teardown path: stop audio, report capture choice, wait for
bounded acknowledgement, disconnect, and open the feedback modal. The ten-minute timeout
uses this same path; it must not simply destroy the socket.

Starting another session without refreshing must:

- reconnect a new WebSocket;
- obtain a new session ID;
- advance the bot-audio track epoch before reconnect;
- clear queued/obsolete bot samples;
- clear transient orb/tool/latency/conversation state; and
- play the new welcome message audibly.

The original bug advanced state too late, so the first greeting of session two was treated
as old audio even though the next user turn played normally.

## Latency Visualization

The UI consumes ordinary Pipecat/RTVI metrics plus custom agent stage events.

Headline labels:

- **Time to first audio** for the server-reported user-silence-to-first-bot-audio metric;
- **Audio playout (your browser)** for client buffering/output delay; and
- **True felt latency** for their combined user-perceived value.

The expanded panel separates:

- **Before you heard a response / Critical path**; and
- **After delegation / Does not block first audio**.

For Generic Frontend/Backend, show these self-explanatory stages:

- total selection time, with first selection token marker;
- total planning time, with first plan token marker;
- second/third planning rounds when present;
- individual backend tool calls; and
- final response generation only when a Talker rephrase occurred.

Do not add first-token time to model total time. Total processing already contains TTFT.
Parallel tool durations overlap. Structured Generic stage metrics replace the duplicate
generic LLM pipeline row.

Timeline positions are approximate: the browser receives an event after server work and
derives the start offset from receipt time minus duration. If timing metadata is incomplete,
reported order is the fallback. This visualization explains the flow; it is not a perfect
distributed trace.

## Omni-Specific Behavior

Omni is a different worker pipeline and does not emit Generic Talker/Thinker/tool stage
metrics. The UI must not show empty Generic labels for it.

Preferred Omni headline data is server RTVI `user-bot-latency`. If absent, measure in the
browser from `UserStoppedSpeaking` to the first audible bot sample. Label that value
**Browser-observed end-to-end latency** or **End-to-end latency**, and make clear it includes
client/network scheduling. Replace it when the authoritative server metric arrives.

The webcam rail and Chunk selector remain usable. Timer placement must not overlap them.
Uploaded media and webcam requests use the same server-generated session ID as the live
WebSocket so Redis can route them to the owning pipeline.

## Capture and Feedback

The browser capture coordinator maintains one in-flight report promise per session. It:

- deduplicates concurrent teardown callers;
- considers success only after HTTP 2xx;
- retries once after bounded backoff;
- uses `keepalive` as a browser-close fallback;
- waits up to about 1.5 seconds inside a roughly 4-second global teardown ceiling; and
- sets `captureFlushed=true` only for acknowledged reporting.

Conversation transcript rendering and capture reporting share one exact-overlap helper.
It removes exact spoken/unspoken duplication without fuzzy-deleting legitimate repeated
speech.

The feedback modal retains the session ID so a tester can correlate a report. An optional
Google Form can be proxied at `/feedback`. The repository runbook is
`docs/how-to/create-deployment-feedback-form.md`; the historical generator is
`scripts/create-nemotron-voice-agent-feedback-form.gs`.

The deployment-specific form should capture:

- tester name/org and environment;
- Generic versus Omni example and selected TTS/tools;
- factuality, grounded tool use, current-data behavior, and instruction following;
- response length, time to first audio, turn-taking, barge-in, pause/backchannel behavior;
- voice quality, pronunciation, audio artifacts, and cold start;
- context retention, prompt adherence, safety, and private-reasoning leakage;
- Omni media/webcam experience;
- session capture/feedback success;
- overall rating, critical issue, comments, session ID, and optional recording.

Do not put an upstream credential into the form script or public URL.

## Astra Packaging and Proxy

`docker/Dockerfile.nvcf-ui` builds the Vite app and packages it in non-root
`nginx-unprivileged` on port 7860. `docker/nvcf-ui-entrypoint.sh` writes runtime public
configuration and nginx upstream configuration.

Astra Vault owns the NVCF host, function ID, and invocation key. nginx injects credentials
server-side for `/api/*`, `/health`, and `/api/ws`. It strips cookies both directions so a
stale NVCF request-affinity cookie cannot break a later WebSocket.

The image must expose a visible build/deployed timestamp. After rollout, verify the actual
tag/digest, `config.js`, bundle names, session limit, examples, backend target, and Argo
revision. UI and NVCF versions move independently; report both.

## UI Regression Checklist

- whole Generic and Omni cards select on every non-disabled point;
- Configure opens the expected tool/model popup; Start does not require opening it first;
- no local model URL appears;
- Generic tool list matches `/api/tools` and selected state;
- landing hint disappears without interaction and `?` starts the tour;
- no tour invitation or `?` appears live;
- timer shows `10:00`, warns, expires through normal teardown, and never overlaps Omni;
- latency trigger remains below orb; expanded card uses right-side blank space;
- Generic labels explain totals/TTFT and do not double count;
- Omni shows server or browser-observed end-to-end latency;
- End opens feedback and reports capture exactly once;
- session two without refresh gets a new ID and audible greeting;
- `/api/deployment` rates initialize the player before audio; and
- browser console has no unexpected errors or WebSocket closures.
