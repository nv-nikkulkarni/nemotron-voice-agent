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


def _chart_config(resources):
    return next(item for item in resources if item["kind"] == "ConfigMap" and "services.yaml" in item["data"])["data"]


def test_chart_registry_services_exist_in_chart_catalog(resources):
    """Every service an example offers must be defined by the catalog the chart mounts."""
    data = _chart_config(resources)
    catalog = yaml.safe_load(data["services.yaml"])["server"]
    registry = yaml.safe_load(data["examples_registry.yaml"])
    for name, example in registry["examples"].items():
        for slot, keys in example["services"].items():
            category = example.get("categories", {}).get(slot, slot)
            for key in keys:
                assert key in catalog[category], f"{name}: {slot} {key}"


def test_chart_catalog_has_no_hosted_endpoints(resources):
    """The chart serves in-cluster NIMs only; a catalog `nvcf` key would add a hosted source."""
    catalog = yaml.safe_load(_chart_config(resources)["services.yaml"])
    assert set(catalog) == {"server"}
    for entries in catalog["server"].values():
        for key, entry in entries.items():
            assert "nvcf" not in entry, key


def test_chart_lightning_model_id_matches_prewarm_and_values(resources):
    """The app, the NIM, and the prewarmer must use one served model name."""
    values = yaml.safe_load((ROOT / "nvcf_helm/values.yaml").read_text())
    catalog = yaml.safe_load(_chart_config(resources)["services.yaml"])["server"]
    served = values["llmLightning"]["servedModelName"]
    assert catalog["llm"]["nemotron-lightning"]["model_id"] == served
    assert values["prewarm"]["llm"]["lightning"]["model"] == served


def test_catalog_server_endpoints_route_to_existing_model_pods(resources):
    """Require catalog endpoints to select an existing backend and named port."""
    services = {item["metadata"]["name"]: item for item in resources if item["kind"] == "Service"}
    catalog = yaml.safe_load(_chart_config(resources)["services.yaml"])["server"]
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
        if slot == "llm":
            probe = matching[0]["spec"]["template"]["spec"]["containers"][0]["readinessProbe"]["httpGet"]
            assert entry["health_path"] == probe["path"]


def test_chart_example_variants_match_the_repo_registry(resources):
    """The chart mounts its own registry over the image's, so a variant field missing here never reaches the app."""
    chart = yaml.safe_load(_chart_config(resources)["examples_registry.yaml"])["examples"]
    repo = yaml.safe_load((ROOT / "examples_registry.yaml").read_text())["examples"]
    for name, example in chart.items():
        for variant_id, variant in example.get("variants", {}).items():
            assert variant == repo[name]["variants"][variant_id], f"{name}.{variant_id}"
