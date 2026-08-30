# SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause

"""Session audio recorder using Pipecat's AudioBufferProcessor.

Captures user (ASR input) and bot (TTS output) audio to separate WAV files,
one complete file per turn (the full clip arrives as a single ``bytes``
buffer — no streaming write needed). Controlled via environment variables:
  - ENABLE_ASR_AUDIO_DUMP  (default: false)
  - ENABLE_TTS_AUDIO_DUMP  (default: false)

Files are written through ``session_store`` (session_store.keys.audio_key),
keyed by the pipeline's own ``session_id`` — not a private random id. Audio is
this way trivially found by whatever finalizes the session's capture, on any
pod, with no dependency on the session log surviving.
"""

import asyncio
import io
import os
import wave

from loguru import logger
from pipecat.processors.audio.audio_buffer_processor import AudioBufferProcessor

import session_store
from session_store import keys as store_keys


def _env_bool(key: str, default: str = "false") -> bool:
    return os.getenv(key, default).lower() == "true"


ENABLE_ASR_DUMP = _env_bool("ENABLE_ASR_AUDIO_DUMP")
ENABLE_TTS_DUMP = _env_bool("ENABLE_TTS_AUDIO_DUMP")


def _wav_bytes(audio: bytes, sample_rate: int) -> bytes:
    """Wrap raw PCM16 mono audio in a WAV container, entirely in memory."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(audio)
    return buf.getvalue()


def create_audio_recorder(session_id: str = "") -> AudioBufferProcessor | None:
    """Create an AudioBufferProcessor that saves per-turn audio clips to WAV files.

    Returns None if both ASR and TTS dumps are disabled, OR if there's no real
    session id to attach the recording to (see below).

    ``session_id`` should be the pipeline's real session id whenever one is
    available (it always is when session-config/capture is in play — see
    ``body.get("session_id")`` in each example's ``bot()``). It's the key
    capture later globs on: coordination state (session_capture.state) is
    also keyed by this id, so audio written under any OTHER id has no
    corresponding state and is never finalized, uploaded, or cleaned up by
    anything -- a permanent, un-consented leak. Rather than fabricate a
    throwaway id for that case (an earlier version of this function did:
    ``session_id or uuid.uuid4().hex[:8]``), recording is simply disabled for
    sessions with no real id.

    Caller must await recorder.start_recording() on client connect.
    """
    if not ENABLE_ASR_DUMP and not ENABLE_TTS_DUMP:
        return None

    # session_id comes from the pipeline body, i.e. the client's ?session_id=
    # query param -- sanitize before it becomes an object key / filesystem path
    # (an unsanitized "../.." would write attacker-controlled WAV bytes outside
    # the store root).
    sid = store_keys.sanitize_sid(session_id)
    if not sid:
        logger.warning("Audio recorder disabled: no session_id -- nothing would ever finalize/clean up its audio")
        return None
    turn_counter = {"asr": 0, "tts": 0}

    recorder = AudioBufferProcessor(num_channels=1, enable_turn_audio=True)

    async def _save(kind: str, audio: bytes, sample_rate: int) -> None:
        # Offloaded to a thread (a store write is blocking I/O -- a network PUT
        # under S3 -- and this handler runs on the shared pipeline event loop,
        # once per turn, for every concurrent session on this worker) and
        # guarded (a capture hiccup must never affect the live call; pipecat
        # would otherwise just log-and-continue on the loop, having already
        # blocked it for the duration of the failed write).
        idx = turn_counter[kind]
        turn_counter[kind] = idx + 1
        key = store_keys.audio_key(sid, kind, idx)
        try:
            backend = session_store.backend()
            await asyncio.to_thread(backend.put, key, _wav_bytes(audio, sample_rate))
            logger.info(f"Audio saved: {key} ({len(audio)} bytes, {sample_rate}Hz)")
        except Exception as exc:  # noqa: BLE001 - store backends raise their own exception types (botocore, OSError, ...)
            logger.warning(f"session-capture: audio save failed for {key}: {exc}")

    @recorder.event_handler("on_user_turn_audio_data")
    async def on_user_turn(processor, audio: bytes, sample_rate: int, num_channels: int):
        if not ENABLE_ASR_DUMP or not audio:
            return
        await _save("asr", audio, sample_rate)

    @recorder.event_handler("on_bot_turn_audio_data")
    async def on_bot_turn(processor, audio: bytes, sample_rate: int, num_channels: int):
        if not ENABLE_TTS_DUMP or not audio:
            return
        await _save("tts", audio, sample_rate)

    logger.info(
        f"Audio recorder enabled (per-turn) — ASR={ENABLE_ASR_DUMP}, TTS={ENABLE_TTS_DUMP}, "
        f"session={sid}"
    )
    return recorder
