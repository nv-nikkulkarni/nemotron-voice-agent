# Main Astra Staging UI Cutover

**Date:** October 05, 2026 (Asia/Kolkata)

**Scope:** Move the tested UI to the main Astra staging app and route it to the
current isolated H200 backend. The user authorizes only
`nemotron-voice-agent-deploy` in `stg`, including required staging routing and
credentials. Production Astra `prd` and production NVIDIA Cloud Functions
(NVCF) remain protected. No application source changes are planned.

**Status:** Main staging serves the exact tested UI and routes to the H200
backend. Argo is Healthy/Synced; Generic and Omni readiness pass. Full main-URL
A/B/C/D SQA is raw **FAIL** on its first stock answer; B/C/D pass their scripted
checks. Supplemental concurrency speech-fidelity gaps remain unresolved. Final archive
integrity, serving state, and current-scope production protection pass. Full
qualification remains **FAIL**; the latest capture queue is drained, while full
lifecycle qualification remains incomplete.

## Intended Target and Immutable Artifacts

The requested target and freshly verified published UI artifacts are:

| Item | Intended Value |
| --- | --- |
| Main Astra app / environment | `nemotron-voice-agent-deploy` / `stg` |
| Public URL | `https://nemotron-voice-agent-deploy-backend.stg.astra.nvidia.com` |
| UI source | `5e7ec4298c22c950e072e576ccf64a0b37debda7` |
| Published UI image | `artifactory.nvidia.com/it-astra-docker-local/nemotron-voice-agent/nemotron-voice-agent-ui:dev-5e7ec42-20261004-backend-history` |
| UI OCI index | `sha256:4df4756243e3bee149c70521c7e30c3c0e711cad37041ef178922399ce8632fc` |
| UI AMD64 manifest | `sha256:d4af1045e06feaea16d33c954f658e0e56f45b33424c51c6227228f31190490f` |
| UI build timestamp | `2026-10-04T18:36:12Z` |
| Backend source | `84b0a8c212147fd46d658f2e01b4c555b08b641f` |
| Backend image | `nvcr.io/0491162300748285/nemotron-voice-agent:dev-84b0a8c-20261005-dynamic-filler` |
| Backend OCI index | `sha256:2d58e2222be405b2f66d619aafe4a6d4d6d2656ceb3b3eee38021d6b38a28700` |
| Backend AMD64 manifest | `sha256:35c4fdf67d2c0d4d1bf4d0a5f9032285730d3caee7250eb8188735c2128325aa` |
| NVCF function | `fa20412a-4da3-45a1-8057-a076039580e2` |
| NVCF version | `dca45c20-c569-4b86-be50-adde5c3c99a1` |
| NVCF deployment | `010c94c1-6e27-4b36-a0f7-44b006a8826d` |
| Placement and scaling | `OCI.GPU.H200_8x`, min/max `1`/`1`, concurrency `100` |

Artifact source identities are separate from this report's documentation commit.
The [isolated staging deployment report](BACKEND_HISTORY_STAGING_2026-10-05.md)
records artifact publication, H200 placement, and previous routing. Its main
staging preservation result is historical; this new authorization permits the
main staging cutover only.

## Preflight, Cutover, and Rollback

Fresh evidence must distinguish intended values from deployed state:

| Check | Current Evidence |
| --- | --- |
| Authenticated Fusion access | Restored; fresh preflight passes |
| Main staging baseline UI / Argo revision | Image `2.0.75-178e45b`, revision `8b0d7572294cbba83817a866883367b3236e90e5`, Healthy/Synced |
| Main staging baseline routing / Vault reference | `nemotron-voice-agent-deploy` / `stg`, Vault version `2`, target `81862ff8-4931-4f1e-9655-caa5b0bc5911` |
| Immutable UI image and effective backend | Exact tested UI and H200 route verified at `2026-10-05T05:28:08.718438Z` |
| Updated Argo revision and state | `15bad167887fb471107e39e0d6893644e8e709e9`, Healthy/Synced |
| Shared secret refresh and effective route | ExternalSecret healthy/synced; serving pod automatically rolled |
| Main staging UI, voice, and capture checks | Focused UI 12/12 pass; full A/B/C/D raw FAIL on first stock answer, B/C/D scripted pass |
| Production Astra / NVCF preservation | Current cutover-scope comparison passes at `05:36:25.241590Z`; historical missing realtime function remains unexplained |
| Main staging rollback revision / image / routing | Prior image/configuration/Vault version available; no rollback executed or fresh recovery qualification |

