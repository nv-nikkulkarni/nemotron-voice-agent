// SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause
//
// Real multi-turn spoken conversations against the live deployment. For each
// scripted turn we SPEAK (external TTS -> virtmic), LISTEN (record the bot +
// external ASR), and verify: the app heard us (DOM user bubble), the bot spoke,
// latency within budget, no console/HTTP/WS errors, and (warn) the answer is
// on-topic. Followups reference earlier answers to exercise dialogue context.
//
//   node converse.mjs [generic|omni|both]
import fs from "node:fs";
import * as H from "./lib/harness.mjs";

const CONVERSATIONS = {
  generic: {
    example: "generic", model: "lightning", label: "Generic Frontend/Backend Assistant",
    turns: [
      { text: "Hi there! Can you introduce yourself in one short sentence?", heard: /introduce|yourself/i, expect: /nemotron|assistant|nvidia/i, budgetS: 12 },
      { text: "What's the weather in Tokyo right now?", heard: /weather|tokyo/i, expect: /degree|temperature|sky|cloud|rain|clear|celsius|tokyo/i, budgetS: 20, tool: "weather" },
      { text: "And how about in London?", heard: /london/i, expect: /degree|temperature|london|sky|cloud|rain|clear|celsius/i, budgetS: 20, tool: "weather (context followup)" },
      { text: "What is the current NVIDIA stock price?", heard: /nvidia|stock|price/i, expect: /nvidia|price|dollar|\d/i, budgetS: 20, tool: "stock" },
      { text: "What is one recent NVIDIA news headline?", heard: /nvidia|news|headline/i, expect: /nvidia|ai|gpu|chip|announc/i, budgetS: 25, tool: "web_search" },
      { text: "Great, thank you so much. Goodbye!", heard: /thank|goodbye/i, expect: /bye|welcome|glad|help|day|care/i, budgetS: 12 },
    ],
  },
  omni: {
    example: "omni", model: null, label: "Omni Assistant Subagents (Beta)",
    turns: [
      { text: "Hello! Please tell me a short one sentence story about a friendly robot.", heard: /story|robot/i, expect: /robot/i, budgetS: 20 },
      { text: "What is seventeen times twenty three?", heard: /seventeen|twenty three/i, expect: /391|three hundred|ninety/i, budgetS: 20, tool: "mental math" },
      { text: "Thanks, that is all for now. Bye!", heard: /thanks|bye/i, expect: /bye|welcome|glad|care|day/i, budgetS: 16 },
    ],
  },
};

async function runConversation(key) {
  const conv = CONVERSATIONS[key];
  const sig = H.newSignals();
  const rep = { key, label: conv.label, startedAt: new Date().toISOString(), turns: [], hardFails: [], warns: [] };
  const slot = await H.createAudioSlot(key === "generic" ? 81 : 82);
  const browser = await H.launchBrowser({ headless: false, env: slot.env });
  try {
    const { page } = await H.newPage(browser, sig);
    await page.goto(H.BASE, { waitUntil: "domcontentloaded", timeout: 30000 });
    if (!(await H.waitForDeploymentReady(page))) throw new Error("deployment options did not become ready");
    await H.selectExample(page, { example: conv.example, model: conv.model });
    const conn = await H.startConversation(page);
    rep.connected = conn.connected; rep.connectMs = conn.connectMs;
    if (!conn.connected) { rep.hardFails.push("never connected"); return finish(rep, sig, browser); }
    if (!(await H.waitForSettledWelcome(page))) {
      rep.hardFails.push("welcome did not settle before first turn");
      return finish(rep, sig, browser);
    }

    for (let i = 0; i < conv.turns.length; i++) {
      const t = conv.turns[i];
      process.stdout.write(`    turn ${i + 1}/${conv.turns.length}: "${t.text.slice(0, 42)}..." `);
      const r = await H.turn(page, t.text, `${key}_t${i + 1}`, {
        micDevice: slot.micSink, spkDevice: slot.spkSink, monitor: slot.spkMonitor, settle: true,
      });
      const answer = (r.domBot || r.botAsr || "").trim();
      const inputGrounded = t.heard ? t.heard.test(r.domUser || "") : Boolean(r.domUser);
      const onTopic = t.expect ? t.expect.test(answer) : true;
      const tr = { i: i + 1, ...t, ...r, answer, inputGrounded, onTopic };
      rep.turns.push(tr);
      if (!r.botSpoke) rep.hardFails.push(`turn ${i + 1}: bot did not speak`);
      if (!inputGrounded) rep.hardFails.push(`turn ${i + 1}: application ASR did not preserve required input`);
      if (r.latencyS != null && r.latencyS > t.budgetS) rep.warns.push(`turn ${i + 1}: latency ${r.latencyS}s > ${t.budgetS}s`);
      if (!onTopic) rep.hardFails.push(`turn ${i + 1}: answer off-topic vs /${t.expect?.source}/`);
      console.log(`${r.botSpoke ? "spoke" : "SILENT"} lat=${r.latencyS ?? "?"}s ${onTopic ? "on-topic" : "OFF-TOPIC"} | heard: "${answer.slice(0, 60)}"`);
    }

    const end = await H.endConversation(page);
    rep.ended = end.ended; rep.thanksModal = end.thanks;
    if (!end.thanks) rep.warns.push("End did not show thank-you modal");
  } catch (e) {
    rep.hardFails.push("threw: " + String(e).slice(0, 200));
  }
  return finish(rep, sig, browser);
}

async function finish(rep, sig, browser) {
  await browser.close().catch(() => {});
  const frameErr = sig.consoleErrors.find((e) => /Unknown frame kind|Failed to deserialize/i.test(e));
  if (frameErr) rep.hardFails.push(`console(frame): ${frameErr.slice(0, 80)}`);
  const other = sig.consoleErrors.filter((e) => !/Unknown frame kind|Failed to deserialize/i.test(e));
  if (other.length) rep.hardFails.push(`${other.length} console error(s): ${other[0].slice(0, 80)}`);
  if (sig.badResponses.length) rep.hardFails.push(`${sig.badResponses.length} HTTP>=400: ${sig.badResponses[0]}`);
  if (sig.wsClosures.length) rep.hardFails.push(`bad WS close: ${sig.wsClosures[0]}`);
  rep.signals = sig;
  rep.pass = rep.hardFails.length === 0;
  rep.finishedAt = new Date().toISOString();
  return rep;
}

(async () => {
  const which = (process.argv[2] || "both").toLowerCase();
  const keys = which === "both" ? ["generic", "omni"] : [which];
  const out = { runId: H.RUN_ID, base: H.BASE, startedAt: new Date().toISOString(), conversations: [] };
  for (const k of keys) {
    console.log(`\n===== CONVERSATION: ${CONVERSATIONS[k].label} =====`);
    const rep = await runConversation(k);
    out.conversations.push(rep);
    console.log(`  => ${rep.pass ? "PASS ✅" : "FAIL ❌"}  ${rep.hardFails.length ? "HARD: " + rep.hardFails.join(" | ") : ""}`);
    if (rep.warns.length) console.log(`     warns: ${rep.warns.join(" | ")}`);
  }
  fs.mkdirSync(H.OUT, { recursive: true });
  fs.writeFileSync(`${H.OUT}/converse_report.json`, JSON.stringify(out, null, 2));
  const passed = out.conversations.filter((c) => c.pass).length;
  console.log(`\n===== ${passed}/${out.conversations.length} conversations passed =====\n  report: out/converse_report.json`);
  process.exit(passed === out.conversations.length ? 0 : 1);
})();
