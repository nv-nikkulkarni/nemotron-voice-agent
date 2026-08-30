# Viking SQA evidence: chart 0.1.110

## Decision

**REJECTED. Do not promote app/UI 2.0.39 or chart 0.1.110.**

The strict repeated live-data matrix completed all 80 real-audio turns with bot audio on every turn, zero silent turns, zero foreign-city leakage, and no browser or WebSocket errors. It failed the required per-turn tool-call gate because two sessions replayed cached weather on every repeat turn instead of calling `get_weather` again.

## Exact artifacts under test

- Source commit: `4e4527a9d0243443275007c388df25cde6c93e2b`
- App image: `nvcr.io/0491162300748285/nemotron-voice-agent:2.0.39`
- App digest: `sha256:b062e494c1a79ad0949f412cac4cda8f3043202d9b70e232b616f22740ba4581`
- UI image: `artifactory.nvidia.com/it-astra-docker-local/nemotron-voice-agent/nemotron-voice-agent-ui:2.0.39-4e4527a9`
- UI digest: `sha256:12b595d3839d027130b82e9cb7f300dadbb4772ec19a06e96e68f18d828ba0a5`
- Helm chart: `0.1.110`; package SHA-256 `fb8dc932b1b38d335cf490212de01dfca633033729580f6f805aceb582bae67e`
- Viking namespace/release: `nva-gfb-toolspec` / `gfb-toolspec`
- Local UI: `http://127.0.0.1:7865`

The raw WAV files and detailed JSON remain outside Git under `tests/sqa/artifacts/viking-0.1.110-expect-tool-8x10/`.

## Strict 8 × 10 matrix

| Metric | Result | Required | Gate |
|---|---:|---:|---|
| Completed turns | 80 / 80 | 80 / 80 | PASS |
| Expected `get_weather` calls | 70 / 80 | 80 / 80 | **FAIL** |
| Bot-audio turns | 80 / 80 | 80 / 80 | PASS |
| Independent-ASR turns | 80 / 80 | 80 / 80 | PASS |
| Independent-ASR grounded turns | 78 / 80 | 80 / 80 | **FAIL** |
| UI-grounded turns | 79 / 80 | 80 / 80 | **FAIL** |
| Silent turns | 0 | 0 | PASS |
| Foreign-city/cross-session leakage | 0 | 0 | PASS |
| Console errors | 0 | 0 | PASS |
| Unexpected WebSocket closures | 0 | 0 | PASS |

Sessions under test: `f6b349c247ff`, `2f9524146b63`, `e42bb50f4e9c`, `220c9c4a3ca6`, `1fe25aeee0de`, `bd24ced8261f`, `1b4779374a47`, and `daf1fe18d013`.

## Findings

1. The 0.5-second Frontend/Backend Agent VAD finalization delay fixed the earlier split-turn defect: every explicit city follow-up reached the expected tool, and the run had no silence or stale foreign-city answers.
2. Sessions `bd24ced8261f` and `1b4779374a47` each skipped `get_weather` on all five “Repeat that weather” turns. Lightning spoke a paraphrase of the immediately preceding structured result. This is cached-result replay, not Redis cross-session leakage.
3. On the Dakar turn, the displayed response and tool result were grounded, but independent ASR heard “the car.” Keep `Dakar` as a listen-first pronunciation candidate; this run alone does not prove a synthesis defect.
4. The Hyderabad input was transcribed by the application as “Heidebarbarb.” WeatherAPI correctly returned not-found for that grounded spelling. This is an input-ASR/model-context issue, not evidence for an output pronunciation dictionary entry.

## Required correction

- Retain each direct backend result once in structured context instead of duplicating it as assistant speech history.
- Withhold a later completion that substantially replays a recorded backend response without a native tool call, and retry Lightning once with an internal contract correction.
- Do not inspect the user request, infer intent, select a domain tool, or construct a function call in Python.
- Fail closed with deterministic speech if the retry also replays the cached result.

Re-run this same 8 × 10 matrix on the next immutable candidate. No staging or production rollout is authorized by this report.
