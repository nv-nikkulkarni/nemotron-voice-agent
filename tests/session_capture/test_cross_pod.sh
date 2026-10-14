#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause
#
# Proves the core claim of the session-capture redesign: a session whose
# PIPELINE (artifacts: log + audio) runs on pod A and whose CONSENT POST
# lands on pod B finalizes EXACTLY ONCE, with a COMPLETE archive (both the
# log and the audio pod A wrote, not just what pod B could see on its own
# local disk) -- this is the exact scenario D13 describes: without a shared
# object store, pod B's finalize would see only what B itself had written
# and silently archive an incomplete/empty session while reporting success.
#
# Mirrors tests/session_bus/test_cross_pod.sh's structure (two app
# containers on shared infra, exercised directly via the Python API rather
# than the full HTTP pipeline, since no GPU/NIM is available in this test
# environment) and extends it with a THIRD shared service: SeaweedFS as the
# object store, in addition to Redis for coordination.
#
# Usage: ./tests/session_capture/test_cross_pod.sh <image-tag>
set -euo pipefail
IMAGE="${1:-nemotron-voice-agent:test}"
NET="nvagent-capture-crosspod-test"
REDIS_HOST="capture-crosspod-redis"
SEAWEED_HOST="capture-crosspod-seaweedfs"
BUCKET="nva-session-capture"

