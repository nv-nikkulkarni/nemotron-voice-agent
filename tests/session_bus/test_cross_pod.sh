#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause
#
# T3 (no GPU needed): proves that webcam/attachment/session-config state posted to
# one app "pod" is visible from another app "pod" — the core claim of the Redis
# session bus. Two app containers on a shared Redis, no cloud NIM required.
#
# Usage: ./tests/session_bus/test_cross_pod.sh <image-tag>
set -euo pipefail
IMAGE="${1:-nemotron-voice-agent:test}"
NET="nvagent-crosspod-test"
REDIS_HOST="crosspod-redis"

cleanup() {
  docker rm -f crosspod-app-A crosspod-app-B "$REDIS_HOST" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "== setup: network + redis (image=$IMAGE) =="
docker network create "$NET" >/dev/null
docker run -d --name "$REDIS_HOST" --network "$NET" redis:7.2.4-alpine \
  redis-server --save "" --appendonly no >/dev/null

wait_healthy() {
  local name=$1 tries=90
  until docker exec "$name" /app/.venv/bin/python -c "
import urllib.request
urllib.request.urlopen('http://localhost:7860/health', timeout=2)
" >/dev/null 2>&1; do
    tries=$((tries - 1))
    [ "$tries" -le 0 ] && { echo "FAIL: $name never became healthy"; docker logs "$name" | tail -30; exit 1; }
    sleep 2
  done
}

# Start sequentially, not concurrently: two cold `uv run`/pipecat/Silero-VAD boots
# competing for disk I/O on the SAME host can push one well past a naive timeout in
# this sandbox (a real K8s cluster schedules pods on separate nodes/local storage,
# so this contention is a test-environment artifact, not a product concern). A's
# health becomes the gate before B even starts, which sidesteps it entirely.
docker run -d --name crosspod-app-A --network "$NET" \
  -e EXAMPLE_SELECTION=omni-assistant-subagents -e PLATFORM=cloud -e PIPELINE_TLS=false \
  -e REDIS_URL="redis://$REDIS_HOST:6379/0" \
  "$IMAGE" >/dev/null
wait_healthy crosspod-app-A
echo "pod A healthy"

docker run -d --name crosspod-app-B --network "$NET" \
  -e EXAMPLE_SELECTION=omni-assistant-subagents -e PLATFORM=cloud -e PIPELINE_TLS=false \
  -e REDIS_URL="redis://$REDIS_HOST:6379/0" \
  "$IMAGE" >/dev/null
wait_healthy crosspod-app-B
echo "pod B healthy"
echo "both pods healthy"

exec_py() {
  local name=$1 code=$2
  docker exec "$name" /app/.venv/bin/python -c "$code"
}

echo "== write session config on pod A directly via session_bus (bypasses the HTTP"
echo "   readiness gate, which needs a real reachable omni NIM this minimal test has"
echo "   no GPU for -- that gate is pre-existing, unrelated business logic; what this"
echo "   test proves is the Redis session bus itself, i.e. that pod B's HTTP routes"
echo "   resolve config/media pod A wrote, and vice versa) =="
SID="crosspod-test-$(date +%s 2>/dev/null || echo fixed)-$$"
exec_py crosspod-app-A "
import sys; sys.path.insert(0, '/app/src')
from session_bus import client; client.init_from_env()
assert client.is_enabled(), 'redis bus did not connect'
from session_bus import session_config
session_config.put('$SID', {'pipeline_mode': 'omni-assistant-subagents'})
print('wrote config for $SID on pod A')
"
echo "session_id=$SID"

echo "== resolve config on pod B (proves config crosses pods) =="
CFG_B=$(exec_py crosspod-app-B "
import sys; sys.path.insert(0, '/app/src')
from session_bus import client; client.init_from_env()
from session_bus import session_config
print(session_config.get('$SID'))
")
echo "pod B sees config: $CFG_B"
echo "$CFG_B" | grep -q "omni-assistant-subagents" || { echo "FAIL: config not visible on pod B"; exit 1; }
echo "PASS: session config crosses pods"

echo "== POST a webcam frame to pod B; read it back on pod A =="
# Minimal 1x1 JPEG (valid magic bytes, passes attachment_store's sniff check)
docker exec crosspod-app-B /app/.venv/bin/python -c "
import base64
jpg = base64.b64decode('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=')
open('/tmp/test.jpg', 'wb').write(jpg)
"
FRAME_RESP=$(docker exec crosspod-app-B sh -c "curl -sf -X POST 'http://localhost:7860/api/sessions/$SID/webcam/frames' -F 'file=@/tmp/test.jpg;type=image/jpeg'")
echo "pod B POST response: $FRAME_RESP"
echo "$FRAME_RESP" | grep -q '"session_id"' || { echo "FAIL: webcam POST rejected"; exit 1; }

READBACK=$(exec_py crosspod-app-A "
import sys; sys.path.insert(0, '/app/src')
from session_bus import client; client.init_from_env()
from webcam_frame_store import latest_webcam_frame
f = latest_webcam_frame('$SID')
print(f'OK seq={f.sequence} bytes={len(f.data)}' if f else 'MISS')
")
echo "pod A readback: $READBACK"
echo "$READBACK" | grep -q "^OK " || { echo "FAIL: frame not visible on pod A"; exit 1; }
echo "PASS: webcam frame crosses pods (posted on B, read on A)"

echo "== reverse direction: POST attachment to pod A; read on pod B =="
docker exec crosspod-app-A /app/.venv/bin/python -c "
import base64
jpg = base64.b64decode('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=')
open('/tmp/test.jpg', 'wb').write(jpg)
"
ATT_RESP=$(docker exec crosspod-app-A sh -c "curl -sf -X POST 'http://localhost:7860/api/sessions/$SID/attachments?kind=image' -F 'file=@/tmp/test.jpg;type=image/jpeg'")
echo "pod A attachment POST: $ATT_RESP"
echo "$ATT_RESP" | grep -q '"session_id"' || { echo "FAIL: attachment POST rejected"; exit 1; }

READBACK2=$(exec_py crosspod-app-B "
import sys; sys.path.insert(0, '/app/src')
from session_bus import client; client.init_from_env()
from attachment_store import latest_user_attachment
a = latest_user_attachment('$SID')
print(f'OK seq={a.sequence} bytes={len(a.data)}' if a else 'MISS')
")
echo "pod B readback: $READBACK2"
echo "$READBACK2" | grep -q "^OK " || { echo "FAIL: attachment not visible on pod B"; exit 1; }
echo "PASS: attachment crosses pods (posted on A, read on B)"

echo ""
echo "===== T3 CROSS-POD MEDIA PROOF: ALL PASS ====="
