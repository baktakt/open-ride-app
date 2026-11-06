import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { createPublicRoutesRouter, validatePublicRoute, loadStarterRoutes } from '../src/publicRoutes.js';

const id = '11111111-1111-4111-8111-111111111111';
const stopId = '22222222-2222-4222-8222-222222222222';
const points = [{ lat: 0, lng: 0, ele: 0, distanceFromStart: 0 }, { lat: .01, lng: 0, ele: 10, distanceFromStart: 1.1119492664455874 }];
const payload = { name: 'Public test ride', description: 'An indoor ride.', points, estimatedMinutes: 30 };
const sha = (value: string) => createHash('sha256').update(value).digest('hex');

test('public route validation recomputes geometry version and excludes private fields', () => {
  const route = validatePublicRoute({ ...payload, apiKey: 'private', publication: { secret: 'private' } }, id)!;
  assert.equal(route.routeHash, sha(JSON.stringify(points.map(point => [point.lat, point.lng, point.ele, point.distanceFromStart]))));
  assert.ok(!JSON.stringify(route).includes('private'));
  assert.equal(validatePublicRoute({ ...payload, points: [points[0], { ...points[1], distanceFromStart: 50 }] }, id), null);
  assert.equal(validatePublicRoute({ ...payload, points: [points[0], { ...points[1], lng: Infinity }] }, id), null);
});

test('the curated catalogue is read-only and cannot publish or expose personal routes', async () => {
  const routes = await loadStarterRoutes();
  const app = express(); app.use('/routes', createPublicRoutesRouter({ starters: async () => routes }));
  const server = createServer(app); server.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/routes`;
  try {
    const list = await (await fetch(base)).json();
    assert.equal(list.routes.length, 5);
    assert.ok(list.routes.every((route: { curated: boolean; storyCount: number }) => route.curated && route.storyCount >= 7));
    assert.equal((await fetch(`${base}/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })).status, 405);
    assert.equal((await fetch(`${base}/${id}`, { method: 'DELETE' })).status, 405);
    assert.equal((await fetch(`${base}/${id}`)).status, 404);
    assert.equal((await fetch(`${base}/${id}/audio/${stopId}`)).status, 404);
    assert.equal((await fetch(`${base}/${routes[0].id}`)).status, 200);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('curated collection has realistic geometry, complete sources, narration and duration estimates', async () => {
  const routes = await loadStarterRoutes();
  assert.equal(routes.length, 5);
  for (const route of routes) {
    assert.ok(route.estimatedMinutes >= 30 && route.estimatedMinutes <= 120);
    const checked = validatePublicRoute(route, route.id)!;
    assert.ok(checked, route.name);
    assert.equal(route.routeHash, checked.routeHash);
    assert.equal(route.guide?.routeHash, route.routeHash);
    assert.ok(route.guide!.stops.length >= 7);
    assert.ok(route.guide!.stops.every(stop => stop.distanceKm >= 0 && stop.distanceKm <= route.totalDistance && stop.sources.length && stop.text.length <= 650));
    assert.equal(route.guide!.stops[0].distanceKm, 0, 'Every ride has an opening story');
    assert.ok(route.totalDistance - route.guide!.stops.at(-1)!.distanceKm <= .6, 'Every ride has a closing story');
    for (let index = 1; index < route.guide!.stops.length; index++) {
      const gap = route.guide!.stops[index].distanceKm - route.guide!.stops[index - 1].distanceKm;
      assert.ok(gap / route.totalDistance * route.estimatedMinutes <= 11, 'Quiet stretches have a reachable next reward');
    }
    for (const stop of route.guide!.stops) {
      const file = new URL(`../routes/audio/${route.id}/${stop.id}.wav`, import.meta.url);
      const audio = await readFile(file);
      assert.equal(audio.toString('ascii', 0, 4), 'RIFF');
      assert.equal(audio.toString('ascii', 8, 12), 'WAVE');
      assert.ok(audio.length > 1000 && audio.length < 3 * 1024 * 1024);
      const seconds = (audio.length - 44) / audio.readUInt32LE(28);
      assert.ok(seconds > 10 && seconds < 65, 'Chapters are short enough to enjoy while riding');
      assert.ok(Math.abs((stop.audioSeconds || 0) - seconds) < .01, 'Displayed coverage matches included recordings');
      let energy = 0;
      for (let sample = 44; sample + 1 < audio.length; sample += 200) energy += Math.abs(audio.readInt16LE(sample));
      assert.ok(energy > 10000, 'Included narration contains audible PCM samples');
      const stamp = await readFile(new URL(`../routes/audio/${route.id}/${stop.id}.sha256`, import.meta.url), 'utf8');
      assert.equal(stamp, sha(stop.text));
    }
  }
  const climb = routes.find(route => route.theme === 'Classic climb')!;
  assert.ok(climb.maxEle - climb.minEle > 1000);
});
