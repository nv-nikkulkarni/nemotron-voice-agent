# Backend History and Dynamic Filler Staging Deployment

**Date:** October 05, 2026 (Asia/Kolkata)

**Scope:** Deploy the tested backend-history artifacts to isolated NVIDIA Cloud
Functions (NVCF) and Astra staging on H200. Production functions and the
production Astra UI are protected. Any H100 retirement applies only to an
identified staging deployment after replacement checks pass.

**Status:** Deployed; full SQA qualification is **FAIL**. The corrected
dynamic-filler backend is `ACTIVE` on H200; HTTP health, session readiness, and
real TTS previews pass. The corrected full A/B/C/D suite is raw **FAIL** on its
Generic initial-navigation timeout; Omni, UI, and concurrency phases pass. The
separate Generic retry is raw **PASS**, but supplementary first-stock-answer
semantics fail. The initial full suite is **FAIL** on image upload and browser
networking. A later focused smoke passes weather/stock but fails BMI after the
height is absent from the application transcript. A protected function is
unexpectedly missing; final Astra/Vault and production audit are incomplete. No
overall qualification pass is claimed.

## Source and Artifact Identity

The immutable artifact source is separate from this report's documentation
commit:

| Item | Verified Value |
| --- | --- |
| Source branch | `dev/nikkulkarni/demo-feedback-20261003` |
| Current app source | `84b0a8c212147fd46d658f2e01b4c555b08b641f` |
| Retained UI and chart source | `5e7ec4298c22c950e072e576ccf64a0b37debda7` |
| Current app image | `nvcr.io/0491162300748285/nemotron-voice-agent:dev-84b0a8c-20261005-dynamic-filler` |
| Current app OCI index | `sha256:2d58e2222be405b2f66d619aafe4a6d4d6d2656ceb3b3eee38021d6b38a28700` |
| Current app AMD64 manifest | `sha256:35c4fdf67d2c0d4d1bf4d0a5f9032285730d3caee7250eb8188735c2128325aa` |
| UI image | `artifactory.nvidia.com/it-astra-docker-local/nemotron-voice-agent/nemotron-voice-agent-ui:dev-5e7ec42-20261004-backend-history` |
| UI OCI index | `sha256:4df4756243e3bee149c70521c7e30c3c0e711cad37041ef178922399ce8632fc` |
| UI AMD64 manifest | `sha256:d4af1045e06feaea16d33c954f658e0e56f45b33424c51c6227228f31190490f` |
| UI build timestamp | `2026-10-04T18:36:12Z` |
| NGC chart | `0491162300748285/nemotron-voice-agent:0.1.141-dev.20261004.23` |
| Uploaded and pulled chart SHA-256 | `a22d4b1e08a922ff4d743e98c4a3ac7dbb565090a6eab0def568bd4cee297fc5` |

NGC chart upload and pull verify at `2026-10-04T19:52:46.560771+00:00`.
Artifactory publication verifies the exact tested UI at
`2026-10-04T19:52:59.625023+00:00`. The later corrected app is published with
its source label verified. The initial `5e7ec42` app has OCI index
`sha256:90308c24bdbab942a829ffa12f96d756ece94af6f8db8a73321854f25e97732a` and
AMD64 manifest
`sha256:135cf0e8dad7e892afdbaf4e655fbd50a46d543274b8f3a2dfecdba08e8facd1`; it
remains available with the undeployed initial staging definition. The [dev
deployment report](BACKEND_HISTORY_DEV_2026-10-05.md) records its previous local
checks; those checks do not establish current staging health.

## Isolated NVCF and H200 Deployment

The latest corrected staging identity and readiness are:

