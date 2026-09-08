// SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause
//
// Focused E2E for the LIVE get_stock_price (Finnhub) tool on the generic-assistant
// pipeline: SPEAK a stock question, LISTEN to the bot, and confirm it answered with a
// number (not a mock / not "unavailable"). Also runs a weather + web_search regression.
//
//   node verify_stock.mjs
import * as H from "./lib/harness.mjs";

// NB: the voice prompt spells numbers as words (no digits), so price matchers accept
// either digits OR spelled-out numbers ("hundred"/"point"/"dollars").
const NUM = /\d|hundred|thousand|point|dollar/i;
const TURNS = [
  { text: "What is NVIDIA's stock price right now?", tool: "stock", want: NUM },
  { text: "And how about Apple stock?", tool: "stock (context)", want: NUM },
  { text: "What's the weather in Pune right now?", tool: "weather (current)", want: /degree|celsius|rain|cloud|clear|humid|wind|pune/i },
  // Forecast: get_weather is current-only, so this must route to web_search. The tell is
  // latency — current-weather turns are ~1-2s, web_search turns ~8-16s.
  { text: "What will the weather in Pune be like tomorrow?", tool: "forecast->web_search", want: /pune|cloud|rain|storm|sun|warm|degree|celsius|forecast/i, expectSlow: true },
  { text: "What's the US dollar to Indian rupee exchange rate?", tool: "web_search", want: /rupee|hundred|point|\d/i },
];
const BAD = /unavailable|couldn.?t|try again|mock|not sure|don.?t (have|know)/i;

async function main() {
  const sig = H.newSignals();
  const browser = await H.launchBrowser({ headless: false });
  let hardFail = 0;
  try {
    const { page } = await H.newPage(browser, sig);
    await page.goto(H.BASE, { waitUntil: "domcontentloaded", timeout: 30000 });
    await H.sleep(1500);
    await H.selectExample(page, { example: "generic", model: "lightning" });
    const conn = await H.startConversation(page);
    if (!conn.connected) { console.log("HARD FAIL: never connected"); process.exit(2); }
    console.log(`connected in ${conn.connectMs}ms; session=${await H.sessionId(page)}`);
    await H.sleep(1500); // let the welcome greeting finish

    for (let i = 0; i < TURNS.length; i++) {
      const t = TURNS[i];
      const r = await H.turn(page, t.text, `stock_t${i + 1}`);
      const answer = (r.domBot || r.botAsr || "").trim();
      const heardOk = t.want.test(answer);
      const leaked = BAD.test(answer);
      const ok = r.botSpoke && heardOk && !leaked;
      if (!ok) hardFail++;
      console.log(
        `turn ${i + 1} [${t.tool}] "${t.text}"\n` +
        `   spoke=${r.botSpoke} lat=${r.latencyS ?? "?"}s match=${heardOk} leak=${leaked} ${ok ? "PASS" : "FAIL"}\n` +
        `   heard: "${answer.slice(0, 140)}"`
      );
    }
    await H.endConversation(page);
  } catch (e) {
    console.log("THREW:", String(e).slice(0, 300));
    hardFail++;
  } finally {
    await browser.close().catch(() => {});
  }
  console.log(hardFail ? `\n=== ${hardFail} FAIL(s) ===` : `\n=== ALL PASS ===`);
  process.exit(hardFail ? 1 : 0);
}
main();
