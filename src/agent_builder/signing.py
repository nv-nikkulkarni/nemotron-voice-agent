# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Sign the persona the builder produced, so the voice agent can tell it was moderated.

The builder and the voice agent share ``AGENT_BUILDER_SIGNING_KEY``. The builder signs the
``persistent_prompt`` it returns only after the persona passed its checks; the voice agent drops
any ``persistent_prompt`` whose signature does not verify.
"""

from __future__ import annotations

import hashlib
import hmac

SIGNING_KEY_ENV = "AGENT_BUILDER_SIGNING_KEY"


def sign_persona(key: str, persona: str) -> str:
    """Return the hex HMAC-SHA256 of ``persona`` under ``key``."""
    return hmac.new(key.encode("utf-8"), persona.encode("utf-8"), hashlib.sha256).hexdigest()


def verify_persona(key: str, persona: str, token: object) -> bool:
    """Return whether ``token`` is the signature of ``persona`` (constant-time)."""
    return isinstance(token, str) and hmac.compare_digest(sign_persona(key, persona), token)
