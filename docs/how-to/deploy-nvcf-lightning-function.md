# Deploy Standalone Nemotron 3.5 Lightning on NVCF

This runbook describes the isolated NVIDIA Cloud Functions (NVCF) deployment
of Nemotron 3.5 Lightning. The function exposes the model's OpenAI-compatible
chat-completions API. It does not include the voice application, automatic
speech recognition (ASR), text-to-speech (TTS), Redis, SeaweedFS, or Astra UI.

The standalone function is independent of the main `nemotron-voice-agent`
function. Creating, deploying, updating, or removing this function does not
change the main function or its Astra deployment.

## Deployment Contract

The function uses the existing voice-agent chart templates with a deployment
override. It does not require a second chart package.

| Item | Value |
| --- | --- |
| NVCF function | `nva-nemotron-3-5-lightning` |
| Function ID | `9e6b5886-1474-4108-80d6-0cff9ba41fab` |
| Function version ID | `f419f631-bc0f-4d0e-90e8-0cbf70de5181` |
| Deployment ID | `09f84b02-7ac3-499e-a025-78a571b38663` |
| Backend | `nvcf-dgxc-k8s-oci-nrt-prd12-1` |
| Allocation | One `OCI.GPU.H100_1x`; minimum/maximum instances `1/1`; maximum request concurrency `8` |
| Live instance | `sr-da8de044-a83f-407f-b8fb-b7ad57729378-miniservice` |
| NGC Helm chart | `0491162300748285/nemotron-voice-agent:0.1.139` |
| Helm service | `nemotron-lightning` |
| Helm override | `nvcf_helm/values-lightning-standalone.yaml` |
| NIM image | `nvcr.io/0491162300748285/nemotron-lightning-selfcontained:2.0.9-variant` |
| Image digest | `sha256:67294eff48e39459267c01bdbd0fd37adcd01b76b6c022464884c775f7492e91` |
| HTTP service port | `8000` |
| Inference route | `/v1/chat/completions` |
| Health route | `/v1/health/ready` |
| Health contract | HTTP `200` on port `8000`, with a `10`-second timeout |
| API body format | `CUSTOM` |

The override enables only `llmLightning`, scales the application deployment to
zero, and disables every unrelated model, state, capture, tracing, and
prewarming component. It also enables the real NIM readiness endpoint, rather
than treating a running container as a ready model.

The Lightning container enables automatic tool choice with the `qwen3_coder`
tool-call parser and uses the `nemotron_v3` reasoning parser. The NIM chooses
its model profile, key-value cache, and model-length settings from its own
defaults.

## Credential Boundary

The function version has one secret named `NVIDIA_API_KEY`. The Helm NIM
startup helper reads it from `/var/secrets/secrets.json`, exports it to the NIM
process, and uses it to retrieve model artifacts. Supply this secret again for
every replacement function version because NVCF does not inherit secrets.

Do not place the value in the Helm override, an image layer, Git, a report, or
a shell transcript. The standalone function does not need the voice-agent tool
credentials, session-capture credential, or Astra Vault values.

The caller also needs an invocation-capable NVIDIA API key. Keep that caller
credential separate from the function-version model-download secret. The
examples below name the caller credential `NVCF_API_KEY` to make this
separation explicit.

## Create a Replacement Function Version

Create a replacement version only when the image, route contract, or function
configuration changes. Read the model-download key without printing it:

```bash
read -rsp "NVIDIA model-download key: " NVCF_MODEL_KEY
echo

ngc cloud-function function create \
  9e6b5886-1474-4108-80d6-0cff9ba41fab \
  --org 0491162300748285 \
  --name nva-nemotron-3-5-lightning \
  --helm-chart 0491162300748285/nemotron-voice-agent:0.1.139 \
  --helm-chart-service nemotron-lightning \
  --inference-url /v1/chat/completions \
  --inference-port 8000 \
  --health-uri /v1/health/ready \
  --health-port 8000 \
  --health-protocol HTTP \
  --health-expected-status-code 200 \
  --health-timeout PT10S \
  --api-body-format CUSTOM \
  --function-type DEFAULT \
  --secret "NVIDIA_API_KEY:${NVCF_MODEL_KEY}"

unset NVCF_MODEL_KEY
```

The positional function ID creates a new version of the standalone function.
Omit it only when you intentionally create a different function identity.

## Deploy the Lightning-Only Workload

Apply the checked-in override when you deploy the function version. Without
`-f nvcf_helm/values-lightning-standalone.yaml`, NVCF uses the chart's normal
voice-agent values and deploys the wrong workload.

```bash
ngc cloud-function function deploy create \
  9e6b5886-1474-4108-80d6-0cff9ba41fab:<version-id> \
  --org 0491162300748285 \
  --configuration-file nvcf_helm/values-lightning-standalone.yaml \
  --deployment-specification \
    <backend>:H100:OCI.GPU.H100_1x:1:1:<max-request-concurrency>
```

