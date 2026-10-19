# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.3.0] - TBD

This minor release upgrades Pipecat to 1.12.0, adopts its built-in transcript-independent Smart Turn handling for audio-only user turns, and adds streaming-input prefill for the Generic Assistant on single-GPU hosts.

### Added

- **Streaming-input prefill** for the Generic Assistant. The single-GPU Lightning vLLM sidecar also serves a text StreamingInput WebSocket at `/v1/streaming-session`, and the **Streaming Input** toggle on the Lightning service card streams each ASR update into it, so the prompt is prefilled while the user is still speaking. `NvidiaStreamingLLMService` and `StreamingLLMUserAggregator` are drop-in replacements for `NvidiaLLMService` and `LLMUserAggregator`.
- One root `services.yaml` for every example, selected by `SERVICE_RECIPE`, and editable LLM parameters such as reasoning and temperature in the Services tab.
- Services tab controls for TTS and ASR: **Synthesis Mode** on Magpie TTS entries and **Punctuation** on the single-GPU NeMo-Speech.cpp ASR entries.
- **Multilingual Frontend/Backend Assistant** (`multilingual-generic-frontend-backend-agent`). Each session locks to one language, adds session-language prompts for the Talker and Thinker, and has the Talker model speak tool results. The Talker options are Gemma 4 31B, Nemotron 3.5 Super VL, and Nemotron 3.5 Lightning, and the default session language is `en-US`. The `multilingual-generic-frontend-backend-agent` and `multilingual-generic-frontend-backend-agent/server` Compose profiles run it. The Server profile places Lightning, multilingual ASR, and Magpie TTS on GPU 0, Gemma 4 on GPU 1, and Super VL on GPU 2. Gemma 4 needs `HF_TOKEN`, and Super VL needs `NVIDIA_API_KEY`. The Hindi and multilingual prompts are interim pending a prompt review, multilingual ASR accuracy for Hindi is not yet verified live, and the Talker few-shot demonstrations and some terminal fallback messages remain English.
- Launch variants through the `variants` field in `examples_registry.yaml` (`label`, `description`, `session_language`, `llm`, `tts_voice`, `talker_prompt_addon`, and `thinker_prompt_addon`) and the `example_variant` session configuration key. The multilingual entry offers a `hindi` variant that locks `hi-IN` with Gemma 4 and a `multilingual` variant where the user picks the language.
- NVCF Helm chart support for Gemma 4 (`vllmModels.gemma4`), Super VL as a NIM (`llmSuperVl` and `llmSuperVlImage`), multilingual ASR (`asrMultilingual`), and Omni as a separate NVCF function (`omniRemote.functionId`). The chart's function secrets add `HF_TOKEN` for Gemma 4 and `NVCF_API_KEY`.
- `gemma-4-31b` (Gemma 4 31B, `google/gemma-4-31B-it`, served as `google/gemma-4-31b-it`) LLM catalog entry, served by vLLM 0.31.0 from Hugging Face as `nvidia-llm-vllm-gemma4` on port `8003` with `/health` readiness, the `gemma4` tool and reasoning parsers, `--max-num-seqs=64`, and `--gpu-memory-utilization=0.90`. It needs about 62 GB of BF16 weights, so one GPU with 80 GB or more of memory, and `HF_TOKEN`. It declares `en`, `de`, `es`, `fr`, `it`, `ja`, `hi`, `ko`, `pt`, `zh`, `ar`, and `vi`. NVIDIA verified it live on NVCF with a Hindi conversation, native `call_backend` tool calls, 12 languages, and reasoning on and off, with a streaming time to first token of about 0.7 s through NVCF with the full prompt. The Helm block is `vllmModels.gemma4` with a 150Gi cache.
- Talker and Thinker prompt sections for each launch variant of the multilingual assistant: `hindi_talker`, `hindi_thinker`, `multilingual_talker`, and `multilingual_thinker` in `src/examples/frontend_backend_agent/prompts.yaml`, named through `talker_prompt_addon` and `thinker_prompt_addon`. A Talker section with `few_shots` replaces the English native-protocol demonstrations for that variant. The Thinker sections translate the request to English before planning, and tool arguments and `response_text` stay in English. The older session-language addons remain the fallback when a variant names none.
- A numeric-result guard for `get_stock_price`, `get_current_time`, `calculate_bmi`, and `generate_random_number`. A Talker reply that contains digits but not every number of the trusted result is retried once with a correction (reason `numbers_dropped`) and then falls back as before. The guard normalizes native-script digits, skips replies with no digits, and does not check `web_search` or `show_architecture`.
- `docker/Dockerfile.nvcf-nim` and `docker/nvcf-nim-entrypoint.sh`, a wrapper that starts an LLM NIM on NVCF by exporting `NGC_API_KEY` from `/var/secrets/secrets.json`. Use it for standalone NVCF functions.
- **Agent builder service** (`src/agent_builder/`, `docker/Dockerfile.agent-builder`), a CPU-only FastAPI service on port `7870` that turns a short chat into a validated agent configuration (schema `nemotron-voice-agent/agent-config`, version `1`). It calls the standalone Super VL NVCF function with a JSON-schema response, keeps the prompt, model, sampling, and history server-side, and applies input caps, an injection check, confirmed moderation, persona and prompt-echo checks, catalog-constrained output, session and rate limits, and fixed refusal replies. The API is `GET /builder-api/health`, `GET /builder-api/catalog`, and `POST /builder-api/session`, `/turn`, `/validate`, and `/load`. Refer to [Build a Custom Agent](docs/how-to/build-a-custom-agent.md).
- Astra client **Build Your Own Agent** page with a chat, a live schematic, **Save as YAML**, **Load YAML**, and **Start your agent**. A custom agent runs as `multilingual-generic-frontend-backend-agent`, so the voice agent is unchanged.
- Astra client **Models** page to choose the frontend (Talker) and backend (Thinker) model for each example, and a **Save agent** button on the launch bar that exports the selected example as an agent YAML file.
- `BUILDER_ORIGIN` for the Astra UI container. It enables a rate-limited `/builder-api/` nginx proxy and `builderEnabled` in `config.js`. The builder is disabled when it is unset.

