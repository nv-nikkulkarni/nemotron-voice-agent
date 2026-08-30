# Staging lane & staging → production promotion

A permanent **staging** environment mirrors production so changes can be validated end
to end before they touch the live function or the live Astra URL. Staging is fully
isolated from prod: a **separate NVCF function** (its own GPU node) and a **separate
Astra app/URL** (its own Vault secret). The two never share state.

> **Naming:** fusion **forbids** env keywords (`stg`/`staging`/`prd`/`prod`/`dev`/…) in
> repo names and **appends `-deploy`** to the repo. So the staging lane's Astra app is
> **`nemotron-voice-agent-preview-deploy`** (created with `-n nemotron-voice-agent-preview`).

| | **Production** | **Staging (a.k.a. "preview")** |
|---|---|---|
| NVCF function | `81862ff8-4931-4f1e-9655-caa5b0bc5911` | `d67e6989-0cb4-4f91-89d3-b86992e84a1a` |
| NVCF function name | `nemotron-voice-agent` | `nemotron-voice-agent-staging` |
| GPU | 1× `OCI.GPU.H100_8x`, always-on | 1× `OCI.GPU.H100_8x`, always-on |
| Backend | `nvcf-dgxc-k8s-oci-nrt-prd6-1` | `nvcf-dgxc-k8s-oci-nrt-prd6-1` |
| Astra app | `nemotron-voice-agent-deploy` | `nemotron-voice-agent-preview-deploy` |
| Astra URL | `nemotron-voice-agent-deploy-backend.stg.astra.nvidia.com` | `nemotron-voice-agent-preview-deploy-backend.stg.astra.nvidia.com` |
| Astra values | `nemotron-voice-agent-values.yaml` | `nemotron-voice-agent-preview-values.yaml` |
| Vault KV | `fusion/astra/nemotron-voice-agent-astra/nemotron-voice-agent-deploy/stg` | `fusion/astra/nemotron-voice-agent-astra/nemotron-voice-agent-preview-deploy/stg` |

Org `0491162300748285`. The UI image is **function-agnostic** — which function it talks
to is chosen only by the `NVCF_HOST` / `NVCF_FUNCTION_ID` / `NVIDIA_API_KEY` in each
app's Vault secret (rendered into nginx at container start). The same image tag can serve
prod and staging.

## Build the artifacts (shared by both lanes)

```bash
# App image (backend + baked session-capture scripts). Heavy layers cache from the prior tag.
docker build --platform linux/amd64 -f docker/Dockerfile \
  -t nvcr.io/0491162300748285/nemotron-voice-agent:<APP_TAG> .
docker push nvcr.io/0491162300748285/nemotron-voice-agent:<APP_TAG>   # nvcr.io auth is cached

# Chart (bump nvcf_helm/Chart.yaml version + appImage.tag first)
helm package nvcf_helm -d /tmp
NGC_CLI_ORG=0491162300748285 ngc registry chart push \
  0491162300748285/nemotron-voice-agent:<CHART_VER> --source /tmp/nemotron-voice-agent-<CHART_VER>.tgz

# UI image for Astra (amd64, non-root; JFrog docker auth is cached)
docker build --platform linux/amd64 -f docker/Dockerfile.nvcf-ui \
  -t artifactory.nvidia.com/it-astra-docker-local/nemotron-voice-agent/nemotron-voice-agent-ui:<GITSHA> .
docker push artifactory.nvidia.com/it-astra-docker-local/nemotron-voice-agent/nemotron-voice-agent-ui:<GITSHA>
```

`<APP_TAG>` comes from `nvcf_helm/values.yaml` `appImage.tag`; `<CHART_VER>` from
`Chart.yaml`; `<GITSHA>` = the commit tag used in the Astra values file.
`K` below = the org NGC apikey (`grep '^apikey' ~/.ngc/config`); `SK` = the Perplexity
`sk-*` key; `WK` = the WeatherAPI key (get_weather); `FK` = the Finnhub key (get_stock_price); the nvapi invocation key is what the UI's `NVIDIA_API_KEY` must be. All five secrets must be re-supplied on every new function version — NVCF does not carry secrets across versions.

