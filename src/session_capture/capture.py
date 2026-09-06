# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause

"""Session-capture finalization: assemble a session's artifacts and upload to NGC.

Replica-safe: log/audio are written by the pipeline (any pod) through
``session_store``; consent/transcript arrive via the browser's POST (any
pod, possibly a different one). Two independent completion signals —
``mark_pipeline_finished`` (pipeline teardown) and ``mark_consent`` (the
POST) — both call ``maybe_finalize``, which proceeds only once BOTH have
landed, using ``state.try_acquire_lock``'s owner token so exactly one pod
does the work regardless of which signal arrived last or whether they race.

Blocking (tar, subprocess upload, object-store I/O): every entry point here
must be called via ``run_finalize`` from async code — nothing in this module
is safe to call directly from an event loop. See the pipeline teardown
handlers and ``reaper.py`` for the two callers.

On NVCF the ServiceAccount token isn't mounted and sidecar containers are
opaque, so finalize + upload run IN THE APP PROCESS (the reliable execution
context) rather than a sidecar.
"""

from __future__ import annotations

import asyncio
import contextlib
import io
import os
import subprocess
import tarfile
import tempfile
import threading
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor

from loguru import logger

import session_store
from session_store import keys as store_keys

from . import settings, state

_log_sink_installed = False

# Dedicated pool for finalize-path work (mark_pipeline_finished / maybe_finalize
# / abandon_stale), NOT asyncio's shared default executor. A single finalize
# can hold its thread for minutes (tar assembly + the NGC upload's own 300s
# timeout); sharing the default executor's small pool (min(32, cpu+4)) with
# frequent short-lived to_thread work elsewhere on the process --
# audio_recorder's per-turn writes, routes.py's Redis calls -- would let
# enough concurrent finalizes starve everything else. Small and bounded on
# purpose: finalize is not latency-sensitive, so a handful of workers is
# plenty and keeps worst-case thread count predictable.
_FINALIZE_EXECUTOR = ThreadPoolExecutor(max_workers=4, thread_name_prefix="session-capture-finalize")
_RETAINED_FAILURES = frozenset(
    {
        "timeout",
        "upload_failed",
        "ngc_cli_missing",
        "ngc_key_missing",
        "no_artifacts",
    }
)


async def run_finalize(fn, *args) -> None:
    """Run a finalize-path function on the dedicated executor. See module docstring."""
    await asyncio.get_running_loop().run_in_executor(_FINALIZE_EXECUTOR, fn, *args)


# Sids whose local <sid>.log has already been uploaded and removed. The loguru
# sink (_session_log_sink, below) checks this before writing, so teardown's
# own log lines (logged with the SAME stream_id contextvar, propagated into
# the to_thread worker) can't resurrect the file after mark_pipeline_finished
# already deleted it -- that resurrected file would never be uploaded or
# removed again (nothing revisits a finalized sid), leaking one small orphan
# file per session for the pod's lifetime. Bounded (OrderedDict as an LRU) so
# this itself can't grow without limit on a long-lived pod.
_MAX_CLOSED_LOG_SIDS = 10_000
_closed_log_sids: OrderedDict[str, None] = OrderedDict()
_closed_log_lock = threading.Lock()


def _mark_log_closed(sid: str) -> None:
    with _closed_log_lock:
        _closed_log_sids[sid] = None
        _closed_log_sids.move_to_end(sid)
        while len(_closed_log_sids) > _MAX_CLOSED_LOG_SIDS:
            _closed_log_sids.popitem(last=False)


def _is_log_closed(sid: str) -> bool:
    with _closed_log_lock:
        return sid in _closed_log_sids


def _safe_rm(path: str) -> None:
    if path:
        with contextlib.suppress(OSError):
            os.remove(path)


