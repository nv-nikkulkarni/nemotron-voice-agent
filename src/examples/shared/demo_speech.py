# SPDX-License-Identifier: BSD-2-Clause
"""Validated voice samples and selective pronunciation timing for NVIDIA TTS."""

from __future__ import annotations

import asyncio
import base64
import binascii
import io
import re
import subprocess
import wave
from typing import Any

import imageio_ffmpeg
import numpy as np
from loguru import logger
from pipecat.frames.frames import TTSAudioRawFrame, TTSStartedFrame
from pipecat.services.nvidia.tts import NvidiaTTSService, NvidiaTTSSynthesisMode

NEMOTRON_RE = re.compile(r"\bnemotron\b", re.IGNORECASE)
# Calibration provenance: assets/nemotron-approved-reference.json (8A-6).
APPROVED_TEMPO = 1.28
APPROVED_GAP_SECONDS = 0.025
MAX_SAMPLE_BYTES = 1_000_000


def supports_audio_prompt(model: str) -> bool:
    """Only audio-prompt models accept user voice samples."""
    name = model.casefold()
    return "zeroshot" in name or "zero-shot" in name


def validate_voice_sample(encoded: object) -> bytes:
    """Accept bounded 16-bit mono PCM WAV speech, never a filesystem path."""
    if not isinstance(encoded, str) or len(encoded) > 1_340_000:
        raise ValueError("Voice sample must be a WAV file smaller than 1 MB")
    try:
        data = base64.b64decode(encoded, validate=True)
        if len(data) > MAX_SAMPLE_BYTES:
            raise ValueError("Voice sample exceeds 1 MB")
        with wave.open(io.BytesIO(data), "rb") as audio:
            duration = audio.getnframes() / audio.getframerate()
            if (
                audio.getnchannels() != 1
                or audio.getsampwidth() != 2
                or audio.getcomptype() != "NONE"
                or not 22050 <= audio.getframerate() <= 48000
                or not 3 <= duration <= 10
            ):
                raise ValueError("Use 3–10 seconds of 16-bit mono PCM WAV at 22.05–48 kHz")
            frames = audio.readframes(audio.getnframes())
            if len(frames) != audio.getnframes() * 2:
                raise ValueError("Voice sample contains truncated audio")
            if not np.any(np.frombuffer(frames, dtype="<i2")):
                raise ValueError("Voice sample is silent")
    except (binascii.Error, wave.Error, EOFError, ZeroDivisionError) as exc:
        raise ValueError("Voice sample is not a valid PCM WAV") from exc
    return data


def _atempo(pcm: bytes, sample_rate: int) -> bytes:
    process = subprocess.run(
        [
            imageio_ffmpeg.get_ffmpeg_exe(),
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "s16le",
            "-ar",
            str(sample_rate),
            "-ac",
            "1",
            "-i",
            "pipe:0",
            "-af",
            f"atempo={APPROVED_TEMPO}",
            "-f",
            "s16le",
            "pipe:1",
        ],
        input=pcm,
        capture_output=True,
        timeout=10,
        check=True,
    )
    return process.stdout


