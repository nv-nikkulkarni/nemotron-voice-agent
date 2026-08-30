// SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause
//
// E2E for the Nemotron 3.5 Lightning swap on generic-assistant, through the REAL voice
// pipeline. Verifies (1) tools fire + answers stay grounded across a drift-style
// conversation (clean core turns + repeated stock + off-topic garbled turns, mirroring the
// failing session 8cd1ddf29797), and (2) the new tool-call UI box (.conv-tool) appears when
// a tool is called. Speaks via TTS, listens via ASR, watches the DOM.
//
//   node verify_lightning.mjs
import * as H from "./lib/harness.mjs";

// mixes the exact failure pattern (repeat + drift) with clean core checks
const TURNS = [
  { text: "What's the weather in Pune right now?", tool: "get_weather", want: /degree|celsius|rain|cloud|clear|humid|wind|pune/i },
  { text: "What is the stock price of NVIDIA?", tool: "get_stock_price", want: /\d|hundred|dollar|point/i },
  { text: "And what is the latest NVIDIA stock price?", tool: "get_stock_price", want: /\d|hundred|dollar|point/i },
  { text: "Can you tell me something about flights from Phuket to Delhi?", tool: "web_search|none", want: /.+/ },
  { text: "Okay, can you stop?", tool: "none", want: /.+/ },
  { text: "What's the weather in Mumbai?", tool: "get_weather", want: /degree|celsius|rain|cloud|clear|humid|wind|mumbai/i },
];
const BAD = /\bmock\b|not sure|don.?t (have|know)|as an ai/i;
// hallucination proxy: a spoken stock answer that is nowhere near the live ~$200-230 band
const NVDA_SANE = /(two hundred|1\d\d|2[0-3]\d|\$2[0-3]\d)/i;

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

    // Observe the tool-call box (.conv-tool) — record every tool name it ever shows.
    await page.evaluate(() => {
      window.__tools = [];
      const grab = () => document.querySelectorAll(".conv-tool__name").forEach((n) => {
        const t = (n.textContent || "").trim();
        if (t && (!window.__tools.length || window.__tools[window.__tools.length - 1] !== t)) window.__tools.push(t);
      });
      new MutationObserver(grab).observe(document.body, { childList: true, subtree: true });
      grab();
    });
    await H.sleep(1500);

    for (let i = 0; i < TURNS.length; i++) {
      const t = TURNS[i];
      const before = await page.evaluate(() => window.__tools.length);
      const r = await H.turn(page, t.text, `lite_t${i + 1}`);
      const seen = await page.evaluate((b) => window.__tools.slice(b), before);
      const answer = (r.domBot || r.botAsr || "").trim();
      const boxTool = seen[0] || "(none)";
      const expectTool = !["none", "web_search|none"].includes(t.tool);
      const toolOk = expectTool ? seen.length > 0 : true;      // core turns MUST show the box
      const heardOk = t.want.test(answer);
      const leak = BAD.test(answer);
      const saneStock = !/stock|nvidia/i.test(t.text) || NVDA_SANE.test(answer);
      const ok = r.botSpoke && heardOk && !leak && toolOk && saneStock;
      if (!ok) hardFail++;
      console.log(
        `turn ${i + 1} [${t.tool}] "${t.text}"\n` +
        `   spoke=${r.botSpoke} box=${boxTool} lat=${r.latencyS ?? "?"}s match=${heardOk} sane=${saneStock} leak=${leak} ${ok ? "PASS" : "FAIL"}\n` +
        `   heard: "${answer.slice(0, 130)}"`
      );
    }
    const allTools = await page.evaluate(() => window.__tools);
    console.log(`\nTool-call boxes observed in order: ${JSON.stringify(allTools)}`);
    await H.endConversation(page);
  } catch (e) {
    console.log("THREW:", String(e).slice(0, 300)); hardFail++;
  } finally {
    await browser.close().catch(() => {});
  }
  console.log(hardFail ? `\n=== ${hardFail} FAIL(s) ===` : `\n=== ALL PASS ===`);
  process.exit(hardFail ? 1 : 0);
}
main();
