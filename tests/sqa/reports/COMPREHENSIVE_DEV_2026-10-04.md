# Comprehensive Dev Check

**Date:** October 04, 2026 (UTC)

**Result:** The complete four-phase run fails overall. Generic misses one
required native web-search call. Omni, UI hard checks, and concurrency smoke
checks pass, with additional prompt-adherence and input-fidelity findings.

## Target and Test Identity

The suite tests the existing UI at `http://localhost:7880` without redeployment.
The run lasts 18 minutes, 30 seconds, from `2026-10-04T16:17:52.681Z` to
`2026-10-04T16:36:22.659Z`, and exits with code `1`.
The tested script matches the committed fixtures:

| Item | Identity |
| --- | --- |
| Run | `20261004T161752Z-comprehensive-all` |
| Harness fixture commit | `98432828c09385f8e68c2f6ba9ee426002330fda` |
| Harness parent source | `36e0f6401cb61afbde3a22a28f900dbfae40ff2d` |
| Comprehensive script SHA-256 | `57f35b217d9884de32137f5dbc502fef6b7fa5a66b70d918b4ad65015c5f51be` |
| Serving UI source | `17f3e71d32c36cc7c50e1ec7a2fade8bdbea3617` |
| UI image | `nemotron-voice-agent-ui:dev-17f3e71-20261004-omni-prompts` |
| UI OCI index/image ID | `sha256:92408f92e1954f2673b66599334435d46bbd4ea631fd1097b444f85ab8f2da7e` |
| Serving backend source | `9b11f4d7a8064724f6b69f587d357ef490352404` |
| Backend OCI index | `sha256:712c0d957d58c5a0888062902ae15b90dc69edfe116ffa7ed83d48d0f8277366` |
| Helm release | `nva-dev`, namespace `nva-dev`, revision `23` |
| Chart | `0.1.141-dev.20261004.22` |
| Unchanged chart package SHA-256 | `0f92cbcac894422d3e660b152ef1f2d02da291a15302527f48a4e7802faf13dc` |

The [Omni Prompt Labels report](OMNI_PROMPT_LABELS_DEV_2026-10-04.md) and
[LLM Settings report](LLM_SETTINGS_DEV_2026-10-04.md) retain the earlier artifact
build and deployment evidence. This task changes harness fixtures and
documentation; application artifacts remain unchanged.

## Phase Results

All 52 scripted turns produce audible responses and application user
transcripts. Transcript presence does not establish recognition fidelity.
There are zero unexpected browser console errors, bad HTTP responses,
WebSocket closures, or guarded wait timeouts across all four phases.
The raw phase outcomes are:

| Phase | Raw Result | Evidence |
| --- | --- | --- |
| A: Generic Lightning | Fail | 17 audible turns; 9 of 10 required native tool calls; loaded Generic architecture image. Session `d713e125343e`. |
| B: Omni | Pass | 13 voice turns, uploaded-image description, and controlled webcam description; all 15 audible. Session `b4b9415b0a5c`. |
| C: UI | Pass with warning | 12 hard checks pass and 4 turns are audible; edited prompt is submitted, but the model does not echo its marker. |
| D: Mixed concurrency | Pass within smoke scope | Eight connected sessions, 16 audible turns, eight unique IDs, zero literal cross-session code-word matches, and zero hangs/errors; 56.7 seconds. |

Generic records these native calls:

| Tool | Calls / Expected Attempts |
| --- | --- |
| `get_weather` | 3 / 3 |
| `get_stock_price` | 2 / 2 |
| `web_search` | 0 / 1 |
| `calculate_bmi` | 1 / 1 |
| `generate_random_number` | 1 / 1 |
| `get_current_time` | 1 / 1 |
| `show_architecture` | 1 / 1 |

Omni describes the red square on a blue background after image upload.
Six JPEG webcam posts return HTTP `200`; the camera reply describes the same
scene and its `BANANA 42` text.

## Findings and Adjudication

Generic turn 5 requests the latest artificial-intelligence news. Independent
recognition of the 4.65-second input WAV retains the full authored request.
The application transcript and runtime speech-to-text (STT) final retain only
“Search the web.”
Runtime logs nevertheless show Talker invoking `call_backend` with the full
latest-news request. The native `web_search` tool does not execute, and the
spoken reply asks for a topic.

