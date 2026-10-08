#!/usr/bin/env bash
# Download session-capture archives from NGC.
#
# This is the read-side counterpart of src/session_capture/capture.py's
# `_upload()`, which puts them there via:
#   ngc registry resource upload-version <org>/<resource>:<session_id> --source <tar>
# (see docs/current-deployed-pipeline-architecture.md ~14.6, docs/staging.md).
# Each session's archive is one *version* of one NGC resource, named for the
# session ID.
#
# Usage:
#   ./scripts/download-ngc-sessions.sh <session_id> [<session_id> ...] [--dest DIR]
#   ./scripts/download-ngc-sessions.sh --since YYYY-MM-DD [--until YYYY-MM-DD] [--tz ZONE] [--dest DIR]
#   ./scripts/download-ngc-sessions.sh --list
#
# --since/--until filter by each version's created date, as reported by NGC
# (UTC timestamps). A bare YYYY-MM-DD is interpreted as a CALENDAR DAY in
# --tz's timezone (default: this machine's local zone, e.g. IST), not UTC —
# NGC stores UTC, so "Sept 8" in IST (UTC+5:30) is NOT the same 24h window as
# "Sept 8" in UTC; the boundary shifts by the zone offset. --until defaults
# to today (also in --tz). Pass an explicit `...Z` timestamp for either flag
# to bypass zone conversion and mean UTC literally.
#
# Session IDs (not dates) are what NGC actually keys versions by, so this
# mode has to list+parse first, then download each matching version — it's
# a convenience wrapper around the explicit-session_id mode above, not a
# separate NGC capability.
#
# Env (read from the repo .env if present, or export before running — same
# precedence src/session_capture/capture.py uses):
#   SESSION_CAPTURE_NGC     "<org>/<resource>", e.g. 0491162300748285/session-captures
#   NGC_API_KEY             dedicated download key (preferred)
#   NVIDIA_API_KEY          fallback if NGC_API_KEY is unset
#   NGC_CLI_BIN             path to the ngc binary (default: ngc on PATH)
#   SESSION_DOWNLOAD_DEST   directory to download into (default: ./ngc-sessions),
#                           same as --dest
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Same .env-sourcing convention as scripts/download-nemo-speech-models.sh:
# pick up SESSION_CAPTURE_NGC / NGC_API_KEY / NVIDIA_API_KEY from the repo's
# .env if the caller hasn't already exported them.
if [[ -f "${ROOT}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${ROOT}/.env"
  set +a
fi

usage() {
  cat >&2 <<'EOF'
Usage:
  download-ngc-sessions.sh <session_id> [<session_id> ...] [--dest DIR]
  download-ngc-sessions.sh --since YYYY-MM-DD [--until YYYY-MM-DD] [--tz ZONE] [--dest DIR]
  download-ngc-sessions.sh --list

Downloads session-capture tarballs uploaded to NGC by src/session_capture/capture.py.
Requires SESSION_CAPTURE_NGC="<org>/<resource>" and NGC_API_KEY (or NVIDIA_API_KEY),
either exported already or present in the repo's .env.

--since/--until dates are calendar days in --tz's zone (default: this
machine's local zone) -- NGC stores UTC, so this is NOT the same as filtering
by UTC date. Append Z to a timestamp (e.g. --since 2026-09-08T00:00:00Z) to
mean UTC literally instead.
EOF
}

if [[ $# -eq 0 ]]; then
  usage
  exit 1
fi

# --- Parse args: either explicit session IDs, or --since/--until, plus an
#     optional --dest that applies to both modes. ---
SINCE=""
UNTIL=""
TZNAME=""
CLI_DEST=""
SESSION_IDS=()
MODE="ids"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --list)
      MODE="list"
      shift
      ;;
    --since)
      MODE="range"
      SINCE="$2"
      shift 2
      ;;
    --until)
      UNTIL="$2"
      shift 2
      ;;
    --tz)
      TZNAME="$2"
      shift 2
      ;;
    --dest)
      CLI_DEST="$2"
      shift 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      SESSION_IDS+=("$1")
      shift
      ;;
  esac
done

