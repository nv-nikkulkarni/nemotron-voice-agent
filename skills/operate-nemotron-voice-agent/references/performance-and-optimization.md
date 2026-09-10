# Performance and Optimization

## Contents

1. [Capacity Model](#capacity-model)
2. [Latency Vocabulary](#latency-vocabulary)
3. [Frontend/Backend Critical Path](#frontendbackend-critical-path)
4. [Benchmarking Tool](#benchmarking-tool)
5. [What the Metrics Do Not Prove](#what-the-metrics-do-not-prove)
6. [Observed Bottlenecks](#observed-bottlenecks)
7. [Optimization Roadmap](#optimization-roadmap)
8. [Safe Measurement Procedure](#safe-measurement-procedure)

## Capacity Model

Five CPU application replicas share one set of model services:

- one ASR GPU;
- one Lightning GPU;
- one Super deployment using two GPUs;
- one Omni GPU;
- one Magpie GPU; and
- one Chatterbox GPU.

The complete chart consumes seven H100s. Five app replicas improve HTTP/WebSocket acceptance
and isolate Pipecat sessions; they do not multiply inference capacity. A request concurrency
ceiling of 100 on a single NVCF instance is a platform setting, not demonstrated voice-agent
capacity.

Likely first saturation signals are:

- Super planning timeouts or queueing during synchronized tool turns;
- ASR or TTS first-token/audio delay;
- unfair inference queues between sessions;
- longer filler-to-final gaps; and
- Redis memory pressure for concurrent media/capture.

## Latency Vocabulary

| Metric | Boundary |
|---|---|
| end-of-utterance | VAD/Smart Turn/ASR finalization after user silence |
| ASR first token | speech input to first recognized token |
| frontend selection TTFT | Talker request start to first selection token |
| frontend selection processing | total initial Talker generation, including TTFT |
| backend Thinker TTFT | plan request start to first plan token |
| backend Thinker processing | total plan generation, including TTFT |
| backend tool latency | validated provider/local executor wall time |
| frontend final TTFT | optional final Talker request to first response token |
| frontend final processing | total final Talker generation, including TTFT |
| TTS first audio | text ready to first synthesized audio |
| server time to first audio | user silence/finalization to first server bot audio |
| browser playout tail | server/bot start to first audible sample in the browser |
| true felt latency | server time to first audio plus browser playout tail |

TTFT is included in processing. Never add both as separate serial components.

## Frontend/Backend Critical Path

For a direct stable answer, the usual blocking path is:

```text
turn finalization -> Talker total -> TTS first audio -> browser playout
```

For a delegated turn with a spoken filler:

```text
turn finalization -> Talker tool selection -> filler threshold/TTS -> first audio
                                      \
                                       -> Thinker -> tool -> result -> optional final Talker -> final TTS
```

The Thinker/tool path can continue after the filler is already audible. That is why UI
stages marked “After delegation” do not add to the first-audio number even though they add
to final-answer completion time.

For direct result mode, there is no final Talker stage. For Viking hybrid, only successful
weather normally gets a final Talker rephrase. Parallel tools overlap, so sum-of-bars is not
wall-clock time.

When a UI example shows:

- total selection 335 ms with first token 226 ms;
- planning 1160 ms with first token 126 ms;
- weather 549 ms;
- end-of-utterance 652 ms;
- ASR first token 650 ms;
- TTS first audio 49 ms;
- server time to first audio 1342 ms; and
- browser playout 22 ms;

do not sum every displayed number. The model first-token markers sit inside their totals;
planning/weather may occur after a filler; ASR/end-of-utterance definitions overlap; and
browser playout alone is added to the server headline. The displayed true felt latency in
that example is 1342 + 22 = 1364 ms.

## Benchmarking Tool

The scaling/performance client lives at `benchmarking_tools/scaling-perf/`. It can drive
the NVCF function using audio from `audio_files/` and collect normal RTVI metrics plus the
seven Generic stage fields:

1. `frontend_tool_selection_ttft`
2. `frontend_tool_selection_processing_time`
3. `backend_llm_ttft`
4. `backend_llm_processing_time`
5. `backend_tool_call_latency`
6. `frontend_final_response_ttft`
7. `frontend_final_response_processing_time`

Read `benchmarking_tools/scaling-perf/README.md` and
`docs/how-to/run-scaling-perf-tests.md` before running. Use the exact target function ID,
gateway, concurrency sweep, audio corpus, and result mode in the report.

The reported “LLM” number in the older generic benchmark table usually described the
in-pipeline user-facing LLM timing available through standard Pipecat metrics. It did not
fully attribute Thinker, provider call, and optional final Talker work. The custom stage
events were added to close that gap without changing external HTTP/WS routes.

## What the Metrics Do Not Prove

- Server RTVI processing does not include all browser rendering/playout delay.
- Tool call latency does not include Talker selection or Thinker planning.
- First audio can be a filler, not the final grounded answer.
- A missing frontend-final metric in direct mode is correct, not telemetry loss.
- Omni does not emit Generic Talker/Thinker stages; use server or browser-observed E2E.
- One average hides tail latency and synchronized model saturation.
- NVCF `ACTIVE`, pod Ready, or HTTP 200 does not prove warm real-audio latency.
- Independent output ASR measures recognizability, not synthesis latency or human quality.

## Observed Bottlenecks

### Super saturation

An isolated 8-by-10 staging run saw all eight synchronized third-turn Super plans cross a
15-second boundary. The failure was model load/queueing, not Redis cross-talk. Reducing
Super output to 768 and reasoning budget to 256 prevented needless long plans, but capacity
still requires load validation.

### Lightning cold start

The prewarmer currently targets ASR, Super, Omni guided JSON, Magpie, and Chatterbox. It
does not send an explicit Lightning generation. Readiness can pass while first Lightning
generation still pays a warmup penalty.

### Omni guided decoding

The first real Speaker request historically paid JSON grammar compilation and could take
around 25 seconds. Prewarm Omni with the exact stable served alias and
`response_format=json_object`.

### Perplexity retry budget

Two 18-second provider attempts under a 20-second tool timeout made retry impossible. The
current two 9-second attempts plus 0.5-second backoff fit. Revalidate if any timeout changes.

### TTS text length

Long web/multi-tool responses delay final audio and can exceed Chatterbox synthesis limits.
Keep web speech to two sentences and multi-tool speech to roughly 450 characters/three
short sentences. Chatterbox uses about 240-character chunks.

### Browser sample rate

Playing 22.05 kHz TTS at 16 kHz caused slow/low-pitch output. This is a correctness and
latency issue at the browser boundary; never compensate by changing the TTS model.

## Optimization Roadmap

Prioritize evidence-backed work:

1. finish full real-audio/concurrency qualification on the exact Viking candidate;
2. add a real Lightning prewarm target and measure cold versus warm first turn;
3. collect p50/p95/p99 for each stage under 1, 2, 4, and 8 simultaneous sessions;
4. separate filler first-audio latency from final grounded-answer latency in reports;
5. measure Super queue depth/TTFT during synchronized planning;
6. validate dedicated speech functions with actual streams/synthesis before adopting them;
7. keep all final-response modes in the benchmark dimensions;
8. monitor Redis memory/eviction and SeaweedFS throughput during webcam/capture load;
9. replace shallow proxy `/health` with an unambiguous backend readiness route/contract;
10. consider durable shared object storage if capture survival across SeaweedFS restart is
    required; and
11. provision a true Astra `prd` boundary when governance and environment isolation matter.

Treat these as hypotheses until measured:

- increasing app replicas will not fix single-NIM saturation;
- raising timeouts can hide queueing and worsen user experience;
- full Talker result mode may sound better but adds inference latency/redelegation risk;
- session affinity does not make sockets movable or fix cross-replica media; and
- edge concurrency 100 is not a throughput target.

## Safe Measurement Procedure

1. Record source SHA, chart/app/UI versions, target function/version, model images, result
   and filler modes, and exact audio corpus.
2. Verify clean session IDs and settle the welcome before timed turns.
3. Run a low-concurrency warmup and preserve its metrics separately.
4. Sweep fixed concurrency levels; do not mix prompt sets between levels.
5. Record completion, tool correctness, audio presence, E2E, all stage timings, console/WS
   errors, and independent-ASR grounding.
6. Correlate each stage by turn/invocation rather than arrival order alone.
7. Report p50/p95/p99 and failures; never publish only successful averages.
8. Classify hosted input-TTS and independent-ASR failures separately.
9. Preserve ignored raw JSON/WAV and commit only a concise redacted table/report.
10. Do not tune production from a run whose exact artifact or credentials are unknown.
