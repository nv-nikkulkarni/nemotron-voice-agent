# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause

"""Object-store backends for session-capture artifacts.

``ObjectBackend`` is the interface every backend implements; callers (in
``session_capture``) never branch on which backend is active. ``LocalBackend``
writes to the local filesystem (today's behavior — no new infrastructure);
``S3Backend`` speaks the S3 API, so any S3-compatible service (SeaweedFS,
MinIO, real S3) works via config alone.
"""

from __future__ import annotations

import contextlib
import os
import shutil
from typing import Protocol

# The shared container every session lives under (session_store.keys.session_prefix
# etc. all start with this). delete_prefix must never be allowed to resolve to
# exactly this directory -- that would delete every session for every user.
_SESSIONS_ROOT = "sessions"


def _require_scoped_prefix(prefix: str) -> str:
    # Defense in depth alongside session_store.keys._require_sid. Two distinct
    # failure modes, both caught here:
    #  1. An empty/"/"-only prefix.
    #  2. A prefix that LOOKS scoped but, once path-joined, collapses onto the
    #     "sessions" root itself -- e.g. "sessions//" (what session_prefix("")
    #     used to produce): os.path.join treats a trailing "//" as equivalent to
    #     "/", so naively checking `prefix.strip("/")` truthy is NOT enough --
    #     "sessions//".strip("/") is "sessions", which passes that check while
    #     still resolving to the shared root. normpath collapses this the same
    #     way os.path.join eventually will, so checking the NORMALIZED form is
    #     what actually protects the resolved path, not the input string.
    normalized = os.path.normpath(prefix.strip("/"))
    if normalized in ("", ".", _SESSIONS_ROOT) or ".." in normalized.split(os.sep):
        raise ValueError(f"delete_prefix refuses a prefix that isn't scoped under one session: {prefix!r}")
    return prefix


class ObjectBackend(Protocol):
    """put/get/list/delete over a flat key namespace (see keys.py)."""

    def put(self, key: str, data: bytes) -> None:
        """Write ``data`` at ``key``, overwriting any existing object."""
        ...

    def get(self, key: str) -> bytes | None:
        """Return the object at ``key``, or ``None`` if it doesn't exist."""
        ...

    def list(self, prefix: str) -> list[str]:
        """Return the sorted keys of every object under ``prefix``."""
        ...

    def delete(self, key: str) -> None:
        """Delete the object at ``key``. A no-op if it doesn't exist."""
        ...

    def delete_prefix(self, prefix: str) -> None:
        """Delete every object under ``prefix``."""
        ...

    def exists(self, key: str) -> bool:
        """Return whether an object exists at ``key``."""
        ...


class LocalBackend:
    """Writes objects as real files under a root directory.

    The key IS the relative path, so ``sessions/<sid>/audio/asr_000.wav``
    becomes ``<root>/sessions/<sid>/audio/asr_000.wav`` — no translation layer,
    easy to inspect by hand during local dev.
    """

    def __init__(self, root: str) -> None:
        """Store objects under ``root`` on the local filesystem."""
        self.root = root

    @classmethod
    def from_env(cls) -> LocalBackend:
        """Build from ``SESSION_STORE_LOCAL_ROOT``/``SESSION_CAPTURE_PATH``, or ``/tmp/session-store``."""
        explicit = os.environ.get("SESSION_STORE_LOCAL_ROOT", "").strip()
        if explicit:
            return cls(explicit)
        # No new required config: derive from the existing capture path so a
        # deployment that only ever set SESSION_CAPTURE_PATH keeps working.
        cap_dir = os.environ.get("SESSION_CAPTURE_PATH", "").strip()
        if cap_dir:
            data_root = os.path.dirname(cap_dir.rstrip("/")) or "/session-data"
            return cls(os.path.join(data_root, "store"))
        return cls("/tmp/session-store")

    def _path(self, key: str) -> str:
        # keys are always relative ("sessions/..."); guard against a leading
        # "/" ever turning this into an absolute-path escape from self.root.
        return os.path.join(self.root, key.lstrip("/"))

    def put(self, key: str, data: bytes) -> None:
        """Atomically write ``data`` to the file for ``key`` (write-tmp + rename)."""
        path = self._path(key)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = f"{path}.tmp"
        with open(tmp, "wb") as fh:
            fh.write(data)
        os.replace(tmp, path)  # atomic within the same filesystem

    def get(self, key: str) -> bytes | None:
        """Read the file for ``key``, or ``None`` if it doesn't exist.

        Only a genuine miss (``FileNotFoundError``) returns ``None``. Any other
        ``OSError`` (permission denied, I/O error, disk full) is re-raised --
        conflating "absent" with "transient error" would let a caller silently
        omit a real object from a tarball and then delete the source (see
        session_capture.capture._finalize).
        """
        try:
            with open(self._path(key), "rb") as fh:
                return fh.read()
        except FileNotFoundError:
            return None

    def list(self, prefix: str) -> list[str]:
        """Walk the directory for ``prefix`` and return sorted relative keys."""
        base = self._path(prefix)
        if not os.path.isdir(base):
            return []
        out: list[str] = []
        for dirpath, _dirnames, filenames in os.walk(base):
            for name in filenames:
                if name.endswith(".tmp"):
                    continue
                full = os.path.join(dirpath, name)
                out.append(os.path.relpath(full, self.root).replace(os.sep, "/"))
        return sorted(out)

    def delete(self, key: str) -> None:
        """Remove the file for ``key``, if present."""
        with contextlib.suppress(OSError):
            os.remove(self._path(key))

    def delete_prefix(self, prefix: str) -> None:
        """Recursively remove the directory for ``prefix``."""
        shutil.rmtree(self._path(_require_scoped_prefix(prefix)), ignore_errors=True)

    def exists(self, key: str) -> bool:
        """Return whether the file for ``key`` exists."""
        return os.path.exists(self._path(key))