| Item | Value |
| --- | --- |
| Function name | `nemotron-voice-agent-2` |
| Function ID | `fa20412a-4da3-45a1-8057-a076039580e2` |
| Version ID | `dca45c20-c569-4b86-be50-adde5c3c99a1` |
| Deployment ID | `010c94c1-6e27-4b36-a0f7-44b006a8826d` |
| Backend | `nvcf-dgxc-k8s-oci-nrt-prd6-1` |
| GPU and instance shape | `H200`, `OCI.GPU.H200_8x` |
| Min/max instances | `1`/`1` |
| Maximum request concurrency | `100` |
| Control-plane state at `2026-10-04T21:04:58.912948+00:00` | `ACTIVE` |
| HTTP health and Generic/Omni session readiness | Pass |
| Corrected-version TTS previews | Both HTTP `200` at `2026-10-04T21:33:33.740306Z` |
| Previous staging H100 undeploy | Not applicable; no active old isolated deployment |
| Staging rollback definition | Initial H200 version retained, currently undeployed; requires redeployment |

The initial `5e7ec42` version `215cc350-e57d-4a07-bf24-073e27d40aa6` is created
at `2026-10-04T19:54:08.136708+00:00`, then requested at `19:54:12.284680Z`. Its
deployment is `56b341d5-3a9e-44e1-92a3-ba4b0342adbd`. The staging version
receives all 6 named secrets: `NVIDIA_API_KEY`, `NGC_API_KEY`,
`PERPLEXITY_API_KEY`, `WEATHERAPI_KEY`, `FINNHUB_API_KEY`, and
`SESSION_CAPTURE_NGC`. No values are recorded.

The staging overrides preserve `app.frontendBackendToolResultMode: hybrid`,
`app.genericPlannerTimeoutSeconds: 6`, and Sonar Pro through the NVIDIA gateway:
`perplexity/perplexity/sonar-pro` at `https://inference-api.nvidia.com/v1`. The
full 8-GPU layout includes zero-shot TTS with the tested dev image digest
`sha256:e01b9d6b6cc44697a89ab9314b596b1f86fc665a30892a96e06cdeb14f35caee`. At
`2026-10-04T20:11:23.177693+00:00`, `/health` returns HTTP `200` with `ok` in
703 ms. Generic and Omni session-configuration requests each return HTTP `200`
in 552 ms and 297 ms. These single HTTP measurements do not qualify speech
latency or every model's synthesis path.

An initial probe using the local `.env` invocation credential returns HTTP
`404`. The existing isolated staging Vault invocation credential succeeds; it is
used in memory without recording its value.

## Astra Staging Cutover

The isolated UI and effective backend are inspected independently:

| Item | Latest Observed State |
| --- | --- |
| App and environment | `nemotron-voice-agent-2-deploy`, `stg` |
| Deployment layer | `nemotron-voice-agent-astra` |
| Cluster | `astrastg01-ocp-pdx04` |
| Public URL | `https://nemotron-voice-agent-2-deploy-backend.stg.astra.nvidia.com` |
| Last authenticated Argo revision, `2026-10-04T20:26:10Z` | `46d5fb7e3cc242772d6c8d8dfd874eec5d5212e8` |
| Last authenticated Argo state, `2026-10-04T20:26:10Z` | `Healthy`/`Synced`; final authenticated audit blocked |
| Deployed UI | Exact tested Artifactory image above |
| Effective Vault function target | `fa20412a-4da3-45a1-8057-a076039580e2` |
| Vault reference | `nemotron-voice-agent-astra` / `nemotron-voice-agent-2-deploy` / `stg`; routing keys above |
| Serving pod | `nemotron-voice-agent-2-backend-8699665848-588w6` |

At `2026-10-04T20:15:27.260989+00:00`, the cutover patches only the isolated
staging `NVCF_HOST` and `NVCF_FUNCTION_ID` routing entries. The invocation
credential and all unrelated secret entries are preserved. The previous target
is `7886e141-cf95-4de5-9707-84cdfe048ddf`, which has no active deployment in the
initial inventory and is not assumed to be a serving H100 rollback.

The initial UI rollout reaches `Healthy`/`Synced` at revision `29091b202a5b`.
Its existing 60-minute secret-refresh interval initially retains old routing.
Changing only isolated staging to a 1-minute interval and refreshing its pod
routing annotation syncs the ExternalSecret. The public route returns HTTP `200`
by `2026-10-04T20:19:52.702840+00:00`. At `2026-10-04T20:26:10.476218+00:00`,
the last authenticated revision is Healthy/Synced and the ExternalSecret is
healthy and synced. Functional outcomes are reported separately below.

