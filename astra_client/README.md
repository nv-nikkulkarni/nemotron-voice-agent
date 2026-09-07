# Nemotron Voice Agent Client

The Nemotron Voice Agent Client is the browser front end for the [Nemotron Voice Agent](../README.md) blueprint. It gives you a real-time, interruptible voice conversation with the agent, along with controls to select an example, choose its supported tools and voice, adjust its prompt, watch live latency metrics, and follow the conversation transcript.

It is a React and TypeScript single-page app built with [Vite](https://vite.dev/) and the [Pipecat Client SDK](https://docs.pipecat.ai/client/introduction). The client connects to the Python backend (`src/server.py`) over WebRTC or WebSocket and reads its `/api/*` endpoints for session, service, and voice configuration. In a deployed stack the backend serves this client's production build from `client/dist/`, so you normally reach the UI at `https://localhost:7860` rather than running it on its own.

## Features

- **Cascaded pipeline view**: follow the ASR → LLM → TTS flow live.
- **Dual transport**: WebRTC (recommended) or WebSocket.
- **Runtime service switching**: add or remove LLM, ASR, and TTS services without redeploying.
- **Prompt management**: pick a built-in persona or write a custom system prompt.
- **Voice selection**: browse and preview TTS voices with language filtering.
- **Audio visualizers**: real-time input and output waveform display.
- **Metrics dashboard**: time-to-first-audio latency, token usage,
  connection status, and Frontend/Backend agent stage metrics grouped by turn.
- **Conversation transcript**: live ASR and bot-response display.
- **Webcam vision panel**: live webcam input for the multimodal Omni Subagents example.
- **Safe session restart**: End and Start can create a new WebSocket session in
  the same tab, with a fresh session ID and audible welcome.
- **Guided introduction**: a brief **Click ? for a tour** hint points to the
  landing-page `?` button. The tour starts only when you select the button.
- **Streamlined example selection**: select an example through its full card,
  then use the launch bar to configure or start it.
- **Ten-minute session timer**: a compact square **TIME LEFT** countdown stays
  fixed below the top-right session-ID chip and gracefully ends a live session
  at zero.
- **Per-example tools**: enable or disable tools for the Generic
  Frontend/Backend Agent from its configuration popup or from **Settings**.

## Use the Curated Experience

A brief, nonblocking **Click ? for a tour** hint appears for 5 seconds when the
landing page loads. No tour invitation or spotlight opens automatically.
Select **Guided introduction** (`?`) to start the six-step animated landing
tour. It highlights the example cards, configuration and start controls,
pipeline information, and settings. Use **Back** and **Next** to move through
the steps, or select **Skip tour** from any step. The `?` button is not
available while a session is starting, live, or stopping. There is no separate
live-session tour.

To prepare a session, select anywhere on an example card. The cards do not
contain separate **Select example** or **Configure** actions. After selection,
the launch bar below the cards is the landing page's only visible place to
select **Configure** or **Start conversation**. Configure the example when you
want to choose a text-to-speech engine, change capture preferences, or adjust
other supported options. Start the conversation directly when the defaults are
suitable.

A live session starts with a compact square `10:00` **TIME LEFT** countdown
below the session-ID chip at the top right. It uses an absolute deadline and
enters its low state during the final 60 seconds. It enters its critical state
during the final 15 seconds. At zero,
the client requests the existing timeout end path once. Normal graceful
teardown, capture reporting, and feedback then run. The timer appears only
while the session is live.

The default and checked-in Astra runtime values set the limit to 600 seconds.
Deployments can override the limit with `DEMO_SESSION_SECONDS`.

The Generic Frontend/Backend Agent configuration includes its available tools.
You can also change the same selection under **Settings**. The settings list
and configuration popup share one checkbox state, so a change in either place
appears in the other and applies to the next session. The server accepts only a
subset of the tools allowed by the selected example; browser selection cannot
add a tool that the deployment did not register. Examples that do not register
tools do not show tool controls.

Model endpoints come from the deployment's service catalog. **Settings** does
not expose a local model URL override, which prevents a browser-only endpoint
change from bypassing the deployment configuration.

## Inspect Frontend/Backend Latency

The latency trigger is the compact **Time to first audio** pill below the
Conversation Orb. On wide layouts, selecting it opens a separately anchored,
height-bounded breakdown in the blank area to the right. The breakdown expands
downward and scrolls when needed instead of opening upward over the
conversation. On narrower layouts, it appears below the trigger. The breakdown
consumes `RTVIEvent.Metrics` and presents the agent stages as a waterfall. The
**Before you heard a response** lane shows the critical path to first audio. The
**After delegation** lane shows asynchronous planning, tool, and final-answer
work that continues after progress speech can begin. The real-time voice
pipeline remains below these lanes.

The breakdown can show the following seven metric types:

| Displayed Stage Detail | RTVI Metric |
| --- | --- |
| Frontend selection first-token marker | `frontend_tool_selection_ttft` |
| Frontend selection total and waterfall bar | `frontend_tool_selection_processing_time` |
| Backend planning first-token marker | `backend_llm_ttft` |
| Backend planning total and waterfall bar | `backend_llm_processing_time` |
| Backend tool total and waterfall bar | `backend_tool_call_latency` |
| Final-answer first-token marker | `frontend_final_response_ttft` |
| Final-answer total and waterfall bar | `frontend_final_response_processing_time` |

Values use milliseconds. Only stages executed and emitted for that turn appear.
For example, direct result mode does not run the final Talker response stage.
Each stage shows its total duration, with the corresponding time to first token
inline when available. The total already includes the first-token time, so do
not add them together. Parallel tool calls can also overlap. When structured
Frontend/Backend metrics are present, the client hides the generic LLM pipeline
row to avoid showing the same model work twice. It retains the generic LLM row
for pipelines that do not emit the structured agent metrics.

The browser estimates each bar start offset by subtracting the server-reported
duration from the first browser-observed completion offset. The resulting
positions show an approximate sequence, not a server-clock trace. If observation
offsets are unavailable, the client displays stages in their reported order.
**Time to first audio**
measures from user silence to bot speech, which can be progress speech rather
than the final answer.

The client clears the previous breakdown when a new recognized user turn
ends, then uses turn and invocation correlation to merge the current rows.
Older-turn metrics cannot replace rows after the new turn is identified.

## Session Restart Boundary

WebSocket audio uses a monotonically increasing bot-track epoch. The client
advances that epoch before every new connection because the Pipecat audio
player remembers interrupted track IDs and discards late audio for them. This
prevents the next session's welcome from being mistaken for audio from a
cancelled turn. The new session ID also remounts the Conversation Orb, clearing
session-scoped speaking, thinking, tool, and latency state. User-selected
examples, service preferences, recording choice, and capture consent remain
unchanged.

The source SQA oracle in
[`tests/sqa/test_teardown.mjs`](../tests/sqa/test_teardown.mjs) ends and starts a
WebSocket session without refreshing the tab. It passes only when the server
mints a different session ID and the second welcome has both transcript text
and audible onset. Run this oracle against each target environment before you
qualify that deployment.

## Getting started

### Prerequisites

- Node.js 20 or newer and npm.
- A running Nemotron Voice Agent backend. See the repo [Getting Started](../docs/01-getting-started.md) guide.

### Run in development

```bash
npm install
npm run dev
```

The Vite dev server starts at `http://localhost:5173` with hot-module reload, which is convenient for fast UI iteration. The full experience also needs the backend running for the `/api/*` endpoints and the WebRTC/WebSocket session, so the simplest way to exercise the complete UI is the backend-served build below.

### Build for production

```bash
npm run build
```

The build is type-checked with `tsc` and emitted to `dist/`. The Python server serves it automatically from `client/dist/`, so after building you reach the UI at `https://localhost:7860`. Rebuild whenever you change the client and redeploy.

### Lint

```bash
npm run lint
```

ESLint runs the TypeScript, React Hooks, and React Refresh rules defined in `eslint.config.js`.

## Backend endpoints

The client reads its configuration from the backend (`src/server.py`) and starts sessions through these endpoints:

| Endpoint | Purpose |
| --- | --- |
| `/api/deployment` | Active example, available services, and UI capabilities |
| `/api/session-config` | Prompts and default session settings |
| `/api/tools` | Tool specifications allowed for the selected example |
| `/api/tts-config` | Available TTS voices and languages |
| `/api/ice-servers` | STUN/TURN configuration for WebRTC |
| `/api/webcam-config` | Webcam capture defaults for multimodal examples |
| `/api/start` | Start a pipeline session |

## Learn more

- [Nemotron Voice Agent](../README.md): the full blueprint, examples, and deployment guides.
- [Getting Started](../docs/01-getting-started.md): prerequisites and how to run the backend.
- [Pipecat Client SDK](https://docs.pipecat.ai/client/introduction): the client framework this app is built on.
