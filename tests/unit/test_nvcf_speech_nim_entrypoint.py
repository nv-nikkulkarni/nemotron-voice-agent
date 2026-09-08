# SPDX-FileCopyrightText: Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause

"""Tests for the NVCF Speech NIM secret adapter."""

import json
import os
import subprocess
from pathlib import Path

ENTRYPOINT = Path(__file__).parents[2] / "docker" / "nvcf-speech-nim-entrypoint.sh"


def _run_entrypoint(tmp_path: Path, secrets: dict[str, str], *, inherited_key: str = ""):
    secret_file = tmp_path / "secrets.json"
    secret_file.write_text(json.dumps(secrets), encoding="utf-8")
    start_script = tmp_path / "start-server"
    start_script.write_text(
        '#!/bin/sh\nprintf "%s" "${NGC_API_KEY:-}"\n',
        encoding="utf-8",
    )
    start_script.chmod(0o755)

    env = os.environ.copy()
    env.update(
        {
            "NVCF_SECRETS_FILE": str(secret_file),
            "NIM_SERVER_START_SCRIPT": str(start_script),
            "NGC_API_KEY": inherited_key,
        }
    )
    return subprocess.run(
        ["/bin/sh", str(ENTRYPOINT)],
        env=env,
        check=False,
        capture_output=True,
        text=True,
    )


def test_entrypoint_exports_ngc_api_key_from_nvcf_secret_file(tmp_path: Path):
    """The adapter exports the dedicated NGC key from the mounted JSON file."""
    result = _run_entrypoint(tmp_path, {"NGC_API_KEY": "test-ngc-key"})

    assert result.returncode == 0
    assert result.stdout == "test-ngc-key"
    assert result.stderr == ""


def test_entrypoint_accepts_legacy_nvidia_api_key_name(tmp_path: Path):
    """The adapter accepts the legacy NVIDIA key name used by older versions."""
    result = _run_entrypoint(tmp_path, {"NVIDIA_API_KEY": "test-nvidia-key"})

    assert result.returncode == 0
    assert result.stdout == "test-nvidia-key"


def test_entrypoint_preserves_an_existing_environment_key(tmp_path: Path):
    """An explicitly provided process environment key takes precedence."""
    result = _run_entrypoint(
        tmp_path,
        {"NGC_API_KEY": "mounted-key"},
        inherited_key="existing-key",
    )

    assert result.returncode == 0
    assert result.stdout == "existing-key"


def test_entrypoint_fails_closed_when_key_is_missing(tmp_path: Path):
    """Startup stops without disclosing values when no model-access key exists."""
    result = _run_entrypoint(tmp_path, {})

    assert result.returncode == 78
    assert result.stdout == ""
    assert "NGC_API_KEY is unavailable" in result.stderr