Fresh preflight at `2026-10-05T05:22:20.559471Z` confirms main staging and
production Argo are Healthy/Synced at `8b0d7572294c`. Production Vault remains
version `1`, targeting `81862ff8-4931-4f1e-9655-caa5b0bc5911`. The isolated
staging app remains revision `46d5fb7e3cc2`, Vault version `3`, targeting the
H200 function above. The main staging invocation credential already returns
explicit-version backend health HTTP `200` / `ok` in 2,922 ms; it is preserved.
This single health probe does not qualify voice latency or full model behavior.

At `2026-10-05T05:24:12.046316Z`, only main staging `NVCF_HOST` and
`NVCF_FUNCTION_ID` change. Vault advances from version `2` to `3`; the
invocation credential and all unrelated secret values are preserved. Deployment
values update successfully at `05:24:14.136120Z`. Its five changed paths are
UI image tag, UI build timestamp, `appDefaults` and backend routing annotations, and
shared-secret refresh interval from 60 minutes to 1 minute. Hostname, app,
roles, and unrelated environment keys are preserved. At
`2026-10-05T05:28:08.718438Z`, Argo is Healthy/Synced at
`15bad167887fb471107e39e0d6893644e8e709e9`. Pod
`nemotron-voice-agent-backend-588ccfcbb5-89b4t`, created at `05:27:15Z`, is
healthy with the exact UI image. Public configuration returns HTTP `200`,
SHA-256 `73de581dfcbb55eba2f7b2aeca9e799908f805d5c7aedc6e544dc11340139557`,
and the intended UI timestamp. Health is HTTP `200` / `ok` in 964 ms; Generic
and Omni session configuration each return HTTP `200` in 1,162 ms and 1,098 ms.
These HTTP measurements do not establish spoken-response latency.

Rollout history retains initial HTTP `200` health responses containing HTML,
which cannot be parsed as JSON, through `05:27Z`. The ExternalSecret syncs and
the runtime pod rolls automatically; valid JSON readiness follows without an
additional agent mutation. This sequence does not establish the failure’s exact
cause. At `05:28:50.222948Z`, main and isolated staging health, deployment-body,
configuration, and index checksums match. Capture reports zero pending and zero
failed sessions, without recorded errors. These are pre-suite snapshots.

The primary performs live mutations and qualification. This documentation task
performs no external deployment or secret changes. A successful command alone
does not establish serving revision, routing, or model readiness.

## Focused Main UI Checks and Rollback

The focused browser check completes **PASS**, 12/12, at
`2026-10-05T05:39:20.947Z`. It verifies both example cards; **Prompts**, **Tools**,
**Voice**, and **Start conversation**; Tools hover; history default `8` and
range `1`–`20`; both prompt expansion actions and a large editor; and 3 speech
engines with a custom sample file input. Console errors are zero. Screenshots
retain the landing, tools, expanded prompt, and voice views on the main URL.

Three earlier temporary probe attempts remain raw **FAIL** in their own files.
The first two query Start with different case or before its preparing state
settles. The third matches both a `SECTION` and an `INPUT` labeled
“Custom voice sample.” The final probe waits for the canonical action and
selects the file input inside the section. These probe-authoring errors do not
establish application failures; no application or deployment changes resolve
them.

Rollback availability is checked at `2026-10-05T05:41:26.435771Z`. The previous
`2.0.75-178e45b` UI remains in the registry, and the baseline values file and
Vault version `2` reference preserve old routing to
`81862ff8-4931-4f1e-9655-caa5b0bc5911`. The invocation credential is unchanged.
The previous UI registry digest is
`sha256:33565f212723680ba06d023f15915ead1b55ede450276074a28f4cc022288071`;
retained baseline values SHA-256 is
`4671b314efd31ef298ffbbe500089fd833e6fc9550471b8d60f64693cf7f8455`.
Recovery restores only main staging values and the two routing entries,
keeping the credential. No rollback executes, no NVCF mutation occurs, and
available baseline configuration is not a freshly qualified recovery.