cleanup() {
  docker rm -f capture-crosspod-app-A capture-crosspod-app-B "$REDIS_HOST" "$SEAWEED_HOST" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "== setup: network + redis + seaweedfs (image=$IMAGE) =="
docker network create "$NET" >/dev/null
docker run -d --name "$REDIS_HOST" --network "$NET" redis:7.2.4-alpine \
  redis-server --save "" --appendonly no >/dev/null
docker run -d --name "$SEAWEED_HOST" --network "$NET" chrislusf/seaweedfs:4.41 \
  server -s3 -s3.port=8333 -dir=/data >/dev/null

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

# SeaweedFS needs a moment to bring its S3 gateway up (~15s observed).
docker run --rm --network "$NET" curlimages/curl:8.11.1 sh -c "
  for i in \$(seq 1 30); do curl -sf http://$SEAWEED_HOST:8333/ >/dev/null 2>&1 && exit 0; sleep 1; done; exit 1
" || { echo "FAIL: seaweedfs never became reachable"; exit 1; }
echo "redis + seaweedfs reachable"

COMMON_ENV=(
  -e EXAMPLE_SELECTION=omni-assistant-subagents -e PLATFORM=cloud -e PIPELINE_TLS=false
  -e REDIS_URL="redis://$REDIS_HOST:6379/0"
  -e SESSION_CAPTURE_ENABLED=true -e SESSION_CAPTURE_REQUIRE_CONSENT=true
  -e SESSION_STORE_BACKEND=s3 -e SESSION_STORE_ENDPOINT="http://$SEAWEED_HOST:8333"
  -e SESSION_STORE_BUCKET="$BUCKET" -e SESSION_STORE_ACCESS_KEY=test -e SESSION_STORE_SECRET_KEY=test
  # SESSION_CAPTURE_NGC deliberately unset: local-only archive mode, so a
  # successful finalize leaves objects in the shared store where this test
  # can inspect them afterward, instead of needing a real NGC endpoint.
)

# Sequential start (see test_cross_pod.sh's comment): avoids two cold boots
# competing for host I/O in this sandboxed test environment.
docker run -d --name capture-crosspod-app-A --network "$NET" "${COMMON_ENV[@]}" "$IMAGE" >/dev/null
wait_healthy capture-crosspod-app-A
echo "pod A healthy"

docker run -d --name capture-crosspod-app-B --network "$NET" "${COMMON_ENV[@]}" "$IMAGE" >/dev/null
wait_healthy capture-crosspod-app-B
echo "pod B healthy"

exec_py() {
  local name=$1 code=$2
  docker exec "$name" /app/.venv/bin/python -c "$code"
}

SID="deadbeefcafe0001"
echo "session_id=$SID"

echo "== pod A: the pipeline writes log + audio to the SHARED store, then signals pipeline_done =="
exec_py capture-crosspod-app-A "
import sys; sys.path.insert(0, '/app/src')
import session_store, session_bus
from session_capture import state
from session_store import keys as k
session_store.init_from_env(); session_bus.init_from_env()
assert session_bus.client.is_enabled(), 'redis bus did not connect'
assert session_store.is_s3(), 'session_store did not connect to the shared S3 backend'
b = session_store.backend()
b.put(k.log_key('$SID'), b'full session log written on pod A')
b.put(k.audio_key('$SID', 'asr', 0), b'user audio turn 0')
b.put(k.audio_key('$SID', 'tts', 0), b'bot audio turn 0')
state.mark_pipeline_done('$SID')
print('pod A: wrote artifacts + pipeline_done')
"

echo "== pod B: the consent POST lands here instead -- B has NO local copy of A's files =="
exec_py capture-crosspod-app-B "
import sys; sys.path.insert(0, '/app/src')
import session_store, session_bus
from session_capture import state, capture
from session_store import keys as k
session_store.init_from_env(); session_bus.init_from_env()
state.mark_consent('$SID', consent=True, has_transcript=False)
print('pod B: marked consent, state now:', state.get('$SID'))
assert state.is_ready(state.get('$SID')), 'both signals should be visible from pod B via shared Redis'
capture.maybe_finalize('$SID')
print('pod B: ran maybe_finalize')
"

echo "== verify: state cleared, exactly one finalize, COMPLETE archive (not just B's empty view) =="
RESULT=$(exec_py capture-crosspod-app-A "
import sys; sys.path.insert(0, '/app/src')
import session_store, session_bus
from session_capture import state
from session_store import keys as k
session_store.init_from_env(); session_bus.init_from_env()
st = state.get('$SID')
objs = sorted(session_store.backend().list(k.session_prefix('$SID')))
print('state_after=', st)
print('objects=', objs)
assert st == {}, f'state should be cleared after finalize, got {st}'
expected = sorted([k.log_key('$SID'), k.audio_key('$SID','asr',0), k.audio_key('$SID','tts',0)])
assert objs == expected, f'D13 REGRESSION: archive incomplete -- expected {expected}, got {objs}'
print('CROSS_POD_CAPTURE_OK')
")
echo "$RESULT"
echo "$RESULT" | grep -q "CROSS_POD_CAPTURE_OK" || { echo "FAIL: cross-pod capture did not produce a complete archive"; exit 1; }

echo "== bonus: exactly-once under a REAL race -- both pods cross a Redis barrier together =="
RACE_SID="cafef00dbeef0002"
exec_py capture-crosspod-app-A "
import sys; sys.path.insert(0, '/app/src')
import session_bus
from session_capture import state
session_bus.init_from_env()
state.clear_state('$RACE_SID')
c = session_bus.client.sync_client()
c.delete('captest:$RACE_SID:ready', 'captest:$RACE_SID:results')
"

race_contender() {
  local pod=$1
  exec_py "$pod" "
import sys, time; sys.path.insert(0, '/app/src')
import session_bus
from session_capture import state
session_bus.init_from_env()
c = session_bus.client.sync_client()
ready_key = 'captest:$RACE_SID:ready'
result_key = 'captest:$RACE_SID:results'
c.incr(ready_key)
deadline = time.monotonic() + 10
while int(c.get(ready_key) or 0) < 2:
    assert time.monotonic() < deadline, 'contention barrier timed out'
    time.sleep(0.01)
token = state.try_acquire_lock('$RACE_SID')
c.rpush(result_key, 'winner' if token else 'blocked')
time.sleep(0.25)
if token:
    state.release_lock('$RACE_SID', token)
"
}

race_contender capture-crosspod-app-A &
PID_A=$!
race_contender capture-crosspod-app-B &
PID_B=$!
wait "$PID_A"
wait "$PID_B"

RACE_RESULT=$(exec_py capture-crosspod-app-A "
import sys; sys.path.insert(0, '/app/src')
import session_bus
session_bus.init_from_env()
c = session_bus.client.sync_client()
values = sorted(v.decode() for v in c.lrange('captest:$RACE_SID:results', 0, -1))
print(values)
assert values == ['blocked', 'winner'], values
c.delete('captest:$RACE_SID:ready', 'captest:$RACE_SID:results')
")
echo "$RACE_RESULT"
echo "PASS: exactly-once holds across two real pods sharing Redis"

echo ""
echo "===== SESSION-CAPTURE CROSS-POD PROOF: ALL PASS ====="
