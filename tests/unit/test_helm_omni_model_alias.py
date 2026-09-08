# SPDX-FileCopyrightText: Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause

"""Regression tests for the Helm-hosted Omni model identity."""

from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
VALUES_PATH = ROOT / "nvcf_helm" / "values.yaml"
OMNI_DEPLOYMENT_PATH = ROOT / "nvcf_helm" / "templates" / "deployment-omni.yaml"
PREWARMER_DEPLOYMENT_PATH = ROOT / "nvcf_helm" / "templates" / "deployment-prewarmer.yaml"
OMNI_CATALOG_PATH = ROOT / "src" / "examples" / "omni_assistant_subagents" / "services.local.yaml"


def test_helm_served_model_name_matches_omni_catalog() -> None:
    """The model ID sent by the app must be one vLLM advertises."""
    values = yaml.safe_load(VALUES_PATH.read_text(encoding="utf-8"))
    catalog = yaml.safe_load(OMNI_CATALOG_PATH.read_text(encoding="utf-8"))

    served_model_name = values["omni"]["servedModelName"]
    catalog_model_id = catalog["singlegpu"]["llm"]["nemotron-omni-nvfp4"]["model_id"]
    assert served_model_name == catalog_model_id


def test_helm_omni_runtime_and_prewarmer_share_served_model_name() -> None:
    """The server and its warm request must use the same chart value."""
    omni_deployment = OMNI_DEPLOYMENT_PATH.read_text(encoding="utf-8")
    prewarmer_deployment = PREWARMER_DEPLOYMENT_PATH.read_text(encoding="utf-8")

    assert "--served-model-name {{ required" in omni_deployment
    assert ".Values.omni.servedModelName" in omni_deployment
    assert '"model":"{{ required' in prewarmer_deployment
    assert ".Values.omni.servedModelName" in prewarmer_deployment
    assert ".Values.prewarm.llm.omni.model" not in prewarmer_deployment
