# Main Astra Staging UI v3 — 2026-10-05

Scope: UI-only release to main Astra staging (`nemotron-voice-agent-deploy`, `stg`). No NVCF
function, version, or deployment changed. Production Astra and production NVCF are untouched.

## Release identity

| Item | Value |
| --- | --- |
| Source | `9c893342737f7bffd33e994aba314df9796a1f2e` (tests: `8ed9a92`) |
| UI image | `artifactory.nvidia.com/it-astra-docker-local/nemotron-voice-agent/nemotron-voice-agent-ui:dev-9c89334-20261005-zeroshot-default` |
| UI AMD64 OCI index | `sha256:91c651448dd75edd198962e50fa29f93fd3da7cd5af39f0cf77284e57386b447` |
| Build timestamp | `2026-10-05T07:28:49Z` |
| Argo | Healthy / Synced, revision `93137691f818` (observed 07:32 UTC) |
| Backend | unchanged: function `fa20412a-4da3-45a1-8057-a076039580e2`, version `dca45c20-c569-4b86-be50-adde5c3c99a1` |

Earlier immutable UI tags from this change, kept for rollback: `dev-a989e9c-20261005-eventlog-prebuffer`
(`sha256:062118fae81c83b2dd3e73f44e10c6ce7280e9c8a03138a5444e482a18e261c3`), `dev-c9f1cd5-20261005-eventlog-prebuffer`
(`sha256:206f484f3390f973edc03ff49b7dd4576a625c911b45082aba7bc5ee6c355227`), and the pre-change
`dev-5e7ec42-20261004-backend-history`. Rollback changes only the tag and `UI_BUILD_TIMESTAMP` in the
staging values.

## Changes

- Bot audio is prebuffered (~240 ms, 350 ms cap) before playback to avoid player underruns at the start of speech.
- Collapsible event log (tool calls, barge-in, turns) with a 25/50/100 entry cap.
- LLM settings moved beside the microphone button; each parameter has a slider and a number box.
- Consent dialog no longer offers browser-side recording; portaled dialogs share the app's font, button, and surface styling.
- Magpie Zero-shot is the preferred speech engine when an example offers it. An explicit user choice and examples without it keep the registry default.

## Results (all against the main staging URL)

| Run | Build | Result |
| --- | --- | --- |
| Comprehensive A–D | v2 | PASS all phases (C warns: Lightning did not echo the prompt marker) |
| Comprehensive A–D | v3 | A FAIL (turn 13 asked for a city instead of calling `get_weather`); B, C, D PASS |
| Comprehensive phase A, rerun x2 | v3 | PASS, PASS (turn 13 calls `get_weather`) |
| `llm-settings` | v3 | PASS 10/10 |
| `functional` | v3 | 43/44, one soft landing-page visual diff |
| `voice-studio` | v3 | PASS 9/9 |
| `feature-effect` (new) | v3 | PASS: persona changes the spoken reply; slider set, applied, and read back from the server; zero-shot with a reference sample sends the sample and the bot speaks |
| Browser probe | v2, v3 | one audio-worklet restart in the welcome versus two on the previous UI; fresh profile selects `magpie-zeroshot-tts` |

## Open items

- Phase A turn 13 failed once in four runs: the follow-up "weather again" sometimes makes Lightning ask for the city. Intermittent backend behavior; not caused by this UI release.
- `demo-feedback` fails at turn 8 ("Tell me about Sales Cloud" answered with the capability list); turns 9–10, the pause check, and the reference-voice step did not run. Cause unresolved.
- Slider values reach the server, but an effect on model output is not measured. The voice clone was not compared with the reference sample.
- Event-log tool lines lack names for frontend calls because pipecat's RTVI function-call report level defaults to `NONE`; the weather line lacks the city because the `tool-call` server message carries only the tool name. Fixing both needs a backend release.
- The choppy-start fix is verified by player-restart counts only; a human listen is still required.
- Not qualified for production promotion.
