// SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause
//
// Comprehensive end-to-end SQA suite for the Astra staging web UI, driving the
// REAL browser + REAL voice pipeline (PulseAudio virtmic in, Riva/app ASR + a
// WebAudio level tap out). It adapts to the NEW example-card → configuration
// POPUP flow (ExampleConfigModal / .ex-config).
//
// Phases:
//   A. GENERIC (Lightning), >=15 turns — exercises EVERY current tool with spoken queries
//      and reports a per-tool called/answered/failed table (the headline metric:
//      "how well Nemotron Lightning calls tools").
//   B. OMNI, >=15 turns — voice turns + image upload (attachment) + webcam-frame
//      simulation; asserts the model describes the fed image.
//   C. UI FEATURES (single stream) — end→switch example, ⚙ Settings prompt edit +
//      restart, pipeline-info overlay, NGC session-capture status; every wait is
//      timeout-guarded and any timeout is recorded as a HANG failure.
//   D. CONCURRENCY — 8 simultaneous streams (mix of generic + omni), each a short
//      multi-turn convo; asserts all connect + respond, unique ids, no cross-talk.
//
// AUTHORING NOTE: run against a LIVE staging deployment only.
//   node comprehensive.mjs [all|A|B|C|D]
import fs from "node:fs";
import * as H from "./lib/harness.mjs";

const IMG = "/sqa/omni_test.png";                 // navy bg, red square, text "BANANA 42"
const IMG_HINT = /red|square|box|banana|42|navy|blue|text|number|word|sign/i;

// --------------------------------------------------------------------------- //
// Hang detection: wrap any await; a timeout is recorded as a hang, never a throw.
// --------------------------------------------------------------------------- //
function makeGuard(hangs) {
  return async function guard(label, ms, thunk) {
    let timer;
    const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`HANG:${label} (${ms}ms)`)), ms); });
    try {
      return await Promise.race([Promise.resolve().then(thunk), timeout]);
    } catch (e) {
      if (String(e.message || e).startsWith("HANG:")) { hangs.push(`${label} (>${ms}ms)`); return undefined; }
      throw e;
    } finally { clearTimeout(timer); }
  };
}

const signalCounts = (sig) => ({
  consoleErrors: sig.consoleErrors.length, badResponses: sig.badResponses.length, wsClosures: sig.wsClosures.length,
});

// --------------------------------------------------------------------------- //
// Phase A — GENERIC (Lightning): exercise every tool, measure tool-calling.
// --------------------------------------------------------------------------- //
// internal tool name (shown in .conv-tool box) → spoken prompt + answer matcher.
const TOOL_TURNS = [
  { tool: "get_weather", label: "Weather", text: "What's the weather in Tokyo right now?", want: /degree|celsius|fahrenheit|rain|cloud|clear|sunny|humid|wind|tokyo/i, notWant: /\bnvidia\b|\bnvda\b|\bstock\b|\btrading\b/i },
  { tool: "get_stock_price", label: "Stock price", text: "What's Nvidia's stock price?", want: /\d|hundred|dollar|point|price/i, notWant: /\btokyo\b|\blondon\b|\bweather\b|\bdegrees?\b/i },
  { tool: "web_search", label: "Web search", text: "Search the web for the latest news about artificial intelligence.", want: /ai|artificial|model|news|research|company|announc|\w{4,}/i },
  { tool: "calculate_bmi", label: "BMI", text: "What's my BMI if I'm 70 kilos and 1.75 meters?", want: /22\.9|22 point 9|twenty.?two|\bbmi\b|normal|healthy/i },
  { tool: "generate_random_number", label: "Random number", text: "Give me a random number between one and one hundred.", want: /\d|number/i },
];
const CHAT_TURNS = [
  { text: "Introduce yourself in one short sentence.", want: /nemotron|assistant|nvidia|help|hi|hello/i },
  { text: "Can you tell me a fun one sentence fact about space?", want: /.+/ },
  { text: "What can you help me with today?", want: /help|weather|stock|convert|tool|assist|.+/i },
  { text: "And how about the weather in London?", want: /degree|celsius|london|cloud|rain|clear|sunny|wind|humid/i, tool: "get_weather" },
  { text: "Repeat the NVIDIA stock price now.", want: /\d|price|dollar|nvidia/i, notWant: /\btokyo\b|\blondon\b|\bweather\b|\bdegrees?\b/i, tool: "get_stock_price", label: "Stock price" },
  { text: "Thanks so much. Goodbye!", want: /bye|welcome|glad|help|day|care/i },
];
const ALL_TOOL_LABELS = TOOL_TURNS.map((t) => t.label); // enable every tool in the popup

