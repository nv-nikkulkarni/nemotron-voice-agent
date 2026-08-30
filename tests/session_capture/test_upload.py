# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause

# ruff: noqa: D103

"""Direct tests for the NGC CLI subprocess adapter (no network required)."""

from __future__ import annotations

import subprocess
from types import SimpleNamespace

from session_capture import capture


def _configure(monkeypatch) -> None:
    monkeypatch.setattr(capture.settings, "NGC_CLI_BIN", "/opt/ngc/ngc")
    monkeypatch.setattr(capture.settings, "NGC_RESOURCE", "example-org/session-captures")
    monkeypatch.setattr(capture.settings, "ngc_org", lambda: "example-org")
    monkeypatch.setenv("NGC_API_KEY", "unit-test-key")


def test_upload_invokes_expected_ngc_command_and_environment(monkeypatch) -> None:
    _configure(monkeypatch)
    observed = {}

    def run(command, **kwargs):
        observed["command"] = command
        observed["kwargs"] = kwargs
        return SimpleNamespace(returncode=0, stdout="", stderr="")

    monkeypatch.setattr(capture.subprocess, "run", run)
    assert capture._upload("deadbeef", "/tmp/deadbeef.tar.gz") == (True, "", False)
    assert observed["command"] == [
        "/opt/ngc/ngc",
        "registry",
        "resource",
        "upload-version",
        "example-org/session-captures:deadbeef",
        "--source",
        "/tmp/deadbeef.tar.gz",
    ]
    assert observed["kwargs"]["env"]["NGC_CLI_API_KEY"] == "unit-test-key"
    assert observed["kwargs"]["env"]["NGC_CLI_ORG"] == "example-org"
    assert observed["kwargs"]["timeout"] == 300


def test_upload_reports_cli_failure_without_claiming_timeout(monkeypatch) -> None:
    _configure(monkeypatch)
    monkeypatch.setattr(
        capture.subprocess,
        "run",
        lambda *_args, **_kwargs: SimpleNamespace(returncode=1, stdout="", stderr="permission denied"),
    )
    assert capture._upload("deadbeef", "/tmp/deadbeef.tar.gz") == (False, "permission denied", False)


def test_upload_timeout_is_distinguished_from_definite_failure(monkeypatch) -> None:
    _configure(monkeypatch)

    def timeout(*_args, **_kwargs):
        raise subprocess.TimeoutExpired(cmd="ngc", timeout=300)

    monkeypatch.setattr(capture.subprocess, "run", timeout)
    succeeded, detail, timed_out = capture._upload("deadbeef", "/tmp/deadbeef.tar.gz")
    assert not succeeded
    assert timed_out
    assert "may already have received" in detail
