# Qualify the Generic Frontend/Backend Realtime Evaluation Chart

Use `values-generic-fba-realtime-eval.yaml` to create a new, isolated NVIDIA
Cloud Functions (NVCF) evaluation function. The overlay exposes the Generic
Frontend/Backend Agent through the OpenAI Realtime-compatible transport. It
does not change the production topology in `values.yaml`.

The last deployed startup candidate used the following immutable artifacts:

| Artifact | Candidate | Source |
| --- | --- | --- |
| Application image | `nvcr.io/0491162300748285/nemotron-realtime-generic-fba:2.0.69` | Agent commit `8cbc0e27555b190ff65f5cbb4d5d8356e809464f` |
| Helm chart | `0491162300748285/nemotron-realtime-generic-fba:0.1.143` | This chart and the evaluation overlay |

The earlier Realtime artifacts were mistakenly published under the production
`nemotron-voice-agent` repositories: image `2.0.69` and charts `0.1.141`
and `0.1.142`. They are preserved pending explicit deletion authorization and
must not be selected by this function. Chart `0.1.142` was never deployed.
The dedicated image is an exact immutable copy of `2.0.69`; chart `0.1.143`
changes the chart identity and rendered app image name so future publication
and deployment stay inside the dedicated repositories.

Chart `0.1.143` reached NVCF `ACTIVE`, and all six workloads started. Nemotron
3 Super NIM `2.0.5` passed its health and prewarm checks. This proves the
bounded Super startup remediation, but it does not qualify the Realtime
endpoint.

The first direct secure WebSocket (WSS) smoke stopped at the outer NVCF
authorization boundary with HTTP 403. NVCF occupies `Authorization` for the
outer function invocation and can forward that Bearer credential to the
application. A browser independently sends its application `ek_` client secret
through the WebSocket subprotocol, which creates a dual-credential handshake.

The remediation application image is
`nvcr.io/0491162300748285/nemotron-realtime-generic-fba:2.0.70`, built from
commit `a1f2cae398b4f73d93af329c871bcff891b15ced`. The published OCI index digest
is `sha256:9e2ed135e438309d7fd515660111330c3b39ccdce23b56da38f096030e4d097d`;
the AMD64 image digest is
`sha256:bb503808a5349023e3d6ec732d07fc8e59eff0c19c858141bf8cfa3246943d35`.

The chart source is `0.1.144` with app version `2.0.70`. Only the isolated
evaluation overlay enables `REALTIME_ALLOW_PROXY_BEARER=true`. The dedicated
chart reached NGC `UPLOAD_COMPLETE` on September 22 at 7:25:16 a.m. UTC with
SHA-256 checksum
`48975339beff3daacb8586b245f0df1325d647a5c010feb6898cc2a86ef65fb7`.
An NGC pull round trip produced the same checksum.

NVCF version `58f548ad-510b-4e81-a75d-acf3b981763b` was created `INACTIVE` on
September 22 at 7:26:32 a.m. UTC with chart `0.1.144`, app `2.0.70`, and only
the `NGC_API_KEY` and `REALTIME_API_KEY` function-version secrets. The deploy
request was rejected before mutation with `EXCEED_QUOTA_LIMITS`: it requested
8 GPUs while NVCF reported current maximum usage 28 and a limit of 32.

The `0.1.144` version is not deployed, healthy, or qualified. The existing
`0.1.143` isolated deployment remains `ACTIVE`, and the main production
function is untouched. Do not undeploy isolated deployment
`d2e79864-301a-476c-85c1-7285d1612efa` without explicit authorization.

Do not overwrite any published or planned artifact tag. Build a new patch
version when source or chart content changes. Do not delete the preserved
production-repository artifacts without explicit authorization.

## Review the Evaluation Topology

The overlay renders these runtime workloads:

| Workload | Purpose | Replicas | GPU Request |
| --- | --- | ---: | ---: |
| Voice agent application | Realtime gateway and Generic Frontend/Backend pipeline | 1 | 0 |
| Nemotron ASR Streaming | Streaming English speech recognition | 1 | 1 |
| Magpie TTS Multilingual | Speech synthesis | 1 | 1 |
| Nemotron 3.5 Lightning | Frontend Talker | 1 | 1 |
| Nemotron 3 Super | Backend Thinker | 1 | 2 |
| Prewarmer | NIM warmup and keepalive | 1 | 0 |

