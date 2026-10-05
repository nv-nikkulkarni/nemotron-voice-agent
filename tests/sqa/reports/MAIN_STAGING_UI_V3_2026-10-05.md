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

## Later UI releases the same day (supersede the identity above)

Main staging was later updated, UI-only, in these steps. The backend function and deployment never changed.

| Tag | Source | AMD64 OCI index | Adds |
| --- | --- | --- | --- |
| `dev-b5225c3-20261005-arch-button` | `b5225c3` | `sha256:44e244de40210ffd78775b3145a341a85ca4fc9b1925ebb6212dfc5972df63ae` | Bundled Generic and Omni architecture diagrams; **Show architecture** button; spoken requests open the same panel |
| `dev-84984e5-20261005-studio-refresh` | `84984e5` | `sha256:d005f0f02611d2983858695f5414cf019d9316e81a68a202b1651776432814c3` | Backend-history text below the slider; pronunciation rows-per-page and Previous/Next paging; Voice and Prompt studio restyle; diagram fitted to its panel |
| `dev-99b5702-20261005-studio-refresh` | `99b5702` | `sha256:4edae83fa5289476f86afdb05d4f5b353c69183f829918e122ff9fd813929859` | Tools page restyled to match; build timestamp `2026-10-05T11:06:54Z`; Argo Healthy/Synced at `b737da4ae0a8` |

| `dev-da8ee12-20261005-eventlog-tab` (serving) | `da8ee12` | `sha256:f0d9abfebeba7e67029e8bbcb2f378a5ff9915c23fad943050b29b596d0afef4` | Collapsed event log is a small tab clear of the timer and session chip; one-time "Click the latency button to expand" hint; build timestamp `2026-10-05T12:14:33Z`; Argo Healthy/Synced at `008897b6dc93` |

Verified on `dev-99b5702`: `architecture-image` (button and spoken request in both examples), `voice-studio`,
`pre-session-configuration`, and a browser probe that pages through all 214 pronunciation rules and checks the history text sits below the slider.
The comprehensive A–D, `llm-settings`, `functional`, and `feature-effect` results above were taken on earlier builds and were not re-run on this one.
Rollback tags: `dev-b5225c3-…`, `dev-9c89334-20261005-zeroshot-default`, and the earlier tags listed above.

On `dev-da8ee12`, a browser probe confirmed the hint shows under the latency chip, disappears when the chip is clicked
(which opens the breakdown), and the collapsed tab does not intersect the timer or session chip. The suites above were not re-run on this build.
