# Comprehensive Astra Staging SQA

**Date:** October 05, 2026 (Asia/Kolkata)

**Status:** Both full A/B/C/D invocations are raw **FAIL**. The initial run
fails image upload and later browser networking. On the corrected backend, Omni
media, UI, and concurrency pass; Generic never starts because its initial page
navigation times out. The separate Generic retry is raw **PASS**, but
supplemental semantic review fails its first stock answer. Full qualification
and final production audit remain incomplete.

## Initial Run Identity

| Item | Value |
| --- | --- |
| Run ID | `20261004T203243Z-astra-staging-comprehensive-all` |
| Target | `https://nemotron-voice-agent-2-deploy-backend.stg.astra.nvidia.com` |
| Serving artifact source | `5e7ec4298c22c950e072e576ccf64a0b37debda7` |
| NVCF function | `fa20412a-4da3-45a1-8057-a076039580e2` |
| NVCF version | `215cc350-e57d-4a07-bf24-073e27d40aa6` |
| NVCF deployment | `56b341d5-3a9e-44e1-92a3-ba4b0342adbd` |
| Placement | `nvcf-dgxc-k8s-oci-nrt-prd6-1`, `OCI.GPU.H200_8x` |
| Astra revision | `46d5fb7e3cc242772d6c8d8dfd874eec5d5212e8` |
| Test source commit | `cb01bb42109808371de4dfd5ca98b898bc1a9f2d` |
| Loaded comprehensive fixture SHA-256 | `57f35b217d9884de32137f5dbc502fef6b7fa5a66b70d918b4ad65015c5f51be` |
| Started / finished (UTC) | `2026-10-04T20:32:44.186Z` / `2026-10-04T20:51:53.984Z` |

The requested command is `comprehensive all`. App, UI, and chart identities
remain fixed during this initial run and are separate from this report's commit.
See the [staging deployment report](BACKEND_HISTORY_STAGING_2026-10-05.md) for
artifact digests, routing, H200 readiness, and protected production.

## Initial Outcomes

| Phase | Scripted scope | Raw outcome and observed boundary |
| --- | --- | --- |
| A | 17 Generic turns, 7 server tools, repeated live-data requests, loaded architecture image. | **PASS**: all 17 inputs received and replies audible; 10/10 expected native calls across all 7 tools. |
| B | 13 Omni voice turns, uploaded image, controlled webcam frames. | **FAIL**: image upload exceeds 20 seconds, yields no HTTP status, and records `net::ERR_TIMED_OUT`. All 13 voice turns and the webcam description pass; uploaded-image understanding is unqualified. |
| C | Example switch, prompts/configuration, lifecycle/restart, consented capture. | **FAIL**: all 12 hard UI checks pass, but console `ERR_NETWORK_CHANGED` fails the phase. Prompt-marker behavior remains a separate warning. |
| D | 8 mixed simultaneous sessions, 2 spoken turns each, distinct IDs, code-word isolation. | **FAIL**: all 8 initial page navigations fail with `ERR_NETWORK_CHANGED`; zero sessions connect or speak. Concurrency and isolation are unqualified. |

Phase A observes `get_weather` 3 times, `get_stock_price` twice, and each of
`web_search`, `calculate_bmi`, `generate_random_number`, `get_current_time`, and
`show_architecture` once. Its browser console, bad HTTP, and WebSocket signal
counts are zero. Session IDs are Generic `e562ce3edc8b`, Omni `82ff8cac78de`,
and consented C6 `10742e34b911`.

The initial run records 36/36 received inputs and audible replies across A/B/C;
D produces no spoken records. Audibility alone does not establish semantic
acceptance. B and C each record one console error and no bad HTTP or WebSocket
signals. A later successful HTTP probe does not negate these browser failures or
establish their cause.

C confirms edited-prompt payload delivery independently, while the model does
not echo the marker. That behavior is a warning under the existing contract; the
console error is the hard failure. D's zero `errs` aggregate does not clear its
eight recorded navigation exceptions or raw connection failures.

## Image Oracle Correction and Backend Rerun

The initial image-description regex matches `red` inside `shared`, allowing an
acknowledgement to appear as visual understanding. Raw B still fails on upload
and browser errors. Its uploaded-image description cannot be counted as accepted
merely because the old description flag is true.

The corrected oracle requires whole-word **red** and **square**, in either
order, or **BANANA 42** / **banana forty two** from the controlled fixture.
Image upload must separately return HTTP `200`. Acknowledgements fail this
feature check. Syntax and 4 negative / 3 positive oracle probes pass in the
installed SQA container. The corrected test commit is
`3558a72f3e5dde2f552bee708a144f66a29d7521`; loaded fixture SHA-256 is
`fa773606047b2ce16a2ea6feb46af7ad1517321086ddef8758e19c20d8bff734`, as recorded
in both corrected run metadata files.

