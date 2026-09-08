# Enable the Audio Recorder

The audio recorder captures raw ASR/TTS audio for debugging and issue reproduction. Each conversation turn is saved as a separate WAV file for easy analysis.

Audio is written through `session_store` (`src/session_store/`), the same pluggable
object-store package session capture uses for logs and transcripts — not directly to a
local path. Refer to [Session capture and NGC publication](../current-deployed-pipeline-architecture.md#14-session-capture-and-ngc-publication) for the full design.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `ENABLE_ASR_AUDIO_DUMP` | `false` | Capture incoming user audio (per turn) |
| `ENABLE_TTS_AUDIO_DUMP` | `false` | Capture outgoing synthesized audio (per turn) |
| `SESSION_STORE_BACKEND` | `local` | Where WAVs land: `local` (per-pod files) or `s3` (SeaweedFS/MinIO/S3 — needed for replica-safe capture; see the `capture` compose profile / chart `sessionStore` block) |
| `SESSION_STORE_LOCAL_ROOT` | `/tmp/session-store` | Root directory when `SESSION_STORE_BACKEND=local` |

To enable the audio recorder, set the environment variables in the `.env` file:

```bash
ENABLE_ASR_AUDIO_DUMP=true
ENABLE_TTS_AUDIO_DUMP=true
```

The shipped examples already create and wire the shared recorder, so the `.env` settings are enough to enable capture for those examples. To add the recorder to a **new custom example**, mirror [`src/examples/generic/pipeline.py`](../../src/examples/generic/pipeline.py) with three changes to your `pipeline.py`:

1. Import the helper:

    ```python
    from examples.shared.audio_recorder import create_audio_recorder
    ```

2. Create the recorder with the pipeline's real `session_id` and add it to the pipeline. `create_audio_recorder()` returns `None` when both ASR and TTS dump flags are off, **or** when there's no real session id to attach the recording to (anonymous connects) — since coordination state and finalize both key off that same id, audio written under any other id would never be found, uploaded, or cleaned up:

    ```python
    audio_recorder = create_audio_recorder(body.get("session_id", ""))

    pipeline = Pipeline(
        [
            transport.input(),
            # ... ASR, LLM, TTS, transport.output() ...
            *([audio_recorder] if audio_recorder else []),
        ]
    )
    ```

3. Start it once the client connects (for example, in your `on_client_connected` handler):

    ```python
    if audio_recorder:
        await audio_recorder.start_recording()
    ```

With those in place, the `ENABLE_ASR_AUDIO_DUMP` / `ENABLE_TTS_AUDIO_DUMP` settings above control capture for your custom example.

## Output Format

Files are saved as 16-bit mono PCM WAV with per-turn indexing, under the configured `session_store` backend:

```text
sessions/<session_id>/audio/
├── asr_000.wav   # User turn 0
├── asr_001.wav   # User turn 1
├── tts_000.wav   # Bot turn 0
├── tts_001.wav   # Bot turn 1
└── ...
```

`<session_id>` is the pipeline's real session id (server-minted hex, sanitized before use — see `session_store/keys.py`), so files from concurrent sessions do not collide and the same id is what session capture's coordination state and finalize step key off.

With the default `local` backend, inspect files directly under the configured root (`SESSION_STORE_LOCAL_ROOT`, default `/tmp/session-store`) — inside the container for Docker Compose runs, or `docker exec`/mount it out. With `s3`, use any S3-compatible client against the configured endpoint/bucket.

> **Warning:** Disable the audio recorder in production to prevent disk/store exhaustion.
