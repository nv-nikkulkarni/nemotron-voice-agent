# PoC — session logkeeper + direct-to-NIM warmup (viking)

> **Status:** §1 `nim-warmup` is unrelated to capture and still current. §2
> `session-logkeeper` is **superseded** -- the sidecar-based approach below
> (`AUDIO_DUMP_PATH` + a PVC-reading logkeeper pod) predates `src/session_store/` and
> has been replaced by fully in-process capture: the app writes artifacts directly
> through a pluggable object store (local files or S3/SeaweedFS) and finalizes them
> itself, no sidecar. Refer to `docs/current-deployed-pipeline-architecture.md` for the
> current design and `nvcf_helm/values.yaml`'s `sessionCapture`/`sessionStore` blocks for the
> real deploy path. §3 `session-dashboard` is still valid -- it only reads a tarball
> back out of NGC by session id, independent of how that tarball was produced.

Two independent sidecar pods, both **reusing the app image** (no new image to build:
it already ships `curl`, `tar`, the venv `python`, and the Riva client).

## 1. `nim-warmup` — the clean replacement for the app-hammering prewarmer

The chart's old prewarmer POSTed `/api/session-config` in a fast-retry loop, which
starved the app's **single uvicorn worker** on NVCF (function went ACTIVE but every
external invocation 504'd). This pod instead warms **each NIM's own server
directly** and **never touches the app**, so it structurally can't starve it.

| NIM | how it's warmed |
|-----|-----------------|
| Nano / Super / Omni (LLM) | `curl POST /v1/chat/completions` (HTTP) |
| Chatterbox / Magpie (TTS) | `warmup_tts_synthesis()` — a real Riva `synthesize_online("Hello.")` |
| ASR | `prewarm_asr()` — a real Riva config request |

TTS/ASR are Riva **gRPC** (not curl-able), so they use the app's bundled
`examples.shared.prewarm` helpers. One pass at boot + a gentle keep-alive every
`KEEPALIVE` (300 s), each target independent — no retry storm.

```bash
kubectl apply -f nim-warmup.yaml
kubectl logs -n voice-agent -l app.kubernetes.io/component=nim-warmup | grep 'warmup:'
# warmup: LLM nano hot / super hot / omni hot / TTS chatterbox hot / magpie hot / ASR hot
```

## 2. `session-logkeeper` — per-session capture → tarball

On every session **end** (the user clicks End → the app logs
`[stream_id=<session_id>] Client disconnected`), the collector builds
`<session_id>.tar.gz` on a shared PVC containing:
- **`session.log`** — the app log grepped by `session_id` (the app tags every line
  `[stream_id=<session_id>]`, and `stream_id == session_id`).
- **`transcript.txt`** — the queries + responses in text (uploaded by the client; see
  consent flow below).
- **the full session audio** — the ASR input WAVs (`asr_*`) and TTS output WAVs
  (`tts_*`) for that session.

It reads pod logs via the **k8s API with its ServiceAccount token** (no `kubectl`
binary needed), correlates the audio file-id from the app log
(`Audio recorder enabled ... stream=<id>`) — so **no app source change** — then frees
the raw WAVs, keeping only the tarball.

The pod has THREE containers: **`logkeeper`** (capture → tarball), **`uploader`**
(ship each tarball to NGC as `0491162300748285/session-captures:<session_id>`, then
delete it locally — idempotent: if the version already exists in NGC it just frees
the local copy; interval `UPLOAD_INTERVAL` = 60 s; reads the org key from the
`ngc-api` secret), and **`receiver`** (the consent + transcript endpoint below).

### Consent + transcript (client-driven — app stays pristine)
The app dumps ASR/TTS audio for **every** session (a global env gate), but a session
is only **stored** when the user **consents**. Consent + the text transcript come from
the **client**, not the app pipeline:
1. The landing page has a **"Store my audio…" consent checkbox** (`storeConsent`).
2. At session end the UI POSTs `{session_id, consent, transcript}` to same-origin
   **`/capture/session`** (`astra_client/src/demo/sessionCapture.ts`). The transcript is
   exactly what the UI just rendered.
3. The UI's nginx proxies `/capture/*` → the **`receiver`** container (`receiver.py`,
   Service `session-capture-receiver:8080`), which writes `<sid>.consent` (+
   `<sid>.transcript.txt` when consented) onto the PVC.
4. `collect.sh` waits briefly for that marker, then: **consent=true** → bundle
   `session.log + transcript.txt + WAVs` and upload; **otherwise** → **discard** the
   session's dumped audio and store nothing.

