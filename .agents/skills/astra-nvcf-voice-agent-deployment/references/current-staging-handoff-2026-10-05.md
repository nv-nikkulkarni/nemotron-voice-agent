# Current Staging Handoff

## Snapshot Scope

This snapshot records work completed on October 05, 2026. Observation times use UTC.
Refresh live state before acting; this file does not authorize production promotion,
NVCF lifecycle changes, or cleanup. The user authorization recorded for that task covered main Astra staging only.
Production Astra and production NVCF functions remain protected.

At the time of this snapshot, the active checkout was `/home/nikkulkarni/workspace/nva-nvcf-rebased-v2`, on
`dev/nikkulkarni/demo-feedback-20261003`. That branch was consolidated into
`dev/nikkulkarni/nvcf-deploy-rebased-v2` on October 08 and then deleted locally.
Refer to the [October 08 Deployment Handoff](deployment-handoff-2026-10-08.md) for
subsequent production changes. Existing unrelated work and environment files remain preserved.

## Serving Environments

The main UI cutover reuses published artifacts and the existing H200 staging backend.
It does not build an image, create an NVCF version, or remove another deployment.

| Environment | Serving State |
| --- | --- |
| Main Astra staging | App `nemotron-voice-agent-deploy`, environment `stg`; [main staging UI](https://nemotron-voice-agent-deploy-backend.stg.astra.nvidia.com) |
| Isolated Astra staging | App `nemotron-voice-agent-2-deploy`, environment `stg`; [isolated staging UI](https://nemotron-voice-agent-2-deploy-backend.stg.astra.nvidia.com); retained unchanged |
| Shared staging backend | Function `nemotron-voice-agent-2`, ID `fa20412a-4da3-45a1-8057-a076039580e2` |
| Backend version / deployment | `dca45c20-c569-4b86-be50-adde5c3c99a1` / `010c94c1-6e27-4b36-a0f7-44b006a8826d`; ACTIVE |
| GPU placement | `nvcf-dgxc-k8s-oci-nrt-prd6-1`, H200, `OCI.GPU.H200_8x`; min/max `1`/`1`, concurrency `100` |
| Main Argo revision | `15bad167887fb471107e39e0d6893644e8e709e9`; Healthy/Synced |
| Isolated Argo revision | `46d5fb7e3cc242772d6c8d8dfd874eec5d5212e8`; Healthy/Synced |
| Main staging Vault | `fusion/astra/nemotron-voice-agent-astra/nemotron-voice-agent-deploy/stg`, version `3`, targets the staging function above |

The infrastructure cluster name contains `prd`; it does not make this staging function
production. The protected main production function remains
`81862ff8-4931-4f1e-9655-caa5b0bc5911`, version
`256d5eb0-6dc1-480b-8420-4aebcd49f29d`, deployment
`a3677b64-2b21-42d2-bb8a-16509b0e435a`.

The final main staging readback at `2026-10-05T05:56:27.182600Z` confirms the applied
values, Vault routing, expected UI build timestamp, and health HTTP `200` / `ok`.
Fusion 0.34.0 authentication is restored for this task. Refresh authentication before
future operations rather than treating this observation as a permanent login guarantee.

## Immutable Artifacts

The serving release uses these exact artifacts:

| Artifact | Identity |
| --- | --- |
| UI source | `5e7ec4298c22c950e072e576ccf64a0b37debda7` |
| UI image | `artifactory.nvidia.com/it-astra-docker-local/nemotron-voice-agent/nemotron-voice-agent-ui:dev-5e7ec42-20261004-backend-history` |
| UI OCI index / AMD64 manifest | `sha256:4df4756243e3bee149c70521c7e30c3c0e711cad37041ef178922399ce8632fc` / `sha256:d4af1045e06feaea16d33c954f658e0e56f45b33424c51c6227228f31190490f` |
| UI build timestamp | `2026-10-04T18:36:12Z`; the footer describes the baked build time as deployment time |
| Backend source | `84b0a8c212147fd46d658f2e01b4c555b08b641f` |
| Backend image | `nvcr.io/0491162300748285/nemotron-voice-agent:dev-84b0a8c-20261005-dynamic-filler` |
| Backend OCI index / AMD64 manifest | `sha256:2d58e2222be405b2f66d619aafe4a6d4d6d2656ceb3b3eee38021d6b38a28700` / `sha256:35c4fdf67d2c0d4d1bf4d0a5f9032285730d3caee7250eb8188735c2128325aa` |
| Helm chart | `0491162300748285/nemotron-voice-agent:0.1.141-dev.20261004.23`, `appVersion` `2.0.68` |
| Chart package SHA-256 | `a22d4b1e08a922ff4d743e98c4a3ac7dbb565090a6eab0def568bd4cee297fc5` |

The backend uses Generic `talker_authored` progress instead of the fixed code-authored
filler selector. Backend conversation history defaults to 8 turns, with a configurable
range of 1 through 20. Web search uses `perplexity/perplexity/sonar-pro` through
`https://inference-api.nvidia.com/v1`. Preserve the provider-qualified model ID.

## Main UI Cutover

At `2026-10-05T05:24:12.046316Z`, only main staging `NVCF_HOST` and
`NVCF_FUNCTION_ID` change; Vault advances from version `2` to `3`. The existing
invocation credential works for the intended backend and remains unchanged.
No secret values appear in the handoff or browser configuration.

The staging values update changes five paths: UI image tag, build timestamp, two routing
pod annotations, and shared-secret refresh interval from 60 minutes to 1 minute.
Identity, hostname, roles, examples, and unrelated configuration remain preserved.
The runtime pod rolls after secret synchronization. Initial health responses contain SPA
HTML; valid backend JSON follows. This sequence does not establish the exact cause.

The focused main-URL browser probe passes 12/12 checks. It verifies the example cards;
**Prompts**, **Tools**, **Voice**, and **Start conversation** actions; hover behavior;
history range; both expanded prompt editors; and three speech engines with a sample file input.
Earlier failed temporary probe attempts remain preserved as selector/wait errors.

## Completed Main URL SQA

The full real-browser run is `20261005T053011Z-main-astra-staging-comprehensive-all`,
from `2026-10-05T05:30:11.855Z` through `05:49:43.674Z`. Its target is the main staging
URL, not the isolated `-2` URL. Harness logic is commit
`17b2743de27093c64a1b997a8fb0662999ce04e4`; loaded fixture SHA-256 is
`9300b12ad8b83efa2c5e1a2c8fb0279a8e47f0e417b398f06f3fde7c02c4fe2d`.

The raw aggregate verdict is **FAIL**, exit code `1`, with these phase results:

| Phase | Result | Evidence and Limits |
| --- | --- | --- |
| A, Generic tools | FAIL | All 17 inputs produce detected speech; all 7 tools and 10 expected native calls occur. Turn 4 gives a company overview without a numeric stock quote. A later `233.95 USD` quote passes but does not repair the failed turn. |
| B, Omni voice and media | PASS | 13/13 voice answer checks pass. Upload and webcam requests return HTTP `200`; descriptions identify the red square and fixture features. |
| C, UI and lifecycle | PASS with warning | 12 hard checks pass. The edited prompt reaches the backend, but Lightning does not echo the requested marker. Prompt compliance remains unqualified. |
| D, eight mixed concurrent sessions | PASS with fidelity limits | All eight connect, speak, and have unique IDs; no detected leakage, hangs, or browser errors. Supplemental review matches 7/8 own codes in bot text and 5/8 in independent audio recognition. |

All 52 tested turns have received input and detected bot speech. This does not prove
complete spoken content. In D, application ASR changes “echo five” to “Go, 5.” Independent
bot ASR omits Bravo and Golf numeric suffixes and returns no text for Echo. Alpha’s second
reply also has empty independent ASR despite a bot reply and detected audio. Capture
timing, synthesis, and independent-recognition causes remain unresolved. Preserve raw
results and WAVs before diagnosing them.

## Capture and Protection Evidence

At `2026-10-05T05:56:15.257462Z`, both consented archives are downloaded and validated:

| Session | Registry State | Archive Contents |
| --- | --- | --- |
| B `4096f421e664` | `UPLOAD_COMPLETE`, checksum matches | Logs, transcript, 16 ASR WAVs, and 17 TTS WAVs |
| C `19392f969eab` | `UPLOAD_COMPLETE`, checksum matches | Logs, transcript, 1 ASR WAV, and 2 TTS WAVs |

WAV headers, nonempty samples, and durations validate. This does not qualify every capture
termination path. The `05:56:27Z` snapshot has 1 pending session, 0 failed sessions, and no recorded
upload errors. The latest capture readback at `2026-10-05T06:05:48.437176Z` has
0 pending and 0 failed sessions, no error types, and zero maximum attempts, with upload
readiness, consent, and shared S3 storage enabled. The queue is drained at this observation;
full capture lifecycle qualification remains incomplete.

The final protection comparison at `2026-10-05T05:52:03.117849Z` passes for this cutover:
production values, Vault version `1`, routing, public UI configuration, and the five
protected NVCF deployments present before the cutover remain unchanged. The isolated
staging app and shared staging NVCF deployment also remain unchanged.

Production Argo advances to the same `15bad167` revision because both environments watch
the shared Git repository. This staging-only commit does not change production values.
Historical protected Realtime function `629e6105-1094-4588-830f-4827a772f05c` is already
absent before this task. Its earlier disappearance and actor remain unexplained.
This cutover comparison does not clear that historical discrepancy.

## Available Rollback and Remaining Work

The previous main staging UI `2.0.75-178e45b` remains available with registry digest
`sha256:33565f212723680ba06d023f15915ead1b55ede450276074a28f4cc022288071`.
The retained before-values file has SHA-256
`4671b314efd31ef298ffbbe500089fd833e6fc9550471b8d60f64693cf7f8455`.
Vault version `2` records the earlier `81862ff8` routing; the credential is unchanged.

A rollback restores only main staging values and the two routing entries, waits for secret
refresh and runtime rollout, and verifies HTTP, WebSocket, and voice. No rollback runs in
this task. The available baseline is not a freshly qualified recovery. Do not undeploy
NVCF or mutate production to perform this UI rollback.

The remaining work is stock-answer delivery diagnosis, prompt-marker compliance,
ASR/EOU and spoken-code fidelity diagnosis, full capture lifecycle, and specialized release gates. Exact approved 8A-6 pronunciation
requires human listening. Barge-in, provider-failure, larger concurrency matrices, and
human-microphone acceptance are not cleared by the A/B/C/D raw passes. The candidate is
not fully qualified for production promotion; no production migration is authorized.

## Durable Reports and Raw Evidence

Use these repository reports for detailed, dated results:

- `tests/sqa/reports/MAIN_STAGING_UI_CUTOVER_2026-10-05.md` records this cutover and main-URL run.
- `tests/sqa/reports/COMPREHENSIVE_ASTRA_STAGING_2026-10-05.md` retains prior isolated full-run failures.
- `tests/sqa/reports/BACKEND_HISTORY_STAGING_2026-10-05.md` records artifact publication and H200 rollout.

Raw evidence is under `/tmp/nva-main-astra-staging-cutover-20261005`, including full JSON,
WAVs, screenshots, capture archives, protection comparison, and rollback metadata.
Temporary paths are host-local evidence, not durable recovery storage. Preserve or archive
that evidence before host cleanup. Historical reports remain unchanged.

## Update: UI v3 on Main Staging

Later on 2026-10-05, main staging serves UI `dev-9c89334-20261005-zeroshot-default`
(source `9c89334`, index `sha256:91c651448dd75edd198962e50fa29f93fd3da7cd5af39f0cf77284e57386b447`).
The backend function and deployment are unchanged, and production is untouched. This supersedes the UI
rows above. Results, rollback tags, and open items are in
`tests/sqa/reports/MAIN_STAGING_UI_V3_2026-10-05.md`. The staging UI is not qualified for production.

Superseding note: main staging was updated again the same day and now serves UI
`dev-da8ee12-20261005-eventlog-tab` (source `da8ee12`, index
`sha256:f0d9abfebeba7e67029e8bbcb2f378a5ff9915c23fad943050b29b596d0afef4`). See the later-releases table in the
report above for the full chain and rollback tags.
