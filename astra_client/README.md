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
- **Metrics dashboard**: time-to-first-byte latency charts, token usage, and connection status.
- **Conversation transcript**: live ASR and bot-response display.
- **Webcam vision panel**: live webcam input for the multimodal Omni Subagents example.
- **Safe session restart**: End and Start can create a new WebSocket session in
  the same tab, with a fresh session ID and audible welcome.
- **Guided introduction**: a replayable animated overlay points to the main
  controls and explains how to select, configure, start, and inspect an example.
- **Streamlined example selection**: select an example without opening its
  complete configuration popup, then configure it only when you need to change
  its session options.
- **Per-example tools**: enable or disable tools for the Generic
  Frontend/Backend Agent from its configuration popup or from **Settings**.

## Use the Curated Experience

Select **Guided introduction** (`?`) in the header while no session is active.
The six-step tour highlights the example cards, configuration and start
controls, pipeline information, and settings. Use **Back** and **Next** to move
through it, or select **Skip tour**. You can start the tour again from the
header.

To prepare a session, select the main area of an example card. This action only
selects the example. Select **Configure** on the card or in the selected-example
action row when you want to choose a text-to-speech engine, change capture
preferences, or adjust other supported options. Select **Start conversation**
in the action row to launch the selected example directly.

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

## Session Restart Boundary

WebSocket audio uses a monotonically increasing bot-track epoch. The client
advances that epoch before every new connection because the Pipecat audio
player remembers interrupted track IDs and discards late audio for them. This
prevents the next session's welcome from being mistaken for audio from a
cancelled turn. The new session ID also remounts the Conversation Orb, clearing
session-scoped speaking, thinking, tool, and latency state. User-selected
examples, service preferences, recording choice, and capture consent remain
unchanged.

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
