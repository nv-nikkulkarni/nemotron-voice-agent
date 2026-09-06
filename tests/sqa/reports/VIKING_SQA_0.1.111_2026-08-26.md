# Viking SQA evidence: chart 0.1.111

## Decision

**The strict repeated live-data gate passed. The candidate is not yet cleared
for staging or production because the remaining Viking gates are still pending.**

The 8-session by 10-turn real-audio matrix completed all 80 turns. Every turn
called `get_weather`, produced recorded bot audio, passed independent-ASR and UI
grounding, and remained isolated from the other seven sessions.

## Exact artifacts under test

- Source commit: `13eca1ec0c6c6998563f599f0e48ce6454e55484`
- GitHub branch: `dev/nikkulkarni/prod-sqa-remediation-0.1.103`
- App image: `nvcr.io/0491162300748285/nemotron-voice-agent:2.0.40`
- App digest: `sha256:c433fd5ca01cc3ed0cee4eb966709951c365e1e5014d382b22c49a56b0cbd3d2`
- UI image: `artifactory.nvidia.com/it-astra-docker-local/nemotron-voice-agent/nemotron-voice-agent-ui:2.0.40-13eca1ec`
- UI digest: `sha256:06c2f65ab0c7c01ff7a57b47583071d8d2ef9aad4e976edcfca8d8dc1a30568a`
- Helm chart: `0.1.111`; package SHA-256
  `c94c4439cf910a700b3aca82b7797cfb5e4bc044d96bf3134d93bdb0ac89ccc9`
- NGC chart status: `UPLOAD_COMPLETE`
- Viking namespace/release/revision: `nva-gfb-toolspec` / `gfb-toolspec` / `14`
- Viking replicas: `5/5` ready, all running the recorded app digest
- Local UI: `http://127.0.0.1:7865`; deployed timestamp
  `2026-08-26T03:11:09Z`

No inference NIM or TTS pod was redeployed for this candidate. ASR, Lightning,
Super, Omni, Magpie, and Chatterbox retained their pre-upgrade pod identities.

## Strict 8 × 10 matrix

| Metric | Result | Required | Gate |
|---|---:|---:|---|
| Completed turns | 80 / 80 | 80 / 80 | PASS |
| Expected `get_weather` calls | 80 / 80 | 80 / 80 | PASS |
| Bot-audio turns | 80 / 80 | 80 / 80 | PASS |
| Independent-ASR turns | 80 / 80 | 80 / 80 | PASS |
| Independent-ASR grounded turns | 80 / 80 | 80 / 80 | PASS |
| UI-grounded turns | 80 / 80 | 80 / 80 | PASS |
| Silent turns | 0 | 0 | PASS |
| Foreign-city/cross-session leakage | 0 | 0 | PASS |
| Failed turns | 0 | 0 | PASS |
| Console errors | 0 | 0 | PASS |
| Unexpected WebSocket closures | 0 | 0 | PASS |

Sessions under test: `c3cbd38632ab`, `b4d3c2a848cd`, `fafba93b4927`,
`bf24bf830d32`, `588ebe3ca5f9`, `80b8c5336325`, `1ae75cc9f73c`, and
`2573380f3ab3`.

## Evidence boundary

The raw input and bot WAV files and detailed JSON remain intentionally outside
Git under `tests/sqa/artifacts/viking-0.1.111-expect-tool-8x10/`. The detailed
JSON summary SHA-256 is
`7464984fbf634377e4992114f15adae4c4e7348c1b81937b54ef72a76d8cfd17`.

This live run emitted no `talker_cached_replay_retry`, `talker_silent_retry`, or
`talker_terminal_fallback` events: Lightning selected the native backend call on
all 80 turns, so the live fail-closed retry path was not needed. Unit tests cover
the one-retry and terminal-fallback behavior.

## Findings and remaining gates

1. The `0.1.110` cached-result regression did not recur. All five repeat turns
   in every session invoked `get_weather`, including Dakar and Hyderabad.
2. Recorded Magpie speech passed independent ASR grounding for every city.
3. There were no silent turns or cross-session city substitutions.
4. This report clears only the repeated `EXPECT_TOOL` gate. Full A–D real-audio
   qualification, corner cases and guardrails, barge-in, planner-stall and
   credential failures, four-session webcam baselines, the capture matrix,
   reconnect, and the TTS exact-word listening pass remain required.

Do not create NVCF/Astra staging artifacts and do not promote to production on
this report alone.
