---
name: operate-nemotron-voice-agent
description: Operate, deploy, qualify, troubleshoot, and hand off the NVIDIA Nemotron Voice Agent project across Viking Kubernetes, NVCF, and Astra. Use for project orientation, architecture questions, Generic Frontend/Backend or Omni behavior, Redis and SeaweedFS concurrency, session capture to NGC, model and TTS configuration, SQA execution or findings, incident RCA, release promotion, rollback, branch hygiene, evidence retention, and known deployment gotchas.
version: "2.0.0"
---

# Operate Nemotron Voice Agent

Use this skill as the project-specific operating manual. Keep generic Compose work in
`skills/deploy/` and configuration work in `skills/configure-pipeline/`; use this skill
for the custom Astra, NVCF, Viking, concurrency, capture, and SQA stack.

## Establish Truth Before Acting

1. Run from the repository root.
2. Read `AGENTS.md` and any scoped `AGENTS.md` before editing.
3. Inspect `git status`, the active branch, remotes, and worktrees. Preserve unrelated work.
4. Classify every statement as one of these evidence types:
   - **Checked-in:** derived from the current source, chart, or immutable artifact metadata.
   - **Live-verified:** queried from the current platform during this task.
   - **Historically verified:** preserved in a dated SQA or deployment report.
   - **Unverified candidate:** built or documented but not fully qualified.
5. Never infer current deployment state from a chart version, an old report, an Astra
   hostname, or NVCF `ACTIVE`. Query the relevant control plane and functional endpoints.
6. Never copy credential values into source, commands that print them, reports, logs, or
   replies. Record only secret names and injection boundaries.

Read [Project Information](references/project-information.md) for the repository map,
supported experiences, model roles, branch policy, and checked-in release state.

## Route the Task

- For an end-to-end explanation, request routing, pod ownership, concurrency, Redis,
  SeaweedFS, capture, barge-in, or pronunciation behavior, read
  [Runtime Architecture](references/runtime-architecture.md).
- For builds, Viking, NVCF, Astra, Vault, promotion, rollback, capacity, or deployment
  status, read [Deployment Flow](references/deployment-flow.md). Also load the installed
  `fusion` skill before using Fusion or Astra.
- For real-audio testing, Playwright, pass criteria, report interpretation, promotion
  gates, or prior findings, read [SQA Findings and Gates](references/sqa-findings-and-gates.md).
- For root-cause analysis or a recurring operational symptom, read
  [Incident and Mitigation Ledger](references/incident-and-mitigation-ledger.md).
- For release decisions or remaining risk, read
  [Known Bugs and Risks](references/known-bugs-and-risks.md).
- For the exact files that own a behavior, read
  [Source and Evidence Index](references/source-and-evidence-index.md).

Read only the relevant references, but read each selected file completely.

## Preserve System Invariants

- Keep Lightning as the non-reasoning, temperature-`0.0` Talker and Super as the
  reasoning-enabled, temperature-`0.0` Thinker for Generic Frontend/Backend unless a
  separately reviewed architecture change says otherwise.
- Do not add an intent router. The Talker alone chooses direct speech,
  `call_backend`, or `cancel_backend`. Python validates liveness, grounding, plans, and
  results; it does not infer user intent or synthesize tool calls.
- Keep Talker-visible tools limited to `call_backend` and `cancel_backend`. Keep domain
  tools behind a repository-owned `DomainSpec` and `ToolSpec` allowlist.
- Treat one WebSocket and its Pipecat context as process-local. Redis shares session
  configuration, media, and capture coordination; it does not migrate a live pipeline.
- Use SeaweedFS for shared capture artifacts and Redis for coordination. Do not collapse
  them into one store without redesigning the capture state machine.
- Keep the app entrypoint as a normal Kubernetes Service. Do not restore the abandoned
  StatefulSet/session-affinity router without new platform evidence.
- Keep Magpie pronunciation dictionaries IPA-only at runtime. ARPAbet remains review
  metadata. Never send a custom dictionary to Chatterbox.
- Preserve the browser/server sample-rate contract. A `16,000` Hz player for `22,050` Hz
  TTS audio produces slowed, lower-pitched speech and is a client bug, not a TTS NIM bug.
