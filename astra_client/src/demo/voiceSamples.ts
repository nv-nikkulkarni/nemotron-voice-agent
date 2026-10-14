// SPDX-License-Identifier: BSD-2-Clause
export interface VoiceSample { name: string; audio: string; }
const DB = "nva-voice-samples";
export async function savedVoiceSample(value?: VoiceSample | null): Promise<VoiceSample | null> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("samples");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction("samples", value === undefined ? "readonly" : "readwrite");
      const store = transaction.objectStore("samples");
      const request = value === undefined ? store.get("active") : value ? store.put(value, "active") : store.delete("active");
      let result: VoiceSample | null = null;
      request.onsuccess = () => { result = value === undefined ? request.result ?? null : value ?? null; };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { database.close(); }
}

export async function prepareVoiceSample(file: File): Promise<VoiceSample> {
  if (file.size > 10_000_000) throw new Error("Choose a speech recording smaller than 10 MB.");
  const context = new AudioContext();
  try {
    const input = await context.decodeAudioData(await file.arrayBuffer());
    if (input.duration < 3 || input.duration > 10) throw new Error("Choose 3–10 seconds of clear speech.");
    const frames = Math.round(input.duration * 22050);
    const renderer = new OfflineAudioContext(1, frames, 22050);
    const source = renderer.createBufferSource(); source.buffer = input; source.connect(renderer.destination); source.start();
    const mono = (await renderer.startRendering()).getChannelData(0);
    const data = new Uint8Array(44 + frames * 2); const view = new DataView(data.buffer);
    const tag = (position: number, value: string) => [...value].forEach((c, i) => view.setUint8(position + i, c.charCodeAt(0)));
    tag(0, "RIFF"); view.setUint32(4, data.length - 8, true); tag(8, "WAVE"); tag(12, "fmt ");
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 22050, true); view.setUint32(28, 44100, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    tag(36, "data"); view.setUint32(40, frames * 2, true);
    mono.forEach((value, i) => view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, value)) * 32767), true));
    let binary = "";
    for (let start = 0; start < data.length; start += 8192) binary += String.fromCharCode(...data.subarray(start, start + 8192));
    return { name: file.name, audio: btoa(binary) };
  } finally { await context.close(); }
}
