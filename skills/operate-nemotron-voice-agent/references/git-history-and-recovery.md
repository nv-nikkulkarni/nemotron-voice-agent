# Git History and Recovery

## Contents

1. [Current Remote Branches](#current-remote-branches)
2. [Primary v2 Commit Stack](#primary-v2-commit-stack)
3. [Focused Generic v2 Stack](#focused-generic-v2-stack)
4. [How the Branches Evolved](#how-the-branches-evolved)
5. [Snapshot Reconstruction](#snapshot-reconstruction)
6. [Rebase and Squash Rules](#rebase-and-squash-rules)
7. [Branch Cleanup History](#branch-cleanup-history)
8. [Git Gotchas](#git-gotchas)
9. [Recovery Procedure](#recovery-procedure)

## Current Remote Branches

The GitHub fork is the primary remote. The following branch inventory was fetched on
September 10, 2026:

| Remote branch | Head | Purpose |
|---|---|---|
| `develop` | `a1a4d56` | upstream integration base |
| `main` | `cb99653` | upstream/release line; not the custom deployment source |
| `dev/nikkulkarni/nvcf-deploy-rebased-v2` | `e6ab693` | active custom deployment source of truth |
| `dev/nikkulkarni/generic-frontend-backend-agent-v2` | `ec7104d` | focused reusable agent stack |
| `dev/nikkulkarni/nvcf-deploy-rebased-backup_09_09_26` | `3215a826` | immutable pre-v2 backup |

`dev/nikkulkarni/nvcf-deploy-rebased-v2` is based on the fetched `develop` and is 15
logical commits ahead. Verify ancestry again before any future rebase.

The separate local branch `dev/nikkulkarni/nvcf-speech-nim-functions` at `d57d42b` existed
in `/home/nikkulkarni/workspace/nva-speech-nim-functions` but had no verified GitHub remote
tracking branch. It owns the dedicated ASR/TTS NVCF wrapper and runbook and needs deliberate
backup/consolidation.

## Primary v2 Commit Stack

The v2 source was reconstructed into this logical stack:

| Order | Commit | Meaning |
|---:|---|---|
| 1 | `1526c4a` | scalable Astra/NVCF platform, Helm, Redis, SeaweedFS, capture, curated deployment surfaces |
| 2 | `937c4c8` | domain-configurable Frontend/Backend Agent architecture and Generic domain |
| 3 | `a6150d3` | Talker liveness, barge-in behavior, and correlated stage metrics |
| 4 | `ea83c82` | Generic direct grounded tool-result delivery |
| 5 | `7725381` | replay/stale-live-data prompt hardening |
| 6 | `aad8bdd` | live-model Talker/Thinker evaluation harness |
| 7 | `7072bf0` | false-positive barge-in filter and internal-mechanics grounding guard |
| 8 | `3cf3600` | Viking-only hybrid successful-weather rewrite |
| 9 | `ac43fc7` | curated UI guided example tours |
| 10 | `6902bb5` | latency-breakdown panel and session timer redesign |
| 11 | `8ada3de` | ten-minute session limit |
| 12 | `7803460` | required Viking capture destination |
| 13 | `631cfca` | consolidated Viking/NVCF/Astra rollout history |
| 14 | `a5c0570` | consolidated app/UI/chart release bumps |
| 15 | `e6ab693` | v2 Viking/local rollout record |

Use full SHAs from Git before comparing or cherry-picking. Short IDs here are navigation
anchors only.

## Focused Generic v2 Stack

The reusable agent branch is intentionally smaller:

| Order | Commit | Meaning |
|---:|---|---|
| 1 | `cdce6bd` | domain-configurable architecture |
| 2 | `a50c5b3` | liveness, barge-in, and stage metrics |
| 3 | `52d920a` | direct grounded Generic results |
| 4 | `9c22d07` | current-information, replay, and methodology prompt hardening |
| 5 | `4e45fb0` | live-model evaluation harness |
| 6 | `ec7104d` | false-positive barge-in and grounding guards |

The NVCF v2 branch contains the focused agent work plus deployment, UI, capture, release,
and documentation layers. Do not merge the full deployment stack into the focused branch.

## How the Branches Evolved

The work started on GitLab-oriented deployment branches, then moved to the GitHub fork.
Major branch operations were:

1. preserve uncommitted work and create `dev/nikkulkarni/nvcf-deploy-rebased`;
2. logically squash the deployment changes so features remained independently
   cherry-pickable;
3. rebase deployment and Generic agent work on current `develop`;
4. merge SQA remediation into the deployment branch and delete the redundant
   `prod-sqa-remediation-0.1.103` branch;
5. delete stale source-recovery and `0.1.129` remediation remotes after their content was
   proven present in the primary branch;
6. merge the repo-cleanup result into the deployment source and remove the cleanup branch;
7. retain a dated backup of the v1 deployment history; and
8. reconstruct clean v2 branches from logical snapshots after the SSD failure.

GitLab branches were deliberately left as historical backup during the GitHub migration.
Do not mutate or delete them without a new explicit request.

## Snapshot Reconstruction

The old SSD loss left an incomplete Git working copy while some immutable images,
local Git objects, task history, reports, and deployment metadata survived. The safe
recovery rule was: **do not deploy an orphaned image whose matching source and chart cannot
be reproduced**.

The “recovery repo” was a separate worktree/branch used to isolate reconstruction, not a
second authoritative product repository. After validation, its source was consolidated
into the v2 deployment branch. Keep multiple worktrees only for isolation; keep one declared
deployment source of truth.

The reconstruction used two evidence grades:

- **Image-backed:** extract only repository-owned source/configuration from surviving app
  images, record digest and file SHA-256, and compare with the Git baseline.
- **Evidence-backed:** recreate behavior from task history, reports, deployed UI behavior,
  and tests; review it as new code, never claim byte identity.

Surviving app images `2.0.59` and `2.0.60` helped recover Talker-authored fillers, result
modes, stage metrics, streamed Thinker timing, and bounded token configuration. Evidence
reconstructed session restart, current-information prompt hardening, and ordered timeouts.
Fresh versions were required rather than reusing lost/partial tags.

The first recovery plan targeted 2.0.62/0.1.134. Continued changes advanced to the current
Viking 2.0.68/0.1.140 candidate. Read current source and release manifests rather than
treating the original recovery plan as final state.

## Rebase and Squash Rules

Use logical squashing, not a single giant commit. A good deployment branch preserves these
independent boundaries:

- scalable platform and concurrency;
- reusable agent architecture;
- agent reliability/metrics;
- direct result grounding;
- prompt behavior;
- model evaluation;
- turn/barge-in changes;
- environment-specific behavior;
- UI experience;
- capture configuration;
- deployment evidence; and
- immutable release metadata.

Before rewriting history:

1. fetch the GitHub fork;
2. record exact heads and ancestry;
3. create one dated backup ref;
4. confirm the target source is not the only rollback record;
5. scan current history for secrets;
6. build the proposed sequence in a clean worktree;
7. compare the final tree with the original tree;
8. run tests and secret scans;
9. push a new branch first; and
10. change the canonical branch only after review.

An interactive rebase changes commit IDs. Update documentation anchors and compare tree
content, not old hashes. Do not rebase deployment branches while they contain uncommitted
evidence or unrelated user changes.

## Branch Cleanup History

Branches deleted as redundant included:

- `dev/nikkulkarni/prod-sqa-remediation-0.1.103` after integration;
- `dev/nikkulkarni/nvcf-deploy-source-recovery-0.1.134` after reconstruction;
- `dev/nikkulkarni/0.1.129-regression-remediation` after integration;
- the temporary repository cleanup branch after merge; and
- the v1 Generic Frontend/Backend remote after its commits were present in the deployment
  history and its v2 replacement existed.

The isolated NVCF `-2` **function** was also deleted, but that is platform cleanup, not Git
branch cleanup.

Never delete a branch based on its name alone. Prove that its tip tree/commits are reachable
or intentionally superseded, check for unique tags, and retain the latest useful dated
backup.

## Git Gotchas

### Wrong Worktree

Multiple worktrees exist. Always print `pwd`, branch, head, status, and remotes before an
edit, build, or deployment. The familiar directory
`/home/nikkulkarni/workspace/gitlab/nemotron-voice-agent` historically pointed at v1 work;
the active v2 checkout is `/home/nikkulkarni/workspace/nva-nvcf-rebased-v2`.

### Dirty Worktree Ownership

Unrelated changes belong to the user or another workstream. Historical examples include an
emptied feedback-form Apps Script and untracked `docs/sqa-one-slide/`. Do not restore,
delete, stage, or commit them unless specifically in scope.

### Version Fields Are Environment-Specific

`Chart.yaml` can say app 2.0.68 while base production values intentionally select 2.0.67
and the Viking overlay selects 2.0.68. Render the target values file; do not mechanically
make every version string equal.

### Rebase Conflict Bias

The custom branch keeps upstream code as pristine as practical, using separate modules and
minimal integration points. During rebase, prefer upstream in unrelated core code and
reapply the narrow custom integration. Preserve tests that prove each integration.

### Secret Fingerprints

A reviewed Gitleaks fingerprint for a placeholder is not a generic suppression. Re-run
secret detection after squash/rebase and inspect every new suppression.

### Remote Deletion Versus Local Branch

Deleting a GitHub branch does not remove a local worktree or local ref. Prune remotes, list
worktrees, and document which copy remains. Conversely, a local-only branch is not backed
up merely because the same repository remote exists.

### Commit Count Is Not Quality

Fewer commits are useful only if each retained commit expresses a coherent, independently
testable change. Never squash deployment evidence into behavior so tightly that a future
agent cannot cherry-pick or revert safely.

## Recovery Procedure

If source is lost or inconsistent again:

1. stop deployments and preserve the serving versions;
2. inventory Git refs, worktrees, local objects, tags, Docker images, NGC charts, NVCF
   versions, Astra values, and reports;
3. record immutable digests and checksums in a redacted manifest;
4. create a clean recovery worktree from the last traceable source;
5. extract only project-owned files from surviving images;
6. classify each file image-backed or evidence-backed;
7. restore one logical behavior per commit with its tests;
8. compare final runtime trees and build from `git archive`;
9. scan Git, images, charts, and reports for credentials;
10. qualify Viking before touching NVCF/Astra;
11. fast-forward the active branch only when ancestry and tree equality are proven; and
12. retain the recovery branch and backup until the isolated environment passes.

Keep raw image layers, task transcripts, API dumps, and WAV artifacts out of Git. Preserve
their checksums and controlled storage location in the recovery manifest.
