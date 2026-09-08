#!/bin/sh
set -e

# Two backend modes:
#   * LOCAL  — set BACKEND_ORIGIN (e.g. http://host.docker.internal:7860) to
#     proxy straight to a plain HTTP/WS app (a kubectl port-forward of a
#     self-hosted cluster). No NVCF gateway / function-id / auth injection.
#   * NVCF   — default; set NVCF_HOST (+ NVIDIA_API_KEY) to proxy to an NVCF
#     function via the invocation URL + grpc streaming gateway with auth.
if [ -n "$BACKEND_ORIGIN" ]; then
  echo "Backend mode: LOCAL → ${BACKEND_ORIGIN}"
  envsubst '${BACKEND_ORIGIN}' \
    < /etc/nginx/nginx-local.conf.template \
    > /etc/nginx/conf.d/default.conf
else
  if [ -z "$NVCF_HOST" ]; then
    echo "ERROR: set BACKEND_ORIGIN (local mode) or NVCF_HOST (NVCF mode)"
    exit 1
  fi

  if [ -z "$NVIDIA_API_KEY" ]; then
    echo "ERROR: NVIDIA_API_KEY must be set (NVCF mode)"
    exit 1
  fi

  # NVCF_FUNCTION_ID is the function UUID. It's needed as the `function-id` header
  # on the WebSocket path (routed via the grpc.nvcf.nvidia.com streaming gateway).
  # Default it to the leading UUID label of NVCF_HOST when not set explicitly.
  if [ -z "$NVCF_FUNCTION_ID" ]; then
    NVCF_FUNCTION_ID=$(echo "$NVCF_HOST" | cut -d. -f1)
    export NVCF_FUNCTION_ID
  fi

  # Substitute only our vars — leaves nginx $variables intact
  envsubst '${NVCF_HOST} ${NVIDIA_API_KEY} ${NVCF_FUNCTION_ID}' \
    < /etc/nginx/nginx-nvcf.conf.template \
    > /etc/nginx/conf.d/default.conf
fi

# --- Runtime demo config (window.__DEMO_CONFIG__ read by client/src/config.ts) ---
# Curated demo behavior is tuned per-deployment via DEMO_* env vars; unset vars
# fall back to the values baked into the client build.
DEMO_MODE="${DEMO_MODE:-true}"
DEMO_SESSION_SECONDS="${DEMO_SESSION_SECONDS:-120}"
DEMO_EXAMPLES="${DEMO_EXAMPLES:-generic-frontend-backend-agent,omni-assistant-subagents}"
DEMO_SELF_HOSTED_ONLY="${DEMO_SELF_HOSTED_ONLY:-true}"
DEMO_RECORD_ENABLED="${DEMO_RECORD_ENABLED:-true}"
UI_BUILD_TIMESTAMP="${UI_BUILD_TIMESTAMP:-unknown}"

# comma-separated -> JSON array (trims whitespace, drops empties, no trailing comma)
examples_json=$(printf '%s' "$DEMO_EXAMPLES" | awk -F, '{
  out="["; n=0;
  for (i=1;i<=NF;i++) { v=$i; gsub(/^[ \t]+|[ \t]+$/,"",v);
    if (v!="") { if (n++) out=out","; out=out"\""v"\"" } }
  print out"]"
}')

# config.js carries only non-secret demo toggles. The feedback FORM URL is NOT
# here (it would be served to browsers) — it lives server-side in nginx below.
cat > /usr/share/nginx/html/config.js <<EOF
window.__DEMO_CONFIG__ = {
  deployedAt: "${UI_BUILD_TIMESTAMP}",
  demoMode: ${DEMO_MODE},
  sessionSeconds: ${DEMO_SESSION_SECONDS},
  examples: ${examples_json},
  selfHostedOnly: ${DEMO_SELF_HOSTED_ONLY},
  recordEnabled: ${DEMO_RECORD_ENABLED}
};
EOF

# Feedback proxy: the real Google Form URL stays server-side (never shipped to
# the browser). The client POSTs to same-origin /feedback; nginx forwards it.
mkdir -p /etc/nginx/snippets
if [ -n "${FEEDBACK_FORM_URL:-}" ]; then
  FEEDBACK_HOST=$(printf '%s' "$FEEDBACK_FORM_URL" | sed -E 's#^https?://([^/]+)/.*#\1#')
  cat > /etc/nginx/snippets/feedback.conf <<EOF
location = /feedback {
    proxy_pass ${FEEDBACK_FORM_URL};
    proxy_ssl_server_name on;
    proxy_set_header Host ${FEEDBACK_HOST};
    proxy_set_header Content-Type "application/x-www-form-urlencoded";
    proxy_set_header Cookie "";
    proxy_hide_header Set-Cookie;
    # Google's response carries large headers — give nginx room or it 502s.
    proxy_buffer_size 32k;
    proxy_buffers 8 32k;
    proxy_busy_buffers_size 64k;
    proxy_connect_timeout 10s;
    proxy_read_timeout 15s;
}
EOF
  FEEDBACK_STATE="proxied -> ${FEEDBACK_HOST}"
else
  echo "# feedback disabled (FEEDBACK_FORM_URL unset)" > /etc/nginx/snippets/feedback.conf
  FEEDBACK_STATE="disabled"
fi
# Session consent+transcript now go to the app's POST /api/session-capture, which is
# already proxied by the /api rule — no separate capture proxy needed.

echo "Demo config: mode=${DEMO_MODE} session=${DEMO_SESSION_SECONDS}s examples=${DEMO_EXAMPLES} feedback=${FEEDBACK_STATE}"

echo "Proxying UI:"
if [ -n "$BACKEND_ORIGIN" ]; then
  echo "  HTTP  /api/* , /health  → ${BACKEND_ORIGIN}"
  echo "  WS    /api/ws           → ${BACKEND_ORIGIN} (plain WebSocket upgrade)"
else
  echo "  HTTP  /api/* , /health  → https://${NVCF_HOST}"
  echo "  WS    /api/ws           → wss://grpc.nvcf.nvidia.com (function-id=${NVCF_FUNCTION_ID})"
fi
exec nginx -g 'daemon off;'
