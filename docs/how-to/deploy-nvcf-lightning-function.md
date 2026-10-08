# Deploy Standalone Nemotron 3.5 Lightning on NVCF

Deploy Nemotron 3.5 Lightning as an independent NVIDIA Cloud Functions (NVCF)
container function. It exposes an OpenAI-compatible chat-completions endpoint.
The standalone branch uses image deployments for Lightning and the speech
services; it does not contain a Helm chart or require an Astra UI deployment.

## Deployment Contract

Use [the standalone manifest](../../deploy/nvcf/standalone.yaml) as the source
of desired settings. The manifest is an operator reference, not an executable
deployment command or proof that the live deployment matches it.

The desired Lightning contract is:

| Item | Value |
| --- | --- |
| Function name | `nva-nemotron-3-5-lightning` |
| Function ID | `9e6b5886-1474-4108-80d6-0cff9ba41fab` |
| Image-based version ID | `c0f80de9-bba9-4ad9-b9d3-c8c252c9671a` |
| Deployment ID | `ea6d46b6-59e0-433c-a6eb-34b522449cd4` |
| Image repository | `nvcr.io/0491162300748285/nvcf-nemotron-lightning` |
| Base image | `nemotron-lightning-selfcontained:2.0.9-variant` |
| Base digest | `sha256:67294eff48e39459267c01bdbd0fd37adcd01b76b6c022464884c775f7492e91` |
| Backend | `nvcf-dgxc-k8s-oci-nrt-prd6-1` |
| Instance type | `OCI.GPU.H200_2x` |
| Minimum / maximum instances | `0` / `1` |
| Maximum request concurrency | `50` |
| Served model | `nvidia/nemotron-3.5-lightning-30b-a3b` |
| Inference route / port | `/v1/chat/completions` / `8000` |
| Health contract | HTTP `200` at `/v1/health/ready` on `8000`, timeout `PT10S` |

Maximum request concurrency is an admission limit. Setting it to `50` does
not demonstrate acceptable latency or throughput for 50 simultaneous requests.
The earlier chart-based H200 version required approximately six minutes to
start; a 250-second invocation window expired before readiness. Minimum zero
retains that cold-start risk. Keeping an instance warm requires a separate
capacity decision.

## Secure Image Startup

[The Lightning Dockerfile](../../docker/Dockerfile.nvcf-lightning-nim) derives
from the pinned self-contained NIM image and installs the
[shared secret-aware entrypoint](../../docker/nvcf-speech-nim-entrypoint.sh).
It reads `NGC_API_KEY` from `/var/secrets/secrets.json`, accepts a legacy
`NVIDIA_API_KEY` secret as fallback, and exports the credential to the NIM
process without printing it. Missing credentials fail startup. Supply the
complete secret set for every new function version; versions do not inherit it.

Keep model-download credentials separate from invocation credentials. Do not
place either value in an image layer, a normal container environment setting,
Git, reports, or browser JavaScript.

## Build and Publish

Build from a clean committed source archive. Replace `<source-sha>` and `<tag>`
with immutable identities:

```bash
docker build --platform linux/amd64 \
  -f docker/Dockerfile.nvcf-lightning-nim \
  --label org.opencontainers.image.revision=<source-sha> \
  -t nvcr.io/0491162300748285/nvcf-nemotron-lightning:<tag> .

docker push nvcr.io/0491162300748285/nvcf-nemotron-lightning:<tag>
ngc registry image info \
  0491162300748285/nvcf-nemotron-lightning:<tag> --format_type json
```

Verify the final image platform, secret-aware entrypoint, effective user,
configuration, and history. Record the registry digest before creating a
function version. Do not publish or reuse the main voice-agent image repository.

## Create an Image-Based Replacement

Inspect the installed CLI help before using these examples. Read the download
credential without printing it, and avoid shell tracing:

```bash
read -rsp "NVIDIA model-download key: " NVCF_MODEL_KEY
echo

ngc cloud-function function create \
  9e6b5886-1474-4108-80d6-0cff9ba41fab \
  --org 0491162300748285 \
  --name nva-nemotron-3-5-lightning \
  --container-image 0491162300748285/nvcf-nemotron-lightning:<tag> \
  --inference-url /v1/chat/completions \
  --inference-port 8000 \
  --health-uri /v1/health/ready \
  --health-port 8000 \
  --health-protocol HTTP \
  --health-expected-status-code 200 \
  --health-timeout PT10S \
  --api-body-format CUSTOM \
  --function-type DEFAULT \
  --container-environment-variable NIM_HTTP_API_PORT:8000 \
  --container-environment-variable 'NIM_PASSTHROUGH_ARGS:--served-model-name nvidia/nemotron-3.5-lightning-30b-a3b --enable-auto-tool-choice --tool-call-parser qwen3_coder --reasoning-parser nemotron_v3' \
  --secret "NGC_API_KEY:${NVCF_MODEL_KEY}"

unset NVCF_MODEL_KEY
```

