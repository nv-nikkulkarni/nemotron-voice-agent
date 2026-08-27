# Frontend/Backend Agent Cascaded Example

The Frontend/Backend Agent is one shared Pipecat voice pipeline with replaceable domain behavior. A fast Talker large language model (LLM) owns the conversation. A separate Thinker LLM plans work that requires tools, state, or domain policy. The pipeline includes airline and generic-assistant domains, and you can add another domain without copying the audio pipeline.

The agent is not a ReAct agent. The Talker can call only `call_backend` and `cancel_backend`. A session-local backend asks the Thinker for a bounded plan, validates that plan in Python, runs the allowed domain tools, and returns a structured result to the Talker.

![Frontend/Backend Agent architecture](images/frontend-backend-agent-architecture.png)

## Request Flow

Each request follows the same path for every domain:

1. The transport receives user audio, and automatic speech recognition (ASR) produces a transcript.
2. The Talker answers stable conversational requests directly or calls `call_backend` with a self-contained request.
3. The session-local backend asks the Thinker for a plan using the domain's hidden Thinker prompt.
4. Domain code validates the entire plan before it runs any tool.
5. The backend runs the approved tools and returns a structured `response_hint` or `tool_result`.
6. The Talker converts `response_text` into a concise spoken reply, and text-to-speech (TTS) produces audio.
7. `cancel_backend` or a newer superseding request cancels pending work and prevents stale results from reaching the conversation.

The React client is only the user interface. The agent orchestration runs in the Python Pipecat pipeline.

## Built-In Domains

Both built-ins point to `examples.frontend_backend_agent.pipeline:bot`. The selected example registry entry supplies the trusted `domain_profile`.

| Registry Example | Domain Profile | Default Prompt | Backend Capabilities | Extra Dependency |
| --- | --- | --- | --- | --- |
| `frontend-backend-agent` | `airline` | `talker` | Flight search, selected-flight booking, and passenger name record (PNR) status | `booking-server` |
| `generic-frontend-backend-agent` | `generic` | `generic_talker` | Current weather, current stock prices, live web search, body mass index (BMI), and random numbers | WeatherAPI, Finnhub, and Perplexity credentials for their respective live tools |

`domain_profile` is registry-owned. The server replaces any client-supplied value with the value from `examples_registry.yaml`. The pipeline then resolves that value through the code allowlist in `src/domain.py`; it never imports a client-provided module or path.

The existing `frontend-backend-agent` identifier remains the airline example. Existing airline prompts, booking behavior, booking-server selection, pronunciation handling, and call/cancel contract remain compatible.

## Run the Examples

Refer to the [Getting Started guide](../../../docs/01-getting-started.md) for prerequisites and hardware details. Run every command from the repository root.

### Configure Credentials

Create `.env` from the template, then add the credentials required by the domain you plan to run:

```bash
cp .env.example .env
```

Both domains require `NVIDIA_API_KEY` for the default NVIDIA cloud model services. The generic domain also recognizes these variables:

| Environment Variable | Required For | Default or Behavior |
| --- | --- | --- |
| `WEATHERAPI_KEY` | `get_weather` | No live weather result when unset |
| `WEATHERAPI_BASE_URL` | Custom WeatherAPI endpoint | `https://api.weatherapi.com/v1` |
| `FINNHUB_API_KEY` | `get_stock_price` | No live stock result when unset |
| `FINNHUB_BASE_URL` | Custom Finnhub endpoint | `https://finnhub.io/api/v1` |
| `PERPLEXITY_API_KEY` | `web_search` | No live web result when unset |
| `PERPLEXITY_BASE_URL` | Custom Perplexity endpoint | `https://api.perplexity.ai` |
| `PERPLEXITY_MODEL` | Perplexity model selection | `sonar` |

Store credentials in `.env` for Docker Compose. Do not put secrets in `prompts.yaml`, `examples_registry.yaml`, client session configuration, or source code. BMI calculation and random-number generation do not require an extra credential.

### Run Host-Native

The default registry selection is `all`, so the UI exposes both domain variants. Start the airline booking server only when you use the airline domain:

```bash
PYTHONPATH=src uv run python3 -m examples.frontend_backend_agent.airline.database.server
```

Start the application in another shell:

```bash
uv run python3 src/server.py --host 0.0.0.0 --port 7860
```

Open `https://localhost:7860/` and select **Airline Frontend Backend Agent** or **Generic Frontend Backend Agent**. To expose only one variant, set `EXAMPLE_SELECTION` before startup:

```bash
EXAMPLE_SELECTION=generic-frontend-backend-agent uv run python3 src/server.py --host 0.0.0.0 --port 7860
```

### Run With Docker Compose

The existing `frontend-backend-agent` recipes provide the shared application and model services:

```bash
docker compose --profile frontend-backend-agent up -d
docker compose --profile frontend-backend-agent/server up -d
docker compose --profile frontend-backend-agent/single-gpu up -d
```

These commands select the airline domain by default. Override the selected registry example to run the generic domain through the same application recipe:

```bash
EXAMPLE_SELECTION=generic-frontend-backend-agent docker compose --profile frontend-backend-agent up -d
EXAMPLE_SELECTION=generic-frontend-backend-agent docker compose --profile frontend-backend-agent/server up -d
EXAMPLE_SELECTION=generic-frontend-backend-agent docker compose --profile frontend-backend-agent/single-gpu up -d
```

