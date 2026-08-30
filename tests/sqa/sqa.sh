#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause
#
# Host launcher for the SQA harness container. Runs one suite inside the
# self-contained Playwright+PulseAudio+ffmpeg image against the local UI.
#
#   ./sqa.sh functional            # exhaustive DOM/functional checks
#   ./sqa.sh converse [generic|omni|both]
#   ./sqa.sh comprehensive [all|A|B|C|D]  # full E2E: tools, omni, UI, concurrency
#   ./sqa.sh concurrent [N]        # N simultaneous users
#   ./sqa.sh video                 # record an mp4 conversation
#   ./sqa.sh shell                 # interactive debug shell
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
: "${SQA_KEY:?set SQA_KEY to the sk-* inference-hub key}"
BASE="${SQA_BASE:-http://localhost:7862}"
SUITE="${1:-functional}"; shift || true

declare -A CMD=(
  [functional]="node functional.mjs"
  [converse]="node converse.mjs ${1:-both}"
  [comprehensive]="node comprehensive.mjs ${1:-all}"
  [concurrent]="node concurrent.mjs ${1:-4}"
  [concurrent-spoken]="node concurrent_spoken.mjs ${1:-5}"
  [stress]="node stress.mjs ${1:-5} ${2:-3}"
  [robustness]="node robustness.mjs"
  [video]="node record_video.mjs"
  [shell]="bash"
)
RUN="${CMD[$SUITE]:?unknown suite $SUITE}"

exec docker run --rm --network host -it \
  -e SQA_KEY="$SQA_KEY" -e SQA_BASE="$BASE" \
  -v "$HERE":/sqa -w /sqa \
  sqa-harness:latest \
  bash run.sh $RUN