The separate Generic dynamic-filler fix has source
`84b0a8c212147fd46d658f2e01b4c555b08b641f`, with 213 focused tests and 45
subtests passed, plus scoped Ruff/format checks. It wires the existing
query-grounded Talker filler policy and removes the fixed replacement phrase.
Its immutable app is published. An attempted in-place update does not change the
deployed old tag or timestamp. The replacement isolated staging version
`dca45c20-c569-4b86-be50-adde5c3c99a1`, deployment
`010c94c1-6e27-4b36-a0f7-44b006a8826d`, becomes `ACTIVE` at
`2026-10-04T21:04:58.912948Z`, with explicit-version HTTP health and
Generic/Omni session readiness passing. The old isolated H200 version is
undeployed at `21:06Z`, with its definition retained for rollback. UI, chart,
and H200 shape are retained; no model-instance preservation claim is made.
Magpie and zero-shot previews initially return `502`, then both return HTTP
`200` at `2026-10-04T21:33:33.740306Z`. Corrected ALL begins after these real
synthesis gates pass; cold-start failures remain in the evidence history.

The separate focused dynamic-filler smoke `20261004T210938Z`, session
`c9842eb0bef7`, is raw **FAIL**. Weather and stock call their real tools and
produce distinct query-grounded fillers. BMI does not execute its service:
independent input recognition contains both 70 kg and 1.75 m, but the
application transcript omits the height. That input discrepancy does not
establish a filler-policy regression or its upstream cause. Neither this smoke
nor the initial network failures are a corrected full-suite result.

The corrected full run is complete, raw **FAIL**, with separate identities:

| Item | Value |
| --- | --- |
| Run ID | `20261004T213348Z-astra-staging-dynamic-filler-all` |
| Serving app source | `84b0a8c212147fd46d658f2e01b4c555b08b641f` |
| Retained UI source | `5e7ec4298c22c950e072e576ccf64a0b37debda7` |
| NVCF version / deployment | `dca45c20-c569-4b86-be50-adde5c3c99a1` / `010c94c1-6e27-4b36-a0f7-44b006a8826d` |
| Test source | `3558a72f3e5dde2f552bee708a144f66a29d7521` |
| Loaded fixture SHA-256 | `fa773606047b2ce16a2ea6feb46af7ad1517321086ddef8758e19c20d8bff734` |
| Last verified Astra revision | `46d5fb7e3cc242772d6c8d8dfd874eec5d5212e8`; renewed Fusion audit pending |
| Started / finished (UTC) | `2026-10-04T21:33:49.275Z` / `2026-10-04T21:47:31.378Z` |

The target and function are unchanged from the initial run. New raw evidence is
under `/tmp/nva-comprehensive-astra-staging-dynamic-filler-20261005`;
`run-metadata.json` records loaded fixture and artifact identities. No source or
deployment changes occur during this invocation.

| Phase | Completed corrected outcome |
| --- | --- |
| A | **FAIL** before any session/tool attempt: initial `page.goto` waits 30 seconds for `domcontentloaded`, then times out. |
| B | **PASS**, 15/15 received inputs and audible replies: all 13 voice checks, uploaded image HTTP `200` with red-square/blue-background description, and webcam description of the fixture after 6 JPEG frames (last HTTP `200`). |
| C | **PASS**, all 12 hard UI checks; prompt-marker behavior remains a warning, with submitted payload verified separately. |
| D | **PASS**, 8/8 connected/responded, 8 unique IDs, 16/16 received inputs and audible replies, and no literal other-session code words; 61.2 seconds. |

Across B/C/D, all 35 inputs receive audible replies. Recorded console, bad HTTP,
and WebSocket signals are zero, including every D browser. The successful phases
do not rewrite A's raw navigation failure or establish an overall full-suite
pass.

Supplemental D code review normalizes word numerals: 8/8 own codes match the
application reply text, and 6/8 match independent bot ASR. Independent
recognition yields “Echo” and “Golf” without the expected 5 and 1. Other-session
code matches are zero in both text and independent recognition. This does not
establish complete acoustic code-word fidelity or whether the missing numerals
come from speech output or recognition; listening/capture diagnosis is pending.

## Standalone Generic Retry and Semantic Review

Retry `20261004T214752Z-astra-staging-dynamic-filler-A-retry` completes raw
**PASS**, from `2026-10-04T21:47:53.167Z` to `21:54:55.311Z`, session
`980f3ebde2f6`. It uses the same backend/version and fixture, without
overlapping ALL's concurrency phase. Both metadata `phase_selection` and final
report `phaseSelection` are `A`; inherited launcher stdout's ALL label is stale.

All 17 inputs receive audible replies. All 7 expected tools execute, with 10/10
native calls: weather 3, stock 2, and each remaining tool once. Browser signals,
hangs, and hard failures are zero. The retry retains its own raw report and does
not rewrite the failed full invocation.

Supplemental semantic qualification is **FAIL** for stock turn 4. The raw
`answered: true` flag accepts “price” in generated progress speech, while the
final application reply gives a company overview without a numeric quote.
Independent bot recognition captures the filler rather than a price. Repeat
stock turn 12 contains a numeric `233.95 USD` quote in application text; it does
not repair turn 4. A native tool call and audible reply alone do not establish
that the requested answer is delivered. The raw A pass is preserved, without
claiming that all 17 answers are semantically accepted.