# --- Required config: same variable this feature already uses everywhere
#     else in the repo, so nothing new to configure beyond .env.example. ---
: "${SESSION_CAPTURE_NGC:?SESSION_CAPTURE_NGC is not set (expected \"<org>/<resource>\", e.g. 0491162300748285/session-captures — see .env.example)}"

# --- Credential: NGC_API_KEY first, NVIDIA_API_KEY as fallback — mirrors
#     capture.py's _upload(): `os.environ.get("NGC_API_KEY") or
#     os.environ.get("NVIDIA_API_KEY")`. ---
NGC_KEY="${NGC_API_KEY:-${NVIDIA_API_KEY:-}}"
if [[ -z "${NGC_KEY}" ]]; then
  echo "Neither NGC_API_KEY nor NVIDIA_API_KEY is set. Export one, or add it to .env." >&2
  exit 1
fi

NGC_BIN="${NGC_CLI_BIN:-ngc}"
if ! command -v "${NGC_BIN}" >/dev/null 2>&1; then
  echo "'${NGC_BIN}' not found on PATH. Install the NGC CLI (https://org.ngc.nvidia.com/setup/installers/cli) or set NGC_CLI_BIN to its path." >&2
  exit 1
fi

# Export the credential ONLY for this script's process tree, the same way
# capture.py's _upload() does for its ngc subprocess (NGC_CLI_API_KEY /
# NGC_CLI_ORG env vars, no `ngc config set`, nothing written to disk).
export NGC_CLI_API_KEY="${NGC_KEY}"
export NGC_CLI_ORG="${SESSION_CAPTURE_NGC%%/*}"
export NGC_CLI_FORMAT_TYPE="ascii"

DEST="${CLI_DEST:-${SESSION_DOWNLOAD_DEST:-${ROOT}/ngc-sessions}}"
mkdir -p "${DEST}"

download_one() {
  local sid="$1"
  local target="${SESSION_CAPTURE_NGC}:${sid}"
  echo "Downloading ${target} -> ${DEST} ..."
  "${NGC_BIN}" registry resource download-version "${target}" --dest "${DEST}"
}

if [[ "${MODE}" == "list" ]]; then
  # `resource info <target>` (no version) only returns the resource's own
  # summary (one `latestVersionIdStr`, no per-version dates) — confirmed
  # against a live org. `resource list "<target>:*"` is what actually
  # enumerates every version, each with its own createdDate/versionId.
  "${NGC_BIN}" registry resource list "${SESSION_CAPTURE_NGC}:*"
  exit 0
fi

if [[ "${MODE}" == "range" ]]; then
  if ! command -v python3 >/dev/null 2>&1; then
    echo "python3 is required to filter versions by date." >&2
    exit 1
  fi

  # NGC's createdDate is UTC. A bare YYYY-MM-DD from the user means a
  # calendar day in --tz's zone (default: system local, via `date`'s normal
  # TZ handling) -- NOT the same 24h window as that date in UTC once the
  # zone offset is nonzero (e.g. IST is UTC+5:30: local evenings land on the
  # PREVIOUS UTC date). Convert to explicit UTC here, once, so the Python
  # filter below only ever compares UTC to UTC.
  to_utc() {
    # GNU `date -u -d STRING` does NOT parse-then-convert: -u forces UTC as
    # the parsing context too, so a naive local wall-clock string comes out
    # unshifted (wrong). The reliable way is two steps: resolve to an epoch
    # in the correct zone first, THEN format that epoch as UTC.
    local ts="$1" default_time="$2" epoch
    if [[ "${ts}" != *T* && "${ts}" != *" "* ]]; then
      ts="${ts} ${default_time}"
    fi
    if [[ "${ts}" == *Z ]]; then
      # Caller already gave explicit UTC (trailing Z) -- use as-is, no zone
      # conversion.
      epoch="$(TZ=UTC0 date -d "${ts%Z}" +%s)"
    elif [[ -n "${TZNAME}" ]]; then
      epoch="$(TZ="${TZNAME}" date -d "${ts}" +%s)"
    else
      # No --tz given: `date` without TZ set already parses in this
      # machine's local zone, which is what we want as the default.
      epoch="$(date -d "${ts}" +%s)"
    fi
    date -u -d "@${epoch}" +"%Y-%m-%dT%H:%M:%S"
  }

  UNTIL="${UNTIL:-$([[ -n "${TZNAME}" ]] && TZ="${TZNAME}" date +%Y-%m-%d || date +%Y-%m-%d)}"
  SINCE_UTC="$(to_utc "${SINCE}" "00:00:00")"
  UNTIL_UTC="$(to_utc "${UNTIL}" "23:59:59")"
  echo "Listing versions of ${SESSION_CAPTURE_NGC} created between ${SINCE} and ${UNTIL} (${TZNAME:-local}, inclusive) -> UTC ${SINCE_UTC} to ${UNTIL_UTC} ..." >&2

  # `ngc registry resource list "<target>:*" --format_type json` enumerates
  # every version (each with versionId + createdDate) — confirmed live
  # against the real CLI. This still scans the JSON tree generically (any
  # version/id-ish key + created/date-ish key) rather than hardcoding one
  # field path, in case the schema differs across CLI versions. If it finds
  # nothing, it dumps the raw JSON so you can see what the CLI actually
  # returned and adjust — never silently downloads the wrong (or no) sessions.
  #
  # The filter script is written to a temp file rather than piped to
  # `python3 -`'s stdin: `python3 -` reads its own program FROM stdin, which
  # would collide with the ngc JSON we also need to pipe in on stdin.
  FILTER_SCRIPT="$(mktemp)"
  trap 'rm -f "${FILTER_SCRIPT}"' EXIT
  cat > "${FILTER_SCRIPT}" <<'PYEOF'
