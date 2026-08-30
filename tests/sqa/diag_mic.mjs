// Diagnostic: does Chromium's getUserMedia actually hear what we paplay into mic_sink?
import { chromium } from "playwright";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { synthSpeech } from "./lib/audio.mjs";
const execFileP = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await execFileP("bash", ["-lc", "pactl info | grep -E 'Default (Source|Sink)'"]).then(({ stdout }) => console.log(stdout.trim()));
  const { outWav } = await synthSpeech("Testing one two three, can you hear me clearly now", "/sqa/out/diag.wav");

  const browser = await chromium.launch({ headless: false, args: ["--no-sandbox", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--disable-gpu"] });
  const ctx = await browser.newContext({ permissions: ["microphone"] });
  const page = await ctx.newPage();
  await page.goto(process.env.SQA_BASE || "http://localhost:7862", { waitUntil: "domcontentloaded" });
  await sleep(800);

  const devices = await page.evaluate(async () => {
    const dev = await navigator.mediaDevices.enumerateDevices();
    return dev.filter((d) => d.kind === "audioinput").map((d) => `${d.label || "(no label)"} [${d.deviceId.slice(0, 12)}]`);
  });
  console.log("audioinput devices:", devices);

  // Try both: default constraints and processing-off constraints.
  for (const proc of [true, false]) {
    await page.evaluate(async (proc) => {
      const c = proc ? true : { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
      const stream = await navigator.mediaDevices.getUserMedia({ audio: c });
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser(); an.fftSize = 1024; src.connect(an);
      const buf = new Float32Array(an.fftSize);
      window.__mic = { max: 0, samples: [] };
      window.__micTimer = setInterval(() => {
        an.getFloatTimeDomainData(buf); let s = 0; for (const v of buf) s += v * v;
        const rms = Math.sqrt(s / buf.length); window.__mic.max = Math.max(window.__mic.max, rms);
        window.__mic.samples.push(+rms.toFixed(4));
      }, 25);
    }, proc);
    await sleep(300);
    await execFileP("paplay", ["--device=mic_sink", outWav]);
    await sleep(300);
    const mic = await page.evaluate(() => { clearInterval(window.__micTimer); return window.__mic; });
    console.log(`processing=${proc ? "on(default)" : "off"} -> maxRms=${mic.max.toFixed(4)} nonzero=${mic.samples.filter((x) => x > 0.005).length}/${mic.samples.length}`);
  }
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
