# Configure Frontend/Backend Agent Domains

Use a Frontend/Backend Agent domain when you want to keep one real-time voice pipeline and replace the task-specific backend. The repository includes airline and generic domains.

## Understand the Shared Architecture

The shared Pipecat pipeline separates low-latency conversation from slower task execution:

1. The Talker LLM receives the transcript and conversation history.
2. The Talker answers stable conversational questions directly.
3. For domain work, the Talker emits `call_backend`. It emits `cancel_backend` when the user withdraws pending work.
4. A session-local backend sends the self-contained request to the hidden Thinker prompt.
5. Python validates the Thinker plan and runs only registered domain tools.
6. The backend returns structured response text to the Talker.
7. The Talker produces the final text-to-speech (TTS) response.

The Talker sees only 2 functions. Internal functions, credentials, backend state, and tool results remain behind the domain boundary. The Thinker produces a bounded plan; the implementation does not use a ReAct observe-and-replan loop.

## Choose a Built-In Domain

The following registry entries use the same `examples.frontend_backend_agent.pipeline:bot` implementation:

| Registry Example | `domain_profile` | User-Facing Prompt | Hidden Thinker Prompt | Domain Services |
| --- | --- | --- | --- | --- |
| `frontend-backend-agent` | `airline` | `talker` | `thinker` | Booking server for flight search, booking, and passenger name record (PNR) status |
| `generic-frontend-backend-agent` | `generic` | `generic_talker` | `generic_thinker` | WeatherAPI, Finnhub, Perplexity Sonar, local BMI calculation, and local random-number generation |

The server reads `domain_profile` from the selected registry entry and overwrites a client-supplied value. It also returns the value as `domainProfile` in example metadata. Domain resolution uses the fixed `_DOMAIN_FACTORIES` allowlist in `src/examples/frontend_backend_agent/src/domain.py`.

This design prevents a client from changing the backend domain independently of the selected example or requesting an arbitrary Python module.

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

For a local model deployment on a workstation, use:

```bash
EXAMPLE_SELECTION=generic-frontend-backend-agent docker compose --profile frontend-backend-agent/workstation up -d
```

The Compose profile still starts the booking server. The generic backend does not load or call it because its registry entry does not include the `booking-server` slot.

## Configure Generic Tools

The `generic_talker` prompt enables these internal tools through `tools_available` metadata:

| Tool | Purpose | Credential | Important Boundary |
| --- | --- | --- | --- |
| `get_weather` | Current conditions for a city or location | `WEATHERAPI_KEY` | Does not provide forecasts or historical weather |
| `get_stock_price` | Current public-company quote | `FINNHUB_API_KEY` | Does not provide predictions, crypto, commodities, or historical prices |
| `web_search` | Current or externally verifiable information | `PERPLEXITY_API_KEY` | Requests concise spoken text without URLs and strips numeric citation markers |
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

Do not pass credentials through `call_backend`, Thinker plans, prompt text, or client session configuration. Each service reads its credential directly from the process environment.

When a credential is absent, the service returns an unavailable result. It does not use sample data or a stale fallback. This lets the Talker report the failure without presenting fabricated live information.

### Restrict the Generic Tool Set

Use `tools_available` to choose a subset of the 5 registered generic tools. Duplicate the complete `generic_talker` prompt before changing its metadata or persona. Preserve its trust, grounding, delegation, cancellation, and spoken-output rules. For example, change this metadata in the copy:

```yaml
tools_available:
  - web_search
```

The domain filters the selected names against its immutable allowlist, removes duplicates, and preserves order. A prompt or client cannot add an unregistered tool by naming it in `tools_available`.

Keep the user-facing Talker prompt and its hidden Thinker prompt separate. The registry's `agent_prompt_keys` hides internal prompts from the prompt selector.

## Understand the Domain Contract

A domain factory returns a frozen `DomainSpec`. The shared pipeline consumes the following fields:

