# Nemotron Voice Agent Astra Client

The Astra client is the browser front end for the [Nemotron Voice Agent](../README.md) blueprint. It gives you a real-time, interruptible voice conversation with the agent, along with controls to select an example, choose its supported tools and voice, adjust its prompt, watch live latency metrics, and follow the conversation transcript.

It is a React and TypeScript single-page app built with [Vite](https://vite.dev/) and the [Pipecat Client SDK](https://docs.pipecat.ai/client/introduction). The client connects to the Python backend (`src/server.py`) over WebRTC or WebSocket and reads its `/api/*` endpoints for session, service, and voice configuration. The dedicated [Astra UI image](../docker/Dockerfile.nvcf-ui) serves
`astra_client/dist/` through nginx and proxies API and session traffic to the
backend. The upstream client in `client/` has a separate build.

## Features

- **Cascaded pipeline view**: follow the ASR → LLM → TTS flow live.
- **Dual transport**: WebRTC (recommended) or WebSocket.
- **Runtime service switching**: add or remove LLM, ASR, and TTS services without redeploying.
- **Prompt management**: pick a built-in persona or write a custom system prompt.
- **LLM settings**: tune each model role before starting or apply sampling changes
  to future requests during a conversation.
- **Voice studio**: choose a speech engine, preview voice cards, upload a
  zero-shot sample, and save pronunciation fixes.
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
  then use the launch bar to configure it, edit prompts, or start it.
- **Ten-minute session timer**: a compact square **TIME LEFT** countdown stays
  fixed below the top-right session-ID chip and gracefully ends a live session
  at zero. With the Omni webcam rail active, it shifts left so it cannot cover
  the **Chunk** selector.
- **Per-example tools**: enable or disable tools for the Generic
  Frontend/Backend Agent from **Tools** before starting a session.
- **Session capture choice**: allow quality-review capture or continue without
  saving before each conversation. Downloadable browser recording is a separate
  option.

## Use the Curated Experience

A brief, nonblocking **Click ? for a tour** hint appears for 5 seconds when the
landing page loads. No tour invitation or spotlight opens automatically.
Select **Guided introduction** (`?`) to start the animated landing tour. It
highlights the example cards and pre-session launch controls. Use **Back** and
**Next** to move through the steps, or select **Skip tour** from any step. The
`?` button is not available while a session is starting, live, or stopping.

To prepare a session, select anywhere on an example card. The launch bar below
the cards offers **Prompts**, **Tools**, **Voice**, and **Start conversation**.
Use **Prompts** for frontend and backend instructions, **Tools** for agent
capabilities, and **Voice** for speech configuration. Each page includes
**Back to setup** to return to the cards.

Select **Start conversation** to choose capture permission before connecting.
The dialog asks whether the NVIDIA team can save microphone and assistant
audio, the transcript, and diagnostic logs for quality review and debugging.
Select **Allow and start** or **Continue without saving**. Closing the dialog
or pressing **Escape** cancels the start. Each new conversation asks again.
**Keep a downloadable recording** is an independent browser recording option.

A live session starts with a compact square `10:00` **TIME LEFT** countdown
below the session-ID chip at the top right. It uses an absolute deadline and
enters its low state during the final 60 seconds. It enters its critical state
during the final 15 seconds. At zero,
the client requests the existing timeout end path once. Normal graceful
teardown, capture reporting, and feedback then run. The timer appears only
while the session is live. When the selected example uses the webcam rail, the
timer shifts into the conversation column and leaves the rail controls clear.

The default and checked-in Astra runtime values set the limit to 600 seconds.
Deployments can override the limit with `DEMO_SESSION_SECONDS`.

The Generic Frontend/Backend Agent exposes its available tools under **Tools**.
Choose a subset before starting. The server accepts only tools allowed by the
selected example; browser selection cannot add an unregistered tool. The page
also shows Generic's fixed Talker and Thinker model roles. Omni exposes its
pre-session **Reasoning** choice there.

**Audio settings** and **Agent configuration** appear only on the conversation
page. **Audio settings** opens microphone and speaker selectors.
**Agent configuration** shows the current agent configuration. Small,
nonblocking hints point to both controls for 2 seconds after the session starts.
The configuration view includes models, tools, frontend and backend prompts,
persistent instructions, voice settings, pronunciation fixes, and capture
choices. Configure voices, tools, and prompts before starting. **LLM settings**
provides separate model request controls.

Model endpoints come from the deployment's service catalog. **Settings** does
not expose a local model URL override, which prevents a browser-only endpoint
change from bypassing the deployment configuration.

## Navigate the Interface

The landing page uses a centered gradient wordmark, moving aurora background,
and translucent cards. The example cards, launch controls, voice gallery, and
prompt editor adapt to narrower windows. Selected example and voice cards show
a visible selection state. Hover over **Prompts**, **Tools**, or **Voice** for
a glow and shine effect. Use **Tab** to move through controls; keyboard focus
has a visible outline. Decorative animations and interface transitions respect your
system's reduced-motion preference.

## Prepare Prompts

Select **Prompts** before starting a session to open `/prompts`. Generic
Frontend/Backend Agent shows frontend and backend instructions. Omni Subagents
shows **Speaker** and **Thinker** instructions, with matching role names in the compact
fields and expanded editors. The selected example supplies its own prompt
defaults. The editor saves each pipeline's overrides in browser localStorage.
**Persistent instructions** apply across pipelines and append to both roles,
including your edited prompts. For Omni, they append to Speaker and Thinker.
Reloads and restoring either default preserve these instructions; clear their
field to remove them.
Changes apply to the next session. Open the editor with **Prompts** in the
launch bar. Select **Back to setup** to return.

Select **Expand editor** on either role card to open a large dialog for that
prompt. The dialog uses wrapped monospace text and lets you choose a text size
from 14 to 22 pixels in 2-pixel steps. Edits save to the same browser
overrides as the compact fields. Each role has a matching default-restore
control. Generic uses **Restore frontend default** and **Restore backend default**.
Omni uses **Restore speaker default** and **Restore thinker default**. **Done**
or **Escape** closes the dialog and returns focus to **Expand editor**. Each role accepts up to
32,000 characters. Prompt editing, expansion, and restoring defaults are
disabled during an active session and while catalog defaults load. Unedited
sessions use the displayed catalog prompt, preserving its native examples.
Generic Frontend/Backend Agent also retains trusted native tool-call examples when you edit its persona, including
weather lookup and architecture presentation. Current-time requests still
require a fresh clock tool result. Generic keeps a brief-answer
baseline when you edit its persona: 1 sentence, normally 10–20 words and at
most 35. Ask explicitly for detail, steps, lists, comparisons, or multiple
facts to expand. Required results and safety information stay intact.
These are model instructions rather than a guaranteed word cap.
Refer to
[Configure Prompts](../docs/how-to/configure-prompts.md) for API limits.

## Tune Model Responses

Select **LLM** in the conversation header to open **LLM settings**, or open
**LLM settings** from **Tools** before starting. Generic exposes independent **Frontend · Talker** and
**Backend · Thinker** controls. Omni Subagents exposes **Speaker**, **Thinker**,
**Media Analyzer**, and **Webcam** controls for the shared Nemotron Omni model.
The controls change request parameters; they do not switch model endpoints or
change reasoning modes.

Adjust temperature, top-p, and maximum output tokens for each role. Advanced
controls provide top-k, repetition penalty, presence penalty, and frequency
penalty. Role defaults come from the backend. Top-k `1` restricts
sampling to the leading candidate, so temperature and top-p have little effect
until you change top-k. Refer to [LLM Session Controls](../docs/how-to/configure-llm.md#llm-session-controls)
for parameter ranges and token-budget behavior.

Before starting, select **Save settings** to retain your edits separately for
each example in your browser. A new conversation or reconnect uses the saved
settings. During a conversation, select **Apply to session** and wait for
acknowledgement. A successful update also saves the settings for later sessions.
Changes affect future model requests; a request already running continues with
its original values. Closing the panel discards unapplied edits.

**Reset** restores one role and **Reset all** restores every role in the draft.
Save or apply again to retain the reset. If a revision conflict appears, close
and reopen the panel to load the current session settings before editing again.

## Build a Voice

Select **Voice** before connecting to open `/voice`. **Speech engine** lists
catalog engines, including Magpie Zeroshot when enabled. **Speaking voice**
shows visible voice cards with names and language details in a scrollable gallery. Larger catalogs
provide **Find a voice** search by name or expression, with a matching count.
Select a card, enter up to 200 characters, and choose **Preview voice**. Voice
choices and sample controls are pre-session options; end the session before
changing them. The cards and sample upload
are visible without expanding a section or opening a voice dropdown.

Under **Create a character voice**, upload 3–10 seconds of clear speech and
select Magpie Zeroshot before enabling **Use sample for zero-shot voice**. The
browser converts the clip to 22.05 kHz, 16-bit mono PCM WAV and saves it in IndexedDB. The sample is
carried in session configuration, so replicas do not require shared files.
The saved clip survives a reload, but its use checkbox resets off. Enable it
again before previewing or starting with the sample. Select **Remove sample**
to delete the saved clip. Preview uses the enabled sample. Preset voice
selection is disabled while the enabled sample supplies the voice. Refer to [voice sample limits](../docs/how-to/configure-tts.md#preview-and-upload-voices-in-the-astra-client).

Under **Pronunciation fixes**, edit a deployed rule or enter a **Word** and
**IPA pronunciation**, then select **Save pronunciation**. Save up to 50 custom
rules, with 80 characters per word and 200 per IPA value. Use separate rules for
the words in a name. Rules save per assistant in browser localStorage and apply
to Magpie previews and new conversations. **Remove** restores the deployed
default for that word. Rules remain saved when you choose Chatterbox, whose
request interface does not support IPA dictionaries. Refer to
[session pronunciation fixes](../docs/how-to/configure-tts.md#session-pronunciation-fixes-in-the-astra-client).

Prompt and sample storage is specific to the browser profile and origin.
The Generic Frontend/Backend Agent uses the browser IANA timezone for local
clock requests. Ask to show the architecture in either curated example to
display its repository-owned SVG alongside the conversation.

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
The preferred **Time to first audio** value comes from the server RTVI
`user-bot-latency` metric and measures from user silence to bot speech. If that
metric is absent, the client measures from `UserStoppedSpeaking` to the first
audible bot output. It labels this fallback **End-to-end latency** in the pill
and **Browser-observed end-to-end latency** in the breakdown. The fallback
includes browser delivery and playout, and is therefore approximate. The
server value takes precedence whenever it is available. First audio can be
progress speech rather than the final answer.

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
examples and service preferences remain unchanged. Each start asks for a new
capture decision and offers the browser recording option again. Reconnecting
after an involuntary end uses the same permission dialog.

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
npm --prefix astra_client ci
npm --prefix astra_client run dev
```

Run these commands from the repository root. Vite starts at
`http://localhost:5173` with hot-module reload. The checked-in Vite configuration
does not proxy `/api/*`; configure routing to a running backend before testing
sessions. The production UI image provides this proxy.

### Build for production

```bash
npm --prefix astra_client run build
```

The build is type-checked with `tsc` and emitted to `astra_client/dist/`.
Rebuild the [Astra UI image](../docker/Dockerfile.nvcf-ui) after changing the
client. The container listens on port `7860`; its published host port depends
on your deployment. Set `BACKEND_ORIGIN` for a direct HTTP backend, or
`NVCF_HOST` and `NVIDIA_API_KEY` for the NVCF proxy. Keep credentials in the
container environment.

### Lint

```bash
npm --prefix astra_client run lint
```

ESLint runs the TypeScript, React Hooks, and React Refresh rules defined in `eslint.config.js`.

## Backend endpoints

The client reads its configuration from the backend (`src/server.py`) and starts sessions through these endpoints:

| Endpoint | Purpose |
| --- | --- |
| `/api/deployment` | Active example, available services, and UI capabilities |
| `/api/session-config` | Prompts and default session settings |
| `/api/prompts` | Prompt catalog with frontend/backend role metadata |
| `/api/tools` | Tool specifications allowed for the selected example |
| `GET /api/llm-settings` | Supported model roles and deployed sampling defaults |
| `GET/PUT /api/sessions/{session_id}/llm-settings` | Read or apply live sampling settings with a revision |
| `/api/tts-config` | Available TTS voices and languages |
| `GET /api/tts/pronunciations` | Deployed IPA pronunciation defaults |
| `POST /api/tts/preview` | Bounded pre-session voice preview as WAV audio |
| `POST /api/session-capture` | Session-end capture decision and consented transcript |
| `/api/architecture/{generic,omni}.svg` | Repository-owned architecture images |
| `/api/ice-servers` | STUN/TURN configuration for WebRTC |
| `/api/webcam-config` | Webcam capture defaults for multimodal examples |
| `/api/start` | Start a pipeline session |

## Learn more

- [Nemotron Voice Agent](../README.md): the full blueprint, examples, and deployment guides.
- [Getting Started](../docs/01-getting-started.md): prerequisites and how to run the backend.
- [Pipecat Client SDK](https://docs.pipecat.ai/client/introduction): the client framework this app is built on.