The overlay explicitly excludes Redis, SeaweedFS and `sessionStore`, session
capture, Nemotron Omni, Chatterbox TTS, Nemotron Nano, Parakeet ASR, booking,
TURN, tracing, and multiple application replicas. Realtime connection state is
process-local for this evaluation endpoint.

## Review Model Capacity

The overlay trades sequence concurrency for context capacity:

| Component | Context | Maximum Sequences | KV Cache | Generation |
| --- | ---: | ---: | ---: | --- |
| Nemotron 3.5 Lightning Talker | 32,768 tokens | 16 | 0.75 | 512 tokens, reasoning disabled |
| Nemotron 3 Super Thinker | 32,768 tokens | 16 | 0.85 | 2,048 tokens, 1,024-token reasoning budget |

Lightning keeps vanilla NVIDIA NIM profile selection. The overlay enables
`llmLightning.runtimeTuning` to apply only the context, KV cache, and sequence
settings. It does not restore the rejected `NIM_TAGS_SELECTOR` setting.

The 32,768-token context is a blocking requirement. The Talker prompt is about
6,900 tokens before a client adds session instructions. The Thinker also
receives the client tool schemas. An 8,192-token context cannot reliably hold
the complete evaluation payload.

## Review Deadline Budgets

The evaluation harness permits 90 seconds for one response. A delegated turn
can use both Talker attempts and the backend deadline:

```text
(15-second Talker deadline x 2 attempts) + 45-second backend deadline
= 75 seconds
```

The resulting 75-second ceiling leaves 15 seconds for transport and client
overhead. The overlay sets these values:

| Setting | Value |
| --- | ---: |
| `GENERIC_TALKER_STREAM_TIMEOUT_SECONDS` | 15 seconds |
| `GENERIC_BACKEND_TIMEOUT_SECONDS` | 45 seconds |
| `GENERIC_PLANNER_TIMEOUT_SECONDS` | 15 seconds |
| `GENERIC_PLANNER_MAX_ATTEMPTS` | 2 |
| `GENERIC_PLANNER_RETRY_BACKOFF_SECONDS` | 0.5 seconds |
| `GENERIC_CLIENT_TOOL_TIMEOUT_SECONDS` | 25 seconds |
| `GENERIC_WEB_SEARCH_TIMEOUT_SECONDS` | 20 seconds |

Do not raise an individual deadline without recalculating the complete turn
budget. A response that exceeds the harness window can remain in progress and
cause later turns to fail with `response_in_progress`.

## Configure Credentials

Supply credential values only as NVCF function-version secrets. Do not put
values in Git, Helm values, rendered manifests, commands, logs, or reports.

The chart uses these secret names:

| Secret | Consumer | Requirement |
| --- | --- | --- |
| `REALTIME_API_KEY` | Realtime gateway | Required. The application fails startup when it is absent. |
| `NGC_API_KEY` | ASR, TTS, and LLM NIM startup | Preferred credential for model downloads. |
| `NVIDIA_API_KEY` | Application and NIM compatibility fallback | Required when the application or a deployment path uses NVIDIA hosted services. NIM startup uses it only when `NGC_API_KEY` is absent. |
| `PERPLEXITY_API_KEY` | Built-in web search | Required only when the deployed evaluation uses the built-in web search tool. |
| `WEATHERAPI_KEY` | Built-in weather tool | Required only when the deployed evaluation uses the built-in weather tool. |
| `FINNHUB_API_KEY` | Built-in stock tool | Required only when the deployed evaluation uses the built-in stock tool. |

`REALTIME_API_KEY` protects the application Realtime gateway. It is distinct
from the credential that a caller uses to invoke the outer NVCF function. Give
the evaluation client the same Realtime key through its secure environment.

The overlay uses in-cluster ASR and Magpie TTS. It does not require a separate
`NVIDIA_SPEECH_API_KEY`; the shared speech client falls back to
`NVIDIA_API_KEY` when a hosted speech endpoint needs a credential.

