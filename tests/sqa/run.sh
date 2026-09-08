#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause
#
# In-container bootstrap: bring up a virtual display (Xvfb) + a virtual audio
# stack (PulseAudio with two null sinks), then exec the given command.
#
#   mic_sink         <- we PLAY user speech here; Chromium's mic = mic_sink.monitor
#   spk_sink         <- Chromium plays the bot's voice here; we record spk_sink.monitor
#
# Everything runs as root against one anonymous PulseAudio unix socket.
set -euo pipefail

export DISPLAY="${DISPLAY:-:99}"
export XDG_RUNTIME_DIR=/tmp/pulse-run
export PULSE_SERVER=unix:/tmp/pulse-run/native
mkdir -p "$XDG_RUNTIME_DIR"

# --- virtual display (1280x800 so the UI lays out like a real laptop) ---
Xvfb "$DISPLAY" -screen 0 1280x800x24 -nolisten tcp >/tmp/xvfb.log 2>&1 &
for i in $(seq 1 50); do xdpyinfo -display "$DISPLAY" >/dev/null 2>&1 && break; sleep 0.1; done

# --- pulseaudio (user mode, as root, anonymous socket) ---
cat >/tmp/pulse.pa <<PA
load-module module-native-protocol-unix auth-anonymous=1 socket=/tmp/pulse-run/native
load-module module-null-sink sink_name=mic_sink sink_properties=device.description=MicSink
load-module module-null-sink sink_name=spk_sink sink_properties=device.description=SpkSink
# Expose mic_sink's monitor as a real capture source so Chromium enumerates it as
# a microphone (a bare .monitor source is not offered to getUserMedia).
load-module module-virtual-source source_name=virtmic master=mic_sink.monitor source_properties=device.description=VirtMic
set-default-sink spk_sink
set-default-source virtmic
PA
pulseaudio --daemonize=no --realtime=no --disallow-exit=yes --exit-idle-time=-1 \
  --load="module-always-sink=0" -n -F /tmp/pulse.pa --log-target=file:/tmp/pulse.log >/tmp/pulse.stdout 2>&1 &
for i in $(seq 1 50); do pactl info >/dev/null 2>&1 && break; sleep 0.1; done

# ESM ignores NODE_PATH, so make the build-time deps resolvable from cwd.
ln -sfn /opt/deps/node_modules ./node_modules

echo "[run.sh] display=$DISPLAY pulse=$(pactl info 2>/dev/null | awk -F': ' '/Server Name/{print $2}')"
pactl list short sinks   | sed 's/^/[run.sh] sink   /'
pactl list short sources | sed 's/^/[run.sh] source /'

exec "$@"