def mark_pipeline_finished(sid: str) -> None:
    """Called from pipeline teardown, after the pipeline has actually stopped.

    Uploads the finished session log, THEN records the pipeline-done signal.
    That order matters: another pod can observe ``pipeline_done`` the instant
    it's set and immediately win the finalize lock, so the log must already
    be durable in the shared store before the signal becomes visible --
    otherwise the finalizing pod can list the store before this PUT lands,
    archive without the log, and this PUT then recreates it as an orphan
    after the finalizer's cleanup already ran.

    The signal is still recorded UNCONDITIONALLY (even if the PUT above
    failed) so a session_store outage never loses the completion signal
    itself -- the log is nice-to-have; losing the signal means the session
    can never finalize at all.
    """
    # sid arrives from the pipeline's body, i.e. straight from the client's
    # ?session_id= query param -- sanitize BEFORE it becomes a filesystem path
    # below (an unsanitized "../.." here reads and then deletes an arbitrary
    # *.log on the host, and uploads its contents into the session archive).
    sid = store_keys.sanitize_sid(sid)
    if not settings.enabled() or not sid:
        return
    log_dir = settings.LOG_PATH
    log_path = os.path.join(log_dir, f"{sid}.log") if log_dir else ""
    if log_path and os.path.exists(log_path):
        try:
            with open(log_path, "rb") as fh:
                session_store.backend().put(store_keys.log_key(sid), fh.read())
        except Exception as exc:  # noqa: BLE001 - store backends raise their own exception types (botocore, OSError, ...)
            logger.warning(f"session-capture: log upload failed for {sid}: {exc}")
        finally:
            _safe_rm(log_path)
        # Stop the loguru sink from ever writing <sid>.log again -- every log
        # line from this point on (including our own "assembled"/"uploaded"
        # lines below) carries this same sid via the stream_id contextvar and
        # would otherwise silently recreate the file we just uploaded+removed.
        _mark_log_closed(sid)
    state.mark_pipeline_done(sid)
    maybe_finalize(sid)


def maybe_finalize(sid: str) -> None:
    """Finalize once both completion signals have arrived; a no-op otherwise.

    Safe to call redundantly from either signal's handler and from the
    reaper — only the caller that observes both flags AND wins the lock
    proceeds; everyone else returns immediately. State is cleared only once
    the session is fully handled (finalized, denied+discarded, or abandoned
    after MAX_FINALIZE_ATTEMPTS) — a retryable failure keeps its flags so the
    next attempt (another signal firing again, or the reaper) can retry.
    """
    sid = store_keys.sanitize_sid(sid)
    if not settings.enabled() or not sid:
        return
    current = state.get(sid)
    if not state.is_ready(current):
        return
    # Upload timeouts/configuration failures retain their source objects for
    # operator recovery after the retry budget is exhausted. Do not let every
    # replica's reaper keep hammering NGC indefinitely once that terminal
    # diagnostic state has been reached.
    attempts = int(current.get("attempts", "0") or 0)
    retained_error = current.get("last_error", "")
    if attempts >= settings.MAX_FINALIZE_ATTEMPTS and retained_error in _RETAINED_FAILURES:
        return
    token = state.try_acquire_lock(sid)
    if not token:
        return  # another pod (or an earlier call on this one) is already finalizing
    try:
        if _finalize(sid, current):
            state.clear_state(sid)
            return
        attempts = state.mark_attempt(sid)
        if attempts < settings.MAX_FINALIZE_ATTEMPTS:
            logger.warning(f"session-capture: {sid} finalize attempt {attempts} failed; will retry")
            return
        last_error = state.get(sid).get("last_error", "")
        if last_error in _RETAINED_FAILURES:
            # Never delete source artifacts after an NGC upload/configuration
            # failure. Retain both state and objects for diagnosis/recovery.
            logger.bind(
                event="session_capture_outcome",
                outcome="retained_failure",
                session_id=sid,
                last_error=last_error,
            ).error(
                f"session-capture: {sid} exhausted {attempts} attempts (last_error={last_error}); "
                "NOT deleting source objects; state retained for manual review"
            )
            return
        logger.warning(f"session-capture: {sid} giving up after {attempts} failed finalize attempts")
        try:
            session_store.backend().delete_prefix(store_keys.session_prefix(sid))
        except Exception as exc:  # noqa: BLE001
            # Discard failed -- do NOT clear state. Clearing here (as an earlier
            # version of this code did) would make the leftover objects
            # permanently invisible to every retry/GC path, which all key off
            # live coordination state (see reaper.py). Leaving it means the
            # reaper's next ready-sweep retries this same give-up path.
            logger.error(f"session-capture: {sid} give-up discard failed: {exc}; state retained for retry")
            return
        state.clear_state(sid)
    finally:
        state.release_lock(sid, token)


