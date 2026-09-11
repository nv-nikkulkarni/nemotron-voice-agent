# Current State Snapshot

## Contents

1. [Purpose and Evidence Date](#purpose-and-evidence-date)
2. [Source of Truth](#source-of-truth)
3. [Viking Kubernetes](#viking-kubernetes)
4. [Local UI and Utilities](#local-ui-and-utilities)
5. [Main NVCF Function](#main-nvcf-function)
6. [Astra UI](#astra-ui)
7. [Dedicated Speech NVCF Functions](#dedicated-speech-nvcf-functions)
8. [Immediate Safe Next Actions](#immediate-safe-next-actions)

## Purpose and Evidence Date

Use this file for orientation, then query the live systems again before mutating or
reporting them. The snapshot was reconciled on **September 11, 2026** after the Astra
staging-to-production replication.

Evidence labels mean:

- **Live-verified:** queried from the applicable platform on the date stated in its
  section. Astra promotion state was queried on September 11, 2026; Viking and NVCF
  state below retain their September 10 evidence dates.
- **Publicly verified:** returned by the public Astra endpoint on September 11, 2026.
- **Checked-in:** read from current source at the exact branch head below.
- **Historically verified:** retained in a dated report or deployment source of truth.
- **Unqualified:** deployed or smoke-tested, but the full required gate set is not green.

Do not silently carry this snapshot forward. Record the new observation date whenever
updating it.

## Source of Truth

| Item | Reconciled value | Evidence |
|---|---|---|
| Repository | `nv-nikkulkarni/nemotron-voice-agent` GitHub fork | Live Git remote |
| Primary branch | `dev/nikkulkarni/nvcf-deploy-rebased-v2` | Checked-in/live Git |
| Runtime source baseline | `e6ab693953680c9f03f8bb24d559a59481f385a8` | Checked-in/live Git |
| Upstream base | `origin/develop` at `a1a4d56` | Live Git fetch |
| Base relationship | `origin/develop` is an ancestor; primary is 15 commits ahead | Live Git |
| Chart source | `0.1.140`, `appVersion: 2.0.68` | Checked-in |
| Production app default | `2.0.67` | Checked-in `values.yaml` |
| Viking app override | `2.0.68` | Checked-in `values-viking.yaml` |

The runtime source baseline is the last application/deployment commit before this
knowledge-only skill update. Attribute runtime behavior to that SHA, but attribute the
handoff text itself to the current skill blob or later documentation commit.

The v2 branch is the active deployment-development source. The pre-v2 branch is a backup,
not the place for new work. Do not make changes in an old worktree merely because its path
contains the familiar repository name.

## Viking Kubernetes

Live-verified on September 10, 2026:

| Item | Value |
|---|---|
| kubectl context | `kubernetes-admin@kubernetes` |
| Namespace | `nva-p7` |
| Helm release | `p7` |
| Helm revision | `5` |
| Helm chart/app | `0.1.140` / `2.0.68` |
| App image digest | `sha256:00f6537af2086c190ecbd2d7330ed57e96745baa6835358b0a6f2ed2b68c77d2` |
| Application | five of five replicas Ready, zero current restarts |
| Qualification | focused Viking validation only; full A-D/human-microphone gate pending |

Workload images observed live:

| Role | Image/version | Shape |
|---|---|---:|
| Application | `nvcr.io/0491162300748285/nemotron-voice-agent:2.0.68` | 5 CPU replicas |
| Nemotron ASR | `nemotron-asr-streaming:1.2.0` | 1 GPU |
| Lightning Talker | `nemotron-3.5-lightning-30b-a3b:2.0.9-variant` | 1 GPU |
| Super Thinker | `nemotron-3-super-120b-a12b:2.0.5` | 2 GPUs |
| Omni | `vllm-omni:v0.20.0-cu130-r2` | 1 GPU |
| Magpie | `magpie-tts-multilingual:1.10.0` | 1 GPU |
| Chatterbox | `chatterbox-tts-multilingual:1.1.0` | 1 GPU |
| Redis | `redis:7.2.4-debian-12-r12` | CPU |
| SeaweedFS | `seaweedfs:4.41` | CPU |
| Prewarmer | app `2.0.68` | CPU |

The complete NIM topology uses seven of eight H100s: ASR 1, Lightning 1, Super 2,
Omni 1, Magpie 1, and Chatterbox 1. Treat the remaining GPU as headroom, not committed
capacity.

Revision 3 failed because capture upload was required while the non-secret
`SESSION_CAPTURE_NGC` destination was absent. Revision 4 corrected the values. Revision 5
redeployed the reconstructed v2 source with byte-equivalent runtime behavior.

Focused evidence retained for this Viking candidate:

- 574 Python unit tests passed;
- live Talker evaluation passed 160 of 160;
- live Thinker evaluation passed 100 of 100;
- repeated weather passed 20 of 20;
- dependent second-round planning passed 20 of 20;
- random-number routing passed 20 of 20;
- focused UI metrics passed 5 of 5;
- UI build/lint and Helm lint/render passed;
- real-audio identity, weather, and stock smoke passed; and
- synthetic false-interruption session `de91f2cf7010` completed with one user turn, no
  interruption event, and an uploaded capture after a 120 ms non-verbal tone was injected
  during long web-search speech.

These facts do not constitute a full release qualification.

## Local UI and Utilities

Live Docker state on September 10, 2026:

| Container | Image | Binding |
|---|---|---|
| `nva-ui-local-2-0-76-a5c0570` | `nemotron-voice-agent-ui:2.0.76-a5c0570` | `0.0.0.0:7860` |
| `session-dashboard` | local session dashboard | `0.0.0.0:7870` |
| `ai-usage` | local usage dashboard | local-only configuration |

The checked-in Viking UI target is `http://10.78.18.44:30786`. Verify the current node IP
and NodePort before sharing it. The local UI exposes Generic Frontend/Backend and Omni
Subagents with a 600-second session limit.

## Main NVCF Function

Live-verified on September 10, 2026:

| Item | Value |
|---|---|
| Function name | `nemotron-voice-agent` |
| Function ID | `81862ff8-4931-4f1e-9655-caa5b0bc5911` |
| Active version | `256d5eb0-6dc1-480b-8420-4aebcd49f29d` |
| Active chart/app | `0.1.139` / `2.0.67` |
| Active deployment | `a3677b64-2b21-42d2-bb8a-16509b0e435a` |
| Backend/instance | `prd12`, `OCI.GPU.H100_8x` |
| Scale/concurrency | min 1, max 1, request concurrency ceiling 100 |
| Chart package | `0491162300748285/nemotron-voice-agent:0.1.139`, SHA-256 `bc61a86dec3d39a597a23e673b4aa601c0d76a429aafc11fde24c9692583c18f` |
| App image | `2.0.67`, OCI index `sha256:5e4184b7ad995fa656870e8a33ccd90037be5585227727ad25970ee8093f3e0e`, AMD64 `sha256:1e8cabb7dbf38a035e4cdb902b01ae8d9630865b9202693157c8ea8eac594515` |
| Rollback version | `013cb57e-76b7-4567-a3f3-513461ea11da`, `0.1.138` / `2.0.66`, INACTIVE |
| Qualification | owner-directed deployment; full SQA not green |

Exactly one project version was ACTIVE and one rollback INACTIVE. Earlier redundant main
versions were deleted. The former isolated `nemotron-voice-agent-2` function was gracefully
undeployed and all its versions deleted.

The production chart explicitly uses Generic `direct` tool-result delivery. It therefore
speaks trusted grounded backend text without asking Lightning to interpret Pipecat's
asynchronous started-plus-final result envelope.

## Astra UI

Fusion 0.34.0 used native `fusion deploy replicate` to copy
`nemotron-voice-agent-deploy` from staging to production on September 11, 2026. Staging
remains retained. The promotion used NSPECT
`NSPECT-EN4P-2958`; task
`deployment-helmchart-replicate-stg-prd-1789126548-56d49eee` completed in 141 seconds.
Fusion copied the Vault secret server-side, generated production values/environment
commits, and completed Argo onboarding without printing secret values.

Live-verified serving values:

| Item | Value |
|---|---|
| Astra app | `nemotron-voice-agent-deploy` |
| Production URL | `https://nemotron-voice-agent-deploy-backend.prd.astra.nvidia.com` |
| Production state | `Healthy` and `Synced` on `astraprd01-ocp-pdx04` |
| Production revision | `8b0d7572294c`; created September 11, 2026, at 11:37:43 UTC |
| Staging URL | `https://nemotron-voice-agent-deploy-backend.stg.astra.nvidia.com` |
| Staging state | Retained, `Healthy` and `Synced` on `astrastg01-ocp-pdx04`; current revision `8b0d7572294c`, source revision before replication `2a3a6e9de649` |
| UI tag | `2.0.75-178e45b` |
| UI source | `178e45b647d7cb1f78c192cbd06b82887283ebf4` |
| Values source | `fe8df15f78a0d2d7e2bad6eb0268ddcdd8420fd7` |
| UI image digest | OCI index `sha256:33565f212723680ba06d023f15915ead1b55ede450276074a28f4cc022288071`, AMD64 `sha256:d8dc3730cfa4d294f7eb6ececf8c7dae05ee29e3b8411beca495c1e3db91ec3a` |
| Production Vault path | `fusion/astra/nemotron-voice-agent-astra/nemotron-voice-agent-deploy/prd` |
| Staging Vault path | `fusion/astra/nemotron-voice-agent-astra/nemotron-voice-agent-deploy/stg` |
| Deployment layer | `nemotron-voice-agent-astra` |

The production public endpoint returned these values on September 11:

- deployment timestamp `2026-09-07T21:00:50Z`;
- `sessionSeconds: 600`;
- Generic Frontend/Backend and Omni Subagents examples;
- `selfHostedOnly: true`; and
- session recording enabled.

`/api/deployment` advertised both examples, WebSocket transport, 16 kHz input audio, and
22.05 kHz output audio. Capture reported enabled, configured, ready, and required, with
the NGC CLI and key present and S3 as the store backend. `/health` returned SPA HTML with
HTTP 200 through Astra rather than backend health JSON; this is a reverse-proxy routing
gotcha and not backend proof.

The generated production JWT path is `jwt/astraprd01-ocp-pdx04/`, and the production
role uses the `-prd` suffix. The exported `project.nspect_id` field is blank even though
the Fusion task audit records the NSPECT ID twice. Treat this as a platform metadata
nuance, not a promotion failure.

Lightweight real WebSocket greeting smokes passed through the production endpoint:

- Generic session `ffafd9929115` connected, reached `bot_ready`, delivered 2.29 seconds
  of 22.05 kHz welcome audio with first audio in 0.610 seconds, and had no receiver error.
- Omni session `8c689400b924` connected, reached `bot_ready`, delivered 2.99 seconds of
  22.05 kHz welcome audio with first audio in 2.596 seconds, and had no receiver error.

These were deep-readiness and greeting smokes only. They did not send a user turn and do
not constitute full voice or SQA qualification. The NVCF backend remains chart `0.1.139`
and app `2.0.67`.

## Dedicated Speech NVCF Functions

These independently deployable functions were live-verified ACTIVE on September 10, 2026.
They are not the model pods embedded inside the all-in-one voice-agent function.

| Service | Function name | Function ID | Version ID |
|---|---|---|---|
| Nemotron ASR Streaming | `nva-nemotron-asr-streaming` | `4155ae85-73e1-4936-b47f-87b9de165651` | `f553be4a-9400-4509-bdfa-cb1d9d4005bd` |
| Magpie Multilingual TTS | `nva-magpie-tts-multilingual` | `500bfea0-ba3d-4158-8276-1d04daedfdcd` | `3b5f8003-a937-4da5-8844-a3520be74e67` |
| Chatterbox Multilingual TTS | `nva-chatterbox-tts-multilingual` | `8d3eb462-afcb-46d7-80ca-4e8b6c6fd20e` | `1c2642fb-1191-4449-9c8a-3159d2868d99` |

All clients use `grpc.nvcf.nvidia.com:443` and select the function through gRPC metadata.
The deployed wrapper image tags were ASR `1.3.1-nvcf-5b0df78`, Magpie
`1.10.0-nvcf-5b0df78`, and Chatterbox `1.1.0-nvcf-5b0df78` in the private organization
registry. Historical deployment IDs were `467848f2-c59e-46ce-be10-58654d102216`,
`f77a6c18-31cf-4fc2-9bd9-5dea66746887`, and
`6b5509af-ca6d-45a8-8ebc-73e51b2c3c62`, respectively.

The wrapper source exists in the separate local worktree
`/home/nikkulkarni/workspace/nva-speech-nim-functions` on local branch
`dev/nikkulkarni/nvcf-speech-nim-functions`. That branch had no verified GitHub remote
tracking branch at reconciliation time; do not assume it is backed up.

Upstream `develop` already supports the NVCF gRPC mechanism but its catalogs point to older
shared NVIDIA function IDs. A fresh clone must explicitly replace those service-catalog
function IDs to use these dedicated functions.

## Immediate Safe Next Actions

1. Run production user-turn voice, tool, media, and capture smoke against the `prd` URL,
   then run the full SQA gates before calling the promotion qualified.
2. Retain the Astra staging deployment until the production validation is complete.
3. Preserve NVCF `0.1.139` as serving and `0.1.138` as rollback until a fully qualified
   replacement is ACTIVE and smoke-tested.
4. Back up or push the dedicated speech-functions branch after a secret/history scan.
5. Rotate credentials that were pasted into prior chat history; never copy those values
   into Git, docs, shell history, or this skill.
