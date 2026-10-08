#!/bin/sh
# SPDX-FileCopyrightText: Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause

set -eu

secret_file="${NVCF_SECRETS_FILE:-/var/secrets/secrets.json}"
server_start_script="${NIM_SERVER_START_SCRIPT:-/opt/nim/start_server.sh}"

extract_secret() {
    secret_name="$1"
    grep -o "\"${secret_name}\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" "${secret_file}" \
        | head -1 \
        | sed 's/.*"\([^"]*\)"$/\1/'
}

if [ -z "${NGC_API_KEY:-}" ] && [ -f "${secret_file}" ]; then
    NGC_API_KEY="$(extract_secret NGC_API_KEY || true)"
    if [ -z "${NGC_API_KEY}" ]; then
        NGC_API_KEY="$(extract_secret NVIDIA_API_KEY || true)"
    fi
    export NGC_API_KEY
fi

if [ -z "${NGC_API_KEY:-}" ]; then
    echo "NGC_API_KEY is unavailable; configure it as an NVCF function-version secret." >&2
    exit 78
fi

if [ ! -x "${server_start_script}" ]; then
    echo "NIM start script is unavailable or not executable: ${server_start_script}" >&2
    exit 69
fi

# Do not print the key or the mounted secret document.
exec "${server_start_script}" "$@"