- Preserve raw WAV, JSON, screenshots, browser traces, and large run trees outside Git.
  Commit concise versioned reports, checksums, immutable identities, and regression code.
- Do not redeploy ASR, LLM, TTS, Redis, or SeaweedFS when a change requires only app,
  prewarmer, UI, or chart metadata. Verify pod identities before and after a Viking roll.

## Execute a Change Safely

1. Create a dedicated GitHub branch from the agreed source commit. Leave GitLab branches
   unchanged when they are designated backups.
2. Preserve the active production source branch until the change is qualified and merged.
3. Make independently testable, cherry-pickable commits. Separate behavior, tests/docs,
   and immutable release bumps when practical.
4. Run focused tests first, then the complete relevant unit, UI, and Helm checks.
5. Scan the complete branch diff and generated artifacts for credentials before pushing.
6. Build app, UI, and chart from a clean committed archive. Record full source SHA,
   image digests, chart checksum, and UI build timestamp.
7. Qualify in this order: Viking local, isolated NVCF/Astra staging, explicit go/no-go,
   production, then 24-hour monitoring.
8. Promote the exact qualified digests. Do not rebuild between environments.
9. Keep one known-good rollback version. If H100 capacity prevents overlap, stop and
   obtain explicit downtime authorization before removing the serving version.

## Apply Promotion Gates

Do not call a release “fully passed” or “production ready” unless every required gate for
that artifact is green. A passing 8-by-10 matrix does not clear webcam, capture, guardrail,
barge-in, reconnect, pronunciation, or comprehensive real-audio gates.

Require, at minimum:

- comprehensive real-audio Playwright coverage for Generic and Omni;
- strict repeated-tool concurrency with expected calls, audible output, independent-ASR
  grounding, and zero silence or cross-session leakage;
- barge-in, forced planner stall, provider failure, malformed response, and reconnect;
- isolated safety and grounding probes with input-ASR validation;
- four concurrent webcam baselines with no scene leakage;
- consented, declined, normal End, browser-close, and forced-drop capture outcomes,
  correlated with NGC when upload is expected;
- exact-word TTS probes plus human listening for high-risk dictionary entries.

Refer to [SQA Findings and Gates](references/sqa-findings-and-gates.md) for the exact
suite map and the distinction between product failures, input failures, and oracle failures.

## Diagnose Before Mutating

Use this order:

1. Reproduce with one session ID and preserve browser, app, and model timestamps.
2. Establish whether input audio reached application ASR correctly.
3. Establish whether the Talker selected direct, delegate, or cancel and whether a native
   tool call occurred.
4. Follow the delegated request through planner, validated plan, provider call, grounded
   result, TTS request, WebSocket serialization, and browser playout.
5. For media or capture, correlate the session ID across Redis keys, SeaweedFS prefixes,
   app logs, capture status, and NGC version.
6. Separate product defects from harness input failures, hosted-TTS refusal/truncation,
   independent-ASR substitutions, transient UI badges, and stale browser state.
7. Prefer the smallest fix at the owning boundary. Do not compensate for a client sample
   rate bug by redeploying TTS, or for a test-oracle bug by weakening product grounding.

## Maintain Evidence

- Keep dated qualification summaries under `tests/sqa/reports/` and move superseded
  summaries to `tests/sqa/reports/archive/<year-month>/` without rewriting history.
- Keep durable operating knowledge in this skill. Keep exact run outcomes in reports.
- Remove a derived evidence file only when the same information is retained here or in a
  versioned report, no active link or script consumes it, and Git history remains a valid
  recovery path.
- Never delete the latest report for a deployed version, raw evidence needed for an open
  defect, a rollback manifest, the pronunciation registry, or architecture assets the user
  explicitly requested.
- After documentation changes, run the repository documentation review and validation
  required by `AGENTS.md` and `docs/AGENTS.md`.

## Report Status Precisely

State all of the following separately:

- source branch and commit;
- built artifact versions and immutable digests;
- deployed environment and function/app names;
- control-plane status;
- functional smoke status;
- each SQA gate run, passed, failed, or pending;
- known blockers and rollback state.

Never use “deployed,” “healthy,” “qualified,” and “production ready” as synonyms.
