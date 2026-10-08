# LiveBridge for the Generic Frontend/Backend Agent

**Proposal v0.1 · September 2026 · companion to `voice-poc-proposals.pdf` §POC 1**

Wrap the existing Generic Frontend/Backend Agent behind a GPT-Live-shaped `/v1/live/sessions`
API, and move tool *declaration and execution* to the client UI — without changing the Talker,
the Thinker, or the pipeline.

---

## 1. Why this agent is the right host

LiveBridge's three hard problems are mostly already solved here. That is the argument for
picking this agent over anything else in the repo.

| LiveBridge requirement | Status today | Where |
|---|---|---|
| Talker holds **exactly one** delegate tool | **Already true** — `call_backend(query, filler_text)` + `cancel_backend`, nothing else | `generic/tools.py:19` |
| Delegation emits metadata, never task text | **Already true** — `filler_text` is the only client-safe spoken surface; `query` stays server-side | `generic/tools.py:39` |
| Thinker result arrives as **context, not a return value** | **Already true** — trusted direct-result path bypasses a second Talker inference | `src/tool_handlers.py` |
| Server owns the turn controller | **Already true** — Smart Turn + Silero VAD, 0.5 s finalization, barge-in observer | `src/barge_in.py` |
| Tools behind a code-owned allowlist | **Already true** — `ToolSpec` registry + `_DOMAIN_FACTORIES` | `src/tools.py:40`, `src/domain.py:71` |
| Conversation-revision / staleness guard | **Partial** — liveness retry + `cancel_backend`; no explicit revision counter | `src/reliable_talker.py` |
| Duplex honesty (announce the rung) | **Missing** — we are L1, we say nothing | — |
| Client-declared tools | **Blocked by design** — `/v1/realtime` explicitly ignores `session.tools` | `src/realtime/session.py:256` |

> The last two rows are the entire delta. Everything above them is reuse.

---

## 2. Target architecture

```
   STOCK LIVE CLIENT                 LIVEBRIDGE ADAPTER                 EXISTING AGENT
  ┌──────────────────┐            ┌────────────────────────┐        ┌──────────────────┐
  │ written for      │            │  protocol only. no ML. │        │  TALKER          │
  │ gpt-live-1       │──audio────▶│                        │───────▶│  Lightning 30B   │
  │ UNMODIFIED       │            │  • session lifecycle   │        │  temp 0.0        │
  │                  │◀──events───│  • audio framing/b64   │◀───────│  1 tool only     │
  │ ┌──────────────┐ │            │  • event translation   │        └────────┬─────────┘
  │ │ CLIENT TOOLS │ │            │  • delegation correl.  │                 │ call_backend
  │ │ (new)        │◀┼──delegate──│  • revision guard      │                 ▼
  │ │ run in UI    │ │            │  • duplex announce     │        ┌──────────────────┐
  │ └──────┬───────┘ │            │                        │        │  THINKER         │
  │        │ result  │            │  TalkerEngine protocol │◀──────▶│  Super 120B      │
  └────────┼─────────┘            │  (7 methods)           │        │  one JSON plan   │
           └──────────────────────▶└───────────┬────────────┘        └────────┬─────────┘
                                               │                              │
                                   ┌───────────▼──────────┐          ┌────────▼─────────┐
                                   │ TOOL ROUTER (new)    │          │ SERVER TOOLSPECS │
                                   │ owner: client|server │─────────▶│ weather / stock  │
                                   └──────────────────────┘          │ search/bmi/rand  │
                                                                     └──────────────────┘
        Everything new is the middle box + the router. Talker/Thinker unchanged.
```

---

## 3. API surface

New sibling to the existing `/v1/realtime`, reusing `src/realtime/` transport, serializer and
audio plumbing.

| Endpoint | Method | Purpose |
|---|---|---|
| `/v1/live/sessions` | `POST` | Create session, register prompt + **client tool manifest**, return `live_...` id |
| `/v1/live/sessions/{id}` | `WS` | The live conversation (audio + events) |
| `/v1/live/sessions/{id}/tools` | `POST` | Pre-warm / re-register tool manifest without a reconnect |

### Event mapping

