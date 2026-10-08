# Rewrite brief — Top 5 Things: Nemotron Voice Agent Deployment

You drafted the original version of this document. It has since been through several editing passes
(register, naming, structure). Attached is the current `Top_5_Nemotron_Voice_Agent_Deployment.docx`.
You have access to the work's repo — **use it**. Most of the technical detail below is dictated from
memory and must be verified against the code, Helm chart, configs and prompts before it goes in.

This is a substantial content rewrite, not a copy-edit. Two of the four sections roughly double in
depth. Read the whole brief before starting.

---

## 1. What this document is

An NVIDIA internal "Top 5 Things" update. It is read by people outside the project — peer teams,
managers, and the compiler of the monthly *AI at NVIDIA* rollup — most of whom have no context on
the Nemotron Voice Agent. It is also harvested for that rollup, so factual lines should be liftable
verbatim.

Current structure: Mission / Aim, a links strip, four numbered sections, two figures, a closing
Availability block, and a Links list.

---

## 2. Style constraints — already settled, do not regress

These were established in earlier passes and are not up for renegotiation.

- **White-paper register.** Third person, descriptive, neutral. **No first person anywhere** — no
  *we, our, us, I, my, you, your*. The technical content in §4 and §5 of this brief is dictated in
  first person; convert all of it. "We updated it to make it generic" becomes "The example was
  generalised." Run a regex sweep for `\b(we|our|ours|us|I|my|me|you|your)\b` before you finish; the
  current document scores zero and must still score zero.
- **Section headings are topic-first noun phrases**, in the form `Topic: descriptor` — e.g.
  *"Concurrency: shared state across replicas"*. Not verb-led achievement phrasing
  ("Deployed it", "Made it work"). Not questions.
- **Every bullet opens with a short bold label**, then full sentences. Labels are noun phrases —
  *Delivery. · In-cluster inference. · Single-writer archiving.* Not narrative framing
  (*What broke. · The fix: · Goal:*). There are no `Why:` blocks; do not reintroduce them.
- **Name each component once on first use, then use plain English.** "a shared session store
  (Redis)" on first mention, "the shared session store" thereafter. Component names must match the
  two architecture diagrams exactly — App Pod / replica, Redis Session Store, Nemotron 120b Super,
  Nemotron 3.5 Lightning Talker, `call_backend` / `cancel_backend`, ToolSpec Registry, NGC.
  Expand acronyms on first use (NVCF, NGC, NIM, TTFT, ASR, TTS).
- **No vague quantities.** If a number is not known, state the mechanism instead — never "a
  handful", "a beat", "roughly". Every figure in the document must be checkable in the repo or the
  linked session-analysis doc.
- **No merge-request or bug IDs.** One exception, explicitly requested: the OpenAI Realtime work may
  credit `@Punit`'s branch. Do not add other @-mentions.
- Preserve the existing NVIDIA template, fonts, colours, the header links strip, the byline, the
  Links list, and both embedded diagram images. Edit at the run level so formatting survives.

---

## 3. The structural problem to fix

**The document has no narrative arc.** It currently reads as four disconnected inventories. Each
section should carry a through-line, and the sections should connect to each other:

> an experience deployment was stood up → it had to serve many people at once, which broke
> assumptions the prototype made → the agent inside it was redesigned so answers are both fast and
> grounded → here is what comes next.

Achieve this with **structure, not voice**. Each section opens with one summary sentence stating
what was done and why it mattered, then the labelled bullets in an order that tells that story:
what was built → what limited it → what was changed → how it was verified. No dramatisation, no
first person, no suspense devices.

**Section 3 currently fails worst.** It opens on "Tool grounding" and dives straight into tool
mechanics without ever establishing what the Generic Frontend / Backend Agent *is*. See §6 below.

---

## 4. Section 1 — Deployment: expand substantially

Present in roughly this order. Verify every name, count and version against the repo and the Helm
chart.

1. **Summary of what was deployed** — one lead sentence naming the experience deployment as a whole.
2. **New UI.** A new user interface was built and deployed on Astra.
3. **Two examples** were selected for presentation in the experience. Name them and say what each
   demonstrates. (One is the Generic Assistant, one is the Omni Subagents Assistant — confirm and
   describe accurately.)
4. **Helm chart.** The voice agent application, all NIMs, and the supporting services were bundled
   into a single Helm chart and deployed on an 8-GPU NVCF backend. Name the NIMs explicitly:
   Nemotron ASR, Nemotron Lightning 3.5, Nemotron Super 120B, Magpie TTS, Chatterbox TTS. Verify
   this list and the exact model names/versions in the chart — the current document says "two
   text-to-speech voices" without naming them, and names "Nemotron Omni" for vision, which does not
   appear in the dictated NIM list. Resolve that discrepancy.