def abandon_stale(sid: str) -> None:
    """Discard a session stuck with only one completion signal for too long.

    The other signal will never arrive (a crashed pod, a browser that never
    POSTs). Called only by the reaper. Acquires the SAME lock ``maybe_finalize`` uses,
    so this can never race a real finalize: if one is in flight (or wins the
    lock first), this call simply returns without touching anything.
    """
    sid = store_keys.sanitize_sid(sid)
    if not settings.enabled() or not sid:
        return
    token = state.try_acquire_lock(sid)
    if not token:
        return
    try:
        current = state.get(sid)
        if state.is_ready(current):
            return  # became ready between the reaper's scan and now -- not stale, leave it
        try:
            session_store.backend().delete_prefix(store_keys.session_prefix(sid))
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"session-capture: {sid} stale cleanup failed: {exc}")
            return  # leave state intact; the next sweep will retry
        logger.bind(
            event="session_capture_outcome",
            outcome="abandoned",
            session_id=sid,
        ).warning(f"session-capture: abandoned stale session {sid} (state={current})")
        state.clear_state(sid)
    finally:
        state.release_lock(sid, token)


def _finalize(sid: str, captured_state: dict[str, str]) -> bool:
    """Assemble sid's artifacts from session_store into a tarball and upload it.

    Returns True when the session is FULLY HANDLED and its state may be
    cleared — consent denied (artifacts deleted), or the upload succeeded /
    was intentionally skipped (``SESSION_CAPTURE_NGC`` unset — local-only
    capture is a supported mode; session_store IS the archive in that mode,
    so objects are deliberately left in place, not swept). Returns False for
    retryable failures and for a consented session whose artifacts never
    arrived. The caller keeps that coordination state for retry or diagnosis.
    """
    consent = captured_state.get("consent", "")
    backend = session_store.backend()

    if settings.REQUIRE_CONSENT and consent != "true":
        try:
            backend.delete_prefix(store_keys.session_prefix(sid))
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"session-capture: {sid} consent-denied cleanup failed: {exc}")
            return False
        logger.bind(
            event="session_capture_outcome",
            outcome="declined",
            session_id=sid,
        ).info(f"session-capture: {sid} consent={consent or 'none'} — NOT stored (discarded)")
        return True

    try:
        audio_keys = backend.list(store_keys.audio_prefix(sid))
        log_bytes = backend.get(store_keys.log_key(sid))
        transcript_bytes = backend.get(store_keys.transcript_key(sid))
    except Exception as exc:  # noqa: BLE001
        logger.warning(f"session-capture: {sid} store read failed: {exc}")
        return False

    if log_bytes is None and transcript_bytes is None and not audio_keys:
        # Both signals arrived but nothing was ever written (e.g. a session that
        # connected and disconnected instantly). Retain the coordination state
        # so the missing evidence remains visible to status/reaper diagnostics.
        state.set_last_error(sid, "no_artifacts")
        logger.bind(
            event="session_capture_outcome",
            outcome="no-artifacts",
            session_id=sid,
        ).error(f"session-capture: {sid} was consented but has no artifacts; retaining diagnostic state")
        return False

    tar_path = ""
    try:
        with tempfile.NamedTemporaryFile(suffix=".tar.gz", delete=False) as tmp:
            tar_path = tmp.name
        with tarfile.open(tar_path, "w:gz") as tar:
            if log_bytes is not None:
                _add_bytes(tar, f"{sid}/session.log", log_bytes)
            if transcript_bytes is not None:
                _add_bytes(tar, f"{sid}/transcript.txt", transcript_bytes)
            for key in audio_keys:
                data = backend.get(key)
                if data is not None:
                    _add_bytes(tar, f"{sid}/{os.path.basename(key)}", data)
        logger.info(f"session-capture: assembled {tar_path} ({len(audio_keys)} wavs) for {sid}")

        if not settings.NGC_RESOURCE:
            logger.info(
                f"session-capture: upload skipped for {sid} (SESSION_CAPTURE_NGC unset); "
                "objects remain in session_store as the archive"
            )
            return True
        if not os.path.exists(settings.NGC_CLI_BIN):
            # NGC upload was REQUESTED (NGC_RESOURCE is set) but the CLI isn't
            # where expected -- a retryable misconfiguration (bad image/mount),
            # not the intentional "local-only capture" mode above. Must fail
            # loudly rather than silently accumulate objects forever with no
            # attempts ever recorded.
            logger.error(
                f"session-capture: {sid} SESSION_CAPTURE_NGC is set but ngc CLI is missing at "
                f"{settings.NGC_CLI_BIN} -- upload cannot proceed"
            )
            state.set_last_error(sid, "ngc_cli_missing")
            return False
        if not (os.environ.get("NGC_API_KEY") or os.environ.get("NVIDIA_API_KEY")):
            logger.error(
                f"session-capture: {sid} SESSION_CAPTURE_NGC is set but no NGC/inference "
                "credential is available -- upload cannot proceed"
            )
            state.set_last_error(sid, "ngc_key_missing")
            return False

        uploaded, detail, timed_out = _upload(sid, tar_path)
        if not uploaded:
            logger.warning(f"session-capture: {sid} upload failed: {detail}")
            state.set_last_error(sid, "timeout" if timed_out else "upload_failed")
            return False
    except (OSError, tarfile.TarError) as exc:
        logger.warning(f"session-capture: {sid} tar assembly failed: {exc}")
        return False
    finally:
        _safe_rm(tar_path)

    # Upload succeeded. Isolated from the try/except above on purpose: a store
    # error while deleting the now-redundant source objects must NOT be
    # mistaken for "upload failed" -- that would trigger a duplicate NGC
    # upload (a new version) on the next retry. A cleanup failure here just
    # leaves harmless leftover objects behind (already-uploaded data).
    try:
        backend.delete_prefix(store_keys.session_prefix(sid))
    except Exception as exc:  # noqa: BLE001
        logger.error(f"session-capture: {sid} uploaded successfully but post-upload cleanup failed: {exc}")
    return True


