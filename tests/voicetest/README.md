# Headless voice-conversation test harness

A no-browser, no-microphone client that drives **full voice turns** against the
Nemotron Voice Agent over its WebSocket transport, so pipelines can be tested
exhaustively for smoothness / hangs / no-response.

It reproduces exactly what the browser does
(`WebSocketTransport({ serializer: new ProtobufFrameSerializer(),
recorderSampleRate: 16000, playerSampleRate: 16000 })` in `client/src/App.tsx`)
but from Python: it POSTs a session config, opens the WebSocket, streams a
spoken WAV as audio frames, and collects the transcript, the bot's text, and the
bot's TTS audio back.

```
tests/voicetest/
├── pcframes.py        # tiny dependency-free codec for the pipecat protobuf Frame wire format
├── harness.py         # run_turn(...) — drives one voice turn, returns metrics
├── gen_audio.py       # synthesizes the test WAVs with Piper (offline TTS)
├── run_tests.py       # runs a suite of turns and prints a pass/fail table
├── requirements.txt
├── audio/             # generated 16 kHz mono PCM16 WAVs  (git-ignored, regenerable)
└── models/            # Piper voice model  (git-ignored, auto-downloaded)
```

---

## Quick start

```bash
# 1. deps (use the shared venv or any Python 3.10+)
pip install -r tests/voicetest/requirements.txt

# 2. make sure the backend is reachable at http://localhost:7860
#    (it is a port-forward to the cluster app):
kubectl port-forward -n voice-agent svc/nemotron-voice-agent 7860:7860 &

# 3. generate the test audio (auto-downloads the Piper voice on first run)
python tests/voicetest/gen_audio.py

# 4. run the whole suite
python tests/voicetest/run_tests.py
```

Drive a single utterance with a full frame timeline (handy for debugging):

```bash
python tests/voicetest/harness.py introduce      # or: weather / currency / time / bmi / path/to.wav
```

Useful `run_tests.py` flags:

| flag | meaning |
|------|---------|
| `weather bmi …` | run only the named utterances (default: all) |
| `--base URL`    | backend base URL (default `http://localhost:7860`) |
| `--llm ID`      | override the LLM, e.g. `--llm self-hosted:nemotron-super` |
| `--timeout S`   | per-turn response timeout in seconds (default 30) |
| `--regen`       | (re)generate the WAVs first |
| `--json PATH`   | also dump the raw per-turn results |

---

## The protocol (what the harness actually does)

**Transport:** `ws://localhost:7860/api/ws?session_id=<id>`. Before connecting you
POST the pipeline config to `/api/session-config` and get back a `session_id`:

```json
{"pipeline_mode":"generic-assistant",
 "llm_id":"self-hosted:nemotron-nano",
 "asr_id":"self-hosted:nemotron-asr-streaming-english",
 "tts_id":"self-hosted:magpie-tts",
 "tts_voice_id":"Magpie-Multilingual.EN-US.Aria",
 "prompt_key":"generic_assistant"}
```

**Framing:** every WS message is a protobuf `pipecat.Frame` with a `oneof`:

| field | # | message | used for |
|-------|---|---------|----------|
| `text`          | 1 | `TextFrame{id,name,text}` | (occasionally) bot text |
| `audio`         | 2 | `AudioRawFrame{id,name,audio,sample_rate,num_channels,pts}` | mic audio out / bot TTS audio in |
| `transcription` | 3 | `TranscriptionFrame{id,name,text,user_id,timestamp}` | the user's ASR transcript |
| `message`       | 4 | `MessageFrame{data}` | RTVI control messages (`data` = JSON) |

Field numbers/types were read out of the shipped
`@pipecat-ai/websocket-transport` bundle and are byte-for-byte reimplemented in
`pcframes.py`, so **neither `pipecat-ai` nor a protoc toolchain is needed**.

Audio is **PCM16 mono @ 16000 Hz**.

**A turn, step by step (`harness.run_turn`):**

1. `POST /api/session-config` → `session_id`; open the WebSocket.
2. Send an RTVI **`client-ready`** message (a `MessageFrame` whose `data` is
   `{"label":"rtvi-ai","type":"client-ready","data":{"version":"1.4.0",...}}`).
   **This is required** — the server's `on_client_ready` handler is what queues
   the first `LLMRunFrame` (the opening greeting). Without it the bot never
   starts.
3. Wait for that greeting to finish (bounded), so the measured turn is clean.
4. Stream the WAV as a sequence of `InputAudioRawFrame`s — 20 ms / 320-sample
   PCM16 chunks — **paced in real time**, then ~0.8 s of trailing **silence**.
   There is no explicit "end of turn" frame: the server-side Silero VAD
   (`stop_secs=0.2`) detects end-of-speech from the trailing silence and fires
   the turn.
5. Collect the reply and finish on the RTVI **`bot-stopped-speaking`** message
   (or an idle-gap fallback, or a hard timeout → `hang`).

**Signals captured on the way back:**

- user transcript ← `TranscriptionFrame` + RTVI `user-transcription` +
  RTVI `server-message`/`user-turn-finalized` (merged & de-duped)
- bot text ← RTVI `bot-tts-text` (what is actually spoken), falling back to
  `bot-llm-text` / `TextFrame`
