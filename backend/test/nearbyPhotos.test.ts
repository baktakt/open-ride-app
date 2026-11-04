import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { createNearbyPhotosRouter, distanceMeters } from '../src/nearbyPhotos.js';

// Exercise the router without sockets so tests also run in restricted environments.
async function request(router: ReturnType<typeof createNearbyPhotosRouter>, path: string) {
  return new Promise<{ status: number; body?: any; headers: Record<string, string>; redirect?: string }>((resolve, reject) => {
    const app = express();
    app.use('/api/nearby-photos', router);
    const headers: Record<string, string> = {};
    const res: any = {
      statusCode: 200,
      setHeader(name: string, value: string) { headers[name] = value; },
      getHeader(name: string) { return headers[name]; },
      status(code: number) { this.statusCode = code; return this; },
      json(body: any) { resolve({ status: this.statusCode, body, headers }); },
      end() { resolve({ status: this.statusCode, headers }); },
      redirect(url: string) { resolve({ status: 302, redirect: url, headers }); },
    };
    app.handle({ method: 'GET', url: path, headers: {} } as any, res, reject);
  });
}

test('unconfigured photos fail gracefully', async () => {
  const result = await request(createNearbyPhotosRouter({ apiKey: '' }), '/api/nearby-photos?lat=59&lng=18');
  assert.equal(result.status, 503);
  assert.equal(result.headers['Cache-Control'], 'no-store');
});

test('rejects missing, malformed, repeated and out-of-range coordinates', async () => {
  const router = createNearbyPhotosRouter({ apiKey: 'test', fetchImpl: async () => { throw new Error('Unexpected upstream'); } });
  for (const query of ['', '?lat=&lng=0', '?lat=91&lng=0', '?lat=0&lng=181', '?lat=NaN&lng=1', '?lat=1&lat=2&lng=0']) {
    assert.equal((await request(router, `/api/nearby-photos${query}`)).status, 400);
  }
});

test('returns place details and attribution while keeping the key server-side', async () => {
  const calls: { url: string; options: any }[] = [];
  const router = createNearbyPhotosRouter({ apiKey: 'secret-test-key', fetchImpl: async (url, options) => {
    calls.push({ url: String(url), options });
    return Response.json(calls.length === 1 ? { places: [
      { displayName: { text: 'Harbour' }, location: { latitude: 59.001, longitude: 18 }, googleMapsUri: 'https://maps.google.com/place', photos: [{ name: 'places/abc/photos/photo1', authorAttributions: [{ displayName: 'Photographer', uri: 'https://maps.google.com/author' }] }] },
      { displayName: { text: 'No photo' }, location: { latitude: 59, longitude: 18 } },
    ] } : { photoUri: 'https://lh3.googleusercontent.com/example' });
  } });
  const result = await request(router, '/api/nearby-photos?lat=59&lng=18');
  assert.equal(result.status, 200);
  assert.equal(result.body.places.length, 1);
  const place = result.body.places[0];
  assert.equal(place.name, 'Harbour');
  assert.equal(place.distanceM, 111);
  assert.equal(place.authors[0].displayName, 'Photographer');
  assert.ok(!JSON.stringify(result.body).includes('secret-test-key'));
  assert.ok(!place.photoUrl.includes('places/abc'));
  assert.equal(JSON.parse(calls[0].options.body).locationRestriction.circle.radius, 1500);
  const image = await request(router, place.photoUrl);
  assert.equal(image.redirect, 'https://lh3.googleusercontent.com/example');
  assert.match(calls[1].url, /places\/abc\/photos\/photo1\/media/);
  const before = calls.length;
  assert.equal((await request(router, '/api/nearby-photos/not-a-token')).status, 404);
  assert.equal(calls.length, before);
});

test('sanitizes upstream failures and handles an empty search', async () => {
  let fail = true;
  const router = createNearbyPhotosRouter({ apiKey: 'test', fetchImpl: async () => {
    if (fail) throw new Error('private upstream details');
    return Response.json({});
  } });
  const failure = await request(router, '/api/nearby-photos?lat=0&lng=0');
  assert.equal(failure.status, 502);
  assert.ok(!JSON.stringify(failure).includes('private upstream details'));
  fail = false;
  assert.deepEqual((await request(router, '/api/nearby-photos?lat=0&lng=0')).body, { places: [] });
});

test('per-process request limit bounds upstream spending', async () => {
  let calls = 0;
  const router = createNearbyPhotosRouter({ apiKey: 'test', fetchImpl: async () => { calls++; return Response.json({}); } });
  for (let i = 0; i < 60; i++) assert.equal((await request(router, '/api/nearby-photos?lat=0&lng=0')).status, 200);
  assert.equal((await request(router, '/api/nearby-photos?lat=0&lng=0')).status, 429);
  assert.equal(calls, 60);
  assert.equal(Math.round(distanceMeters(0, 0, 0, 1)), 111195);
});
