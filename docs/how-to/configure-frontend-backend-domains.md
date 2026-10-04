# Configure Frontend/Backend Agent Domains

Use a Frontend/Backend Agent domain when you want to keep one real-time voice pipeline and replace the task-specific backend. The repository includes airline and generic domains.

## Understand the Shared Architecture

The shared Pipecat pipeline separates low-latency conversation from slower task execution:

1. The Talker LLM receives the transcript and conversation history.
2. The Talker answers stable conversational questions directly.
3. For domain work, the Talker emits `call_backend`. It emits `cancel_backend` when the user withdraws pending work.
4. A session-local backend sends the request to the registry-selected hidden Thinker prompt. Generic also includes bounded actual dialogue.
5. For the generic domain, the planner appends a generated contract block for only the effective session tools. The registry defines the maximum allowlist, and the browser can narrow it.
   The airline domain keeps its existing prompt-owned contracts. Python validates the plan before dispatch.
6. The backend returns structured response text.
7. The runtime either speaks trusted response text directly or asks the Talker for a concise reply. Text-to-speech (TTS) then produces audio.

The Talker sees only 2 functions. Internal functions, credentials, backend state, and tool results remain behind the domain boundary. The Thinker produces a bounded plan; the implementation does not use a ReAct observe-and-replan loop.

The shared Frontend/Backend Agent pipeline waits `2.0` seconds of
voice-activity-detector silence before the local VAD stop event finalizes any
remaining ASR audio. Native ASR final frames can arrive earlier. Smart Turn
still decides semantic completion, with a `2.0`-second silence fallback.
Override these pipeline-scoped values with `FRONTEND_BACKEND_VAD_STOP_SECS`
and `FRONTEND_BACKEND_SMART_TURN_STOP_SECS` after real-audio testing. Shorter
values can split follow-ups before their final location transcript arrives;
longer values add end-of-turn latency. Other examples retain their defaults.

Use `FRONTEND_BACKEND_TOOL_RESULT_MODE=direct`, `hybrid`, or `talker` to
control the grounded post-tool response. An explicit valid value overrides the
selected backend default. Without this variable, the Generic backend uses
`direct` and speaks trusted backend text without another Talker inference.
The Airline backend retains `talker`, which sends speakable results through
the guarded Talker pass. `hybrid` uses the Talker only for successful Generic weather results.
Other successes, failures, and clarifications use deterministic speech.

The checked-in NVCF chart sets
`app.frontendBackendToolResultMode: "direct"`, which renders
`FRONTEND_BACKEND_TOOL_RESULT_MODE=direct` in the application pod. That
explicit chart setting overrides the Generic source default. A source-only
change does not alter this Helm behavior. The legacy
`FRONTEND_BACKEND_DIRECT_TOOL_RESPONSE` switch can force `direct` only when
the explicit mode is absent.

Generic uses the `code_authored` progress policy and the neutral phrase
“Let me check that.” Its selector ignores the Talker query, avoiding a stale
company or location in progress speech. Progress plays at most once after the
threshold or an intermediate result. `FRONTEND_BACKEND_TALKER_FILLER_MODE=off`
or `observe` suppresses speech; `emit` permits it. Progress is not retained as
dialogue and does not block backend work. Other domains retain their policies.

## Choose a Built-In Domain

The following registry entries use the same `examples.frontend_backend_agent.pipeline:bot` implementation:

| Registry Example | `domain_profile` | User-Facing Prompt | `thinker_prompt` | Internal Tools |
| --- | --- | --- | --- | --- |
| `frontend-backend-agent` | `airline` | `talker` | `thinker` | Domain-owned flight search, booking, and passenger name record (PNR) status |
| `generic-frontend-backend-agent` | `generic` | `generic_talker` | `generic_thinker` | Registry-selected weather, stock price, current time, architecture, web search, body mass index (BMI), and random-number tools |

The registry loader normalizes `domain_profile`, `thinker_prompt`, and `tools` as fields on each `ExampleEntry`. During `_sanitize_session_config`, the server binds those fields from the selected entry and overwrites client-supplied values. Domain resolution uses the fixed `_DOMAIN_FACTORIES` allowlist in `src/examples/frontend_backend_agent/src/domain.py`. Tool resolution uses the selected domain's code-owned registry.