- bot audio ← `AudioRawFrame`s tagged as bot TTS (bytes summed → seconds)
- turn boundaries ← RTVI `bot-started-speaking` / `bot-stopped-speaking`
- latency + tool telemetry ← RTVI `server-message`/`latency-breakdown`
  (this pipeline emits a per-stage breakdown, including per-tool timings such as
  `convert_currency: 0.110s`, which is an **authoritative "which tools fired"**
  signal)

---

## `run_turn` return value

```python
from harness import run_turn, DEFAULT_CONFIG
res = run_turn("http://localhost:7860", DEFAULT_CONFIG, "audio/weather.wav", timeout_s=30)
```

| key | meaning |
|-----|---------|
| `connected` | WebSocket opened successfully |
| `user_transcript` | what ASR heard (should match the utterance) |
| `bot_text` | the bot's spoken reply text |
| `bot_audio_seconds` | seconds of TTS audio the bot sent back for the turn |
| `time_to_first_bot_audio_s` | latency from end-of-user-speech to the first bot audio chunk (includes the ~0.2 s VAD stop delay + ASR finalize + LLM + first TTS chunk) |
| `hang` | `True` iff the bot produced **no** reply (no audio and no text) before timeout |
| `error` | connection/config error string, else `None` |
| `tools_called` | tool/function handlers that actually ran (from the latency breakdown) |
| `greeting_seconds`, `bot_ready`, `finish_reason`, `bot_stopped_cleanly`, `latency_breakdown` | extra diagnostics |

The harness **never blocks forever**: the whole call is bounded by
`timeout_s` + the warm-up budget, and a bad/undecodable frame can never kill the
receive loop.

### Suite pass criteria (`run_tests.py`)

A turn **PASSES** when: it connected, the utterance was transcribed, the bot
replied with **both** text and audio, there was no hang, and the reply matched
the expected content (a per-utterance regex — e.g. `weather` must mention Tokyo
**and** a number, so a degenerate "Tokyo weather" with no data fails). The
expected tool for each utterance is shown for diagnosis via `tools_called`, but
is **not** a hard gate, because the model sometimes self-computes (e.g. BMI)
instead of calling the tool.

---

## Test utterances

| slug | text | exercises |
|------|------|-----------|
| `introduce` | "Hello, please introduce yourself." | plain LLM reply |
| `weather`   | "What's the weather in Tokyo?" | `get_weather` tool |
| `currency`  | "Convert one hundred dollars to euros." | `convert_currency` tool |
| `time`      | "What time is it in London?" | `get_current_date_time` tool |
| `bmi`       | "What is my B M I if I weigh seventy kilograms and am one point seven five meters tall?" | `calculate_bmi` tool |

Audio is synthesized offline with **Piper** (`en_US-lessac-medium`, 22050 Hz)
and resampled to 16000 Hz with `soxr` — real, intelligible speech so the ASR has
something genuine to transcribe.

---

## Rough edges / gotchas

- **The bot always greets first.** `on_client_ready` queues an opening
  "introduce yourself" `LLMRunFrame`, so every session starts with a greeting.
  The harness waits it out before the measured turn (`greeting_seconds` in the
  result). This dominates wall-clock time (~3–9 s per turn).
- **Tool-calling on `nemotron-nano` is non-deterministic.** For the same
  "What's the weather in Tokyo?" the model sometimes calls `get_weather` and
  speaks the real result, and sometimes **self-answers / hallucinates**
  (e.g. a made-up "12:34 PM in London", or a degenerate "Tokyo, celsius" with no
  data). `tools_called` exposes exactly which happened. `--llm
  self-hosted:nemotron-super` calls the tools far more reliably. Because of this,
  a `weather` FAIL in the table is usually the *model*, not the harness — re-run
  to see it flip.
- **Streaming ASR wants real-time pacing.** Audio is sent at 20 ms/chunk in real
  time; blasting it can degrade the cache-aware streaming ASR. This makes a turn
  take at least as long as the utterance.
- **Single worker.** If the server is in multi-worker mode it rejects
  session-config WebSockets (`code 1013`); this harness targets the standard
  single-worker session-config flow.

---

## Validation (measured against live `generic-assistant` @ localhost:7860)

```
utterance   conn xscript reply audio_s ttfa_s content hang status
introduce   Y    ok      ok       7.40   0.59  ok      -    PASS
weather     Y    ok      ok       7.80   0.76  ok      -    PASS
currency    Y    ok      ok       2.50   1.22  ok      -    PASS   (tool: convert_currency fired)
time        Y    ok      ok       2.40   0.83  ok      -    PASS
bmi         Y    ok      ok      10.30   0.67  ok      -    PASS
```

Representative turns:

- **introduce** → transcript "Hello, please introduce yourself"; bot "I am
  Nemotron, created by NVIDIA, ready to assist you." — first bot audio ~0.6 s.
- **weather** → transcript "What's the weather in Tokyo"; when the tool fires:
  "The weather in Tokyo is clear with a temperature of 22.0 °C, humidity at 55%,
  and wind blowing east at 8.0 kph." (`get_weather` fired) — first bot audio
  ~0.8–1.3 s.

Typical stage latencies (from the pipeline's own breakdown): ASR TTFB ~0.3–0.6 s,
LLM TTFB ~0.14 s, TTS TTFB ~0.12 s.
```