## Protected Production Baseline

The pre-mutation snapshot records 6 protected NVCF deployments. The main
production identities are:

| Item | Protected Value |
| --- | --- |
| NVCF function | `81862ff8-4931-4f1e-9655-caa5b0bc5911` |
| NVCF version | `256d5eb0-6dc1-480b-8420-4aebcd49f29d` |
| NVCF deployment | `a3677b64-2b21-42d2-bb8a-16509b0e435a` |
| Astra app and environment | `nemotron-voice-agent-deploy`, `prd` |
| Astra revision | `8b0d7572294cbba83817a866883367b3236e90e5` |
| Production UI build timestamp | `2026-09-07T21:00:50Z` |
| Production config SHA-256 | `97cfdd2715d502f2c63482b1be9cbae2f7ac3372b902962c2834d9e5a88c8aa8` |
| Vault target | Main production function above, Vault version `1` |

At `2026-10-04T20:30:16.686223+00:00`, all 6 existing NVCF function/version/
deployment identities, specifications, and timestamps are unchanged. Production
Astra revision, public configuration hash, Vault version `1`, secret names, and
target remain unchanged. Main Astra staging is also unchanged. This is a
historical protection pass, not the final audit. At
`2026-10-04T21:08:06.911754+00:00`, 5 protected NVCF deployments are unchanged,
but protected realtime function `629e6105-1094-4588-830f-4827a772f05c` (version
prefix `91aca901`) is absent and both function/deployment lookup return `404`.
The final NVCF protection check is **FAIL**. Its cause and actor are unknown;
the recorded agent mutations target only isolated staging
`fa20412a-4da3-45a1-8057-a076039580e2`. A bounded read-only audit times out.
Fusion authentication expires, so final authenticated Astra and Vault audit are
**BLOCKED** pending user login. At `2026-10-04T21:58:54.090325Z`, final
read-only postflight still confirms 5/6 protected NGC baselines, with the
protected realtime function absent. Main production and main staging public
configuration both return HTTP `200` with the protected SHA-256 above. These
public readbacks do not replace the blocked authenticated Vault/Argo audit. No
blanket final production-preservation pass is claimed. The current isolated
stage remains `ACTIVE` with the corrected app tag, H200 8-GPU shape, min/max
`1`/`1`, and concurrency `100`. Its public health returns HTTP `200` / `ok` in
1,168 ms; configuration returns HTTP `200` in 850 ms, SHA-256
`73de581dfcbb55eba2f7b2aeca9e799908f805d5c7aedc6e544dc11340139557`.

No old isolated staging H100 deployment exists to retire. The later retirement
is the initial isolated **H200** version; the original inactive Vault target is
not a qualified serving rollback.

## Validation and Qualification Boundary

Prior source validation reports 176 focused tests and 28 subtests passed. The
full suite records 830 passed, 3 opt-in compatibility skips, 55 subtests passed,
and 3 existing baseline failures. Scoped UI lint retains 4 existing `AppContext`
findings. The prior dev smoke passes 7 spoken turns and a referential weather
follow-up. Staging outcomes are separate below.

The first smoke connects and hears its initial London response, then suffers a
fatal disconnect near a UI pod refresh. The timing does not prove a cause. The
stable run `20261004T202548Z-staging-smoke` completes from
`2026-10-04T20:25:49.228Z` through `2026-10-04T20:29:45.151Z`. All 4 functional
checks pass: history controls/persistence, 7-turn London weather follow-up, a
unique limit-1 replacement session, and Omni arithmetic/image/end. The image
description identifies the synthetic `BANANA42` scene.

The stable run remains raw **FAIL** due to one unexpected capture POST
`ERR_ABORTED`. It separately records one expected navigation GET cancellation;
console errors, bad HTTP responses, and WebSocket errors are zero. Archive
success does not rewrite that raw failure or prove capture loss. A subsequent
normal observer passes explicit decline and consent: sessions `0c9d3491f0e3` and
`8cecb09e01ac` each return first-attempt HTTP `200` in 411 ms and 465 ms, with
`captureFlushed: true`. The client uses a 650 ms timeout and 2 attempts; the
earlier canceled POST remains unattributed.