This design prevents a client from changing the backend domain, selecting another domain's hidden prompt key, enabling an undeclared tool, or requesting an arbitrary Python module independently of the selected example. For a domain-profile session, `tools_available` can request only a subset of the registry-owned list.
The server ignores unknown names; `none` selects no optional tools.

## Select a Domain Locally

The default `selection: all` setting in `examples_registry.yaml` exposes both built-ins in the UI. Start the server from the repository root:

```bash
uv run python3 src/server.py --host 0.0.0.0 --port 7860
```

To expose only the generic variant, use the registry environment override:

```bash
EXAMPLE_SELECTION=generic-frontend-backend-agent uv run python3 src/server.py --host 0.0.0.0 --port 7860
```

The airline domain also needs its booking service. Start it in another shell for a host-native run:

```bash
PYTHONPATH=src uv run python3 -m examples.frontend_backend_agent.airline.database.server
```

The existing Compose recipes select the airline entry by default. Set `EXAMPLE_SELECTION` to use the generic entry through the same application and model recipe:

```bash
EXAMPLE_SELECTION=generic-frontend-backend-agent docker compose --profile frontend-backend-agent up -d
```

For a local model deployment on workstation or server GPUs, use:

```bash
EXAMPLE_SELECTION=generic-frontend-backend-agent docker compose --profile frontend-backend-agent/server up -d
```

For a supported single-GPU deployment, use:

```bash
EXAMPLE_SELECTION=generic-frontend-backend-agent docker compose --profile frontend-backend-agent/single-gpu up -d
```

The Compose profile still starts the booking server. The generic backend does not load or call it because its registry entry does not include the `booking-server` slot.

## Understand Generic Tool Specifications

`src/examples/frontend_backend_agent/src/tools.py` defines the `ToolSpec` contract, and `src/examples/frontend_backend_agent/generic/tools.py` declares every generic internal capability in one specification. Each specification owns its planner contract, parameters, executable adapter, speech formatter, deadline, mutation flag, and capability phrase. Validation, dispatch, result formatting, the hidden Thinker context, and user-facing capability text consume the same definition.

For a domain-profile example, `GET /api/tools?pipeline_mode=<example-key>`
renders the registry-allowed `ToolSpec` objects for the browser. Each response
contains the tool description and JSON Schema parameters.

The built-in generic registry entry enables these internal tools:

| Tool | Purpose | Credential | Important Boundary |
| --- | --- | --- | --- |
| `get_weather` | Current conditions for a city or location | `WEATHERAPI_KEY` | Defaults to temperature and conditions; `details: true` adds available feels-like temperature, humidity, and wind. Does not provide forecasts or historical weather. |
| `get_stock_price` | Current public-company quote | `FINNHUB_API_KEY` | Does not provide predictions, crypto, commodities, or historical prices |
| `get_current_time` | Fresh current time and date in an IANA timezone | None | Reads the clock for each call and applies daylight saving rules. An omitted `timezone` uses the session's browser IANA timezone, or `UTC` without a session zone; an unknown zone returns a clarification. |
| `show_architecture` | Repository-owned Generic pipeline image reference | None | Returns `/api/architecture/generic.svg` and a brief spoken description; the Astra client displays the validated image reference. |
| `web_search` | Current or externally verifiable information | `PERPLEXITY_API_KEY` | Optional Boolean `details` defaults to `false`: 1 spoken sentence, or up to 2 with `true`, within 450 characters. Requests prose without URLs and strips numeric citation markers. |
| `calculate_bmi` | Metric adult BMI screening calculation | None | Requires explicit weight in kilograms and height in meters |
| `generate_random_number` | Inclusive random integer | None | Accepts a bounded minimum and maximum |

Add live-tool credentials to `.env` for Docker Compose or to the process environment for a host-native run:

```bash
WEATHERAPI_KEY=<weatherapi-key>
FINNHUB_API_KEY=<finnhub-key>
PERPLEXITY_API_KEY=<perplexity-key>
```

