# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause

# ruff: noqa: D100, D101, D102, D103, D107

import io
import os

import pytest
from botocore.exceptions import ClientError

from session_store.backends import LocalBackend, S3Backend


def _client_error(code: str, status: int) -> ClientError:
    return ClientError({"Error": {"Code": code}, "ResponseMetadata": {"HTTPStatusCode": status}}, "TestOp")


class FakeS3Client:
    """Minimal in-memory double for a boto3 S3 client.

    Has realistic ClientError-raising behavior -- no network, no real
    botocore session.
    """

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.fail_get_with: ClientError | None = None
        self.fail_delete_with: ClientError | None = None

    def put_object(self, Bucket: str, Key: str, Body: bytes) -> None:
        self.objects[Key] = Body

    def get_object(self, Bucket: str, Key: str) -> dict:
        if self.fail_get_with is not None:
            raise self.fail_get_with
        if Key not in self.objects:
            raise _client_error("NoSuchKey", 404)
        return {"Body": io.BytesIO(self.objects[Key])}

    def delete_object(self, Bucket: str, Key: str) -> None:
        if self.fail_delete_with is not None:
            raise self.fail_delete_with
        self.objects.pop(Key, None)

    def head_object(self, Bucket: str, Key: str) -> None:
        if Key not in self.objects:
            raise _client_error("404", 404)

    def get_paginator(self, operation_name: str):
        client = self

        class _Paginator:
            def paginate(self, Bucket: str, Prefix: str):
                keys = sorted(k for k in client.objects if k.startswith(Prefix))
                yield {"Contents": [{"Key": k} for k in keys]}

        return _Paginator()


# ─────────────────────────── LocalBackend ───────────────────────────


def test_local_backend_put_get_round_trip(tmp_path) -> None:
    b = LocalBackend(str(tmp_path))
    b.put("sessions/abc123/session.log", b"hello")
    assert b.get("sessions/abc123/session.log") == b"hello"


def test_local_backend_get_genuine_miss_returns_none(tmp_path) -> None:
    b = LocalBackend(str(tmp_path))
    assert b.get("sessions/nope/session.log") is None


def test_local_backend_get_real_error_raises_not_none(tmp_path) -> None:
    # D4 regression: only a genuine FileNotFoundError may return None. Any
    # other OSError (here: permission denied) must propagate, not be silently
    # swallowed as "the object doesn't exist" -- that conflation previously
    # let a real read error omit an object from a tarball and then have the
    # source deleted as if the upload had genuinely captured everything.
    b = LocalBackend(str(tmp_path))
    b.put("sessions/x/session.log", b"data")
    path = os.path.join(str(tmp_path), "sessions/x/session.log")
    os.chmod(path, 0o000)
    try:
        with pytest.raises(PermissionError):
            b.get("sessions/x/session.log")
    finally:
        os.chmod(path, 0o644)


def test_local_backend_list_and_exists(tmp_path) -> None:
    b = LocalBackend(str(tmp_path))
    b.put("sessions/s1/audio/asr_000.wav", b"a")
    b.put("sessions/s1/audio/tts_000.wav", b"b")
    b.put("sessions/s1/session.log", b"c")
    assert b.list("sessions/s1/audio/") == [
        "sessions/s1/audio/asr_000.wav",
        "sessions/s1/audio/tts_000.wav",
    ]
    assert b.exists("sessions/s1/session.log")
    assert not b.exists("sessions/s1/missing.wav")


def test_local_backend_delete_prefix_removes_only_that_session(tmp_path) -> None:
    b = LocalBackend(str(tmp_path))
    b.put("sessions/keep/session.log", b"keep me")
    b.put("sessions/victim/session.log", b"delete me")
    b.delete_prefix("sessions/victim/")
    assert b.list("sessions/victim/") == []
    assert b.list("sessions/keep/") == ["sessions/keep/session.log"]