### Changed

- A custom agent's persona (`persistent_prompt`) is trusted only with a signature from the agent builder when `AGENT_BUILDER_SIGNING_KEY` is set on both services; the voice agent drops an unsigned persona. The builder also limits live sessions per client, locks each session, bounds a turn to 75 seconds, validates pronunciation rules as phoneme strings, and uses the client address that the UI proxy resolves from `NGINX_REAL_IP_FROM`.
- A started custom agent no longer inherits the selected voice, prompt edits, model overrides, or voice sample of the built-in example.
- The Astra client landing shows four example cards, in one row from 1,180 px wide and two by two on mid-size screens. The fourth card appears only when the builder and the multilingual example are available.
- The Astra client Tools page names the frontend and backend models in use.
- Upgraded Pipecat to version 1.12.0.
- The multilingual Hindi and any-language variants select the Gemma 4 Talker (`gemma-4-31b`). The Hindi assistant is the preselected mode and speaks with the Leo voice when the TTS catalog has one for Hindi. The Helm chart is version `0.1.143-dev.20261016.2`.
- The Generic Frontend Backend Assistant offers Lightning, Gemma 4, and Super VL Talkers with reasoning off, and uses Super VL with reasoning on and `low` reasoning effort as the Thinker instead of Nemotron 3 Super. Lightning remains the fallback.
- The NVCF Helm chart disables `llmSuper` and the in-cluster `omni` by default and uses an 8-GPU layout.
- An LLM `base_url` on a `*.invocation.api.nvcf.nvidia.com` host authenticates with `NVCF_API_KEY` when it is set.
- Replaced the custom Omni audio-only Smart Turn stop strategy with Pipecat's built-in `TurnAnalyzerUserTurnStopStrategy`, configured with `wait_for_transcript=False`.
- UI selections (example, transport, services, prompt) no longer persist in browser localStorage. They survive disconnect and reconnect, and a page refresh resets them to the server defaults. Custom services and prompts stay saved.

