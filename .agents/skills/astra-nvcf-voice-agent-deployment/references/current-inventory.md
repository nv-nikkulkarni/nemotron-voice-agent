# Current Dated Inventory

## Contents

1. [How to Use This Snapshot](#how-to-use-this-snapshot)
2. [Source and Chart](#source-and-chart)
3. [Live NVCF Inventory](#live-nvcf-inventory)
4. [Main Voice Agent](#main-voice-agent)
5. [Realtime Generic Frontend/Backend](#realtime-generic-frontendbackend)
6. [Standalone Lightning](#standalone-lightning)
7. [Dedicated Speech Functions](#dedicated-speech-functions)
8. [Astra](#astra)
9. [Viking](#viking)
10. [Refresh Commands](#refresh-commands)

## How to Use This Snapshot

This file is orientation, not permanent truth. NVCF was live-verified on **October 02,
2026** with NGC CLI 4.36.6. Git was refreshed the same day. Astra and Viking retain older
evidence dates because Fusion authentication was expired and Viking was not queried during
this skill update.

Before reporting or mutating a platform, refresh that platform and record a new observation
time. Do not silently update one row while leaving the file's evidence date unchanged.

No full SQA was run as part of this documentation task.

## Source and Chart

Checked on October 02, 2026:

| Item | Value |
|---|---|
| checkout | `/home/nikkulkarni/workspace/nva-nvcf-rebased-v2` |
| branch | `dev/nikkulkarni/nvcf-deploy-rebased-v2` |
| HEAD/upstream | `6919a606e99848ad8f64ecebc8b2a553ae5e342f` |
| fork | `nv-nikkulkarni/nemotron-voice-agent` |
| checked-in chart | `0.1.140` |
| checked-in `appVersion` | `2.0.68` |
| base production app tag | `2.0.67` |
| Viking overlay app tag | `2.0.68` |

The HEAD after the runtime release contains documentation commits. The last runtime/release
lineage is described in the existing operating skill. Render the exact target values rather
than assuming `appVersion`, base values, and environment overlay must be identical.

## Live NVCF Inventory

The project-owned deployments observed on October 02 were:

| Function | Function/version | Deployment | Artifact | Shape | Scale/concurrency |
|---|---|---|---|---|---|
| main voice agent | `81862ff8-4931-4f1e-9655-caa5b0bc5911` / `256d5eb0-6dc1-480b-8420-4aebcd49f29d` | `a3677b64-2b21-42d2-bb8a-16509b0e435a` | chart `0.1.139` | H100 8x | 1/1, concurrency 100 |
| Realtime Generic FBA | `629e6105-1094-4588-830f-4827a772f05c` / `91aca901-9e25-4146-b61a-136a7d1d98b1` | `f6f1ae28-fd3b-490b-954f-3720abb38a79` | dedicated chart `0.1.149` | H100 8x | 0/1, concurrency 8 |
| standalone Lightning | `9e6b5886-1474-4108-80d6-0cff9ba41fab` / `f419f631-bc0f-4d0e-90e8-0cbf70de5181` | `09f84b02-7ac3-499e-a025-78a571b38663` | main chart `0.1.139`, Lightning service | H100 1x | 0/1, concurrency 8 |
| dedicated ASR | `4155ae85-73e1-4936-b47f-87b9de165651` / `f553be4a-9400-4509-bdfa-cb1d9d4005bd` | `467848f2-c59e-46ce-be10-58654d102216` | wrapper `1.3.1-nvcf-5b0df78` | H100 1x | 1/1, concurrency 8 |
| dedicated Magpie | `500bfea0-ba3d-4158-8276-1d04daedfdcd` / `3b5f8003-a937-4da5-8844-a3520be74e67` | `f77a6c18-31cf-4fc2-9bd9-5dea66746887` | wrapper `1.10.0-nvcf-5b0df78` | H100 1x | 1/1, concurrency 8 |
| dedicated Chatterbox | `8d3eb462-afcb-46d7-80ca-4e8b6c6fd20e` / `1c2642fb-1191-4449-9c8a-3159d2868d99` | `6b5509af-ca6d-45a8-8ebc-73e51b2c3c62` | wrapper `1.1.0-nvcf-5b0df78` | H100 1x | 0/1, concurrency 8 |

All were `ACTIVE` in the control plane. That state is not a fresh functional
qualification.

## Main Voice Agent

Live NVCF metadata:

- function name: `nemotron-voice-agent`;
- chart: `0491162300748285/nemotron-voice-agent:0.1.139`;
- Helm service: `nemotron-voice-agent`;
- inference: `/api/ws` on 7860;
- health: `/health` on 7860, HTTP 200, `PT10S`;
- backend: `nvcf-dgxc-k8s-oci-nrt-prd12-1`; and
- instance: `OCI.GPU.H100_8x`.

Exactly one main function version appeared in the live list. No inactive NVCF rollback was
available. The chart/app mapping is historically `0.1.139` / `2.0.67`.

Do not touch this function when testing Realtime, specialized model endpoints, artifact
cleanup, or a new skill procedure.

## Realtime Generic Frontend/Backend

Live metadata:

- function name: `nemotron-realtime-generic-fba`;
- active chart: `0491162300748285/nemotron-realtime-generic-fba:0.1.149`;
- Helm service: `nemotron-voice-agent`;
- inference: `/v1/realtime` on 7860;
- health: `/health` on 7860, HTTP 200, `PT10S`;
- active version tag metadata: `source:af9b900`; and
- last observed app configuration used dedicated image tag `2.0.72`.

Two inactive versions remained:

| Chart | Version ID |
|---|---|
| `0.1.147` | `05245164-c47a-4844-818e-f5889f82384e` |
| `0.1.148` | `9e032127-e585-4a80-90ca-92c1fd787505` |

Do not delete them merely because they are inactive. Resolve rollback/evidence needs and
obtain explicit authorization. This Realtime function is distinct from the main product.

## Standalone Lightning

Live metadata:

- function name: `nva-nemotron-3-5-lightning`;
- chart: main repository `nemotron-voice-agent:0.1.139`;
- Helm service: `nemotron-lightning`;
- inference: `/v1/chat/completions` on 8000;
- health: `/v1/health/ready` on 8000;
- source tag metadata: `source:3bd7ffb`; and
- scale-to-zero: minimum 0, maximum 1.

The function was ACTIVE. The dated deployment record did not establish complete
chat/tool/concurrency qualification. Refresh functional evidence before team handoff.

## Dedicated Speech Functions

Use TLS gRPC at `grpc.nvcf.nvidia.com:443` with invocation authorization and the function
ID in metadata.

The wrapper images are in dedicated repositories:

- `nvcf-nemotron-asr-streaming:1.3.1-nvcf-5b0df78`;
- `nvcf-magpie-tts-multilingual:1.10.0-nvcf-5b0df78`; and
- `nvcf-chatterbox-tts-multilingual:1.1.0-nvcf-5b0df78`.

The Magpie function used `batch_size=8`. Batch 64 is supported by the NIM profile but was
not the live deployment setting.

## Astra

Last live-verified on **September 11, 2026**, not October 02:

| Environment | URL/state |
|---|---|
| production | `https://nemotron-voice-agent-deploy-backend.prd.astra.nvidia.com`; Healthy/Synced at revision `8b0d7572294c` |
| staging | `https://nemotron-voice-agent-deploy-backend.stg.astra.nvidia.com`; retained, Healthy/Synced at revision `8b0d7572294c` |

Last known UI:

- tag `2.0.75-178e45b`;
- source `178e45b647d7cb1f78c192cbd06b82887283ebf4`;
- 600-second sessions; and
- Generic Frontend/Backend plus Omni Subagents.

Fusion 0.34.0 authentication was expired on October 02, 2026. Reauthenticate and refresh
both environments before calling this current.

## Viking

Last live-verified on **September 10, 2026**:

- context `kubernetes-admin@kubernetes`;
- namespace `nva-p7`;
- Helm release `p7`, revision 5;
- chart/app `0.1.140` / `2.0.68`;
- five app replicas Ready; and
- focused validation only, not complete A-D/human-microphone qualification.

Refresh context, release, pods, images, UIDs, Secrets, and service endpoints before any
Viking rollout.

## Refresh Commands

NVCF:

```bash
ngc cf fn list <function-id> --format_type json
ngc cf fn deploy list --format_type json
ngc cf fn deploy info <function-id>:<version-id> --format_type json
ngc cf fn instance list <function-id>:<version-id> --format_type json
```

Astra after loading the Fusion skill and reauthenticating:

```bash
fusion auth
fusion platform
fusion config
fusion deploy list -d nemotron-voice-agent-astra
fusion deploy status -d nemotron-voice-agent-astra -r <deploy-repo> -e stg
fusion deploy status -d nemotron-voice-agent-astra -r <deploy-repo> -e prd
```

Viking:

```bash
kubectl config current-context
helm -n nva-p7 status p7
helm -n nva-p7 history p7
kubectl -n nva-p7 get pods -o wide
kubectl -n nva-p7 get deploy,statefulset,svc
```

Update the evidence date and preserve the previous historical record when facts change.

## October 05 Update

The October 02 rows above remain historical. Refer to
[Current Staging Handoff](current-staging-handoff-2026-10-05.md) for the October 05 main
staging cutover and completed real-browser suite. Do not report the older staging UI,
expired Fusion authentication, or deleted `-2` function as current state.

The H200 staging function `fa20412a-4da3-45a1-8057-a076039580e2` serves both main and
isolated Astra staging. Production values, Vault routing, public UI configuration, and
all five protected deployment rows present before this cutover remain unchanged.
Realtime function `629e6105-1094-4588-830f-4827a772f05c` is already absent before this
cutover. Its earlier disappearance remains unexplained; do not silently restore it or
claim the historical protection discrepancy is resolved. Viking was not redeployed or
freshly qualified during the main staging cutover.

## October 08 Review

The October 02 and October 05 records above remain historical. Refer to the
[October 08 Deployment Handoff](deployment-handoff-2026-10-08.md) for subsequent
production routing, production SQA diagnosis, standalone H200 version identities, and
source-branch consolidation. Production routing changed after the October 05 snapshot;
do not use that snapshot's protected routing as a current value.
