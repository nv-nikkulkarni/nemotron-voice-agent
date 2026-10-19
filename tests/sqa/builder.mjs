// SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause
//
// Agent builder SQA, through the real UI.
//
// Opens the builder from the start page, describes an agent in chat, checks the draft the builder produced,
// saves it as YAML, starts it, and verifies the running session:
//   - the browser sent a persona AND a signed persona_token (so the voice agent will accept the persona);
//   - the agent introduces itself with the persona's name, and keeps its language and tools.
//
//   node builder.mjs       (SQA_IGNORE_CERT=1 for internal TLS)
import fs from "node:fs";
import * as H from "./lib/harness.mjs";

const NAME = "Valeria";
const DESCRIBE = `A cheerful Spanish-speaking travel guide named ${NAME}. She helps with the weather and the time in cities around the world. Her name is ${NAME}; always say so when asked who she is.`;
const SPEECH = "Speak naturally in Spanish at a normal conversational pace.";

const guard = (label, ms, fn) => Promise.race([
  fn(),
  new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} exceeded ${ms} ms`)), ms)),
]);

async function waitConnected(page, timeoutMs = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (/connected|listening|speaking|thinking/i.test(await H.orbCaption(page))) return Date.now() - t0;
    await H.sleep(500);
  }
  return null;
}

(async () => {
  const rep = { runId: H.RUN_ID, base: H.BASE, startedAt: new Date().toISOString(), checks: [], hardFails: [], warns: [] };
  const check = (name, ok, detail = "") => { rep.checks.push({ name, ok, detail }); if (!ok) rep.hardFails.push(`${name}${detail ? `: ${detail}` : ""}`); console.log(`  ${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };

  const sig = H.newSignals();
  const slot = await H.createAudioSlot(97);
  const extraArgs = process.env.SQA_IGNORE_CERT ? ["--ignore-certificate-errors"] : [];
  const browser = await H.launchBrowser({ headless: false, env: slot.env, extraArgs });
  try {
    const { page } = await H.newPage(browser, sig, { acceptDownloads: true });
    const sessionConfigs = [];
    page.on("request", (req) => {
      if (/\/api\/session-config$/.test(req.url()) && req.method() === "POST") {
        try { sessionConfigs.push(JSON.parse(req.postData() || "{}")); } catch { /* ignore */ }
      }
    });

    await page.goto(H.BASE, { waitUntil: "domcontentloaded", timeout: 45000 });
    if (!(await H.waitForDeploymentReady(page, { timeoutMs: 45000 }))) throw new Error("deployment options did not become ready");
    const skipTour = page.getByRole("button", { name: /skip tour/i });
    if (await skipTour.isVisible().catch(() => false)) await skipTour.click();

    // 1. Open the builder from the card.
    const builderCard = page.getByRole("button", { name: "Build your own agent", exact: true });
    check("builder card is offered", await builderCard.count() === 1);
    await builderCard.click();
    const studio = page.getByRole("region", { name: "Build your own agent", exact: true });
    await studio.waitFor({ timeout: 15000 });
    const input = page.locator("#builder-input");
    await H.sleep(500);
    let enabled = false;
    for (let waited = 0; waited < 30000 && !enabled; waited += 500) { enabled = await input.isEnabled().catch(() => false); if (!enabled) await H.sleep(500); }
    check("builder session starts (chat input enabled)", enabled);
    if (!enabled) throw new Error("builder chat never became available");

    // 2. Describe the agent and wait for the draft.
    await input.fill(DESCRIBE);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    const start = page.getByRole("button", { name: /^Start your agent$/ });
    let ready = false;
    for (let waited = 0; waited < 120000 && !ready; waited += 1000) { ready = await start.isEnabled().catch(() => false); if (!ready) await H.sleep(1000); }
    check("builder produced a ready draft", ready);
    const chat = await page.locator(".agent-builder__chat").innerText().catch(() => "");
    rep.builderChat = chat.slice(0, 1200);
    const preview = await page.locator(".agent-builder__preview").innerText().catch(() => "");
    rep.preview = preview.slice(0, 1500);
    check("draft mentions the persona name", new RegExp(NAME, "i").test(chat + preview), "chat or preview");
    check("draft is Spanish", /spanish|español|es-|\bes\b/i.test(preview), preview.replace(/\s+/g, " ").slice(0, 120));
    if (!ready) throw new Error("no ready draft");

    // 3. Save as YAML and check the file.
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 15000 }),
      page.getByRole("button", { name: "Save as YAML", exact: true }).click(),
    ]);
    const yamlPath = `${H.OUT}/builder_agent.yaml`;
    await download.saveAs(yamlPath);
    const yaml = fs.readFileSync(yamlPath, "utf8");
    check("saved YAML has the persona and a talker", new RegExp(NAME, "i").test(yaml) && /talker:/.test(yaml), `${yaml.length} bytes`);
    check("saved YAML names a Spanish language", /language:\s*['"]?es/i.test(yaml));

    // 4. Start it.
    await start.click();
    const consent = page.getByRole("dialog", { name: "Help improve the conversation?", exact: true });
    try {
      await consent.waitFor({ timeout: 15000 });
      await consent.getByRole("button", { name: "Continue without saving", exact: true }).click();
    } catch { rep.warns.push("no consent dialog appeared"); }
    const connectMs = await waitConnected(page);
    check("builder agent connects", connectMs != null, connectMs != null ? `${connectMs} ms` : "never connected");
    if (connectMs == null) throw new Error("never connected");
    rep.sessionId = await H.sessionId(page);

    const cfg = sessionConfigs.at(-1) || {};
    check("session request carries the persona", typeof cfg.persistent_prompt === "string" && cfg.persistent_prompt.length > 20, `${(cfg.persistent_prompt || "").length} chars`);
    check("session request carries a signed persona token", typeof cfg.persona_token === "string" && cfg.persona_token.length > 20, cfg.persona_token ? "present" : "missing");
    check("persona text includes the name", new RegExp(NAME, "i").test(cfg.persistent_prompt || ""));

    await H.installToolWatch(page);
    await H.waitForSettledWelcome(page);
    const welcome = (await H.readMessages(page)).filter((m) => m.role === "bot").map((m) => m.text).join(" ");
    rep.welcome = welcome;
    if (!/valeria|hola/i.test(welcome)) rep.warns.push(`welcome does not mention ${NAME} or greet in Spanish: "${welcome.slice(0, 80)}"`);

    // 5. Talk to it: it must keep its persona name and its tools.
    const turns = [
      { name: "who", text: "Hola, ¿cómo te llamas?", heard: /hola|llamas|cómo/i, tool: null, answer: new RegExp(NAME, "i") },
      { name: "weather", text: "¿Qué tiempo hace en Madrid?", heard: /madrid|tiempo/i, tool: "get_weather", answer: /\d|grados|tiempo/i },
    ];
    for (let i = 0; i < turns.length; i++) {
      const t = turns[i];
      process.stdout.write(`    turn ${i + 1}/${turns.length} [${t.name}] `);
      const mark = await H.toolWatchMark(page);
      const before = (await H.readMessages(page)).length;
      let r;
      try {
        r = await guard(t.name, 120000, () => H.turn(page, t.text, `builder_${i + 1}_${t.name}`, {
          micDevice: slot.micSink, spkDevice: slot.spkSink, monitor: slot.spkMonitor, settle: true,
          transcribeBot: false, speechInstructions: SPEECH,
        }));
      } catch (error) {
        check(`turn ${t.name} completed`, false, String(error.message || error).slice(0, 120));
        console.log("ERROR");
        continue;
      }
      const fired = await H.toolWatchSince(page, mark);
      const answer = (await H.readMessages(page)).slice(before).filter((m) => m.role === "bot" && m.text).map((m) => m.text).join(" ");
      console.log(`${r.botSpoke ? "spoke" : "SILENT"} tool=[${fired.join(",")}] | ${answer.slice(0, 70)}`);
      check(`turn ${t.name}: app ASR transcribed it`, r.inputReceived && t.heard.test(r.domUser || ""), `heard "${(r.domUser || "").slice(0, 50)}"`);
      check(`turn ${t.name}: bot spoke`, r.botSpoke);
      check(`turn ${t.name}: ${t.tool ? `tool ${t.tool} fired` : "no tool"}`, t.tool ? fired.includes(t.tool) : fired.length === 0, `[${fired.join(", ")}]`);
      check(`turn ${t.name}: answer matches ${t.answer}`, t.answer.test(answer), answer.slice(0, 80));
    }
    const end = await H.endConversation(page);
    check("conversation ends cleanly", Boolean(end.ended));
  } catch (error) {
    rep.hardFails.push(`threw: ${String(error.message || error).slice(0, 200)}`);
    console.log(`  ERROR ${String(error.message || error).slice(0, 200)}`);
  }
  await browser.close().catch(() => {});
  if (sig.badResponses.length) rep.hardFails.push(`${sig.badResponses.length} HTTP>=400: ${sig.badResponses.slice(0, 3).join(" ; ")}`);
  rep.pass = rep.hardFails.length === 0;
  rep.finishedAt = new Date().toISOString();
  fs.mkdirSync(H.OUT, { recursive: true });
  fs.writeFileSync(`${H.OUT}/builder_report.json`, JSON.stringify(rep, null, 2));
  console.log(`\n===== BUILDER ${rep.pass ? "PASS" : "FAIL"} (${rep.checks.filter((c) => c.ok).length}/${rep.checks.length} checks) session=${rep.sessionId || "?"} =====`);
  if (rep.hardFails.length) console.log(`  HARD: ${rep.hardFails.join(" | ")}`);
  if (rep.warns.length) console.log(`  warns: ${rep.warns.join(" | ")}`);
  process.exit(rep.pass ? 0 : 1);
})();
