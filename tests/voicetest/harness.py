# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause
"""Headless voice-turn driver for the Nemotron Voice Agent WebSocket transport.

This reproduces exactly what the browser client does (see ``client/src/App.tsx``:
``WebSocketTransport({ serializer: new ProtobufFrameSerializer(),
recorderSampleRate: 16000, playerSampleRate: 16000 })``) but with no browser and
no microphone:

  1. POST the pipeline config to ``/api/session-config`` -> ``session_id``.
  2. Open ``ws://host/api/ws?session_id=<id>``.
  3. Send an RTVI ``client-ready`` message (a ``MessageFrame`` whose ``data`` is
     the JSON RTVI envelope). The server gates the bot on this: its
     ``on_client_ready`` handler queues an ``LLMRunFrame`` (the opening greeting).
  4. Wait for that greeting to finish (so the measured turn is clean).
  5. Stream the utterance WAV as a sequence of ``InputAudioRawFrame``s
     (20 ms / 320-sample PCM16 chunks) at real time, then ~0.8 s of trailing
     silence so the server-side Silero VAD (``stop_secs=0.2``) fires end-of-turn.
  6. Collect the reply: the user ``TranscriptionFrame``, the bot text (RTVI
     ``bot-tts-text`` / ``bot-llm-text`` / ``TextFrame``) and the bot
     ``TTSAudioRawFrame`` bytes. Finish on ``bot-stopped-speaking`` or on an
     idle gap, and bail out (``hang=True``) on timeout.

Public API::

    run_turn(base_url, session_config, wav_path, timeout_s=30) -> dict

Returned dict keys: ``connected, user_transcript, bot_text, bot_audio_seconds,
time_to_first_bot_audio_s, hang, error`` (plus a few extras: ``tool_used``,
``greeting_text``, ``bot_stopped_cleanly``, ``events`` when debug is on).
"""
from __future__ import annotations

import asyncio
import json
import re
import time
import uuid
import wave
from dataclasses import dataclass, field
from urllib.parse import urlparse, urlunparse
from urllib.request import Request, urlopen

import websockets

import pcframes

RTVI_LABEL = "rtvi-ai"
RTVI_PROTOCOL_VERSION = "1.4.0"  # matches @pipecat-ai/client-js bundle
SAMPLE_RATE = 16000
CHUNK_MS = 20
CHUNK_SAMPLES = SAMPLE_RATE * CHUNK_MS // 1000      # 320 samples
CHUNK_BYTES = CHUNK_SAMPLES * 2                     # PCM16 => 2 bytes/sample
TRAILING_SILENCE_S = 0.8


# --------------------------------------------------------------------------- #
# Per-turn accumulator
# --------------------------------------------------------------------------- #
@dataclass
class _Phase:
    saw_audio: bool = False
    audio_bytes: int = 0
    audio_rate: int = SAMPLE_RATE
    first_audio_ts: float | None = None
    last_audio_ts: float | None = None
    started_speaking: bool = False
    stopped_speaking_ts: float | None = None
    # Raw bot-audio capture (for dumping WAVs + acoustic/dropout analysis).
    chunks: list[bytes] = field(default_factory=list)
    chunk_ts: list[float] = field(default_factory=list)


