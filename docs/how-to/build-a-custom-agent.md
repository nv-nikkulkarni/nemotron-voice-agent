# Build a Custom Agent

Build your own voice agent from a short chat, save it as a YAML file, and load it again later. The **Build Your Own Agent** page in the Astra client talks to the agent builder service, a small CPU-only service that turns your description into a validated agent configuration.

This guide covers the browser workflow, the agent configuration file, and the builder service reference.

## How It Works

A custom agent is not a new pipeline. It runs as the `multilingual-generic-frontend-backend-agent` example, with your choices of language, models, speech services, tools, and persona applied to one session. The voice agent code does not change.

The builder maps your configuration to session-config fields that the voice agent already accepts:

| Agent configuration field | Session-config field |
|---|---|
| `base_example` | `pipeline_mode` (always `multilingual-generic-frontend-backend-agent`) |
| Fixed value | `example_variant` (`multilingual`) |
| `language` | `asr_language_code` |
| `models.talker` | `llm_id` |
| `models.backend` | `thinker_llm_id` |
| `tools` | `tools_available` (a comma-separated list, or `none` when empty) |
| `speech.asr`, `speech.tts`, `speech.voice` | `asr_id`, `tts_id`, `tts_voice_id` (sent only when set) |
| `speech.pronunciations` | `tts_pronunciations` (sent only when set) |
| `persona`, `name` | `persistent_prompt`, a persona block appended to the Talker and Thinker prompts |

The persona block adjusts voice, domain, and emphasis only. It states that the safety, tool, delegation, and spoken-output rules of the example still apply. Tools can only narrow the example allow-list. The server drops any tool that the example does not declare.

## Prerequisites

