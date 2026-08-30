# P7 Lightning Tool Qualification — 2026-08-18

## Final outcome

- Forced live controls: **3/3 passed**
- Automatic live tool selection: **90/90 passed**
- Six simultaneous sessions in every automatic batch
- Reasoning setting submitted by the UI: **ON in every accepted session**
- Correct expected tool: **90/90**
- Live provider-derived final answer: **90/90**
- Browser console errors: **0**
- Capture queue pending after each batch: **0**
- Deterministic router: **not implemented**

## Scope

- Environment: Viking P7, namespace `nva-p7`
- Application image: `nvcr.io/0491162300748285/nemotron-voice-agent:2.0.23`
- Application replicas: 5
- Client: freshly built `astra_client` from
  `dev/nikkulkarni/nvcf-deploy-rebased`
- Model: Nemotron 3.5 Lightning
- Reasoning: explicitly enabled through the real UI
- Transport: real Astra UI WebSocket path
- Input: Chromium fake microphone using real WAV speech
- Concurrency: five batches of six simultaneous browsers per tool

No router, prompt policy, or production tool-selection workaround was added.

## Credential deployment

The namespace-scoped `nva-tool-api-keys` Secret contains exactly these keys:

- `WEATHERAPI_KEY`
- `FINNHUB_API_KEY`
- `PERPLEXITY_API_KEY`

Only the Secret name and key selectors are present in Git. Credential values
were supplied through non-echoing stdin and were never written to repository
files, command arguments, test output, or this report.

The Secret was injected into `deployment/p7-nemotron-voice-agent`, recreating
all five application pods. Each replica independently reported all three
credentials present.

Per-pod provider authentication:

| Provider | Pod 1 | Pod 2 | Pod 3 | Pod 4 | Pod 5 |
|---|---:|---:|---:|---:|---:|
| WeatherAPI | 200 | 200 | 200 | 200 | 200 |
| Finnhub | 200 | 200 | 200 | 200 | 200 |
| Perplexity production payload | 200 | 200 | 200 | 200 | 200 |

The first minimal Perplexity probe requested eight output tokens and received
HTTP 400. Repeating the probe with the application handler payload and its
400-token limit returned HTTP 200. This was a probe-payload issue, not an
authentication failure.

## Audio fixtures

Inference-hub TTS generated two additional untracked microphone fixtures:

- “What is NVIDIA current stock price?”
- “What is the latest news about NVIDIA today?”

Inference-hub ASR independently transcribed both fixtures correctly before
they were used in the browser tests. The existing Tokyo weather fixture was
used for `get_weather`.

## Forced live controls

| Tool | Session | Reasoning sent | Tool observed | Live result |
|---|---|---:|---:|---:|
| `get_weather` | `7b9030dc8acd` | true | yes | Tokyo temperature and conditions |
| `get_stock_price` | `5632ba2d5a6e` | true | yes | Live NVIDIA price |
| `web_search` | `2c5b3e424ab7` | true | yes | Current NVIDIA news |

These controls prove the session-config contract, tool schema, Pipecat
registration, streamed tool events, handler dispatch, provider authentication,
assistant answer, TTS response, and UI observation path.

## Automatic live matrix

| Tool | Batch 1 | Batch 2 | Batch 3 | Batch 4 | Batch 5 | Total |
|---|---:|---:|---:|---:|---:|---:|
| `get_weather` | 6/6 | 6/6 | 6/6 | 6/6 | 6/6 | **30/30** |
| `get_stock_price` | 6/6 | 6/6 | 6/6 | 6/6 | 6/6 | **30/30** |
| `web_search` | 6/6 | 6/6 | 6/6 | 6/6 | 6/6 | **30/30** |
| **Combined** | **18/18** | **18/18** | **18/18** | **18/18** | **18/18** | **90/90** |

Every batch reached six simultaneously connected sessions. Each accepted
session had:

- Correct ASR intent
- `reasoning:true` in the actual session-config request
- Expected automatic tool event
- Live provider-derived final assistant answer
- Clean browser console
- Completed consented session capture

## Stale-image result superseded

An earlier run reported automatic weather selection at 29/30. Detailed
session-config evidence later showed that the old local UI image did not send
reasoning ON; application logs showed `enable_thinking:false`.

That result is retained as evidence of reasoning-OFF behavior but is not the
qualification result for the current branch. The current UI was rebuilt, the
test now asserts the exact submitted reasoning value, and the corrected
reasoning-ON weather matrix passed 30/30.

## UI and harness corrections

- The modal reasoning reset now depends on the selected model and its catalog
  default instead of the whole LLM array.
- The Playwright harness waits for the model-default effect, reasserts the
  requested toggle immediately before launch, and fails if the request sends a
  different value.
- `FORCE_TOOL` uses the existing session-config contract for test-only controls.
- `EXPECT_RESULT` checks only the final assistant answer, not the greeting.
- `WAIT_MS` supports slower live-search responses.
- JSON results include safe tool-choice and reasoning evidence plus messages.
- Concurrency measurement is independent of assertion success.

## Remaining deployment boundary

The P7 credential and automatic-tool gates are green. The next step is to
supply the same five NVCF function-version secrets, deploy the exact app, chart,
and UI artifacts to NVCF/Astra staging, then repeat these tests there. NGC
session-capture upload remains a separate permission/resource gate.
