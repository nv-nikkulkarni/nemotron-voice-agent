---
name: astra-nvcf-voice-agent-deployment
description: Build, publish, deploy, promote, inspect, debug, roll back, and safely clean up NVIDIA Nemotron Voice Agent artifacts across NGC, NVIDIA Cloud Functions (NVCF), Viking Kubernetes, and Astra through Fusion. Use for app or UI image publication, Helm chart publication, NVCF function/version/deployment lifecycle, instance logs, function secrets, HTTP or WebSocket invocation, Fusion deployment and Vault workflows, staging-to-production replication, NSPECT promotion, dedicated ASR/TTS/LLM functions, deployment RCA, capacity or readiness failures, artifact isolation, rollback, and status reporting.
---

# Deploy Astra and NVCF Voice Agent

Use this skill as the deployment runbook for the custom Nemotron Voice Agent stack. Load
the installed `fusion` skill before any Fusion, Vault, Astra, or Argo mutation. Use
`.agents/skills/nemotron-voice-agent-deploy/` for generic Docker Compose recipes and
`skills/operate-nemotron-voice-agent/` for agent behavior, SQA, capture, and incident RCA.

## Establish Truth First

1. Run from the intended repository root. Read `AGENTS.md` and scoped guidance.
2. Inspect `git status`, branch, remotes, worktrees, `HEAD`, and upstream alignment.
3. Classify every claim as **checked-in**, **live-verified**, **historical**, or
   **unqualified**. Include an observation timestamp for live state.
4. Query NVCF function versions and deployments separately. A version can be `ACTIVE`
   while no deployment serves it, and a deployment can retain an older version.
5. Query Astra application health, revision, effective UI config, Vault target reference,
   and backend function independently. A Healthy/Synced UI can point to the wrong NVCF
   function.
6. Treat `ACTIVE`, pod Ready, `/health`, deep readiness, a successful voice turn, and full
   SQA as different gates. Never collapse them into “working.”
7. Never print, copy, infer, or persist secret values. Record names and injection
   boundaries only. Treat keys pasted in chat as exposed and require rotation.

Read [Preflight and Sources of Truth](references/preflight-and-truth.md) before acting.
Read [Current Dated Inventory](references/current-inventory.md) only for orientation, then
refresh the affected control plane before a mutation or status claim.

## Select the Workflow

- For immutable app/UI builds, NGC image publication, Helm packaging, chart publication,
  digest recording, or repository isolation, read
  [Artifacts and Registries](references/artifacts-and-registries.md).
- For the full multi-replica stack, Realtime minimal stack, dedicated endpoints, GPU
  ownership, Redis/SeaweedFS state, or Astra proxy boundary, read
  [Deployment Topologies](references/deployment-topologies.md).
- For creating or versioning an NVCF function, selecting the chart service, applying Helm
  overrides, choosing an instance shape, scaling, invoking endpoints, or inspecting state,
  read [NVCF Lifecycle](references/nvcf-lifecycle.md).
- For NVCF logs, instances, pod/container selection, health failures, image pulls, model
  startup, quota, scheduling, or runtime RCA, read
  [NVCF Debugging](references/nvcf-debugging.md).
- For Astra app creation/update, Fusion authentication, values, Vault, Argo, staging,
  production replication, NSPECT, or UI/backend drift, read
  [Fusion and Astra Flow](references/fusion-astra-flow.md).
- For secret names, key scope, safe injection, authentication boundaries, registry access,
  and secret scans, read [Secrets and Access](references/secrets-and-access.md).
- For Viking qualification, smoke gates, promotion, rollback, capacity overlap, inactive
  version cleanup, or destructive operations, read
  [Qualification, Promotion, and Rollback](references/qualification-promotion-rollback.md).
- For dedicated ASR, Magpie, Chatterbox, standalone Lightning, or Realtime Generic
  Frontend/Backend functions, read
  [Specialized Functions](references/specialized-functions.md).
- For symptoms and historically expensive mistakes, read
  [Failure and Gotcha Catalog](references/failure-and-gotcha-catalog.md).

Read each selected reference completely. Do not combine command fragments from different
dated releases without reconciling them against installed CLI `--help` and current source.

## Follow the Immutable Deployment Sequence

Use this sequence unless the user explicitly narrows the scope:

1. **Freeze source:** require a clean committed SHA and preserve unrelated work.
2. **Choose identities:** allocate new immutable app/UI/chart versions and the correct NGC
   repositories. Never publish an experimental function into production artifact names.
3. **Validate source:** run focused tests, complete applicable tests, Helm lint/render,
   client build/lint, documentation validation, and secret scanning.
4. **Build app and UI:** build Linux AMD64 artifacts from the committed source archive,
   attach source/version labels, and record local image IDs.