- A deployment of the Astra client with the builder enabled. Refer to [Enable the Builder in the UI Container](#enable-the-builder-in-the-ui-container).
- The `multilingual-generic-frontend-backend-agent` example available in the deployment. The fourth card does not appear without it.

## Build an Agent in the Browser

1. Open the landing page. The **Build Your Own Agent** card appears after the three example cards.
2. Select the card to open the **Build your own agent** page (`/custom`).
3. Describe the agent in the chat. For example, "A friendly travel guide for India that speaks Hindi." Messages are limited to 500 characters.
4. Watch the animated schematic update as the builder sets the persona, language, models, voice, and tools. Notes about values that the deployment does not offer appear under the schematic.
5. Select **Start your agent** after the builder marks the agent ready. An agent is ready when it has a persona role, a Talker model, and a backend model.

The page offers these actions:

- **Save as YAML** downloads the current draft as `<name>.agent.yaml`.
- **Load YAML** reads a saved file into the builder session. Refer to [Save and Load an Agent](#save-and-load-an-agent).
- **Start your agent** validates the draft and starts a session with the resulting session configuration.

The builder only discusses building your agent. It replies with a fixed message to off-topic or refused requests.

## Save and Load an Agent

The agent file is a YAML document. The client accepts `.yaml`, `.yml`, and `.json` files of up to 64 KB. A file never contains keys or secrets.

When you select **Load YAML**, the builder checks every value against what the deployment offers. It replaces an unavailable value with the catalog default and lists the change as a note, so a loaded file is never silently changed. The builder also moderates the persona text of a loaded file and rejects the file if the check fails. A loaded file replaces the draft and clears the chat history of the session.

To export an existing example, select the example card, then select **Save agent** on the launch bar. The file captures the example's selected language, models, speech services, voice, pronunciations, and tools. The persona role is the example title. **Save agent** appears only when the builder is enabled.

## Agent Configuration Schema

The schema identifier is `nemotron-voice-agent/agent-config` and the version is `1`. The following example shows every field:

```yaml
schema: nemotron-voice-agent/agent-config
version: 1
name: Travel Guide
base_example: multilingual-generic-frontend-backend-agent
language: hi-IN
persona:
  name: Aarav
  role: A travel guide for India
  tone: friendly
  about: Helps visitors plan trips.
  always:
    - Suggest one local food to try
  never:
    - Give medical advice
models:
  talker: <talker model id from the catalog>
  backend: <backend model id from the catalog>
speech:
  asr: <speech recognizer id from the catalog>
  tts: <voice engine id from the catalog>
  voice: <voice id from the catalog, or empty for the default voice>
  pronunciations: {}
tools: []
```

The following table describes each field and its limits:

| Field | Description |
|---|---|
| `schema`, `version` | Must be `nemotron-voice-agent/agent-config` and `1`. The client rejects other values. |
| `name` | Agent name, up to 60 characters. |
| `base_example` | Always runs as `multilingual-generic-frontend-backend-agent`. A different value produces a note. |
| `language` | A language code from the catalog. A different region of an available language maps to the catalog code. The default is `en-US` when available. |
| `persona.name` | Persona name, up to 60 characters. |
| `persona.role` | Role and domain, up to 200 characters. Required. |
| `persona.tone` | One of `friendly`, `professional`, `playful`, `calm`, `concise`, or `enthusiastic`. |
| `persona.about` | Background text, up to 1,000 characters. |
| `persona.always`, `persona.never` | Up to 5 rules each, up to 120 characters per rule. |
| `models.talker` | A Talker model id from the catalog. Required. The builder warns when the Talker does not speak the language. |
| `models.backend` | A backend (Thinker) model id from the catalog. Required. |
| `speech.asr`, `speech.tts` | Speech recognizer and voice engine ids from the catalog. |
| `speech.voice` | A voice id from the catalog. The builder drops a voice whose language differs from `language` and uses the default voice. |
| `speech.pronunciations` | Word-to-IPA rules, up to 50, validated with the voice agent's limits. |
| `tools` | Tool names from the catalog. An empty list starts the agent without tools. |

The builder removes control characters, Markdown, and angle-bracket markup from text fields and joins them into a single paragraph.

## Agent Builder Service Reference

The service is the Python package `src/agent_builder/`. Its image is built from `docker/Dockerfile.agent-builder`. It needs no GPU.

### Run the Service

The container listens on port `7870` as a non-root user and starts the app with `uvicorn --factory`:

```bash
uvicorn agent_builder.app:app_factory --factory --host 0.0.0.0 --port 7870
```

Build the image from the repository root. The Dockerfile header lists the build and run commands:

```bash
docker build --platform linux/amd64 -f docker/Dockerfile.agent-builder -t agent-builder .
```

### Environment Variables

`Settings.from_env` reads these variables. Set secrets in the container environment and never commit them.

| Variable | Required | Description |
|---|---|---|
| `BUILDER_LLM_URL` | Yes | OpenAI-compatible base URL of the builder model. The service appends `/chat/completions`. |
| `BUILDER_LLM_API_KEY` | Yes | API key for the builder model. Sent as a bearer token and never returned to the browser. |
| `BUILDER_LLM_MODEL` | No | Model name. Defaults to `nvidia/nemotron-3.5-super-vl-120b-a12b`. |
| `BUILDER_LLM_FUNCTION_VERSION_ID` | No | NVCF function version. When set, the service sends it in the `nvcf-function-version-id` header. |
| `VOICE_AGENT_URL` | Yes | Base URL of the voice agent. The service reads the catalog from its `/api/services`, `/api/tools`, and `/api/tts-config` endpoints. |
| `BUILDER_RATE_LIMIT_PER_MINUTE` | No | Requests per minute for each client. Defaults to `20`. |
| `AGENT_BUILDER_SIGNING_KEY` | No | Shared secret that signs each persona the builder approves. Set the same value on the voice agent (as an NVCF function secret or environment variable). The voice agent then drops any `persistent_prompt` without a valid `persona_token`, so a browser cannot skip the builder's checks. When unset, the voice agent accepts any persona. |

The service caches the catalog for 10 minutes. If a refresh fails, it keeps serving the previous catalog.

### API

All endpoints are under `/builder-api/` and exchange JSON data only. A request that exceeds the rate limit returns HTTP 429. If the catalog is unavailable, the service returns HTTP 503.

| Method and path | Request body | Response |
|---|---|---|
| `GET /builder-api/health` | None | `{"status": "ok"}` |
| `GET /builder-api/catalog` | None | Languages, Talker models (with languages), backend models, speech recognizers, voice engines, voices, tools, and tones. |
| `POST /builder-api/session` | `{}` | `session_id`, a greeting in `reply`, `catalog`, and the draft state. Returns HTTP 503 when the session store is full. |
| `POST /builder-api/turn` | `session_id`, `message` | `reply`, `intent`, and the draft state. |
| `POST /builder-api/validate` | `config` | The draft state plus `errors`. Includes `session_config` when there are no errors and the agent is ready. |
| `POST /builder-api/load` | `session_id`, `config` | The same response as `validate`. With no errors, the draft replaces the session draft and the history clears. |

The draft state is made of four fields: `draft_config`, `missing` (the fields still needed), `ready`, and `warnings`. The `intent` value is one of `build`, `clarify`, `off_topic`, or `refused`. An unknown or expired session returns HTTP 404.

### Builder Model Behavior

The service calls the standalone Super VL NVCF function through the OpenAI-compatible chat endpoint. Reasoning is on with `low` effort and a 3,000-token budget. If that call fails or returns unusable output, the service retries once with reasoning off and a 1,200-token budget. The response must match a JSON schema, and the schema limits the model to catalog ids.

The builder system prompt, model, sampling, JSON schema, and chat history stay on the server. The browser never receives the prompt or the key. The client cannot supply or rewrite history.

### Guardrails

The service applies these checks on every turn:

- **Input limits.** A message is cleaned to plain text of up to 500 characters. The request body accepts up to 2,000 characters.
- **Injection check.** A pattern check rejects attempts to read or override the builder instructions.
- **Moderation.** A model pass classifies the message. One refusal is confirmed by two more votes, and the message is refused only if at least one agrees. The pass fails closed when the model is unavailable.
- **Persona checks.** When the persona text changes, the service labels each field, applies the injection check and a prompt-echo check, and moderates the text. Labels make a "never" rule read as a prohibition and not an instruction. The service also replaces a model reply that echoes the system prompt.
- **Catalog-constrained output.** Models, voices, languages, speech services, and tools are enums drawn from the live catalog.
- **Session limits.** Sessions are in memory, expire 30 minutes after last use, and the store holds up to 500. Each session allows 40 turns and 5 refusals, keeps the last 12 history messages in each request, and returns HTTP 429 after a limit.
- **Rate limit.** Each client address is limited per minute by `BUILDER_RATE_LIMIT_PER_MINUTE`.
- **Fixed replies.** Off-topic and refused turns return fixed text, not model text. The service logs the reason for each refusal with the event `builder_refusal`.

### Enable the Builder in the UI Container

Set `BUILDER_ORIGIN` on the Astra UI container to the cluster-internal URL of the builder service. The entrypoint (`docker/nvcf-ui-entrypoint.sh`) then:

- Writes an nginx `/builder-api/` proxy that allows 30 requests per minute for each client with a burst of 10, returns HTTP 429 over the limit, caps request bodies at 16 KB, and strips cookies.
- Sets `builderEnabled: true` in `config.js`, which shows the fourth landing card and the **Save agent** button.

Behind a router or load balancer, set `NGINX_REAL_IP_FROM` to its comma-separated CIDR ranges. nginx then trusts `X-Forwarded-For` only from those addresses, so each visitor has their own rate limit instead of all sharing the router's address. Invalid entries are ignored. A trailing slash on `BUILDER_ORIGIN` is removed.

The builder keeps at most three live sessions for each client, handles one request at a time per session, and stops a chat turn after 75 seconds. A safety-check outage returns a retry message and does not count as a refusal.

When `BUILDER_ORIGIN` is unset, the proxy is empty and `builderEnabled` is `false`. The UI image includes the proxy include in both `docker/nginx-nvcf.conf.template` and `docker/nginx-local.conf.template`.

## Choose Models for an Example

The **Models** page (`/models`) lets you choose the frontend (Talker) and backend (Thinker) model for the selected example. Open it from the launch bar. The default is the example registry default, and **Restore defaults** clears your choice. The browser stores the choice. Changes apply to the next conversation. A Talker that does not speak the language of a fixed-language launch is skipped for that launch.

## Test

The unit tests are in `tests/unit/test_agent_builder.py`:

```bash
uv run pytest tests/unit/test_agent_builder.py -v
```

## Related Documentation

- [Configure Frontend/Backend Agent Domains](configure-frontend-backend-domains.md)
- [Configure Prompts](configure-prompts.md)
- [Astra Client](../../astra_client/README.md)
- [Deployment Architecture](../deployment-architecture.md)
