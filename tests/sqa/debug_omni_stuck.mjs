// Reproduce: generic -> (queries) -> idle 60s -> End -> home -> omni Start -> stuck on "Starting".
// Heavily instrument the omni-start attempt to see which layer hangs.
import * as H from "./lib/harness.mjs";

const IDLE_MS = parseInt(process.env.IDLE_MS || "60000", 10);
const QUERIES = parseInt(process.env.QUERIES || "0", 10); // 0 = minimal repro

async function main() {
  const sig = H.newSignals();
  const net = []; const ws = [];
  const browser = await H.launchBrowser({ headless: false });
  const { page } = await H.newPage(browser, sig);
  page.on("response", (r) => { const u = r.url(); if (/\/api\/(session-config|start|ws|deployment)/.test(u)) net.push(`${r.status()} ${r.request().method()} ${u.split("/api/")[1]}`); });
  page.on("request", (r) => { const u = r.url(); if (/\/api\/session-config/.test(u)) net.push(`--> POST ${u.split("/api/")[1]} (sent)`); });
  page.on("websocket", (w) => { ws.push(`WS open ${w.url().slice(0, 80)}`); w.on("close", () => ws.push("WS close")); w.on("socketerror", (e) => ws.push("WS err " + e)); });
  const snap = () => page.evaluate(() => window.__session).catch(() => null);

  await page.goto(H.BASE, { waitUntil: "domcontentloaded" }); await H.sleep(1400);

  // 1. generic session
  await H.selectExample(page, { example: "generic", model: "lightning" });
  const c1 = await H.startConversation(page);
  console.log(`[1] generic connected=${c1.connected} (${c1.connectMs}ms) sid=${await H.sessionId(page)}`);
  await H.sleep(1500);
  for (let i = 0; i < QUERIES; i++) { await H.turn(page, ["What is the weather in Tokyo", "NVIDIA stock price", "Dollar to rupee", "What time is it", "Tell me a joke", "What is your name", "Convert 50 dollars to euros"][i % 7], `dq${i}`); }

  // 2. idle
  console.log(`[2] idle ${IDLE_MS / 1000}s ...`);
  await H.sleep(IDLE_MS);
  const beforeEnd = await snap();
  console.log(`[2b] before End: phase=${beforeEnd?.phase} caption="${await H.orbCaption(page)}"`);

  // 3. End (graceful teardown)
  const endBtn = page.locator(".clean-end").first();
  console.log(`[3] End button present=${await endBtn.count()}; clicking...`);
  await endBtn.click().catch((e) => console.log("End click err:", e.message));
  // wait for teardown -> ended, capture the report
  for (let i = 0; i < 30; i++) { const s = await snap(); if (s?.phase === "ended" || s?.phase === "idle") { console.log(`[3b] after End: phase=${s.phase} teardown=${JSON.stringify(s.lastTeardown)}`); break; } await H.sleep(200); }

  // 4. dismiss modal -> home
  await page.locator('.demo-modal-close, [aria-label="Close and return home"]').first().click().catch(() => {});
  await H.sleep(700);
  console.log(`[4] home: cards=${await page.locator(".example-card").count()} phase=${(await snap())?.phase}`);

  // 5. omni Start — INSTRUMENTED
  net.length = 0; ws.length = 0;
  await H.selectExample(page, { example: "omni" });
  console.log(`[5] clicking omni Start...`);
  await page.getByRole("button", { name: /start conversation/i }).click().catch((e) => console.log("start click err:", e.message));

  // 6. observe up to 30s
  for (let t = 0; t < 30; t++) {
    await H.sleep(1000);
    const s = await snap(); const cap = await H.orbCaption(page);
    const btn = await page.getByRole("button", { name: /connecting|starting|start conversation/i }).first().innerText().catch(() => "");
    if (t % 3 === 0 || (s?.phase === "live")) console.log(`  t=${t}s phase=${s?.phase} caption="${cap}" btn="${btn.trim()}" | net=[${net.slice(-3).join(" ; ")}] ws=[${ws.slice(-3).join(" ; ")}]`);
    if (s?.phase === "live" || /listening|speaking|thinking/i.test(cap)) { console.log(`  => OMNI CONNECTED at t=${t}s`); break; }
  }
  const finalSnap = await snap();
  console.log(`\n[RESULT] final phase=${finalSnap?.phase}`);
  console.log(`[NET during omni start]: ${net.join(" | ") || "(none)"}`);
  console.log(`[WS during omni start]: ${ws.join(" | ") || "(none)"}`);
  console.log(`[console errors]: ${sig.consoleErrors.slice(0, 6).join(" || ") || "none"}`);
  console.log(`[bad responses]: ${sig.badResponses.slice(0, 6).join(" || ") || "none"}`);
  await browser.close();
}
main().catch((e) => { console.error("ERR", e); process.exit(1); });