5. **Push images first:** publish the exact images, then resolve and record their immutable
   registry digests. A chart must not reference an image tag that does not exist.
6. **Package and push Helm:** render the target overlay, package the chart, hash the package,
   upload with `ngc registry chart push`, pull it back, and verify the checksum.
7. **Qualify Viking:** deploy the exact images/chart, preserve out-of-scope pod identities,
   run readiness and required SQA, and reject any P0 failure.
8. **Create an NVCF version:** reuse the intended function ID for a new version, attach the
   exact chart, service, inference route, health contract, and complete per-version secrets.
9. **Deploy the version:** select explicit backend/GPU/instance/min/max/concurrency values,
   then wait for deployment and deep readiness without deleting the serving version.
10. **Deploy Astra staging:** publish the matching UI, update Fusion values and Vault
    references, wait for Argo Healthy/Synced, and verify HTTP plus WebSocket routing.
11. **Qualify staging:** repeat functional, audio, concurrency, failure, media, reconnect,
    capture, and pronunciation gates required by the release.
12. **Promote exact artifacts:** obtain go/no-go, promote the same digests, replicate Astra
    staging to production with the required NSPECT record, and run production smoke.
13. **Retain rollback:** keep one known-good immutable NVCF version and matching UI/Vault
    target through the monitoring window.
14. **Clean up only by authorization:** resolve exact inactive targets, prove none serves a
    consumer, gracefully undeploy, verify the serving function is unchanged, then delete
    versions or artifacts only when explicitly authorized.

## Preserve Deployment Invariants

- Push an application image before publishing a chart that references it.
- Use NGC **image** repositories for containers and NGC **chart** repositories for Helm.
  Session archives use generic NGC resources; these APIs are not interchangeable.
- Supply all NVCF version secrets again. Versions do not inherit secrets.
- Keep the main production artifact repositories separate from Realtime, experimental,
  dedicated speech, and standalone model functions.
- Keep the serving main function untouched unless the user explicitly authorizes that
  exact function/version operation.
- Keep HTTP and streaming routes separate: HTTP uses the per-function invocation host;
  browser WebSockets go through `grpc.nvcf.nvidia.com` with proxy-injected
  `Authorization` and `function-id` headers.
- Keep invocation credentials, NGC registry credentials, external tool keys, Fusion login,
  and Vault values conceptually and operationally separate.
- Keep Astra credentials server-side. Never bake them into the Vite bundle, `config.js`,
  image labels, values committed to Git, or browser-visible environment.
- Do not mutate a chart tag, image tag, or function version in place after qualification.
- Do not remove an active or rollback deployment merely to free H100 capacity. Stop and
  request downtime authorization when overlap is impossible.

## Diagnose in Layers

Use this order and stop at the first broken boundary:

1. artifact exists and digest/checksum matches;
2. function version references the intended chart/image and secret names;
3. deployment is scheduled on the intended backend and instance shape;
4. NVCF instance, pods, init containers, and model containers start;
5. health probe returns the expected service response, not an SPA fallback;
6. deep app/model readiness succeeds;
7. HTTP invocation succeeds;
8. WebSocket upgrade and audio succeeds;
9. tool, media, capture, and concurrency behavior succeeds; and
10. required SQA gates succeed.

Prefer control-plane metadata, per-instance logs, container logs, and timestamp-correlated
session evidence over guesses. Do not compensate for an Astra proxy defect by rebuilding
the NVCF function or for a model startup defect by changing the UI.

## Report Precisely

Always report these lines separately:

- source branch and full SHA;
- app/UI/chart versions, digests, and chart checksum;
- NGC upload/pull verification;
- Viking release, readiness, and qualification status;
- NVCF function ID, version ID, deployment ID, instance shape, and control-plane state;
- Astra environment, revision, URL, UI digest, Vault target reference, and Argo state;
- HTTP, WebSocket, model, tool, media, and capture smoke results;
- SQA passed, failed, and pending gates;
- rollback availability; and
- known blockers or unverified assumptions.

Use “published,” “deployed,” “Ready,” “smoke-tested,” “qualified,” and “production ready”
only for their exact meanings.

## Dated Deployment Handoffs

For the main staging cutover, immutable release identities, completed A/B/C/D results,
remaining defects, and available rollback, read
[Current Staging Handoff](references/current-staging-handoff-2026-10-05.md).
The October 05 snapshot records the H200 staging cutover and retained isolated app.
For subsequent production promotion, production SQA diagnosis, standalone H200 versions,
and branch consolidation, read the
[October 08 Deployment Handoff](references/deployment-handoff-2026-10-08.md).
These are historical records. Refresh live state before acting, and determine authorization
from the current user instructions rather than a previous task's recorded scope.

Maintain this directory as the canonical runbook. Keep its
`.agents/skills/astra-nvcf-voice-agent-deployment/` discovery copy synchronized.