async function phaseA() {
  const sig = H.newSignals(), hangs = [], guard = makeGuard(hangs);
  const rep = { phase: "A", name: "Generic (Lightning) — tool exercise", turns: [], toolTable: {}, hangs, hardFails: [], warns: [] };
  const browser = await H.launchBrowser({ headless: false });
  try {
    const { page } = await H.newPage(browser, sig);
    await guard("goto", 40000, () => page.goto(H.BASE, { waitUntil: "domcontentloaded", timeout: 30000 }));
    await H.sleep(1500);
    await guard("selectExample", 15000, () => H.selectExample(page, { example: "generic", model: "lightning", tts: "magpie", tools: ALL_TOOL_LABELS }));
    const conn = await guard("connect", 45000, () => H.startConversation(page, { timeoutMs: 40000 }));
    rep.connected = conn?.connected ?? false; rep.connectMs = conn?.connectMs ?? null;
    rep.sessionId = await H.sessionId(page);
    if (!rep.connected) { rep.hardFails.push("never connected"); return finish(rep, sig, browser); }
    const welcomeSettled = await guard("settled welcome", 50000, () => H.waitForSettledWelcome(page));
    if (!welcomeSettled) {
      rep.hardFails.push("welcome transcript did not settle before the first turn");
      return finish(rep, sig, browser);
    }
    await H.installToolWatch(page);

    // Interleave tool turns with chat turns → >=15 turns total.
    const seq = [
      CHAT_TURNS[0], CHAT_TURNS[1],
      TOOL_TURNS[0], TOOL_TURNS[1], TOOL_TURNS[2], TOOL_TURNS[3],
      CHAT_TURNS[2],
      TOOL_TURNS[4],
      CHAT_TURNS[3], CHAT_TURNS[4],
      TOOL_TURNS[0], // second weather to confirm repeat tool-calling
      CHAT_TURNS[0], CHAT_TURNS[1], CHAT_TURNS[2], CHAT_TURNS[5],
    ]; // 15 turns
    for (let i = 0; i < seq.length; i++) {
      const t = seq[i];
      const mark = await H.toolWatchMark(page);
      const before = (await H.readMessages(page)).length;
      const r = await guard(`turnA${i + 1}`, 75000, () => H.turn(
        page, t.text, `A_t${i + 1}`, { settle: true },
      )) || { botSpoke: false };
      const fired = await H.toolWatchSince(page, mark);
      const settledMessages = (await H.readMessages(page)).slice(before);
      const finalDomBot = [...settledMessages].reverse()
        .find((message) => message.role === "bot")?.text || "";
      const answer = (finalDomBot || r.domBot || r.botAsr || "").trim();
      const called = t.tool ? fired.includes(t.tool) : fired.length === 0;
      const answered = !!r.botSpoke && (t.want ? t.want.test(answer) : true)
        && !(t.notWant?.test(answer));
      const tr = { i: i + 1, text: t.text, tool: t.tool || null, fired, botSpoke: !!r.botSpoke, answer: answer.slice(0, 140), called, answered, latencyS: r.latencyS ?? null };
      rep.turns.push(tr);
      if (!r.botSpoke) rep.hardFails.push(`turn ${i + 1}: bot silent`);
      if (!called) rep.hardFails.push(t.tool
        ? `turn ${i + 1}: expected ${t.tool}, observed ${fired.join(",") || "no tool"}`
        : `turn ${i + 1}: direct question spuriously delegated to ${fired.join(",")}`);
      if (!answered) rep.hardFails.push(`turn ${i + 1}: response did not satisfy the answer oracle`);
      // Update the headline table for every turn that expects a tool.
      if (t.tool) {
        const label = t.label || TOOL_TURNS.find((candidate) => candidate.tool === t.tool)?.label || t.tool;
        const e = rep.toolTable[label] || (rep.toolTable[label] = { tool: t.tool, called: 0, answeredWithoutCall: 0, failed: 0, attempts: 0 });
        e.attempts++;
        if (!r.botSpoke) e.failed++;
        else if (called) e.called++;
        else e.answeredWithoutCall++;
      }
      console.log(`  A turn ${i + 1}/${seq.length} tool=${t.tool || "-"} called=${called ? "Y" : "n"} spoke=${r.botSpoke ? "y" : "SILENT"} lat=${r.latencyS ?? "?"}s | "${answer.slice(0, 56)}"`);
    }
    const end = await guard("endA", 20000, () => H.endConversation(page));
    rep.ended = end?.ended ?? false;
  } catch (e) { rep.hardFails.push("threw: " + String(e).slice(0, 200)); }
  return finish(rep, sig, browser);
}

