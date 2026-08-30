# Source and Evidence Index

## Contents

1. [Source Hierarchy](#source-hierarchy)
2. [Architecture Ownership](#architecture-ownership)
3. [Deployment Ownership](#deployment-ownership)
4. [Agent Ownership](#agent-ownership)
5. [Concurrency and Capture Ownership](#concurrency-and-capture-ownership)
6. [SQA Ownership](#sqa-ownership)
7. [Historical Evidence](#historical-evidence)
8. [Search Recipes](#search-recipes)

## Source Hierarchy

When sources disagree, use this order:

1. current implementation and rendered chart;
2. current example registry and service/prompt catalogs;
3. current tests defining the intended contract;
4. latest exact-artifact SQA report;
5. current public documentation;
6. historical reports and archived plans;
7. commit messages as supporting rationale.

Live deployment state must still be queried. Source code cannot prove which artifact is
serving.

## Architecture Ownership

| Topic | Authoritative Paths |
|---|---|
| root examples and defaults | `examples_registry.yaml` |
| FastAPI/API/WS routing | `src/server.py` |
| dedicated UI | `astra_client/` |
| nginx UI/proxy | `docker/Dockerfile.nvcf-ui`, `docker/nvcf-ui-entrypoint.sh` |
| historical detailed deployment snapshot and manual source | `docs/current-deployed-pipeline-architecture.md` |
| deployment diagrams | `docs/deployment-architecture.md` |
| user manual | `docs/Nemotron_Voice_Agent_Current_Architecture_Manual.docx` |
| manual source/assets | `docs/architecture-manual/` |
| generic domain guide | `docs/how-to/configure-frontend-backend-domains.md` |
| TTS behavior | `docs/how-to/configure-tts.md` |

Use this skill for durable operational knowledge. Use dated reports for exact candidate
outcomes.

## Deployment Ownership

| Topic | Authoritative Paths |
|---|---|
| chart version and app version | `nvcf_helm/Chart.yaml` |
| chart defaults and model images | `nvcf_helm/values.yaml` |
| Viking overlay | `nvcf_helm/values-viking.yaml` |
| isolated Astra `-2` values | `nemotron-voice-agent-2-values.yaml` |
| app workload and secret injection | `nvcf_helm/templates/deployment-app.yaml` |
| direct app entry Service | `nvcf_helm/templates/service-app.yaml` |
| curated NVCF example registry | `nvcf_helm/templates/configmap.yaml` |
| model deployments | `nvcf_helm/templates/deployment-*.yaml` |
| model services | `nvcf_helm/templates/service-*.yaml` |
| prewarmer | `nvcf_helm/templates/deployment-prewarmer.yaml` |

Render Helm before treating values as effective manifests.

## Agent Ownership

| Topic | Authoritative Paths |
|---|---|
| shared Frontend/Backend pipeline | `src/examples/frontend_backend_agent/pipeline.py` |
| Talker/Thinker prompts | `src/examples/frontend_backend_agent/prompts.yaml` |
| model and TTS catalogs | `src/examples/frontend_backend_agent/services.*.yaml` |
| domain allowlist and contract | `src/examples/frontend_backend_agent/src/domain.py` |
| Talker liveness/repeat guards | `src/examples/frontend_backend_agent/src/reliable_talker.py` |
| call/cancel handlers | `src/examples/frontend_backend_agent/src/tool_handlers.py` |
| barge-in state | `src/examples/frontend_backend_agent/src/barge_in.py` |
| internal ToolSpec | `src/examples/frontend_backend_agent/src/tools.py` |
| generic domain | `src/examples/frontend_backend_agent/generic/` |
| airline domain | `src/examples/frontend_backend_agent/airline/` |
| Omni subagents | `src/examples/omni_assistant_subagents/` |
| shared turn detection | `src/examples/shared/pipeline_utils.py` |
| pronunciation registry | `src/examples/shared/pronunciation_registry.yaml` |
| IPA loader | `src/utils.py` |

## Concurrency and Capture Ownership

| Topic | Authoritative Paths |
|---|---|
| Redis session/config client | `src/session_bus/client.py` |
| Redis media streams | `src/session_bus/media.py` |
| session-store abstraction | `src/session_store/` |
| capture state machine | `src/session_capture/` |
| browser coordinator | `astra_client/src/demo/captureCoordinator.ts` |
| capture reporter | `astra_client/src/demo/SessionCaptureReporter.tsx` |
| teardown acknowledgement | `astra_client/src/hooks/useSessionLifecycle.tsx` |
| transcript deduplication | `astra_client/src/demo/transcriptRendering.ts` |
| webcam upload/capture API | `src/server.py` |
| webcam worker/controller | `src/examples/omni_assistant_subagents/subagents/webcam/`, `src/examples/omni_assistant_subagents/subagents/transport/webcam_controller.py` |

## SQA Ownership

| Topic | Authoritative Paths |
|---|---|
| harness overview | `tests/sqa/README.md` |
| broad plan | `tests/sqa/SQA_TEST_PLAN.md` |
| comprehensive suite | `tests/sqa/comprehensive.mjs` |
| repeated-tool gate | `tests/sqa/repeated_expect_tool_matrix.mjs` |
| corner and safety suite | `tests/sqa/prod_remediation_corner_cases.mjs` |
| robustness/barge-in/reconnect | `tests/sqa/robustness.mjs` |
| webcam concurrency | `tests/sqa/webcam_baseline_concurrency.mjs` |
| capture lifecycle | `tests/sqa/capture_lifecycle_matrix.mjs` |
| exact pronunciation | `tests/sqa/tts_direct_pronunciation_probe.py` |
| pronunciation candidates | `tests/sqa/TTS_PRONUNCIATION_CANDIDATES.md` |
| shared harness | `tests/sqa/lib/harness.mjs`, `tests/sqa/lib/audio.mjs`, `tests/sqa/lib/acoustics.mjs` |
| reports policy | `tests/sqa/reports/README.md` |

Raw run artifacts are intentionally ignored.

## Historical Evidence

The retained report sequence is:

- `tests/sqa/reports/PRODUCTION_SQA_0.1.103_2026-08-25.md`
- `tests/sqa/reports/VIKING_SQA_0.1.110_2026-08-26.md`
- `tests/sqa/reports/VIKING_SQA_0.1.111_2026-08-26.md`
- `tests/sqa/reports/VIKING_SQA_0.1.111_CORNER_CASES_2026-08-26.md`
- `tests/sqa/reports/VIKING_SQA_0.1.112_CORNER_CASES_2026-08-26.md`
- `tests/sqa/reports/VIKING_SQA_0.1.113_CORNER_CASES_2026-08-26.md`
- `tests/sqa/reports/VIKING_SQA_0.1.114_CORNER_CASES_2026-08-26.md`

Older local, Astra/NVCF, tool, and staging reports are under
`tests/sqa/reports/archive/2026-08/`.

Fulfilled design plans were consolidated into this skill and removed from the active tree.
Their exact pre-consolidation text remains recoverable from Git at commit `70fe69ab` under
`docs/archive/2026-08/`.

Key implementation commits on the production source branch include:

| Commit | Durable Meaning |
|---|---|
| `71fc72a6` | scalable assistants and replica-safe session state |
| `c3148e1b` | dedicated production voice UI |
| `831b4794` | Viking, NVCF, and Astra topology |
| `e334d23b` | voice, concurrency, and capture SQA |
| `48d9efb0` | replica capture and deployment metadata |
| `8fd90d13` | configurable Generic Frontend/Backend experience |
| `95ea574a` | declarative ToolSpec agent |
| `e19ae7ad` | silent Lightning recovery |
| `b68448f8` | webcam visual baseline |
| `3a424272` | acknowledged capture reporting |
| `5e4385ca` | grounded direct results and pronunciation registry |
| `dc18b351` | repeat subject preservation |
| `4b7e2b6f` | clean barge-in and deterministic fillers |

Commit IDs are historical anchors. Verify the current branch because later squashes or
rebases can change IDs.

## Search Recipes

Use `rg` from the repository root.

```bash
# Find a session-aware path or event
rg -n "session_id|stream_id|captureFlushed|talker_silent_retry" src astra_client tests

# Find every model/image/version owner
rg -n "appVersion|appImage|llmLightningImage|llmSuperImage|ttsImage|chatterboxImage" nvcf_helm

# Find secret names without printing values
rg -n "NVIDIA_API_KEY|NGC_API_KEY|PERPLEXITY_API_KEY|WEATHERAPI_KEY|FINNHUB_API_KEY" \
  nvcf_helm src astra_client

# Find SQA promotion decisions
rg -n "^## Decision|REJECTED|Do not promote|remaining gates" tests/sqa/reports

# Find prompt and mode-selection rules
rg -n "DIRECT|DELEGATE|CANCEL|call_backend|cancel_backend" \
  src/examples/frontend_backend_agent
```

Do not run broad commands that print live secret objects. Prefer key names, pod environment
references, and redacted control-plane output.