### Fixed

- The numeric-result guard no longer rejects a correct number that ends a sentence, has trailing zeros, or appears as a 24-hour clock or a UTC offset, and Hindi or Japanese stock requests are no longer rejected as missing the company name.
- Non-English Frontend/Backend sessions skip the English-only weather grounding check, spoken results split sentences at `।`, `॥`, `。`, `！`, and `？`, and the Thinker writes tool arguments in English with Latin letters so WeatherAPI accepts them.
- Non-English Frontend/Backend sessions only speak a Talker filler written in the session language. The filler validator previously accepted English fillers and rejected every Hindi one; the language add-on and the `filler_text` schema now ask for the session language. When the Talker's filler is rejected, a fixed filler in the session language is spoken instead.
- Fixed-language Frontend/Backend sessions retry a Talker reply to a tool result that is not in the session language, and tell the Talker that the result's `response_text` is an English summary to express in the session language. Hindi sessions previously read some English result text aloud.
- `FRONTEND_BACKEND_FIXED_LANGUAGE_ASR=auto` keeps the multilingual ASR in automatic language detection for fixed-language sessions, so a Hindi session also transcribes English speech. It is opt-in because Hindi recognition was measurably worse with it; the default `locked` recognizes only the session language.
- The session-language picker and Voice studio list only languages the selected Talker speaks. They previously omitted the Talker, so the server offered languages that the Talker does not support. Arabic and Vietnamese now appear with Gemma 4 because the ASR and TTS support them.
- Host-native runs reach Nemotron 3 Super on its published port `18001`.
- The Frontend/Backend Agent Thinker honors the Max Tokens setting.

### Removed

- The **Your standing instructions** card on the Astra client Prompts page. The client no longer sends `persistent_prompt` from a saved value, and the builder sets it for custom agents.
- The direct and hybrid tool-result modes of the Frontend/Backend Agent, `force_tool_result_mode`, the `FRONTEND_BACKEND_TOOL_RESULT_MODE` and `FRONTEND_BACKEND_DIRECT_TOOL_RESPONSE` environment variables, and the Helm values `app.frontendBackendToolResultMode` and `app.frontendBackendDirectToolResponse`. Every grounded result, cancel hint, missing-parameter hint, and terminal message now returns to the Talker with `run_llm=true`. In a language-locked session, the payload carries `reply_language` and `reply_instruction`.
- `LOCAL_SERVICES_ENABLED`, `SERVICES_CLOUD_PATH`, `SERVICES_LOCAL_PATH`, and the `*-reasoning` catalog entries. Use `SERVICE_RECIPE` and the Reasoning setting instead.
- The per-example `services.cloud.yaml` and `services.local.yaml` files, and the `slots` field and `defaults.llm`, `defaults.asr`, and `defaults.tts` keys in `examples_registry.yaml`. List each example's services under `services` instead. The first available key is the default.
- The `nemotron-voice-agent-configure-pipeline` skill. `nemotron-voice-agent-deploy` now covers configuration changes.

## [2.2.0] - 2026-09-22

This minor release adds Nemotron 3.5 Lightning and Nemotron 3 Nano Omni support, universal `*/single-gpu` recipes with the NeMo-Speech.cpp stack, an OpenAI Realtime-compatible WebSocket gateway, and the `nemotron-voice-agent-builder` skill. It consolidates on-prem deployment under `*/server` and `*/single-gpu`, upgrades Pipecat to 1.7.0, and removes the platform-specific recipes and Nemotron 3 Nano cascaded LLM.

### Added

