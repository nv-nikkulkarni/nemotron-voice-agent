# Secrets and Access

## Contents

1. [Rules](#rules)
2. [Credential Inventory](#credential-inventory)
3. [NGC Registry and NVCF Control Plane](#ngc-registry-and-nvcf-control-plane)
4. [NVCF Version Secrets](#nvcf-version-secrets)
5. [Astra Vault](#astra-vault)
6. [Dedicated and Realtime Functions](#dedicated-and-realtime-functions)
7. [Viking](#viking)
8. [SQA](#sqa)
9. [Scanning and Rotation](#scanning-and-rotation)
10. [Authentication Failures](#authentication-failures)

## Rules

- Never paste a key from chat history into a command, file, report, image, chart, or reply.
- Treat every credential pasted into chat as exposed. Rotate it and update approved stores.
- Record names, references, scopes, and injection boundaries only.
- Never print Kubernetes Secret values, `/var/secrets/secrets.json`, process environments,
  Vault values, or CI variables.
- Keep invocation, registry, provider, SQA, Artifactory, Fusion, and Kubernetes
  authentication separate.
- Supply all NVCF version secrets again for every new version.
- Scan every rewritten commit after squash/rebase and all generated artifacts.

## Credential Inventory

| Name | Purpose | Secret? | Scope |
|---|---|---:|---|
| `NVIDIA_API_KEY` | NVIDIA inference or NVCF invocation | yes | app, Astra proxy, clients |
| `NGC_API_KEY` | NGC images/charts/resources and model pulls | yes | builds, NIMs, capture |
| `PERPLEXITY_API_KEY` | Generic web search | yes | every app replica |
| `WEATHERAPI_KEY` | weather tool | yes | every app replica |
| `FINNHUB_API_KEY` | stock tool | yes | every app replica |
| `SESSION_CAPTURE_NGC` | capture destination `org/resource` | no | capture finalizer |
| `REALTIME_API_KEY` | inner Realtime API authentication | yes | Realtime gateway |
| `SQA_KEY` | hosted query TTS/independent ASR oracle | yes | SQA harness only |
| `NVCF_HOST` | Astra upstream HTTP host | normally no | Astra runtime |
| `NVCF_FUNCTION_ID` | NVCF route selector | identifier | Astra runtime |
| `FEEDBACK_FORM_URL` | server-side feedback target | sensitive config | Astra nginx only |

Do not include a credential value in an endpoint handoff. Provide the endpoint, function ID,
required metadata names, and instructions for obtaining an authorized key.

## NGC Registry and NVCF Control Plane

An NGC API key can authorize registry and NVCF management. An NVIDIA invocation key can
authorize runtime inference. They are not interchangeable.

Historical symptoms:

- NGC chart/resource 403: key lacks registry scope or org access.
- resource 404 during chart upload: wrong artifact API or absent resource.
- instance logs/exec rejected: registry key lacks personal runtime authorization.
- runtime 401/403: invocation key lacks access to the function.

Verify current scope through approved identity tooling. Do not test by cycling through keys
pasted from unrelated contexts.

Authenticate Docker interactively:

```bash
docker login nvcr.io --username '$oauthtoken'
```

Do not pass a password on the command line.

## NVCF Version Secrets

The main function expects separate entries:

1. `NVIDIA_API_KEY`
2. `NGC_API_KEY`
3. `PERPLEXITY_API_KEY`
4. `WEATHERAPI_KEY`
5. `FINNHUB_API_KEY`
6. `SESSION_CAPTURE_NGC`

The chart reads `/var/secrets/secrets.json` and exports selected names in the container.
The destination is non-secret but is carried through the same version interface.

Never provide a single secret named `secrets` containing a nested JSON map. A production
candidate failed because expected top-level names were absent.

The CLI can update version secrets:

```bash
ngc cf fn update-secret <function-id>:<version-id> <secret arguments>
```

Updating a serving version's secrets is a production mutation. Require authorization,
record the exact target, and restart only if the application does not reload them.
Prefer creating and qualifying a new version for release changes.

## Astra Vault

Astra Vault supplies:

- `NVCF_HOST`;
- `NVCF_FUNCTION_ID`;
- `NVIDIA_API_KEY`; and
- optional server-side targets such as `FEEDBACK_FORM_URL`.

The browser must not see these values. Verify `config.js` contains only non-secret demo
configuration.

Use Fusion-managed Vault paths and ExternalSecret references. Verify name agreement among:

- Fusion deployment repository;
- app name and ingress;
- SecretStore;
- JWT auth path and role;
- ServiceAccount; and
- shared-secret key path.

Use `patch` to merge. `put` replaces all values. Native staging-to-production replication
can copy and transform Vault material server-side without exposing it.

## Dedicated and Realtime Functions

Dedicated ASR/Magpie/Chatterbox wrappers require `NGC_API_KEY` inside the function so the
NIM can access protected assets. Clients need a separate invocation-authorized
`NVIDIA_API_KEY`.

Realtime Generic FBA uses at least:

- `NGC_API_KEY` for chart/model image access; and
- `REALTIME_API_KEY` for its inner OpenAI Realtime-compatible gateway contract.

When proxy bearer coexistence is enabled, the outer NVCF Authorization header and inner
Realtime authentication remain distinct trust boundaries. Do not disable authentication
because the endpoint is not operated by OpenAI.

The standalone Lightning function requires model-pull credentials at deployment and an
invocation key for client calls.

## Viking

Use namespace-scoped Kubernetes Secrets referenced by the Viking values file. Historically:

- `nvidia-api-key` covers NVIDIA/NGC access; and
- `nva-tool-api-keys` covers Perplexity, WeatherAPI, and Finnhub.

Inspect names only:

```bash
kubectl -n nva-p7 get secret
helm template p7 nvcf_helm -f nvcf_helm/values-viking.yaml |
  rg -n 'secretKeyRef|secretName|NVIDIA_API_KEY|NGC_API_KEY|PERPLEXITY_API_KEY|WEATHERAPI_KEY|FINNHUB_API_KEY'
```

Do not use `kubectl get secret ... -o yaml` in captured output. A missing
`nva-tool-api-keys` Secret previously blocked all five app pods with
`CreateContainerConfigError`.

## SQA

`SQA_KEY` belongs only to the test harness. Do not place it in application values or
reports.

If all independent-ASR/TTS oracle requests return 403, classify harness authentication
before product behavior. Refresh the harness key through its approved source and rerun the
same suite.

## Scanning and Rotation

Scan:

- unstaged/staged diff;
- every new or rewritten commit;
- reachable history of recovered/adopted branches;
- Docker image history/config/labels and extracted source;
- UI bundle and runtime `config.js`;
- chart package and fully rendered target manifests;
- release manifests, reports, logs, and ignored artifacts.

Use repository pre-commit private-key checks and Gitleaks. Search common key prefixes
without writing matching values to an artifact.

After a suspected exposure:

1. stop copying or testing the value;
2. rotate at the credential owner;
3. update only approved stores;
4. roll/restart consumers as required;
5. verify old-key rejection without printing either key; and
6. record the incident without the value.

## Authentication Failures

| Failure | Most likely boundary |
|---|---|
| `docker push` denied | nvcr.io login/repository permission |
| NGC image/chart 403 | NGC key scope or org/team |
| NGC function create denied | NVCF control-plane authorization |
| instance logs denied | personal runtime authorization |
| runtime 401/403 | invocation key/function authorization |
| Astra UI 401/403 upstream | Vault key or function ID mismatch |
| Fusion query fails | expired Fusion token, wrong platform/environment |
| SQA ASR/TTS 403 | `SQA_KEY` |
| tool 401/403 | provider-specific key on app replicas |

Fix the matching boundary. Do not redeploy models or loosen application safety because a
credential expired.
