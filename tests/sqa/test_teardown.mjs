// Verify the graceful-teardown lifecycle: phase transitions, teardown report,
// adaptive overlay (no flash on a fast close), and clean reconnect.
import * as H from "./lib/harness.mjs";

const snap = (page) => page.evaluate(() => window.__session).catch(() => null);

async function main() {
  const sig = H.newSignals();
  const browser = await H.launchBrowser({ headless: false });
  const { page } = await H.newPage(browser, sig);
  await page.goto(H.BASE, { waitUntil: "domcontentloaded" }); await H.sleep(1400);
  await H.selectExample(page, { example: "generic", model: "super" });
  await H.startConversation(page); await H.sleep(1500);

  const live = await snap(page);
  // Click End and sample the machine every 40ms until the modal/ended appears.
  const phases = new Set(); let overlaySeen = false; let report = null;
  await page.locator(".clean-end").click();
  for (let i = 0; i < 120; i++) {
    const s = await snap(page);
    if (s) { phases.add(s.phase); if (s.overlayVisible) overlaySeen = true; if (s.lastTeardown) report = s.lastTeardown; }
    if (s?.phase === "ended") break;
    await H.sleep(40);
  }
  const endBtnGone = (await page.locator(".clean-end").count()) === 0 || await page.locator(".clean-end").isDisabled().catch(() => false);
  const thanks = (await page.getByText(/thank you/i).count()) > 0;

  // Reconnect from the modal → landing → start again; assert a NEW session id, no errors.
  const idBefore = live?.lastTeardown || (await H.sessionId(page));
  await page.locator('.demo-modal-close, [aria-label="Close and return home"]').first().click().catch(() => {});
  await H.sleep(600);
  await H.selectExample(page, { example: "generic", model: "super" });
  const conn2 = await H.startConversation(page);
  const id2 = await H.sessionId(page);

  console.log(JSON.stringify({
    phasesSeen: [...phases],
    overlayFlashed_onFastClose: overlaySeen,   // expect false for a fast local close
    teardownReport: report,                    // expect forced:false, wsMs>=0, audioFlushed:true
    endButtonDisabledOrGoneDuringStop: endBtnGone,
    thanksShown: thanks,
    reconnected: conn2.connected, newSessionId: id2,
    consoleErrors: sig.consoleErrors.length,
  }, null, 2));
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
