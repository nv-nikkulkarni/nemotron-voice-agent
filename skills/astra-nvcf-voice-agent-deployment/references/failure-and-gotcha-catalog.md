# Failure and Gotcha Catalog

## Contents

1. [Artifact and Registry](#artifact-and-registry)
2. [NVCF Version and Deployment](#nvcf-version-and-deployment)
3. [Secrets and Authentication](#secrets-and-authentication)
4. [Models and GPU Capacity](#models-and-gpu-capacity)
5. [HTTP, WebSocket, and Astra](#http-websocket-and-astra)
6. [Storage, Replicas, and Capture](#storage-replicas-and-capture)
7. [Release and Cleanup](#release-and-cleanup)
8. [Diagnostic Rules](#diagnostic-rules)

## Artifact and Registry

| Gotcha | Consequence | Prevention |
|---|---|---|
| chart published before image | NVCF pulls a missing tag | push and inspect image first |
| Helm uploaded as generic resource | 403/404 confusion; NVCF cannot consume it | use `ngc registry chart push` |
| wrong `--source` shape | upload fails or picks wrong file | use the directory containing the packaged chart |
| experimental artifact in main repository | production namespace polluted; cleanup risky | dedicated image/chart repositories |
| reused immutable tag | qualification no longer identifies bytes | new patch version for every rebuild |
| cross-repository layer mount | subscription-gated layer can fail on NVCF | verify native pull and digest |
| ARM64-only image | NVCF AMD64 pull/run failure | build and inspect Linux AMD64 |
| invalid OCI source label | artifact cannot be traced to Git | verify full SHA resolves before push |
| chart/base/overlay tag drift | wrong image in target environment | render the exact target values |
| Artifactory auth missing | Astra UI cannot pull | restore auth; do not silently change registry |

A 403 often indicates scope. A 404 can indicate wrong org/name, absent artifact, or wrong
artifact type. Inspect the target and CLI command before creating a replacement resource.

## NVCF Version and Deployment

| Gotcha | Consequence | Prevention |
|---|---|---|
| version confused with deployment | false serving-state report | query both APIs |
| version secrets assumed inherited | tools/models/capture fail | supply complete set every version |
| chart Service name wrong | NVCF cannot route inference | match rendered Service exactly |
| health timeout omitted | version creation can return 400 | provide verified `PT10S` contract |
| `ACTIVE` treated as Ready | first request fails | inspect instance/pods/models and run smoke |
| shallow readiness enabled | model not loaded when app starts | deep readiness and prewarmer |
| cold eight-NIM pull exceeds progress window | deployment errors despite valid image | preserve old version; retry only with evidence |
| version ceiling reached | create returns generic 400 | inventory versions; authorize exact inactive deletion |
| H100 quota exceeded | deployment rejected | preserve serving version; request capacity/downtime |
| two active stateful versions | routing ambiguity and invalid SQA | qualify one exact version; retire only by plan |
| in-place restart/update | active WebSockets drop | prefer new immutable version |

A deployment update can be useful for a safe configuration change, but it weakens immutable
lineage. Do not make it the default production release mechanism.

## Secrets and Authentication

| Gotcha | Consequence | Prevention |
|---|---|---|
| one nested `secrets` object | expected top-level keys absent | individual NVCF secret entries |
| org registry key used for runtime logs | instance API denied | use approved personal/runtime authorization |
| invocation key used for NGC upload | chart/resource 403 | dedicated scoped NGC key |
| key pasted in chat reused | exposed credential remains live | rotate and update approved stores |
| literal key in values/image/bundle | permanent disclosure | Vault/version secrets only |
| `fusion vault get` captured | secret values printed | avoid unless names-only mode is verified |
| tool key missing on one replica | intermittent tool failures | consistent Deployment/version injection |
| expired `SQA_KEY` | all oracle calls fail 403 | fix harness auth before product RCA |
| stale Fusion token | inaccurate Astra assumptions | `fusion auth`, reauthenticate |

Do not resolve an auth failure by disabling application authentication.

## Models and GPU Capacity

| Gotcha | Consequence | Prevention |
|---|---|---|
| invalid NIM profile selector | crash loop after license text | use published selector and inspect logs |
| hardcoded GPU visibility | NVCF-assigned GPU inaccessible | let device plugin assign resources |
| Super KV/context too large | engine startup OOM/crash | bounded verified context, sequences, KV |
| served model alias mismatch | app/prewarm 404 | one alias in model, catalog, app, prewarmer |
| guided JSON not prewarmed | first Omni response stalls | prewarm `response_format=json_object` |
| TTS batch size treated as concurrency | wasted memory/no throughput gain | test both controls independently |
| Magpie batch 64 on 79 GiB | little memory headroom | canary, observe VRAM/OOM/latency |
| Chatterbox co-located with full stack | GPU memory pressure | dedicated GPU |
| pronunciation dictionary sent to Chatterbox | unsupported behavior | dictionary only for Magpie |
| app-only change rolls NIMs | avoidable cold start/risk | preserve model pod UIDs |

Model-image pull, model-engine startup, app readiness, and user-visible latency are distinct
phases.

## HTTP, WebSocket, and Astra

| Gotcha | Consequence | Prevention |
|---|---|---|
| HTTP invocation host used for browser WS | 200 instead of 101 | streaming gateway for WS |
| browser cannot set NVCF headers | 401/403 | trusted server-side nginx proxy |
| stale NVCF request cookie | 404/1006 after redeploy | strip Cookie and Set-Cookie |
| `/health` returns SPA HTML | false health pass | validate body/content type |
| UI tag new, Vault target old | new UI on old backend | verify both identities |
| backend new, UI old | missing controls/contracts | promote matching UI digest |
| Argo Healthy/Synced treated as SQA | user behavior unverified | HTTP/WS/voice and full gates |
| Vault path identity mismatch | ExternalSecret 503/missing env | align app/repo/role/store/path |
| environment stickiness | mutation hits wrong env | verify platform and `stg`/`prd` |
| blank exported NSPECT field | false promotion-failure conclusion | inspect Fusion task audit |
| feedback URL exposed to browser | sensitive configuration leak | server-side nginx env only |
| sample-rate mismatch | slow/low-pitched audio | use advertised input/output rates |

Astra production is a separate cluster/Vault/role/ingress boundary. A `stg` hostname is
not production even if it targets the main NVCF function.

## Storage, Replicas, and Capture

| Gotcha | Consequence | Prevention |
|---|---|---|
| zone-locked RWO cache volume | pod stuck `ContainerCreating` | supported `emptyDir` cache |
| process-local media with five replicas | webcam/capture misses | Redis/SeaweedFS shared design |
| Redis absent with replicas | session/config leakage or loss | enforce replica-safe topology |
| SeaweedFS `emptyDir` restart | retained failure artifacts lost | acknowledge durability boundary |
| capture destination absent but required | app startup fails | provide `SESSION_CAPTURE_NGC` |
| capture key lacks registry scope | upload 403 | dedicated `NGC_API_KEY` |
| fire-and-forget browser capture | End/browser-close loses report | coordinator, acknowledgment, retry |
| session-affinity router restored | NVCF incompatibility | ordinary Service plus shared state |

The Realtime evaluation function intentionally omits capture, Redis, SeaweedFS, and multiple
replicas. Do not copy that minimal topology into the complete production function.

## Release and Cleanup

| Gotcha | Consequence | Prevention |
|---|---|---|
| serving version removed for capacity | downtime | explicit authorization and outage plan |
| all inactive versions deleted | no rollback | retain one qualified immutable version |
| artifact deleted before version | rollback cannot start | resolve all references first |
| wildcard registry cleanup | unrelated versions lost | exact repository and version |
| stale branch used by path habit | wrong source released | branch/head/worktree preflight |
| dirty worktree build | unreproducible image | committed archive |
| build evidence mistaken for qualification | unsafe promotion | named smoke and SQA state |
| old raw evidence committed | repo bloat/secrets | concise reports; raw outside Git |

The main function had no inactive rollback in the October 02 inventory. Recreate rollback
before risky backend changes.

## Diagnostic Rules

- Preserve request IDs and exact timestamps.
- Reproduce one minimal path before broad SQA.
- Read the first failing container, not only the app container.
- Separate input-ASR, product, provider, and oracle failures.
- Do not introduce an intent router to compensate for model/prompt behavior.
- Do not redeploy TTS for an app-level pronunciation dictionary change.
- Do not change a server sample rate to compensate for a browser playback bug.
- Do not treat a transient UI badge as the durable tool-result record.
- Do not expose prompts/internal endpoints while projecting `/api/deployment`.
- Do not claim current state from this catalog; refresh the control plane.
