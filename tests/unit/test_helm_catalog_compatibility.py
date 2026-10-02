# SPDX-FileCopyrightText: Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause

"""Validate the rendered dev chart against the example catalogs it mounts."""

import shutil
import subprocess
from pathlib import Path
from urllib.parse import urlparse

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def resources():
    """Render the same deployment profile used on the dev cluster."""
    if not shutil.which("helm"):
        pytest.skip("Helm is required to render catalog compatibility checks")
    rendered = subprocess.check_output(
        ["helm", "template", "catalog-test", str(ROOT / "nvcf_helm"), "-f", str(ROOT / "nvcf_helm/values-viking.yaml")],
        text=True,
    )
    return list(yaml.safe_load_all(rendered))


def test_chart_prompt_defaults_exist(resources):
    """Reject chart defaults that cannot hydrate the UI registry."""
    config = next(
        item for item in resources if item["kind"] == "ConfigMap" and "examples_registry.yaml" in item["data"]
    )
    registry = yaml.safe_load(config["data"]["examples_registry.yaml"])
    for example in registry["examples"].values():
        module = example["bot"].split(":")[0]
        prompts = yaml.safe_load((ROOT / "src" / Path(*module.split(".")[:-1]) / "prompts.yaml").read_text())
        for prompt in example["defaults"]["prompt"]:
            assert prompt in prompts


def test_catalog_server_endpoints_route_to_existing_model_pods(resources):
    """Require catalog aliases to select the existing backend and named port."""
    services = {item["metadata"]["name"]: item for item in resources if item["kind"] == "Service"}
    catalog = yaml.safe_load((ROOT / "src/examples/omni_assistant_subagents/services.local.yaml").read_text())["server"]
    deployments = [item for item in resources if item["kind"] == "Deployment"]
    for slot, key, legacy in [
        ("tts", "magpie-multilingual-tts", "tts-service"),
        ("llm", "nemotron-omni-nvfp4", "nvidia-llm-vllm-omni"),
    ]:
        entry = catalog[slot][key]
        endpoint = entry.get("server", entry.get("base_url"))
        url = urlparse(endpoint if "://" in endpoint else f"grpc://{endpoint}")
        service = services[url.hostname]
        assert service["spec"]["selector"] == services[legacy]["spec"]["selector"]
        port = next(item for item in service["spec"]["ports"] if item["port"] == url.port)
        matching = [
            item
            for item in deployments
            if all(
                item["spec"]["template"]["metadata"]["labels"].get(k) == v
                for k, v in service["spec"]["selector"].items()
            )
        ]
        assert len(matching) == 1
        assert any(
            p["name"] == port["targetPort"]
            for c in matching[0]["spec"]["template"]["spec"]["containers"]
            for p in c.get("ports", [])
        )
