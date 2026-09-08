#!/bin/sh
# Run the Playwright UI+pipeline test against the demo UI, in the official
# Playwright container (Chromium + system deps + browsers preinstalled). The image
# does NOT ship the `playwright` npm package, so we install it once into a mounted
# node_modules (reused after the first run) and point it at the image's browsers.
# --network host so it reaches the UI at localhost:7862.
set -e
IMG="${PW_IMAGE:-mcr.microsoft.com/playwright:v1.56.0-noble}"
BASE="${1:-http://localhost:7862}"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
mkdir -p "$REPO/tests/uitest/out"
docker run --rm --network host \
  -v "$REPO/tests/uitest":/work \
  -v "$REPO/tests/uitest/audio":/audio \
  -e MIC_WAV=/audio/mic_planet_48k.wav \
  -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  -e PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
  "$IMG" sh -c "cd /work && { [ -d node_modules/playwright ] || npm i --no-save --no-audit --no-fund playwright@1.56.0 >/tmp/npm.log 2>&1 || { echo 'npm install failed:'; tail -5 /tmp/npm.log; exit 1; }; } && node ui_test.cjs '$BASE'"
