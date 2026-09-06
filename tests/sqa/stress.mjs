// SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause
//
// Concurrency + lifecycle stress test. N isolated users, each repeating CYCLES
// times: Start conversation -> (mid-conversation) open Settings + Pipeline-info
// overlays and confirm the live session SURVIVES (same session id, still
// connected) -> End -> dismiss thanks -> Start again. Verifies no leaks, hangs,
// stuck states, or errors across rapid restart churn under load.
//
//   node stress.mjs [N=5] [CYCLES=3]
import fs from "node:fs";
import * as H from "./lib/harness.mjs";

async function oneUser(browser, u, cycles) {
  const sig = H.newSignals();
  const r = { user: u, cycles: [], sig };
  const { page } = await H.newPage(browser, sig, { viewport: { width: 900, height: 720 } });
  try {
    await page.goto(H.BASE, { waitUntil: "domcontentloaded", timeout: 45000 });
    await H.sleep(600 + u * 120);
    for (let c = 0; c < cycles; c++) {
      const cy = { c: c + 1 };
      // ensure we're on the landing (first cycle is; later cycles after dismissFeedback)
      if ((await page.locator(".example-card").count()) === 0) await H.dismissFeedback(page);
      await H.selectExample(page, { example: "generic", model: u % 2 ? "nano" : "super" });
      const conn = await H.startConversation(page, { timeoutMs: 45000 });
      cy.connected = conn.connected; cy.connectMs = conn.connectMs;
      if (!conn.connected) { r.cycles.push(cy); break; }
      const idBefore = await H.sessionId(page);
      // mid-conversation: Settings overlay, then Pipeline-info overlay
      cy.settingsOpened = await H.openOverlay(page, "settings");
      cy.settingsClosed = await H.closeOverlay(page);
      cy.infoOpened = await H.openOverlay(page, "pipeline");
      cy.infoClosed = await H.closeOverlay(page);
      const idAfter = await H.sessionId(page);
      cy.sessionSurvivedNav = !!idBefore && idBefore === idAfter;
      cy.idBefore = idBefore; cy.idAfter = idAfter;
      // End -> thanks -> back to landing
      const end = await H.endConversation(page);
      cy.ended = end.ended; cy.thanks = end.thanks;
      cy.backToLanding = await H.dismissFeedback(page);
      r.cycles.push(cy);
    }
    await page.context().close().catch(() => {});
  } catch (e) { r.error = String(e).slice(0, 160); }
  r.consoleErrors = sig.consoleErrors.length; r.badResponses = sig.badResponses.length; r.wsErrors = sig.wsClosures.length;
  r.firstConsoleError = sig.consoleErrors[0]?.slice(0, 120);
  return r;
}

(async () => {
  const N = parseInt(process.argv[2] || "5", 10);
  const CYCLES = parseInt(process.argv[3] || "3", 10);
  console.log(`\n===== STRESS: ${N} concurrent users x ${CYCLES} start/nav/end cycles vs ${H.BASE} =====\n`);
  const browser = await H.launchBrowser({ headless: false });
  const t0 = Date.now();
  const results = await Promise.all(Array.from({ length: N }, (_, i) => oneUser(browser, i + 1, CYCLES)));
  await browser.close().catch(() => {});
  const wallS = ((Date.now() - t0) / 1000).toFixed(1);

  let totalCycles = 0, okCycles = 0, navSurvived = 0, navTotal = 0;
  for (const r of results) for (const cy of r.cycles) {
    totalCycles++;
    if (cy.connected && cy.ended && cy.backToLanding) okCycles++;
    if (cy.connected) { navTotal++; if (cy.sessionSurvivedNav && cy.settingsOpened && cy.infoOpened) navSurvived++; }
  }
  const totalConsole = results.reduce((a, r) => a + (r.consoleErrors || 0), 0);
  const totalBad = results.reduce((a, r) => a + (r.badResponses || 0), 0);
  const totalWs = results.reduce((a, r) => a + (r.wsErrors || 0), 0);
  const errored = results.filter((r) => r.error);

  for (const r of results) {
    const full = r.cycles.filter((c) => c.connected && c.ended && c.backToLanding).length;
    const nav = r.cycles.filter((c) => c.sessionSurvivedNav).length;
    console.log(`  user ${r.user}: cycles ${full}/${r.cycles.length} complete, nav-survived ${nav}/${r.cycles.filter((c) => c.connected).length}, ` +
      `err(console/http/ws)=${r.consoleErrors}/${r.badResponses}/${r.wsErrors}` +
      `${r.error ? " ERROR:" + r.error : ""}${r.firstConsoleError ? " :: " + r.firstConsoleError : ""}`);
  }

  const pass = okCycles === totalCycles && totalCycles === N * CYCLES && navSurvived === navTotal &&
    totalConsole === 0 && totalBad === 0 && totalWs === 0 && errored.length === 0;
  const report = { base: H.BASE, N, CYCLES, wallS, totalCycles, okCycles, navSurvived, navTotal,
    totalConsole, totalBad, totalWs, pass, results: results.map(({ sig, ...r }) => r) };
  fs.mkdirSync(H.OUT, { recursive: true });
  fs.writeFileSync(`${H.OUT}/stress_report.json`, JSON.stringify(report, null, 2));
  console.log(`\n  cycles ${okCycles}/${totalCycles} complete, mid-session-nav survived ${navSurvived}/${navTotal}, ` +
    `errors(console/http/ws)=${totalConsole}/${totalBad}/${totalWs} in ${wallS}s`);
  console.log(`===== ${pass ? "PASS ✅" : "FAIL ❌"} =====\n  report: out/stress_report.json\n`);
  process.exit(pass ? 0 : 1);
})();
