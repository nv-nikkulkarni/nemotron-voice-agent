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
#   ./sqa.sh captured-sessions      # reconstructed production-session regressions
#   ./sqa.sh repeated-expect-tool   # strict 8x10 live-data delegation matrix
#   ./sqa.sh corner                 # failure, safety, grounding, and cancellation
#   ./sqa.sh webcam                 # four-session webcam baseline isolation
#   ./sqa.sh capture                # consent/decline/close/drop lifecycle matrix
#   ./sqa.sh pronunciation          # Magpie and Chatterbox exact-word probes
#   ./sqa.sh concurrent [N]        # N simultaneous users
#   ./sqa.sh video                 # record an mp4 conversation
#   ./sqa.sh shell                 # interactive debug shell
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
: "${SQA_KEY:?set SQA_KEY to the sk-* inference-hub key}"
BASE="${SQA_BASE:-http://localhost:7862}"
SUITE="${1:-functional}"; shift || true
RUN_ID="${SQA_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-${SUITE}}"
HOST_OUT="${SQA_OUTPUT_ROOT:-$HERE/out}/$RUN_ID"
mkdir -p "$HOST_OUT"

declare -A CMD=(
  [functional]="node functional.mjs"
  [converse]="node converse.mjs ${1:-both}"
  [comprehensive]="node comprehensive.mjs ${1:-all}"
  [captured-sessions]="node captured_session_regressions.mjs"
  [repeated-expect-tool]="node repeated_expect_tool_matrix.mjs"
  [corner]="node prod_remediation_corner_cases.mjs"
  [webcam]="node webcam_baseline_concurrency.mjs"
  [capture]="node capture_lifecycle_matrix.mjs"
  [pronunciation]="node tts_pronunciation_probe.mjs"
  [concurrent]="node concurrent.mjs ${1:-4}"
  [concurrent-spoken]="node concurrent_spoken.mjs ${1:-5}"
  [stress]="node stress.mjs ${1:-5} ${2:-3}"
  [robustness]="node robustness.mjs"
  [video]="node record_video.mjs"
  [shell]="bash"
)
RUN="${CMD[$SUITE]:?unknown suite $SUITE}"

echo "[sqa.sh] run_id=$RUN_ID output=$HOST_OUT"

exec docker run --rm --network host -it \
  -e SQA_KEY="$SQA_KEY" -e SQA_BASE="$BASE" -e SQA_RUN_ID="$RUN_ID" -e SQA_OUT=/sqa-run \
  -v "$HERE":/sqa -w /sqa \
  -v "$HOST_OUT":/sqa-run \
  sqa-harness:latest \
  bash run.sh $RUN