- **Nemotron 3.5 Lightning** NIM and vLLM sidecars. Single-GPU recipes load the NVFP4 checkpoint on supported GPUs. Blackwell, DGX Spark, and Jetson Thor serve native NVFP4, with DSpark speculative decoding on DGX Spark and DFlash on Blackwell workstations. Hopper and Ada serve the same NVFP4 checkpoint as W4A16 through Marlin.
- **Nemotron 3 Nano Omni NIM** for the Omni `*/server` recipes.
- **`*/single-gpu` recipes** running the NeMo-Speech.cpp speech stack next to vLLM on one GPU across all examples.
- **`scripts/download-nemo-speech-models.sh`** for one-time NeMo-Speech.cpp GGUF setup on single-GPU hosts.
- **OpenAI Realtime–compatible WebSocket gateway** (`WS /v1/realtime`) that drives the existing cascaded ASR → LLM → TTS pipelines for OpenAI Realtime–shaped clients, with NVIDIA-only knobs under `session.nvidia`.
- **`nemotron-voice-agent-builder` agent skill** for scaffolding and refining NVIDIA voice agents (cascaded or Omni) across Pipecat and LiveKit.
- Optional `NvidiaWordTTSService` for Magpie word streaming and timestamp-based context commits.

### Changed

- Serve Nemotron 3.5 Lightning NVFP4 as W4A16 through Marlin on Hopper and Ada single-GPU hosts, instead of a BF16 checkpoint with online FP8.
- Upgraded Pipecat to version 1.7.0.
- Set **Nemotron 3.5 Lightning** as the default LLM across cascaded examples. Nemotron 3 Super remains available in the service catalogs.
- Standardized the self-hosted Nemotron 3.5 Lightning served model ID with NVIDIA Cloud across NIM and single-GPU vLLM deployments.
- Consolidated on-prem deployment recipes under `<example>/server` for scaling-oriented stacks and universal `<example>/single-gpu` for supported one-GPU deployments on workstations, DGX Spark, and Jetson Thor. Renamed `generic-assistant/workstation-perf` to `generic-assistant/server-perf`.
- Replaced `PLATFORM`-based local service selection with endpoint reachability.
- Gated the NVIDIA Cloud (NVCF) service catalog on `NVIDIA_API_KEY`, so those entries appear in the UI and pipeline only when a cloud key is set.
- Updated Nemotron ASR Streaming NIM to version 1.3.1.
- Updated Parakeet CTC 1.1B ASR NIM to version 1.5.3.
- Updated Magpie TTS Multilingual NIM to version 1.10.0 and `nvidia-riva-client` to version 2.27.0.
- Renamed the Magpie Multilingual Compose services to `magpie-multilingual-tts-service` and `magpie-multilingual-tts-service-perf`.
- Updated Chatterbox TTS Multilingual NIM to version 1.1.0 and documented its available model profiles.
- Updated the React UI client to `@pipecat-ai/client-react` 1.8.2 and rendered the conversation transcript directly from Pipecat's `usePipecatConversation()` hook, removing the custom client-side turn reconstruction and timestamp re-anchoring.
- Relicensed the repository from BSD-2-Clause to a dual CC-BY-4.0 and Apache-2.0 license.

### Fixed

- Cap Omni NIM KV cache (`NIM_KVCACHE_PERCENT` default `0.6`, `NIM_MAX_MODEL_LEN` `32768`) so Magpie TTS can share GPU 0.
- Emit `user-turn-finalized` from Omni Assistant Subagents so the server signals user-turn boundaries.
- Keep chat transcripts in speaking order by rendering the Pipecat SDK message stream directly instead of merging server- and client-derived timestamps, which could reorder turns under clock skew.
- Render each bot turn as a single transcript bubble instead of splitting multi-sentence responses into separate messages.
- Show the negotiated RTVI protocol version in the Session panel instead of the client library version.
- Resolve shared TTS voice ids (`John`) against the catalog default language so the disabled language dropdown shows `en-US` instead of the alphabetically first locale.

### Removed