def apply_approved_timing(pcm: bytes, words: Any, sample_rate: int) -> bytes:
    """Accelerate only freshly aligned Nemotron spans and trim quiet gaps before three.

    Reference clip timestamps are deliberately never applied to new synthesis.
    Context and the onset of the following word remain unmodified.
    """
    samples = np.frombuffer(pcm, dtype="<i2")
    edits: list[tuple[int, int, bytes]] = []
    previous_end = 0
    for index, word in enumerate(words):
        if not NEMOTRON_RE.fullmatch(str(word.word).strip(".,:;!?")):
            continue
        start = int(float(word.start_time) * sample_rate / 1000)
        end = int(float(word.end_time) * sample_rate / 1000)
        if not previous_end <= start < end <= len(samples):
            logger.warning("Nemotron timing skipped: invalid word alignment")
            continue
        sped = np.frombuffer(_atempo(samples[start:end].tobytes(), sample_rate), dtype="<i2").copy()
        if not len(sped):
            continue
        # Four-ms fades blend the modified word at its own edges only.
        edge = min(int(0.004 * sample_rate), len(sped) // 2)
        if edge:
            ramp = np.linspace(0.0, 1.0, edge)
            sped[:edge] = (sped[:edge] * ramp).astype("<i2")
            sped[-edge:] = (sped[-edge:] * ramp[::-1]).astype("<i2")
        cut_end = end
        if index + 1 < len(words) and str(words[index + 1].word).casefold().strip(".,:;!?") in {"three", "3"}:
            next_start = int(float(words[index + 1].start_time) * sample_rate / 1000)
            if end <= next_start <= len(samples):
                gap = samples[end:next_start]
                keep = int(APPROVED_GAP_SECONDS * sample_rate)
                # Only remove the leading contiguous quiet region; never speech or the three onset.
                audible = np.flatnonzero(np.abs(gap.astype(np.int32)) > 180)
                quiet = int(audible[0]) if len(audible) else len(gap)
                cut_end = end + max(0, quiet - keep)
        edits.append((start, cut_end, sped.tobytes()))
        previous_end = cut_end
    if not edits:
        return pcm
    output = bytearray()
    offset = 0
    for start, end, replacement in edits:
        output.extend(samples[offset:start].tobytes())
        output.extend(replacement)
        offset = end
    output.extend(samples[offset:].tobytes())
    return bytes(output)


def synthesize_request(service: NvidiaTTSService, text: str, sample_rate: int, *, timeout: float = 12) -> bytes:
    """Use a bounded unary RPC for previews or sentences requiring alignment."""
    service._initialize_client()
    request = service._build_base_request()
    request.text = text
    request.sample_rate_hz = sample_rate
    aligned = bool(NEMOTRON_RE.search(text)) and "magpie" in str(service._settings.model).casefold()
    request.enable_word_time_offsets = aligned
    call = service._service.stub.Synthesize.future(
        request,
        metadata=service._service.auth.get_auth_metadata(),
        timeout=timeout,
    )
    service._per_sentence_rpc_call = call
    try:
        response = call.result(timeout=timeout)
    finally:
        if service._per_sentence_rpc_call is call:
            service._per_sentence_rpc_call = None
    if aligned:
        try:
            return apply_approved_timing(response.audio, response.meta.words, sample_rate)
        except (ValueError, OSError, subprocess.SubprocessError) as exc:
            logger.warning("Nemotron timing unavailable; retaining synthesized audio: {}", type(exc).__name__)
    return response.audio


class DemoNvidiaTTSService(NvidiaTTSService):
    """Keep ordinary speech streaming; align only pronunciation-sensitive sentences."""

    def __init__(self, *, voice_sample: bytes | None = None, **kwargs):
        """Bind an already validated audio prompt to this session only."""
        super().__init__(**kwargs)
        if "magpie" in str(self._settings.model).casefold():
            self._settings.synthesis_mode = NvidiaTTSSynthesisMode.PER_SENTENCE
        if voice_sample is not None:
            if not supports_audio_prompt(str(self._settings.model)):
                raise ValueError("Reference audio requires Magpie Zero-shot")
            self._zero_shot_audio_prompt_data = voice_sample
            self._settings.voice = "Magpie-ZeroShot-Multilingual"

    async def _run_tts_per_sentence(self, text: str, context_id: str):
        if not NEMOTRON_RE.search(text) or "magpie" not in str(self._settings.model).casefold():
            async for frame in super()._run_tts_per_sentence(text, context_id):
                yield frame
            return
        if not self.audio_context_available(context_id):
            await self.create_audio_context(context_id)
            await self.start_ttfb_metrics()
            yield TTSStartedFrame(context_id=context_id)
        await self.start_tts_usage_metrics(text)
        for chunk in self._split_text_into_chunks(text):
            pcm = await asyncio.to_thread(synthesize_request, self, chunk, self.sample_rate)
            await self.stop_ttfb_metrics()
            # Small frames preserve normal transport playback and interruption behavior.
            size = max(2, int(self.sample_rate * 0.04) * 2)
            for start in range(0, len(pcm), size):
                yield TTSAudioRawFrame(
                    audio=pcm[start : start + size], sample_rate=self.sample_rate, num_channels=1, context_id=context_id
                )