## Existing Qualification Limits

The [comprehensive isolated staging report](COMPREHENSIVE_ASTRA_STAGING_2026-10-05.md)
retains both complete A/B/C/D failures. On the corrected backend, B/C/D pass;
A initially cannot navigate. A standalone Generic retry is raw pass with
17 inputs with detected bot speech and all 7 tools, but its first stock answer lacks a numeric
quote. Supplemental stock semantic qualification is failed. A later numeric
quote does not repair that turn.

At the earlier report’s completion, the numeric stock oracle has only local
checks. The new main-URL invocation uses it live. Dynamic progress is
query-specific, and the exact fixed phrase is
absent in the retry. These observations do not establish complete semantic or
acoustic acceptance. Concurrency has 8 distinct responding sessions, but
independent recognition matches only 6/8 own codes; the missing numerals remain
unresolved. Human listening and specialized release gates remain unqualified.

The previous final public readback has 1 pending capture, 0 failed captures,
and no recorded errors. Verified consented archives remain separate from a
complete capture lifecycle qualification. Fresh main staging capture evidence
must be recorded independently.

Prior production comparison finds protected realtime NVCF function
`629e6105-1094-4588-830f-4827a772f05c` absent while 5 other protected functions
remain unchanged. Its cause and actor are unknown; prior task mutations target
only isolated staging. The prior final authenticated Vault/Argo audit is blocked by expired Fusion
authentication. This new task restores authentication and records a fresh
preflight baseline. The final current-scope comparison is reported separately below.
Historical reports remain unchanged, including that earlier blocked audit.

## Current Production Protection Comparison

At `2026-10-05T05:52:03.117849Z`, `protection-current.json` passes the final current
cutover scope. Production values, Vault version `1`, secret names, routing to
`81862ff8-4931-4f1e-9655-caa5b0bc5911`, and public configuration SHA-256
`97cfdd2715d502f2c63482b1be9cbae2f7ac3372b902962c2834d9e5a88c8aa8` remain
unchanged. No production path or secret is mutated.

Production Argo revision advances from `8b0d7572294c` to
`15bad167887fb471107e39e0d6893644e8e709e9` because staging and production
watch the shared deployment Git repository. Production remains Healthy/Synced;
its values, Vault routing, and public UI configuration do not change. Argo
revision equality is not the preservation criterion in this shared repository.

Isolated staging values, Vault version `3`, routing to the H200 function, and
revision `46d5fb7e3cc2` also remain unchanged. All 6 current-task deployment
rows retain exact identities, specifications, and timestamps: 5 protected
functions plus the isolated staging function. Protected realtime `629e6105`
is already absent from the current task’s preflight and remains absent. This
comparison does not clear its earlier unexplained disappearance or rewrite
that historical protection failure.

## Full Suite on the Main URL

The new real-browser invocation has separate identities:

| Item | Value |
| --- | --- |
| Run ID | `20261005T053011Z-main-astra-staging-comprehensive-all` |
| Fixture started (UTC) | `2026-10-05T05:30:11.855Z` |
| Selected phases | `all` |
| Workspace report commit | `29464e27567afdc9f6c0bb114ab33071891d1c3f` |
| Harness logic commit | `17b2743de27093c64a1b997a8fb0662999ce04e4` |
| Loaded fixture SHA-256 | `9300b12ad8b83efa2c5e1a2c8fb0279a8e47f0e417b398f06f3fde7c02c4fe2d` |
| Backend / UI source | `84b0a8c212147fd46d658f2e01b4c555b08b641f` / `5e7ec4298c22c950e072e576ccf64a0b37debda7` |
| Astra revision | `15bad167887fb471107e39e0d6893644e8e709e9` |
| Finished (UTC) | `2026-10-05T05:49:43.674Z` |
| Overall outcome | **FAIL**, exit `1`; A fails first-stock numeric quote, B/C/D scripted pass |

