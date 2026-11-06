/** Regenerate the checked-in starter narration locally; no API key or paid calls. */
import { readFile, writeFile, mkdir, stat, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { AutoTokenizer, StyleTextToSpeech2Model } from '../frontend/node_modules/@huggingface/transformers/dist/transformers.node.mjs';
import { KokoroTTS } from '../frontend/node_modules/kokoro-js/dist/kokoro.js';
const manifestUrl = new URL('../backend/routes/starter-routes.json', import.meta.url);
const routes = JSON.parse(await readFile(manifestUrl, 'utf8'));
const saveManifest = async () => { const temp = new URL('starter-routes.json.tmp', manifestUrl); await writeFile(temp, JSON.stringify(routes)); await rename(temp, manifestUrl); };
const digest = text => createHash('sha256').update(text).digest('hex');
for (const route of routes) {
  route.routeHash = digest(JSON.stringify(route.points.map(point => [point.lat, point.lng, point.ele, point.distanceFromStart])));
  route.guide.routeHash = route.routeHash;
}
await saveManifest();
let remaining = Number(process.argv[2] || 999);
const modelId = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const [weights, tokenizer] = await Promise.all([
  StyleTextToSpeech2Model.from_pretrained(modelId, { dtype: 'q8', device: 'cpu', session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 } }),
  AutoTokenizer.from_pretrained(modelId),
]);
const model = new KokoroTTS(weights, tokenizer);
function wavBuffer(audio) {
  const size = audio.audio.length * 2;
  const data = Buffer.alloc(44 + size);
  data.write('RIFF', 0); data.writeUInt32LE(36 + size, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(audio.sampling_rate, 24); data.writeUInt32LE(audio.sampling_rate * 2, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(size, 40);
  for (let i = 0; i < audio.audio.length; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, audio.audio[i])) * 32767), 44 + i * 2);
  return data;
}
for (const route of routes) {
  const directory = new URL(`../backend/routes/audio/${route.id}/`, import.meta.url);
  await mkdir(directory, { recursive: true });
  for (const stop of route.guide.stops) {
    const path = new URL(`${stop.id}.wav`, directory);
    const stamp = new URL(`${stop.id}.sha256`, directory);
    let existing = '';
    try { existing = await readFile(stamp, 'utf8'); await stat(path); } catch { existing = ''; }
    if (existing === digest(stop.text)) {
      const cached = await readFile(path);
      if (cached.readUInt16LE(20) === 3 && cached.readUInt16LE(34) === 32) {
        const samples = new Float32Array((cached.length - 44) / 4);
        for (let index = 0; index < samples.length; index++) samples[index] = cached.readFloatLE(44 + index * 4);
        await writeFile(path, wavBuffer({ audio: samples, sampling_rate: cached.readUInt32LE(24) }));
      }
    }
    if (existing !== digest(stop.text)) {
      const audio = await model.generate(stop.text, { voice: 'af_heart' });
      await writeFile(path, wavBuffer(audio));
      await writeFile(stamp, digest(stop.text));
      remaining--;
    }
    const rendered = await readFile(path);
    stop.audioSeconds = (rendered.length - 44) / rendered.readUInt32LE(28);
    await saveManifest();
    console.log(`Rendered ${route.name}: ${stop.title}`);
    if (remaining <= 0) process.exit(0);
  }
}