| Field | Domain Responsibility |
| --- | --- |
| `key` | Match the allowlisted `domain_profile` key |
| `label` | Identify the domain in logs and diagnostics |
| `thinker_prompt_key` | Select a required hidden planner prompt |
| `talker_tools_schema` | Define the domain-specific descriptions for `call_backend` and `cancel_backend` |
| `build_backend` | Create a backend and isolated state for one session |
| `runtime_context` | Append trusted date, time, timezone, or domain context |
| `intro_prompt` | Define the welcome-turn instruction |
| `tts_text_transform` | Apply optional pronunciation handling |
| `filler_selector` | Select optional trusted progress speech |
| `max_query_chars` | Bound delegated input length |

`build_backend` receives a `DomainBuildContext` with the Thinker LLM, hidden prompt, selected session configuration, prompt tool metadata, timing values, and a service-catalog resolver.

The returned backend must implement:

- `call(query, slots, on_started=...)` to plan and execute one request.
- `cancel_active(reason)` to cancel an active request.
- `cancel_pending_work()` to clear domain state that remains after active execution.

Keep the backend session-scoped. Do not store mutable conversation state in a module-level object.

## Add a Domain

Follow these steps to add a domain without changing the shared audio pipeline:

1. Create `src/examples/frontend_backend_agent/<domain>/`.
2. Implement domain state, service adapters, parameter validation, result formatting, and the backend protocol.
3. Add a `create_domain_spec()` factory that returns a complete `DomainSpec`.
4. Add the factory import target to `_DOMAIN_FACTORIES`. Unknown keys must continue to fail closed.
5. Add a user-facing Talker prompt and a hidden Thinker prompt to the example-local `prompts.yaml`.
6. Add a new entry to `examples_registry.yaml`. Use the shared `bot`, set `domain_profile`, list only required service slots, and hide internal prompt keys.
7. Add service-catalog entries and deployment sidecars only when the domain needs them.
8. Add unit tests for domain selection, client override rejection, prompt isolation, tool validation, timeouts, cancellation, concurrent requests, session isolation, credential failures, and safe result text.

The shared `pipeline.py` should not import the new backend directly. It resolves the domain through `DomainSpec`.

## Decide Between a Prompt and a Plugin

Use a prompt-only flavor when all executable behavior remains the same. Prompt-only changes can adjust:

- Persona, tone, response length, and TTS-ready wording.
- Which stable questions the Talker answers directly.
- Routing examples and delegation wording.
- The enabled subset of already registered domain tools.

Add or change a domain plugin when the flavor needs:

- New tool names, parameters, credentials, services, or side effects.
- New session state, confirmation, authorization, or business workflows.
- New validation, privacy, grounding, or result-formatting rules.
- Different cancellation, timeout, concurrency, filler, or pronunciation behavior.
- A new registry service slot or deployment dependency.

Prompts guide model behavior, but Python remains the enforcement boundary.

## Preserve Safety and Concurrency Guarantees

The generic domain applies the following controls:

- It validates the structure of every call in a multi-tool plan before it starts any tool.
- It rejects unknown tools, disabled tools, unexpected parameters, invalid values at the individual tool boundary, and plans with more than 3 calls.
- It runs up to 3 validated read-only tools concurrently and preserves planner order in the combined result.
- It bounds planner, backend, and individual tool execution with timeouts.
- It treats the user request and retrieved webpages as untrusted input.
- It creates final spoken text from validated arguments and returned service data.
- It cancels and replaces an unfinished request when the same session sends newer delegated work.
- It invalidates the active call identifier before cancellation, which suppresses late stale results.

The airline backend keeps its stateful booking workflow and booking-server integration while conforming to the same shared call and cancellation contract.

## Validate a Domain Change

At minimum, test the following behavior:

- Stable Talker questions do not invoke the backend.
- Tool-backed questions invoke `call_backend` with a self-contained request.
- Stop, cancel, and topic-switch turns invoke `cancel_backend` when work is pending.
- Missing parameters return a clarification without starting a tool.
- Unknown, disabled, malformed, and over-limit plans run no tools.
- Missing credentials and upstream failures produce unavailable responses without mock data.
- Multi-tool requests execute concurrently and return results in planner order.
- New requests cancel old work, and concurrent sessions do not share mutable state.
- Airline search, booking, passenger name record status, pronunciation, and booking-server behavior remain unchanged.

Refer to the [Frontend/Backend Agent README](../../src/examples/frontend_backend_agent/README.md) for runtime variables and the [Configure Prompts guide](configure-prompts.md) for general prompt-catalog behavior.