- Platform-specific **`*/workstation`, `*/dgx-spark`, and `*/jetson-thor` recipes** and the Jetson Riva sidecars (`nemotron-speech`, `nemotron-speech-tts`), along with the CUDA MPS helper scripts, CPU-pinning knobs, and `RIVA_*` environment knobs. Use `*/server`, `generic-assistant/server-perf`, or `*/single-gpu` instead.
- **Nemotron 3 Nano** cascaded LLM catalog entries and its NIM compose file. Use Nemotron 3.5 Lightning instead.
- **NVIDIA Cloud (NVCF) catalog entries** for Nemotron 3 Super (`nemotron-super`, `nemotron-super-reasoning`) and Parakeet CTC 1.1B (`parakeet-ctc`). Both models remain available self-hosted.

## [2.1.1] - 2026-08-21

Patch release replacing the deprecated Nemotron 3 Nano cloud endpoint in cascaded pipelines.

### Changed

- Replaced the deprecated Nemotron 3 Nano cloud endpoint with Nemotron 3.5 Lightning across cascaded NVIDIA Cloud service catalogs and defaults.

## [2.1.0] - 2026-08-18

Minor release with expanded TTS options, improved turn-taking, Omni Assistant Subagents refinements, multilingual model compatibility checks, and broader evaluation coverage.

### Added

- Chatterbox TTS Multilingual with 23 languages and Magpie TTS Zeroshot with optional voice cloning.
- Omni Assistant webcam steering, thinker reasoning, and subagent handoff improvements.
- Pipecat evaluation coverage for core examples, latency, and tool scenarios.

### Changed

- Updated Magpie TTS Multilingual NIM to version 1.9.0 and documented its 12 supported languages.
- Upgraded Pipecat to **1.5.0** and refreshed NIM, vLLM, and CVE-related dependency pins.
- Improved Smart Turn defaults and added inactivity checks for the Generic Assistant.
- Refactored `NvidiaOmniLLMService` on Pipecat's `NvidiaLLMService` base.
- Grouped sentence-level bot output into turn-level transcript messages across all examples.

### Fixed

- Improved Omni Assistant Subagents media handling.
- Restricted multilingual sessions to supported ASR, TTS, and LLM combinations.

## [2.0.0] - 2026-07-09

