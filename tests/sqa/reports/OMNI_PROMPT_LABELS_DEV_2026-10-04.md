# Omni Prompt Labels Dev Check

**Date:** October 04, 2026 (UTC)

**Scope:** An Astra client label correction for the Omni prompt editor.
Targeted browser checks and final serving verification pass at
`http://localhost:7880`.

## Artifact Identity

The serving UI has the following identity:

| Item | Value |
| --- | --- |
| UI source | `17f3e71d32c36cc7c50e1ec7a2fade8bdbea3617` |
| UI image | `nemotron-voice-agent-ui:dev-17f3e71-20261004-omni-prompts` |
| UI OCI index | `sha256:92408f92e1954f2673b66599334435d46bbd4ea631fd1097b444f85ab8f2da7e` |
| UI AMD64 manifest | `sha256:92d017692e311ec273af93a59a438e8f407c72feebbf3aa8ae15b607a85576f2` |
| Build timestamp | `2026-10-04T15:21:37Z` |
| Backend source | `9b11f4d7a8064724f6b69f587d357ef490352404` (unchanged) |
| Helm release | `nva-dev`, namespace `nva-dev`, revision `23` (unchanged) |
| UI rollback | `nemotron-voice-agent-ui-dev-rollback-6de1f2f` (retained) |

## Behavior and Source Validation

The shared prompt page previously displayed Generic's descriptive headings for
Omni. Omni now names its **Speaker** and **Thinker** cards, compact fields,
expanded editors, and default-restore controls for their actual roles.
Persistent instructions explicitly append to Speaker and Thinker.

The API already supplies the selected example's correct prompt defaults.
This change preserves prompt contents, frontend/backend configuration mapping,
browser persistence, model roles, and Generic labels. No backend, API, catalog,
model, or Helm files change.

Scoped ESLint passes on both components. Production TypeScript/Vite build and
pre-commit pass on all 4 implementation/documentation files. All 3 changed
documents pass required hooks, 22 relative links/anchors, and `git diff --check`.
Source and UI secret scans pass. One exact public nginx checksum fingerprint
is excluded only in the temporary image scan after verifying the unchanged
base instruction; no repository exception is added.

## Browser and Serving Evidence

All 4 role checks pass, including equality with actual API defaults, expanded
editor titles and value synchronization, reload persistence, and restore.
The checked prompt keys are:

| Role | Prompt Key |
| --- | --- |
| Omni Speaker | `omni_subagents_assistant` |
| Omni Thinker | `ThinkerAgent.thinking_system_prompt` |
| Generic frontend | `generic_talker` |
| Generic backend | `generic_thinker` |

Desktop and 390-pixel phone views pass; the phone page has no horizontal
overflow. The browser reports zero hard failures, console errors, failed
requests, or bad responses.

At `2026-10-04T15:25:42.843634+00:00`, the serving image, JavaScript, CSS,
and runtime configuration bytes match the qualified candidate. Health returns
`ok`. All 15 dev pods are Ready with zero restarts, and every pod UID is
preserved. Helm remains at revision `23`. Capture has zero pending or failed
sessions. The temporary candidate is removed; the previous UI rollback remains
available.

## Qualification Boundary

This is a prompt-editor presentation check. It does not qualify speech, model
inference, tool execution, capture archive upload, concurrency, or a full release.
No NVCF function, Astra deployment, or production promotion changes. The
[LLM Settings dev report](LLM_SETTINGS_DEV_2026-10-04.md) remains historical
evidence for that earlier qualification.

Raw local evidence is under `/tmp/nva-omni-prompt-labels`, including `build.json`,
`deployment.json`, `final-state.json`, and
`browser-checks/prompt-labels-report.json`.
