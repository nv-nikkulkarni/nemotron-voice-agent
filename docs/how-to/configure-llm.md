# LLM Models

The cascaded pipeline calls a text **LLM** for response generation. The **Omni** examples use a single audio-input model that performs ASR and the LLM together. All of them are **NVIDIA Nemotron** models, reasoning-capable open models with built-in tool calling, served either from the cloud (NVIDIA-hosted NVCF endpoints) or self-hosted next to the pipeline as a Compose sidecar.

Nemotron models are **transparent**: weights and training data are open on [Hugging Face](https://huggingface.co/nvidia) and the technical reports for reproducing them are public, so you can evaluate a model before putting it in production. The **Nemotron 3** family pairs a hybrid **Mamba-Transformer MoE** architecture for efficient, high-throughput, multimodal agentic AI, and deploys with open frameworks (vLLM, SGLang, Ollama, llama.cpp) on any NVIDIA GPU (edge, cloud, or data center) or as NVIDIA NIM microservices.

The reasoning family is tiered by capability. **Nemotron 3.5 Lightning** is the fast, efficient default for cascaded examples, while **Nemotron 3 Nano Omni** adds multimodal audio input. **Nemotron 3 Super** offers the highest efficiency with leading accuracy for reasoning and tool calling in multi-agent apps. **Ultra** gives the highest reasoning accuracy for the most complex agentic tasks. Learn more at [NVIDIA Nemotron](https://developer.nvidia.com/topics/ai/nemotron).

Models are declared per example in `services.cloud.yaml` (remote / NVCF) and `services.local.yaml` (Compose-managed sidecars). This page is the **model reference**. It covers the available models, deployment and sizing, reasoning and tool calling, and per-request sampling. For catalog loading, switching, and overrides, refer to [Configure Services](configure-services.md).

## Models

Three unique Nemotron models back the examples. Each is served by the self-hosted Compose service(s) below. Nemotron 3.5 Lightning and Nemotron 3 Nano Omni are also available from the cloud catalog with no sidecar. Nemotron 3 Super is self-hosted only.

| Model | Self-hosted compose service | Modelcard |
|-------|-----------------------------|-----------|
| **Nemotron 3.5 Lightning 30B A3B**: fast, efficient text LLM | [`docker-compose.nemotron35-lightning-nim.yaml`](../../docker/docker-compose.nemotron35-lightning-nim.yaml) (NIM), [`docker-compose.nemotron35-lightning.yaml`](../../docker/docker-compose.nemotron35-lightning.yaml) (vLLM) | [modelcard](https://build.nvidia.com/nvidia/nemotron-3.5-lightning-30b-a3b/modelcard) |
| **Nemotron 3 Super 120B A12B**: higher-capability alternative for complex tasks, available self-hosted | [`docker-compose.nemotron3-super.yaml`](../../docker/docker-compose.nemotron3-super.yaml) | [model card](https://build.nvidia.com/nvidia/nemotron-3-super-120b-a12b/modelcard) |
| **Nemotron 3 Nano Omni 30B A3B**: audio-input model that does ASR and the LLM in one, used by the Omni examples | [`docker-compose.nemotron3-omni-nim.yaml`](../../docker/docker-compose.nemotron3-omni-nim.yaml) (NIM), [`docker-compose.nemotron3-omni.yaml`](../../docker/docker-compose.nemotron3-omni.yaml) (vLLM) | [modelcard](https://build.nvidia.com/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning) |

Each model is exposed as one or more **catalog keys** in `services.cloud.yaml` / `services.local.yaml`:

| Model | Catalog keys |
|-------|--------------|
| Nemotron 3.5 Lightning | `nemotron-lightning`, `nemotron-lightning-reasoning`, `nemotron-lightning-streaming` (Generic Assistant single-GPU) |
| Nemotron 3 Super | `nemotron-super`, `nemotron-super-reasoning` (self-hosted only) |
| Nemotron 3 Nano Omni | `nemotron-omni-nvfp4` |

The `*-reasoning` keys are the **same weights** with thinking enabled (see [Reasoning, parser & tool calling](#reasoning-parser--tool-calling)). The active default per slot is set in [`examples_registry.yaml`](../../examples_registry.yaml) under `defaults`.

### Multilingual Session Languages

The multilingual assistant exposes only locales supported by the selected ASR, TTS, and built-in LLM. The LLM lists below are the model-level capability sets; locale variants match their base language (for example, `de-DE` matches `de`).

| Built-in LLM | Supported language bases |
| --- | --- |
| Nemotron 3.5 Lightning (`nemotron-lightning`, `nemotron-lightning-reasoning`) | English (`en`), German (`de`), Spanish (`es`), French (`fr`), Italian (`it`), Japanese (`ja`) |
| Nemotron 3 Super (`nemotron-super`, `nemotron-super-reasoning`, self-hosted) | English (`en`), German (`de`), Spanish (`es`), French (`fr`), Italian (`it`), Japanese (`ja`), Chinese (`zh`) |

The source of truth for the built-in capability metadata is the NVIDIA [Nemotron 3.5 Lightning model card](https://build.nvidia.com/nvidia/nemotron-3.5-lightning-30b-a3b/modelcard) and [Nemotron 3 Super model card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-FP8).

> **Multilingual conversation quality.** Nemotron 3.5 Lightning's conversation quality is weaker in some languages (for example Hindi). For multilingual deployments where language fidelity matters, self-host **Nemotron 3 Super** (`nemotron-super`) with [`docker-compose.nemotron3-super.yaml`](../../docker/docker-compose.nemotron3-super.yaml) and add it to the example catalog. It stays more reliably in the target language and reads more naturally across languages.

## Hardware Requirements and Deployment Configs

You can self-host the LLM two ways, and the repo wires the right one per profile:

- **NIM** (`nvidia-llm`, `nvidia-llm-omni`, `nemotron-3-super`): a prebuilt, optimized inference microservice with automatic, hardware-aware model-profile selection. It is used by `*/server` recipes.
- **vLLM** (`nvidia-llm-vllm*`, `nvidia-llm-vllm-omni`): serves weights directly. The `*/single-gpu` recipes select the serving precision automatically from the host and GPU.

Both expose the same OpenAI-compatible API, so the pipeline and the request tuning below behave identically against either.

> Check the [NIM for LLMs support matrix](https://docs.nvidia.com/nim/large-language-models/latest/reference/support-matrix.html) for cascaded models and the [NIM for VLMs support matrix](https://docs.nvidia.com/nim/vision-language-models/2.0.4-variant/support-matrix.html) for Omni before choosing a profile.

### VRAM & Hardware Support

The `*/single-gpu` vLLM services select the model checkpoint and precision from the GPU compute capability. They also calculate `--gpu-memory-utilization` at startup. The planner reserves `VLLM_VRAM_HEADROOM_MIB` from currently free memory, validates the usable amount, and caps the resulting utilization for the platform. The default headroom is 4096 MiB. Set `VLLM_GPU_MEMORY_UTILIZATION` only when an explicit override is required. These overrides apply to automatically sized workstation Lightning recipes and Omni recipes. Lightning on DGX Spark and Jetson Thor uses a fixed value of `0.35`.

| Service / hardware | Model selection | Automatic VRAM plan | Device IDs |
| --- | --- | --- | --- |
| Lightning on a Blackwell workstation | NVFP4 with DFlash | Free VRAM minus headroom, capped at `0.90`. Requires at least 28 GiB usable. | LLM + ASR + TTS -> `0` |
| Lightning on Ada or Hopper | NVFP4 W4A16 via Marlin | Free VRAM minus headroom, capped at `0.90`. Requires at least 28 GiB usable. | LLM + ASR + TTS -> `0` |
| Lightning on DGX Spark | NVFP4 with DSpark | Fixed at `0.35` to preserve unified memory for speech and the system. | LLM + ASR + TTS -> `0` |
| Lightning on Jetson Thor | NVFP4 | Fixed at `0.35` to preserve unified memory for speech and the system. | LLM + ASR + TTS -> `0` |
| Omni on DGX Spark or Jetson Thor | NVFP4 | Free unified memory minus headroom, capped at `0.70`. Requires at least 24 GiB usable. | Omni + TTS -> `0` |
| Omni on a Blackwell workstation | NVFP4 | Free VRAM minus headroom, capped at `0.90`. Requires at least 24 GiB usable. | Omni + TTS -> `0` |
| Omni on Ada or Hopper | FP8 | Free VRAM minus headroom, capped at `0.90`. Requires at least 36 GiB usable. | Omni + TTS -> `0` |
| Omni on Ampere | BF16 | Free VRAM minus headroom, capped at `0.90`. Requires at least 66 GiB usable. | Omni + TTS -> `0` |

These values are startup checks used by the planner, not guarantees that every workload will fit. Model weights, KV cache, speech services, context length, and concurrency must all fit within the selected budget.

Server recipes use model-specific NIM profiles and scaling controls instead of the single-GPU VRAM planner. Standard `*/server` services leave `NIM_MODEL_PROFILE` unset so NIM automatically chooses a compatible profile for the visible GPU. The dedicated `generic-assistant/server-perf` benchmark instead pins an NVFP4 TP2 profile for two Blackwell LLM GPUs.

| Server layout | Typical memory | Memory control | Device IDs |
| --- | --- | --- | --- |
| Lightning NIM on one GPU | 80 GB | `NIM_KVCACHE_PERCENT=0.6` (default) | LLM + ASR + TTS -> `0` |
| Lightning NIM split across two GPUs | 40 GB/GPU | `NIM_KVCACHE_PERCENT=0.9` | LLM (`nvidia-llm`) -> `0`, ASR + TTS -> `1` |
| Omni NIM | See the NIM for VLMs support matrix, plus TTS memory when sharing a GPU | Automatic NIM model profile | Omni + TTS -> `0` |
| Nemotron 3 Super | 2 × 80 GB (`tp=2`) | NIM defaults | LLM split across two GPUs |

Update each service's `device_ids` under `deploy.resources.reservations.devices` when splitting services across GPUs.

### Deployment Tuning Parameters

Single-GPU Compose services select precision and VRAM utilization automatically. Use `.env` only for the optional headroom or utilization override. Standard NIM Server deployments also use hardware-aware automatic profile selection. Only specialized recipes such as `server-perf` pin a profile. For Server deployments, the stock Compose files expose only the NIM settings shown as environment variables below. Use a Compose override for controls that the stock files fix or omit.

| Control | Server NIM | Single-GPU vLLM | Notes |
|----------|--------------|--------------------------|-------|
| **VRAM fit** | `NIM_KVCACHE_PERCENT` (default `0.6`) | `VLLM_VRAM_HEADROOM_MIB` (default `4096`) and optional `VLLM_GPU_MEMORY_UTILIZATION` override | vLLM calculates the utilization from free memory by default. |
| **Precision** | Automatic for standard `*/server`. `server-perf` pins `NIM_MODEL_PROFILE=vllm-nvfp4-tp2-pp1-18.0` | Selected automatically from GPU compute capability | Lightning single-GPU loads the NVFP4 checkpoint on every supported GPU. Hopper and Ada serve it as W4A16 through Marlin. Native NVFP4 compute still needs Blackwell or later. For NIM on older hardware, choose a compatible profile listed by the image. |
| **Hardware / scaling (TP)** | Automatic from the visible GPUs for standard `*/server`. Pinned to TP2 for `server-perf` | `--tensor-parallel-size N` | A pinned TP=N profile needs N visible `device_ids`. Merely exposing N GPUs does not guarantee automatic selection will use all of them. |
| **Context length** | Fixed at `32768` by `NIM_MAX_MODEL_LEN` in the stock Compose files | `--max-model-len` | To change the NIM value, use a Compose override or edit the matching Compose service. Larger context costs more KV-cache VRAM. |
| **Concurrency** | `LLM_MAX_NUM_SEQS` (default `256`) | `--max-num-seqs` (`256` in the Lightning recipe) | Maximum concurrent sequences. Nemotron models are a hybrid **Mamba** model, so each sequence draws one state block from the cache. If startup fails CUDA-graph capture, lower this, for example to `64`–`128`. |
| **Explicit profile** | Automatic for standard `*/server`. Pinned for `server-perf` | n/a | Add `NIM_MODEL_PROFILE=<id-or-description>` to a Compose override to pin a custom profile. |

**Cascaded NIM sizing (`nvidia-llm`).** Weight memory depends on the profile NIM selects. Confirm the selected precision and memory footprint in the startup logs and support matrix. The default `NIM_KVCACHE_PERCENT=0.6` targets one ~80 GB GPU shared with ASR (~15 GB) and TTS (~14 GB). On a smaller supported GPU, move ASR/TTS to a second card (their `device_ids`) and raise `NIM_KVCACHE_PERCENT` only after verifying that the selected LLM profile still fits.

**Lightning vLLM sizing (`nvidia-llm-vllm-lightning`).** The Single-GPU service loads `nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4` on every supported GPU. Blackwell workstations, DGX Spark, and Jetson Thor serve native NVFP4. Hopper and Ada serve the same checkpoint as W4A16 through Marlin (`--quantization modelopt_fp4`).

**Streaming input (`nemotron-lightning-streaming`).** The Lightning vLLM service also serves a text StreamingInput WebSocket at `ws://nvidia-llm-vllm:8000/v1/streaming-session`, next to chat completions. With this catalog entry, the Generic Assistant prefills every ASR update while the user speaks, so the answer starts from a warm KV cache. Select it in the Services tab or set it as the example's `llm` default in `examples_registry.yaml`.

**Omni vLLM sizing (`nvidia-llm-vllm-omni`).** The Single-GPU service selects NVFP4, FP8, or BF16 from the supported GPU compute capability. On DGX Spark and Jetson Thor, it also caps free memory using the host's `MemAvailable` value before calculating utilization. Increase `VLLM_VRAM_HEADROOM_MIB` when more memory must remain available for TTS or the system.

**Pick a NIM model profile.** Standard `*/server` leaves `NIM_MODEL_PROFILE` unset, and NIM chooses a compatible profile from the detected GPU and manifest. Use `NIM_MODEL_PROFILE` only for an explicitly pinned custom deployment. The `server-perf` recipe pins `vllm-nvfp4-tp2-pp1-18.0`, selected and benchmarked on two RTX PRO 6000 Blackwell GPUs. This is an RTX PRO 6000 benchmark baseline, not a portable recommendation. Before running the recipe on another target such as H100, list profiles using the deployed image and actual GPU assignment, benchmark compatible TP2 candidates for TTFT, inter-token latency, and throughput per GPU, then replace the pin with the winner's exact ID or full description. Leave the variable unset when portability is preferred.

For standard `*/server`, inspect the image on its visible LLM GPU:

```bash
docker run --rm --gpus '"device=0"' \
  -e NGC_API_KEY="$NVIDIA_API_KEY" \
  nvcr.io/nim/nvidia/nemotron-3.5-lightning-30b-a3b:2.0.9-variant \
  list-model-profiles
```

For `server-perf`, inspect the same image with its TP2 GPU assignment:

```bash
docker run --rm --gpus '"device=2,3"' \
  -e NGC_API_KEY="$NVIDIA_API_KEY" \
  nvcr.io/nim/nvidia/nemotron-3.5-lightning-30b-a3b:2.0.9-variant \
  list-model-profiles
```

For an Omni `*/server` deployment, use its checked-in image and visible GPU:

```bash
docker run --rm --gpus '"device=0"' \
  -e NGC_API_KEY="$NVIDIA_API_KEY" \
  nvcr.io/nim/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:2.0.4-variant \
  list-model-profiles
```

> Profile naming, the selection priority chain, and `NIM_MODEL_PROFILE` are documented in **[NIM model profiles and selection](https://docs.nvidia.com/nim/large-language-models/latest/deployment/model-profiles-and-selection.html)**.

## Reasoning, Parser & Tool Calling

### Reasoning (Thinking) On/Off

Nemotron LLMs support a chain-of-thought "thinking" mode, controlled per catalog entry through `extra_params`, forwarded to the model as `extra_body`:

```yaml
llm:
  # Reasoning OFF: lowest latency (recommended default for spoken pipelines)
  nemotron-lightning:
    model_id: "nvidia/nemotron-3.5-lightning-30b-a3b"
    extra_params: '{"extra_body":{"chat_template_kwargs":{"enable_thinking":false}}}'

  # Reasoning ON: better on complex tasks, higher time-to-first-response
  nemotron-lightning-reasoning:
    model_id: "nvidia/nemotron-3.5-lightning-30b-a3b"
    extra_params: '{"extra_body":{"chat_template_kwargs":{"enable_thinking":true},"reasoning_budget":16384}}'
```

For spoken pipelines, prefer reasoning **OFF**, since thinking adds latency before the first spoken token. Turn it **ON** for complex tool/agent tasks where the quality gain outweighs the delay. Select a variant from the Services tab or set the default in [`examples_registry.yaml`](../../examples_registry.yaml).

### Reasoning Parser & Tool Calling (Self-Hosted)

Cloud (NVCF) endpoints enable the parsers server-side. **Self-hosted NIM and vLLM do not enable them by default**, so the repo's `docker/docker-compose.nemotron3-*.yaml` set them for you:

| Capability | Flag | Why |
|------------|------|-----|
| Reasoning parser | `--reasoning-parser nemotron_v3` | Separates `<think>` reasoning from `content`, so TTS speaks only the answer and reasoning-OFF works. |
| Tool calling | `--enable-auto-tool-choice --tool-call-parser qwen3_coder` | Enables OpenAI-style function calling. Without it, `tool_choice:"auto"` returns `HTTP 400`. |

- **NIM** receives them through `NIM_PASSTHROUGH_ARGS`, which is already fixed in the Lightning and Super Compose files.
- **Raw vLLM** (single-GPU or Omni) takes the same flags directly on `vllm serve`.

## LLM Session Controls

The Astra client exposes role-specific large language model (LLM) request
settings. Select **LLM settings** beside the microphone button to open it,
or select **LLM settings** from **Tools** before starting. **Audio settings** remains dedicated to your
microphone and speaker devices.

The panel separates the supported roles as follows:

| Example | Role Controls | Model |
| --- | --- | --- |
| Generic Frontend/Backend Agent | Frontend · Talker, Backend · Thinker | Catalog-selected Lightning Talker and Super Thinker |
| Omni Assistant Subagents | Speaker, Thinker, Media Analyzer, Webcam | Catalog-selected Nemotron Omni, shared across the roles |

Each role displays its deployed defaults. Generic's Talker defaults to
`temperature: 0.0` and `max_tokens: 512`; its Super Thinker defaults to
`temperature: 0.0` and `max_tokens: 2048`. Omni defaults come from its service
catalog and worker configuration. The panel does not switch models, endpoints,
or reasoning modes.

You can change the following parameters independently for each role:

| Parameter | Accepted Values | Effect |
| --- | --- | --- |
| `temperature` | `0`–`2` | Controls sampling variation. Zero favors a deterministic response. |
| `top_p` | `0.000001`–`1` | Limits candidates by cumulative probability. |
| `max_tokens` | Integer `64`–`32,768` | Caps generated tokens, including model reasoning where applicable. |
| `top_k` | `-1`, or integer `1`–`1,000` | Disables the cutoff with `-1`, or limits the candidate count. |
| `repetition_penalty` | `0.1`–`2` | Values above `1` discourage repeated tokens. |
| `presence_penalty` | `-2`–`2` | Positive values discourage tokens already present. |
| `frequency_penalty` | `-2`–`2` | Positive values discourage frequently repeated tokens. |

Temperature, top-p, and maximum tokens appear in the main controls. Open the
advanced controls for the remaining parameters. The server rejects unknown
roles, unknown parameters, invalid types, nonfinite values, and out-of-range
values. An inference service can impose tighter output or context limits.

Top-k `1` makes sampling effectively greedy. Temperature and top-p have little
effect while that setting selects only the leading candidate. The Omni catalog
uses top-k `1` by default; choose `-1` or a larger value to allow more candidates.

A token limit is not a word limit. Very small limits can truncate a structured
Talker response, a backend plan, media analysis, or a reasoning pass. Keep enough
tokens for the role's output contract and adjust prompt instructions for shorter
speech. Existing reasoning settings and planner validation continue to apply.

### Save and Apply Changes

Before starting, select **Save settings** to retain edits separately for each
example in browser localStorage. Saved settings accompany the next session start
or reconnect. Browser storage is
specific to your profile and origin; it does not change deployment catalogs or
another user's sessions.

During a conversation, select **Apply to session** and wait for the server's
acknowledgement. A successful update also saves settings for later sessions.
The revision advances when the update succeeds. Future model
requests use the new values. In-flight requests keep the values captured when
they began; applying settings does not restart the conversation or interrupt
current speech. Each Omni worker snapshots its own settings before an inference
request.

**Reset** restores one role and **Reset all** restores every role in the draft.
Select **Save settings** before starting, or **Apply to session** while connected,
to retain the reset. Closing the panel discards unapplied changes. If another
client changes the session first, the server rejects a stale revision. Close and
reopen the panel to load current settings, review your edits, and apply again.
Closing the session removes its live settings state.

### Session API

The backend provides the following endpoints:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/llm-settings?pipeline_mode=<example-key>` | Returns supported roles and deployed defaults. |
| `GET /api/sessions/{session_id}/llm-settings` | Returns the active session settings and revision. |
| `PUT /api/sessions/{session_id}/llm-settings` | Applies a validated update against the expected revision. |

Session creation accepts a bounded, structured `llm_settings` mapping keyed by
role. Generic uses `frontend` and `backend`; Omni uses `speaker`, `thinker`,
`media`, and `webcam`. The same validation applies before creation and during
live updates. A PUT body contains only `settings` and the expected `revision`.
The server returns HTTP `400` for invalid input, `409` for a stale revision, and
`404` after the live settings state ends or expires. PUT bodies are limited to
16 KiB.
Only sampling fields cross this boundary; model IDs, credentials, endpoints,
tools, and reasoning modes retain their existing configuration paths.

Redis shares live settings across application replicas. The process-local store
supports deployments without Redis. A live WebSocket remains on its owning
replica, and the runtime reads the shared settings before each new model request.
Refer to [Configure Services](configure-services.md) for persistent catalog
changes.

## Tuning LLM Request Parameters

LLM request parameters are set per catalog entry using `extra_params`, a JSON string merged into each chat-completion request. OpenAI-standard fields (`temperature`, `top_p`, `max_tokens`) go at the top level of `extra_params`. vLLM/NIM extensions (`repetition_penalty`, `chat_template_kwargs`) go under `extra_body`. Use the following structure to set default sampling in the `llm:` section of `services.cloud.yaml` or `services.local.yaml`:

```yaml
llm:
  nemotron-lightning:
    name: "Nemotron 3.5 Lightning 30B A3B"
    model_id: "nvidia/nemotron-3.5-lightning-30b-a3b"
    base_url: "https://integrate.api.nvidia.com/v1"
    extra_params: '{"temperature":0.6,"top_p":0.95,"max_tokens":1024,"extra_body":{"repetition_penalty":1.05,"chat_template_kwargs":{"enable_thinking":false}}}'
```

| Parameter | Where | Typical | Effect |
|-----------|-------|---------|--------|
| `temperature` | top level | `0.6` | Lower = more deterministic, higher = more varied. |
| `top_p` | top level | `0.95` | Nucleus-sampling cutoff. |
| `max_tokens` | top level | `512`–`1024` | Caps response length to keep spoken replies short and latency bounded. |
| `repetition_penalty` | `extra_body` | `1.05` | `> 1` discourages repeated phrasing. |
| `chat_template_kwargs.enable_thinking` | `extra_body` | `false` | Reasoning on/off. |

> Catalog defaults retain `repetition_penalty: 1.05` and the role-specific
> `enable_thinking` setting. Keep default sampling in the service catalog. Use
> [LLM Session Controls](#llm-session-controls) for supported role-specific UI
> and live session overrides.

## Reference

- [Troubleshooting guide](../06-troubleshooting.md): self-hosted startup/runtime failures (tool-parser `HTTP 400`, reasoning leaking into speech, `nemotron_v3` parser not found, CUDA-graph / precision aborts) and cloud rate limits (`HTTP 429`).
- [Configure Services](configure-services.md): how the catalog is loaded, switched, and overridden.
- [NIM for LLMs documentation](https://docs.nvidia.com/nim/large-language-models/latest/): [support matrix](https://docs.nvidia.com/nim/large-language-models/latest/reference/support-matrix.html), [model profiles and selection](https://docs.nvidia.com/nim/large-language-models/latest/deployment/model-profiles-and-selection.html), [GPU memory / OOM troubleshooting](https://docs.nvidia.com/nim/large-language-models/latest/troubleshooting/memory.html).
- [vLLM documentation](https://docs.vllm.ai/en/latest/): `vllm serve` flags, quantization, and the OpenAI-compatible server reference.
- [Pipecat NVIDIA LLM service](https://github.com/pipecat-ai/pipecat/blob/main/src/pipecat/services/nvidia/llm.py): `NvidiaLLMService`.
