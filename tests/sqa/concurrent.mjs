// SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause
//
// Concurrent-users load/isolation test: N isolated browser contexts start voice
// sessions simultaneously against the live deployment. Each has its own WebAudio
// tap, so we independently verify every session connects, gets a distinct session
// id, and hears its own bot greeting — with no console/HTTP/WS errors and no
// cross-session id collision. (Audio uses one shared virtual device, so we assert
// per-page via the tap rather than ASR.)
//
//   node concurrent.mjs [N=4]
import fs from "node:fs";
import * as H from "./lib/harness.mjs";

async function oneUser(browser, i) {
  const sig = H.newSignals();
  const r = { user: i, sig };
  try {
    const { page } = await H.newPage(browser, sig, { viewport: { width: 900, height: 700 } });
    await page.goto(H.BASE, { waitUntil: "domcontentloaded", timeout: 40000 });
    await H.sleep(800 + i * 150);
    await H.selectExample(page, { example: "generic", model: "lightning" });
    const conn = await H.startConversation(page, { timeoutMs: 40000 });
    r.connected = conn.connected; r.connectMs = conn.connectMs;
    // wait for the greeting to actually produce audio (per-page tap)
    let spoke = false;
    for (let k = 0; k < 30 && !spoke; k++) { await H.sleep(500); const b = await page.evaluate(() => window.__bot).catch(() => null); if (b?.onsetMs != null) spoke = true; }
    r.botSpoke = spoke;
    r.sessionId = await page.locator(".conv-session-id code").innerText().catch(() => "");
    const end = await H.endConversation(page);
    r.ended = end.ended;
    await page.context().close().catch(() => {});
  } catch (e) { r.error = String(e).slice(0, 150); }
  r.consoleErrors = sig.consoleErrors.length; r.badResponses = sig.badResponses.length; r.wsErrors = sig.wsClosures.length;
  return r;
}

(async () => {
  const N = parseInt(process.argv[2] || "4", 10);
  console.log(`\n===== CONCURRENT USERS: ${N} simultaneous sessions vs ${H.BASE} =====\n`);
  const browser = await H.launchBrowser({ headless: false });
  const t0 = Date.now();
  const results = await Promise.all(Array.from({ length: N }, (_, i) => oneUser(browser, i + 1)));
  await browser.close().catch(() => {});
  const wallS = ((Date.now() - t0) / 1000).toFixed(1);

  const ids = results.map((r) => r.sessionId).filter(Boolean);
  const uniqueIds = new Set(ids).size;
  const connected = results.filter((r) => r.connected).length;
  const spoke = results.filter((r) => r.botSpoke).length;
  const totalConsole = results.reduce((a, r) => a + (r.consoleErrors || 0), 0);
  const totalBad = results.reduce((a, r) => a + (r.badResponses || 0), 0);
  const totalWs = results.reduce((a, r) => a + (r.wsErrors || 0), 0);

  for (const r of results)
    console.log(`  user ${r.user}: connect=${r.connected ? r.connectMs + "ms" : "NO"} spoke=${r.botSpoke ? "y" : "n"} id=${r.sessionId || "-"} ` +
      `err(console/http/ws)=${r.consoleErrors}/${r.badResponses}/${r.wsErrors}${r.error ? " ERROR:" + r.error : ""}`);

  const pass = connected === N && spoke === N && uniqueIds === N && totalConsole === 0 && totalBad === 0 && totalWs === 0;
  const report = { base: H.BASE, N, wallS, connected, spoke, uniqueIds, totalConsole, totalBad, totalWs, pass, results: results.map(({ sig, ...r }) => r) };
  fs.mkdirSync(H.OUT, { recursive: true });
  fs.writeFileSync(`${H.OUT}/concurrent_report.json`, JSON.stringify(report, null, 2));
  console.log(`\n  connected=${connected}/${N} spoke=${spoke}/${N} uniqueIds=${uniqueIds}/${N} ` +
    `errors(console/http/ws)=${totalConsole}/${totalBad}/${totalWs} in ${wallS}s`);
  console.log(`===== ${pass ? "PASS ✅" : "FAIL ❌"} =====\n  report: out/concurrent_report.json\n`);
  process.exit(pass ? 0 : 1);
})();
