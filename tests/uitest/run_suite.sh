#!/bin/sh
# Run the multi-scenario UI + pipeline regression suite in the official Playwright
# container (Chromium + browsers preinstalled; the `playwright` npm pkg + pixelmatch
# + pngjs are installed once into a cached, mounted node_modules). --network host so
# it reaches the UI at localhost:7862.
#
#   sh run_suite.sh                 # against http://localhost:7862
#   sh run_suite.sh https://<url>   # against a remote UI
#   UPDATE_BASELINE=1 sh run_suite.sh   # (re)create visual baselines
#
# Build the fake-mic WAVs + scenarios.json first:  python prep_mics.py --default
set -e
IMG="${PW_IMAGE:-mcr.microsoft.com/playwright:v1.56.0-noble}"
BASE="${1:-http://localhost:7862}"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
UIT="$REPO/tests/uitest"
mkdir -p "$UIT/out" "$UIT/baseline"
[ -f "$UIT/scenarios.json" ] || { echo "scenarios.json missing — run: python prep_mics.py --default"; exit 1; }
docker run --rm --network host \
  -v "$UIT":/work \
  -e VIS_THRESHOLD="${VIS_THRESHOLD:-0.006}" \
  -e UPDATE_BASELINE="${UPDATE_BASELINE:-0}" \
  -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  -e PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
  "$IMG" sh -c "cd /work && { [ -d node_modules/playwright ] && [ -d node_modules/pixelmatch ] || npm i --no-save --no-audit --no-fund playwright@1.56.0 pixelmatch@5 pngjs@7 >/tmp/npm.log 2>&1 || { echo 'npm install failed:'; tail -8 /tmp/npm.log; exit 1; }; } && node ui_suite.cjs '$BASE'"
