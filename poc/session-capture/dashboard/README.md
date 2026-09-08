# Session Capture Dashboard — self-contained, runs anywhere with Docker

A single container that visualizes a captured session. It is **fully decoupled** from
the cluster and the logkeeper: given a session id it downloads
`session-captures:<id>` **straight from NGC over the REST API** (using the API key you
pass in), extracts the tar, and serves a dashboard. No cluster, no `ngc` CLI, no shared
PVC, no port-forwards.

## Run
```bash
docker build -t session-dashboard poc/session-capture/dashboard
docker run --rm -e NGC_API_KEY=<your-ngc-key> -p 7870:8090 session-dashboard
# open http://localhost:7870   (or http://localhost:7870/?sid=<session_id>)
```
The container **refuses to start without `NGC_API_KEY`** (or `NGC_CLI_API_KEY`). The key
must be able to read `NGC_ORG/NGC_RESOURCE` (defaults `0491162300748285/session-captures`).
Optional env: `NGC_ORG`, `NGC_RESOURCE`, `PORT` (default 8090), `CACHE_DIR`.

## What it shows
Enter a session id → three tabs:
- **Audio** — a single **continuous session timeline**: waveform with **ASR (user) / TTS
  (bot) segment bands**, a **play/seek head**, and a **drag-to-measure span tool** that
  reports the selected duration (e.g. `span: 2.65s (0:09.04 → 0:11.69)`) so you can time
  any part of the session. Click = seek; drag = measure; each segment is also listed with
  its duration and is click-to-select.
- **Transcript** — `transcript.txt` as user/assistant chat bubbles.
- **Logs** — the full `session.log`, filterable.

## How NGC download works (pure stdlib)
1. API key → bearer token: `GET https://authn.nvidia.com/token?service=ngc&scope=group/ngc:<org>` (Basic `$oauthtoken:<key>`).
2. `GET …/resources/<res>/versions/<sid>/files/<sid>.tar.gz` → **302** to a signed URL → fetch the file (the signed URL needs no auth).
3. Extract + scan for `session.log`, `transcript.txt`, `asr_*.wav`, `tts_*.wav` (+ a
   `session.{wav,webm,…}` full recording if one is present).

## About "full-session audio, recorded as it is"
The server-side capture currently stores **per-turn** ASR/TTS clips (no single raw
recording), so the Audio tab **concatenates** them into one timeline — great for measuring
each segment's duration, but it does **not** include the real inter-turn gaps (thinking /
latency). For a true "as-recorded" continuous recording **without app-side changes**, the
demo UI's own browser recorder (`useSessionRecorder.ts`, the "Record this session"
MediaRecorder that mixes mic + bot audio) can be uploaded via the same client→capture path
used for the transcript/consent; the logkeeper would bundle it as `session.<ext>`. This
dashboard already prefers that file (`sessionAudio`) when present and shows it directly.
