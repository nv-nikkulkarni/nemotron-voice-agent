# Project Information

## Contents

1. [Purpose](#purpose)
2. [Experiences](#experiences)
3. [Technology Stack](#technology-stack)
4. [Model and Service Inventory](#model-and-service-inventory)
5. [Generic Frontend/Backend Design](#generic-frontendbackend-design)
6. [Omni Subagents Design](#omni-subagents-design)
7. [Repository Map](#repository-map)
8. [Git and Branch Policy](#git-and-branch-policy)
9. [Release Truth](#release-truth)
10. [Product Invariants](#product-invariants)

## Purpose

Nemotron Voice Agent is a real-time, Pipecat-based NVIDIA voice-agent blueprint.
The custom project deployment combines:

- a curated React and TypeScript UI in `astra_client/`;
- a FastAPI and Pipecat application with five horizontally scaled replicas;
- NVIDIA Inference Microservices for automatic speech recognition (ASR),
  large language model (LLM) inference, and text-to-speech (TTS);
- Redis for cross-replica session configuration, media streams, and capture coordination;
- SeaweedFS for cross-replica capture artifacts;
- NGC resource versions for durable session archives;
- Viking Kubernetes for local qualification;
- NVCF for the serving function and model workloads; and
- Astra for the credential-bearing UI reverse proxy.

The project intentionally keeps most upstream source pristine. New behavior lives in
separate modules, a dedicated UI, and Helm templates, with the smallest integration points
in shared runtime code.

## Experiences

### Generic Frontend/Backend Assistant

The curated Generic experience uses the reusable Frontend/Backend Agent architecture:

- Lightning Talker: fast, non-reasoning, user-facing mode selection and speech.
- Super Thinker: reasoning-enabled, bounded plan creation.
- Python dispatcher: validates and executes only allowlisted read-only tools.
- Magpie or Chatterbox: selectable TTS.
- Nemotron ASR: streaming speech recognition.
- Tools: weather, stock, web search, body mass index (BMI), and random number.

The exact identity response is:

> I am Nemotron Voice Agent, developed by engineers at NVIDIA. I use a cascaded
> pipeline of Nemotron ASR, Magpie TTS, and Nemotron LLM models.

The Talker is not a ReAct loop and does not see the internal tool schemas. It sees only
`call_backend` and `cancel_backend`.

### Omni Assistant Subagents

The Omni experience uses an audio-capable Nemotron Omni model and Pipecat workers:

- Transport Agent owns microphone, speaker, TTS, and worker coordination.
- Speaker Agent chooses grounded speech actions.
- Media Analyzer handles uploaded image, audio, and video.
- Webcam Agent maintains a visual baseline and change observations.
- Thinker Agent performs bounded deeper reasoning.
- Redis streams bridge media POST requests to whichever replica owns the WebSocket.

The Speaker, media, webcam, and Thinker roles use explicit action envelopes and pinned
shared board state. The experience supports voice, attachments, webcam frames, and
high-resolution capture.

### Airline Compatibility

The original `frontend-backend-agent` identifier remains the airline example. The shared
pipeline resolves either an `airline` or `generic` repository-owned `DomainSpec`. Airline
booking state, tools, formatting, pronunciation, and booking-server integration stay inside
the airline domain. Do not treat airline as a prompt-only flavor of the generic tools.

## Technology Stack

| Layer | Technology |
|---|---|
| Browser UI | React, TypeScript, Vite, Pipecat Client SDK |
| Astra container | `nginx-unprivileged`, non-root, port `7860` |
| Application | Python, FastAPI, Pipecat, WebSocket/RTVI |
| Agent orchestration | Native Pipecat LLM function calling and workers |
| ASR | NVIDIA Nemotron ASR Streaming |
| Talker | Nemotron 3.5 Lightning 30B-A3B |
| Thinker | Nemotron 3 Super 120B-A12B |
| Multimodal | Nemotron 3 Nano Omni 30B-A3B Reasoning through vLLM |
| TTS | Magpie Multilingual or Chatterbox Multilingual |
| Shared live state | Redis Streams and keys |
| Shared capture store | SeaweedFS S3 API |
| Durable capture | NGC registry resource version |
| Packaging | Docker/OCI images and Helm |
| Platforms | Viking Kubernetes, NVCF, Astra/Fusion |
| SQA | Playwright, headless Chromium, PulseAudio, ffmpeg, independent ASR |

React is the client, not the agent framework. The backend agent is not LangChain,
LangGraph, or a generic ReAct agent.

## Model and Service Inventory

The following values describe the checked-in chart at the source snapshot documented
below. Recheck `nvcf_helm/values.yaml` before using them operationally.

| Role | Checked-in image or model | Shape |
|---|---|---:|
| ASR | `nemotron-asr-streaming:1.2.0` | 1 GPU |
| Lightning Talker | `nemotron-3.5-lightning-30b-a3b:2.0.9-variant` | 1 GPU |
| Super Thinker | `nemotron-3-super-120b-a12b:2.0.5` | 2 GPUs |
| Omni server | `vllm-omni:v0.20.0-cu130-r2` | 1 GPU |
| Magpie TTS | `magpie-tts-multilingual:1.8.0` | 1 GPU |
| Chatterbox TTS | `chatterbox-tts-multilingual:1.0.0` | 1 GPU |
| Redis | `redis:7.2.4-debian-12-r12` | CPU |
| SeaweedFS | `seaweedfs:4.41` | CPU |
| App | `nemotron-voice-agent:2.0.51` | five CPU replicas |

The complete NVCF topology requests seven of eight H100 GPUs. The spare GPU is headroom,
not another service.

The Generic model contract is deliberate:

- Talker: Lightning, temperature `0.0`, thinking disabled, maximum 512 output tokens.
- Thinker: Super, temperature `0.0`, thinking enabled, reasoning budget 256, maximum
  768 output tokens.
- The smaller Lightning model is a 30-billion-parameter mixture-of-experts model with
  about 3 billion active parameters per token, represented by `30B-A3B`.
- The Thinker remains reasoning-enabled because it creates a bounded structured plan.
- The Talker remains non-reasoning to reduce latency and prevent spoken private reasoning.

## Generic Frontend/Backend Design

### Shared Pipeline

`src/examples/frontend_backend_agent/pipeline.py` owns ASR, Talker, TTS, transport,
context, liveness, and cancellation wiring. It resolves a session-selected domain through
the code allowlist in `src/examples/frontend_backend_agent/src/domain.py`.

### DomainSpec

A `DomainSpec` supplies:

- stable domain key and label;
- Talker-visible `call_backend` and `cancel_backend` schema;
- Thinker prompt key;
- backend factory;
- runtime context;
- optional TTS transformation;
- code-authored filler policy;
- internal `ToolSpec` registry; and
- query and concurrency limits.

A prompt/profile can change persona, examples, routing language, and select a subset of
already registered tools. New schemas, executors, side effects, state machines, validators,
formatters, secrets, service dependencies, or concurrency policies require domain code.

### ToolSpec

Each generic capability has one `ToolSpec` that owns its:

- name and description;
- JSON parameter schema;
- required fields;
- timeout;
- executor binding;
- enabled-by-default state;
- result formatter; and
- optional filler category.

The same registry generates the Thinker tool contract and controls dispatch. A session
cannot widen server capabilities beyond the repository-owned allowlist.

### Tool Providers

| Tool | Provider | Required secret |
|---|---|---|
| `get_weather` | WeatherAPI | `WEATHERAPI_KEY` |
| `get_stock_price` | Finnhub | `FINNHUB_API_KEY` |
| `web_search` | Perplexity Sonar through NVIDIA inference | `PERPLEXITY_API_KEY` |
| `calculate_bmi` | local Python | none |
| `generate_random_number` | local Python | none |

All provider failures fail closed with short, TTS-safe output. Never speak raw HTTP errors,
stack traces, credentials, or malformed provider payloads.

## Omni Subagents Design

Omni consumes user audio directly for multimodal understanding, then emits text that the
selected external TTS synthesizes. Its model repository and API served name are separate
values. The application catalog, vLLM `--served-model-name`, and prewarmer request must use
the same stable served alias.

The webcam worker requires a concrete first observation. `No notable change.` is invalid
until a baseline exists. After a baseline exists, a no-change result retains the previous
scene. A loading view is not an unavailable camera.

## Repository Map

| Path | Ownership |
|---|---|
| `astra_client/` | curated Astra and local demo UI |
| `docker/Dockerfile.nvcf-ui` | immutable UI image |
| `docker/nvcf-ui-entrypoint.sh` | runtime nginx config and public timestamp |
| `src/server.py` | API, session config, WebSocket dispatch, media routes |
| `src/examples/frontend_backend_agent/` | shared Talker/Thinker pipeline and domains |
| `src/examples/omni_assistant_subagents/` | worker-based multimodal experience |
| `src/session_bus/` | Redis session config and media transport |
| `src/session_store/` | local or S3-compatible capture artifact storage |
| `src/session_capture/` | consent/pipeline coordination, archive, NGC upload |
| `src/examples/shared/pronunciation_registry.yaml` | ARPAbet review plus runtime IPA |
| `nvcf_helm/` | NVCF and Viking chart |
| `nemotron-voice-agent-2-values.yaml` | isolated `-2` Astra candidate values |
| `tests/sqa/` | real-browser, real-audio qualification |
| `tests/sqa/reports/` | concise promotion evidence |
| `docs/` | public architecture, configuration, and troubleshooting |
| `skills/` | repository workflows and this operational knowledge |

## Git and Branch Policy

GitHub fork `nv-nikkulkarni/nemotron-voice-agent` is the primary remote. GitLab branches
remain backups unless the user explicitly changes that policy.

| Branch | Purpose |
|---|---|
| `dev/nikkulkarni/nvcf-deploy-rebased` | source of truth for the active custom production deployment |
| `dev/nikkulkarni/domain-configurable-frontend-backend-agent` | focused reusable-domain development history |
| `develop` | upstream integration base |

The former `dev/nikkulkarni/prod-sqa-remediation-0.1.103` work was merged into the NVCF
source branch and removed as redundant. Backup refs preserve pre-squash and pre-rebase
states. Do not delete backup refs or GitLab branches as part of ordinary feature work.

## Release Truth

At the August 30, 2026 source snapshot:

- the checked-in chart is `0.1.122`;
- the checked-in app/UI version is `2.0.51`;
- `0.1.122` was built and pushed but was not Viking-qualified or deployed;
- the last recorded isolated `nemotron-voice-agent-2` staging deployment remained on
  rejected `0.1.115`;
- the last recorded retained production function remained on chart `0.1.103` and app
  `2.0.32`; and
- the retained Astra UI was still deployed in Astra `stg` infrastructure even though it
  targeted the production NVCF function.

These are historical records, not a live status claim. Query Fusion, NVCF, Astra
`/config.js`, `/api/deployment`, and `/api/session-capture/status` before reporting status.

## Product Invariants

- Keep the curated UI focused on Generic Frontend/Backend and Omni Subagents.
- Keep credentials server-side.
- Keep five app replicas safe through Redis and SeaweedFS.
- Keep one live WebSocket on the process that accepted it.
- Keep the direct trusted backend-result path to prevent a second Talker inference from
  repeating or redelegating a completed result.
- Keep response speech short: web results at most two sentences; multi-tool results at most
  three short sentences and about 450 characters.
- Keep safety guidance location-neutral when country is unknown.
- Keep unsupported side effects fail-closed.
- Keep exact deployment artifacts immutable across promotion.