Re-architecture by upstreaming `nvidia-pipecat` changes to [Pipecat](https://github.com/pipecat-ai/pipecat) and a unified React UI client, new multimodal Nemotron Omni and Frontend Backend Agent examples and recipe-style deployment profiles.

### Added

- **Example pipelines**, each shipped as self-contained Compose recipes:
  - `generic-assistant`: baseline English cascaded pipeline (Nemotron ASR + LLM + Magpie TTS).
  - `multilingual-assistant`: showcases a multilingual pipeline using Multilingual ASR and TTS, with a fixed language per session for better reliability.
  - `omni-assistant`: Nemotron 3 Nano Omni as a single multimodal ASR + LLM service with Magpie TTS.
  - `omni-assistant-subagents`: the Omni service split across cooperating Pipecat Subagents with live webcam, vision and uploaded-media analysis.
  - `frontend-backend-agent`: a talker LLM front-ending a stateful backend agent (airline-booking reference).
- `NvidiaOmniLLMService`: an upstream-compatible Pipecat `LLMService` for Nemotron Omni
- **Unified UI client** (`client/`) with grouped LLM/ASR/TTS selectors (Self-hosted / NVIDIA Cloud / Custom), a prompt-preset picker, a Metrics panel, attachment upload, and a webcam panel.
- **New models**: Nemotron 3 Super 120B A12B and Nemotron 3 Nano Omni (LLMs), plus Nemotron ASR Streaming (English and Multilingual).
- **DGX Spark and single-GPU workstation** local NIM deployment, plus improved Jetson Thor support.
- Agent skills for example deployments and configurations.

### Fixed

- Improve TTS text filter to avoid removing commonly used special chars like $, %
- Summarize chat history for long sessions to limit LLM context growth.

### Changed

- Pipecat is used directly and upgraded **0.0.98 → 1.3.0**.
- Enabled Pipecat smart turn detection model as default turn taking solution replacing Silero VAD based silence EOU.
- **Recipe-style Compose profiles**: `<example>` (cloud-only) and `<example>/<hardware>` (on-prem, for example `generic-assistant/dgx-spark`, `omni-assistant/jetson-thor`). Each is a complete, self-contained stack. `tracing` (Phoenix OTel) and `turn` (Coturn) remain optional overlays.

### Removed

- `nvidia-pipecat` Git submodule (NVIDIA Services Upstreamed to Pipecat directly).
- The previous `frontend/` WebRTC and WebSocket UIs, replaced by the React `client/` in the Pipecat-based re-architecture.
- Speculative speech processing (`ENABLE_SPECULATIVE_SPEECH`), the latency optimization that used intermediate ASR transcripts.
- Legacy configuration environment variables (per-slot `DEFAULT_*`, `DEPLOYMENT_PLATFORM`, pipeline-shaping CLI flags, and example-specific service URLs). Configuration now lives in the example service catalogs and `examples_registry.yaml`.

## [1.0.0] - 2026-03-03

Initial release of Nemotron Voice Agent — an end-to-end voice agent blueprint powered by NVIDIA Nemotron ASR, LLM, and TTS, designed for scalable, production-ready deployments.

### Added

- End-to-end voice agent pipeline with NVIDIA Nemotron ASR, LLM, and TTS, supporting streaming audio and mid-conversation interruptions
- Built on the open source [Pipecat-ai](https://github.com/pipecat-ai/pipecat) and [nvidia-pipecat](https://github.com/NVIDIA/voice-agent-examples) frameworks
- NVIDIA Nemotron Speech models:
  - [Parakeet CTC 1.1B](https://build.nvidia.com/nvidia/parakeet-ctc-1_1b-asr/modelcard) (English ASR)
  - [Parakeet 1.1B RNNT](https://build.nvidia.com/nvidia/parakeet-1_1b-rnnt-multilingual-asr/modelcard) (Multilingual ASR)
  - [Magpie TTS Multilingual](https://build.nvidia.com/nvidia/magpie-tts-multilingual/modelcard)
- NVIDIA Nemotron LLMs using NVIDIA NIM:
  - [Nemotron 3 Nano 30B A3B](https://build.nvidia.com/nvidia/nemotron-3-nano-30b-a3b/modelcard)
  - [Llama 3.3 Nemotron Super 49B v1.5](https://build.nvidia.com/nvidia/llama-3_3-nemotron-super-49b-v1_5/modelcard)
- WebRTC transport for real-time, low-latency voice communication with a custom frontend UI
- Docker Compose deployment with optional TURN server support for remote access
- Multilingual support with automatic language detection and mid-conversation language switching
- Jetson Thor edge deployment support
- Pipeline customizations using environment variables and config files
  - ASR, LLM, TTS model change
  - Speculative speech processing enable/disable
  - Conversation history thresholds
  - output audio buffering
- Open telemetry tracing and monitoring support
- Documentation:
  - [Getting started guide](docs/01-getting-started.md) covering prerequisites, GPU configuration, and step-by-step setup
  - [Configuration guide](docs/02-configuration-guide.md) for pipeline customizations
  - [Jetson Thor deployment guide](docs/03-jetson-thor.md) for edge use cases
  - [Best practices guide](docs/05-best-practices.md) covering production deployment, latency optimization, and conversational UX
- AI agent deployment skill for Cursor and Claude Code to streamline deployment on workstations and Jetson Thor

### Known Issues

- ASR transcription can occasionally be inaccurate, though the LLM generally compensates by inferring meaning from context.
- The context aggregator limits chat history to 20 turns by default. Older turns are dropped when this limit is reached, rather than summarized.
