#!/usr/bin/env bash
# Entrypoint for docker/Dockerfile.vllm-hf.
#
# NVCF injects function secrets as /var/secrets/secrets.json. Export HF_TOKEN
# from it (when not already set) so vLLM can download the Hugging Face
# checkpoint, then run `vllm serve` with the container args. With no args, read
# them from VLLM_SERVE_ARGS_JSON (a JSON list of strings), which keeps flags with
# JSON values or spaces intact on platforms that only pass environment variables.
set -euo pipefail

if [[ -z "${HF_TOKEN:-}" && -f /var/secrets/secrets.json ]]; then
  HF_TOKEN="$(python3 -c "import json; print(json.load(open('/var/secrets/secrets.json')).get('HF_TOKEN',''))")"
  export HF_TOKEN
fi

if [[ $# -eq 0 && -n "${VLLM_SERVE_ARGS_JSON:-}" ]]; then
  mapfile -d '' -t args < <(python3 -c '
import json, os, sys
args = json.loads(os.environ["VLLM_SERVE_ARGS_JSON"])
if not isinstance(args, list) or not all(isinstance(arg, str) for arg in args):
    sys.exit("VLLM_SERVE_ARGS_JSON must be a JSON list of strings")
sys.stdout.write("".join(arg + "\0" for arg in args))
')
  set -- "${args[@]}"
fi

exec vllm serve "$@"
