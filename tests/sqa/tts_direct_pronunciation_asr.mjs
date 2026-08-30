import fs from "node:fs";
import path from "node:path";

import { transcribe } from "/sqa/lib/audio.mjs";

const DIR = process.env.TTS_PROBE_DIR || "/sqa/artifacts/viking-0.1.114-direct-pronunciation";
const manifestPath = path.join(DIR, "direct_pronunciation_manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const results = [];

for (const record of manifest.records) {
  const transcript = await transcribe(path.join(DIR, record.wav));
  const result = { ...record, independentAsr: transcript };
  results.push(result);
  console.log(JSON.stringify(result));
}

const report = {
  schema_version: 1,
  generatedAt: new Date().toISOString(),
  sourceManifest: path.basename(manifestPath),
  categoriesCovered: [...new Set(results.filter((item) => item.tts === "magpie").map((item) => item.category))].sort(),
  results,
};
fs.writeFileSync(path.join(DIR, "direct_pronunciation_asr.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ clips: results.length, categories: report.categoriesCovered.length }));
