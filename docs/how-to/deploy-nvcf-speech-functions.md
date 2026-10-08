# Deploy Standalone Speech NIM Functions on NVCF

Deploy automatic speech recognition (ASR), Magpie text-to-speech (TTS), and
Chatterbox TTS as independent image-based NVIDIA Cloud Functions (NVCF)
services. These functions are separate from the main voice-agent deployment.
Use [the standalone manifest](../../deploy/nvcf/standalone.yaml) for desired
settings; this operator reference does not apply changes automatically.

## H200 Deployment Settings

The H200 migration retained function IDs and introduced these version IDs:

| Service | Function ID | H200 Version ID | Image Tag | Instances Min / Max | NIM Selector |
| --- | --- | --- | --- | --- | --- |
| ASR Streaming | `4155ae85-73e1-4936-b47f-87b9de165651` | `60249949-64e4-4180-92cf-6297677f7495` | `1.3.1-nvcf-5b0df78` | `1` / `2` | `type=en-US,mode=str` |
| Magpie | `500bfea0-ba3d-4158-8276-1d04daedfdcd` | `e839491c-8742-4a67-ba55-471f429aa2d0` | `1.10.0-nvcf-5b0df78` | `1` / `2` | `batch_size=32` |
| Chatterbox | `8d3eb462-afcb-46d7-80ca-4e8b6c6fd20e` | `510f9d44-d6e3-490a-b626-f515f1f4dfc2` | `1.1.0-nvcf-5b0df78` | `0` / `2` | `batch_size=8` |

Each desired deployment uses `OCI.GPU.H200_1x` in
`nvcf-dgxc-k8s-oci-nrt-prd6-1`, with maximum request concurrency `50`.
This admission limit is separate from the NIM batch profile and does not prove
50 concurrent requests meet a latency or throughput target. Chatterbox's
minimum zero permits scale-to-zero and cold-start delays.

All services expose Speech gRPC on port `50051`, use the standard gRPC health
service, and set `NIM_HTTP_API_PORT=9000`. Their image repositories are
`nvcf-nemotron-asr-streaming`, `nvcf-magpie-tts-multilingual`, and
`nvcf-chatterbox-tts-multilingual` under organization `0491162300748285`.

## Secure Wrapper Startup

[The shared wrapper](../../docker/nvcf-speech-nim-entrypoint.sh) reads only
`NGC_API_KEY` from `/var/secrets/secrets.json`, with a legacy `NVIDIA_API_KEY`
fallback. It exports the credential without printing it, fails when no key is
available, and executes `/opt/nim/start_server.sh`. The
[speech Dockerfile](../../docker/Dockerfile.nvcf-speech-nim) preserves the
upstream non-root `nvs:1000` user.

Create each function version with an individual secret named `NGC_API_KEY`.
Versions do not inherit secrets. Do not bake keys into image layers or pass
them as ordinary container environment settings. Invocation credentials are
separate from model-download credentials.

## Build and Publish

Use a distinct private image repository per NIM and immutable source/tag values:

```bash
docker build --platform linux/amd64 \
  -f docker/Dockerfile.nvcf-speech-nim \
  --build-arg BASE_IMAGE=nvcr.io/nim/nvidia/<speech-nim>:<nim-version> \
  --label org.opencontainers.image.revision=<source-sha> \
  -t nvcr.io/<org>/<private-repository>:<tag> .

docker push nvcr.io/<org>/<private-repository>:<tag>
ngc registry image info <org>/<private-repository>:<tag> --format_type json
```

Verify `linux/amd64`, user `nvs:1000`, the secret-aware entrypoint, and image
configuration/history without exposing credentials. Record the registry digest.

## Create and Deploy

Check installed CLI help first. NVCF derives gRPC health configuration from
`/grpc` and port `50051`; do not substitute an HTTP health URI. For a
replacement, supply the existing function ID and every required secret:

