# NVCF Debugging

## Contents

1. [Debugging Order](#debugging-order)
2. [Deployment-Level Logs](#deployment-level-logs)
3. [Instance and Container Logs](#instance-and-container-logs)
4. [Safe Diagnostic Execution](#safe-diagnostic-execution)
5. [Startup Failure Classes](#startup-failure-classes)
6. [Runtime and Routing Failures](#runtime-and-routing-failures)
7. [Model-Specific Failures](#model-specific-failures)
8. [Evidence Collection](#evidence-collection)

## Debugging Order

Use this sequence:

1. verify the exact chart/image exists;
2. inspect function-version metadata;
3. inspect deployment specification and state;
4. list live instances;
5. inspect pod/container names and statuses;
6. read the failing init or application/model container logs;
7. verify health locally inside the instance only when needed and authorized;
8. verify external HTTP and WebSocket routing;
9. send one minimal functional request; and
10. run load or SQA only after the minimal path works.

Do not rebuild before locating the failed boundary.

## Deployment-Level Logs

The installed NGC CLI supports time-bounded deployment logs:

```bash
ngc cf fn deploy log <function-id>:<version-id> \
  --duration 30M

ngc cf fn deploy log <function-id>:<version-id> \
  --start-time 'YYYY-MM-DD::HH:mm:ss' \
  --end-time 'YYYY-MM-DD::HH:mm:ss'
```

Use UTC unless the CLI documents another convention. Preserve request IDs and timestamps.
Deployment logs are useful for scheduling, image pull, Helm, readiness, and control-plane
errors, but can be insufficient for one container.

## Instance and Container Logs

List instances first:

```bash
ngc cf fn instance list \
  <function-id>:<version-id> \
  --format_type json
```

Extract the instance ID, pod names, and container names. Then query a specific container:

```bash
ngc cf fn instance logs \
  <function-id>:<version-id> \
  --instance-id <instance-id> \
  --pod-name <pod-name> \
  --container-name <container-name>
```

Without pod/container selectors, the command can return only aggregate/default output.
Inspect every failed init container and every model/app container relevant to the request.

Historically, NVCF instance logs/exec required a personal invocation-authorized NVIDIA key;
an organization registry key was rejected. Authentication behavior can change. Verify the
current CLI and authorization policy rather than swapping keys blindly.

Do not retain raw logs that contain prompts, user transcripts, session data, internal URLs,
or credential material. Redact before adding evidence to Git.

## Safe Diagnostic Execution

The CLI can execute a command in a target container:

```bash
ngc cf fn instance execute \
  <function-id>:<version-id> \
  --instance-id <instance-id> \
  --pod-name <pod-name> \
  --container-name <container-name> \
  --command '<read-only-command>' \
  --timeout <seconds>
```

Use this only when logs and health metadata are insufficient. Keep commands read-only and
targeted. Safe examples include process lists, listening ports, file existence, and local
health requests.

Never execute:

- `cat /var/secrets/secrets.json`;
- environment dumps that expose credentials;
- recursive filesystem output;
- mutation of model caches or workloads; or
- restarts/deletions that bypass the control plane.

## Startup Failure Classes

| Symptom | Likely cause | Checks |
|---|---|---|
| version creation fails immediately | invalid request, chart/service mismatch, version ceiling | CLI response/request ID, chart metadata, version list |
| deployment returns quota error | org GPU quota or overlap | live deployment list, requested shape, retained versions |
| pod stays Pending | H100/backend capacity or scheduling constraint | deployment backend, events/logs, capacity |
| image pull fails | tag absent, registry permission, gated layer, bad cross-repository copy | NGC image info, digest, pull authorization |
| init waits forever | dependency health, wrong Service, wrong port, NIM cold start | rendered Services, init logs, model logs |
| `CreateContainerConfigError` | absent Secret/key reference | rendered env refs and Secret key names |
| app/model crash-loops | invalid selector, parser flag, context/KV setting, missing key | exact container logs and rendered env |
| readiness passes too early | shallow probe or `nimReadyImmediate` | deep model endpoint and prewarmer evidence |
| deployment times out after cold pull | model weights exceed progress window | later cached retry only after exact evidence |
| persistent volume blocks scheduling | zone-locked RWO volume | PVC/PV topology; use supported `emptyDir` design |

A cold-pull retry can succeed because weights are cached. Do not call every timeout a quota
problem or delete the serving version preemptively.

## Runtime and Routing Failures

| Symptom | Likely boundary | Required action |
|---|---|---|
| per-function HTTP works, WebSocket returns 200 | HTTP host used for WebSocket | route WebSocket through `grpc.nvcf.nvidia.com` |
| WebSocket 401/403 | missing/incorrect invocation authorization or function ID | verify proxy headers and caller access |
| WebSocket 404/1006 after redeploy | stale `nvcf-request-id` cookie | strip browser Cookie and upstream Set-Cookie |
| Astra UI loads, APIs fail | Vault/proxy target mismatch | compare Vault references, effective function ID, nginx |
| `/health` returns HTML | SPA fallback/reverse proxy route | verify content type/body and backend health directly |
| `/api/deployment` exposes old models | UI/function or Helm registry drift | compare UI tag, Vault target, rendered ConfigMap |
| some tools fail intermittently | keys missing on part of replicated app | inspect every replica/version secret name |
| capture status fails | missing destination/key/CLI/store | inspect name-only configuration and capture readiness |
| long first request | scale-to-zero or model/prewarmer cold start | instance scale, model readiness, warmup logs |
| function `ACTIVE`, request fails | control plane ready, workload not deeply ready | instance/pod logs and real smoke |

The nginx proxy intentionally sends buffered HTTP to the per-function invocation host and
WebSocket traffic to the streaming gateway. It injects server-side auth and strips cookies
in both directions.

## Model-Specific Failures

### Lightning

Check:

- chart selects the intended image and profile;
- tool/reasoning parser flags match the model;
- GPU visibility is not hardcoded against NVCF assignment;
- NIM KV cache and maximum model length fit one H100;
- prewarm model ID equals the served alias; and
- `/v1/health/ready` and one chat/tool request pass.

A standalone Lightning function can be `ACTIVE` while chat/tool qualification remains
pending. Report the distinction.

### Super

Super uses two GPUs in the full stack. Context length, maximum sequences, and KV cache
percentage can make it crash-loop even when the image and license are correct. Start from
a verified bounded profile and change one parameter at a time.

### Magpie

The profile selector is `NIM_TAGS_SELECTOR`. Batch size is a model profile, not NVCF
request concurrency. For Magpie Multilingual 1.10.0:

| batch size | GPU memory | Host memory |
|---:|---:|---:|
| 8 | 12.58 GiB | 5.182 GiB |
| 32 | 41.46 GiB | 5.208 GiB |
| 64 | 74.74 GiB | 5.258 GiB |

The dedicated function uses one 79 GiB H100. Batch 64 is supported but leaves little GPU
headroom and provides little value while deployment concurrency remains 8. Create a new
canary version and test startup, first-audio latency, throughput, and OOM behavior instead
of modifying the serving version.

### Chatterbox

Chatterbox uses more memory than Magpie at batch 8. Keep it on a dedicated GPU. Do not send
the Magpie pronunciation dictionary; Chatterbox has no matching dictionary contract in
this application.

### Omni

A pod can be Ready while the served model alias disagrees with app catalog or prewarmer.
Verify one alias across vLLM arguments, service catalog, app request, and prewarm. Prewarm
guided JSON to avoid first-user grammar compilation.

## Evidence Collection

For each failure, retain:

```text
observation timestamp/time zone
source/chart/image identities
function/version/deployment/instance/pod/container IDs
control-plane error and request ID
first failing log line plus bounded context
health/deep-readiness results
minimal functional request outcome
whether serving production changed
rollback state
```

Do not commit full raw logs. Commit a concise redacted RCA and exact reproduction/validation
commands. Keep user/session evidence in approved evidence storage.