The 7 Generic turns display latency from 2.56 s through 3.00 s, with median 2.59
s. This is the UI-reported latency read by the harness, not an independent
acoustic measurement or a controlled H100/H200 comparison.

Consented session `96bce3cc65ae` reaches NGC `UPLOAD_COMPLETE`: 1 archive,
438,263 bytes, SHA-256 base64 `J7oG9zViDfFuH8OLUOg9V8mwksoXc8pqNrkG322ykzo=`.
Downloaded content matches the checksum and includes `session.log`, transcript,
2 ASR WAVs, and 3 TTS WAVs. All 5 WAVs are 22,050 Hz mono. Capture reports
shared S3 storage and upload readiness, with 1 pending session and zero failed
sessions at the readback. The final `21:58:54.090325Z` readback remains HTTP
`200`, enabled and upload-ready, with upload and consent required, dedicated NGC
key present, shared S3 storage, 1 pending session, 0 failed sessions, an empty
recorded error type list, and zero maximum attempts. The pending cause is not
established; the queue is not empty.

Initial Magpie and zero-shot previews return HTTP `502`, then both return `200`
at `2026-10-04T20:32:54.298368+00:00`, producing 4.275 s and 3.158 s WAVs in
1,060 ms and 1,263 ms. A generated synthetic 4-second reference also produces a
1.765 s Halloween sample in 1,476 ms. The startup `context_encoder.onnx` warning
does not prevent these later functional responses; no root cause is inferred
from it. Initial diagnostics report zero image-pull errors. Log retrieval and
exec command restrictions remain diagnostic limits.

The separate [comprehensive Astra staging
report](COMPREHENSIVE_ASTRA_STAGING_2026-10-05.md) records the initial A/B/C/D
**FAIL**: A passes all 7 tools; B fails image upload; C fails a browser console
network-change error despite 12 passing hard UI checks; D cannot navigate any of
its 8 pages. These raw outcomes are retained.

The Generic fixed-filler correction is committed at
`84b0a8c212147fd46d658f2e01b4c555b08b641f`, with 213 focused tests and 45
subtests passed. An in-place update exits successfully but leaves the old tag
and `lastUpdated` unchanged; that attempt is not a deployment. The replacement
version is created at `2026-10-04T20:59:35Z`, becomes `ACTIVE` at
`21:04:58.912948Z`, and returns explicit-version HTTP `200` for health, Generic
session configuration, and Omni configuration in 910 ms, 1,389 ms, and 207 ms.
Instance `sr-65856123-06de-4b49-bba5-3759218788d7-miniservice` is new; retained
topology does not imply retained model-instance identity.

Only the initial isolated staging version `215cc350-e57d-4a07-bf24-073e27d40aa6`
is gracefully undeployed at `2026-10-04T21:06Z`. The list then shows only
`dca45c20-c569-4b86-be50-adde5c3c99a1` active in that function. The old version
definition is retained for rollback; rollback requires redeployment. UI, chart,
and H200 shape are retained. Corrected-version Magpie and zero-shot previews
initially remain HTTP `502`, despite passing HTTP session readiness. At
`2026-10-04T21:33:33.740306Z`, both return HTTP `200`: Magpie produces a
4.384-second WAV in 2,265 ms and zero-shot produces a 3.344-second WAV in 2,622
ms. All 44 watch observations retain startup failure and recovery. At
`2026-10-04T21:34:26.023225Z`, a reference-sample zero-shot preview also returns
HTTP `200`, producing a 1.765-second WAV in 3,544 ms. Recovery does not
establish the earlier failures’ cause. The full corrected suite starts after
real previews pass.

