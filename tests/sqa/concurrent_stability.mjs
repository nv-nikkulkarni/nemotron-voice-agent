// SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause
//
// 30-CLIENT CONCURRENT SWITCHING STABILITY TEST.  See SQA_TEST_PLAN.md +
// CONVERSATION_FLOW_PLAN.md.  Each client = its own Chromium bound to its own PulseAudio
// slot (createAudioSlot); pre-synthesized WAVs are played into each mic; the bot's spoken
// answer is captured (WebAudio RMS tap + ffmpeg) and independently transcribed via the
// inference-hub ASR, cross-checked against the app's own transcript.  A barrier forces all
// N clients to hold a live WS simultaneously before the conversation phase.  Clients then
// ping-pong generic <-> omni-subagents, ending some sessions MID-TURN, for ROUNDS rounds.
//
//   node concurrent_stability.mjs [N=30] [ROUNDS=2] [QPER=2]
import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as H from "./lib/harness.mjs";
import { synthSpeech, transcribe } from "./lib/audio.mjs";
const execFileP = promisify(execFile);

const N = parseInt(process.argv[2] || "30", 10);
const ROUNDS = parseInt(process.argv[3] || "2", 10);
const QPER = parseInt(process.argv[4] || "2", 10);

// ---- Query banks -----------------------------------------------------------------------
// Generic: each client owns ONE country → unique capital token (cross-talk canary) + a
// second deterministic fact (continent). Distinct tokens per client detect answer bleed.
const COUNTRIES = [
  ["France", "Paris", /paris/i, "Europe", /europe/i], ["Japan", "Tokyo", /tokyo/i, "Asia", /asia/i],
  ["Egypt", "Cairo", /cairo/i, "Africa", /africa/i], ["Brazil", "Brasilia", /brasil|brazil/i, "South America", /south america/i],
  ["Canada", "Ottawa", /ottawa/i, "North America", /north america/i], ["Australia", "Canberra", /canberra/i, "Oceania|Australia", /oceania|australia/i],
  ["Italy", "Rome", /rome/i, "Europe", /europe/i], ["Kenya", "Nairobi", /nairobi/i, "Africa", /africa/i],
  ["India", "New Delhi", /delhi/i, "Asia", /asia/i], ["Spain", "Madrid", /madrid/i, "Europe", /europe/i],
  ["Mexico", "Mexico City", /mexico city/i, "North America", /north america/i], ["Norway", "Oslo", /oslo/i, "Europe", /europe/i],
  ["Turkey", "Ankara", /ankara/i, "Asia|Europe", /asia|europe/i], ["Thailand", "Bangkok", /bangkok/i, "Asia", /asia/i],
  ["Peru", "Lima", /lima/i, "South America", /south america/i], ["Greece", "Athens", /athens/i, "Europe", /europe/i],
  ["Nigeria", "Abuja", /abuja/i, "Africa", /africa/i], ["Sweden", "Stockholm", /stockholm/i, "Europe", /europe/i],
  ["Argentina", "Buenos Aires", /buenos aires/i, "South America", /south america/i], ["Vietnam", "Hanoi", /hanoi/i, "Asia", /asia/i],
  ["Poland", "Warsaw", /warsaw/i, "Europe", /europe/i], ["Chile", "Santiago", /santiago/i, "South America", /south america/i],
  ["Morocco", "Rabat", /rabat/i, "Africa", /africa/i], ["Portugal", "Lisbon", /lisbon/i, "Europe", /europe/i],
  ["Indonesia", "Jakarta", /jakarta/i, "Asia", /asia/i], ["Ireland", "Dublin", /dublin/i, "Europe", /europe/i],
  ["Colombia", "Bogota", /bogot/i, "South America", /south america/i], ["Finland", "Helsinki", /helsinki/i, "Europe", /europe/i],
  ["Ghana", "Accra", /accra/i, "Africa", /africa/i], ["Austria", "Vienna", /vienna/i, "Europe", /europe/i],
];
// Omni-subagents: voice-only (no attachment). Deterministic math + a rotating fact.
const OMNI_MATH = [[7, 8, /56|fifty.?six/i], [6, 9, /54|fifty.?four/i], [12, 5, /60|sixty/i], [11, 11, /121|hundred twenty.?one/i],
  [9, 9, /81|eighty.?one/i], [8, 7, /56|fifty.?six/i], [13, 3, /39|thirty.?nine/i], [15, 4, /60|sixty/i]];
