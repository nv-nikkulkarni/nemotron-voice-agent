# Credentials and Access

## Contents

1. [Non-Negotiable Rules](#non-negotiable-rules)
2. [Credential Inventory](#credential-inventory)
3. [Viking Injection](#viking-injection)
4. [NVCF Function-Version Injection](#nvcf-function-version-injection)
5. [Astra and Vault](#astra-and-vault)
6. [Dedicated Speech Function Clients](#dedicated-speech-function-clients)
7. [NGC Authentication and Artifact Types](#ngc-authentication-and-artifact-types)
8. [SQA Runtime Authentication](#sqa-runtime-authentication)
9. [Secret Scanning](#secret-scanning)
10. [Failure Patterns](#failure-patterns)
11. [Fresh Develop Clone](#fresh-develop-clone)

## Non-Negotiable Rules

- Never copy a credential value from task history into a file, command, report, log, image,
  chart, or reply.
- Treat every key pasted into a prior chat as exposed. Rotate it and update only the
  approved Kubernetes Secret, NVCF version secret, or Astra Vault location.
- Print secret names and references, not Secret objects or `/var/secrets/secrets.json`.
- Do not assume login state persists. Fusion, NGC, Docker/Artifactory, and GitHub sessions
  expire independently.
- Do not use an NVCF invocation key as an NGC registry key unless its scopes are verified.
- Scan both the final diff and every rewritten commit after a squash or rebase.

This skill intentionally contains no secret value.

## Credential Inventory

| Name | Purpose | Secret? | Typical owner |
|---|---|---:|---|
| `NVIDIA_API_KEY` | NVIDIA inference/NVCF invocation and model API access | yes | app, Astra proxy, SQA client |
| `NGC_API_KEY` | NGC image/chart/resource access and session capture publication | yes | model pull, capture finalizer, release tooling |
| `PERPLEXITY_API_KEY` | Generic `web_search` | yes | all app replicas |
| `WEATHERAPI_KEY` | Generic `get_weather` | yes | all app replicas |
| `FINNHUB_API_KEY` | Generic `get_stock_price` | yes | all app replicas |
| `SESSION_CAPTURE_NGC` | destination such as org/resource, not authentication | no | capture finalizer |
| `SQA_KEY` | hosted query-TTS and independent-ASR test services | yes | SQA process only |
| `NVCF_HOST` | Astra upstream gateway selection | normally no | Astra Vault/config |
| `NVCF_FUNCTION_ID` | selects the invoked NVCF function | identifier | Astra Vault/config |

The three external tool credentials must be present on every app replica. A successful
request on one pod does not establish consistent Deployment injection.

## Viking Injection

Use namespace-scoped Kubernetes Secrets and checked-in key selectors. Historical/current
names include:

- `nvidia-api-key` for NVIDIA/NGC access; and
- `nva-tool-api-keys` for WeatherAPI, Finnhub, and Perplexity.

The exact names come from `nvcf_helm/values-viking.yaml` and the rendered application
Deployment. Inspect references safely:

```bash
kubectl -n nva-p7 get secret
helm template p7 nvcf_helm -f nvcf_helm/values-viking.yaml |
  rg -n "secretKeyRef|secretName|NVIDIA_API_KEY|NGC_API_KEY|PERPLEXITY_API_KEY|WEATHERAPI_KEY|FINNHUB_API_KEY"
```

Do not run `kubectl get secret ... -o yaml` in a transcript. Confirm a secret's required
keys with redacted key names or JSONPath that does not decode values.

If app pods show `CreateContainerConfigError`, inspect `kubectl describe pod`. One observed
Viking rollout had all five app replicas blocked because `nva-tool-api-keys` did not exist;
the model images were already pulled and the ASR/TTS init checks had passed.

## NVCF Function-Version Injection

Each NVCF function version has its own secret set. New versions do not inherit the previous
version's values. Supply all required names every time.

NVCF mounts values in `/var/secrets/secrets.json`; the entrypoint exports individual named
variables. The application expects six separate entries:

1. `NVIDIA_API_KEY`
2. `NGC_API_KEY`
3. `PERPLEXITY_API_KEY`
4. `WEATHERAPI_KEY`
5. `FINNHUB_API_KEY`
6. `SESSION_CAPTURE_NGC`

A failed production version received one nested JSON value named `secrets` instead of six
entries. Kubernetes started the function, but the app could not resolve its expected keys.
Never serialize the entire map as one secret.

Inspect the function/version metadata for secret **names** only. Do not display mounted
content. Verify the version again after creation; a CLI command succeeding does not prove
that the correct names were attached.

## Astra and Vault

Astra serves a static UI plus nginx proxy. The browser receives none of the upstream
credentials. Fusion-managed Vault values supply:

- `NVCF_HOST`;
- `NVCF_FUNCTION_ID`; and
- an invocation-capable `NVIDIA_API_KEY`.

The last known path is:

```text
fusion/astra/nemotron-voice-agent-astra/nemotron-voice-agent-deploy/stg
```

Load the installed `fusion` skill before using the CLI. Reauthenticate when needed:

```bash
fusion login --reauth
```

Do not install or upgrade Fusion merely to answer a read-only status question without
explicit authorization. If the loaded skill's version gate requires a host mutation,
report that boundary first.

Never run `fusion vault get` in a captured status session unless the installed CLI offers
verified value suppression. It can print secret values. Prefer deployment references and
name-only configuration checks; if an exact value must be inspected, keep it out of tool
output and user-visible transcripts.

Then export/read the deployment and Vault references before mutation. The Astra app can be
Healthy/Synced while pointing to the wrong NVCF function ID, so verify both Argo state and
the effective runtime `/api/deployment` response.

The current endpoint can include full prompt text and internal service URLs. Query only
the fields needed to verify the target, and redact or suppress those details in logs and
reports. It must never contain invocation or provider credentials.

nginx adds `Authorization` and `function-id` to HTTP and WebSocket upstreams and strips
browser cookies plus upstream `Set-Cookie`. Never bake a key into the Vite bundle,
`config.js`, environment visible to the browser, or OCI labels.

## Dedicated Speech Function Clients

The dedicated ASR and TTS functions share this gateway:

```text
grpc.nvcf.nvidia.com:443
```

Use TLS and pass these gRPC metadata entries:

```text
authorization: Bearer <authorized NVIDIA API key>
function-id: <dedicated function ID>
```

Current function identifiers are in
[Current State Snapshot](current-state-snapshot.md#dedicated-speech-nvcf-functions).
Do not publish an API key with the endpoint. Users need an invocation key authorized for
the target function.

The secure wrapper reads `/var/secrets/secrets.json`, maps the required NGC credential into
the upstream NIM environment, never logs it, and fails closed if it is absent. `ACTIVE`
does not prove an ASR stream or TTS synthesis succeeds; run an actual client call.

## NGC Authentication and Artifact Types

NGC has distinct artifact kinds and permissions.

### Helm chart

The NVCF chart is an NGC Helm chart:

```bash
ngc registry chart push 0491162300748285/nemotron-voice-agent:<version> \
  --source <directory-containing-packaged-chart>
ngc registry chart pull 0491162300748285/nemotron-voice-agent:<version>
```

Use the exact organization and chart name expected by the NVCF function version. Record
the package SHA-256 before upload and verify the pulled package matches.

### Session capture

Session archives are NGC generic resource versions:

```bash
ngc registry resource info 0491162300748285/session-captures:<session-id>
```

The capture finalizer creates/uploads one version named after the short session ID.

Do not use `ngc registry resource upload-version` for the Helm package. During the 0.1.123
release, that wrong historical path caused confusing 403/404 responses and created a
generic resource that NVCF did not consume. A 403 can mean key scope; a 404 can mean wrong
artifact kind or absent resource. Resolve both before creating anything.

## SQA Runtime Authentication

`SQA_KEY` is supplied only to the Playwright/real-audio harness. It authorizes the external
query-speech generator and independent-ASR oracle. It is not an application credential and
must not be written to an artifact directory or committed report.

If Suite B or another audio suite suddenly returns independent-ASR 403 for every turn,
classify authentication before product behavior. Refresh the key and rerun the exact suite;
do not edit Omni or weaken the oracle first.

## Secret Scanning

Scan these surfaces before push or deployment:

- unstaged/staged diff;
- every newly created or rewritten commit snapshot;
- reachable branch history when adopting a recovered branch;
- built app and UI image configuration/history and extracted source;
- Helm package and fully rendered manifests;
- Markdown reports, release manifests, and generated logs; and
- ignored/untracked artifacts before copying anything into Git.

Use repository-configured pre-commit private-key detection and Gitleaks. Also search known
key shapes without printing matching values into a permanent log. A Gitleaks fingerprint
entry added for a reviewed non-secret placeholder is not permission to ignore the entire
file or pattern.

After history rewriting, scan the new commits even if the old branch was previously clean.
A rebase can expose a conflict resolution that accidentally chose a secret-bearing blob.

## Failure Patterns

| Symptom | Likely boundary | Required check |
|---|---|---|
| all app pods `CreateContainerConfigError` | missing Kubernetes Secret/key | describe pod; compare rendered refs to secret key names |
| one tool works intermittently across five replicas | inconsistent key injection | inspect Deployment env refs and every pod, not one request |
| NVCF version starts but tools/capture fail | incomplete per-version secret set | compare six required names |
| NVCF secret file has only `secrets` | nested-map creation mistake | recreate version entries individually |
| NGC chart upload returns resource 404 | wrong artifact API or org/name | use chart push/pull and verify namespace |
| NGC capture upload returns 403 | registry scope/key mismatch | verify dedicated NGC key permissions |
| Astra HTTP works, WebSocket fails | proxy/Vault/function-ID/auth mismatch | export Astra, inspect nginx route and effective target |
| SQA independent ASR returns 403 | expired/incorrect `SQA_KEY` | refresh harness-only key and rerun |
| dedicated speech function `ACTIVE` but client denied | invocation key lacks function access | verify caller authorization and metadata |

## Fresh Develop Clone

Upstream `develop` already understands NVCF gRPC endpoints and metadata, but its service
catalogs historically select older shared NVIDIA functions:

| Service | Shared function ID in develop-era catalog |
|---|---|
| ASR | `bb0837de-8c7b-481f-9ec8-ef5663e9c1fa` |
| Magpie | `877104f7-e885-42b9-8de8-f6e4c6303969` |
| Chatterbox | `ddacc747-1269-4fab-bfd9-8f593dead106` |

Those entries predate the dedicated functions; “the endpoints are configured on develop”
means the transport mechanism and older shared IDs exist, not that the new functions were
present before they were created.

To use the dedicated functions from a fresh `develop` clone:

1. configure the Generic/Omni example's cloud service catalog rather than changing core
   ASR/TTS client code;
2. keep host `grpc.nvcf.nvidia.com` and TLS port 443;
3. replace only the ASR/Magpie/Chatterbox function IDs with the dedicated IDs from the
   current-state reference;
4. supply an authorized `NVIDIA_API_KEY` at runtime;
5. keep the model names, streaming modes, input/output rates, and TTS provider-specific
   settings consistent with the selected NIM;
6. render `/api/deployment` and `/api/session-config` to verify the effective catalog;
7. run one real ASR streaming call and one synthesis per TTS; and
8. keep the old shared IDs as an explicit rollback profile rather than overwriting history
   without a diff.

Do not paste the invocation key into YAML. Do not assume the dedicated wrapper branch is in
the fresh clone until it is intentionally pushed or merged.
