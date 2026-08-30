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
    example: "generic", model: "super", label: "Generic Assistant (Super)",
    turns: [
      { text: "Hi there! Can you introduce yourself in one short sentence?", expect: /nemotron|assistant|nvidia|help/i, budgetS: 12 },
      { text: "What's the weather in Tokyo right now?", expect: /degree|temperature|sky|cloud|rain|clear|celsius|tokyo/i, budgetS: 12, tool: "weather" },
      { text: "And how about in London?", expect: /degree|temperature|london|sky|cloud|rain|clear|celsius/i, budgetS: 12, tool: "weather (context followup)" },
      { text: "Convert one hundred US dollars to euros.", expect: /euro|dollar|\d/i, budgetS: 12, tool: "currency" },
      { text: "What is one recent NVIDIA news headline?", expect: /nvidia|ai|gpu|chip|announc/i, budgetS: 20, tool: "web_search" },
      { text: "Great, thank you so much. Goodbye!", expect: /bye|welcome|glad|help|day|care/i, budgetS: 12 },
    ],
  },
  omni: {
    example: "omni", model: null, label: "Omni Assistant Subagents (Beta)",
    turns: [
      { text: "Hello! Please tell me a short one sentence story about a friendly robot.", expect: /robot|.+/i, budgetS: 16 },
      { text: "What is seventeen times twenty three?", expect: /391|three hundred|ninety/i, budgetS: 16, tool: "mental math" },
      { text: "Thanks, that is all for now. Bye!", expect: /bye|welcome|glad|care|day/i, budgetS: 16 },
    ],
  },
};

async function runConversation(key) {
  const conv = CONVERSATIONS[key];
  const sig = H.newSignals();
  const rep = { key, label: conv.label, startedAt: new Date().toISOString(), turns: [], hardFails: [], warns: [] };
  const browser = await H.launchBrowser({ headless: false });
  try {
    const { page } = await H.newPage(browser, sig);
    await page.goto(H.BASE, { waitUntil: "domcontentloaded", timeout: 30000 });
    await H.sleep(1500);
    await H.selectExample(page, { example: conv.example, model: conv.model });
    const conn = await H.startConversation(page);
    rep.connected = conn.connected; rep.connectMs = conn.connectMs;
    if (!conn.connected) { rep.hardFails.push("never connected"); return finish(rep, sig, browser); }
    await H.sleep(1500); // let the welcome greeting play out

    for (let i = 0; i < conv.turns.length; i++) {
      const t = conv.turns[i];
      process.stdout.write(`    turn ${i + 1}/${conv.turns.length}: "${t.text.slice(0, 42)}..." `);
      const r = await H.turn(page, t.text, `${key}_t${i + 1}`);
      const answer = (r.botAsr || r.domBot || "").trim();
      const onTopic = t.expect ? t.expect.test(answer) : true;
      const tr = { i: i + 1, ...t, ...r, answer, onTopic };
      rep.turns.push(tr);
      if (!r.botSpoke) rep.hardFails.push(`turn ${i + 1}: bot did not speak`);
      if (!r.domUser) rep.warns.push(`turn ${i + 1}: app showed no user transcript (ASR miss?)`);
      if (r.latencyS != null && r.latencyS > t.budgetS) rep.warns.push(`turn ${i + 1}: latency ${r.latencyS}s > ${t.budgetS}s`);
      if (!onTopic) rep.warns.push(`turn ${i + 1}: answer off-topic vs /${t.expect?.source}/`);
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
  const out = { base: H.BASE, startedAt: new Date().toISOString(), conversations: [] };
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