// --------------------------------------------------------------------------- //
// Phase B — OMNI: voice + image upload + webcam-frame simulation.
// --------------------------------------------------------------------------- //
const OMNI_VOICE = [
  { text: "What is seventeen plus twenty five?", want: /\b42\b|forty.?two/i },
  { text: "Tell me one short fact about the moon.", want: /lunar|satellite|orbit|tide|crater|earth|phase|gravity|billion|million|kilometer|mile|day|month/i },
  { text: "What is seventeen times twenty three?", want: /\b391\b|three hundred (and )?ninety.?one/i },
  { text: "Tell me one short story about a friendly robot.", want: /robot/i },
  { text: "Count from one to five.", want: /one.*two.*three.*four.*five/i },
  { text: "What is the capital of France?", want: /paris/i },
  { text: "Say one encouraging sentence.", want: /you|keep|can|progress|going|great|believe/i },
  { text: "What is ten divided by two?", want: /\b5\b|\bfive\b/i },
  { text: "Name one primary color.", want: /\bred\b|\bblue\b|\byellow\b/i, notWant: /green|orange|purple|black/i },
  { text: "What sound does a cat make?", want: /meow|purr/i },
  { text: "Give one focus tip.", want: /focus|distraction|timer|task|break|notification|priority/i, notWant: /camera|see anything|turn it on/i },
  { text: "What is the opposite of hot?", want: /\bcold\b/i },
  { text: "Spell the word cat.", want: /\bc\s*[,. -]?\s*a\s*[,. -]?\s*t\b|see ay tee/i },
];

