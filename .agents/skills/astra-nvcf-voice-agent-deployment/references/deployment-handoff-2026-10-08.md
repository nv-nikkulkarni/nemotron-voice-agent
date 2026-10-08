# October 08 Deployment Handoff

## Evidence Scope

This review reconciles the preceding deployment work and October 07 production test
results on October 08, 2026. It does not query or mutate live deployments. Treat the
identities below as previously verified observations, and refresh their control planes
before another deployment, status report, promotion, or deletion. Current user instructions
provide authorization; historical handoffs do not grant or revoke it.

## Source Branch Consolidation

The deployment worktree is `/home/nikkulkarni/workspace/nva-nvcf-rebased-v2`.
Its branch is `dev/nikkulkarni/nvcf-deploy-rebased-v2`, tracking the same branch on
`origin`, the `nv-nikkulkarni/nemotron-voice-agent` fork.

On October 03, a local `dev/nikkulkarni/demo-feedback-20261003` branch was created
from `8d37ef1`. It accumulated 53 commits through `7d831da`, including agent fixes,
Astra UI changes, staging releases, and SQA reports. On October 08, all of those commits
were consolidated into the named rebased branch and pushed at `4b6db06`. A history-only
merge retained the fork's pre-rebase commits while preserving the newer file tree.

The fetched remote contained every demo-feedback commit and an identical committed file
tree before that local branch was deleted. Pending local files were restored byte-for-byte.
The standalone branch `dev/nikkulkarni/nvcf-standalone-functions` remains separate.
Do not choose a branch from a worktree directory name; inspect Git before a mutation.

## Production Astra Promotion