const OMNI_FACTS = [
  ["Name the three primary colors.", /red|blue|yellow/i],
  ["What is the largest planet in our solar system?", /jupiter/i],
  ["How many days are in a week?", /seven|7/i],
  ["Count from one to five.", /one|two|three|four|five|1|2|3|4|5/i],
];
const ERR_LEAK = /(HTTP\s*\d|status\s*code|web search failed|traceback|exception|\bundefined\b|\bNaN\b|\[object Object\])/i;
const GREETING = /nemotron|voice assistant|hello|hi there|how can i (help|assist)|assist you|help you today/i;

// Wait for currently-playing bot audio (a greeting or a prior answer) to onset + settle.
// Use ONLY right after Start (audio is playing); calling it when quiet would burn maxMs.
async function waitBotQuiet(page, { settleMs = 1300, maxMs = 16000 } = {}) {
  const t0 = Date.now(); let lastLoud = Date.now(), sawOnset = false;
  await page.evaluate(() => window.__botReset()).catch(() => {});
  while (Date.now() - t0 < maxMs) {
    const b = await page.evaluate(() => window.__bot).catch(() => null);
    if (b?.onsetMs != null) sawOnset = true;
    if ((b?.rms || []).slice(-6).some(([, r]) => r > 0.012)) lastLoud = Date.now();
    if (sawOnset && Date.now() - lastLoud > settleMs) return true;
    await H.sleep(150);
  }
  return sawOnset;
}

// ---- Simple N-party barrier ------------------------------------------------------------
function makeBarrier(n) {
  let count = 0, release; const gate = new Promise((r) => (release = r));
  return async () => { if (++count >= n) release(); await Promise.race([gate, H.sleep(90000)]); };
}

// ---- One spoken turn using a PRE-SYNTHESIZED wav (no per-turn TTS) ----------------------
async function spokenTurn(page, wav, name, slot, { transcribeBot = true, cap = 22000 } = {}) {
  await page.evaluate(() => window.__botReset()).catch(() => {});
  const before = (await H.readMessages(page).catch(() => [])).length;
  const t0 = Date.now();
  await execFileP("paplay", [`--device=${slot.micSink}`, wav]).catch(() => {});
  const capr = await H.captureBot(page, name, { monitor: slot.spkMonitor, maxMs: cap }).catch(() => ({ sawOnset: false, responseMs: null, out: null }));
  const wallMs = Date.now() - t0;
  let botAsr = "";
  if (capr.sawOnset && transcribeBot && capr.out) botAsr = await transcribe(capr.out).catch(() => "");
  // Poll for a FINALIZED, non-greeting answer bubble (the reasoning/omni answer can lag
  // its audio; the last bubble may still be the greeting when we first read).
  let domBot = "", domUser = "";
  for (let k = 0; k < 20; k++) {
    const nw = (await H.readMessages(page).catch(() => [])).slice(before);
    domUser = nw.find((m) => m.role === "user")?.text || domUser;
    const bots = nw.filter((m) => m.role === "bot").map((m) => m.text);
    const answer = [...bots].reverse().find((t) => !GREETING.test(t));
    domBot = answer || bots[bots.length - 1] || domBot;
    if (answer) break;
    await H.sleep(500);
  }
  const latencyS = H.parseLatencyS(await H.latencyText(page).catch(() => ""));
  return { botSpoke: capr.sawOnset, botAsr, domUser, domBot, responseMs: capr.responseMs, wallMs, latencyS };
}