Wiring the proxy (viking's UI runs as a LOCAL container, so it reaches the in-cluster
receiver via a host port-forward, mirroring `pf-viking`):
```bash
# port-forward the receiver Service to a host port (e.g. 7863)
docker run -d --name pf-logkeeper --network host -v /home/nikkulkarni/.kube:/home/kubeuser/.kube \
  bitnami/kubectl:latest port-forward -n voice-agent svc/session-capture-receiver 7863:8080 --address 0.0.0.0
# then run the UI container with CAPTURE_ORIGIN so nginx renders the /capture/ proxy:
#   -e CAPTURE_ORIGIN=http://host.docker.internal:7863
```

### Deploy
```bash
# a) enable the app's built-in per-turn audio dump to a shared PVC (env only):
kubectl set env deploy/voice-agent-nemotron-voice-agent -n voice-agent -c app \
  ENABLE_ASR_AUDIO_DUMP=true ENABLE_TTS_AUDIO_DUMP=true AUDIO_DUMP_PATH=/session-data/audio
kubectl patch deploy/voice-agent-nemotron-voice-agent -n voice-agent --type strategic -p '{
  "spec":{"template":{"spec":{
    "volumes":[{"name":"session-data","persistentVolumeClaim":{"claimName":"session-data"}}],
    "containers":[{"name":"app","volumeMounts":[{"name":"session-data","mountPath":"/session-data"}]}]}}}}'
# (in production, bake these into the chart's app Deployment + values instead of patching)

# b) PVC + RBAC + collector + uploader (self-contained):
kubectl apply -f session-logkeeper.yaml

# c) one-time: stage the ngc CLI into the PVC (no `unzip` in the app image, so ship
#    the standalone CLI as a tarball and extract it in-pod). The uploader skips
#    (harmlessly) until this exists at /session-data/tools/ngc-cli/ngc:
tar czf /tmp/ngc-cli.tgz -C <path-with>/ngc-cli-dir ngc-cli
LK=$(kubectl get pod -n voice-agent -l app.kubernetes.io/component=session-logkeeper -o name | head -1)
kubectl exec -n voice-agent ${LK#pod/} -c uploader -- mkdir -p /session-data/tools
kubectl cp /tmp/ngc-cli.tgz voice-agent/${LK#pod/}:/session-data/tools/ngc-cli.tgz -c uploader
kubectl exec -n voice-agent ${LK#pod/} -c uploader -- sh -c 'cd /session-data/tools && tar xzf ngc-cli.tgz'
# The session-captures resource is created once:
ngc registry resource create 0491162300748285/session-captures \
  --application OTHER --framework Other --format OTHER --precision OTHER \
  --short-desc "Voice-agent per-session captures (app log + ASR/TTS audio) keyed by session_id"
```

### Verified end-to-end (viking)
Drove sessions via `tests/voicetest/harness.py`; each disconnect produced
`<session_id>.tar.gz` = `session.log + asr_*.wav + tts_*.wav`, which the uploader
then shipped to NGC and freed. e.g. session `e40f12246035`:
```
logkeeper: CAPTURED e40f12246035  (session.log + 3 wavs)
uploader:  uploaded + freed e40f12246035 -> 0491162300748285/session-captures:e40f12246035
# NGC: session-captures:e40f12246035  UPLOAD_COMPLETE  435.99 KB ; local tarball gone
```

## 3. `session-dashboard` — inspect a captured session (self-contained container)

A **standalone** dashboard container (`dashboard/`) — fully decoupled from the cluster,
the logkeeper, and the `ngc` CLI. Given a session id it downloads `session-captures:<id>`
**straight from NGC over REST** (with the API key you pass in), extracts it, and shows:
- **Audio** — one **continuous session timeline**: waveform with ASR/TTS **segment bands**,
  a **play/seek head**, and a **drag-to-measure span tool** (reports the selected duration)
  to time any part of the session; each segment is listed with its duration.
- **Transcript** — chat bubbles. **Logs** — the full `session.log`, filterable.

Runs anywhere Docker runs — see `dashboard/README.md`:
```bash
docker build -t session-dashboard poc/session-capture/dashboard
docker run --rm -e NGC_API_KEY=<your-ngc-key> -p 7870:8090 session-dashboard
# open http://localhost:7870/?sid=<session_id>
```
Pure Python stdlib (urllib): API key → bearer token → follow the version file's signed
302. Verified on `e54751b76240` (downloaded from NGC in ~4.5s → 30.19s timeline, 9
segment bands, drag-measure + segment durations working). The Audio tab **concatenates**
per-turn clips (no raw recording is captured yet) — see the full-recording note below.

## Notes / next steps
- **Full-session single recording**: currently per-turn WAVs (ASR + TTS) are bundled;
  a mix/concat step (ffmpeg/soxr) could produce one interleaved session `.wav`.
- **PVC is RWO** (viking single node — app + collector co-located). On multi-node
  you'd need RWX (NFS/CephFS) or a per-node collector.
- These manifests are **viking-specific** (app image `nvcr.io/nim/nvidia/...:demo7`,
  in-cluster NIM service names). Adapt the image ref + service names for NVCF/Astra.