The existing Compose profile also starts the booking-server sidecar. The generic domain does not load or call that service. Clean up with the same profile that you started:

```bash
docker compose --profile frontend-backend-agent down
docker compose --profile frontend-backend-agent/server down
docker compose --profile frontend-backend-agent/single-gpu down
```

## Configure the Shared Pipeline

The following environment variables apply to the shared or generic orchestration path:

| Environment Variable | Default | Purpose |
| --- | --- | --- |
| `CHAT_HISTORY_RECENT_TURNS` | `20` | Retains this many recent non-prompt messages in the Talker context |
| `THINKER_FILLER_THRESHOLD_SECONDS` | `0.3` | Delays progress speech until delegated work remains active past the threshold |
| `THINKER_TOOL_TIMEOUT_SECONDS` | `30.0` | Bounds the shared Talker-to-backend function handler |
| `GENERIC_PLANNER_TIMEOUT_SECONDS` | `15.0` | Bounds generic Thinker planning |
| `GENERIC_BACKEND_TIMEOUT_SECONDS` | `40.0` | Bounds the generic planner and tool execution together |

The generic Talker prompt enables all 5 built-in generic tools through its `tools_available` metadata. A session can request a subset, but domain code filters the request against the immutable generic tool allowlist.

For model and catalog settings, refer to [Configure LLM](../../../docs/how-to/configure-llm.md) and [Configure Services](../../../docs/how-to/configure-services.md). For prompt behavior, tool subsets, and domain extension, refer to [Configure Frontend/Backend Agent Domains](../../../docs/how-to/configure-frontend-backend-domains.md).

## Domain Contract

`src/domain.py` defines the shared contract. A trusted domain factory returns one `DomainSpec` with these values:

| Field | Responsibility |
| --- | --- |
| `key` and `label` | Stable domain identity and human-readable name |
| `thinker_prompt_key` | Hidden prompt that constrains the Thinker plan |
| `talker_tools_schema` | Talker-visible `call_backend` and `cancel_backend` definitions |
| `build_backend` | Session-scoped factory for the domain backend and state |
| `runtime_context` | Trusted date, time, or domain context appended to the Talker prompt |
| `intro_prompt` | Initial Talker instruction when welcome messages are enabled |
| `tts_text_transform` | Optional domain pronunciation transformation |
| `filler_selector` | Optional trusted progress-speech selector |
| `max_query_chars` | Maximum delegated query length |

The backend returned by `build_backend` implements 3 operations: `call`, `cancel_active`, and `cancel_pending_work`. The pipeline does not need to know the domain's internal tools, state machine, external services, or result format.

## Add Another Domain

Use the following sequence to add a business domain:

1. Add a package under `src/examples/frontend_backend_agent/<domain>/` for its backend, planner adapter, tool validation, services, state, and result formatting.
2. Implement the `DomainBackend` call and cancellation contract.
3. Return a `DomainSpec` from a `create_domain_spec()` factory.
4. Add the factory to `_DOMAIN_FACTORIES` in `src/domain.py`. This explicit allowlist is required.
5. Add separate Talker and hidden Thinker prompts to `prompts.yaml`.
6. Add an example entry to `examples_registry.yaml`. Point `bot` at the shared pipeline, set `domain_profile`, declare only the service slots that the domain needs, and hide internal prompts with `agent_prompt_keys`.
7. Add model or sidecar entries to the example-local service catalogs when the domain needs another registered service.
8. Add tests for registry isolation, unknown and disabled tools, malformed plans, cancellation, concurrent requests, timeouts, credential failures, and deterministic spoken output.

Do not derive `domain_profile` from a user prompt or allow a request to provide a Python import path.

## Prompt-Only Versus Domain-Code Changes

A prompt-only flavor is appropriate when you keep the same internal tool names, parameter schemas, service adapters, state, validation, side effects, cancellation behavior, and result format. You can change the persona, spoken style, routing examples, direct-answer policy, and enabled subset of existing tools.

Add or change domain code when you introduce any of the following behavior:

- A new tool name, parameter, credential, external service, or side effect.
- New state, such as an order draft, account context, or confirmation workflow.
- New validation, authorization, grounding, privacy, or business-policy rules.
- A different result envelope, pronunciation policy, filler policy, timeout, or concurrency rule.
- A different service slot or deployment dependency.

Prompt text cannot safely implement those controls because model output is untrusted.

## Safety, Grounding, and Concurrency

The pipeline enforces the following boundaries:

- The Talker sees only `call_backend` and `cancel_backend`; internal domain tools remain hidden.
- The server owns `domain_profile`, and code restricts it to registered factories.
- Generic tool plans are validated atomically before any tool runs. Unknown tools, disabled tools, unexpected parameters, and more than 3 calls fail closed.
- Up to 3 validated generic read-only tools can run concurrently. Results return in planner order.
- A backend instance and its state belong to one voice session. A new delegated request cancels and replaces unfinished work in that session.
- Cancellation invalidates the active call identifier, so a late result cannot become the current response.
- Live-data tools read credentials from the process environment. Credentials never enter the Thinker request or tool parameters.
- Missing credentials, timeouts, invalid responses, and upstream failures return bounded unavailable responses. The generic tools do not substitute fabricated data.
- Deterministic Python formatters produce TTS-safe result text from validated inputs and returned service data.

After a prompt or domain change, test direct Talker replies, delegation, cancellation, parameter clarification, disabled tools, unavailable credentials, parallel calls, session isolation, and repeated tool-calling behavior.