@pytest.mark.parametrize(
    "dangerous_prefix",
    ["", "/", "sessions", "sessions/", "sessions//", "sessions/../../../etc", ".."],
)
def test_local_backend_delete_prefix_refuses_unscoped_prefixes(tmp_path, dangerous_prefix: str) -> None:
    # M2/D13 regression: session_prefix("") used to resolve to "sessions//",
    # which LocalBackend's path-join collapsed onto the "sessions" ROOT --
    # deleting every session for every user in one call. Every variant that
    # resolves onto that root (however it's spelled) must be refused.
    b = LocalBackend(str(tmp_path))
    b.put("sessions/real_user_1/session.log", b"user1 data")
    b.put("sessions/real_user_2/session.log", b"user2 data")
    with pytest.raises(ValueError):
        b.delete_prefix(dangerous_prefix)
    assert set(b.list("sessions/")) == {
        "sessions/real_user_1/session.log",
        "sessions/real_user_2/session.log",
    }


# ─────────────────────────── S3Backend ───────────────────────────


def test_s3_backend_put_get_round_trip() -> None:
    b = S3Backend(FakeS3Client(), "bucket")
    b.put("sessions/abc/session.log", b"hello")
    assert b.get("sessions/abc/session.log") == b"hello"


def test_s3_backend_get_genuine_miss_returns_none() -> None:
    b = S3Backend(FakeS3Client(), "bucket")
    assert b.get("sessions/nope/session.log") is None


def test_s3_backend_get_real_error_raises() -> None:
    # D4 regression: `except ClientError: return None` used to swallow EVERY
    # error, including permissions/outages -- indistinguishable from a miss.
    client = FakeS3Client()
    client.fail_get_with = _client_error("AccessDenied", 403)
    b = S3Backend(client, "bucket")
    with pytest.raises(ClientError):
        b.get("sessions/x/session.log")


def test_s3_backend_delete_miss_is_a_noop() -> None:
    b = S3Backend(FakeS3Client(), "bucket")
    b.delete("sessions/never-existed/session.log")  # must not raise


def test_s3_backend_delete_real_error_raises() -> None:
    # D4 regression: delete() used to swallow EVERY ClientError, so a
    # consent-denied discard could report success having deleted nothing.
    client = FakeS3Client()
    client.objects["sessions/x/session.log"] = b"data"
    client.fail_delete_with = _client_error("AccessDenied", 403)
    b = S3Backend(client, "bucket")
    with pytest.raises(ClientError):
        b.delete("sessions/x/session.log")


def test_s3_backend_delete_prefix_propagates_a_real_delete_failure() -> None:
    client = FakeS3Client()
    client.objects["sessions/x/session.log"] = b"data"
    client.fail_delete_with = _client_error("AccessDenied", 403)
    b = S3Backend(client, "bucket")
    with pytest.raises(ClientError):
        b.delete_prefix("sessions/x/")
    # The object must still be there -- the caller (capture._finalize's
    # consent-denial branch) relies on this to know the discard did NOT
    # actually happen and must be retried, not reported as success.
    assert "sessions/x/session.log" in client.objects


@pytest.mark.parametrize("dangerous_prefix", ["", "/", "sessions", "sessions/", "sessions//"])
def test_s3_backend_delete_prefix_refuses_unscoped_prefixes(dangerous_prefix: str) -> None:
    client = FakeS3Client()
    client.objects["sessions/real_user/session.log"] = b"data"
    b = S3Backend(client, "bucket")
    with pytest.raises(ValueError):
        b.delete_prefix(dangerous_prefix)
    assert "sessions/real_user/session.log" in client.objects


def test_s3_backend_exists() -> None:
    client = FakeS3Client()
    client.objects["sessions/x/session.log"] = b"data"
    b = S3Backend(client, "bucket")
    assert b.exists("sessions/x/session.log")
    assert not b.exists("sessions/missing/session.log")


def test_s3_backend_exists_real_error_raises() -> None:
    client = FakeS3Client()
    client.fail_get_with = None  # exists() uses head_object, not get_object
    b = S3Backend(client, "bucket")

    def _boom(Bucket: str, Key: str):
        raise _client_error("AccessDenied", 403)

    client.head_object = _boom
    with pytest.raises(ClientError):
        b.exists("sessions/x/session.log")


def test_s3_backend_list_is_sorted_and_paginated() -> None:
    client = FakeS3Client()
    client.objects = {"sessions/s/audio/tts_000.wav": b"b", "sessions/s/audio/asr_000.wav": b"a"}
    b = S3Backend(client, "bucket")
    assert b.list("sessions/s/audio/") == [
        "sessions/s/audio/asr_000.wav",
        "sessions/s/audio/tts_000.wav",
    ]