const phaseOf = (page) => page.evaluate(() => (window.__session && window.__session.phase) || "").catch(() => "");

// ---- One client's full flow ------------------------------------------------------------
async function oneClient(i, wavs, otherCapitals, barrier) {
  const c = COUNTRIES[(i - 1) % COUNTRIES.length];
  const sig = H.newSignals();
  const rec = { client: i, country: c[0], connected: false, turns: [], findings: [], switches: 0, hangs: 0,
    wsClosures: 0, consoleErrors: 0, latencies: [] };
  const foreign = otherCapitals.filter((cap) => cap.re !== c[2]); // other clients' capital regexes
  let slot, browser, page, ctx;
  const finding = (kind, extra) => rec.findings.push({ kind, ...extra });

  const verify = (example, query, t, expectRe) => {
    rec.turns.push({ example, query, ...t });
    if (typeof t.latencyS === "number") rec.latencies.push(t.latencyS);
    const text = `${t.domBot || ""} ${t.botAsr || ""}`;
    if (!t.botSpoke && !t.domBot) { rec.hangs++; finding("hang", { example, query, t }); return; }
    if (ERR_LEAK.test(text)) finding("error_leak_spoken", { example, query, text: text.slice(0, 160) });
    if (expectRe && !expectRe.test(text)) finding("wrong_or_irrelevant", { example, query, got: (t.domBot || t.botAsr || "").slice(0, 120) });
    const bleed = foreign.find((f) => f.re.test(text));
    if (bleed) finding("cross_talk_leak", { example, query, leakedCapital: bleed.capital, text: text.slice(0, 120) });
  };

  try {
    slot = await H.createAudioSlot(i);
    // HEADED (env HEADED=1) routes WebAudio output to the real PulseAudio sink so the bot
    // response can be captured + externally ASR-verified — but is CPU-heavy (use for small
    // batches). HEADLESS is light enough for the full 30-way pipeline stress; the bot audio
    // capture is then silent (external ASR skipped) but the app's OWN transcript (domBot) is
    // authoritative and the pipeline's ASR is still exercised via domUser.
    const HEADED = process.env.HEADED === "1";
    browser = await H.launchBrowser({ headless: !HEADED, env: slot.env });
    ({ ctx, page } = await H.newPage(browser, sig, { viewport: { width: 900, height: 700 } }));
    await page.goto(H.BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
    await H.sleep(400 + i * 200); // stagger connect to avoid a thundering herd

    for (let round = 0; round < ROUNDS; round++) {
      // ---------- GENERIC ----------
      await H.selectExample(page, { example: "generic", model: "super" });
      const g = await H.startConversation(page, { timeoutMs: 45000 });
      if (round === 0) rec.connected = g.connected;
      if (!g.connected) { rec.hangs++; finding("connect_stuck", { example: "generic", round }); }
      else {
        if (round === 0) await barrier(); // ALL 30 live before the conversation phase
        // let the greeting render + go quiet
        for (let k = 0; k < 16 && !(await H.readMessages(page)).some((m) => m.role === "bot"); k++) await H.sleep(400);
        await waitBotQuiet(page); // let the greeting audio finish before speaking
        for (let q = 0; q < QPER; q++) {
          const isCap = q === 0;
          const wav = isCap ? wavs.gcap[i - 1] : wavs.gcont[i - 1];
          const t = await spokenTurn(page, wav, `c${i}_r${round}_g${q}`, slot);
          verify("generic", isCap ? `capital of ${c[0]}` : `continent of ${c[0]}`, t, isCap ? c[2] : c[4]);
          if (phaseOf(page) && (await phaseOf(page)) !== "live") { finding("dropped_mid_session", { example: "generic", round, q }); break; }
        }
      }
      // End (mid-turn on ~1/3 of rounds)
      const midTurn = (i + round) % 3 === 0 && g.connected;
      if (midTurn) { await execFileP("paplay", [`--device=${slot.micSink}`, wavs.gcap[i - 1]]).catch(() => {}); } // speak, don't wait
      await H.endConversation(page).catch(() => {});
      rec.switches++;
      await H.dismissFeedback(page).catch(() => {});
      await H.sleep(300);

      // ---------- SWITCH -> OMNI (known-fragile path) ----------
      await H.selectExample(page, { example: "omni" });
      const o = await H.startConversation(page, { timeoutMs: 45000 });
      if (!o.connected) { rec.hangs++; finding("omni_switch_stuck", { round, afterMidTurn: midTurn });
        // recovery attempt: back home + retry once
        await H.endConversation(page).catch(() => {}); await H.dismissFeedback(page).catch(() => {}); await H.sleep(500);
      } else {
        for (let k = 0; k < 16 && !(await H.readMessages(page)).some((m) => m.role === "bot"); k++) await H.sleep(400);
        await waitBotQuiet(page); // let the greeting audio finish before speaking
        for (let q = 0; q < QPER; q++) {
          let wav, label, expect;
          if (q === 0) { const m = OMNI_MATH[(i - 1) % OMNI_MATH.length]; wav = wavs.omath[i - 1]; label = `${m[0]}x${m[1]}`; expect = m[2]; }
          else { const f = OMNI_FACTS[(i + round) % OMNI_FACTS.length]; wav = wavs.ofact[(i + round) % OMNI_FACTS.length]; label = f[0]; expect = f[1]; }
          const t = await spokenTurn(page, wav, `c${i}_r${round}_o${q}`, slot);
          verify("omni", label, t, expect);
          if (phaseOf(page) && (await phaseOf(page)) !== "live") { finding("dropped_mid_session", { example: "omni", round, q }); break; }
        }
      }
      const midTurn2 = (i + round) % 3 === 1 && o.connected;
      if (midTurn2) { await execFileP("paplay", [`--device=${slot.micSink}`, wavs.omath[i - 1]]).catch(() => {}); }
      await H.endConversation(page).catch(() => {});
      rec.switches++;
      await H.dismissFeedback(page).catch(() => {});
      await H.sleep(300);
    }
  } catch (e) {
    rec.findings.push({ kind: "exception", error: String(e).slice(0, 200) });
  } finally {
    try { await ctx?.close(); } catch { /* ignore */ }
    try { await browser?.close(); } catch { /* ignore */ }
  }
  rec.consoleErrors = sig.consoleErrors.length;
  rec.wsClosures = sig.wsClosures.length;
  if (sig.consoleErrors.length) rec.consoleErrorSamples = sig.consoleErrors.slice(0, 3);
  return rec;
}

// ---- main ------------------------------------------------------------------------------
(async () => {
  console.log(`\n===== CONCURRENT STABILITY: ${N} clients x ${ROUNDS} rounds (generic<->omni), ${QPER} q/session vs ${H.BASE} =====`);
  fs.mkdirSync(H.OUT, { recursive: true });
  console.log(`  pre-synthesizing query WAVs (one-time, sequential; reuses existing)…`);
  const synthIf = async (text, path) => (fs.existsSync(path) && fs.statSync(path).size > 1000) ? path : (await synthSpeech(text, path)).outWav;
  const wavs = { gcap: [], gcont: [], omath: [], ofact: [] };
  for (let i = 0; i < N; i++) {
    const c = COUNTRIES[i % COUNTRIES.length]; const m = OMNI_MATH[i % OMNI_MATH.length];
    wavs.gcap[i] = await synthIf(`What is the capital of ${c[0]}?`, `${H.OUT}/st_gcap_${i}.wav`);
    wavs.gcont[i] = await synthIf(`Which continent is ${c[0]} in?`, `${H.OUT}/st_gcont_${i}.wav`);
    wavs.omath[i] = await synthIf(`What is ${m[0]} times ${m[1]}?`, `${H.OUT}/st_omath_${i}.wav`);
  }
  for (let f = 0; f < OMNI_FACTS.length; f++) wavs.ofact[f] = await synthIf(OMNI_FACTS[f][0], `${H.OUT}/st_ofact_${f}.wav`);
  console.log(`  synthesized ${N * 3 + OMNI_FACTS.length} WAVs. Launching ${N} concurrent clients…`);

  const otherCapitals = COUNTRIES.slice(0, N).map((c) => ({ capital: c[1], re: c[2] }));
  const barrier = makeBarrier(N);
  const t0 = Date.now();
  const results = await Promise.all(Array.from({ length: N }, (_, i) => oneClient(i + 1, wavs, otherCapitals, barrier)));
  const wallS = ((Date.now() - t0) / 1000).toFixed(1);

  // ---- aggregate ----
  const allTurns = results.flatMap((r) => r.turns);
  const allFind = results.flatMap((r) => r.findings.map((f) => ({ client: r.client, ...f })));
  const lat = results.flatMap((r) => r.latencies).filter((x) => typeof x === "number").sort((a, b) => a - b);
  const pct = (p) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor(lat.length * p))] : null);
  const byKind = {}; for (const f of allFind) byKind[f.kind] = (byKind[f.kind] || 0) + 1;
  const connected = results.filter((r) => r.connected).length;
  const asrOk = allTurns.filter((t) => t.botAsr && t.botAsr.length > 1).length;
  const summary = {
    base: H.BASE, N, ROUNDS, QPER, wallS,
    connected, totalTurns: allTurns.length,
    turnsWithResponse: allTurns.filter((t) => t.botSpoke || t.domBot).length,
    asrTranscribed: asrOk,
    findingsByKind: byKind, totalFindings: allFind.length,
    hangs: results.reduce((a, r) => a + r.hangs, 0),
    wsClosures: results.reduce((a, r) => a + r.wsClosures, 0),
    consoleErrors: results.reduce((a, r) => a + r.consoleErrors, 0),
    switches: results.reduce((a, r) => a + r.switches, 0),
    latencyS: { p50: pct(0.5), p95: pct(0.95), max: lat[lat.length - 1] ?? null },
  };
  const pass = connected === N && (byKind.error_leak_spoken || 0) === 0 && (byKind.cross_talk_leak || 0) === 0 &&
    summary.hangs === 0 && summary.wsClosures === 0 && summary.consoleErrors === 0;

  fs.writeFileSync(`${H.OUT}/concurrent_stability_report.json`, JSON.stringify({ summary, findings: allFind, results }, null, 2));
  console.log(`\n===== RESULTS (${wallS}s) =====`);
  console.log(`  clients connected     : ${connected}/${N}`);
  console.log(`  turns (response/total): ${summary.turnsWithResponse}/${summary.totalTurns}   ASR-transcribed: ${asrOk}`);
  console.log(`  switches performed    : ${summary.switches}`);
  console.log(`  hangs                 : ${summary.hangs}`);
  console.log(`  WS drops (socketerror): ${summary.wsClosures}`);
  console.log(`  console/page errors   : ${summary.consoleErrors}`);
  console.log(`  latency p50/p95/max   : ${summary.latencyS.p50}/${summary.latencyS.p95}/${summary.latencyS.max} s`);
  console.log(`  findings by kind      : ${JSON.stringify(byKind)}`);
  if (allFind.length) { console.log(`  --- sample findings (first 12) ---`); for (const f of allFind.slice(0, 12)) console.log(`   [c${f.client}] ${f.kind}: ${JSON.stringify(f).slice(0, 180)}`); }
  console.log(`\n===== ${pass ? "PASS ✅" : "FAIL ❌ (see findings)"} =====\n  report: out/concurrent_stability_report.json\n`);
  process.exit(pass ? 0 : 1);
})();
