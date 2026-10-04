# LLM Settings Dev Qualification

**Date:** October 04, 2026 (UTC)

**Scope:** Local UI and the `nva-dev` Kubernetes release. Targeted model-control
qualification and final serving verification passed at `http://localhost:7880`.
No NVCF function, Astra deployment, or production promotion changed.

## Artifact Identity

The qualified artifacts have separate source identities:

| Artifact | Identity |
| --- | --- |
| Backend source | `9b11f4d7a8064724f6b69f587d357ef490352404` |
| UI source | `6de1f2f263439262771f41000f734e8e67c696a4` |
| Backend image | `nvcr.io/0491162300748285/nemotron-voice-agent:dev-9b11f4d-20261004-llm-settings` |
| Backend OCI index | `sha256:712c0d957d58c5a0888062902ae15b90dc69edfe116ffa7ed83d48d0f8277366` |
| Backend AMD64 manifest | `sha256:cac97374ea7d3d07f215240146202def46d066d111758f70e080278d73902a5b` |
| Local UI image | `nemotron-voice-agent-ui:dev-6de1f2f-20261004-llm-settings` |
| UI OCI index | `sha256:463e0660622e0f2c0a72833e8b36e38e319ec8fd82380d398e24a527300469f5` |
| UI AMD64 manifest | `sha256:e0f52eb6ecfd935db3f9b4195317aace45b17f9d919b5e0806f3086fb75a0b22` |
| UI build timestamp | `2026-10-04T13:56:52Z` |
| Helm release | `nva-dev`, namespace `nva-dev`, revision `23` |
| Chart | `0.1.141-dev.20261004.22` |
| Chart SHA-256 | `0f92cbcac894422d3e660b152ef1f2d02da291a15302527f48a4e7802faf13dc` |
| Backend rollback | Helm revision `22` |
| Immediate UI rollback | Container `nemotron-voice-agent-ui-dev-rollback-7198d5c` |
| Stable UI rollback | Source `8cda3a4`; container `nemotron-voice-agent-ui-dev-rollback-8cda3a4` |

The UI follow-ups change dialog centering, narrow-screen header layout, test
synchronization, and SQA documentation. Backend runtime files are unchanged from `9b11f4d`. The backend
image is published to NGC for dev pulls. This chart package is local; chart
publication and platform promotion are outside this change.

## Targeted Results

The final UI candidate at port `7883` passed all 10 checks in
`tests/sqa/llm-settings.mjs`. The dialog fits and centers at widths of 1,440,
1,024, 768, 390, and 320 pixels. Validation, explicit saving, reload persistence,
draft cancellation, four Omni roles, and the top-k override pass. Live LLM,
Info, audio-device, and End controls fit within the 390- and 320-pixel viewports
for both examples.

Both real spoken sessions passed the following checks:

| Example | Session | Spoken Input and Result |
| --- | --- | --- |
| Generic Frontend/Backend | `eeaa39d8bd46` | Intended Tokyo time request reaches ASR, invokes native `get_current_time`, and produces an audible reply. |
| Omni Subagents | `e6eaa75e1ae1` | Intended one-sentence greeting request reaches the model and produces audible “Hello!” |

Live apply advances the revision and changes actual request values. Generic
uses frontend temperature `0.15`, plus backend temperature `0.1`, top-p `0.85`,
and `max_tokens: 1800`. Omni Speaker uses temperature `0.15`, top-p `0.9`, and
top-k `-1`. **Reset all** is acknowledged in both sessions. After **End**, each
settings endpoint returns HTTP `404`.

Independent bot speech recognition succeeds. Recorded bot audio peaks at
`-7.1 dB` for Generic and `-8.5 dB` for Omni. The suite reports no hard failures
or browser errors. One intentionally aborted defaults GET is recorded
separately; failed session operations remain failures.

## Source and Cluster Validation

The source checks produce the following results:

- All 34 settings tests pass; the focused settings/Speaker group has 84 passing tests.
- Existing agent/session-bus coverage has 201 passing tests and 28 passing subtests.
- Full pytest has 795 passing tests, 3 skips, and 55 passing subtests. Three existing
  failures remain: a stale literal Helm artifact pin and 2 user-dirty skill-frontmatter checks.
- All 14 changed Python files pass Ruff checks and formatting.
- Astra production build and scoped lint pass. Full Astra lint retains 24 errors
  and 2 warnings, with no new findings against `8cda3a4`.
- Pre-commit passes for the task files. Source, app, and UI secret scans pass.
  The UI scan excludes one exact public nginx checksum fingerprint in its temporary
  scan after confirming the base instruction matches the previous artifact.
- Helm lint, rendering, and server dry-run pass before revision `23` deploys.

The cluster snapshot at `2026-10-04T14:01:20.268985+00:00` shows all 15 pods Ready
with zero restarts or image-pull errors. All 9 supporting workload pod UIDs are
preserved, including every inference service, Redis, and SeaweedFS.

## Final Serving Verification

At `2026-10-04T14:01:20.268985+00:00`, `http://localhost:7880` serves the
exact qualified UI image above. Its JavaScript, CSS, and runtime configuration
bytes match the passing candidate. `/health` returns `ok`; the role API exposes
2 Generic and 4 Omni roles. Helm remains at revision `23`.

Capture reports `upload_ready=true`, `require_consent=true`, zero pending
sessions, zero pending failed sessions, and no pending error types. Temporary
candidates are removed after verification. The immediate and stable UI rollback
containers, and backend Helm revision `22`, remain available.

## Qualification Boundary

This run qualifies the controls and two spoken paths above. Mocked request tests
cover all four Omni role paths, native backend streaming, audio corrections,
revision conflicts, Redis compare-and-set, local expiry, and in-flight snapshots.
It does not run every Omni media/webcam path, full release SQA, stress/concurrency,
barge-in, all external tools, or NGC capture archive readback. These results do
not qualify NVCF, Astra, or production.

Raw local evidence remains under `/tmp/nva-llm-settings`, including
`sqa-llm-settings/llm-settings-report.json`, `sampling-live-evidence.json`,
`validation.json`, `cluster-health.json`, `final-state.json`, `build.json`, and
`app-build.json`.
