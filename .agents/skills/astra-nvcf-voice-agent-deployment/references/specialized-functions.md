# Specialized Functions

## Contents

1. [Isolation Rules](#isolation-rules)
2. [Dedicated Speech Functions](#dedicated-speech-functions)
3. [Standalone Lightning](#standalone-lightning)
4. [Realtime Generic Frontend/Backend](#realtime-generic-frontendbackend)
5. [Client Authentication](#client-authentication)
6. [Scaling and Batch Size](#scaling-and-batch-size)
7. [Qualification Boundaries](#qualification-boundaries)

## Isolation Rules

The project operates several NVCF products:

- the complete main voice-agent chart;
- a Realtime Generic Frontend/Backend evaluation function;
- a standalone Nemotron Lightning function; and
- dedicated ASR, Magpie, and Chatterbox container functions.

They are not versions of one interchangeable product. Keep function IDs, images, charts,
routes, service names, secrets, GPU shapes, and qualification records separate.

The Realtime function must use dedicated image and chart repositories. Dedicated speech
wrappers use dedicated image repositories. Do not publish them into
`nemotron-voice-agent`, which is the main production artifact namespace.

## Dedicated Speech Functions

The dedicated functions use custom wrapper images and are independent of the ASR/TTS
pods embedded in the complete chart. The original deployment used one H100 per function.
Subsequent H200 versions and smoke evidence are recorded in the
[October 08 Deployment Handoff](deployment-handoff-2026-10-08.md).
Refresh deployment placement before reporting the currently serving hardware.

Clients connect with TLS:

```text
grpc.nvcf.nvidia.com:443
```

and metadata:

```text
authorization: Bearer <invocation-authorized NVIDIA API key>
function-id: <dedicated function ID>
```

The wrapper reads its NGC credential from the mounted version secret, maps it into the
upstream NIM environment, never logs it, and fails closed when absent.

A fresh `develop` clone already supports the NVCF gRPC mechanism but historically points
to older shared NVIDIA function IDs. To use dedicated functions, update only the example
service catalog IDs and retain the shared profile as explicit rollback.

Require one real streaming ASR request and one synthesis request per TTS. `ACTIVE` is not
functional qualification.

## Standalone Lightning

The standalone function exposes an OpenAI-compatible route:

```text
POST https://<function-id>.invocation.api.nvcf.nvidia.com/v1/chat/completions
```

with `Authorization` and `function-id` headers. Its health route is
`/v1/health/ready` on port 8000.

It uses the `nemotron-lightning` Service in the Helm chart with all unrelated workloads
disabled. Verify the chart configuration because the currently deployed standalone
function historically reused the main chart repository/version, even though it is a
separate function.

Qualification requires:

- model-ready endpoint;
- accepted served model ID;
- non-streaming and streaming text;
- native tool call with correct arguments;
- reasoning content absent when thinking is disabled;
- concurrency and timeout behavior; and
- no dependency on main voice-agent secrets or routes.

## Realtime Generic Frontend/Backend

This function hosts the voice-agent pipeline through an OpenAI Realtime-compatible
WebSocket route:

```text
/v1/realtime
```

It has a dedicated NGC image repository and dedicated Helm chart repository. Its minimal
stack intentionally excludes session capture, Redis, SeaweedFS/session store, multiple app
replicas, Omni, Chatterbox, and unrelated product tools unless the evaluation explicitly
requires them.

Its chart can include:

- one application replica;
- ASR;
- Magpie TTS;
- Nemotron Lightning Talker;
- Nemotron Super Thinker; and
- prewarmer.

Client-owned tools belong to the Thinker/backend. The Talker should see only the
server-owned delegation/cancellation tools. Deployment logs that show Lightning directly
calling an unadvertised client tool indicate an adapter/tool-ownership defect, not success.

The Realtime gateway has two auth boundaries:

1. outer NVCF bearer authorization and function ID; and
2. inner `REALTIME_API_KEY` or approved client-secret/session mechanism.

Proxy bearer coexistence must be explicitly enabled and trusted. Do not disable inner auth
merely because the endpoint is self-hosted.

## Client Authentication

### HTTP or OpenAI-Compatible LLM

Provide:

```text
Authorization: Bearer <NVCF invocation key>
function-id: <function ID>
```

### Browser WebSocket

Use a trusted proxy that injects those headers. Do not embed the key in browser JavaScript.

### Speech gRPC

Provide the same two metadata names on the TLS gRPC channel. Do not share the key in an
endpoint announcement; tell users how to obtain authorized access.

### Realtime API

In addition to outer NVCF authorization, follow the Realtime session auth contract
documented by the adapter. A client secret minted by the gateway is distinct from the
outer key.

## Scaling and Batch Size

NVCF maximum request concurrency and NIM batch profile are separate controls.

The October 02 historical dedicated Magpie deployment used:

- `NIM_TAGS_SELECTOR=batch_size=8`;
- one 79 GiB H100; and
- maximum NVCF request concurrency 8.

The subsequent H200 Magpie smoke used batch 32. A successful request does not qualify
concurrent load. Refer to the October 08 handoff for its version ID.

Magpie 1.10.0 also supports batch 32 and 64 profiles. Batch 64 needs about 74.74 GiB of GPU
memory, leaving little headroom on a 79 GiB H100. It is technically selectable but should
be a new canary version. Raise request concurrency only after measured load shows a benefit.

Measure:

- startup/cold time;
- GPU/host memory and OOM;
- latency to first audio;
- latency between chunks;
- real-time factor/throughput;
- success at 1, 8, 32, and 64 concurrent streams; and
- behavior during scale-to-zero recovery.

For low-latency voice, a larger profile can trade latency and memory for throughput.
Do not assume larger is better.

## Qualification Boundaries

Report specialized functions independently:

```text
function/version/deployment IDs
image or chart identity
instance shape and scale
control-plane state
model health/prewarm
minimal real request
concurrency/load
known untested behavior
```

Do not use a main voice-agent SQA pass to qualify a dedicated endpoint, or a dedicated
endpoint smoke to qualify the embedded NIM in the complete chart.
