# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause
#
# Self-contained SQA harness: Playwright/Chromium + a virtual audio stack
# (PulseAudio null sinks) + ffmpeg + Xvfb, so we can drive the real browser
# UI, speak into its mic dynamically per turn, capture the bot's audio, and
# record a screen+audio video of a live conversation.
FROM mcr.microsoft.com/playwright:v1.56.0-noble

RUN apt-get update && apt-get install -y --no-install-recommends \
      pulseaudio pulseaudio-utils \
      ffmpeg \
      espeak-ng \
      x11-utils xauth dbus-x11 procps net-tools \
    && rm -rf /var/lib/apt/lists/*

# Node deps live outside /sqa (which is bind-mounted at run time) and are found
# via NODE_PATH, so the mount doesn't shadow them.
RUN mkdir -p /opt/deps && cd /opt/deps \
    && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --no-audit --no-fund \
       playwright@1.56.0 pngjs pixelmatch \
    && npm cache clean --force
ENV NODE_PATH=/opt/deps/node_modules
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /sqa
# Everything (pulseaudio, chromium) runs as root inside the container against a
# single anonymous PulseAudio socket — see run.sh.
ENV HOME=/root
CMD ["bash"]