import datetime
import json
import re
import sys

since, until = sys.argv[1], sys.argv[2]
since_dt = datetime.datetime.fromisoformat(since).replace(tzinfo=datetime.timezone.utc)
until_dt = datetime.datetime.fromisoformat(until).replace(
    hour=23, minute=59, second=59, tzinfo=datetime.timezone.utc
)

raw = sys.stdin.read()
try:
    data = json.loads(raw)
except json.JSONDecodeError:
    print(f"Could not parse JSON from ngc CLI output:\n{raw}", file=sys.stderr)
    sys.exit(1)

VERSION_KEY_RE = re.compile(r"^(versionId|version|id)$", re.IGNORECASE)
DATE_KEY_RE = re.compile(r"(created|date)", re.IGNORECASE)

found = []


def walk(node):
    if isinstance(node, dict):
        version = None
        created = None
        for key, value in node.items():
            if isinstance(value, str) and VERSION_KEY_RE.match(key):
                version = value
            elif isinstance(value, str) and DATE_KEY_RE.search(key):
                created = value
        if version and created:
            found.append((version, created))
        for value in node.values():
            walk(value)
    elif isinstance(node, list):
        for item in node:
            walk(item)


walk(data)

if not found:
    print(f"No version entries recognized in:\n{json.dumps(data, indent=2)}", file=sys.stderr)
    sys.exit(1)

matched = []
for version, created in found:
    try:
        created_dt = datetime.datetime.fromisoformat(created.replace("Z", "+00:00"))
    except ValueError:
        continue
    if since_dt <= created_dt <= until_dt:
        matched.append(version)

for version in matched:
    print(version)
PYEOF

  mapfile -t SESSION_IDS < <(
    "${NGC_BIN}" registry resource list "${SESSION_CAPTURE_NGC}:*" --format_type json \
      | python3 "${FILTER_SCRIPT}" "${SINCE_UTC}" "${UNTIL_UTC}"
  )
  rm -f "${FILTER_SCRIPT}"
  trap - EXIT

  if [[ ${#SESSION_IDS[@]} -eq 0 ]]; then
    echo "No versions found in that date range (or the CLI's JSON shape wasn't recognized — try --list to inspect it)." >&2
    exit 1
  fi
  echo "Found ${#SESSION_IDS[@]} session(s) in range." >&2
fi

if [[ ${#SESSION_IDS[@]} -eq 0 ]]; then
  usage
  exit 1
fi

for sid in "${SESSION_IDS[@]}"; do
  download_one "${sid}"
done

echo "Done. Archives under ${DEST}/<session_id>/ (see docs/staging.md)."
