# Deployment Topologies

## Contents

1. [Plane Separation](#plane-separation)
2. [Complete Voice Agent](#complete-voice-agent)
3. [Replica and Session State](#replica-and-session-state)
4. [Realtime Evaluation Stack](#realtime-evaluation-stack)
5. [Standalone and Dedicated Functions](#standalone-and-dedicated-functions)
6. [Astra UI](#astra-ui)
7. [Overlay and Rollout Rules](#overlay-and-rollout-rules)

## Plane Separation

The complete service spans:

```text
browser
  -> Astra nginx/UI
     -> NVCF HTTP invocation host for /api and /health
     -> NVCF streaming gateway for WebSocket
        -> voice-agent application Service
           -> ASR, Talker/Thinker or Omni, TTS
           -> Redis and SeaweedFS when replica-safe capture/media are enabled
           -> external weather, stock, web, and NGC services
```

The application, model NIMs, shared state, UI proxy, and control plane have separate logs,
health, credentials, and scaling limits.

## Complete Voice Agent

The checked-in full chart contains:

| Role | Checked-in image/version | Resource role |
|---|---|---|
| application | main app `2.0.67` base / `2.0.68` Viking overlay | five CPU replicas |
| prewarmer | matching app image | deep model warmup |
| Nemotron ASR | streaming `1.2.0` | one GPU |
| Lightning Talker | `2.0.9-variant` | one GPU |
| Super Thinker | `2.0.5` | two GPUs |
| Omni | `v0.20.0-cu130-r2` | one GPU |
| Magpie | `1.10.0` | one GPU |
| Chatterbox | `1.1.0` | one GPU |
| Redis | `7.2.4-debian-12-r12` | shared coordination/media state |
| SeaweedFS | `4.41` | shared session-capture artifact staging |

The full model topology uses seven of eight H100s: ASR 1, Lightning 1, Super 2, Omni 1,
Magpie 1, and Chatterbox 1. Treat the eighth GPU as headroom unless a reviewed release
assigns it.

The serving NVCF function uses `OCI.GPU.H100_8x`. Viking historically used the same model
layout and five application replicas.

## Replica and Session State

A live WebSocket and its Pipecat context remain process-local. The application does not
migrate a socket between replicas.

Redis shares sanitized session configuration, media state/streams, and capture coordination.
SeaweedFS provides a shared S3-compatible store for capture artifacts. Ordinary Kubernetes
Service balancing is sufficient because shared state replaced the abandoned
StatefulSet/session-affinity router.

Durability boundaries:

- Redis has no persistence in the checked design and uses an eviction policy.
- SeaweedFS uses an ephemeral `emptyDir` by default.
- successful NGC upload is the durable capture archive.
- a Redis/SeaweedFS restart can lose in-flight coordination or failed-upload source
  evidence.

Do not call this topology highly available without qualifying those limits.

The NVCF app process owns capture finalization and NGC CLI upload. Sidecar/PVC designs were
removed because NVCF sidecars and Kubernetes API assumptions were not reliable.

## Realtime Evaluation Stack

The dedicated Realtime Generic FBA chart intentionally reduces the topology:

- one application replica;
- Nemotron ASR;
- Magpie;
- Lightning Talker;
- Super Thinker; and
- prewarmer.

It disables:

- session capture;
- Redis;
- SeaweedFS/session store;
- Omni;
- Chatterbox;
- unrelated booking/tool services; and
- multiple application replicas.

This is appropriate for an isolated evaluation endpoint, not a production replacement for
the complete replica-safe chart.

## Standalone and Dedicated Functions

The standalone Lightning function runs only Lightning and exposes the OpenAI-compatible
chat-completions route.

Dedicated ASR, Magpie, and Chatterbox functions are container-backed NVCF functions. They
are not the embedded NIM pods from the complete chart and have their own images, function
IDs, scaling, and qualification.

Do not count a dedicated endpoint's GPU as part of the eight-GPU complete function. Do not
change a dedicated endpoint when an embedded chart model is the actual consumer.

## Astra UI

Astra runs only the UI/nginx container. It does not run ASR, LLM, TTS, Redis, SeaweedFS, or
the application pipeline.

The proxy selects the backend at startup using Vault-managed values. The built image remains
function-agnostic. This separation allows one qualified UI digest to be promoted while
environment-specific Vault targets differ.

Astra OpenShift runs arbitrary non-root UIDs. The Dockerfile makes nginx configuration and
static files group-0 writable and listens on 7860.

## Overlay and Rollout Rules

Render the exact environment overlay. Base values, `appVersion`, Viking override, and
NVCF deployment configuration can intentionally differ.

For an app/UI-only release:

- preserve model pod UIDs in Viking;
- keep NIM images and chart resource requests unchanged;
- roll only app replicas, prewarmer, and UI/proxy as required; and
- verify no chart default accidentally enables a disabled workload.

For a model change:

- recalculate GPU fit;
- validate profile selector, model alias, parsers, context/KV parameters, and prewarm;
- expect a cold pull/start; and
- run model-specific functional/load gates.

Never copy the Realtime minimal overlay into the complete main function or the full
production values into a one-GPU standalone function.