5. **The full pipeline is an NVCF + Astra deployment.** All NIMs reside in-cluster; no remote
   endpoints are called from this deployment.
6. **Secrets.** All required secrets — including the secret used to invoke the NVCF function — flow
   in from Vault, so no credential is held by the browser or baked into the application.
7. **Prompt guardrails.** Prompts were tuned for safety, neutrality, positivity, and resistance to
   prompt leaking. State what each guardrail is meant to prevent; pull the actual categories from
   the prompt files rather than repeating this list blindly.

---

## 5. Section 2 — Scalability: expand, and make the failure modes concrete

The current version is close but too abstract about *what* was racing. Expand to cover:

1. **The goal** — scaling the deployment to multiple workers / replicas of the voice agent
   application.
2. **Limitation of the existing pipeline.** The session-config call and the actual WebSocket stream
   are separate requests. With multiple workers they could land on different workers, producing a
   race condition — the worker holding the stream had no access to the config.
3. **The same failure in the Omni Subagents Assistant.** Media and webcam frames ride a different
   HTTP endpoint than the WebSocket endpoint, so they too could land on a different worker.
4. **Root cause, stated once, plainly.** Workers stored session-config and webcam frames / media /
   snapshots in local process-memory dictionaries, so nothing was visible outside the process that
   received it.
5. **Mitigation.** A Redis data store was introduced. All workers now share session-config, media
   and frames keyed by a unique sessionID; any worker can look up what it needs. The deployment
   became worker/replica agnostic, which is what enabled scaling.
6. **Consent-based session capture — one or two bullets.** The same data store backs capture: with
   user consent, any worker can dump its session's audio to the store. The worker that later
   receives the session-end signal reads those dumps, re-checks consent, and publishes the final
   logs, transcript and audio to NGC. Because the store is a single place to hold audio keyed by
   sessionID, this mechanism is also worker/replica agnostic. Keep the existing point that declining
   consent deletes everything immediately.
7. **Verification.** Keep the existing point: real audio through physical microphones at up to 30
   simultaneous conversations, confirming no cross-talk, no dropped connections, exactly one archive
   per conversation.

---

## 6. Section 3 — Generic Frontend / Backend Agent: restructure and lead with what it is

Retitle so the heading names the subject, not one property of it. The current
*"Tool grounding: frontend / backend agent architecture"* buries the subject behind a mechanism.

Order the section so a reader meets the thing before its internals:

1. **What it is** — the Generic Frontend / Backend Agent, in one or two sentences.
2. **What it is built on** — name the repo, framework and components it sits on top of.
3. **Highlights in a single bullet** — the two or three properties that matter most.
4. **The problem it solves — this is the core of the section and is currently missing entirely.**
   Lay it out in this order:
   - The existing generic assistant ran the LLM with reasoning **off**.
   - Trials and early experiments showed the LLM produces markedly better tool-call plans with
     reasoning **on**, and handles complex queries that require analysis.
   - But reasoning-on significantly increases time-to-first-token for the final response.
   - The resolution: split the pipeline. A lightweight non-reasoning LLM at the front returns quick
     responses and delegates complex or tool-requiring queries to a richer backend running a
     reasoning-on LLM. The backend's analysis proceeds **asynchronously** while the front-end talker
     stays live — issuing filler responses, continuing to listen, and handling interruptions and
     barge-in.
   - State the benefit precisely: reasoning-quality planning without paying reasoning latency in
     the conversation. If TTFT figures for both paths exist in the repo or in test results, give
     them; do not invent them.
5. **Origin and generalisation.** An airline-domain example in the repo already used exactly this
   frontend/backend architecture. It was generalised into a domain-configurable agent: frontend and
   backend prompts and tools are switched through a YAML config, so tools from any domain can be
   supported without code changes.
6. **Tools it supports today** — weather, stock, web search, BMI, as configured for the generic
   example in the experience deployment. Name the registry as the diagram labels it.
7. Keep the existing grounding points — planning without execution, allow-list and argument
   validation, deterministic reply assembly — but place them *after* the above, as consequences of
   the design rather than as the section's opening.

---

## 7. Section 4 — Planned work: mostly fine, two additions

Keep the existing framing and add:

1. **In progress:** an adaptor to make the Generic Frontend / Backend Agent compatible with the
   OpenAI Realtime API schema, built on top of `@Punit`'s branch.
