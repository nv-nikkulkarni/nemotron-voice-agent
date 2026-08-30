// SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause
//
// Repro test for "omni subagents sits idle / won't describe images".
// IMPORTANT: --use-fake-device-for-media-stream fakes BOTH camera and mic, which would
// silence our real PulseAudio TTS speech. So this test uses the REAL PulseAudio mic (no fake
// device) and feeds an image via the ATTACHMENT UPLOAD path (no camera device needed):
//   Turn 1/2 : voice-only  -> does omni answer speech at all? (the "idle" symptom)
//   Turn 3   : upload a known image (navy bg, red square, "BANANA 42") via
//              POST /api/sessions/{id}/attachments, then ask it to describe -> vision path
// Consent ON so the server session log uploads to NGC for post-mortem.
//
//   node verify_omni.mjs
import fs from "node:fs";
import * as H from "./lib/harness.mjs";

const IMG_HINT = /red|square|box|banana|42|navy|blue|text|number|word/i;

async function main() {
  const sig = H.newSignals();
  const browser = await H.launchBrowser({ headless: false });   // real PulseAudio mic, no fake devices
  let hardFail = 0;
  try {
    const { page } = await H.newPage(browser, sig);
    await page.goto(H.BASE, { waitUntil: "domcontentloaded", timeout: 30000 });
    await H.sleep(1500);
    await H.selectExample(page, { example: "omni", consent: true });
    const conn = await H.startConversation(page);
    if (!conn.connected) { console.log("HARD FAIL: never connected"); process.exit(2); }
    const sid = await H.sessionId(page);
    console.log(`connected in ${conn.connectMs}ms; session=${sid}`);
    await H.sleep(2500); // welcome + unmute

    // --- Turn 1 & 2: voice only. Does omni answer real speech? (decisive "idle" test) ---
    for (const [i, text] of [["1", "Hey, can you hear me? What is seventeen plus twenty five?"],
                             ["2", "Okay, tell me a short one sentence fact about the moon."]].entries()) {
      const r = await H.turn(page, text[1] ?? text, `omni_v${i + 1}`);
      const a = (r.domBot || r.botAsr || "").trim();
      const idle = !r.botSpoke;
      if (idle) hardFail++;
      console.log(`T${i + 1} [voice] spoke=${r.botSpoke} lat=${r.latencyS ?? "?"}s ${idle ? "IDLE (no response)" : "responded"}\n   heard: "${a.slice(0, 120)}"`);
    }

    // --- Turn 3: image via attachment upload, then ask to describe (vision path, no camera) ---
    const img = fs.readFileSync("/sqa/omni_test.png");
    const uploaded = await page.evaluate(async ({ sid, b64 }) => {
      try {
        const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const fd = new FormData();
        fd.append("file", new Blob([bin], { type: "image/png" }), "omni_test.png");
        const res = await fetch(`/api/sessions/${sid}/attachments?kind=image`, { method: "POST", body: fd });
        return { status: res.status, body: (await res.text()).slice(0, 200) };
      } catch (e) { return { status: 0, body: String(e) }; }
    }, { sid, b64: img.toString("base64") });
    console.log(`\nattachment upload -> HTTP ${uploaded.status} ${uploaded.body}`);
    await H.sleep(1500);
    // The pipeline first ACKs ("I'll analyze…"), THEN the media analyzer speaks the actual
    // description. Capture the ack, then poll the DOM up to ~28s for the real description that
    // matches the known image (red square, "BANANA 42", navy bg).
    const beforeMsgs = (await H.readMessages(page)).length;
    const r3 = await H.turn(page, "I just shared an image with you. Describe exactly what is in it.", "omni_img", { maxMs: 15000 });
    const ack = (r3.domBot || r3.botAsr || "").trim();
    // The media analyzer speaks the DESCRIPTION as a separate bot turn ~10-25s after the ack.
    // Poll the DOM up to ~45s for a bot message that is NOT the ack (the actual description).
    let desc = "";
    for (let t = 0; t < 45; t++) {
      const bot = (await H.readMessages(page)).slice(beforeMsgs).filter((m) => m.role === "bot").map((m) => m.text.trim());
      const real = bot.filter((x) => x && x !== ack && !/^i'?ll analyze/i.test(x));
      if (real.length) { desc = real[real.length - 1]; break; }
      await H.sleep(1000);
    }
    if (!desc) desc = ack;
    const idle3 = !r3.botSpoke;
    const described = IMG_HINT.test(desc);
    if (idle3 || !described) hardFail++;
    console.log(`T3 [image] spoke=${r3.botSpoke} ack="${(r3.domBot || r3.botAsr || "").slice(0, 40)}"\n   ${idle3 ? "IDLE" : (described ? "DESCRIBED ✓" : "responded but did NOT match the image ✗ (media not co-located?)")}\n   description: "${desc.slice(0, 220)}"`);

    console.log(`\n>>> SESSION ID for server-log post-mortem: ${sid}`);
    await H.endConversation(page);
  } catch (e) {
    console.log("THREW:", String(e).slice(0, 400)); hardFail++;
  } finally {
    await browser.close().catch(() => {});
  }
  console.log(hardFail ? `\n=== ${hardFail} FAIL(s) ===` : `\n=== ALL PASS — omni voice + image working ===`);
  process.exit(hardFail ? 1 : 0);
}
main();