Focused run `20261004T210938Z` (session `c9842eb0bef7`) is raw **FAIL**: Tokyo
weather and NVIDIA stock call their real tools and produce distinct
query-specific fillers, “Let me check Tokyo weather.” and “Let me verify
NVIDIA’s latest price.” BMI produces a candidate filler but no BMI service call
and falls back. Its 6.3-second input independently contains both 70 kg and 1.75
m, while the application transcript omits the height. That verified input
discrepancy is separate from filler-policy behavior; its upstream cause is
unresolved. Corrected full suite
`20261004T213348Z-astra-staging-dynamic-filler-all` finishes raw **FAIL** at
`2026-10-04T21:47:31.378Z`, using test commit
`3558a72f3e5dde2f552bee708a144f66a29d7521` and fixture SHA-256
`fa773606047b2ce16a2ea6feb46af7ad1517321086ddef8758e19c20d8bff734`. Its metadata
labels Astra revision `46d5fb7e3cc242772d6c8d8dfd874eec5d5212e8` as last
verified, while final authenticated Fusion audit is blocked. Corrected phase A
fails before any session or tool attempt: initial page navigation times out
after 30 seconds waiting for `domcontentloaded`. B passes all 15 voice/media
checks, including real image upload and webcam. C passes 12 hard UI checks, with
a separate prompt-marker warning. D passes 8 connected/responding unique
sessions and 16 spoken inputs, without literal other-code leakage. Supplemental
D independent recognition matches only 6/8 own codes (two missing numerals), so
full acoustic code fidelity remains unqualified. Separate A retry
`20261004T214752Z-astra-staging-dynamic-filler-A-retry` completes raw **PASS**
at `21:54:55.311Z`: 17/17 audible inputs, all 7 tools and 10/10 native calls, no
browser errors/hangs. However, its stock turn 4 gives a company overview without
a numeric price; the raw answer keyword check falsely accepts “price” in
progress speech. Supplemental semantic qualification is **FAIL**, despite a
later numeric stock quote. Nine distinct query-specific progress phrases are observed and the
exact fixed “Let me check that.” is absent. No fully qualified Generic or full
corrected pass is claimed. The post-run stock oracle update
`17b2743de27093c64a1b997a8fb0662999ce04e4` requires a numeric quote and passes
syntax plus 4 negative / 3 positive probes; it is not used in a new live run.
Corrected B/C consented sessions `45cd4b4c75e4` and `bc1cfa3b9db2` reach NGC
`UPLOAD_COMPLETE`, one archive each, 3,341,210 and 317,822 bytes. Downloaded
checksums and WAV integrity pass: B contains 18 ASR/17 TTS WAVs, C6 1 ASR/2 TTS.

Corrected-version capture observer `20261004T211707Z` passes explicit decline
`1d54e99647d3` and consent `946abafe84e9`: first-attempt HTTP `200` in 441 ms
and 462 ms, both `captureFlushed: true`, with no errors or aborts. NGC reports
no declined archive and `UPLOAD_COMPLETE` for the consented session: 1 archive,
195,248 bytes, SHA-256 base64 `ptlrhU+Tn4s2Feo6yBDYIXg/dGpP2zVEQh0TTIHbhjA=`.
These checks do not qualify the complete capture lifecycle matrix.

Historical [comprehensive speech-input
findings](COMPREHENSIVE_DEV_2026-10-04.md) and the [web-search root cause
analysis](WEB_SEARCH_RCA_DEV_2026-10-04.md) remain unchanged. Full release
qualification and production promotion are outside this run. Staging H100
undeploy, if applicable, follows replacement checks; version or artifact
deletion is outside this task.

Raw local staging evidence is retained under
`/tmp/nva-staging-backend-history-20261005`, including `chart-publication.json`,
`ui-publication.json`, `nvcf-created.json`, `nvcf-deep-readiness.json`,
`vault-staging-cutover.json`, `astra-status-current.json`,
`astra-route-history.json`, `voice-preview-readiness.json`, and the protected
production baseline. Replacement-version evidence is separate under
`/tmp/nva-dynamic-filler-staging-20261005`; corrected comprehensive evidence is
under `/tmp/nva-comprehensive-astra-staging-dynamic-filler-20261005`. Response
payloads and secret values are omitted here. Artifact and observation timestamps
use UTC; the report date uses Asia/Kolkata.