## Deploy to STAGING

### NVCF (only when the function must be (re)created / re-versioned)
```bash
# New VERSION of the staging function (positional function-id = new version):
NGC_CLI_ORG=0491162300748285 ngc cloud-function function create d67e6989-0cb4-4f91-89d3-b86992e84a1a \
  --name nemotron-voice-agent-staging \
  --helm-chart 0491162300748285/nemotron-voice-agent:<CHART_VER> --helm-chart-service nemotron-voice-agent \
  --inference-url /api/ws --inference-port 7860 \
  --health-uri /health --health-port 7860 --health-protocol HTTP \
  --health-expected-status-code 200 --health-timeout PT10S \
  --api-body-format CUSTOM --function-type DEFAULT \
  --secret NGC_API_KEY:$K --secret NVIDIA_API_KEY:$K --secret PERPLEXITY_API_KEY:$SK \
  --secret WEATHERAPI_KEY:$WK --secret FINNHUB_API_KEY:$FK
# then deploy that <ver>, and remove the old one (only one active version at a time):
NGC_CLI_ORG=0491162300748285 ngc cloud-function function deploy create d67e6989-...:<ver> \
  --deployment-specification nvcf-dgxc-k8s-oci-nrt-prd6-1:H100:OCI.GPU.H100_8x:1:1:100
NGC_CLI_ORG=0491162300748285 ngc cloud-function function deploy remove d67e6989-...:<old-ver>
```
(The very first function was created WITHOUT a positional id, which mints a brand-new
function id — that is how the staging function was born. Re-versioning uses the id.)

### Astra (needs `fusion auth login`; source the venv: `/home/nikkulkarni/workspace/.venv/bin/activate`)
```bash
# FIRST TIME — create the preview app (fusion appends -deploy; env keywords are forbidden
# in the name, so use "preview"). --dry-run first to validate.
fusion deploy create -n nemotron-voice-agent-preview -d nemotron-voice-agent-astra -e stg \
  -c astrastg01-ocp-pdx04 -f nemotron-voice-agent-preview-values.yaml --no-watch

# Put the STAGING function's endpoint + key in the preview Vault secret. NOTE the path
# has the -deploy suffix. Use `patch` (merge) once the path exists (fusion auto-creates it
# with template defaults on `deploy create`); `put -y` replaces all.
fusion vault patch -p fusion/astra/nemotron-voice-agent-astra/nemotron-voice-agent-preview-deploy/stg \
  -s NVCF_HOST=d67e6989-0cb4-4f91-89d3-b86992e84a1a.invocation.api.nvcf.nvidia.com \
  -s NVCF_FUNCTION_ID=d67e6989-0cb4-4f91-89d3-b86992e84a1a \
  -s NVIDIA_API_KEY=<nvapi-invocation-key>

# THEREAFTER — roll a new UI image tag. `deploy update` needs -n as the FULL GitLab URL:
REPO=https://gitlab-master.nvidia.com/ape-repo/astra-projects/nemotron-voice-agent-astra/nemotron-voice-agent-preview-deploy
fusion deploy update -n $REPO -d nemotron-voice-agent-astra -e stg \
  -f nemotron-voice-agent-preview-values.yaml -m "roll preview UI"
# ArgoCD auto-syncs within ~3 min; the pod restarts to pick up new env/secret.
```
> Gotchas: the values file identity fields (appname, hostname, secretStore, Vault role +
> `sharedSecrets` key) must ALL use the `-preview-deploy` name or the ExternalSecret reads
> the wrong Vault path and the pod 503s. `fusion deploy status` needs CLI ≥0.26 (0.22.3
> returns HTTP 426) — use `fusion deploy list` + curl the URL instead.