## Render and Inspect the Chart

Run these commands from the repository root:

```bash
helm lint nvcf_helm -f nvcf_helm/values-generic-fba-realtime-eval.yaml
helm template generic-fba-realtime nvcf_helm \
  -f nvcf_helm/values-generic-fba-realtime-eval.yaml \
  > /tmp/generic-fba-realtime-rendered.yaml
```

Inspect the rendered output before packaging. Confirm all of the following:

- The application uses `EXAMPLE_SELECTION=generic-frontend-backend-agent` and
  a valid `TRANSPORT_SELECTION=websocket` registry selector. The OpenAI
  Realtime adapter is the independent `/v1/realtime` server route; `realtime`
  is not an `examples_registry` transport value.
- The application replica count is one.
- The rendered workloads are the application, ASR, Magpie TTS, Lightning,
  Super, and the prewarmer.
- The chart does not render Redis, SeaweedFS, session capture storage, Omni,
  Chatterbox, Nano, Parakeet, booking, TURN, or tracing workloads.
- Both LLM NIMs use a 32,768-token context and a 16-sequence limit. Lightning
  uses a 0.75 KV cache fraction; Super uses 0.85.
- Lightning has no `NIM_TAGS_SELECTOR` environment variable.
- The application receives every deadline and generation override from the
  previous sections.
- The rendered manifest contains the `REALTIME_API_KEY` secret name or startup
  requirement, but no credential value.

Run the chart contract tests after rendering:

```bash
uv run pytest tests/unit/test_helm_generic_fba_realtime_eval.py -q
```

## Treat Startup as a Blocking Gate

Chart `0.1.141` was rejected after Nemotron 3 Super crash-looped during engine
startup at a 0.75 KV cache fraction, 32,768-token context, and 16-sequence
limit. NVIDIA NIM defines the fraction as the total GPU-memory budget from
which model weights are subtracted before allocating KV cache, so raising the
fraction increases the space left for KV cache after weights. Chart `0.1.143`
kept the required 32,768-token context and low sequence count, and raised only
Super's memory budget to the Viking-proven 0.85 value. All six workloads later
started, and Super NIM `2.0.5` passed health and prewarm checks.

A successful Helm render does not prove that either model fits the target H100
node. Require all of the following before a scored run:

1. Lightning and Super remain ready through model loading and CUDA graph
   capture.
2. Their `/v1/health/ready` endpoints return success.
3. NIM startup logs confirm a 32,768-token served context and 16-sequence limit
   for both models, with Lightning at 0.75 and Super at 0.85.
4. The OpenAI Realtime compatibility suite passes against the deployed
   endpoint.
5. The 20-task airline treatment completes before the 40-task retail treatment
   starts.

Do not promote this overlay based only on NVCF function status. The function
remains an unqualified evaluation candidate until the NIM and application
gates pass.

## Run the Realtime Smoke Test

Use the evaluation repository's `scripts/tau_realtime_smoke.py` driver against
the deployed WebSocket endpoint. It loads the pinned airline policy, all 14
client-owned tools, and the evaluation database.

Require these results:

1. `session.updated` succeeds with `tools=14 policy_chars=7676`.
2. Server logs show 14 registered Realtime client-owned tools.
3. Server logs show only `call_backend` and `cancel_backend` as Talker tools.
4. The smoke summary contains no errors or timeouts.
5. The smoke summary reports at least one client-owned tool call.
6. The request to cancel reservation `EHGLP3` delegates through `call_backend`
   rather than invoking `cancel_backend`.
7. The final answer is grounded in the returned tool result and is not a filler
   response.

Stop before a scored evaluation when any smoke requirement fails. A run without
client-owned tool execution measures an infrastructure failure instead of
agent quality.

## Record Deployment Evidence

After the function is deployed and qualified, record the following without
credential values:

- Function name, function ID, version ID, and NVCF status.
- Application image digest and source commit.
- Chart package checksum and published chart version.
- NIM image tags and the served context settings reported at startup.
- Render, chart-test, startup, compatibility, and smoke-test results.
- Rollback function version or the reason that no rollback version applies to
  this isolated function.

Do not add live identifiers or deployment status to this guide before they are
verified from NVCF.
