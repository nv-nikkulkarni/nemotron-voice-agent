// SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause
//
// N users SPEAKING AT THE SAME TIME, each in its own browser bound to its own
// virtual mic (createAudioSlot), to prove there's no cross-talk: every user asks
// a DISTINCT arithmetic question and must get ITS OWN answer in ITS OWN session.
//
// To avoid the external inference-hub TTS/ASR rate limit skewing an app test, we
// PRE-SYNTHESIZE every utterance up front and, during the concurrent phase, use
// ONLY the app's own transcript (its Riva ASR + the bot's text) as the source of
// truth — no external inference calls while the users are live.
//
//   node concurrent_spoken.mjs [N=6]
import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as H from "./lib/harness.mjs";
import { synthSpeech } from "./lib/audio.mjs";
const execFileP = promisify(execFile);

const Q = [
  { a: 11, b: 22, sum: 33 }, { a: 40, b: 5, sum: 45 }, { a: 13, b: 8, sum: 21 },
  { a: 60, b: 7, sum: 67 }, { a: 25, b: 25, sum: 50 }, { a: 70, b: 4, sum: 74 },
  { a: 33, b: 33, sum: 66 }, { a: 12, b: 5, sum: 17 },
];
const words = { 33: /33|thirty.?three/i, 45: /45|forty.?five/i, 21: /21|twenty.?one/i, 67: /67|sixty.?seven/i,
  50: /50|fifty/i, 74: /74|seventy.?four/i, 66: /66|sixty.?six/i, 17: /17|seventeen/i };
const anySum = (txt) => Object.entries(words).filter(([, re]) => re.test(txt)).map(([s]) => Number(s));

async function waitBotQuiet(page, { settleMs = 1400, maxMs = 16000 } = {}) {
  const t0 = Date.now(); let lastLoud = Date.now(), sawOnset = false;
  await page.evaluate(() => window.__botReset());
  while (Date.now() - t0 < maxMs) {
    const b = await page.evaluate(() => window.__bot).catch(() => null);
    if (b?.onsetMs != null) sawOnset = true;
    if ((b?.rms || []).slice(-6).some(([, r]) => r > 0.012)) lastLoud = Date.now();
    if (sawOnset && Date.now() - lastLoud > settleMs) return true;
    await H.sleep(150);
  }
  return sawOnset;
}

async function oneUser(i, wav) {
  const q = Q[i - 1];
  const sig = H.newSignals();
  const r = { user: i, q: `${q.a}+${q.b}`, expect: q.sum };
  const slot = await H.createAudioSlot(i);
  const browser = await H.launchBrowser({ headless: false, env: slot.env });
  try {
    const { page } = await H.newPage(browser, sig, { viewport: { width: 900, height: 700 } });
    await page.goto(H.BASE, { waitUntil: "domcontentloaded", timeout: 45000 });
    await H.sleep(600 + i * 150);
    await H.selectExample(page, { example: "generic", model: "super" });
    const conn = await H.startConversation(page, { timeoutMs: 45000 });
    r.connected = conn.connected;
    if (!conn.connected) throw new Error("no connect");
    // Wait until the welcome greeting has actually RENDERED (bot bubble) AND its
    // audio has gone quiet, so our question isn't spoken over the greeting.
    const greetingRe = /nemotron|hello|assist you|help you|how can i/i;
    for (let k = 0; k < 24; k++) { const m = await H.readMessages(page); if (m.some((x) => x.role === "bot" && greetingRe.test(x.text))) break; await H.sleep(500); }
    await waitBotQuiet(page, { settleMs: 1400, maxMs: 14000 });

    const ask = async () => { await page.evaluate(() => window.__botReset());
      await execFileP("paplay", [`--device=${slot.micSink}`, wav]);
      return waitBotQuiet(page, { settleMs: 1600, maxMs: 20000 }); };

    r.botSpoke = await ask();
    let domBot = "", domUser = "", attempts = 1;
    for (let k = 0; k < 24; k++) {   // up to ~12s for the answer bubble to finalize
      const msgs = await H.readMessages(page);
      domUser = [...msgs].reverse().find((m) => m.role === "user" && /plus|what is/i.test(m.text))?.text || domUser;
      domBot = msgs.filter((m) => m.role === "bot").pop()?.text || domBot;
      if (words[q.sum].test(domBot)) break;
      // if the latest bot bubble is still just the greeting, re-ask once
      if (k === 12 && attempts === 1 && greetingRe.test(domBot) && !/plus|equal|\d/i.test(domBot)) { attempts = 2; r.botSpoke = await ask(); }
      await H.sleep(500);
    }
    r.attempts = attempts;
    r.domUser = domUser; r.domBot = domBot; r.latencyS = res_latency(await H.latencyText(page));
    r.correct = words[q.sum].test(domBot);
    const sums = anySum(domBot);
    r.leakedOther = sums.length > 0 && !sums.includes(q.sum);   // answered a DIFFERENT user's sum
    await H.endConversation(page);
    await page.context().close().catch(() => {});
  } catch (e) { r.error = String(e).slice(0, 140); }
  await browser.close().catch(() => {});
  r.consoleErrors = sig.consoleErrors.length; r.badResponses = sig.badResponses.length;
  return r;
}
function res_latency(txt) { return H.parseLatencyS(txt); }

(async () => {
  const N = Math.min(parseInt(process.argv[2] || "6", 10), Q.length);
  console.log(`\n===== CONCURRENT SPOKEN: ${N} users talking simultaneously vs ${H.BASE} =====`);
  fs.mkdirSync(H.OUT, { recursive: true });
  console.log(`  pre-synthesizing ${N} utterances (sequential, before the concurrent phase)...`);
  const wavs = [];
  for (let i = 1; i <= N; i++) { const q = Q[i - 1]; const { outWav } = await synthSpeech(`What is ${q.a} plus ${q.b}?`, `${H.OUT}/cs_u${i}.wav`); wavs.push(outWav); }

  const t0 = Date.now();
  const results = await Promise.all(Array.from({ length: N }, (_, i) => oneUser(i + 1, wavs[i])));
  const wallS = ((Date.now() - t0) / 1000).toFixed(1);

  for (const r of results)
    console.log(`  user ${r.user} asked ${r.q}=${r.expect}: connect=${r.connected ? "y" : "NO"} spoke=${r.botSpoke ? "y" : "n"} ` +
      `correct=${r.correct ? "✓" : "✗"} leaked=${r.leakedOther ? "YES" : "no"} lat=${r.latencyS ?? "?"}s ` +
      `heardUser="${(r.domUser || "").slice(0, 26)}" bot="${(r.domBot || "").slice(0, 34)}"${r.error ? " ERR:" + r.error : ""}`);

  const connected = results.filter((r) => r.connected).length;
  const correct = results.filter((r) => r.correct).length;
  const leaked = results.filter((r) => r.leakedOther).length;
  const errs = results.reduce((a, r) => a + (r.consoleErrors || 0) + (r.badResponses || 0), 0);
  const pass = connected === N && correct === N && leaked === 0 && errs === 0;
  fs.writeFileSync(`${H.OUT}/concurrent_spoken_report.json`, JSON.stringify({ base: H.BASE, N, wallS, connected, correct, leaked, errs, pass, results }, null, 2));
  console.log(`\n  connected=${connected}/${N} correct-own-answer=${correct}/${N} cross-talk-leaks=${leaked} errors=${errs} in ${wallS}s`);
  console.log(`===== ${pass ? "PASS ✅" : "FAIL ❌"} =====\n  report: out/concurrent_spoken_report.json\n`);
  process.exit(pass ? 0 : 1);
})();
