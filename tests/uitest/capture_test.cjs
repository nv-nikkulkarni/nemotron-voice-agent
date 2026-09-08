// Focused diagnostic: does the demo UI POST /capture/session (consent + transcript)
// at session end, and with the right session_id? Checks the consent box, runs one
// turn, clicks End, and reports whether/what the client posted.
const { chromium } = require('playwright');

const BASE = process.argv[2] || 'http://localhost:7862';
const MIC = process.env.MIC_WAV || '/audio/mic_planet_48k.wav';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ headless: true, args: [
    '--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
    `--use-file-for-fake-audio-capture=${MIC}`, '--autoplay-policy=no-user-gesture-required',
  ]});
  const ctx = await browser.newContext({ permissions: ['microphone'], viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const captureCalls = [];
  page.on('request', (r) => {
    if (r.url().includes('/capture/')) captureCalls.push({ when: 'request', method: r.method(), url: r.url(), body: r.postData() });
  });
  page.on('response', async (r) => {
    if (r.url().includes('/capture/')) {
      let txt = ''; try { txt = await r.text(); } catch {}
      captureCalls.push({ when: 'response', status: r.status(), url: r.url(), body: txt });
    }
  });
  const sessionCfg = [];
  page.on('response', async (r) => {
    if (r.url().includes('/api/session-config')) { try { sessionCfg.push(await r.json()); } catch {} }
  });

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(1200);

  // check the consent box
  const consent = page.getByText(/Store my audio/i);
  if (await consent.count()) { await consent.first().click(); console.log('[capture-test] checked consent box'); }
  else console.log('[capture-test] !! consent checkbox not found');

  // generic + Nano, then Start
  const nano = page.getByRole('button', { name: /Try with Nemotron Nano/i });
  if (await nano.count()) await nano.first().click();
  await sleep(400);
  await page.getByRole('button', { name: /start conversation/i }).click({ timeout: 10000 });

  // wait for a completed turn (latency readout) so there's a transcript
  let latency = '';
  for (let i = 0; i < 75; i++) {
    await sleep(1000);
    const lv = await page.locator('.conv-latency__value').first().innerText().catch(() => '');
    if (lv && /\d/.test(lv) && lv.trim() !== '—') { latency = lv.trim(); break; }
  }
  // read the session id the UI shows (chip)
  const sid = await page.locator('.conv-session-id, [class*="session-id"]').first().innerText().catch(() => '');
  console.log(`[capture-test] turn done (latency=${latency || 'none'}), UI session id chip="${sid.trim()}"`);
  console.log(`[capture-test] server session-config responses:`, JSON.stringify(sessionCfg));

  // End the session -> should trigger the client capture POST
  const endBtn = page.locator('.clean-end, button:has-text("End")').first();
  if (await endBtn.count()) { await endBtn.click().catch(() => {}); console.log('[capture-test] clicked End'); }
  await sleep(4000); // give the POST time (keepalive)

  console.log('\n===== /capture RESULT =====');
  if (!captureCalls.length) console.log('NO /capture/session request was made by the client.');
  else captureCalls.forEach((c) => console.log(JSON.stringify(c)));
  await browser.close();
})();
