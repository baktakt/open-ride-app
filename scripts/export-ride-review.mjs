/** Export the reviewed speech, exact app caption chunks and GPX for one ride. */
import { readFile, writeFile } from 'node:fs/promises';
import { captionChunks } from '../frontend/src/services/curatedGuide.js';
const routes = JSON.parse(await readFile(new URL('../backend/routes/starter-routes.json', import.meta.url), 'utf8'));
const prefix = process.argv[2];
const slug = process.argv[3];
if (!prefix || !/^[a-z0-9-]+$/.test(slug || '')) throw new Error('Usage: node scripts/export-ride-review.mjs NAME_PREFIX output-slug');
const matches = routes.filter(route => route.name.startsWith(prefix));
if (matches.length !== 1) throw new Error('Prefix must match exactly one ride');
const [route] = matches;
const base = new URL(`../docs/rides/${slug}`, import.meta.url);
let transcript = `# ${route.name}: speech and captions\n\n${route.description}\n\nThese are the exact words sent to the local voice model and displayed by the app. Caption timings are proportional, not word-aligned.\n`;
const chapters = route.guide.stops.map(stop => {
  const chunks = captionChunks(stop.text);
  if (chunks.join(' ') !== stop.text) throw new Error(`Caption text mismatch: ${stop.title}`);
  const total = chunks.reduce((sum, text) => sum + text.length, 0);
  let offset = 0;
  const cues = chunks.map(text => {
    const startSeconds = offset / total * stop.audioSeconds;
    offset += text.length;
    return { text, startSeconds, endSeconds: offset / total * stop.audioSeconds };
  });
  const wav = `../../backend/routes/audio/${route.id}/${stop.id}.wav`;
  transcript += `\n## ${stop.distanceKm.toFixed(2)} km — ${stop.title}\n\n[Listen (${stop.audioSeconds.toFixed(2)} seconds)](${wav})\n\n${stop.text}\n\n${stop.sources.map(source => `[${source.title}](${source.url})`).join(' · ')}\n`;
  return { id: stop.id, title: stop.title, distanceKm: stop.distanceKm, audioSeconds: stop.audioSeconds, text: stop.text, cues };
});
await writeFile(new URL(base.href + '-transcript.md'), transcript);
await writeFile(new URL(base.href + '-captions.json'), JSON.stringify({ routeId: route.id, guideId: route.guide.id, timing: 'approximate relative text length, matching app', chapters }, null, 2) + '\n');
const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
await writeFile(new URL(base.href + '.gpx'), `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Open Ride" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>${xml(route.name)}</name><desc>${xml(route.attribution)} Personal GPX import does not include narration; ride from Explore routes for audio.</desc></metadata><trk><name>${xml(route.name)}</name><trkseg>\n${route.points.map(p => `<trkpt lat="${p.lat}" lon="${p.lng}"><ele>${p.ele}</ele></trkpt>`).join('\n')}\n</trkseg></trk></gpx>\n`);
console.log(`Exported ${chapters.length} chapters, exact captions, and ${route.points.length} GPX points to docs/rides/${slug}*`);