The stock oracle requires a numeric quote; an image acknowledgement alone
cannot pass the fixture-feature check. No source or deployment changes occur
during this run. The completed outcomes are:

| Phase | Raw Outcome and Scope |
| --- | --- |
| A | **FAIL**, session `f42460381d2c`: 17/17 received inputs with detected bot speech, all 7 tools, 10/10 native calls. Only hard failure is stock turn 4 without a numeric quote; repeat turn 12 includes `233.95 USD`. |
| B | **PASS**, session `4096f421e664`, all 13 voice checks plus uploaded-image HTTP `200` / red-square and `BANANA42` description, and webcam HTTP `200` / red-square description. |
| C | **PASS**, all 12 hard UI checks; submitted prompt verified separately, with one model-marker behavior warning. Consented session `19392f969eab`; interim queue has 2 pending and 0 failed. |
| D | **PASS**, 8/8 connected/responded, 8 unique IDs, 16 turns with detected bot speech, zero literal other-code leaks, hangs, or errors; 60.6 seconds. |

Across all phases, 52/52 inputs are received and have detected bot speech. Recorded console, bad
HTTP, and WebSocket errors are zero, including every D browser.

Native tool calls and audible responses do not establish correct requested
answers. The stricter stock oracle sets `answered: false` for turn 4’s company
overview and progress phrase, preserving the known semantic failure rather than
accepting the word “price.” The later numeric quote does not repair that turn.

Supplemental D first-code review matches application reply text in 7/8 cases:
“Echo 5” becomes “Go 5.” Independent bot recognition matches 5/8, omitting
Bravo’s 3 and Golf’s 1, with no Echo text. Alpha’s second reply also has empty
independent recognition despite a reply in application text and `botSpoke`.
These observations limit the raw concurrency pass. They do not establish
complete acoustic fidelity or whether differences originate in input
recognition, output, or the independent recognizer. Causes and human listening
remain unresolved. Final capture and protected-production evidence is separate
from those semantic and acoustic gates.

## Final Capture and Serving Readback

At `2026-10-05T05:56:15.257462Z`, both consented archives reach NGC
`UPLOAD_COMPLETE` and are downloaded. Checksums, logs, transcripts, and WAV
integrity pass. B `4096f421e664` contains 16 automatic speech recognition (ASR)
WAVs and 17 text-to-speech (TTS) WAVs; C `19392f969eab` contains 1 ASR and
2 TTS WAVs. This verifies the named sessions, not every capture lifecycle path.

Final main staging postflight at `2026-10-05T05:56:27.182600Z` passes. Values
match the applied configuration, Vault version `3` routes to
`fa20412a-4da3-45a1-8057-a076039580e2`, and Argo remains Healthy/Synced at
`15bad167887fb471107e39e0d6893644e8e709e9`. Public health and configuration
return HTTP `200`, retaining the expected UI timestamp and configuration hash.
The `05:56:27.182600Z` capture snapshot has 1 pending session, 0 failures, no
recorded error types, and zero maximum attempts. The latest readback at
`2026-10-05T06:05:48.437176Z` reports 0 pending and 0 failed sessions, no error
types, and zero maximum attempts. Upload readiness, consent requirement, and
shared S3 storage remain enabled. The queue is drained at that observation;
this does not qualify every capture termination path.

## Evidence and Documentation Review

New evidence is retained under `/tmp/nva-main-astra-staging-cutover-20261005`.
Fresh authentication and baseline are recorded in `preflight.json`;
`vault-cutover.json` and `values-update.json` record applied staging changes.
`main-staging-readiness.json` and `route-diagnostic.json` record convergence
and effective-route checks. `main-ui-browser-check.json`, earlier probe attempts,
and `rollback-availability.json` retain focused UI and recovery evidence. `run-metadata.json` records the current full-suite
identity and final raw suite result. `protection-current.json`,
`capture-content-validation.json`, and `main-final-postflight.json` retain the
final named protection, archive, and serving checks. `capture-final-status.json`
records the latest drained queue. Retained rollback
availability is not a fresh recovery qualification. No production promotion or new full-suite
qualification is claimed. Previous reports and their raw failures remain
unchanged. Observation timestamps use UTC; the report date uses Asia/Kolkata.
