# Qualification, Promotion, and Rollback

## Contents

1. [Environment Order](#environment-order)
2. [Viking Gate](#viking-gate)
3. [Isolated NVCF and Astra Staging](#isolated-nvcf-and-astra-staging)
4. [Production Promotion](#production-promotion)
5. [Required Smokes](#required-smokes)
6. [Full Qualification](#full-qualification)
7. [Rollback](#rollback)
8. [Safe Cleanup](#safe-cleanup)
9. [Status Language](#status-language)

## Environment Order

Use this order:

```text
source validation
  -> immutable app/UI/chart publication
  -> Viking + local UI
  -> isolated NVCF + Astra staging
  -> explicit go/no-go
  -> production NVCF
  -> Astra staging target update
  -> Astra stg-to-prd replication with NSPECT
  -> production smoke and SQA
  -> monitoring
  -> authorized cleanup
```

Do not skip Viking because builds pass. Do not call an isolated `-2` or preview
environment production. Recreate isolated staging when needed; the historical
`nemotron-voice-agent-2` function was deleted.

## Viking Gate

Preflight:

1. verify branch, clean SHA, chart/app/UI release matrix, and target values;
2. verify namespace, context, Helm release, current pod images/UIDs, and rollback;
3. confirm required Secret names without printing values;
4. lint and render Helm;
5. verify image architecture/digests and chart checksum; and
6. record model pods that are out of scope and must retain their UIDs.

Deploy the exact candidate. For app-only changes, roll only app replicas and prewarmer.
Preserve ASR, Lightning, Super, Omni, Magpie, Chatterbox, Redis, and SeaweedFS unless they
are explicitly in scope.

Minimum readiness:

- all expected app replicas Ready;
- expected model, Redis, and SeaweedFS workloads Ready;
- no unexplained restarts;
- `/health`, `/api/deployment`, and `/api/session-config`;
- matching local UI version/timestamp;
- WebSocket connect and welcome audio; and
- one representative turn per changed experience.

A failed P0 rejects the candidate. Preserve evidence and issue new immutable versions after
a fix.

## Isolated NVCF and Astra Staging

Use identities that cannot be confused with the retained main function/UI. Confirm the
isolated function and Astra app are not referenced by production Vault.

1. create a new isolated NVCF function or version with dedicated artifacts;
2. inject the complete version-specific secret set;
3. deploy without changing the main serving function;
4. wait for control-plane, instance, pod, model, and deep readiness;
5. deploy the exact matching UI to an isolated Astra app;
6. verify the effective backend function ID through the UI path;
7. run required smokes and full qualification; and
8. record a staging report and explicit go/no-go.

If GPU quota prevents isolated overlap, do not undeploy production. Request capacity or
explicit downtime authorization.

## Production Promotion

Promote exact qualified digests. Never rebuild or retag between staging and production.

1. record the serving main function/version/deployment and rollback;
2. create a new version under the main function ID;
3. attach the exact chart, service, route, health contract, and all secrets;
4. deploy side by side;
5. wait for model warmup and functional smoke;
6. update the Astra staging Vault target and matching UI;
7. verify through the staging public URL;
8. obtain explicit production go/no-go;
9. use Fusion replication from `stg` to `prd` with NSPECT;
10. verify production Argo, UI config, HTTP, WebSocket, and voice behavior;
11. monitor; and
12. retain the prior qualified version during the rollback window.

When H100 capacity makes overlap impossible, stop. Explicit downtime authorization must
name the serving version to remove and expected outage.

## Required Smokes

Run these independently:

| Layer | Smoke |
|---|---|
| artifact | image digest resolves; pulled chart checksum matches |
| NVCF control plane | intended function/version/deployment ACTIVE |
| instance | expected pods/containers Ready; no crash loop |
| model | ASR, each required LLM, Magpie/Chatterbox/Omni health/prewarm |
| app | backend `/health` with expected body/content type |
| catalog | safe projection of `/api/deployment` |
| deep readiness | `/api/session-config` for each selected example |
| WebSocket | 101, bot ready, audio frames |
| Generic FBA | identity, one direct turn, one delegated tool turn |
| Omni | voice plus media when advertised |
| UI | version/date, examples, timer, settings, End/feedback |
| capture | status plus expected consented/declined terminal outcome |
| reconnect | new session ID and audible welcome without refresh |

A greeting-only WebSocket smoke proves transport/deep startup, not user-turn behavior.

## Full Qualification

For release qualification, use the project SQA harness and current gate definitions. The
historical A-D grouping is:

- Suite A: Generic tools, grounding, follow-ups, liveness, and failures.
- Suite B: Omni voice/media/webcam behavior.
- Suite C: lifecycle, capture, teardown, reconnect, and UI.
- Suite D: mixed/concurrent isolation and ordering.

Also require as applicable:

- complete real-audio Playwright suite;
- repeated 8-session by 10-tool-turn matrix;
- barge-in with an acoustic stop oracle;
- planner/API/credential/malformed payload failures;
- isolated guardrails with input-ASR validation;
- four concurrent webcam baselines;
- capture/NGC lifecycle;
- exact-word and human TTS listening;
- session uniqueness and cross-replica isolation; and
- browser console/WebSocket diagnostics.

Report product failures, input-ASR failures, hosted-query-TTS failures, and test-oracle
failures separately. Never weaken product behavior to satisfy a broken oracle.

## Rollback

The rollback unit is:

```text
NVCF function/version/deployment
+ exact chart/app digests
+ Astra UI digest
+ Astra Vault function target
+ source SHA
+ secret-name manifest
```

Rollback steps:

1. identify the last fully qualified immutable set;
2. verify its artifacts still exist;
3. restore or redeploy its NVCF version;
4. restore the matching Astra UI and Vault target;
5. ensure stale NVCF request cookies are stripped;
6. run HTTP, WebSocket, voice, and relevant regression smoke; and
7. document the rejected candidate without deleting its evidence.

As of the October 02, 2026 live NVCF inventory, the main function had one active version
and no retained inactive rollback. Recreate a known immutable rollback before risky main
function work.

## Safe Cleanup

Cleanup is destructive and requires exact authorization.

Before cleanup:

1. list function versions and deployments;
2. resolve exact function/version/deployment IDs;
3. prove the target is inactive or intentionally retiring;
4. inspect Astra staging and production Vault targets;
5. check other consumers and dedicated endpoints;
6. confirm rollback policy; and
7. record the serving main identity.

Order:

1. gracefully undeploy the exact version;
2. wait until no deployment/instance remains;
3. re-query and smoke the serving function;
4. delete the inactive version only if authorized;
5. verify function inventory;
6. delete chart/image artifacts only under separate explicit authorization; and
7. update the deployment source of truth.

Never use wildcards. Never delete the function identity when only one version is intended.
Never infer redundancy from a shared chart version.

## Status Language

Use exact terms:

| Term | Meaning |
|---|---|
| built | local build completed |
| published | registry upload exists |
| version created | NVCF version object exists |
| deployed | deployment object exists |
| ACTIVE | NVCF control-plane state |
| Ready | pod/probe state |
| smoke-tested | named minimal requests passed |
| qualified | full required gates passed |
| production ready | qualified artifacts plus approved promotion/rollback posture |

A candidate can be ACTIVE and unqualified. An Astra app can be Healthy/Synced and point to
an unqualified backend.

## October 05 Qualification Lessons

The historical deletion of an isolated staging function does not describe the current
inventory. Function `fa20412a-4da3-45a1-8057-a076039580e2` now serves both staging URLs on
H200. Refer to [Current Staging Handoff](current-staging-handoff-2026-10-05.md) before
selecting a staging target or rollback.

A stock-price oracle requires a numeric quote. A native tool call or company overview
cannot satisfy it. Media qualification requires successful upload and recognition of the
known fixture features; an image acknowledgement alone does not pass. Prompt delivery
and model compliance are separate checks. Preserve a payload delivery pass alongside a
model marker warning when the model does not obey the requested marker.

Concurrent sessions can pass connection, speech, uniqueness, and literal leakage checks
while code-word fidelity fails. Review the application input transcript, bot text, and
independent bot-audio transcription separately. Normalize spoken numerals only for this
supplemental comparison. Preserve the raw suite result and report missing words or digits;
do not rewrite the raw verdict or attribute capture, synthesis, and recognition causes
without evidence.

Keep failed browser probe attempts. A selector can fail because an action is still
preparing or a label matches both a section and its file input. Scope the selector and
wait for the actual control state before calling it an application defect. A corrected
probe does not remove the earlier evidence.

Available prior UI/configuration is a rollback baseline, not a newly qualified recovery.
For a UI-only main staging rollback, restore its values and Vault routing, wait for secret
refresh, and verify serving behavior. Do not undeploy or change an NVCF function when the
required rollback changes only Astra staging.