@dataclass
class _State:
    t0: float = field(default_factory=time.monotonic)
    phase: str = "warmup"                     # "warmup" -> "turn"
    warmup: _Phase = field(default_factory=_Phase)
    turn: _Phase = field(default_factory=_Phase)
    user_transcripts: list[str] = field(default_factory=list)
    bot_tts_text: list[str] = field(default_factory=list)
    bot_llm_text: list[str] = field(default_factory=list)
    text_frames: list[str] = field(default_factory=list)
    bot_ready: bool = False
    client_ready_ts: float | None = None
    end_speech_ts: float | None = None
    latency_breakdown: dict | None = None
    events: list[str] = field(default_factory=list)
    fatal: str | None = None

    def cur(self) -> _Phase:
        return self.turn if self.phase == "turn" else self.warmup

    def log(self, msg: str) -> None:
        self.events.append(f"{time.monotonic() - self.t0:6.2f}s [{self.phase:6s}] {msg}")


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _client_ready_frame() -> bytes:
    msg = {
        "label": RTVI_LABEL,
        "type": "client-ready",
        "data": {
            "version": RTVI_PROTOCOL_VERSION,
            "about": {"library": "voicetest-harness", "library_version": "1.0"},
        },
        "id": uuid.uuid4().hex[:8],
    }
    return pcframes.encode_message_frame(json.dumps(msg))


def _merge_transcripts(items: list[str]) -> str:
    """Merge the user transcript reported by several sources (TranscriptionFrame,
    RTVI ``user-transcription``, ``user-turn-finalized``) into one clean string.

    They usually carry the same sentence with cosmetic differences (whitespace,
    trailing punctuation), so we whitespace-normalise, drop case-insensitive
    duplicates, and drop any candidate wholly contained in another."""
    cleaned: list[str] = []
    for s in items:
        s = re.sub(r"\s+", " ", s).strip()
        if s and not any(s.lower() == c.lower() for c in cleaned):
            cleaned.append(s)
    kept = [s for s in cleaned
            if not any(s is not o and s.lower() in o.lower() for o in cleaned)]
    return " ".join(kept).strip()


def _ws_url(base_url: str, session_id: str) -> str:
    p = urlparse(base_url)
    scheme = "wss" if p.scheme == "https" else "ws"
    return urlunparse((scheme, p.netloc, "/api/ws", "", f"session_id={session_id}", ""))


