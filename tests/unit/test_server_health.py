# SPDX-FileCopyrightText: Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause

"""Health probes must reach the API even when the client bundle exists."""

from fastapi.testclient import TestClient

import server


def test_health_with_built_client(monkeypatch, tmp_path):
    """Keep probes JSON while continuing to serve SPA deep links."""
    index = "<html>voice client</html>"
    (tmp_path / "index.html").write_text(index)
    monkeypatch.setattr(server, "CLIENT_DIST", tmp_path)
    client = TestClient(server.create_app())

    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert client.get("/client/deep/link").text == index
