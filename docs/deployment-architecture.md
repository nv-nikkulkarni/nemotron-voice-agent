# Nemotron Voice Agent — Deployment Architecture

End-to-end view of every component and data flow on the managed **NVCF + Astra** target,
plus the **staging (“preview”) lane** that mirrors prod for safe pre-release testing.

> **What shaped this design — three hard NVCF constraints (learned the hard way):**
> 1. **Single-port gateway.** Only the app's `:7860` is externally reachable — NIM ports
>    and any extra sidecar ports are not. Consent/transcript therefore arrive over the
>    app's own `/api/session-capture` route, not a separate receiver port.
> 2. **No ServiceAccount token** is mounted in pods → nothing can call the k8s API
>    (rules out log-scraping / any RBAC-based sidecar).
> 3. **Sidecar containers are opaque** — they return no retrievable logs and can't be
>    relied on, and `instance execute` only drops you into a locked-down *sandbox*, not the
>    real container. So **session capture runs inside the app process**, not in sidecars.

---

## 1. Full topology (NVCF + Astra)

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ USER — browser                                                                           │
│   🎙 mic   🔊 speaker   📷 webcam / 🖼 media   (pipecat client-js, SafeProtobuf serializer)│
└───────┬──────────────────────────────────────────────────────────────────────────────────┘
        │  HTTPS (SPA + /api/*)      WSS (voice)
        ▼
┌──────────────────────────────────────────────────────────────────┐
│ ASTRA — UI hosting (fusion → JFrog image; nginx + React SPA)     │
│   nginx is a thin, function-AGNOSTIC proxy. The target NVCF       │
│   function is chosen ONLY by runtime env from a Vault secret      │
│   (NVCF_HOST / NVCF_FUNCTION_ID / NVIDIA_API_KEY), rendered into  │
│   the nginx config at container start. Same image serves any fn.  │
│     /api/ws               ─► wss://grpc.nvcf.nvidia.com (+function-id header)   voice   │
│     /api/*  /health       ─► https://<fn-id>.invocation.api.nvcf… (+function-id) config │
│     /api/session-capture  ─┘   consent + transcript                                     │
│     /api/session-capture/status ─┘  ops/debug status JSON (backend, pending count)     │
└───────┬──────────────────────────────────────────────────────────┘
        │  (auth: Bearer <nvapi key> + function-id header, injected by nginx)
        ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ NVCF FUNCTION — Helm chart on DGXC-K8s (1× 8×H100 node, always-on)                        │
│   single-port gateway → app:7860 only                                                    │
│                                                                                          │
│  ┌──────────────────────────────  APP POD  ──────────────────────────────┐               │
│  │  [app]  uvicorn + FastAPI + pipecat  (:7860)                           │               │
│  │    • ASR→LLM→TTS pipeline orchestration (tools: web_search, bmi, …)     │               │
│  │    • per-turn audio recorder   ─► session_store (local, or SeaweedFS)   │               │
│  │    • per-session loguru sink   ─► /session-data/logs/<sid>.log (scratch)│               │
│  │    • POST /api/session-capture ─► session_store: transcript.txt         │               │
│  │        + Redis: consent_done (cross-pod coordination, see §3)           │               │
│  │    • both signals ready (Redis) → owner-token lock → tar (log+          │               │
│  │        transcript+audio, read from session_store) → upload via baked   │──┐            │
│  │        ngc CLI → session_store cleanup                                  │  │  NGC upload│
│  │                     │  reads + writes                                   │  │  (key from │
│  │                     ▼                                                   │  │  secrets   │
│  │        ╔═══════════════════════════════════╗  oci-bv PVC (RWO) — LOCAL │  │  .json)    │
│  │        ║  /session-data/{capture,logs}     ║  SCRATCH only, not the    │  │            │
│  │        ║  (app-local; NOT the archive)     ║  cross-pod mechanism      │  │            │
│  │        ╚═══════════════════════════════════╝                           │  │            │
│  │    NO sidecars, NO k8s API, NO ServiceAccount — all in-process; Redis  │  │            │
│  │    + SeaweedFS (both opt-in, own pods below) make this replica-safe    │  │            │
│  └───────────────────────────┬────────────────────────────────────────────┘  │            │
│         gRPC (Riva) / HTTP (vLLM)                                              │            │
│                              ▼                                                 │            │
│  ┌──────────────────────────────────────────────────────────────┐            │            │
│  │ NIM pods (all local; disableCloudServices)                     │           │            │
│  │   ASR  nemotron-asr-streaming-english  (Riva gRPC :50052)       │          │            │
│  │   ASR  parakeet  (alt)                                          │          │            │
│  │   LLM  nvidia-llm (Nano)               (vLLM HTTP :8000)         │          │            │
│  │   LLM  nemotron-3-super (120B, tp2)    (vLLM HTTP :8000)         │          │            │
│  │   LLM  nvidia-llm-vllm-omni            (vLLM HTTP :8002)         │          │            │
│  │   TTS  tts-service (Magpie)            (Riva gRPC :50051)        │          │            │
│  │   TTS  chatterbox-tts-service          (Riva gRPC :50051)        │          │            │
│  └───────────────▲────────────────────────────────────────────────┘          │            │
│  ┌───────────────┴─────────────────────┐  warms each NIM directly at boot     │            │
│  │ [prewarmer]  LLM /chat/completions   │  (own pod; never touches the app)    │            │
│  │   + Riva gRPC warm (ASR + both TTS)  │                                      │            │
│  └──────────────────────────────────────┘                                     │            │
└───────────────────────────────────────────────────────────────────────────────┼───────────┘
                                                                                 ▼
                                                          ┌──────────────────────────────┐
                                                          │ NGC registry                 │
                                                          │  0491162300748285/           │
                                                          │  session-captures:<sid>      │
                                                          │  (tar = log+transcript+WAVs) │
                                                          └───────────────▲──────────────┘
                                                                          │ download (REST + API key)
                                                          ┌───────────────┴──────────────┐
                                                          │ SESSION DASHBOARD            │
                                                          │  self-contained Docker,      │
                                                          │  local → localhost:7870      │
                                                          │  audio + transcript + logs   │
                                                          └──────────────────────────────┘
```

---

## 2. One voice turn — the pipeline dataflow

```
🎙 mic ─PCM→ [app] ─gRPC→ ASR ──text──► LLM ──text──► TTS ─PCM→ [app] ─audio→ 🔊 speaker
                │                (tools: web_search, bmi, random, …)      │
                └── recorder writes asr_000.wav ─┐   ┌─ tts_000.wav ─────┘
                                                 ▼   ▼
                                    session_store: sessions/<session_id>/audio/*.wav
```

Audio is keyed directly by the pipeline's own `session_id` (no separate id/mapping step —
`src/session_store/keys.py`), written through whichever backend `session_store` is
configured with (local files, or a shared S3-compatible store; see §3). Every log line is
tagged `[stream_id=<session_id>]` (loguru `contextualize` on `/api/ws`) and mirrored to a
local scratch file, `<SESSION_LOG_PATH>/<sid>.log` — the hot per-line append path, never
worth a network write per line.

---

## 3. Session capture — consent, capture, upload (replica-safe, 100% in the app process)

Two independent signals must both land before a session finalizes — the pipeline
finishing (log + audio written) and the browser's consent POST — and either can land on
a **different pod** than the other, at `app.replicas > 1`. Coordination crosses pods via
Redis (`src/session_capture/state.py`); artifacts cross pods via `session_store`
(`src/session_store/`, local files or S3/SeaweedFS). Full design + the defect this
replaced. Refer to `docs/current-deployed-pipeline-architecture.md` for the current design.

```
   POD A (ran the pipeline)              POD B (got the consent POST)
   ┌─────────────────────────┐           ┌─────────────────────────┐
   │ on_pipeline_finished:    │           │ POST /api/session-capture│
   │  session_store.put(log)  │           │  session_store.put(txt)  │
   │  state.mark_pipeline_done│           │  state.mark_consent      │
   └────────────┬─────────────┘           └────────────┬─────────────┘
                │                                       │
                ▼                                       ▼
        ┌──────────────────────── session_store (shared) ─────────────────────────┐
        │  sessions/<sid>/{session.log, transcript.txt, audio/{asr,tts}_NNN.wav}  │
        └───────────────────────────────────────────────────────────────────────┘
                │                                       │
                └───────────────┬───────────────────────┘
                                 ▼
                  Redis: cap:<sid> {pipeline_done, consent_done, consent}
                  both signals present → maybe_finalize() on whichever pod
                  observes it, guarded by an owner-token lock (cap:lock:<sid>,
                  SET NX + Lua compare-and-delete release) so exactly one pod
                  finalizes regardless of which signal arrived last
                                 │
                consent=true    │    consent=false
                                 ▼
              tar session.log + transcript + WAVs
              → ngc registry resource upload-version → session_store cleanup
                                 │                          consent=false:
                                 ▼                    delete_prefix immediately
                    NGC  <org>/<resource>:<sid>       (routes.py, doesn't wait
                                                        for the pipeline signal)
```

- **`session_store` backend**: `local` (per-pod files — fine at `replicas=1`, or when
  the caller ensures artifacts and the finalizing pod always coincide) or `s3`
  (SeaweedFS/MinIO/S3 — required for correctness at `replicas > 1`; see chart's
  `sessionStore` block). The Helm chart hard-fails at template time if
  `sessionCapture.enabled` + `app.replicas > 1` is set without both `redis.enabled` and
  `sessionStore.enabled` — this combination previously failed **silently**: the
  finalizing pod could only see artifacts on its own disk and archived an incomplete (or
  empty) session while reporting success.
- **Reaper** (`src/session_capture/reaper.py`): periodic sweep that retries a
  ready-but-unfinalized session (the winning pod crashed mid-finalize) and abandons a
  session stuck with only one signal past `SESSION_CAPTURE_ORPHAN_TTL_SECS`. Never
  touches a session that finalized successfully with no NGC upload configured
  (`SESSION_CAPTURE_NGC` unset) — in that mode `session_store` **is** the archive, by
  design, not swept as an orphan.
- **ngc CLI baked into the app image** (`/app/ngc-cli/ngc`) — no runtime download. NGC key
  = the app's `NVIDIA_API_KEY` (the fn secret, exported from `/var/secrets/secrets.json`).
- **`GET /api/session-capture/status`**: `{enabled, ngc, ngc_cli_present, ngc_key_present,
  require_consent, store_backend, pending_sessions}` — deliberately lightweight (no
  object-store listing); `pending_sessions` is the size of the in-flight coordination
  set, the useful at-a-glance health signal on NVCF (container logs are flaky/opaque).
- Config env (chart): `SESSION_CAPTURE_PATH`, `SESSION_LOG_PATH`, `SESSION_CAPTURE_NGC`
  (`<org>/<resource>`), `SESSION_CAPTURE_REQUIRE_CONSENT`, `SESSION_STORE_BACKEND`,
  `SESSION_STORE_ENDPOINT`, `SESSION_STORE_BUCKET`.

---

## 4. Two lanes — production vs staging ("preview")

Identical topology; fully isolated (separate NVCF function + separate Astra app/Vault
secret; nothing shared). Promotion = re-point the **same artifacts** (chart version + app
image + UI image) at prod — nothing is rebuilt. See `docs/staging.md` for exact commands.

| | **Production** | **Staging ("preview")** |
|---|---|---|
| NVCF function | `81862ff8-…` (`nemotron-voice-agent`) | `d67e6989-…` (`nemotron-voice-agent-staging`) |
| GPU / backend | 1× `OCI.GPU.H100_8x` on `nvcf-dgxc-k8s-oci-nrt-prd6-1`, always-on | same |
| Astra app | `nemotron-voice-agent-deploy` | `nemotron-voice-agent-preview-deploy` |
| Astra URL | `nemotron-voice-agent-deploy-backend.stg.astra.nvidia.com` | `nemotron-voice-agent-preview-deploy-backend.stg.astra.nvidia.com` |
| Vault KV | `…/nemotron-voice-agent-deploy/stg` | `…/nemotron-voice-agent-preview-deploy/stg` |

> The UI image is function-agnostic, so both lanes can run the **same** JFrog tag — which
> function each talks to is decided purely by its Vault secret (`NVCF_HOST` /
> `NVCF_FUNCTION_ID` / `NVIDIA_API_KEY`). Promote by bumping the tag / chart version and
> re-pointing prod; the live app is never touched while staging is validated.

**Auth is three separate credentials:** org NGC apikey (manage functions, push chart, NIM
weight pulls, **capture upload**) · `nvapi-…` key (invocation/WS + `instance logs`/`execute`)
· `sk-…` LiteLLM virtual key (Perplexity `web_search`, backend-only).

---

## 5. Component inventory

| Component | Where it runs | Role |
|---|---|---|
| Browser + SPA | user's browser | mic/speaker/cam; pipecat client-js |
| UI (nginx + React) | Astra (prod + preview) | serve SPA + function-agnostic proxy (WS/HTTP/capture) |
| **app** | app pod (`:7860`) | pipecat pipeline; per-session log scratch; `/api/session-capture(/status)`; **in-process capture → tar → NGC** |
| ASR / LLM×3 / TTS×2 (NIMs) | NIM pods | speech-to-speech pipeline services |
| **prewarmer** | own pod (chart) | warm every NIM directly at boot + keep-alive |
| **oci-bv PVC** (`sessionCapture`) | app pod volume | app-local scratch only: `/session-data/{capture,logs}` (hot per-line log append, consent markers) — NOT where artifacts end up; see `session_store` below |
| **Redis** (`redis.enabled`, opt-in) | own pod (chart) | cross-pod: session_capture's two-signal coordination state + lock (`state.py`); also session_bus's webcam/attachment/config sharing |
| **session_store backend** | app-local files, or **SeaweedFS** (`sessionStore.enabled`, opt-in) | the actual home for capture artifacts (log/audio/transcript) between session-end and NGC upload; SeaweedFS as a plain Deployment + ClusterIP (not a StatefulSet), emptyDir by default — see §3 |
| NGC `<org>/<resource>` | NGC registry | durable per-session tarballs (log + transcript + WAVs) — the actual archive |
| **Session Dashboard** | local Docker (self-contained) | download from NGC + visualize |

> **Removed vs older revisions:** the `logkeeper` / `uploader` / `receiver` **sidecars**,
> the RBAC ServiceAccount, and the k8s-API log scraping — all unworkable on NVCF (no SA
> token, opaque sidecars). Capture is now entirely in-app; the oci-bv PVC that remains is
> local scratch, not the mechanism that makes capture replica-safe (that's Redis +
> `session_store`, both opt-in and off by default — see §3).
```
