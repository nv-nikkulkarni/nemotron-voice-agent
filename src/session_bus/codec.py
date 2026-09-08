# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause

"""Serialize WebcamFrame / Attachment to and from a Redis Stream field-map.

No extra serialization dependency: field values are strings (or raw bytes for
the payload), which is exactly what ``redis-py`` accepts for ``XADD`` and
returns from ``XRANGE``/``XREVRANGE``/``XREAD``.
"""

from __future__ import annotations

from attachment_store import Attachment
from webcam_frame_store import WebcamFrame


def frame_to_fields(f: WebcamFrame) -> dict:
    """Serialize a WebcamFrame into a Redis Stream field-map."""
    return {
        "id": f.id,
        "session_id": f.session_id,
        "sequence": str(f.sequence),
        "name": f.name,
        "content_type": f.content_type,
        "created_at": f.created_at,
        "data": f.data,
    }


def fields_to_frame(m: dict) -> WebcamFrame:
    """Deserialize a Redis Stream field-map (bytes keys/values) into a WebcamFrame."""

    def g(key: str) -> str:
        return m[key.encode()].decode()

    return WebcamFrame(
        id=g("id"),
        session_id=g("session_id"),
        sequence=int(g("sequence")),
        name=g("name"),
        content_type=g("content_type"),
        data=m[b"data"],
        created_at=g("created_at"),
    )


def att_to_fields(a: Attachment) -> dict:
    """Serialize an Attachment into a Redis Stream field-map."""
    return {
        "id": a.id,
        "session_id": a.session_id,
        "sequence": str(a.sequence),
        "kind": a.kind,
        "name": a.name,
        "content_type": a.content_type,
        "created_at": a.created_at,
        "source": a.source,
        "data": a.data,
    }


def fields_to_att(m: dict) -> Attachment:
    """Deserialize a Redis Stream field-map (bytes keys/values) into an Attachment."""

    def g(key: str) -> str:
        return m[key.encode()].decode()

    return Attachment(
        id=g("id"),
        session_id=g("session_id"),
        sequence=int(g("sequence")),
        kind=g("kind"),
        name=g("name"),
        content_type=g("content_type"),
        data=m[b"data"],
        created_at=g("created_at"),
        source=g("source"),
    )