The services also recognize these optional endpoint settings:

| Environment Variable | Default |
| --- | --- |
| `WEATHERAPI_BASE_URL` | `https://api.weatherapi.com/v1` |
| `FINNHUB_BASE_URL` | `https://finnhub.io/api/v1` |
| `PERPLEXITY_BASE_URL` | `https://api.perplexity.ai` |
| `PERPLEXITY_MODEL` | `sonar` |

The current-time tool reads its clock on each call. The packaged Python
`tzdata` dependency provides complete portable IANA timezone data when system
data is incomplete or absent. Browser aliases such as `Asia/Calcutta` remain valid;
unknown zone names still require clarification. Structured results retain the
IANA identifier in `timezone`; speech uses `timezone_label` from the fresh
instant, such as IST or EDT. Numeric-offset zones use spoken labels such as
“UTC plus 5 hours and 45 minutes.”

Do not pass credentials through `call_backend`, Thinker plans, prompt text, or client session configuration. Each service reads its credential directly from the process environment.

When a credential is absent, the service returns an unavailable result. It does not use sample data or a stale fallback. This lets the Talker report the failure without presenting fabricated live information.

### Follow-Up Context And Fresh Results

The Generic Thinker receives recent actual dialogue grouped by user turn.
A turn starts with a user request and includes its associated assistant text.
The default limit is 8 user turns, including the current request.
This dialogue resolves references such as "there," "that company," and "again."
Changing weather, stock, web, and clock results still require a new tool call.

Configure the Generic backend window through these surfaces:

| Surface | Setting | Behavior |
| --- | --- | --- |
| Application environment | `BACKEND_HISTORY_TURN_LIMIT=8` | Deployment default; accepts `1`–`20`. |
| Helm values | `app.backendHistoryTurnLimit: "8"` | Renders the same application environment variable. |
| Session configuration | `backend_history_turn_limit` | Overrides the default with an integer or decimal integer string from `1` to `20`; only Generic-domain examples accept it. |
| Astra client | **Tools > Conversation context > Backend history** | Saves per example in browser localStorage and applies to the next conversation or reconnect. |

`GET /api/deployment` exposes Generic's `backendHistory.defaultTurnLimit` and
`backendHistory.maxTurnLimit`. The browser slider uses these values and sends the
chosen limit with both WebRTC and WebSocket session configuration.
**Agent configuration** shows the selected backend limit during a conversation.
This setting does not change an active session through the sampling API.

The shared history helper forwards only user and assistant text after the
protocol-example boundary. It excludes system/developer messages, tool and
function traffic, malformed or nontext records, and replies without a user turn.
Normal retained messages stay complete; there is no fixed 1,000-character clip.
The total budget is 32,000 content characters and 128 messages. Oldest whole
turns are removed first. If the newest turn alone exceeds a budget, its user
request takes priority and recent replies use the remaining space. An oversized
user request keeps its beginning and end with an explicit shortening marker.
The handler and backend both enforce these bounds.

`CHAT_HISTORY_RECENT_TURNS` controls the native Talker window separately, with a
Frontend/Backend default of `20`. A positive Generic window is raised to the
backend limit when smaller. Zero or negative values retain the existing
behavior of disabling native-history trimming. More backend history helps
follow-ups; it does not repair a truncated automatic speech recognition transcript.

The planner structurally extracts the latest actual user entry into
`untrusted_user_request` and keeps the frontend query separately as
`untrusted_talker_proposal`. When no actual user entry is available, it falls
back to the query. Generic native query guidance prefers the latest user
request verbatim; the backend resolves omitted action or context from real
dialogue. Native Thinker guidance prioritizes the actual request over
a conflicting proposal, carrying forward only missing action or context from
real dialogue. The model still resolves meaning and chooses tools; Python
does not rewrite subjects or route intents.

