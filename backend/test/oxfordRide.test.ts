import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';
import { loadStarterRoutes, validatePublicRoute } from '../src/publicRoutes.js';
import { captionChunks } from '../../frontend/src/services/curatedGuide.js';

test('Oxford quest delivers eleven hands-free chapters every three to five minutes', async () => {
  const routes = await loadStarterRoutes();
  const ride = routes.find(route => route.name.startsWith('Oxford:'))!;
  assert.ok(ride);
  assert.ok(validatePublicRoute(ride, ride.id));
  assert.equal(ride.estimatedMinutes, 40);
  assert.ok(Math.abs(ride.totalDistance / 25 * 60 - 40) < 1);
  const stops = ride.guide!.stops;
  assert.equal(stops.length, 11);
  assert.equal(stops[0].distanceKm, 0);
  for (let i = 1; i < stops.length; i++) {
    const minutes = (stops[i].distanceKm - stops[i - 1].distanceKm) / 25 * 60;
    assert.ok(minutes >= 3 && minutes <= 5);
    assert.ok(stops[i - 1].audioSeconds! < minutes * 60);
  }
  assert.ok((ride.totalDistance - stops.at(-1)!.distanceKm) / 25 * 3600 > stops.at(-1)!.audioSeconds!);
  assert.ok(stops.at(-1)!.text.includes('not at the grave itself'));
  assert.ok(stops[8].text.includes('not one beside this track'));
  for (const stop of stops) {
    assert.ok(stop.sources.every(source => source.url.startsWith('https://')));
    assert.ok(stop.sources.some(source => source.url.includes('20240523115311')));
    const base = new URL(`../routes/audio/${ride.id}/${stop.id}`, import.meta.url);
    const wav = await readFile(new URL(base.href + '.wav'));
    assert.equal(wav.readUInt32LE(16), 16);
    assert.equal(wav.readUInt16LE(20), 1);
    assert.equal(wav.readUInt16LE(22), 1);
    assert.equal(wav.readUInt32LE(24), 24000);
    assert.equal(wav.readUInt16LE(34), 16);
    assert.equal(wav.toString('ascii', 36, 40), 'data');
    assert.equal(wav.readUInt32LE(40), wav.length - 44);
    const recipe = JSON.parse(await readFile(new URL(base.href + '.tts.json'), 'utf8'));
    assert.equal(recipe.textSha256, createHash('sha256').update(stop.text).digest('hex'));
    assert.ok(recipe.renderer.includes('bm_george'));
  }
});

test('Oxford review exports preserve the exact app captions, speech text and GPX geometry', async () => {
  const ride = (await loadStarterRoutes()).find(route => route.name.startsWith('Oxford:'))!;
  const docs = new URL('../../docs/rides/', import.meta.url);
  const captions = JSON.parse(await readFile(new URL('oxford-last-page-captions.json', docs), 'utf8'));
  const transcript = await readFile(new URL('oxford-last-page-transcript.md', docs), 'utf8');
  assert.equal(captions.routeId, ride.id);
  assert.equal(captions.guideId, ride.guide!.id);
  assert.equal(captions.chapters.length, ride.guide!.stops.length);
  for (const [index, stop] of ride.guide!.stops.entries()) {
    const chapter = captions.chapters[index];
    assert.equal(chapter.id, stop.id);
    assert.equal(chapter.text, stop.text);
    assert.deepEqual(chapter.cues.map((cue: { text: string }) => cue.text), captionChunks(stop.text));
    assert.equal(chapter.cues[0].startSeconds, 0);
    assert.equal(chapter.cues.at(-1).endSeconds, stop.audioSeconds);
    assert.ok(transcript.includes(stop.text));
    assert.ok(transcript.includes(`${stop.id}.wav`));
  }
  const xml = await readFile(new URL('oxford-last-page.gpx', docs), 'utf8');
  const gpx = new XMLParser({ ignoreAttributes: false }).parse(xml);
  const points = gpx.gpx.trk.trkseg.trkpt;
  assert.deepEqual(points.map((point: { '@_lat': string; '@_lon': string; ele: number }) => [Number(point['@_lat']), Number(point['@_lon']), point.ele]), ride.points.map(point => [point.lat, point.lng, point.ele]));
});
