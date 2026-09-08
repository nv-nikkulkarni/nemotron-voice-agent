# NVCF / Astra staging qualification — 2026-08-18

## Decision

**Staging deployment completed; production promotion is not approved by this report.**

The exact staging artifacts are active and the five-replica shared-state topology is functional. Generic and Omni sessions connect concurrently without cross-talk, uploaded media crosses replicas, prompt overrides reach the backend, all three external tool credentials work, and consented captures reach NGC. Production remains gated on user acceptance of the known Lightning tool-selection behavior and the open webcam/capture-state findings below.

## Exact artifacts and topology

| Component | Staging artifact |
|---|---|
| NVCF function | `d67e6989-0cb4-4f91-89d3-b86992e84a1a` |
| Active function version | `809a77a0-c1f8-4f63-b3ea-244f534acc69` |
| Helm chart | `nemotron-voice-agent` `0.1.90` |
| Backend | `nvcr.io/0491162300748285/nemotron-voice-agent:2.0.23` |
| Backend digest | `sha256:0228f00696f9f044388168566942e14b8157c74d7d1990f53f31b00f5f7a2c5e` |
| Astra preview UI | `artifactory.nvidia.com/it-astra-docker-local/nemotron-voice-agent/nemotron-voice-agent-ui:ddc90e1` |
| UI digest | `sha256:34a4578b0371a23657e7b1ca53879f6c054cd377fe51ee58f75587b95142119b` |
| Preview URL | `https://nemotron-voice-agent-preview-deploy-backend.stg.astra.nvidia.com` |

The active NVCF instance contains five application pods plus Redis, SeaweedFS, Lightning, Omni, ASR, TTS, and prewarmer services. The router is disabled. NVCF reports the function version `ACTIVE`; `/api/deployment` exposes Generic Assistant and Nemotron Omni Assistant Subagents through the preview deployment.

Chart `0.1.90` adds hard application startup gates for Redis and the S3-compatible SeaweedFS endpoint. This prevents a pod scheduled before shared services from permanently falling back to process-local state after the application's bounded internal retry.

## Secret injection

Each staging function version received these NVCF secret names through the function-version secret interface:

- `NGC_API_KEY`
- `NVIDIA_API_KEY`
- `PERPLEXITY_API_KEY`
- `WEATHERAPI_KEY`
- `FINNHUB_API_KEY`
- `SESSION_CAPTURE_NGC`

No secret values are recorded in this report or chart values. Live WeatherAPI, Finnhub, Perplexity, NGC upload, ASR, and TTS behavior proves the relevant credentials are available to application replicas.

## Qualification results

### Automatic Lightning tool concurrency matrix

Five batches of six simultaneous browser/audio sessions were launched for each live provider with reasoning enabled and `tool_choice=auto`.

| Expected tool | Batch results | Raw result | Valid attempts | Finding |
|---|---|---:|---:|---|
| `get_weather` | 6/6, 6/6, 6/6, 6/6, 4/6 | 28/30 | 28/29 | One Lightning miss emitted `example_function_name`; one browser was discarded after `ERR_CONTENT_LENGTH_MISMATCH` prevented the UI card from loading. |
| `get_stock_price` | 6/6, 6/6, 5/6, 6/6, 6/6 | 29/30 | 29/30 | One session transcribed the complete query but produced no tool event or answer in the window. |
| `web_search` | 6/6 in all five batches | 30/30 | 30/30 | All Perplexity-backed searches selected the expected tool and returned matching live content. |
| **Overall** | | **87/90** | **87/89** | Two genuine automatic Lightning misses; one unrelated browser-load discard. |

Every successful batch reached all-six overlap except the batch containing the browser-load discard, which reached five. No router or forced-tool workaround was added, per direction.

A separate 15-turn continuous Generic/Lightning session remained responsive for all 15 turns but selected **0/6 expected tools**. It answered BMI/random locally, claimed live weather was unavailable, and invented an NVIDIA stock value. This is a model/tool-adherence failure, not missing credentials: fresh-session concurrency and earlier forced controls called every live provider successfully.

### Full UI, media, and concurrency suite

| Phase | Result | Evidence |
|---|---|---|
| A — Generic 15-turn availability | PASS with tool-quality finding | 15/15 spoken responses; no silence. Tool table recorded 0/6 expected calls as described above. |
| B — Omni voice + media | PASS with webcam warning | 13/13 voice turns responded. Attachment upload returned HTTP 200 and Omni accurately described the red square on a blue background. Six synthetic webcam frames stored with HTTP 200, but Omni answered that the camera was off. |
| C — UI features | PASS with model-adherence warning | Generic→Omni switching, unique session IDs, settings, restart, pipeline overlay, capture status, and no-hang checks passed. Playwright intercepted the outgoing config and proved the edited prompt body contained the marker under `generic-assistant_edited`; Lightning did not echo the marker. |
| D — mixed concurrency | PASS | 8/8 simultaneous streams connected and responded; eight unique session IDs; zero cross-talk, hangs, HTTP/browser errors, or socket errors. |

After the startup-gate fix, five additional fresh Omni attachment sessions passed 5/5 and correctly described the known `BANANA 42` test image. This directly demonstrates that uploaded media is shared across independently routed application replicas.

### Session capture

`/api/session-capture/status` reports capture enabled, consent required, S3 storage, NGC CLI present, and an NGC key present. Read-only NGC inspection found fresh `UPLOAD_COMPLETE` versions in `0491162300748285/session-captures` matching the just-completed concurrency session IDs, including:

- `8ed61293c61f`
- `3a6174907853`
- `13276b22abcf`
- `a31dc8aecae5`

This proves UI consent → NVCF capture → SeaweedFS → NGC upload end to end. Five Redis coordination states remained in `pending_sessions` for more than three minutes even though new NGC uploads completed. The configured reaper interval is 300 seconds and orphan threshold is 900 seconds; the residual count must be observed through a reaper cycle or reviewed as a timeout/orphan edge case before production.

## Known findings and production gates

1. **Lightning automatic tool selection is nondeterministic.** Two of 89 valid fresh-session attempts missed, and the long continuous session bypassed all six expected calls. Do not add a router; accept or resolve the model behavior explicitly.
2. **Synthetic webcam interpretation is not working.** Frame storage succeeds, but the Omni live-view path reports the camera as off. Attachment media is working.
3. **Five capture coordination states remained pending.** Actual NGC uploads are proven, so this is finalization-state cleanup/retry behavior rather than total capture failure.
4. **Astra occasionally served a truncated static asset.** One browser failed before creating a session with `ERR_CONTENT_LENGTH_MISMATCH`; this was isolated from backend/model results.

## Rollback and environment boundary

- Previous stable staging version retained inactive: `f2c9032d-cc81-4194-a76e-124d90f9052e` (chart `0.1.87`).
- Superseded first rollout retained inactive: `5c1a9db1-601e-47d4-b4e6-4401b73b9e9f` (chart `0.1.89`).
- Current corrected staging version: `809a77a0-c1f8-4f63-b3ea-244f534acc69` (chart `0.1.90`).
- Production Astra and production NVCF were not modified.