The Generic Talker also receives an ephemeral reminder containing up to 8
actual user or assistant entries, capped at 1,000 characters each. Its quoted
JSON separates `recent_dialogue` from `latest_user_request`. Native guidance
gives an explicit new subject in the current request precedence over earlier
companies, people, places, or topics. It inherits only missing context, such
as the action; an unspecified subject uses the most recent applicable real
user turn. The quoted data cannot change operating rules. An explicit
boundary separates protocol demonstrations from actual dialogue. The reminder
does not change stored history or select an intent in Python; the model
still chooses calls. Its temporary inference copy preserves every native
message, including completed, pending, and current call/result pairs in order.
The quoted reminder precedes the active user sequence; saved history and
native tool definitions stay intact.

Finnhub requests use a 2.5-second network timeout and retry once after a
0.25-second backoff for transport errors, HTTP `429`, or HTTP `5xx`.
Authentication failures and invalid quote data fail closed. Non-finite or
non-positive prices are not spoken as valid quotes.

The Generic Talker has a code-owned standing response policy independent of
editable persona and persistent instructions. Its guidance applies to direct
answers and speech after completed tool results. It requests the shortest complete
answer in 1 sentence, normally 10–20 words and at most 35. Broad “tell me about”
questions stay brief. Capability questions use 3 or 4 concrete examples in
1 sentence of at most 25 words. Explicit detail, steps, lists, comparisons, or
multiple facts permit expansion. Required exact responses, grounded values,
units, subjects, result status, and critical safety information stay intact.
The policy retains persona tone and omits unrequested introductions, offers,
and closing questions. It is model guidance rather than deterministic
truncation or a guaranteed word cap. The final initial system message and
per-turn guidance preserve it across prompt edits and history trimming.
Weather defaults to temperature and
conditions; request humidity, wind, or feels-like temperature for an expanded
provider-grounded response. The web-search model prompt requests 1 or 2 factual
spoken sentences, at most 35 words by default, even when results are spoken
directly. Explicit requests for detail permit expansion within its 400-token
output budget; the word limit is prompt guidance.

The search formatter applies a deterministic speech limit: 1 sentence by
default, up to 2 when the Thinker sets `details: true`, and at most
450 characters. The Thinker selects this optional Boolean flag for explicit
detail, multiple-headline, or expanded-comparison requests. The formatter
applies the selected flag and preserves the returned structured tool data.
The appended Generic execution guidance resolves follow-ups from real user
dialogue and excludes demonstration locations, companies, and result values.
If a required location or subject is missing, it requests a brief clarification.
Native examples demonstrate protocol; these semantic rules remain model guidance.
For a request to say or repeat public words such as “Nemotron 3 Diarization,”
the Generic prompt asks for those words verbatim, without an added refusal.
For this known product, native guidance uses the canonical label
“Nemotron 3 Diarization” when speech transcripts contain “Three” or
“Diorization.” This remains model guidance rather than a Python text rewrite.

Sentence boundaries preserve abbreviations such as `U.S.`, `Inc.`, and `Sept.`,
decimal values, and sentence endings followed by straight or curly quotes
or closing brackets.