After the run, test-only commit `17b2743de27093c64a1b997a8fb0662999ce04e4`
strengthens stock matching to require a numeric USD/dollars/`$` quote or a
“trading at” / “priced at” number. Syntax and 4 negative / 3 positive probes
pass; fixture SHA-256 is
`9300b12ad8b83efa2c5e1a2c8fb0279a8e47f0e417b398f06f3fde7c02c4fe2d`. No new live
run uses this oracle. Raw retry identity remains `3558a72` / `fa773606`, and
supplemental `stock-semantic-review.json` remains failed.

The retry includes 9 unique progress phrases across Tokyo weather, NVIDIA stock, AI
news, BMI, random number, Tokyo time, and London weather. The exact fixed phrase
“Let me check that.” is absent. This observation supports the dynamic filler
change on these requests; it does not clear the stock-answer defect or existing
input/audio findings.

## Capture and Speech Review

NGC readback verifies one `UPLOAD_COMPLETE` archive each for initial B
`82ff8cac78de` (3,076,964 bytes) and C6 `10742e34b911` (316,347 bytes). Both
downloaded checksums match. B contains 19 ASR and 16 TTS WAVs; C6 contains 1 ASR
and 2 TTS WAVs. The separate normal capture observer's consented `8cecb09e01ac`
archive also reaches `UPLOAD_COMPLETE` (246,442 bytes); explicitly declined
`0c9d3491f0e3` is not found. On the corrected version, an additional normal
observer passes first-attempt decline and consent capture acknowledgements
(`1d54e99647d3` / `946abafe84e9`); NGC finds only the consented archive,
`UPLOAD_COMPLETE`, 195,248 bytes. These observer checks are separate from the
corrected ALL run.

Corrected ALL B `45cd4b4c75e4` and C6 `bc1cfa3b9db2` each reach NGC
`UPLOAD_COMPLETE`: one archive each, 3,341,210 and 317,822 bytes, respectively.
Downloaded checksums and WAV integrity pass. B contains 18 ASR and 17 TTS WAVs;
C6 contains 1 ASR and 2 TTS WAVs. Archive availability does not rewrite browser
failure outcomes or qualify the full capture lifecycle matrix.

Phase D's raw smoke oracle does not require an exact echo of authored code
words. The initial run never reaches its sessions; the corrected run's
supplemental code review has the limits described above. Review input WAVs,
independent automatic speech recognition (ASR), application transcripts, and
spoken replies separately before clearing existing input-fidelity findings.
UI-reported latency is distinct from acoustic and server/model measurements.
Complete acoustic code-word and input-fidelity qualification remain pending.

## Qualification Boundary and Evidence

These are the complete requested A/B/C/D invocation's raw results; they do not
replace every release gate. Pronunciation listening, repeated-tool stress,
barge-in, failure injection, complete capture lifecycle, and other specialized
suites remain separate. Recorded agent mutations are confined to isolated
staging. A later protection audit finds one protected realtime function missing
while five remain unchanged; the missing function’s cause and actor are unknown.
At `2026-10-04T21:58:54.090325Z`, final read-only postflight confirms the staged
app/version/H200 placement and 5/6 protected NGC baselines. Production and main
staging public configuration hashes are unchanged. Authenticated final
ArgoCD/Vault audit is **BLOCKED** by expired Fusion authentication; the
historical authenticated protection pass does not replace it. Final capture
status is HTTP `200`, upload-ready shared S3 with consent required, 1 pending
session, 0 failed sessions, no recorded error types, and zero maximum attempts.
The pending cause is unknown; the queue is not empty. See the staging report for
exact identities and protection evidence. The historical [dev comprehensive
report](COMPREHENSIVE_DEV_2026-10-04.md) remains unchanged.

Prior `5e7ec42` source checks record 830 passed tests, 3 opt-in compatibility
skips, 55 subtests passed, and 3 known baseline failures. These do not qualify
this staging run, clear existing speech-input findings, or establish a full
suite pass for the later dynamic-filler source.

Raw evidence remains in three separate roots:

- Initial ALL: `/tmp/nva-comprehensive-astra-staging-20261005`.
- Corrected ALL: `/tmp/nva-comprehensive-astra-staging-dynamic-filler-20261005`.
- Standalone A: `/tmp/nva-comprehensive-astra-staging-dynamic-filler-A-retry-20261005`.

They retain run metadata, per-phase reports, WAVs, screenshots, captures, and
supplemental qualification evidence without overwriting prior records.
`final-readonly-postflight.json` is retained under
`/tmp/nva-dynamic-filler-staging-20261005`. The retained `evidence-manifest.json` under the replacement root records file
hashes. The primary re-verifies the manifest after the final documentation
commit before handoff. Observation timestamps use UTC; the report date uses
Asia/Kolkata.