The positional function ID retains the service identity and creates a new
version. Record the returned version ID. Command arguments can be visible to
local process inspection; use an approved operator host and protect captured
output from function-creation commands.

Deploy the new version with the manifest's desired shape and admission limit:

```bash
ngc cloud-function function deploy create \
  9e6b5886-1474-4108-80d6-0cff9ba41fab:<new-version-id> \
  --org 0491162300748285 \
  --deployment-specification \
    nvcf-dgxc-k8s-oci-nrt-prd6-1:H200:OCI.GPU.H200_2x:0:1:50
```

For an existing image-based deployment, use `deploy update` with the same
specification. A deployment update can interrupt active requests. Changing a
chart-backed function to a container image requires a new function version;
updating only its deployment does not change that version's artifact type.

## Invoke and Verify

Use a server-side invocation credential and the actual served model ID. Pin the
replacement version during migration checks so other active versions cannot
supply the response:

```bash
export NVCF_FUNCTION_ID=9e6b5886-1474-4108-80d6-0cff9ba41fab
export NVCF_VERSION_ID=<new-version-id>
read -rsp "NVCF invocation key: " NVCF_API_KEY
echo

curl --fail-with-body --silent --show-error \
  "https://${NVCF_FUNCTION_ID}.invocation.api.nvcf.nvidia.com/v1/chat/completions" \
  -H "Authorization: Bearer ${NVCF_API_KEY}" \
  -H "function-id: ${NVCF_FUNCTION_ID}" \
  -H "function-version-id: ${NVCF_VERSION_ID}" \
  -H "Content-Type: application/json" \
  --data '{
    "model": "nvidia/nemotron-3.5-lightning-30b-a3b",
    "messages": [{"role": "user", "content": "Reply with only: ready"}],
    "temperature": 0,
    "max_tokens": 16,
    "stream": false,
    "chat_template_kwargs": {"enable_thinking": false}
  }'

unset NVCF_API_KEY
```

Require model readiness, nonempty buffered text, a complete streaming response,
and valid native tool arguments. Verify thinking-disabled output separately.
Record the version, deployment, digest, health response, and redacted request
results. `ACTIVE` alone does not qualify inference, load, or cold-start recovery.

### Dated Validation Boundary

The earlier chart-based H200 version `3c0e625b-9e61-4314-a48a-826e3911f441`
completed buffered and streaming requests after startup. Those results do not
qualify the replacement image. On October 08, image
`2.0.9-variant-nvcf-8601c1e` was built from source
`8601c1ec850dd36c724bb148110a583b715f3f00`. Synthetic mounted-secret startup
passed in the actual image as user `nim`; image configuration and history
credential-pattern checks passed. Registry publication verified OCI index
`sha256:cb6148a9973fc98d74ced8db7faf29498774731ec5094d40a4b4eaeb285696db`
and AMD64 manifest
`sha256:f78b3794da7775c5377a3284170982df2c40ad6cc54178cbd257def0b8275970`.
The image-based replacement version is `c0f80de9-bba9-4ad9-b9d3-c8c252c9671a`,
with deployment `ea6d46b6-59e0-433c-a6eb-34b522449cd4`. Function metadata
references the container image and no Helm chart, with only secret name
`NGC_API_KEY`. Qualification temporarily used minimum one and maximum one H200 2x instance.
Version-pinned checks passed: readiness HTTP `200`, the exact advertised model
ID, buffered “ready,” a complete SSE “ready” response ending in `[DONE]`,
thinking-disabled output, and a native `get_weather` tool call with valid
`city: Boston` arguments. Startup plus these smokes took 243.9 seconds.
The final deployment update was accepted as `ACTIVE` with minimum zero,
maximum one, and concurrency `50` on the same H200 2x shape.

Both prior chart deployments were gracefully undeployed: H200 version
`3c0e625b-9e61-4314-a48a-826e3911f441` and H100 version
`f419f631-bc0f-4d0e-90e8-0cbf70de5181`. Their version records were preserved.
Final readback confirmed that only the image-based version was `ACTIVE`;
both chart versions were `INACTIVE`. An unversioned invocation returned HTTP
`200`, advertised model `nvidia/nemotron-3.5-lightning-30b-a3b`, and text “ready.”
One running instance was observed, with final minimum zero and maximum one.
Retained chart version records provide a possible redeployment path, not a
freshly qualified rollback or currently serving standby. No 50-request load,
sustained availability, or full voice-agent suite qualification is claimed.

Remove only explicitly authorized old standalone versions after checking
consumers, version pins, and rollback needs. Preserve the function ID, its
replacement, and the main voice-agent function and Astra deployment.
