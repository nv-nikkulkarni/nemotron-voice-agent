# NVCF Function Lifecycle

## Contents

1. [Conceptual Model](#conceptual-model)
2. [Create a Function Version](#create-a-function-version)
3. [Attach Secrets Safely](#attach-secrets-safely)
4. [Create a Deployment](#create-a-deployment)
5. [Wait and Inspect](#wait-and-inspect)
6. [Apply Helm Overrides](#apply-helm-overrides)
7. [Invoke the Function](#invoke-the-function)
8. [Restart, Undeploy, and Delete](#restart-undeploy-and-delete)
9. [Status and Version Limits](#status-and-version-limits)

## Conceptual Model

NVCF separates these objects:

```text
function identity
  └── immutable function version
        ├── chart/container/model/resource references
        ├── health and inference contract
        ├── version-scoped secrets
        └── one deployment
              ├── backend/region
              ├── GPU instance type
              ├── min/max instances
              └── max request concurrency
```

Creating a version does not deploy it. `ACTIVE` in a version listing does not by itself
prove a serving deployment. Always correlate function ID, version ID, and deployment ID.

Use a new function identity for an isolated product. Reuse an existing function ID only
when intentionally creating a new version of that same product.

## Create a Function Version

Verify the chart and image first. Confirm syntax with the installed CLI:

```bash
ngc cf fn create --help
```

For a brand-new Helm-backed function, omit the positional function ID:

```bash
ngc cf fn create \
  --name "<function-name>" \
  --helm-chart "<org>/<chart-repository>:<chart-version>" \
  --helm-chart-service "<service-name>" \
  --inference-url "<route>" \
  --inference-port <port> \
  --health-uri "<health-route>" \
  --health-port <health-port> \
  --health-protocol HTTP \
  --health-expected-status-code 200 \
  --health-timeout PT10S \
  --api-body-format CUSTOM \
  --function-type DEFAULT \
  <secret arguments>
```

For a new version of an existing function, place the exact function ID after `create`:

```bash
ngc cf fn create <function-id> \
  --name "<same-function-name>" \
  --helm-chart "<org>/<chart-repository>:<chart-version>" \
  --helm-chart-service "<service-name>" \
  --inference-url "<route>" \
  --inference-port <port> \
  --health-uri "<health-route>" \
  --health-port <health-port> \
  --health-protocol HTTP \
  --health-expected-status-code 200 \
  --health-timeout PT10S \
  --api-body-format CUSTOM \
  --function-type DEFAULT \
  <secret arguments>
```

Known route patterns:

| Function | Service | Inference route/port | Health route/port |
|---|---|---|---|
| main voice agent | `nemotron-voice-agent` | `/api/ws`, 7860 | `/health`, 7860 |
| Realtime Generic FBA | `nemotron-voice-agent` | `/v1/realtime`, 7860 | `/health`, 7860 |
| standalone Lightning | `nemotron-lightning` | `/v1/chat/completions`, 8000 | `/v1/health/ready`, 8000 |

Treat these as checked examples, not universal defaults. Verify the target chart Service and
container ports before creation.

The `PT10S` health timeout was required by this deployment flow. Omitting or malformed
health fields previously caused an NVCF 400 before scheduling.

## Attach Secrets Safely

Every version requires a complete secret set. Build arguments from approved in-memory
environment variables or a protected secret source. Do not paste literal values into
documentation, task output, or a retained shell history.

A shell can retain names while keeping literal values out of history:

```bash
secret_args=(
  --secret "NVIDIA_API_KEY:${NVIDIA_API_KEY:?missing}"
  --secret "NGC_API_KEY:${NGC_API_KEY:?missing}"
  --secret "PERPLEXITY_API_KEY:${PERPLEXITY_API_KEY:?missing}"
  --secret "WEATHERAPI_KEY:${WEATHERAPI_KEY:?missing}"
  --secret "FINNHUB_API_KEY:${FINNHUB_API_KEY:?missing}"
  --secret "SESSION_CAPTURE_NGC:${SESSION_CAPTURE_NGC:?missing}"
)
# Add "${secret_args[@]}" only to the protected ngc cf fn create invocation.
# Then:
unset secret_args
```

Command-line arguments can be visible to local process inspection while the command runs.
Use an approved secured operator host and avoid recording tools. If policy forbids this,
use the approved NVCF secret-management interface rather than weakening the policy.

`SESSION_CAPTURE_NGC` is a destination, not a credential. The Realtime function uses a
different minimal set. Refer to [Secrets and Access](secrets-and-access.md).

Never pass one nested `secrets` JSON value in place of individual entries. That historical
mistake allowed the function to start but left the application without expected variables.

## Create a Deployment

Inspect currently available backend and GPU choices instead of reusing a dated backend
name. Then create the deployment:

```bash
ngc cf fn deploy create <function-id>:<version-id> \
  --deployment-specification \
  "<backend>:H100:OCI.GPU.H100_8x:<min-instances>:<max-instances>:<max-request-concurrency>"
```

For one-GPU dedicated functions, use an available `OCI.GPU.H100_1x` specification. For
the complete voice-agent chart, the historical shape is H100 8x.

Choose deliberately:

- `min=1` avoids scale-to-zero cold start but reserves capacity.
- `min=0` saves capacity but the first request can experience a long cold start.
- `max` controls horizontal instances, not the number of app replicas inside the chart.
- maximum request concurrency must reflect the tested workload; it is not model batch size.

Do not request overlap that exceeds org quota. Do not undeploy the serving version to solve
quota without explicit downtime authorization.

## Wait and Inspect

Check both objects:

```bash
ngc cf fn info <function-id>:<version-id> --format_type json
ngc cf fn deploy info <function-id>:<version-id> --format_type json
ngc cf fn deploy list --format_type json
ngc cf fn instance list <function-id>:<version-id> --format_type json
```

Record:

- function/version/deployment IDs;
- chart or container reference;
- service, inference route, and health contract;
- backend, instance type, min/max, and concurrency;
- function/deployment state and last update time;
- instance, pod, and container readiness; and
- whether deep readiness and functional smoke ran.

If deployment state stalls, move to [NVCF Debugging](nvcf-debugging.md).

## Apply Helm Overrides

NVCF deployment creation and update can accept chart configuration:

```bash
ngc cf fn deploy create <function-id>:<version-id> \
  --configuration-file <values-override.yaml> \
  --deployment-specification "<spec>"

ngc cf fn deploy update <function-id>:<version-id> \
  --configuration-file <values-override.yaml> \
  --deployment-specification "<spec>"
```

You can also repeat `--set key=value`, but a reviewed values file is safer for nontrivial
topology. Render it locally before use.

Prefer a new immutable version for production behavior changes. An in-place deployment
update or restart can drop live WebSockets and leaves weaker artifact lineage.

## Invoke the Function

### HTTP

Use the per-function invocation host for buffered HTTP:

```text
https://<function-id>.invocation.api.nvcf.nvidia.com
```

Send:

```text
Authorization: Bearer <invocation-authorized-key>
function-id: <function-id>
```

Use the function-specific route, such as `/health`, `/api/deployment`, or
`/v1/chat/completions`.

### Streaming WebSocket

The browser-facing streaming route uses:

```text
wss://grpc.nvcf.nvidia.com/<function-route>
```

with the same authorization and `function-id` headers. Browsers cannot set those headers
directly, so the Astra nginx proxy injects them. The per-function HTTP invocation host can
strip the WebSocket Upgrade header and return HTTP 200 rather than 101.

### Dedicated Speech gRPC

ASR and TTS use TLS to:

```text
grpc.nvcf.nvidia.com:443
```

with gRPC metadata `authorization: Bearer ...` and `function-id: ...`.

## Restart, Undeploy, and Delete

A restart is disruptive:

```bash
ngc cf fn deploy restart <function-id>:<version-id>
```

Graceful undeploy is safer when authorized:

```bash
ngc cf fn deploy remove --graceful <function-id>:<version-id>
```

After deployment removal is verified, a version can be deleted only with explicit
authorization:

```bash
ngc cf fn remove <function-id>:<version-id>
```

Never reverse this order. Never delete a version merely because it is `INACTIVE`; it can
be the only retained rollback. Before and after every destructive command, re-query the
serving function and deployment and compare exact IDs.

## Status and Version Limits

NVCF can reject creation before mutation because of:

- org GPU quota;
- requested deployment overlap;
- per-function version ceiling;
- invalid chart/service/health contract;
- inaccessible image layers; or
- invalid secret payload structure.

A generic HTTP 400 does not identify which limit applied. Preserve the exact request ID and
control-plane message, inspect current versions/deployments/quota, and label any theory
unproven until evidence confirms it.

When a version ceiling blocks a new version, do not delete an active or rollback version
without authorization. Inventory all versions, identify disposable failed/inactive
candidates, and request an exact deletion decision.