def _upload(sid: str, tar_path: str) -> tuple[bool, str, bool]:
    """Run the ``ngc`` upload subprocess.

    Returns ``(succeeded, error_detail, timed_out)``. ``timed_out`` is True
    only when OUR client-side wait hit the subprocess timeout -- the ``ngc``
    process itself may still be uploading (or may have already finished)
    server-side, so a timeout must not be treated as "definitely didn't
    upload" (see ``state.set_last_error`` and ``maybe_finalize``'s give-up path).
    """
    key = os.environ.get("NGC_API_KEY") or os.environ.get("NVIDIA_API_KEY") or ""
    env = {
        **os.environ,
        "NGC_CLI_API_KEY": key,
        "NGC_CLI_ORG": settings.ngc_org(),
        "NGC_CLI_FORMAT_TYPE": "ascii",
        "HOME": "/tmp",
    }
    target = f"{settings.NGC_RESOURCE}:{sid}"
    try:
        result = subprocess.run(
            [settings.NGC_CLI_BIN, "registry", "resource", "upload-version", target, "--source", tar_path],
            env=env,
            capture_output=True,
            text=True,
            timeout=300,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return False, "upload timed out after 300s -- NGC may already have received it", True
    except (OSError, subprocess.SubprocessError) as exc:
        return False, str(exc), False
    if result.returncode == 0:
        logger.bind(
            event="session_capture_outcome",
            outcome="uploaded",
            session_id=sid,
        ).info(f"session-capture: uploaded {sid} -> {target}")
        return True, "", False
    return False, (result.stderr or result.stdout)[:300], False


def _add_bytes(tar: tarfile.TarFile, arcname: str, data: bytes) -> None:
    info = tarfile.TarInfo(name=arcname)
    info.size = len(data)
    tar.addfile(info, io.BytesIO(data))


def status() -> dict:
    """Introspect capture readiness. Ops/debug.

    Deliberately lightweight — no full object-store listing, which could be
    slow against a large S3 bucket.
    """
    if not settings.enabled():
        return {"enabled": False}
    pending_sids = state.all_pending_sids()
    pending_states = [state.get(sid) for sid in pending_sids]
    last_error_types = sorted({item.get("last_error", "") for item in pending_states if item.get("last_error")})
    attempt_counts = [int(item.get("attempts", "0") or 0) for item in pending_states]
    dedicated_ngc_key = bool(os.environ.get("NGC_API_KEY"))
    fallback_nvidia_key = bool(os.environ.get("NVIDIA_API_KEY"))
    return {
        "enabled": True,
        "ngc": settings.NGC_RESOURCE,
        "ngc_cli_present": os.path.exists(settings.NGC_CLI_BIN),
        "ngc_key_present": dedicated_ngc_key,
        "ngc_registry_key_present": dedicated_ngc_key,
        "nvidia_fallback_key_present": fallback_nvidia_key,
        "ngc_key_source": "ngc_api_key"
        if dedicated_ngc_key
        else ("nvidia_api_key_fallback" if fallback_nvidia_key else "none"),
        "require_consent": settings.REQUIRE_CONSENT,
        "store_backend": "s3" if session_store.is_s3() else "local",
        "pending_sessions": len(pending_sids),
        "pending_failed_sessions": sum(1 for item in pending_states if item.get("last_error")),
        "pending_last_error_types": last_error_types,
        "pending_max_attempts": max(attempt_counts, default=0),
    }


def install_log_sink(*, level: str = "DEBUG") -> None:
    """Install the per-session loguru sink. No-op unless capture is enabled and configured.

    Idempotent: safe to call once per worker process even though ``create_app``
    may be invoked more than once (single-worker main() path calls create_app
    directly; the uvicorn multi-worker factory path calls it per worker).

    Writes locally to ``<SESSION_LOG_PATH>/<sid>.log`` during the session (the
    hot append path — one line per log call, never worth a network write);
    ``mark_pipeline_finished`` uploads the completed file to session_store once,
    at teardown.
    """
    global _log_sink_installed
    if _log_sink_installed or not settings.enabled() or not settings.LOG_PATH:
        return
    log_dir = settings.LOG_PATH
    try:
        os.makedirs(log_dir, exist_ok=True)
    except OSError as exc:
        logger.warning(f"session-log: cannot create {log_dir}: {exc}")
        return

    def _session_log_sink(message) -> None:
        sid = message.record["extra"].get("stream_id", "-")
        safe = store_keys.sanitize_sid(sid)
        if not safe:
            return  # skip non-session lines (stream_id "-")
        if _is_log_closed(safe):
            return  # already uploaded+removed -- don't resurrect it (D11)
        try:
            with open(os.path.join(log_dir, f"{safe}.log"), "a", encoding="utf-8") as fh:
                fh.write(message)
        except OSError:
            pass

    logger.add(
        _session_log_sink,
        level=level,
        format=(
            "{time:YYYY-MM-DD HH:mm:ss.SSS} | {level: <8} | "
            "{name}:{function}:{line} - [stream_id={extra[stream_id]}] {message}"
        ),
    )
    _log_sink_installed = True
    logger.info(f"Per-session log capture -> {log_dir}/<session_id>.log (uploaded to session_store at teardown)")
