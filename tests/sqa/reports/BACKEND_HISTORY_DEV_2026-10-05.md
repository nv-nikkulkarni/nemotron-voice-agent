# Backend Conversation History Dev Deployment

**Date:** October 05, 2026 (Asia/Kolkata)

**Scope:** The Generic Frontend/Backend Assistant forwards a configurable window
of conversation history to its backend planner. This report covers the immutable
app image, local Helm deployment to `nva-dev`, and local Astra client container.
The dev rollout, focused live checks, and final UI serving checks pass.

## Artifact Identity

The serving artifacts have the following identities:

| Item | Value |
| --- | --- |
| Source branch | `dev/nikkulkarni/demo-feedback-20261003` |
| App and UI source | `5e7ec4298c22c950e072e576ccf64a0b37debda7` |
| App image | `nvcr.io/0491162300748285/nemotron-voice-agent:dev-5e7ec42-20261004-backend-history` |
| Published app OCI index | `sha256:90308c24bdbab942a829ffa12f96d756ece94af6f8db8a73321854f25e97732a` |
| Published app AMD64 manifest | `sha256:135cf0e8dad7e892afdbaf4e655fbd50a46d543274b8f3a2dfecdba08e8facd1` |
| Local UI image | `nemotron-voice-agent-ui:dev-5e7ec42-20261004-backend-history` |
| Local UI OCI index | `sha256:4df4756243e3bee149c70521c7e30c3c0e711cad37041ef178922399ce8632fc` |
| Local UI AMD64 manifest | `sha256:d4af1045e06feaea16d33c954f658e0e56f45b33424c51c6227228f31190490f` |
| UI build timestamp | `2026-10-04T18:36:12Z` |
| Chart package | `nemotron-voice-agent-0.1.141-dev.20261004.23.tgz` |
| Chart SHA-256 | `a22d4b1e08a922ff4d743e98c4a3ac7dbb565090a6eab0def568bd4cee297fc5` |
| Helm release and namespace | `nva-dev`, revision `24` |
| Helm rollback revision | `23` |
| UI rollback | `nemotron-voice-agent-ui-dev-rollback-17f3e71` (retained, stopped) |

The app image is pushed to NGC. Registry lookup verifies both digests and the
raw index hash at `2026-10-04T19:12:19.554709+00:00`. UI digests come from the
local build; the serving container uses that exact image. The chart stays local,
with no NGC chart push or pull. NVCF, Astra, and production remain unchanged
and unqualified by this run.

## Behavior and Source Validation

**Tools > Conversation context** exposes **Backend history** before starting.
The default is 8 user turns, including the current request, with a range of
1 through 20. Associated assistant text belongs to its preceding user turn.
The browser saves the selection per example for the next session on either
transport; the live inspector displays it.

`BACKEND_HISTORY_TURN_LIMIT`, Helm `app.backendHistoryTurnLimit`, and session
`backend_history_turn_limit` configure this Generic-only setting. Sanitized
history excludes protocol prompts, tool traffic, and invalid records. It drops
oldest whole turns to fit 32,000 content characters and 128 messages. Ordinary
messages avoid fixed 1,000-character clipping. Talker windows remain separate;
missing speech input is not reconstructed. Refer to the
[Generic configuration guide](../../../docs/how-to/configure-frontend-backend-domains.md#follow-up-context-and-fresh-results)
for oversized-request handling and the complete contract.

Source validation reports 176 focused tests and 28 subtests passed. The full
suite reports 830 passed, 3 skipped, 55 subtests passed, and 3 existing baseline
failures: a literal Helm artifact pin and 2 dirty skill-version metadata checks.
The skips are opt-in OpenAI Realtime SDK compatibility tests.

Scoped Python checks, UI installation/build, Helm lint and range validation,
and credential scans on 23 task files and prepared images pass. Changed UI lint
retains 4 pre-existing `AppContext` findings. Pre-commit passes; Helm validation
replaces raw YAML parsing for its template. The 4 configuration documents pass
required hooks, 36 relative links/anchors, and `git diff --check`.

## Deployment and Live Evidence

Helm revision `24` deploys the prepared chart at `2026-10-04T19:13:39Z`.
The 5 app replicas and prewarmer use the published AMD64 manifest. All 9
supporting model and storage pod UIDs are preserved. At
`2026-10-04T19:23:36.499657+00:00`, all 15 pods are Ready with zero restarts.
Four startup-probe warnings at `19:13:18Z` resolve; no image-pull errors occur.

The UI serves the exact new image at `http://localhost:7880` with health `ok`
and real deployment defaults `8`/`20`. All 4 serving browser checks pass:
default/range/persistence, 390-pixel layout, 1,440-pixel layout, and Omni
isolation. Browser signals contain zero errors or failed requests. Both
rollbacks remain available. Serving session API checks accept Generic limit
`2` and Omni without an override (HTTP `200`), while rejecting Generic limit
`0` and an Omni history override (HTTP `400`).

The unmocked run `20261004T191445Z-backend-history` passes all 3 focused checks
from `2026-10-04T19:14:46.425Z` through `2026-10-04T19:17:19.057Z`.
Unexpected request failures are zero; navigation cancellations are classified
separately in the voice report. Session `08228439d72a` submits limit `8`, displays it in the live inspector,
receives all 7 spoken inputs, and produces 7 audible replies. Turn 1 establishes
London as the favorite city. After 5 intervening turns, the weather follow-up
calls `get_weather` and answers for London.

New session `a7e90b8a8674` submits limit `1`, receives its welcome, and ends.
Session-tagged runtime logs confirm both limits and budget caps on the new app
image. These logs correlate configuration; they do not trace model-request
payloads. The limit-1 check covers lifecycle, not spoken forgetting.

Independent bot recognition records “One Two” for turn 4 while the transcript
shows “One, two, three.” Exact spoken-content fidelity is not the history oracle.
Earlier staged checks with mocked metadata remain separate preliminary evidence.

Capture status returns HTTP `200` with consent required, upload readiness,
a configured S3 store, and zero pending or failed sessions. Both smoke sessions
decline capture, so archive upload and readback remain unqualified.

## Qualification Boundary

This focused run does not replace the comprehensive suite, concurrency matrix,
pronunciation listening, capture archive readback, or other release gates.
The [comprehensive dev report](COMPREHENSIVE_DEV_2026-10-04.md) and
[web-search root cause analysis](WEB_SEARCH_RCA_DEV_2026-10-04.md) remain
historical evidence. Their unresolved speech-input findings are not cleared by
this history change.

Raw local evidence is under `/tmp/nva-backend-history-20261004`, including
`app-build.json`, `build.json`, `publication.json`, `rollout-checks.json`,
`ui-postflight.json`, `pods-postflight.json`, `capture-postflight.json`,
`runtime-history-configuration.json`, `session-api-postflight.json`,
`events-postflight.json`, the serving browser report, and the live run's
`history-smoke.json`. `deployment-handoff.json` summarizes the final state;
`deployment-evidence-manifest.json` indexes current deployment evidence.
The 13 original files under `predeployment-evidence/` verify against their
snapshot manifest; root metadata records the authorized rollout. Artifact
timestamps use UTC; the report date uses Asia/Kolkata.