The deployment uses one H100 and keeps one minimum and one maximum instance.
Record the selected backend, request-concurrency limit, and deployment ID in
the qualification evidence. Do not copy those values from another function
without checking current NVCF capacity and the expected load.

## Invoke the Endpoint

Use the function-specific invocation host and include both NVCF authentication
headers. The `function-id` header is a route identifier, not a credential. The
examples use `nvidia/nemotron-3.5-lightning`, the expected short model alias.
An authorized inference smoke has not yet confirmed that alias. Treat it as
provisional, and update the examples if the deployed NIM advertises a different
served model name.

```bash
export NVCF_FUNCTION_ID=9e6b5886-1474-4108-80d6-0cff9ba41fab
export NVCF_API_KEY=<invocation-capable-api-key>

curl --fail-with-body --silent --show-error \
  "https://${NVCF_FUNCTION_ID}.invocation.api.nvcf.nvidia.com/v1/chat/completions" \
  -H "Authorization: Bearer ${NVCF_API_KEY}" \
  -H "function-id: ${NVCF_FUNCTION_ID}" \
  -H "Content-Type: application/json" \
  --data '{
    "model": "nvidia/nemotron-3.5-lightning",
    "messages": [{"role": "user", "content": "Reply with only: ready"}],
    "temperature": 0,
    "max_tokens": 16,
    "stream": false,
    "chat_template_kwargs": {"enable_thinking": false}
  }'
```

You can use the same endpoint through the OpenAI Python client:

```python
import os

from openai import OpenAI

function_id = os.environ["NVCF_FUNCTION_ID"]
client = OpenAI(
    api_key=os.environ["NVCF_API_KEY"],
    base_url=f"https://{function_id}.invocation.api.nvcf.nvidia.com/v1",
    default_headers={"function-id": function_id},
)

response = client.chat.completions.create(
    model="nvidia/nemotron-3.5-lightning",
    messages=[{"role": "user", "content": "Reply with only: ready"}],
    temperature=0,
    max_tokens=16,
    extra_body={"chat_template_kwargs": {"enable_thinking": False}},
)
print(response.choices[0].message.content)
```

Do not put an invocation key in browser JavaScript. Use a trusted server-side
proxy when a browser application needs the endpoint.

## Verify and Qualify

NVCF `ACTIVE` proves that the platform accepted the deployment and that the
configured health gate passed. It does not prove response quality, tool-call
behavior, concurrency, latency, or sustained availability.

### Current Validation Record

On September 18, 2026, the deployment reported `ACTIVE` and `RUNNING` on
`OCI.GPU.H100_1x`. NVCF reported instance
`sr-da8de044-a83f-407f-b8fb-b7ad57729378-miniservice` and pod
`mini-service-nemotron-voice-agent-llm-lightning-588fcf6c444zxjn`. A process
inspection found both `/opt/nim/start_server.sh` and
`python -m nim_llm.start_server`.

This is control-plane, health, and process evidence only. An attempt to call
the public inference route with the NGC control-plane credential returned
`HTTP 401`, as expected for that credential boundary. No authorized NVCF
invocation key was available during this deployment task. Therefore, the
following checks remain pending:

- Non-streaming and streaming chat completion.
- The served model identifier.
- OpenAI-compatible tool calling and reasoning separation.
- Concurrency, latency, and sustained-availability qualification.

Complete these checks before you describe the endpoint as qualified:

1. Confirm the deployment reports `ACTIVE` and one instance is ready.
2. Send a real non-streaming chat-completion request and require nonempty text.
3. Send a streaming request and require a complete token stream.
4. Send a request with an OpenAI-compatible tool schema and verify the model
   returns a valid tool call when appropriate.
5. Confirm reasoning is absent from user-visible content when thinking is
   disabled.
6. Run the intended concurrency and latency test for the endpoint's expected
   traffic profile.
7. Save the function, version, deployment, image digest, request shape, and
   redacted results in the deployment evidence.

Inspect the control-plane and instance state with these commands:

```bash
ngc cloud-function function info \
  9e6b5886-1474-4108-80d6-0cff9ba41fab:<version-id> \
  --org 0491162300748285 --format_type json

ngc cloud-function function deploy info \
  9e6b5886-1474-4108-80d6-0cff9ba41fab:<version-id> \
  --org 0491162300748285 --format_type json

ngc cloud-function function instance list \
  9e6b5886-1474-4108-80d6-0cff9ba41fab:<version-id> \
  --org 0491162300748285 --format_type json
```

Remove or replace only the standalone function version. Do not use the main
voice-agent function ID in any standalone lifecycle command.