```bash
read -rsp "NVIDIA model-download key: " NVCF_MODEL_KEY
echo

ngc cloud-function function create <function-id> --org 0491162300748285 \
  --name <function-name> \
  --container-image 0491162300748285/<private-repository>:<tag> \
  --inference-url /grpc \
  --inference-port 50051 \
  --api-body-format CUSTOM \
  --function-type DEFAULT \
  --container-environment-variable NIM_HTTP_API_PORT:9000 \
  --container-environment-variable NIM_GRPC_API_PORT:50051 \
  --container-environment-variable 'NIM_TAGS_SELECTOR:<selector>' \
  --secret "NGC_API_KEY:${NVCF_MODEL_KEY}"

unset NVCF_MODEL_KEY

ngc cloud-function function deploy create <function-id>:<new-version-id> \
  --org 0491162300748285 \
  --deployment-specification \
    nvcf-dgxc-k8s-oci-nrt-prd6-1:H200:OCI.GPU.H200_1x:<min>:2:50
```

Use the service's selector and minimum from the table. Omit the positional
function ID only when creating a separate function identity. Protect creation
output and use an approved host: secret arguments can appear in local process
inspection even when shell history contains only variable names.

To change an existing H200 deployment's admission limit, retain its version,
backend, instance shape, and instance limits:

```bash
ngc cloud-function function deploy update <function-id>:<version-id> \
  --org 0491162300748285 \
  --deployment-specification \
    nvcf-dgxc-k8s-oci-nrt-prd6-1:H200:OCI.GPU.H200_1x:<min>:2:50
```

A deployment update can interrupt active requests. Read back effective settings
and recheck inference after the update.

## Verify and Record Evidence

Confirm deployment and instance readiness, keeping secret-bearing metadata out
of captured output:

```bash
ngc cloud-function function deploy info <function-id>:<version-id> \
  --org 0491162300748285 --format_type json
ngc cloud-function function instance list <function-id>:<version-id> \
  --org 0491162300748285 --format_type json
```

Send real Riva gRPC requests through `grpc.nvcf.nvidia.com:443` with invocation
authorization and the intended function/version routing metadata. Transcribe a
known WAV for ASR. For TTS, synthesize a fixed sentence and require nonempty
audio. Check cold-start recovery and load separately; a working single request
and NVCF `ACTIVE` do not qualify a 50-request workload.

### Dated Validation Boundary

The three H200 versions above previously passed real request smokes. The
September 08 H100 deployments, batch-eight Magpie settings, and local-only
branch status are historical. The source branch is now
`dev/nikkulkarni/nvcf-standalone-functions`, rebased onto upstream `develop`.
On October 08, deployment updates were accepted with concurrency `50` and
`ACTIVE` state, retaining the listed version IDs and instance settings. ASR
startup selected profile `rmir-en-us-bs128-26.07.6` (batch 128) under its unchanged
`type=en-US,mode=str` selector; Magpie selected batch 32 and Chatterbox batch 8.
Post-update version-pinned ASR returned “What is ten divided by two?” in
1.06 seconds. Magpie returned 13 audio chunks totaling 104,448 bytes in
1.14 seconds. Chatterbox requests returned `DEADLINE_EXCEEDED` while the gateway
could not establish a worker link. Metadata reported `STARTING`, and startup
logs at `2026-10-08 08:36:16 UTC` showed the batch-eight RMIR profile downloading.
A later version-pinned Chatterbox smoke passed after startup, returning four
audio chunks totaling 99,226 bytes in 1.62 seconds. All three services therefore
passed post-update single-request smokes. Final readback reported each version
`ACTIVE`, with a container image and no Helm chart, concurrency `50`, and the
listed minimum/maximum instance settings. One running instance per service
was observed. No 50-request concurrency qualification is claimed.

Preserve the main voice-agent and Astra deployments. Delete only explicitly
authorized old standalone versions after confirming consumers and rollback
needs; retain each function ID and its serving replacement.