def _post_session_config(base_url: str, config: dict, timeout: float = 15.0) -> str:
    body = json.dumps(config).encode("utf-8")
    req = Request(
        base_url.rstrip("/") + "/api/session-config",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(req, timeout=timeout) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    session_id = data.get("session_id")
    if not session_id:
        raise RuntimeError(f"/api/session-config returned no session_id: {data}")
    return session_id


def _load_pcm16(wav_path: str) -> bytes:
    with wave.open(wav_path, "rb") as w:
        if w.getframerate() != SAMPLE_RATE or w.getnchannels() != 1 or w.getsampwidth() != 2:
            raise ValueError(
                f"{wav_path}: need 16000 Hz mono PCM16, got "
                f"{w.getframerate()} Hz {w.getnchannels()}ch {w.getsampwidth() * 8}bit"
            )
        return w.readframes(w.getnframes())


def _write_wav_bytes(path: str, pcm: bytes, rate: int) -> None:
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(int(rate) or SAMPLE_RATE)
        w.writeframes(pcm)


def _handle_message(state: _State, data: str) -> None:
    """Handle an inbound RTVI MessageFrame (JSON in ``data``)."""
    try:
        msg = json.loads(data)
    except (ValueError, TypeError):
        return
    if not isinstance(msg, dict) or msg.get("label") != RTVI_LABEL:
        return
    mtype = msg.get("type")
    payload = msg.get("data") or {}
    ph = state.cur()
    if mtype == "bot-ready":
        state.bot_ready = True
        state.log("bot-ready")
    elif mtype == "bot-started-speaking":
        ph.started_speaking = True
        state.log("bot-started-speaking")
    elif mtype == "bot-stopped-speaking":
        ph.stopped_speaking_ts = time.monotonic()
        state.log("bot-stopped-speaking")
    elif mtype == "user-transcription":
        text = (payload or {}).get("text", "")
        final = (payload or {}).get("final", True)
        if text and final:
            state.user_transcripts.append(text)
            state.log(f"user-transcription(final): {text!r}")
    elif mtype == "bot-tts-text":
        text = (payload or {}).get("text", "")
        if text and state.phase == "turn":
            state.bot_tts_text.append(text)
    elif mtype == "bot-llm-text":
        text = (payload or {}).get("text", "")
        if text and state.phase == "turn":
            state.bot_llm_text.append(text)
    elif mtype == "server-message":
        # Custom pipeline telemetry (see generic/pipeline.py).
        stype = (payload or {}).get("type")
        if stype == "user-turn-finalized":
            text = (payload or {}).get("transcript")
            if text:
                state.user_transcripts.append(text)
                state.log(f"user-turn-finalized: {text!r}")
        elif stype == "latency-breakdown":
            state.latency_breakdown = payload
            state.log(f"latency-breakdown: {payload.get('events')}")


async def _receiver(ws, state: _State) -> None:
    try:
        async for raw in ws:
            if not isinstance(raw, (bytes, bytearray)):
                continue
            now = time.monotonic()
            try:
                kind, payload = pcframes.decode_frame(bytes(raw))
            except Exception as exc:  # noqa: BLE001 - never let a bad frame kill the loop
                state.log(f"decode error: {exc}")
                continue
            if kind == "audio":
                ph = state.cur()
                n = len(payload["audio"])
                if n:
                    ph.saw_audio = True
                    ph.audio_bytes += n
                    ph.audio_rate = payload.get("sample_rate") or ph.audio_rate
                    ph.first_audio_ts = ph.first_audio_ts or now
                    ph.last_audio_ts = now
                    ph.chunks.append(payload["audio"])
                    ph.chunk_ts.append(now)
            elif kind == "transcription":
                text = payload.get("text", "")
                if text:
                    state.user_transcripts.append(text)
                    state.log(f"TranscriptionFrame: {text!r}")
            elif kind == "text":
                text = payload.get("text", "")
                if text and state.phase == "turn":
                    state.text_frames.append(text)
            elif kind == "message":
                _handle_message(state, payload.get("data", ""))
    except (websockets.ConnectionClosed, asyncio.CancelledError):
        return
    except Exception as exc:  # noqa: BLE001
        state.fatal = f"receiver: {exc}"


async def _send_audio(ws, pcm: bytes, realtime: bool) -> None:
    for off in range(0, len(pcm), CHUNK_BYTES):
        chunk = pcm[off:off + CHUNK_BYTES]
        await ws.send(pcframes.encode_audio_frame(chunk, SAMPLE_RATE, 1))
        if realtime:
            await asyncio.sleep(CHUNK_MS / 1000)


async def _send_silence(ws, seconds: float, realtime: bool) -> None:
    silence = b"\x00" * CHUNK_BYTES
    for _ in range(int(seconds * 1000 / CHUNK_MS)):
        await ws.send(pcframes.encode_audio_frame(silence, SAMPLE_RATE, 1))
        if realtime:
            await asyncio.sleep(CHUNK_MS / 1000)


async def _await_greeting(state: _State, grace: float, settle: float, budget: float) -> None:
    """Let the opening greeting finish (or return quickly if none appears)."""
    start = time.monotonic()
    while time.monotonic() - start < budget:
        await asyncio.sleep(0.1)
        now = time.monotonic()
        w = state.warmup
        if not w.saw_audio:
            if now - start > grace:
                return
            continue
        quiet = w.stopped_speaking_ts is not None or (now - (w.last_audio_ts or now) > settle)
        if quiet:
            return


async def _await_response(state: _State, timeout_s: float, idle_gap: float) -> str:
    """Wait for the bot's reply to complete. Returns a reason string."""
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        await asyncio.sleep(0.1)
        now = time.monotonic()
        t = state.turn
        # Clean end signalled by the server, after the reply actually started.
        if t.stopped_speaking_ts is not None and (t.saw_audio or t.started_speaking):
            await asyncio.sleep(0.3)   # drain any final audio flush
            return "bot-stopped-speaking"
        # Fallback: reply produced audio then went quiet for idle_gap.
        if t.saw_audio and t.last_audio_ts and (now - t.last_audio_ts) > idle_gap:
            return "idle-gap"
    return "timeout"


# --------------------------------------------------------------------------- #
# Public entry points
# --------------------------------------------------------------------------- #
async def run_turn_async(
    base_url: str,
    session_config: dict,
    wav_path: str,
    timeout_s: float = 30.0,
    *,
    warmup_budget_s: float = 15.0,
    greeting_grace_s: float = 3.0,
    greeting_settle_s: float = 1.2,
    idle_gap_s: float = 2.5,
    realtime: bool = True,
    debug: bool = False,
    capture_prefix: str | None = None,
) -> dict:
    result = {
        "connected": False,
        "user_transcript": "",
        "bot_text": "",
        "bot_audio_seconds": 0.0,
        "time_to_first_bot_audio_s": None,
        "time_to_greeting_audio_s": None,
        "hang": False,
        "error": None,
        "greeting_seconds": 0.0,
        "bot_ready": False,
        "finish_reason": None,
        "tools_called": [],
        "turn_wav": None,
        "greeting_wav": None,
        "turn_audio_rate": None,
    }
    try:
        session_id = await asyncio.to_thread(_post_session_config, base_url, session_config)
        result["session_id"] = session_id
    except Exception as exc:  # noqa: BLE001
        result["error"] = f"session-config: {exc}"
        return result

    pcm = _load_pcm16(wav_path)
    state = _State()
    try:
        async with websockets.connect(
            _ws_url(base_url, session_id), max_size=None, ping_interval=None, open_timeout=15
        ) as ws:
            result["connected"] = True
            recv = asyncio.create_task(_receiver(ws, state))

            await ws.send(_client_ready_frame())
            state.client_ready_ts = time.monotonic()
            state.log("sent client-ready")
            await _await_greeting(state, greeting_grace_s, greeting_settle_s, warmup_budget_s)

            # ---- the measured turn ----
            state.phase = "turn"
            state.log("sending user audio")
            await _send_audio(ws, pcm, realtime)
            state.end_speech_ts = time.monotonic()
            state.log("user speech sent; sending trailing silence")
            await _send_silence(ws, TRAILING_SILENCE_S, realtime)

            reason = await _await_response(state, timeout_s, idle_gap_s)
            result["finish_reason"] = reason
            recv.cancel()
            try:
                await recv
            except asyncio.CancelledError:
                pass
    except Exception as exc:  # noqa: BLE001
        result["error"] = f"{type(exc).__name__}: {exc}"
        if debug:
            result["events"] = state.events
        return result

    # ---- metrics ----
    if state.fatal:
        result["error"] = state.fatal

    t = state.turn
    result["bot_ready"] = state.bot_ready
    result["greeting_seconds"] = round(state.warmup.audio_bytes / (2 * state.warmup.audio_rate), 2)
    result["user_transcript"] = _merge_transcripts(state.user_transcripts)
    bot_text = " ".join(state.bot_tts_text).strip() or " ".join(state.bot_llm_text).strip()
    if not bot_text:
        bot_text = " ".join(state.text_frames).strip()
    result["bot_text"] = bot_text
    result["bot_audio_seconds"] = round(t.audio_bytes / (2 * t.audio_rate), 2)
    result["turn_audio_rate"] = t.audio_rate
    if t.first_audio_ts and state.end_speech_ts:
        result["time_to_first_bot_audio_s"] = round(t.first_audio_ts - state.end_speech_ts, 2)
    # Welcome-message latency: from client-ready (which triggers the opening
    # greeting) to the first greeting audio chunk the user actually hears.
    if state.warmup.first_audio_ts and state.client_ready_ts:
        result["time_to_greeting_audio_s"] = round(
            state.warmup.first_audio_ts - state.client_ready_ts, 2)
    result["bot_stopped_cleanly"] = t.stopped_speaking_ts is not None

    # Dump captured bot audio (greeting + measured turn) and a timing sidecar so
    # the analysis step can score intelligibility + spot dropouts/truncation.
    if capture_prefix:
        w = state.warmup
        if t.chunks:
            result["turn_wav"] = f"{capture_prefix}.turn.wav"
            _write_wav_bytes(result["turn_wav"], b"".join(t.chunks), t.audio_rate)
        if w.chunks:
            result["greeting_wav"] = f"{capture_prefix}.greeting.wav"
            _write_wav_bytes(result["greeting_wav"], b"".join(w.chunks), w.audio_rate)
        base = state.end_speech_ts or state.t0
        gbase = state.client_ready_ts or state.t0
        timing = {
            "turn_audio_rate": t.audio_rate,
            "greeting_audio_rate": w.audio_rate,
            "turn_chunk_offsets_s": [round(x - base, 3) for x in t.chunk_ts],
            "greeting_chunk_offsets_s": [round(x - gbase, 3) for x in w.chunk_ts],
        }
        with open(f"{capture_prefix}.timing.json", "w") as fh:
            json.dump(timing, fh)
    if state.latency_breakdown:
        events = state.latency_breakdown.get("events") or []
        result["latency_breakdown"] = events
        # Tool/function handlers show up in the latency breakdown as
        # "<snake_case_name>: <secs>s"; pipeline stages are "User turn" /
        # "NvidiaXxxService#n". This is an authoritative "which tools fired" signal.
        result["tools_called"] = sorted({
            m.group(1) for ev in events
            if (m := re.match(r"([a-z][a-z0-9_]+):", ev))
        })
    # hang == the bot never produced any reply (no audio and no text) in time.
    result["hang"] = reason == "timeout" and not (t.saw_audio or bot_text)
    if debug:
        result["events"] = state.events
    return result


def run_turn(base_url: str, session_config: dict, wav_path: str,
             timeout_s: float = 30.0, **kwargs) -> dict:
    """Synchronous wrapper around :func:`run_turn_async`. Never blocks forever:
    the whole call is bounded by ``timeout_s`` + the warmup budget."""
    hard_cap = timeout_s + kwargs.get("warmup_budget_s", 15.0) + 20.0
    try:
        return asyncio.run(
            asyncio.wait_for(
                run_turn_async(base_url, session_config, wav_path, timeout_s, **kwargs),
                timeout=hard_cap,
            )
        )
    except asyncio.TimeoutError:
        return {
            "connected": False, "user_transcript": "", "bot_text": "",
            "bot_audio_seconds": 0.0, "time_to_first_bot_audio_s": None,
            "hang": True, "error": f"hard timeout after {hard_cap:.0f}s",
        }


# --------------------------------------------------------------------------- #
# Debug probe:  python harness.py [slug-or-wav] [base_url]
# --------------------------------------------------------------------------- #
DEFAULT_CONFIG = {
    "pipeline_mode": "generic-assistant",
    "llm_id": "self-hosted:nemotron-nano",
    "asr_id": "self-hosted:nemotron-asr-streaming-english",
    "tts_id": "self-hosted:magpie-tts",
    "tts_voice_id": "Magpie-Multilingual.EN-US.Aria",
    "prompt_key": "generic_assistant",
}

if __name__ == "__main__":
    import sys
    from pathlib import Path

    arg = sys.argv[1] if len(sys.argv) > 1 else "introduce"
    base = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:7860"
    wav = arg if arg.endswith(".wav") else str(Path(__file__).resolve().parent / "audio" / f"{arg}.wav")

    print(f"Driving turn: wav={wav}  base={base}")
    out = run_turn(base, DEFAULT_CONFIG, wav, timeout_s=30, debug=True)
    events = out.pop("events", [])
    print("\n--- frame timeline ---")
    for e in events:
        print(e)
    print("\n--- result ---")
    print(json.dumps(out, indent=2))
