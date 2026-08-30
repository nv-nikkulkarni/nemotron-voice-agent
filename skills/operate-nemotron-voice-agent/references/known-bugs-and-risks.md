# Known Bugs and Risks

## Contents

1. [Release Status Risks](#release-status-risks)
2. [Architecture Risks](#architecture-risks)
3. [Model and Agent Risks](#model-and-agent-risks)
4. [Media, Capture, and Storage Risks](#media-capture-and-storage-risks)
5. [TTS and Audio Risks](#tts-and-audio-risks)
6. [Platform and Operational Risks](#platform-and-operational-risks)
7. [Risk Closure Rules](#risk-closure-rules)

## Release Status Risks

These statements describe the last checked-in evidence as of August 30, 2026. Reverify
before reporting live status.

| Risk | Last Recorded State | Closure |
|---|---|---|
| Retained production was not fully SQA-green | chart `0.1.103` had three P0 defects | qualify a newer exact artifact through every gate |
| Isolated `-2` staging is rejected | recorded deployment remained on `0.1.115` | deploy only a fully Viking-qualified candidate and rerun staging |
| Latest checked-in source is not deployed | `0.1.123`/`2.0.51` updates both TTS NIMs but is unbuilt and unqualified | package the chart, then run Viking full qualification before staging |
| One matrix pass can be overstated | `0.1.120` passed repeated-tool and automated pronunciation only | complete comprehensive, corner, barge-in, failure, safety, webcam, capture, reconnect, and listening |
| True Astra production does not exist | retained live UI used Astra `stg` infrastructure | create a separate Astra `prd` deployment with required governance |

Do not collapse these into “production is good” or “staging is current.”

## Architecture Risks

### Live WebSocket Is Process-Local

Redis does not migrate a socket or LLM context. A pod loss ends that session. Reconnect
creates a new session ID and context.

### App Rollout Can Interrupt Calls

The app Deployment uses `Recreate`. Prefer immutable NVCF versions and cutover after warm
smoke. An in-place Viking roll is acceptable for qualification with known session loss.

### Single-Replica Model Services

Five app replicas share single ASR, Lightning, Omni, Magpie, and Chatterbox services and a
two-GPU Super service. Edge concurrency of 100 is not demonstrated capacity. Saturation can
appear first as planner timeouts, speech latency, or unfair queues.

### No Intent Router

This is an invariant and a limitation. The system depends on Talker adherence. Liveness and
grounding guards fail closed but cannot guarantee model selection on every unseen phrasing.
Use repeated real-audio matrices rather than adding hidden Python routing.

## Model and Agent Risks

### Lightning Prewarm Gap

The recorded prewarmer has no explicit Lightning generation target. Deep readiness prevents
a doomed session, but the first Lightning request can still pay cold-generation cost.

### Smart Turn Variability

Smart Turn can split at natural pauses or wait for the fallback. Generic Frontend/Backend
adds a 0.5-second VAD delay, and Omni can merge a quick unheard continuation. Real accents,
noise, and pacing still require audio testing.

### Cached and Repeated Result Guards

The guards cover empty output, substantial replay, and explicit-repeat subject drift. They
do not infer intent. New phrasing outside the explicit repeat vocabulary can still rely on
model behavior. Expand tests before expanding Python matching.

### Safety Is Prompt and Model Dependent

The prompt explicitly covers major categories, but no external safety classifier is in this
custom path. Verify isolated black-box safety after model or prompt changes.

### External Provider Dependence

WeatherAPI, Finnhub, and Perplexity introduce quota, latency, and credential risk. The app
fails closed but degraded upstreams reduce live capability.

## Media, Capture, and Storage Risks

### Redis Is Ephemeral and Memory-Bounded

Redis has no persistence and a 256 MiB `allkeys-lru` policy. Large or concurrent media can
evict session configuration or capture state. Monitor memory and tune payload/ring/TTL or
capacity based on load evidence.

### SeaweedFS Uses EmptyDir

A SeaweedFS restart loses in-flight and retained source artifacts. NGC remains durable after
successful upload. A stronger recovery service-level agreement requires a supported durable
shared store.

### Redis and SeaweedFS Authentication

The current chart relies primarily on cluster-network isolation. Redis permits an empty
password, and SeaweedFS does not generate a strong S3 identity configuration. Do not expose
either service.

### Capture Acknowledgement Is Not Upload Completion

`captureFlushed=true` proves the POST received HTTP 2xx. It does not prove both signals,
artifact presence, finalizer success, or NGC upload. Correlate exact session IDs.

### Multiple Reapers

Every app replica runs a reaper. Token-owned Redis locks make finalization idempotent, but
Redis outages or TTL expiry can complicate diagnosis. Preserve state before manual cleanup.

## TTS and Audio Risks

### Broad Pronunciation Registry

The registry contains many brands, people, tickers, cities, and countries. A mapping that
fixes one exact-word probe can degrade natural sentences. Human listening remains mandatory.

### Chatterbox Exclusion

Chatterbox receives no custom pronunciation dictionary. Its pronunciation issues require
model-supported controls or different text handling, not the Magpie IPA registry.

### Sample-Rate Contract

A future UI that instantiates WebSocket audio before deployment metadata loads can re-create
slow, low-pitched speech. Keep the deployment metadata gate and regression coverage.

### Acoustic Barge-In

Protocol interruption can pass while a short buffered tail remains audible. Keep a measured
acoustic tolerance and test multiple iterations.

## Platform and Operational Risks

### Relaxed NIM Readiness

`nimReadyImmediate=true` can make NVCF appear ready while a model is still loading. Use deep
session config and real audio.

### H100 Capacity

Side-by-side eight-H100 versions can fail to schedule. Never delete the active version
without downtime authorization.

### Image Subscription and Mirroring

A successful push does not prove a self-contained image. Cross-repository layer mounts can
remain gated. Verify pull and container creation on the target platform.

### Fusion Authentication and Consumer Visibility

Expired Fusion auth blocks authoritative Astra/Vault inspection. Preserve potentially active
values files until a live consumer check succeeds.

### Limited NVCF Pod Visibility

Some failures require instance pod lists, events, or logs. A high-level function error is
insufficient to distinguish scheduling, image pull, model startup, readiness, or app runtime.

### UI and Function Can Drift Independently

Astra UI digest, Vault function ID, NVCF chart, and app image can all differ. Always report
the four identities separately.

## Risk Closure Rules

Close a risk only with evidence at the owning boundary:

- model risk: repeated real-audio and load evidence;
- cross-replica risk: simultaneous distinct-session evidence;
- capture risk: exact session-to-NGC correlation;
- pronunciation risk: exact-word and natural-sentence human listening;
- deployment risk: immutable artifact, live control-plane, functional smoke, and SQA;
- security risk: secret scan plus live injection boundary review.

Update this file only for durable risk knowledge. Put a single candidate's raw result in a
dated SQA report.
