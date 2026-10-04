# Web Search Dev Root Cause Analysis

**Date:** October 04, 2026 (UTC)

**Finding:** The dev web-search tool is configured for Perplexity Sonar Pro.
The original Generic A5 failure stops at the backend planner's missing-query
clarification, before calling the provider.

## Provider Configuration and Current Probe

All five dev application replicas explicitly set `PERPLEXITY_MODEL` to
`perplexity/perplexity/sonar-pro`, use `PERPLEXITY_BASE_URL` of
`https://inference-api.nvidia.com/v1`, and report a configured key.
The [web-search service](../../../src/examples/frontend_backend_agent/generic/services.py)
posts that model to `https://inference-api.nvidia.com/v1/chat/completions`.
Its returned `Perplexity Sonar` source label does not identify the model tier.

A direct call to the actual deployed `web_search` function, using the current
key and complete query, succeeds and returns an answer. This confirms current
provider configuration and reachability. It does not turn the original spoken
failure into a pass.

## Original Failure Path

In session `d713e125343e`, independent recognition of the 4.65-second query WAV
retains the full request for the latest artificial-intelligence news.
The application speech-to-text (STT) final contains only “Search the web.”
Talker nevertheless calls `call_backend` with the complete request.

The [planner](../../../src/examples/frontend_backend_agent/generic/planner.py)
uses the latest real user message in `conversation_context` as
`untrusted_user_request`. It places Talker's proposed query in
`untrusted_talker_proposal`. The
[pipeline execution contract](../../../src/examples/frontend_backend_agent/pipeline.py)
explicitly gives the actual user transcript precedence over a conflicting
frontend proposal.

The recovered result for `chatcmpl-tool-9f88a99e790445f0` is
`response_hint`, with `reason=params_missing`, `context=web_search`, and
`params_needed=["query"]`. The
[dispatcher](../../../src/examples/frontend_backend_agent/generic/dispatcher.py)
returns a clarification for this branch without running `web_search`.
The spoken response asks which topic to look up. Sonar Pro is therefore not
invoked for the failed original turn.

## Controlled Planner Comparison

The paired probe uses the current deployed Super planner, tool catalog,
execution contract, original eight-message dialogue, and complete Talker
proposal. It changes only the latest actual user transcript:

| Latest Actual Transcript | Returned Plan |
| --- | --- |
| `Search the web.` | `response_hint`, `params_missing`, context `web_search`, missing `query` |
| `Search the web for the latest news about artificial intelligence.` | `web_search` with query `latest news about artificial intelligence` |

Both planner probes complete successfully; neither executes tools. Combined
with the original exact backend result, this reproduces the immediate cause:
the authoritative transcript lacks a search topic, so the planner requests one.
The separate direct provider probe verifies that the configured search service
can execute the complete query now.

## Remaining Boundary and Evidence

The mechanism that truncates the valid speech input remains unresolved.
These checks do not establish premature end-of-utterance detection or a specific
automatic speech recognition (ASR) fault. They do not show absent Talker delegation or a Sonar Pro
authentication failure. No product, prompt, configuration, or deployment changes
are made, and the original comprehensive failure remains recorded.

The deployed backend source remains
`9b11f4d7a8064724f6b69f587d357ef490352404`.
The [historical comprehensive report](COMPREHENSIVE_DEV_2026-10-04.md) retains
its original observations and artifact identities unchanged.

Raw evidence is under `/tmp/nva-web-search-rca-20261004`:
`web-search-runtime-config.json`, `direct-web-search-probe.json`,
`A5-backend-result.json`, and `paired-planner-probe.json`.
The initial diagnostic import error occurs before a model call; the corrected
probe uses the repository's `NvidiaLLMSettings` and passes. That import error is
a probe setup issue. The eight-file `evidence-manifest.json` has SHA-256
`2b1e88df38f0c9fa23081ebe98569772a688a9fb69c5262169bd1f2fdbb18dc1`.
Credentials and generated evidence are not committed.