After the October 05 staging snapshot, the user authorized production to use the staging
UI and backend routing. The production app is `nemotron-voice-agent-deploy` in `prd`.
The production URL is
[Production Astra UI](https://nemotron-voice-agent-deploy-backend.prd.astra.nvidia.com/).

The applied UI tag was `dev-da8ee12-20261005-eventlog-tab`, replacing
`2.0.75-178e45b`. The build timestamp was `2026-10-05T12:14:33Z`.
Production routing changed from function `81862ff8-4931-4f1e-9655-caa5b0bc5911` to
`fa20412a-4da3-45a1-8057-a076039580e2`, the backend also used by staging.
Its observed version was `dca45c20-c569-4b86-be50-adde5c3c99a1`.

Production ingress, environment identity, and Vault paths were preserved. The invocation
credential was retained server-side. The shared-secret refresh interval changed from
60 minutes to 1 minute, and a routing annotation triggered rollout. Readback showed
Healthy/Synced at revision `da38b18852c5`; public configuration, health, and API checks
matched the intended staging behavior. These checks do not establish complete voice
qualification.

The before-values file was `/tmp/nva-astra-prd-rollback.yaml`. Temporary files are
host-local evidence, not durable rollback storage. Resolve retained artifacts and verify
rollback values before relying on them; never commit Vault exports or credential values.

## October 07 Production SQA

One run exercised six UI suites and the comprehensive A–D suite. Five suites passed;
functional and comprehensive failed. The raw verdict remains FAIL. Diagnostic review
explains several reported failures without rewriting the original results.

| Suite Or Phase | Raw Result | Interpretation |
| --- | --- | --- |
| Functional | FAIL before checks | Initial navigation exceeded 30 seconds. Later navigation succeeded; exact cause is unproven. |
| Pre-session configuration | PASS | Layout, settings, voice previews, and a spoken turn passed the suite's checks. |
| LLM settings | PASS | Ten reported check groups passed, including live application and reset. |
| Voice studio | PASS | Nine reported check groups passed, with audible welcomes. |
| Architecture image | PASS | Four reported checks passed across Generic and Omni. |
| Demo feedback | PASS | Twelve spoken fixture turns passed. A diarization question received a capabilities reply, a semantic issue outside the fixture assertions. |
| Comprehensive A | PASS | Seventeen turns completed; all seven tools and ten expected native calls were observed. |
| Comprehensive B | FAIL: 7 of 15 checks passed | Six voice checks and two media checks failed in the raw report. Turn eight actually spoke “Five.” Later checks ran after the session disconnected. |
| Comprehensive C | FAIL before checks | Chromium reported `net::ERR_CERT_AUTHORITY_INVALID`. System TLS verification passed; the precise browser trust cause remains unproven. |
| Comprehensive D | FAIL: 7 of 8 completed both turns | Eight unique sessions connected with no detected literal leakage. Saved audio and backend logs confirm the reported missing response was spoken. |

The turn guard races a complete speech-and-verification operation against a timeout. That
operation includes external input synthesis, recording, external response transcription,
and browser readback. Guard expiry substitutes an empty result without canceling the
underlying operation, so it can label a completed reply as silent.

For Omni session `ec5ee7aa8f55`, backend connection and disconnection were
`2026-10-07 12:10:51.333 UTC` and `12:20:52.566 UTC`: 601.233 seconds apart.
This strongly supports expiry of the configured 600-second demo session. The backend
logged disconnection rather than an explicit timer cause. Later voice and media checks
continued without reconnecting; they do not establish eight independent model defects.

For concurrency session `b8660c1f283c`, saved browser audio independently transcribed as
“Hello, how can I help you today?” Backend input and synthesis timestamps corroborated
the response. The 45-second guard failure does not establish a production capacity defect.

The run did not qualify media understanding, phase C lifecycle, all capture termination
paths, specialized stress tests, approved pronunciation by human listening, or microphone
acceptance. There were no deployment changes during the run.

The combined report and diagnostic review are
`/tmp/nva-production-sqa-20261007/sqa-summary.json`. Raw reports, recordings, and backend
evidence remain under that temporary directory and are excluded from source commits.
Archive evidence separately before host cleanup.

## Standalone H200 Functions

The H200 migration retained each function ID and created new version IDs. These were
previously verified by real requests, independently from the complete voice-agent suite.

| Service | Function ID | H200 Version ID | Evidence Boundary |
| --- | --- | --- | --- |
| ASR | `4155ae85-73e1-4936-b47f-87b9de165651` | `60249949-64e4-4180-92cf-6297677f7495` | Confirmed working by a real request. |
| Magpie, batch 32 | `500bfea0-ba3d-4158-8276-1d04daedfdcd` | `e839491c-8742-4a67-ba55-471f429aa2d0` | Confirmed working by a real request; load remains separate. |
| Chatterbox | `8d3eb462-afcb-46d7-80ca-4e8b6c6fd20e` | `510f9d44-d6e3-490a-b626-f515f1f4dfc2` | Confirmed working by a real request. |
| Lightning | `9e6b5886-1474-4108-80d6-0cff9ba41fab` | `3c0e625b-9e61-4314-a48a-826e3911f441` | Version-pinned ordinary and streaming requests succeeded after startup. |

Lightning initially returned HTTP 504 within a 250-second polling window and reported
no running instances. Later inspection established that an instance did start; startup
was approximately six minutes. This supports a cold-start timing explanation rather than
permanent inability to scale. Subsequent ordinary and streaming requests completed in
approximately 1.51 seconds and 0.47 seconds. Transient NVCF instance-list DNS errors were
also observed; their contribution to the initial symptoms is unproven.

Lightning's observed deployment used `OCI.GPU.H200_2x`, minimum zero and maximum one.
The speech service observations do not establish all concurrency or recovery gates.

Old function versions were not deleted in this work. Sharing a function ID does not make
an old version safe to remove: identify consumers, routing, version pinning, and rollback
requirements first. Unversioned invocation can select an active version; pin the intended
version when validating a migration. Obtain authorization for exact deletion targets.

## October 08 Microphone Restart UI Rollout

The previous UI retained a disabled microphone after a muted session ended. Restarting
in the same tab could stall without input audio. Both session-start paths now enable the
microphone through the React microphone control before connecting. The user's original
Microsoft Edge profile issue remains unconfirmed; this reproduction does not establish
that user's exact cause.

Staging received the image first, followed by production using the same artifact:

| Artifact | Identity |
| --- | --- |
| Committed source | `ac9bde84a11d8910877a615f54d4304e8d7d134e` |
| UI image tag | `dev-ac9bde8-20261008-mic-restart` |
| UI OCI index | `sha256:93b3a6b805aebe747907cb81ccb7a7a38325115d71361a29598bb5eca73160f5` |
| AMD64 manifest | `sha256:45a0f9f245f5847aaff2082f725ae02ff69d34803a06a51b4e72f9d4872d67d2` |
| UI build timestamp | `2026-10-08T07:43:44Z` |
| Served JavaScript | `/assets/index-DkW6FLiG.js` |
| JavaScript SHA-256 | `b68b0fabf501589f371f8548f6a65889d9e1773ff6fde0fe1fe40a4c1d99ba3d` |

The registry-verified image used a committed archive of Astra client and Docker sources.
Fresh Fusion exports matched reviewed values; only the image tag and
`UI_BUILD_TIMESTAMP` changed. Backend routing, Vault references, secrets, ingress, and
unrelated configuration remained unchanged. No backend function was redeployed.

Staging qualification began at Healthy/Synced revision `1c2376fd6ba5`. Production
synchronized at `2026-10-08 07:53:08 UTC`; final readback showed both environments
Healthy/Synced at shared-repository revision `6227ff9024fb`. Public configuration,
JavaScript and CSS checksums, and health responses matched. All five committed PNGs
matched served bytes in both environments.

All four focused live checks passed without browser route interception:

| Environment | Check | Result |
| --- | --- | --- |
| Main staging | Committed muted-restart regression | PASS: new session ID, enabled microphone, settled welcomes, second welcome audio, received user input, and bot audio. |
| Main staging | Fresh Omni session with mute/unmute | PASS: enabled track, received transcript, and bot audio. |
| Production | Committed muted-restart regression | PASS: new session ID, enabled microphone, settled welcomes, second welcome audio, received user input, and bot audio. |
| Production | Fresh Omni session with mute/unmute | PASS: toggles changed track state; user input and bot audio received. |

All replies were “Five.” Final restart checks had no console or WebSocket errors;
production Omni also had no failed requests or bad responses. An interrupted staging
Omni attempt was replaced by a passing standalone run. That run recorded an aborted
capture request after teardown, so capture lifecycle remains unqualified.

Chromium used prerecorded input and `--ignore-certificate-errors` after internal trust
failures. These checks do not qualify normal certificate trust, the user's Edge profile,
a physical microphone, or all permission paths. The full suite was not rerun; earlier
failures and open gates remain recorded above.

UI-only rollback exports are `/tmp/nva-astra-mic-rollout-20261008/stg-before.yaml` and
`/tmp/nva-astra-mic-rollout-20261008/prd-before.yaml`. Both retain tag
`dev-da8ee12-20261005-eventlog-tab`, timestamp `2026-10-05T12:14:33Z`, and existing
backend routing. These differ from the earlier pre-routing production backup. Temporary
exports remain outside Git; verify retained artifacts and routing before rollback.
No rollback was performed.
