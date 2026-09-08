// Verify the graceful-teardown lifecycle: phase transitions, teardown report,
// adaptive overlay (no flash on a fast close), and clean reconnect.
import * as H from "./lib/harness.mjs";

const snap = (page) => page.evaluate(() => window.__session).catch(() => null);

async function main() {
  const sig = H.newSignals();
  const browser = await H.launchBrowser({ headless: false });
  const { page } = await H.newPage(browser, sig);
  await page.goto(H.BASE, { waitUntil: "domcontentloaded" }); await H.sleep(1400);
  await H.selectExample(page, { example: "generic", model: "lightning" });
  const conn1 = await H.startConversation(page);
  const idBefore = await H.sessionId(page);
  const firstWelcomeSettled = conn1.connected && await H.waitForSettledWelcome(page);

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
  await page.locator('.demo-modal-close, [aria-label="Close and return home"]').first().click().catch(() => {});
  await H.sleep(600);
  await H.selectExample(page, { example: "generic", model: "lightning" });
  await page.evaluate(() => window.__botReset());
  const conn2 = await H.startConversation(page);
  const id2 = await H.sessionId(page);
  const secondWelcomeSettled = conn2.connected && await H.waitForSettledWelcome(page);
  const secondWelcomeSpoke = await page.evaluate(() => window.__bot?.onsetMs != null).catch(() => false);
  const secondWelcomeText = (await H.readMessages(page))
    .filter((message) => message.role === "bot")
    .map((message) => message.text)
    .join(" ");
  const pass = Boolean(
    firstWelcomeSettled && secondWelcomeSettled && secondWelcomeSpoke
    && idBefore && id2 && id2 !== idBefore && conn2.connected
    && /nemotron|hello|assist you|help you|how can i/i.test(secondWelcomeText)
    && sig.consoleErrors.length === 0 && sig.wsClosures.length === 0
  );

  console.log(JSON.stringify({
    pass,
    phasesSeen: [...phases],
    overlayFlashed_onFastClose: overlaySeen,   // expect false for a fast local close
    teardownReport: report,                    // expect forced:false, wsMs>=0, audioFlushed:true
    endButtonDisabledOrGoneDuringStop: endBtnGone,
    thanksShown: thanks,
    firstSessionId: idBefore,
    newSessionId: id2,
    uniqueSessionId: Boolean(idBefore && id2 && idBefore !== id2),
    firstWelcomeSettled,
    secondWelcomeSettled,
    secondWelcomeSpoke,
    secondWelcomeText,
    reconnected: conn2.connected,
    consoleErrors: sig.consoleErrors,
    websocketErrors: sig.wsClosures,
  }, null, 2));
  await browser.close();
  if (!pass) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exit(1); });