| Live event | Dir | Adapter does |
|---|---|---|
| `session.start` | in | Validate config, build manifest, `engine.start()`, allocate `live_...` |
| `session.started` | out | Emit resolved config **+ `info` duplex rung**. Gate all audio on this |
| `session.input_audio.append` | in | b64 decode, even-length check, `engine.feed_audio()` |
| `session.output_audio.delta` | out | b64 encode from `audio_out()`. **No `done` event** |
| `session.input_transcript.delta` / `session.output_transcript.delta` | out | Two independent streams; may overlap, never serialize |
| `session.delegation.created` | out | Mint `item_...`, stamp `offset_ms` + **`revision`**. Metadata only — never the `query` |
| `session.delegation.result` | in | Client tool output returns here, keyed by `delegation_id` |
| `session.commentary.append` / `thinking.append` / `instructions.append` | in | Thinker/client context injection, 500-token cap, `*.appended` ack |
| `session.update` | in | Only `delegation` mutable; type change → `immutable_field_update` |
| `session.close` / `closed` | both | Drain, final `usage`, close |

---

## 4. TalkerEngine adapter — 7 methods over what exists

| Protocol method | Backed by |
|---|---|
| `start(instructions, voice, fmt)` | `pipeline.bot()` construction; instructions immutable for session life |
| `feed_audio(pcm)` | `transport.input()` → `NvidiaSTTService` |
| `audio_out()` | `NvidiaTTSService` frames → `session.output_audio.delta` |
| `transcripts()` | user + assistant aggregator streams |
| `delegations()` | **`call_backend` invocation** → `session.delegation.created` |
| `inject(kind, text)` | `commentary` → speakable; `thinking` → context only; `instructions` → may interrupt |
| `close()` | `task.cancel()` + capture finalize |

A **mock engine** ships alongside so the protocol is testable with zero GPUs (P0).

---

## 5. Delegation flow

```
 user speech
     │
     ▼
 [TALKER] ──emits call_backend(query, filler_text)──┐
     │                                              │
     │  (speaks nothing this turn — gated)          ▼
     │                          adapter: mint item_id + revision N
     │                                              │
     │                          session.delegation.created ──▶ CLIENT
     │                          { id, capability, filler_text, offset_ms, revision }
     │                                  NEVER the raw query
     │                                              │
     │                    ┌─────────────────────────┴──────────────────────┐
     │                    ▼ owner=server                    owner=client ▼
     │            [THINKER] one JSON plan            response.function_call_
     │                    │ validate + dispatch      arguments.done ──▶ UI runs it
     │                    ▼                                    │
     │            ToolSpec.run() → grounded result    session.delegation.result
     │                    │                                    │
     │                    └──────────────┬─────────────────────┘
     │                                   ▼
     │                        revision still N?  ──no──▶ DISCARD (stale)
     │                                   │yes
     │                                   ▼
     └──────────────── inject() as commentary / trusted direct result ──▶ speech
```

**Rules**

- Talker never chooses a domain tool — it only chooses *to delegate*. Unchanged from today.
- `revision` increments on every new user turn and on `cancel_backend`. A result arriving
  against a stale revision is dropped, not spoken. *(This is the shared dependency the source
  proposal says to build once, before either POC.)*
- Client tool timeout is server-enforced; expiry → deterministic TTS-safe fallback, never a raw error.
- `filler_text` remains the only free-text field crossing to the client pre-result.

---

## 6. Tools move to the client

### 6.1 The three modes

| Mode | Declared by | Executed by | Use case | Phase |
|---|---|---|---|---|
| **A — Catalog** (today) | Server `ToolSpec` registry | Server | Weather, stock, search, BMI, random | shipped |
| **B — Client** | Client `session.start.tools[]` | **Client UI** | App-local state, user's own creds, DOM actions, private APIs | P2 |
| **C — Hybrid** | Both, merged manifest | Router by `owner` | Client tools + our grounded catalog in one plan | P3 |

### 6.2 Manifest derivation — deterministic, never model-authored

```
  ToolSpec (server)                      client tools[] (Live schema)
  name + contract + params                name + description + JSON Schema
         │                                          │
         └──────────────┬───────────────────────────┘
                        ▼
              TOOL MANIFEST (merged, namespaced)
              server.get_weather   · owner=server
              client.open_invoice  · owner=client
                        │
                        ▼
              THINKER prompt (capability lines only)
              TALKER prompt  ← receives NOTHING from this
```

- Manifest text is templated from structured data (name + first sentence of contract). The LLM
  never writes it — it cannot hallucinate a capability we lack.
- Client tool names are forced into a `client.` namespace; a client can never shadow
  `server.get_weather` or name `call_backend`.