### Verify staging
- NVCF ACTIVE: `ngc cloud-function function deploy info d67e6989-...:<ver>` → `functionStatus: ACTIVE`.
- Local proxy smoke test (browsers can't set the `function-id` header): run the UI image with
  `NVCF_HOST`/`NVCF_FUNCTION_ID` = the staging function + an nvapi key → `/api` 200, WS 101.
- Session capture (in-app; NVCF sidecars are unusable — see docs/session capture memory): capture +
  upload run in the app process. Verify via `GET /api/session-capture/status` (files in
  capture/logs/audio/tarballs + `ngc_cli_present`/`ngc_key_present`) — the reliable HTTP path, since
  NVCF `instance logs`/`instance execute` for sidecars are opaque/sandboxed. Run a consented session
  → `<sid>.tar.gz` in NGC `0491162300748285/session-captures` (download-version to check contents).
- Staging URL: `/health` 200, `/api/deployment` 200; concurrent SQA pass (`tests/sqa`).

## Promote STAGING → PRODUCTION

Once staging is green, the same artifacts (app image + chart version + UI image) are
re-pointed at prod — nothing is rebuilt:

1. **NVCF prod** — new **version** of the prod function (positional id `81862ff8`):
   ```bash
   NGC_CLI_ORG=0491162300748285 ngc cloud-function function create 81862ff8-4931-4f1e-9655-caa5b0bc5911 \
     --name nemotron-voice-agent --helm-chart 0491162300748285/nemotron-voice-agent:<CHART_VER> \
     --helm-chart-service nemotron-voice-agent --inference-url /api/ws --inference-port 7860 \
     --health-uri /health --health-port 7860 --health-protocol HTTP \
     --health-expected-status-code 200 --health-timeout PT10S --api-body-format CUSTOM \
     --function-type DEFAULT --secret NGC_API_KEY:$K --secret NVIDIA_API_KEY:$K --secret PERPLEXITY_API_KEY:$SK \
  --secret WEATHERAPI_KEY:$WK --secret FINNHUB_API_KEY:$FK
   ngc cloud-function function deploy create 81862ff8-...:<new-ver> \
     --deployment-specification nvcf-dgxc-k8s-oci-nrt-prd6-1:H100:OCI.GPU.H100_8x:1:1:100
   # after ACTIVE + verified, drop the old version so invocation routing is unambiguous:
   ngc cloud-function function deploy remove 81862ff8-...:<old-ver>
   ```
   > **Cold-start deploy race (RETRY, don't panic):** the new version may ERROR after
   > ~11 min in DEPLOYING. This is NOT capacity (`ngc cf gpu ls` shows the prd6-1 backend has
   > H100_8x up to `.x23`) — it's the 8-NIM weight-pull tipping just over NVCF's ~11-min deploy
   > deadline on a cold node. `deploy remove` the errored version then `deploy create` again;
   > a later attempt reuses the node's now-cached weights and clears it (seen: 3rd try ACTIVE
   > in ~8 min). The old version stays ACTIVE and serving throughout, so prod never drops.
2. **Astra prod** — bump `nemotron-voice-agent-values.yaml` `apps.backend.image.tag` to
   the verified `<GITSHA>` and `fusion deploy update` the prod app. ArgoCD auto-syncs.
3. **Verify prod** unchanged otherwise: live URL `/health` 200, `/api/deployment` 200, a
   new-image-only asset 200.

## Gotchas (carried from the NVCF deploy notes)
- `--health-timeout PT10S` is mandatory (else 400 "Failed to read request").
- `--function-type DEFAULT` (helm is conveyed by `--helm-chart`).
- Deploy-spec backend is the **full** cluster name (`nvcf-dgxc-k8s-oci-nrt-prd6-1`).
- `tracing.enabled: false` (Phoenix trips the deploy progress deadline).
- Super-120B comes from the public catalog (`nvcr.io/nim/nvidia/...`), not the org registry.
- `ngc config` may point at a different org; pass `NGC_CLI_ORG=0491162300748285` explicitly.
- Instance logs/exec need a **personal** nvapi key (the org apikey is rejected there).