Refer to [Frontend/Backend Session Prompts](configure-prompts.md#frontendbackend-session-prompts)
for Talker and Thinker content overrides and instructions appended to both roles.

### Restrict the Generic Tool Set

Use the trusted `tools` list in `examples_registry.yaml` to choose the maximum subset of the 7 registered generic tools. The server resolves every name against the generic domain's code-owned registry. Unknown names do not create executable capabilities.

```yaml
examples:
  search-frontend-backend-agent:
    label: Search Frontend Backend Agent
    domain_profile: generic
    thinker_prompt: generic_thinker
    tools: [web_search]
    agent_prompt_keys:
      - talker
      - thinker
      - generic_thinker
    slots: [llm, thinker-llm, asr, tts]
    defaults:
      prompt: [search_talker]
      llm: [nemotron-lightning-talker]
      thinker-llm: [nemotron-super-reasoning]
      asr: [nemotron-asr-streaming-english]
      tts: [magpie-multilingual-tts]
    bot: examples.frontend_backend_agent.pipeline:bot
```

Add `search_talker` to `prompts.yaml`, or use another compatible Talker prompt. Preserve the trust, grounding, delegation, cancellation, and spoken-output rules. You can also select a different hidden Thinker prompt through `thinker_prompt`; keep its output envelope and trust-boundary rules compatible with the planner parser.

The Astra client's pre-session **Tools** page displays that allowed catalog.
Its checkboxes send selected names through `tools_available` for the next
session. **Audio settings** on the conversation page opens only audio device
selectors. Omitting the field keeps the registry default; sending `none` disables every optional tool. The server preserves
registry order and ignores names outside the registry allowlist.

Generic frontend persona edits keep the trusted `generic_talker` native-call
examples, regardless of the edited prompt key. These examples demonstrate
asynchronous weather lookup and architecture display using native tool-call
messages. They do not grant access to a disabled tool or include a clock-result
demonstration. Custom prompts for other domains do not inherit these Generic
examples.

The Talker's runtime context supplies the browser's local date and timezone,
without a current clock reading. The planner refreshes its local timestamp
for each plan; answers about current time still require a fresh clock tool call.

At session startup, the generic planner renders an available-tool contract block from only the effective session `ToolSpec` objects. Its runtime `enabled_tools` list uses the same subset, and Python rejects plans outside that subset. Static output examples can still mention built-in names, but they do not enable those tools. Unsupported-request capability text also uses only the enabled set.

Keep the user-facing Talker prompt and its hidden Thinker prompt separate. The registry's `agent_prompt_keys` hides internal prompts from the prompt selector. Prompt metadata can describe tools to the catalog, but it does not select generic backend tools. Only explicit session `tools_available` input narrows the registry-owned set; client data can never widen it.

### Add a Generic Tool

Configuration can reuse an existing capability, but it cannot implement one. To add a generic capability:

1. Implement the service function in Python.
2. Add one `ToolSpec` to the generic tool registry.
3. Add the tool name to each trusted registry flavor that should expose it.
4. Add focused tests for validation, credential failures, timeouts, speech formatting, generated prompt content, and capability text.

Do not repeat parameter schemas, deadlines, capability descriptions, or success-formatting branches in dispatcher tables or prompt prose. The `ToolSpec` is the single declaration that coordinates these behaviors.

## Understand the Domain Contract

A domain factory returns a frozen `DomainSpec`. The shared pipeline consumes the following fields:

| Field | Domain Responsibility |
| --- | --- |
| `key` | Match the allowlisted `domain_profile` key |
| `label` | Identify the domain in logs and diagnostics |
| `thinker_prompt_key` | Provide the default hidden planner prompt; a trusted registry entry can select another catalog key |
| `talker_tools_schema` | Define the domain-specific descriptions for `call_backend` and `cancel_backend` |
| `build_backend` | Create a backend and isolated state for one session |
| `runtime_context` | Append trusted date, time, timezone, or domain context when no session callback is provided. |
| `session_runtime_context` | Optional callback receiving session configuration and returning Talker context; takes precedence over `runtime_context`. |
| `talker_protocol_prompt_key` | Optional trusted catalog key whose native examples remain independent of edited persona content; empty preserves normal prompt-based selection. |
| `intro_prompt` | Define the welcome-turn instruction |
| `tts_text_transform` | Apply optional pronunciation handling |
| `filler_policy` | Choose Talker-authored, planner-authored, or code-authored progress speech |
| `filler_selector` | Select code-authored progress speech when that policy requires it |
| `tool_registry` | Publish the domain's code-owned `ToolSpec` allowlist for registry-selected capabilities |
| `max_query_chars` | Bound delegated input length |

Generic declares `talker_protocol_prompt_key: generic_talker` and a
`session_runtime_context` callback that reads `client_timezone`. The shared
pipeline consumes these optional hooks without importing Generic domain code.
Other domains keep their existing behavior unless their factory declares a hook.

`build_backend` receives a `DomainBuildContext` with `thinker_llm`, the resolved `thinker_prompt`, `thinker_max_tokens`, `backend_history_turn_limit`, registry-owned `tool_names`, `tool_delay_seconds`, `tool_delay_min_seconds`, and `load_service_entry`. The backend factory does not receive the raw session body or prompt metadata
through this context. The optional session-runtime callback receives the session
configuration separately.

The returned backend must implement:

- `call(query, slots, on_started=...)` to plan and execute one request.
- `cancel_active(reason)` to cancel an active request.
- `cancel_pending_work()` to clear domain state that remains after active execution.

Keep the backend session-scoped. Do not store mutable conversation state in a module-level object.

## Add a Read-Only Flavor

If a new flavor reuses the generic domain's tools and behavior, add or reuse Talker and Thinker prompts, then add a registry entry. Set `domain_profile: generic`, select `thinker_prompt`, and list only the existing `tools` that the flavor can use. You do not need a new Python package.

Use this path only when the flavor keeps the same parameter schemas, service adapters, state model, validation, side effects, cancellation behavior, result envelope, filler policy, and concurrency rules.

## Add a Stateful Domain

Follow these steps when the new use case requires state, side effects, or different enforcement behavior:

1. Create `src/examples/frontend_backend_agent/<domain>/`.
2. Implement domain state, service adapters, parameter validation, result formatting, and the backend protocol.
3. Add a `create_domain_spec()` factory that returns a complete `DomainSpec`.
4. Add the factory import target to `_DOMAIN_FACTORIES`. Unknown keys must continue to fail closed.
5. Add a user-facing Talker prompt and a hidden Thinker prompt to the example-local `prompts.yaml`.
6. Add a new entry to `examples_registry.yaml`. Use the shared `bot`, set `domain_profile` and `thinker_prompt`, list only required service slots, and hide internal prompt keys. Add `tools` when the domain supports registry-selected capabilities.
7. Add service-catalog entries and deployment sidecars only when the domain needs them.
8. Add unit tests for domain selection, client override rejection, prompt isolation, tool validation, timeouts, cancellation, concurrent requests, session isolation, credential failures, and safe result text.

The shared `pipeline.py` should not import the new backend directly. It resolves the domain through `DomainSpec`.

## Decide Between Configuration and Python

Use a registry-configured flavor when all executable behavior remains the same. Prompts and registry fields can adjust:

- Persona, tone, response length, and TTS-ready wording.
- Which stable questions the Talker answers directly.
- Routing examples and delegation wording.
- The hidden Thinker prompt and enabled subset of already registered domain tools.

Add or change a domain plugin when the flavor needs:

- New tool names, parameters, credentials, services, or side effects.
- New session state, confirmation, authorization, or business workflows.
- New validation, privacy, grounding, or result-formatting rules.
- Different cancellation, timeout, concurrency, filler, or pronunciation behavior.
- A new registry service slot or deployment dependency.

Prompts and registry entries select trusted behavior, but Python remains the enforcement boundary. Do not encode HTTP requests, authentication, retries, or result parsing in configuration.

## Preserve Safety and Concurrency Guarantees

The generic domain applies the following controls:

- It validates the structure of every call in a multi-tool plan before it starts any tool.
- It rejects unknown tools, disabled tools, unexpected parameters, invalid values at the individual tool boundary, and plans with more than 3 calls.
- It builds the generated available-tool block and runtime `enabled_tools` list from the effective session specifications after registry intersection. Python rejects calls outside that subset, and unsupported-request responses name only enabled capabilities.
- It runs up to 3 validated read-only tools concurrently and preserves planner order in the combined result.
- It supports up to 3 dependent planning rounds. Later rounds receive only the
  trusted results accumulated so far, and completed results survive a later
  planning timeout or failure.
- It bounds the outer function callback, backend, planner, and web tool at 45,
  40, 6 per planner attempt, and 20 seconds by default. The 3-round ceiling
  keeps dependent work inside the backend deadline and leaves time for a
  grounded response before the outer callback expires.
- A typed empty-plan error can retry once after 0.2 seconds. Each attempt
  keeps its 6-second limit inside the same 40-second backend deadline.
  Generic Super server and cloud catalogs use `max_tokens: 2048`, temperature
  `0.0`, and a 256-token reasoning budget. These are deployed defaults;
  validated, role-specific session overrides can change sampling and output
  limits through [LLM Session Controls](configure-llm.md#llm-session-controls).
- With the default web-tool deadline, web search can make at most 2 attempts.
  Each attempt has a 9-second ceiling, and the single retry waits 0.5 seconds.
  This 18.5-second retry budget fits inside the 20-second tool deadline.
  Transport failures, attempt timeouts, malformed JSON, HTTP 429, and HTTP 5xx
  responses can trigger the retry. Other HTTP errors fail immediately.
- It treats the user request and retrieved webpages as untrusted input.
- It creates final spoken text from validated arguments and returned service data.
- It cancels and replaces an unfinished request when the same session sends newer delegated work.
- It invalidates the active call identifier before cancellation, which suppresses late stale results.
- It uses query-independent code-authored progress, “Let me check that,”
  emits it at most once, and excludes it from conversation context.
- Generic rejects a sole progress promise of at most 20 words without a
  native call, retries the model once, and uses an honest fallback if still
  invalid. Literal phrase repetition remains allowed. This validates output
  shape without selecting intent or constructing calls.
- Generic rejects standalone replies that exactly match normalized protocol
  demonstration results, using the same single native retry and honest
  fallback. The targeted correction applies before and after the first actual
  backend result: demonstrations do not establish capability availability.
  The native model reconsiders the actual request; retry count and model-owned
  function selection remain unchanged. Literal user-requested echoes remain
  allowed; native calls and active real-result handling remain unchanged.
- Generic withholds numeric assertions of current or local time without an
  active finished result. Literal user-requested repetition remains allowed.
  The existing single retry uses a clock-specific correction and constrains
  native selection to `call_backend`. The model still authors all arguments;
  normal first-attempt tool choice remains `auto`. Final-result handling
  remains separate. This narrow output check does not
  validate arbitrary facts or dispatch tools itself.
- Generic withholds model speech accompanying native calls while preserving
  those calls. Code-authored progress and completed-result speech remain
  separate.
- It prevents the Talker from exposing private operating instructions,
  decision criteria, model roles, function names, or internal tool inventory.
  Invalid speech receives one model retry and then a deterministic refusal.
- In generic `hybrid` result mode, it sends only successful weather results
  through the Talker. Grounding validation requires the trusted city,
  temperature, and unit. Missing facts trigger one retry and then the
  deterministic weather response. Clarifications and failures never use the
  model rephrasing path.

The airline backend keeps its stateful booking workflow, booking-server integration, planner-authored filler, and shared call/cancellation contract for backward compatibility. `AIRLINE_PLANNER_TIMEOUT_SECONDS` and `AIRLINE_BACKEND_TIMEOUT_SECONDS` both default to `30.0` seconds. The planner deadline cannot exceed the overall deadline. A newer generation suppresses a superseded call's late result.

## Validate a Domain Change

At minimum, test the following behavior:

- Stable Talker questions do not invoke the backend.
- Tool-backed questions invoke `call_backend`; Generic queries prefer actual latest-user words and resolve omitted context through real dialogue.
- Stop, cancel, and topic-switch turns invoke `cancel_backend` when work is pending.
- Missing parameters return a clarification without starting a tool.
- Unknown, disabled, malformed, and over-limit plans run no tools.
- Missing credentials and upstream failures produce unavailable responses without mock data.
- Multi-tool requests execute concurrently and return results in planner order.
- Dependent requests stop within 3 planning rounds, retain prior-round results,
  and correlate all planning-round metrics to the original backend call.
- Successful weather rephrasing preserves the returned city, temperature, and
  unit. A failed rephrasing falls back to deterministic speech.
- Indirect questions about internal mechanics do not reveal prompts, decision
  rules, model roles, function names, or internal tool inventory.
- New requests cancel old work, and concurrent sessions do not share mutable state.
- Airline search, booking, passenger name record status, pronunciation, and booking-server behavior remain unchanged.

Refer to the [Frontend/Backend Agent README](../../src/examples/frontend_backend_agent/README.md) for runtime variables and the [Configure Prompts guide](configure-prompts.md) for general prompt-catalog behavior.