// Poll the DOM for a NEW bot message that isn't the ack, up to ~45s (the media
// analyzer speaks the real description well after the "I'll analyze…" ack).
async function waitDescription(page, ack, beforeCount, { maxMs = 45000 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const bot = (await H.readMessages(page)).slice(beforeCount).filter((m) => m.role === "bot").map((m) => m.text.trim());
    const real = bot.filter((x) => x && x !== ack && !/^i'?ll analyze|^one moment|^let me/i.test(x));
    if (real.length) return real[real.length - 1];
    await H.sleep(1000);
  }
  return ack;
}

async function phaseB() {
  const sig = H.newSignals(), hangs = [], guard = makeGuard(hangs);
  const rep = { phase: "B", name: "Omni — voice + image + webcam", turns: [], hangs, hardFails: [], warns: [] };
  const browser = await H.launchBrowser({ headless: false });
  try {
    const { page } = await H.newPage(browser, sig);
    await guard("goto", 40000, () => page.goto(H.BASE, { waitUntil: "domcontentloaded", timeout: 30000 }));
    await H.sleep(1500);
    await guard("selectExample", 15000, () => H.selectExample(page, { example: "omni", tts: "magpie", consent: true }));
    const conn = await guard("connect", 45000, () => H.startConversation(page, { timeoutMs: 40000 }));
    rep.connected = conn?.connected ?? false; rep.connectMs = conn?.connectMs ?? null;
    const sid = await H.sessionId(page); rep.sessionId = sid;
    if (!rep.connected) { rep.hardFails.push("never connected"); return finish(rep, sig, browser); }
    const welcomeSettled = await guard("settled omni welcome", 50000, () => H.waitForSettledWelcome(page));
    if (!welcomeSettled) {
      rep.hardFails.push("omni welcome transcript did not settle before the first turn");
      return finish(rep, sig, browser);
    }

    // 13 voice-only turns.
    for (let i = 0; i < OMNI_VOICE.length; i++) {
      const spec = OMNI_VOICE[i];
      const r = await guard(`turnB${i + 1}`, 85000, () => H.turn(page, spec.text, `B_v${i + 1}`, { settle: true, settleStableMs: 20000 })) || { botSpoke: false };
      const answer = (r.domBot || r.botAsr || "").trim();
      const answered = !!r.botSpoke && spec.want.test(answer) && !(spec.notWant?.test(answer));
      rep.turns.push({ i: i + 1, kind: "voice", text: spec.text, botSpoke: !!r.botSpoke, answered, answer: answer.slice(0, 120), latencyS: r.latencyS ?? null });
      if (!r.botSpoke) rep.hardFails.push(`voice turn ${i + 1}: bot silent`);
      if (!answered) rep.hardFails.push(`voice turn ${i + 1}: response did not satisfy the answer oracle`);
      console.log(`  B voice ${i + 1}/${OMNI_VOICE.length} spoke=${r.botSpoke ? "y" : "SILENT"} answered=${answered ? "y" : "NO"} | "${answer.slice(0, 50)}"`);
    }

    // Turn 14 — IMAGE UPLOAD (attachment path), then ask to describe.
    const img = fs.readFileSync(IMG);
    const up = await guard("imgUpload", 20000, () => H.uploadAttachment(page, sid, img, { name: "omni_test.png", type: "image/png" }));
    console.log(`  B image upload -> HTTP ${up?.status} ${up?.body || ""}`);
    if (!up || up.status >= 300 || up.status === 0) rep.hardFails.push(`image upload failed (HTTP ${up?.status})`);
    await H.sleep(1200);
    const beforeImg = (await H.readMessages(page)).length;
    const rImg = await guard("imgAsk", 30000, () => H.turn(page, "I just shared an image with you. Describe exactly what is in it.", "B_img")) || { botSpoke: false };
    const ackImg = (rImg.domBot || rImg.botAsr || "").trim();
    const descImg = await guard("imgDesc", 50000, () => waitDescription(page, ackImg, beforeImg));
    const imgOk = !!rImg.botSpoke && !!descImg && IMG_HINT.test(descImg);
    rep.turns.push({ i: OMNI_VOICE.length + 1, kind: "image", botSpoke: !!rImg.botSpoke, description: (descImg || "").slice(0, 220), described: imgOk });
    if (!imgOk) rep.hardFails.push("image not described (vision path)");
    console.log(`  B image describe -> ${imgOk ? "DESCRIBED ✓" : "NOT matched ✗"} | "${(descImg || "").slice(0, 90)}"`);

    // Turn 15 — WEBCAM STREAM SIMULATION. The browser sends JPEG frames ~1/sec; the
    // server's WebcamAgent encodes them to mp4 (ffmpeg, JPEG-only) and runs vision on an
    // ambient ~800ms summary loop. So: stream several REAL JPEG frames, then wait a couple
    // loop cycles for the "what you currently see" note to update before asking. (Posting a
    // single PNG made ffmpeg's mp4 encode fail -> note stuck at "live view loading".)
    const camJpg = fs.readFileSync("/sqa/omni_test.jpg");
    let frame;
    for (let k = 0; k < 6; k++) {
      frame = await guard("webcamPost", 20000, () => H.uploadWebcamFrame(page, sid, camJpg, { name: `webcam-frame-${k}.jpg`, type: "image/jpeg" }));
      await H.sleep(900);
    }
    console.log(`  B webcam stream -> last HTTP ${frame?.status} ${frame?.body || ""}`);
    if (!frame || frame.status >= 300 || frame.status === 0) rep.warns.push(`webcam frame POST HTTP ${frame?.status} (endpoint: /api/sessions/{sid}/webcam/frames)`);
    await H.sleep(6000); // let the ambient summary loop encode + describe the stream
    const beforeCam = (await H.readMessages(page)).length;
    const rCam = await guard("webcamAsk", 30000, () => H.turn(page, "What do you see on my camera right now?", "B_cam")) || { botSpoke: false };
    const ackCam = (rCam.domBot || rCam.botAsr || "").trim();
    const descCam = await guard("webcamDesc", 50000, () => waitDescription(page, ackCam, beforeCam));
    const camOk = !!rCam.botSpoke && !!descCam && IMG_HINT.test(descCam);
    rep.turns.push({ i: OMNI_VOICE.length + 2, kind: "webcam", botSpoke: !!rCam.botSpoke, description: (descCam || "").slice(0, 220), described: camOk });
    if (!camOk) rep.hardFails.push("webcam frame not described with bot audio (vision path)");
    console.log(`  B webcam describe -> ${camOk ? "DESCRIBED ✓" : "not matched"} | "${(descCam || "").slice(0, 90)}"`);

    console.log(`  B >>> session id for post-mortem: ${sid}`);
    const end = await guard("endB", 20000, () => H.endConversation(page));
    rep.ended = end?.ended ?? false;
  } catch (e) { rep.hardFails.push("threw: " + String(e).slice(0, 200)); }
  return finish(rep, sig, browser);
}

// --------------------------------------------------------------------------- //
// Phase C — UI features on a single stream (all waits guarded → hangs recorded).
// --------------------------------------------------------------------------- //
const PROMPT_MARKER = "PINEAPPLE";

async function phaseC() {
  const sig = H.newSignals(), hangs = [], guard = makeGuard(hangs);
  const rep = { phase: "C", name: "UI features", checks: [], hangs, hardFails: [], warns: [] };
  const add = (name, pass, note = "") => { rep.checks.push({ name, pass, note }); if (!pass) rep.hardFails.push(`${name}${note ? " — " + note : ""}`); console.log(`  C ${pass ? "PASS" : "FAIL"} ${name}${note ? " — " + note : ""}`); };
  const browser = await H.launchBrowser({ headless: false });
  try {
    const { page } = await H.newPage(browser, sig);
    const submittedConfigs = [];
    await page.route("**/api/session-config", async (route) => {
      const request = route.request();
      let body = {};
      try { body = request.postDataJSON() || {}; } catch { /* malformed bodies are diagnosed by the API */ }
      submittedConfigs.push({
        promptKey: String(body.prompt_key || ""),
        promptHasMarker: String(body.prompt_content || "").includes(PROMPT_MARKER),
      });
      await route.continue();
    });
    await guard("goto", 40000, () => page.goto(H.BASE, { waitUntil: "domcontentloaded", timeout: 30000 }));
    await H.sleep(1500);

    // C1. Start generic, one turn.
    await guard("C1.select", 15000, () => H.selectExample(page, { example: "generic", model: "lightning", tts: "magpie", tools: ["Weather"] }));
    const c1 = await guard("C1.connect", 45000, () => H.startConversation(page, { timeoutMs: 40000 }));
    add("generic connects", !!c1?.connected);
    if (!(await guard("C1.welcome", 50000, () => H.waitForSettledWelcome(page)))) {
      throw new Error("generic welcome did not settle");
    }
    const genSid = await H.sessionId(page);
    await guard("C1.turn", 45000, () => H.turn(page, "Say hello in one short sentence.", "C_gen"));

    // C2. End generic, immediately switch to omni and start (clean transition, no hang).
    await guard("C2.end", 20000, () => H.endConversation(page));
    await guard("C2.dismiss", 8000, () => H.dismissFeedback(page));
    await guard("C2.select", 15000, () => H.selectExample(page, { example: "omni", tts: "magpie" }));
    const c2 = await guard("C2.connect", 45000, () => H.startConversation(page, { timeoutMs: 40000 }));
    const omniSid = await H.sessionId(page);
    add("switch generic→omni connects", !!c2?.connected);
    add("switch produced a new session id", !!omniSid && omniSid !== genSid, `gen=${genSid} omni=${omniSid}`);
    if (!(await guard("C2.welcome", 50000, () => H.waitForSettledWelcome(page)))) {
      throw new Error("switched Omni welcome did not settle");
    }
    const c2turn = await guard("C2.turn", 45000, () => H.turn(page, "Count from one to three.", "C_omni")) || {};
    add("omni responds after switch", !!c2turn.botSpoke);
    await guard("C2.end", 20000, () => H.endConversation(page));
    await guard("C2.dismiss2", 8000, () => H.dismissFeedback(page));

    // C3. Open ⚙ Settings, override the prompt with a distinctive instruction, close.
    const opened = await guard("C3.openSettings", 10000, () => H.openOverlay(page, "settings"));
    add("settings overlay opens", !!opened);
    // Pre-select generic so the textarea shows the generic base prompt, then append the marker.
    const ta = page.locator(".set-textarea");
    let promptEdited = false;
    if (await ta.count()) {
      const base = await ta.first().inputValue().catch(() => "");
      const instruction = `${base}\n\nIMPORTANT: You must end every single reply with the exact word ${PROMPT_MARKER}.`;
      await guard("C3.fillPrompt", 8000, () => ta.first().fill(instruction));
      promptEdited = (await ta.first().inputValue().catch(() => "")).includes(PROMPT_MARKER);
    }
    add("prompt textarea editable", promptEdited);
    await guard("C3.closeSettings", 8000, () => H.closeOverlay(page));

    // C4. Restart the pipeline (generic) → the prompt override should take effect.
    await guard("C4.select", 15000, () => H.selectExample(page, { example: "generic", model: "lightning", tts: "magpie", tools: ["Weather"] }));
    const c4 = await guard("C4.connect", 45000, () => H.startConversation(page, { timeoutMs: 40000 }));
    add("restart after prompt edit connects", !!c4?.connected);
    const promptSubmission = submittedConfigs[submittedConfigs.length - 1] || {};
    add("prompt override submitted to backend", Boolean(promptSubmission.promptHasMarker), "prompt_key=" + (promptSubmission.promptKey || "(missing)"));
    if (!(await guard("C4.welcome", 50000, () => H.waitForSettledWelcome(page)))) {
      throw new Error("restarted Generic welcome did not settle");
    }
    const c4turn = await guard("C4.turn", 45000, () => H.turn(page, "Please tell me your name in one sentence.", "C_prompt")) || {};
    const promptText = `${c4turn.domBot || ""} ${c4turn.botAsr || ""}`.toLowerCase();
    const promptFollowed = promptText.includes(PROMPT_MARKER.toLowerCase());
    rep.checks.push({ name: "model follows prompt marker", pass: promptFollowed, note: "reply=\"" + (c4turn.domBot || c4turn.botAsr || "").slice(0, 80) + "\"" });
    if (!promptFollowed) rep.warns.push("Lightning did not echo the prompt marker; browser payload delivery passed independently");
    console.log("  C " + (promptFollowed ? "PASS" : "WARN") + " model follows prompt marker");

    // C5. Pipeline info overlay opens/closes.
    const pi = await guard("C5.openPipeline", 10000, () => H.openOverlay(page, "pipeline"));
    add("pipeline-info overlay opens", !!pi);
    await guard("C5.closePipeline", 8000, () => H.closeOverlay(page));

    // C6. NGC session-capture status (this session consented at C1? no — start a consented one).
    await guard("C6.end", 20000, () => H.endConversation(page));
    await guard("C6.dismiss", 8000, () => H.dismissFeedback(page));
    await guard("C6.select", 15000, () => H.selectExample(page, { example: "generic", model: "lightning", tts: "magpie", tools: ["Weather"], consent: true }));
    const c6 = await guard("C6.connect", 45000, () => H.startConversation(page, { timeoutMs: 40000 }));
    const capSid = await H.sessionId(page);
    rep.captureSessionId = capSid; // status() no longer exposes per-session file listings to correlate against; kept for manual cross-reference against server logs
    if (c6?.connected) {
      await H.sleep(1500);
      await guard("C6.turn", 45000, () => H.turn(page, "This is a consented test session, thank you.", "C_cap"));
      await guard("C6.end2", 25000, () => H.endConversation(page));
      await guard("C6.dismiss2", 8000, () => H.dismissFeedback(page));
      await H.sleep(3000); // give the background capture task time to write/tar
    }
    // status() is deliberately lightweight (no per-session file/tarball listing --
    // would mean a full object-store scan on every status poll; see
    // session_capture/capture.py's status()) so there's nothing here to correlate
    // back to capSid specifically. What IS meaningful from this black-box harness:
    // the endpoint is reachable, reports a real backend, and isn't accumulating an
    // unbounded backlog of never-finalized sessions.
    const status = await guard("C6.status", 15000, () => H.sessionCaptureStatus(page));
    rep.captureStatus = status?.json ?? null;
    const j = status?.json || {};
    if (j.enabled === false) {
      rep.warns.push("session capture DISABLED on this deployment (SESSION_CAPTURE_ENABLED unset) — backend/backlog assertions skipped");
      add("session-capture status reachable", (status?.status || 0) === 200);
    } else {
      const hasBackend = j.store_backend === "s3" || j.store_backend === "local";
      const pending = Number(j.pending_sessions);
      const backlogBounded = Number.isInteger(pending) && pending >= 0 && pending < 20;
      add("session-capture reports a configured store backend", hasBackend, `store_backend=${JSON.stringify(j.store_backend)}`);
      add(
        "session-capture backlog bounded (consented session C6 given time to finalize)",
        backlogBounded,
        `pending_sessions=${JSON.stringify(j.pending_sessions)}`,
      );
    }

    add("no UI hangs", hangs.length === 0, hangs.join("; "));
  } catch (e) { rep.hardFails.push("threw: " + String(e).slice(0, 200)); }
  return finish(rep, sig, browser);
}

// --------------------------------------------------------------------------- //
// Phase D — 8 concurrent streams (mix generic + omni), isolated mics, no crosstalk.
// --------------------------------------------------------------------------- //
const TOKENS = ["alpha seven", "bravo three", "charlie nine", "delta two", "echo five", "foxtrot eight", "golf one", "hotel six"];

async function oneStream(i) {
  const isOmni = i % 2 === 1; // even i → generic, odd → omni
  const token = TOKENS[i - 1];
  const sig = H.newSignals(), hangs = [], guard = makeGuard(hangs);
  const r = { user: i, example: isOmni ? "omni" : "generic", token, hangs };
  const slot = await H.createAudioSlot(i);
  const browser = await H.launchBrowser({ headless: false, env: slot.env });
  try {
    const { page } = await H.newPage(browser, sig, { viewport: { width: 900, height: 700 } });
    await guard("goto", 50000, () => page.goto(H.BASE, { waitUntil: "domcontentloaded", timeout: 45000 }));
    await H.sleep(600 + i * 150);
    await guard("select", 15000, () => H.selectExample(page, isOmni ? { example: "omni" } : { example: "generic", model: "lightning", tools: ["Weather"] }));
    const conn = await guard("connect", 50000, () => H.startConversation(page, { timeoutMs: 45000 }));
    r.connected = !!conn?.connected;
    if (!r.connected) throw new Error("no connect");
    r.sessionId = await H.sessionId(page);
    if (!(await guard("settled welcome", 50000, () => H.waitForSettledWelcome(page)))) {
      throw new Error("welcome did not settle");
    }
    // Short multi-turn convo, each turn bound to this user's mic via micDevice.
    const prompts = [
      `Please repeat this exact code word back to me: ${token}.`,
      "Now say a short one sentence greeting.",
    ];
    r.turns = [];
    for (let k = 0; k < prompts.length; k++) {
      const t = await guard(`turn${k + 1}`, 45000, () => H.turn(page, prompts[k], `D_u${i}_t${k + 1}`, {
        micDevice: slot.micSink,
        monitor: slot.spkMonitor,
      })) || {};
      r.turns.push({ botSpoke: !!t.botSpoke, domUser: (t.domUser || "").slice(0, 60), domBot: (t.domBot || "").slice(0, 80) });
    }
    r.botSpoke = r.turns.every((t) => t.botSpoke);
    // Cross-talk check: this session's bot text must not contain another user's token.
    const allBot = r.turns.map((t) => t.domBot.toLowerCase()).join(" ");
    r.leaked = TOKENS.filter((tk, idx) => idx !== i - 1).some((tk) => allBot.includes(tk.toLowerCase()));
    await guard("end", 20000, () => H.endConversation(page));
    await page.context().close().catch(() => {});
  } catch (e) { r.error = String(e).slice(0, 140); }
  await browser.close().catch(() => {});
  Object.assign(r, signalCounts(sig));
  return r;
}

async function phaseD(N = 8) {
  console.log(`\n===== PHASE D: ${N} concurrent streams (mixed generic + omni) =====`);
  const t0 = Date.now();
  const results = await Promise.all(Array.from({ length: N }, (_, i) => oneStream(i + 1)));
  const wallS = ((Date.now() - t0) / 1000).toFixed(1);
  const ids = results.map((r) => r.sessionId).filter(Boolean);
  const uniqueIds = new Set(ids).size;
  const connected = results.filter((r) => r.connected).length;
  const spoke = results.filter((r) => r.botSpoke).length;
  const leaked = results.filter((r) => r.leaked).length;
  const hangs = results.reduce((a, r) => a + (r.hangs?.length || 0), 0);
  const errs = results.reduce((a, r) => a + (r.consoleErrors || 0) + (r.badResponses || 0) + (r.wsClosures || 0), 0);
  for (const r of results)
    console.log(`  D user ${r.user} [${r.example}]: connect=${r.connected ? "y" : "NO"} spoke=${r.botSpoke ? "y" : "n"} leaked=${r.leaked ? "YES" : "no"} id=${r.sessionId || "-"} err=${(r.consoleErrors || 0) + (r.badResponses || 0)}${r.error ? " ERR:" + r.error : ""}`);
  const pass = connected === N && spoke === N && uniqueIds === N && leaked === 0 && hangs === 0 && errs === 0;
  const rep = { phase: "D", name: `${N} concurrent streams`, N, wallS, connected, spoke, uniqueIds, leaked, hangs, errs, pass, hardFails: [], warns: [], results };
  if (connected !== N) rep.hardFails.push(`only ${connected}/${N} connected`);
  if (spoke !== N) rep.hardFails.push(`only ${spoke}/${N} responded`);
  if (uniqueIds !== N) rep.hardFails.push(`session ids not unique (${uniqueIds}/${N})`);
  if (leaked) rep.hardFails.push(`${leaked} cross-talk leak(s)`);
  if (hangs) rep.hardFails.push(`${hangs} hang(s)`);
  return rep;
}

// --------------------------------------------------------------------------- //
function finish(rep, sig, browser) {
  return browser.close().catch(() => {}).then(() => {
    const frame = sig.consoleErrors.find((e) => /Unknown frame kind|Failed to deserialize/i.test(e));
    if (frame) rep.hardFails.push(`console(frame): ${frame.slice(0, 80)}`);
    const other = sig.consoleErrors.filter((e) => !/Unknown frame kind|Failed to deserialize/i.test(e));
    if (other.length) rep.warns.push(`${other.length} console error(s): ${other[0].slice(0, 80)}`);
    if (sig.badResponses.length) rep.hardFails.push(`${sig.badResponses.length} HTTP>=400: ${sig.badResponses[0]}`);
    if (sig.wsClosures.length) rep.hardFails.push(`bad WS close: ${sig.wsClosures[0]}`);
    if ((rep.hangs?.length || 0) > 0) rep.hardFails.push(`${rep.hangs.length} hang(s): ${rep.hangs[0]}`);
    rep.signals = signalCounts(sig);
    rep.pass = rep.hardFails.length === 0;
    return rep;
  });
}

// --------------------------------------------------------------------------- //
function toolTableRows(a) {
  const t = a?.toolTable || {};
  return TOOL_TURNS.map((tt) => {
    const e = t[tt.label] || { called: 0, answeredWithoutCall: 0, failed: 0, attempts: 0 };
    const allCalled = e.attempts > 0 && e.called === e.attempts
      && e.answeredWithoutCall === 0 && e.failed === 0;
    const verdict = e.attempts === 0 ? "n/a" : allCalled ? "ALL_CALLED" : "FAILED";
    return { label: tt.label, tool: tt.tool, ...e, verdict };
  });
}

function writeReport(out) {
  fs.mkdirSync(H.OUT, { recursive: true });
  fs.writeFileSync(`${H.OUT}/comprehensive_report.json`, JSON.stringify(out, null, 2));
  const a = out.phases.find((p) => p.phase === "A");
  const rows = a ? toolTableRows(a) : [];
  const md = [];
  md.push(`# Comprehensive SQA report`, "");
  md.push(`- base: ${out.base}`, `- started: ${out.startedAt}`, `- finished: ${out.finishedAt}`, "");
  md.push(`## Result: ${out.pass ? "PASS ✅" : "FAIL ❌"}`, "");
  md.push(`| Phase | Name | Result | Hard fails | Warns |`, `|---|---|---|---|---|`);
  for (const p of out.phases)
    md.push(`| ${p.phase} | ${p.name} | ${p.pass ? "PASS" : "FAIL"} | ${(p.hardFails || []).join("; ") || "-"} | ${(p.warns || []).join("; ") || "-"} |`);
  md.push("", `## Nemotron Lightning tool-calling (Phase A headline)`, "");
  md.push(`| Tool | internal name | attempts | called | answered-no-call | failed | verdict |`, `|---|---|---|---|---|---|---|`);
  for (const r of rows)
    md.push(`| ${r.label} | ${r.tool} | ${r.attempts} | ${r.called} | ${r.answeredWithoutCall} | ${r.failed} | ${r.verdict} |`);
  fs.writeFileSync(`${H.OUT}/comprehensive_summary.md`, md.join("\n") + "\n");
}

// --------------------------------------------------------------------------- //
(async () => {
  const which = (process.argv[2] || "all").toUpperCase();
  const run = (p) => which === "ALL" || which === p;
  const out = { base: H.BASE, startedAt: new Date().toISOString(), phases: [] };
  console.log(`\n##### COMPREHENSIVE SQA vs ${H.BASE} (phases: ${which}) #####`);

  if (run("A")) { console.log(`\n===== PHASE A: Generic (Lightning) tool exercise =====`); out.phases.push(await phaseA()); }
  if (run("B")) { console.log(`\n===== PHASE B: Omni voice + image + webcam =====`); out.phases.push(await phaseB()); }
  if (run("C")) { console.log(`\n===== PHASE C: UI features =====`); out.phases.push(await phaseC()); }
  if (run("D")) { out.phases.push(await phaseD(8)); }

  out.finishedAt = new Date().toISOString();
  out.pass = out.phases.every((p) => p.pass);
  writeReport(out);

  // Console summary.
  console.log(`\n##### SUMMARY #####`);
  for (const p of out.phases)
    console.log(`  Phase ${p.phase} (${p.name}): ${p.pass ? "PASS ✅" : "FAIL ❌"}${(p.hardFails || []).length ? " — " + p.hardFails.join(" | ") : ""}${(p.warns || []).length ? "  [warn: " + p.warns.join(" | ") + "]" : ""}`);
  const a = out.phases.find((p) => p.phase === "A");
  if (a) {
    console.log(`\n  --- Nemotron Lightning tool-calling table ---`);
    console.log(`  ${"tool".padEnd(18)} ${"attempts".padStart(8)} ${"called".padStart(7)} ${"no-call".padStart(8)} ${"failed".padStart(7)}  verdict`);
    for (const r of toolTableRows(a))
      console.log(`  ${r.label.padEnd(18)} ${String(r.attempts).padStart(8)} ${String(r.called).padStart(7)} ${String(r.answeredWithoutCall).padStart(8)} ${String(r.failed).padStart(7)}  ${r.verdict}`);
  }
  console.log(`\n##### ${out.pass ? "ALL PASS ✅" : "FAIL ❌"} #####  reports: out/comprehensive_report.json + out/comprehensive_summary.md\n`);
  process.exit(out.pass ? 0 : 1);
})();