def _is_missing(exc) -> bool:
    """True for a genuine "not found" ClientError; False for anything else.

    S3-compatible backends vary in which error code/status they use for a
    missing key, so this checks both. Used to distinguish "the object doesn't
    exist" (safe to treat as None/no-op) from a real error like a permissions
    problem or an outage, which must propagate rather than be silently
    swallowed as "absent" -- see S3Backend.get/delete/exists below.
    """
    err = exc.response.get("Error", {})
    if err.get("Code") in ("NoSuchKey", "404", "NotFound"):
        return True
    return exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode") == 404


class S3Backend:
    """Speaks the S3 API — works against SeaweedFS, MinIO, or real S3."""

    def __init__(self, client, bucket: str) -> None:
        """Wrap an existing boto3 S3 client, targeting ``bucket``."""
        self._client = client
        self._bucket = bucket

    @classmethod
    def from_env(cls) -> S3Backend:
        """Build from ``SESSION_STORE_ENDPOINT``/``_BUCKET``/``_ACCESS_KEY``/``_SECRET_KEY``.

        Raises ``KeyError`` if ``SESSION_STORE_ENDPOINT`` is unset — the
        caller (``client.init_from_env``) catches this and falls back to
        ``LocalBackend``.
        """
        import boto3
        from botocore.config import Config

        endpoint = os.environ["SESSION_STORE_ENDPOINT"]  # KeyError -> caller falls back to local
        bucket = os.environ.get("SESSION_STORE_BUCKET", "nva-session-capture")
        access_key = os.environ.get("SESSION_STORE_ACCESS_KEY", "") or None
        secret_key = os.environ.get("SESSION_STORE_SECRET_KEY", "") or None
        client = boto3.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            config=Config(signature_version="s3v4", retries={"max_attempts": 3}),
        )
        backend = cls(client, bucket)
        backend._ensure_bucket()
        return backend

    def _ensure_bucket(self) -> None:
        """Create the target bucket if it doesn't already exist."""
        from botocore.exceptions import ClientError

        try:
            self._client.head_bucket(Bucket=self._bucket)
        except ClientError:
            self._client.create_bucket(Bucket=self._bucket)

    def put(self, key: str, data: bytes) -> None:
        """Write ``data`` to the object at ``key``, overwriting any existing object."""
        self._client.put_object(Bucket=self._bucket, Key=key, Body=data)

    def get(self, key: str) -> bytes | None:
        """Return the object at ``key``, or ``None`` if it doesn't exist.

        Only a genuine miss returns ``None``; any other ``ClientError``
        (permissions, throttling, an outage) is re-raised. Conflating "absent"
        with "transient error" would let a caller silently omit a real object
        from a tarball and then delete the source (see
        session_capture.capture._finalize).
        """
        from botocore.exceptions import ClientError

        try:
            return self._client.get_object(Bucket=self._bucket, Key=key)["Body"].read()
        except ClientError as exc:
            if _is_missing(exc):
                return None
            raise

    def list(self, prefix: str) -> list[str]:
        """Return the sorted keys of every object under ``prefix`` (paginated)."""
        keys: list[str] = []
        paginator = self._client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self._bucket, Prefix=prefix):
            keys.extend(obj["Key"] for obj in page.get("Contents", []))
        return sorted(keys)

    def delete(self, key: str) -> None:
        """Delete the object at ``key``. A no-op if it doesn't exist.

        Only a genuine miss is swallowed; any other ``ClientError`` is
        re-raised. Silently swallowing every error here is how a
        consent-denied discard could previously report success having
        deleted nothing (session_capture.routes._eager_discard /
        capture._finalize's denial branch both rely on delete_prefix
        actually raising when it fails).
        """
        from botocore.exceptions import ClientError

        try:
            self._client.delete_object(Bucket=self._bucket, Key=key)
        except ClientError as exc:
            if not _is_missing(exc):
                raise

    def delete_prefix(self, prefix: str) -> None:
        """Delete every object under ``prefix``."""
        for key in self.list(_require_scoped_prefix(prefix)):
            self.delete(key)

    def exists(self, key: str) -> bool:
        """Return whether an object exists at ``key``.

        Only a genuine miss returns ``False``; any other ``ClientError`` is
        re-raised rather than misreported as "doesn't exist".
        """
        from botocore.exceptions import ClientError

        try:
            self._client.head_object(Bucket=self._bucket, Key=key)
            return True
        except ClientError as exc:
            if _is_missing(exc):
                return False
            raise
