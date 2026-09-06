# Incident and Mitigation Ledger

## Contents

1. [How to Use This Ledger](#how-to-use-this-ledger)
2. [Agent and Tool Calling](#agent-and-tool-calling)
3. [Barge-In, Turn Detection, and Audio](#barge-in-turn-detection-and-audio)
4. [Omni Webcam and Media](#omni-webcam-and-media)
5. [Session Capture](#session-capture)
6. [NVCF and Kubernetes](#nvcf-and-kubernetes)
7. [Astra and UI](#astra-and-ui)
8. [SQA Oracle Failures](#sqa-oracle-failures)

## How to Use This Ledger

Use the symptom and root cause to select the owning layer. Verify the current code and live
deployment before applying an old mitigation. “Implemented” means the fix exists in the
current source branch; it does not mean the deployed environment runs or passed that fix.

## Agent and Tool Calling

| Symptom | Root Cause | Mitigation | State |
|---|---|---|---|
| Lightning turn has no tool call and no speech | nondeterministic empty completion | temperature `0.0`; one internal liveness retry; deterministic spoken fallback; structured logs | Implemented, full candidate qualification still required |
| “Repeat that weather” speaks an old value without a new call | Talker replays cached grounded text | remember bounded backend result; detect substantial replay; retry once; fail closed | Implemented |
| Repeat changes Toronto to Pune | model-authored subject drift | retain trusted structured arguments; validate every value on explicit repeats; canonical weather city; bounded retry | Implemented |
| Repeat after a failed/not-found turn uses an older city | stale successful baseline survives newer result | clear baseline on newer failed or subjectless result | Implemented |
| Eight synchronized turns time out in Super planner | large reasoning/output budget under load | temperature `0.0`, maximum 768 output tokens, reasoning budget 256 | Implemented, must load-test |
| Composite weather/stock/news request runs only weather | Talker summarized away operations before Thinker | prompt contract and examples preserve all requested read-only operations in one backend query | Implemented |
| Successful stock tool repeats six times and ends unavailable | second Talker inference re-delegates after async result | speak trusted Python-grounded `response_text` directly; store once in context | Implemented |
| Missing-location weather invents conditions | Talker answers from memory instead of grounding | missing-parameter contract asks for city or delegates so WeatherAPI grounds not-found; oracle permits clarification | Implemented |
| Fictional location produces generic capability answer | Talker misses weather route | explicit Thinker/Talker examples route unknown locations through weather when a location exists | Implemented |
| Unsupported email triggers cancellation | word “complete” or “done” interpreted as withdrawal | require explicit cancel/stop/never-mind intent; refuse side effects directly | Implemented |
| Mixed secret request refuses everything, including safe stock lookup | safe portion not preserved | refuse secret/fabrication portion and delegate already requested safe live-data portion | Implemented |
| Safety answer exposes hidden reasoning or tools | insufficient prompt boundary | refuse secret extraction and hidden-reasoning requests; provide brief policy-level answer; keep internal schemas private | Implemented |
| Crisis answer gives U.S.-only numbers without country | prompt over-specialized to one location | use location-neutral emergency guidance unless country is known | Implemented |
| Misinformation answer only says “cannot verify” | overly hedged safety response | state the evidence boundary and direct to established evidence | Implemented |
| Tool call badge absent although work completed | internal tool event was not propagated or badge is transient | restore `on_tool_started` event; adjudicate composite work from durable results, not badge alone | Implemented |
| Multi-tool turn starts quickly but takes about a minute to finish | overly long response plus TTS playback | cap web result to two sentences and multi-tool result to three short sentences/about 450 characters | Implemented |

Do not fix model nondeterminism by adding a Python intent router. Python can validate an
LLM-authored call but cannot infer the intended domain tool.

## Barge-In, Turn Detection, and Audio

| Symptom | Root Cause | Mitigation | State |
|---|---|---|---|
| User interrupts, next turn succeeds, but old speech continues briefly | buffered browser audio not cleared | call the public media-manager interruption path and clear queued audio | Implemented |
| Barge-in responds “There is nothing pending right now” | backend already completed, so cancellation sees no task | track speech-only interruption separately; acknowledge “Okay, I stopped that” | Implemented |
| Stop plus replacement loses the new request | replacement classified as pure cancellation | route substantive replacement through DIRECT or DELEGATE; obsolete speech already stops | Implemented |
| Barge-in test says pass but old audio tail remains | test checks only new turn registration | add acoustic cutoff oracle and repeat multiple iterations | Required gate |
| Utterance splits at a natural pause | Smart Turn or VAD finalizes early | Smart Turn with 1-second fallback; Frontend/Backend VAD stop delay 0.5 seconds; Omni merges unheard continuation within 2 seconds | Implemented |
| TTS sounds slow, low-pitched, or like the wrong voice | UI player fixed at 16 kHz while backend outputs 22.05 kHz | wait for `/api/deployment` and configure recorder/player from advertised sample rates | Implemented; no TTS redeploy |
| Chatterbox truncates long responses | per-synthesis length/duration cap | aggregate into about 240-character chunks | Implemented |
| Brand, ticker, city, or leader name is unclear | TTS pronunciation variability | rich versioned registry; IPA only to Magpie; exact-word and human-listening qualification | Implemented, listening remains |
| Pronunciation fix seems inactive on Chatterbox | Chatterbox does not support this dictionary contract | intentionally send no dictionary to Chatterbox | By design |

Smart Turn is enabled by default unless `USE_SILERO_VAD_TURN_DETECTION=true`.

## Omni Webcam and Media

| Symptom | Root Cause | Mitigation | State |
|---|---|---|---|
| Webcam POST returns `200`, but speaker says camera unavailable | HTTP request and WebSocket landed on different replicas with process-local frame state | Redis Streams share frames and session state across replicas | Implemented |
| Webcam remains “loading” forever | stateless worker returns `No notable change.` before any baseline; controller discards no-op | pass `previous_observation` and `has_baseline`; require concrete first scene; retry on later frame | Implemented |
| No-change after baseline erases the scene | worker no-op treated as replacement state | retain previous board state after baseline | Implemented |
| Loading view described as unavailable camera | speaker prompt conflates loading and unavailable | explicitly say camera is on and view is loading | Implemented |
| One session sees another scene | session identifiers or stream keys mixed | server-generated session IDs, per-session Redis streams, four-session leakage test | Implemented and gated |
| Image upload is accepted but no description arrives | listener started after upload or died on timeout | `XREAD` from `0`, socket timeout longer than block, bounded retry | Implemented |
| Omni greeting or microphone turn fails with model `404` | vLLM served name differs from app catalog or prewarmer | one stable `omni.servedModelName` across all three | Implemented |
| First Omni greeting takes about 25 seconds | guided JSON grammar compiles on first real Speaker request | prewarm with `response_format=json_object` | Implemented |
| Omni produces empty or semantically ungrounded speech | split/pending media and empty transcript edge cases | preserve pending attachments, bounded continuation, semantic and acoustic validation, retry empty transcript | Implemented |

The failed session-affinity router was a temporary attempt to co-locate media. It is not the
current solution.

## Session Capture

| Symptom | Root Cause | Mitigation | State |
|---|---|---|---|
| Consent POST succeeds but no NGC version | one lifecycle signal lost or finalizer sees no shared artifacts | two-signal Redis state plus SeaweedFS shared store and session correlation | Implemented |
| Capture finalizes with no artifacts and disappears | no-artifact path treated as success | retain diagnosable failure; log terminal outcome | Implemented |
| Browser ends before capture POST completes | fire-and-forget reporting | one in-flight promise per session; wait 1.5 seconds for 2xx; retry once; `keepalive` fallback | Implemented |
| `captureFlushed` always true | teardown reported attempted rather than acknowledged | set true only after server acknowledgement | Implemented |
| Five replicas never finalize a cross-pod capture | Redis state or artifact store is process-local | hard startup requirements: Redis for coordination and S3-compatible shared store for artifacts | Implemented |
| NGC upload times out and evidence is deleted | destructive finalizer cannot tell timeout from accepted upload | retain state and objects after NGC-related retry exhaustion; check NGC before retry | Implemented |
| Wrong key type used for capture upload | invocation key lacks NGC registry permissions | prefer dedicated `NGC_API_KEY` and report key source truthfully | Implemented |
| Capture sidecar/PVC path is opaque on NVCF | sidecar and Kubernetes API assumptions do not hold | move capture and NGC CLI upload into app process | Implemented |
| SeaweedFS restart loses failed capture source | `emptyDir` is ephemeral | NGC is durable after success; preserve risk or adopt a supported durable shared store | Open design tradeoff |
| Redis restart loses coordination | persistence disabled by design | reconnect active users where possible; do not call capture reliable until Redis is healthy | Open design tradeoff |

Terminal outcomes should be explicit: uploaded, declined, abandoned, no-artifacts, or
retained failure.

## NVCF and Kubernetes

| Symptom | Root Cause | Mitigation | State |
|---|---|---|---|
| Pod stuck `ContainerCreating` on a fresh availability zone | RWO OCI block volume is zone-locked | use `emptyDir` for NIM caches and capture staging | Implemented with cold-start tradeoff |
| Router/StatefulSet release never becomes usable | NVCF incompatibility, stable DNS/image uncertainty | return to plain Deployment and Service; share state instead | Router removed |
| Lightning image cannot pull or create | subscription-gated layers or invalid cross-repository mount/manifest | use an actually pullable source or full native copy; verify on NVCF | Operational gotcha |
| Lightning crash-loops after license output | invalid profile selector, custom KV/model limits, or GPU visibility | run vanilla profile, retain required tool/reasoning parsers, let device plugin assign GPU | Implemented chart strategy |
| NVCF stays pending or old version must be removed | H100 capacity exhausted | retain old version if possible; request explicit downtime authorization before undeploying | Operational boundary |
| Function is `ACTIVE`, first request still fails | relaxed readiness or cold model | deep `/api/session-config`, prewarmer, and real voice smoke | Required verification |
| Tool works on some replicas only | provider credential missing from one or more pods/version | inject complete secret set consistently; inspect all replicas | Required verification |
| Lightning tool selection fails though credentials are valid | model adherence/liveness problem | EXPECT_TOOL matrix and Talker logs; do not misdiagnose as provider auth | Diagnostic rule |
| App rollout drops active sessions | `Recreate` and process-local sockets | immutable function-version promotion instead of in-place production roll | Design rule |

NVCF secrets are version-scoped and must be supplied every time.

## Astra and UI

| Symptom | Root Cause | Mitigation | State |
|---|---|---|---|
| UI loads but API is `401/403` | expired or wrong invocation credential in Vault | patch Vault, sync/restart UI, recheck `/api/deployment` | Operational |
| WebSocket gets `200`, `404`, or `1006` | HTTP invocation host used, missing function ID, or stale request cookie | separate streaming gateway route; strip cookies both ways | Implemented |
| Super or Chatterbox pod exists but selector is missing | curated deployment registry does not advertise the service ID | align Helm ConfigMap examples/defaults/options with enabled services | Implemented |
| New deployment cannot be distinguished visually | no UI artifact timestamp | render build/deployed time in small UI text and `/config.js` | Implemented |
| Latency breakdown disappears | Frontend/Backend pipeline did not emit expected observer events | wire latency observer/event output in active pipeline and test through UI | Implemented |
| Secure tunnel warns and asks for username/password | tunnel trust/interstitial or access protection, not app auth | configure the chosen proxy/tunnel; verify direct local UI separately | Operational |
| “Production” Astra URL still contains `stg` | retained UI lives in Astra staging infrastructure while targeting prod NVCF | treat true Astra `prd` as a separate promotion with prd Vault/role/ingress/NSPECT | Open platform task |
| Fusion inspection fails | CLI token expired or wrong environment | run Fusion login/reauth and verify target before mutation | Operational |

## SQA Oracle Failures

| Raw Failure | Actual Cause | Correction |
|---|---|---|
| Atlantis expected not-found | Atlantis is a real WeatherAPI location | use a genuinely non-resolving fictional name |
| Guardrail product failure with missing harmful content | hosted or local query TTS refused, rewrote, or omitted words | deterministic input plus application-ASR term gate |
| Welcome greeting judged as answer | recording started before greeting settled | settle greeting, use unique files, record the tested turn |
| Composite call count too low | transient UI badge missed parallel calls | inspect durable structured result and server logs |
| Long answer appears silent | capture window ended before TTS completed | bounded speech plus settled recording window |
| Dakar/Lagos/city pronunciation failure | independent ASR substitution | exact-word clip, contextual input, and human listening |
| Forced WebSocket close counted as app error | expected diagnostic not classified | separate expected close diagnostics from uncaught errors |
| Missing-location weather expected a tool call | required city is absent | accept grounded clarification; require tool only when parameters exist |

Preserve raw evidence and correct the oracle. Do not change safe product behavior to satisfy a
bad regex.
