# Deploy Standalone Speech NIM Functions on NVCF

This runbook records the container-based NVCF deployment pattern for the
standalone speech services used by Nemotron Voice Agent. These functions are
independent of the Helm-managed speech NIMs inside the main
`nemotron-voice-agent` function.

## Current standalone functions

The following versions were created on September 8, 2026 and deployed to one
H100 each in `nvcf-dgxc-k8s-oci-nrt-prd12-1`. Each deployment has minimum and
maximum replicas `1/1` and maximum request concurrency `8`.

| Service | NIM version | Function ID | Version ID | Deployment ID | Wrapper image digest | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Nemotron ASR Streaming | `1.3.1` | `4155ae85-73e1-4936-b47f-87b9de165651` | `f553be4a-9400-4509-bdfa-cb1d9d4005bd` | `467848f2-c59e-46ce-be10-58654d102216` | `sha256:eaaca80ddb8b25833beab90d8cdbe6b3059ff04e4dcedd52e1ea7d36f8a1cd93` | ACTIVE |
| Magpie TTS Multilingual | `1.10.0` | `500bfea0-ba3d-4158-8276-1d04daedfdcd` | `3b5f8003-a937-4da5-8844-a3520be74e67` | `f77a6c18-31cf-4fc2-9bd9-5dea66746887` | `sha256:1eb3dcb09d80cec49ab2d696053add8caf1ba1ed95f1f258307d1c53ec7ebded` | ACTIVE |
| Chatterbox TTS Multilingual | `1.1.0` | `8d3eb462-afcb-46d7-80ca-4e8b6c6fd20e` | `1c2642fb-1191-4449-9c8a-3159d2868d99` | `6b5509af-ca6d-45a8-8ebc-73e51b2c3c62` | `sha256:b00e4d2420dc44c04cc4a941f1abaaacc9db059319bc1e1f3e466c6ddbd1227f` | ACTIVE |

All three functions expose NVIDIA Speech gRPC on port `50051`. NVCF uses the
standard gRPC health service on that same port. The ASR function selects
`type=en-US,mode=str`; both TTS functions select `batch_size=8`.

> ACTIVE is a control-plane and health-gate result. The service-key credential
> used for deployment cannot invoke NVCF or read instance logs. A functional
> ASR/TTS request still requires a personal NVIDIA `nvapi` credential and is
> not claimed by this record. No SQA suite was run for these standalone
> functions.

## Why the wrapper image exists

NVCF function secrets arrive in `/var/secrets/secrets.json`, while Speech NIM
expects `NGC_API_KEY` in the process environment. The shared wrapper
[`docker/nvcf-speech-nim-entrypoint.sh`](../../docker/nvcf-speech-nim-entrypoint.sh)
reads only `NGC_API_KEY` (with a legacy `NVIDIA_API_KEY` fallback), exports it
without logging its value, fails closed when no credential is present, and
then executes `/opt/nim/start_server.sh` as the upstream non-root `nvs:1000`
user. The wrapper is added by
[`docker/Dockerfile.nvcf-speech-nim`](../../docker/Dockerfile.nvcf-speech-nim).

Do not pass the NGC credential as a normal container environment variable and
do not bake it into an image layer. Create every function version with an
individual NVCF secret named `NGC_API_KEY`.

## Build and publish

Use a distinct private image repository for each NIM. Replace `<source-sha>`
and `<tag>` with immutable values.

```bash
docker build --platform linux/amd64 \
  -f docker/Dockerfile.nvcf-speech-nim \
  --build-arg BASE_IMAGE=nvcr.io/nim/nvidia/<speech-nim>:<nim-version> \
  --label org.opencontainers.image.revision=<source-sha> \
  -t nvcr.io/<org>/<private-repository>:<tag> .

docker push nvcr.io/<org>/<private-repository>:<tag>
ngc registry image info <org>/<private-repository>:<tag> --format_type json
```

Before publication, verify the final image remains `linux/amd64`, runs as
`nvs:1000`, uses `/opt/nva/bin/nvcf-speech-nim-entrypoint.sh`, and contains no
credential-shaped value in its configuration or history.

## Create and deploy

The gRPC function shape is the same for ASR and TTS. NVCF derives the gRPC
health configuration from `/grpc` and port `50051`; do not add an HTTP health
URI. Read the key into a shell variable without printing it.

```bash
key=$(awk -F'= *' '/^apikey/ {print $2; exit}' "$HOME/.ngc/config")
test -n "$key"

ngc cloud-function function create --org <org> \
  --name <function-name> \
  --container-image <org>/<private-repository>:<tag> \
  --inference-url /grpc \
  --inference-port 50051 \
  --api-body-format CUSTOM \
  --function-type DEFAULT \
  --container-environment-variable NIM_HTTP_API_PORT:9000 \
  --container-environment-variable NIM_GRPC_API_PORT:50051 \
  --container-environment-variable NIM_TAGS_SELECTOR:<selector> \
  --secret "NGC_API_KEY:${key}" \
  --format_type json

ngc cloud-function function deploy create <function-id>:<version-id> \
  --org <org> \
  --deployment-specification \
    nvcf-dgxc-k8s-oci-nrt-prd12-1:H100:OCI.GPU.H100_1x:1:1:8 \
  --format_type json
```

Use `type=en-US,mode=str` for Nemotron ASR Streaming and `batch_size=8` for
Magpie or Chatterbox. Function versions do not inherit secrets, so supply the
secret again whenever a new version is created.

## Verify

First confirm deployment and instance readiness:

```bash
ngc cloud-function function deploy info <function-id>:<version-id> \
  --org <org> --format_type json
ngc cloud-function function instance list <function-id>:<version-id> \
  --org <org> --format_type json
```

Then use a personal NVIDIA API key to send a real Riva gRPC request through
`grpc.nvcf.nvidia.com:443`, with the function ID in NVCF routing metadata.
For ASR, transcribe a known WAV and compare the text. For each TTS function,
synthesize a fixed sentence and verify that at least one non-empty audio chunk
is returned. Do not call the deployment function qualified until these smokes
and the required performance or SQA gates pass.

## Source and security provenance

- Local source branch: `dev/nikkulkarni/nvcf-speech-nim-functions`
- Wrapper source commit: `5b0df789568829ea5280cceb5fa336bb49d1b6b0`
- Focused wrapper tests: 4 passed
- Changed-file pre-commit checks: passed
- Image configuration and history credential-pattern checks: passed
- NGC vulnerability scan state at publication: `NOT_SCANNED`
- Secret value persistence: none in Git, image configuration, image history,
  or this document

The branch is intentionally local until its export to a named remote is
explicitly authorized. The existing main NVCF function and Astra deployment
were not modified by this operation.
