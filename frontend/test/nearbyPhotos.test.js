import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readNearbyPhotos } from '../src/services/nearbyPhotos.js';

test('HTML SPA fallback explains the missing API route', async () => {
  const response = new Response('<!DOCTYPE html><html></html>', { headers: { 'content-type': 'text/html' } });
  await assert.rejects(readNearbyPhotos(response), /routed to the Open Ride backend/);
});

test('backend configuration errors reach the rider', async () => {
  const response = Response.json({ error: 'Google Places is not configured.' }, { status: 503 });
  await assert.rejects(readNearbyPhotos(response), /Google Places is not configured/);
});

test('an outdated backend explains the missing endpoint', async () => {
  const response = new Response('<pre>Cannot GET /api/nearby-photos</pre>', { status: 404, headers: { 'content-type': 'text/html' } });
  await assert.rejects(readNearbyPhotos(response), /Redeploy the backend/);
});

test('accepts empty places and rejects malformed API responses', async () => {
  assert.deepEqual(await readNearbyPhotos(Response.json({ places: [] })), { places: [] });
  await assert.rejects(readNearbyPhotos(Response.json({})), /invalid response/);
  await assert.rejects(readNearbyPhotos(new Response('{', { headers: { 'content-type': 'application/json' } })), /invalid response/);
});