2. **Under analysis:** GPT Live 1's API schema has also been studied. It supports request delegation
   to a backend in the same shape as this design, and work is underway to assess how to make the
   Generic Frontend / Backend Agent compatible with it as well.
3. Reference the **voice-poc-proposal** doc as the source for further detail. Add it to the Links
   list at the end with its real URL (find it; do not leave a placeholder).
4. The existing *Objective* and *Rationale* bullets say nearly the same thing — merge them.

---

## 8. Mission and Aim

Current text:

> **Mission**  To deploy the Nemotron Voice Agent as a scaled system that enables wider access and
> trials, using in-cluster deployed NIMs.
>
> **Aim**  To deploy the agent in the cloud on Astra and NVCF, reachable from a browser by any
> NVIDIA employee with no local installation, and usable by many people concurrently.

Required changes:

- **Aim must state that this is an *experience deployment*** — one stood up specifically to enable
  wider internal trials and to collect feedback. That purpose is currently absent and it is the
  reason the deployment exists.
- Keep the Astra / NVCF cloud-deployment framing in the Aim.
- **Differentiate the two blocks.** Both currently open "To deploy" and both land on wider
  concurrent access; a reader cannot tell what separates them. Make Mission the standing charter and
  Aim the objective of this specific piece of work.
- **Say what the agent is.** Neither block, nor the Section 1 heading, tells the reader this is a
  voice product. The first hint of speech is "speech recognition (Nemotron Streaming ASR)" in the
  second bullet of Section 1; the word "voice" appears only in the title and a URL. A reader from
  another org learns what it runs on long before learning what it does. Fix this in the Mission —
  four words is enough: *"the Nemotron Voice Agent, a speech-to-speech assistant, …"*

---

## 9. Reviewer concerns to resolve while rewriting

1. **Repetition.** "Anyone at NVIDIA can open it in a browser with no installation" is currently
   stated three times — in the Aim, in *Delivery*, and again in the closing *Availability* block.
   Keep it once, in *Delivery*.
2. **Section 1's heading promises a before-and-after the document never establishes.** *"From
   single-user prototype to a shared service"* — the background paragraph that introduced the
   prototype stage was removed, so the premise now dangles. Either retitle to describe the end
   state, or restore the prototype fact in a single clause.
3. **The two figure captions behave inconsistently.** Figure 1's caption traces the path through the
   diagram, which is what a caption is for. Figure 2's caption restates bullets one to three in
   different words — useless to a reader who read them, and no help reading the picture. Rewrite
   Figure 2's caption to trace its diagram the way Figure 1's does.
4. **The Usage analysis bullet is in the wrong section.** It sits under Deployment as the only
   bullet not about deployment, and points "below" to a document linked at the very end. Move it to
   the closing Availability block, next to the link it refers to.
5. **Check whether the diagrams still match the text after this rewrite.** If Magpie TTS and
   Chatterbox TTS replace the generic "Nemotron Speech" box, or the new UI changes the ingress path,
   the diagrams need regenerating — flag it rather than letting text and figure diverge.

---

## 10. Verify, do not invent

Everything below is dictated from memory. Confirm each against the repo before writing it, and
**flag anything you cannot confirm rather than writing round it**:

- The exact NIM list, model names and versions in the Helm chart, and the GPU topology (8-GPU NVCF
  backend — confirm the GPU type).
- Where Nemotron Omni fits, given it appears in Figure 1 but not in the dictated NIM list.
- Whether the Omni Subagents Assistant's description is complete — it is currently described only as
  interpreting uploaded images and webcam video, which says nothing about subagents. Either the name
  or the description is wrong.
- The real replica count. The text asserts "all five replicas"; confirm whether five is the deployed
  scale or simply what Figure 1 draws.
- TTFT figures for the reasoning-on and reasoning-off paths, if they exist.
- The guardrail categories actually present in the tuned prompts.
- The voice-poc-proposal document's URL.
- The two examples selected for the experience, and what each demonstrates.

---

## 11. Output

- Edit the attached `.docx` in place, preserving the template, both diagrams, and all existing
  styling. Do not rebuild it from scratch.
- Expect the document to grow — Sections 1, 2 and 3 roughly double. Do not let it exceed six pages;
  if it does, cut detail from Section 1 before Section 3.
- Render to PDF and read the pages back before declaring done.
- Finish with: the first-person regex sweep at zero; every acronym expanded on first use; every
  component named as the diagrams name it; and a short list of anything you could not verify in the
  repo.