The raw failure remains. These observations do not establish the cause of
STT truncation or the missing domain call. They do not demonstrate premature
end-of-utterance detection, absent Talker delegation, or a web API authentication
failure. Evidence includes `A5-input-independent-ASR.json`,
`A5-runtime-excerpt.log`, and sanitized session logs.

Phase C submits the edited Generic prompt under
`generic-frontend-backend-agent_edited`. The model does not append the requested
`PINEAPPLE` marker. The harness records this behavioral warning separately from
successful prompt editing, payload delivery, restart, and inspector checks.

Separate Phase D input review identifies two fidelity mismatches:

| Session | Independently Recognized Input | Application Transcript | Bot Reply in DOM |
| --- | --- | --- | --- |
| `9af301f2eeb5` | `Charlie nine` in the complete 4.9-second query | `Please repeat this exact code word to me: carly nine.` | `carly nine` |
| `ab0c3f4060f2` | `Echo five` in the complete 5.55-second query | `Go, 5.` | `Five.` |

These findings do not change the raw D outcome because its existing oracle
checks audibility, connection, identity, and literal other-session codes.
Its pass does not clear authored-input fidelity. The `Echo five` response has
detected audio onset and DOM text, but empty independent bot recognition. Another
greeting case has inconsistent independent input recognition and remains inconclusive.
The precise failure mechanisms require further investigation.

## Capture and Final Health

NGC metadata readback confirms both consented session versions with
`UPLOAD_COMPLETE` and one archive each:

| Session | Archive Size | NGC SHA-256, Base64 |
| --- | --- | --- |
| Omni `b4b9415b0a5c` | 3,112,279 bytes | `7FgEjYHJgDKgUtnAMyC9x+n6VdwG0YO+O3PaX3tDDSw=` |
| Generic C6 `162ab692acc6` | 296,682 bytes | `zI07YvhXRSkCm8iiGEFeIilryUfpccy5Vz8iDg5BAMc=` |

This verifies session/version and archive metadata. It does not inspect archive
contents or qualify the full capture lifecycle matrix.

At `2026-10-04T16:40:04.154265+00:00`, all 15 dev pods remain Ready.
Every pod UID, runtime image ID, and restart count is unchanged; restarts are
zero. The UI remains running with the same image ID. Health returns `ok`;
capture is upload-ready with zero pending or failed sessions. There are zero
new Kubernetes Warning events. An initial comparison mixed configured image
tags with runtime digests; the corrected comparison uses runtime identities.
The initial mismatch evidence is retained.

## Repository Validation and Qualification Boundary

Fresh repository checks are not fully green:

| Check | Result |
| --- | --- |
| `uv sync --dev` | Pass |
| Full pytest | 795 passed, 3 skipped, 55 subtests passed, and 3 known baseline failures |
| Full Ruff lint | Fail: 480 findings |
| Full Ruff formatting | Fail: 20 files require formatting |
| Standard client dependency install, lint, and build | Pass |
| Astra dependency install and production build | Pass |
| Full Astra lint | Fail: 24 errors and 2 warnings, matching the known baseline |
| Helm lint | Pass |
| Comprehensive fixture syntax and scoped pre-commit | Pass |
| Changed documentation hooks, relative links/anchors, and diff check | Pass |

The three skipped tests are opt-in OpenAI Realtime SDK compatibility checks,
enabled with `RUN_REALTIME_COMPAT=1`. The pytest failures cover a literal Helm
artifact-pin assertion and missing version metadata in existing dirty skill variants. No Python or application
files change in this task. Repository-wide findings and user-owned skill
metadata remain outside these fixture/documentation changes.

This run does not establish every release gate, the repeated-tool matrix,
robustness under network failure, human pronunciation acceptance, sustained
production concurrency, or all supported hardware profiles. No NVCF function,
Astra deployment, or production promotion changes. The overall comprehensive
failure and additional fidelity findings remain open.

Raw local evidence is under `/tmp/nva-comprehensive-20261004T161041Z`, including
phase reports, WAV files, independent input recognition, NGC metadata, repository
logs, sanitized session logs, and preflight/postflight snapshots.
The 137-file `evidence-manifest.json` has SHA-256
`f85c51bd804f77e59dbf9ab9354b3e5c7156774c7c263c6769b70defe75ab6f3`.
Generated evidence and credentials are not committed.