- Registered at `POST /v1/live/sessions` (or the pre-warm endpoint) so the hash is stable and
  the Thinker prompt is cached per app configuration, not per call.

### 6.3 Client-side implementation shape

```js
// Stock Live client + a tool table. No custom protocol.
live.tools = {
  "client.open_invoice": async ({ invoice_id }) => {
    const inv = await app.invoices.get(invoice_id);   // app's own session/creds
    app.router.push(`/invoices/${invoice_id}`);       // UI side effect
    return { status: inv.status, total: inv.total };  // grounded, structured
  },
};

live.on("session.delegation.created", ({ id, capability, filler_text }) =>
  ui.showPendingChip(capability, filler_text));       // the little "checking…" box

live.on("response.function_call_arguments.done", async (ev) => {
  const out = await live.tools[ev.name](JSON.parse(ev.arguments));
  live.send({ type: "session.delegation.result", delegation_id: ev.delegation_id, output: out });
});
```

### 6.4 Invariants (enforced in code, not by the model)

| Invariant | Enforcement |
|---|---|
| Talker never receives tool schemas | Structural assertion: reject Talker prompt containing a JSON Schema fragment |
| Talker never names a tool it cannot reach | Cross-check manifest vs live tool list at session start |
| Client tools cannot impersonate server tools | `client.` namespace forced server-side; collision → `invalid_tool_name` |
| Server secrets never cross the boundary | Client tools run with client creds only; no server env exposure by construction |
| A failed/timed-out client tool is fail-closed | Deterministic short TTS-safe line; never speak raw errors or payloads |
| Unknown tool in a plan is dropped, not invented | Existing `validate_plan()` rejection path, extended to `owner` |
| Result must be structured | `session.delegation.result.output` is JSON; free prose is rejected |

---

## 7. Duplex honesty

We are **L1 (interruptible)** today: Silero VAD detects speech start, barge-in stops TTS within
~200 ms. We are not L3. Announce the rung on the `info` server event at `session.started` — a
legitimate use of the existing Live event set, not an extension. Clients that ignore it still
work; clients that read it can adapt.

---

## 8. Phases

| Phase | Scope | Exit criteria |
|---|---|---|
| **P0** | `/v1/live/sessions` skeleton + **mock engine**. WS only, no ML | Stock client connects, sends audio, gets audio, clean `session.closed`. **Zero GPUs** |
| **P1** | Real Talker/Thinker behind `TalkerEngine`. Mode A tools. L1 duplex + `info` | One real conversation with one server delegation round trip; barge-in < 200 ms |
| **P2** | **Mode B: client-declared + client-executed tools** | A client tool table gets a call, returns output, and the Talker speaks the grounded result |
| **P3** | **Mode C: hybrid manifest** + revision guard hardened | One plan spanning a server tool *and* a client tool; stale results provably discarded |
| **P4** | WebRTC transport, reconnect, capture, load | Soak at target concurrency, no session leaks, capture still lands in NGC |

**Falsifiable success test (unchanged from source proposal):** take OpenAI's published Live
sample client, change only the base URL, add a two-entry tool table. It holds a working
conversation against our server, including one client-executed delegation, and closes with a
valid `session.closed`.

---

## 9. Risks

| Risk | Sev | Response |
|---|---|---|
| Duplex gap wider than L1 assumption | **high** | This is the POC's purpose. `info` is the honest mitigation; discovering it in P1 is a success |
| Client tool becomes a prompt-injection vector | **high** | Structured output only; delimited manifest block; `client.` namespace; no free-form passthrough to Talker |
| Client tool latency blows the turn budget | med | Server-enforced per-tool timeout; filler_text covers the gap; fail closed |
| Trust boundary weakens vs today's allowlist | med | Server catalog keeps its allowlist unchanged; client tools are additive and sandboxed to client creds |
| Live schema churn (alpha-gated) | med | Pin to a dated docs snapshot; conformance suite is the regression gate |
| Two protocols to maintain (`/v1/realtime` + `/v1/live/sessions`) | low | Shared `src/realtime/` transport layer; only the event translator differs |

---

## 10. Open questions

- Does `session.delegation.result` need partial/streaming output, or is one-shot enough for P2?
- Should Mode C let the Thinker run a client tool and a server tool **in parallel**, or serialize
  for determinism in the first cut?
- Does the client manifest participate in the session-config Redis hash (cross-pod resume), or is
  it strictly connection-local like `/v1/realtime` is today?
- Do we expose `revision` to the client, or keep it server-internal and only surface "discarded"?
