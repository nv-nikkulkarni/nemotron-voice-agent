# Host Recovery and Tooling

## Contents

1. [Recovery Context](#recovery-context)
2. [Current Tool Availability](#current-tool-availability)
3. [Docker Recovery](#docker-recovery)
4. [Fusion and Platform Login](#fusion-and-platform-login)
5. [Worktree Map](#worktree-map)
6. [Missing Generated Evidence](#missing-generated-evidence)
7. [Safe Regeneration Procedure](#safe-regeneration-procedure)
8. [Sandbox Limitation](#sandbox-limitation)

## Recovery Context

The workstation's previous SSD failed. The repository, Codex task state, CLI configuration,
generated SQA outputs, and some local-only source were partially reconstructed on a new
Ubuntu installation. Treat filesystem absence as ambiguous until checking Git objects,
other worktrees, Docker images, NGC, platform deployments, and backups.

The NVIDIA driver/GPU stack was already installed during host setup and was intentionally
not reinstalled. Do not run a driver installation script unless current `nvidia-smi`, kernel
module, and package evidence proves it is necessary and the user approves downtime.

## Current Tool Availability

Verified on September 10, 2026:

| Tool | Path/state |
|---|---|
| Docker | `/usr/bin/docker`; works without `sudo` after login refresh |
| kubectl | `/usr/bin/kubectl`; Viking context available |
| Helm | `/usr/local/bin/helm` |
| Fusion | `/home/nikkulkarni/.local/bin/fusion` |
| NGC CLI | `/home/nikkulkarni/.local/bin/ngc` |
| GitHub CLI | `gh` absent; normal Git remote authentication works |

Fusion authentication is ephemeral. It was expired at the final September 10 snapshot and
requires `fusion login --reauth` before an authoritative Astra query. Artifactory and NGC
logins also expire independently.

## Docker Recovery

Docker originally required `sudo` even after the user was added to the group. The stable
fix was to ensure the current login session picked up the `docker` group; a full logout and
login or equivalent group-refresh was necessary. Docker now works unprivileged.

For a soft service reset, prefer the distribution's systemd Docker restart and inspect
status/socket ownership. Do not remove `/var/lib/docker`, reset all Docker data, or change
daemon storage without explicit destructive authorization.

If it regresses, check:

```bash
id
getent group docker
ls -l /var/run/docker.sock
systemctl status docker --no-pager
docker context show
docker ps
```

Differentiate group membership, stale login credentials, daemon failure, socket ownership,
and a non-default Docker context.

## Fusion and Platform Login

Fusion was installed after the OS recovery. Use the installed `fusion` skill for all Astra
and Fusion workflows. A normal sequence is:

```bash
fusion version
fusion login --reauth
fusion whoami
```

Do not upgrade Fusion in the middle of a deployment merely because a newer CLI is offered.
Record the current version and use a controlled update task. At the last check, installed
Fusion was 0.34.0 and 0.35.0 was available.

NVCF, NGC, and Fusion are separate control planes. A Fusion login does not necessarily
authorize NGC chart/resource operations, and an NVIDIA invocation key is not necessarily a
registry-capable NGC key.

## Worktree Map

Verified worktrees on September 10, 2026:

| Path | Branch/head | Use |
|---|---|---|
| `/home/nikkulkarni/workspace/nva-nvcf-rebased-v2` | `dev/nikkulkarni/nvcf-deploy-rebased-v2` / `e6ab693` | active deployment work |
| `/home/nikkulkarni/workspace/nva-generic-fba-v2` | `dev/nikkulkarni/generic-frontend-backend-agent-v2` / `ec7104d` | focused agent work |
| `/home/nikkulkarni/workspace/gitlab/nemotron-voice-agent` | old v1 deployment branch / `d06b954` | historical worktree; do not use by habit |
| `/home/nikkulkarni/workspace/nva-speech-nim-functions` | local speech wrapper / `d57d42b` | dedicated ASR/TTS function work |

Always inspect `git worktree list`, branch, head, remotes, and status before acting.

## Missing Generated Evidence

The current active v2 tree does not contain these requested recovery outputs:

- `tests/voicetest/chatterbox_out/turn_00..19_*.greeting.wav` and `.turn.wav`;
- `tests/voicetest/results/generic-nano/g_random_1_100.*.wav`;
- `tests/voicetest/results/generic-nano/g_news_business.*.wav`;
- `tests/voicetest/results/generic-nano/g_news_tech.*.wav`;
- `tests/voicetest/results/analysis_run.log`;
- `tests/voicetest/results/correlation_run.log`; and
- `docs/sqa-one-slide/EVIDENCE_AND_VALIDATION.md`.

The preserved v1 worktree at
`/home/nikkulkarni/workspace/gitlab/nemotron-voice-agent` now contains all 40 requested
`chatterbox_out` WAVs, the six requested Generic Nano WAVs, both analysis/correlation logs,
and `docs/sqa-one-slide/EVIDENCE_AND_VALIDATION.md`. These outputs are recovered but have
not been deliberately consolidated into v2. The rest of the one-slide source assets are
not present there.

The expected `tests/voicetest/models/en_US-lessac-medium.onnx` is absent from both inspected
working trees despite an earlier recovery handoff saying it was intact. It may be
recoverable from a local Git object/older commit, but that has not been completed. Do not
claim the model recovery is finished.

These files are generated outputs, not application source. Their absence from v2 does not
change the deployed agent. Before copying them, verify provenance/checksums, decide whether
the active branch should track or ignore them, and avoid reintroducing redundant SQA-slide
build tooling that an earlier cleanup intentionally removed.

## Safe Regeneration Procedure

The user previously required command preview and confirmation before heavy generation.
Authorization was later given to proceed, but the current active tree still lacks the
outputs. A future agent should:

1. read `tests/voicetest/README.md`, scripts, Makefile/justfile, `pyproject.toml`, and config;
2. locate/recover the exact Lessac ONNX model and verify its hash;
3. identify the named test cases, Chatterbox/Magpie/provider, voice, and synthesis settings;
4. print the exact commands and file list before heavy generation if authorization is no
   longer clearly active;
5. install only missing dependencies through the repository workflow; do not guess;
6. regenerate the exact filenames and directory layout;
7. run the suite-defined analysis and correlation commands;
8. reconstruct `EVIDENCE_AND_VALIDATION.md` from sibling README/PPTX/PNG/SVG and actual
   regenerated results;
9. verify every required file exists and is non-empty with sizes/types; and
10. keep large WAV/log artifacts outside normal commits unless the repository policy
    explicitly tracks those paths.

Do not fabricate logs or reuse a differently configured voice/model solely to satisfy file
existence.

## Sandbox Limitation

The recovered host has a known Codex filesystem sandbox failure:

```text
bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted
```

Read-only and patch commands can require approved execution outside that broken sandbox.
The repository's normal `apply_patch` tool fails before reading files; the same patch helper
can work in an explicitly approved unsandboxed PTY. Continue to use the patch helper rather
than ad hoc `sed`, `cat`, or Python overwrites. If fallback is unavoidable, use one narrow,
reviewable Git patch and immediately run `git diff --check` plus scoped validation.

Never turn this host-specific workaround into a broad permanent command approval or a
reason to bypass repository guidance.
