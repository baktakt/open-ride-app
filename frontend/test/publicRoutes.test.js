import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importPublicRoute } from '../src/services/publicRoutes.js';
const route = { id: 'curated-id', curated: true, name: 'Curated ride', routeHash: 'a'.repeat(64), points: [{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }], guide: { language: 'en', stops: [{ id: 'clip-id' }] } };

test('a curated route is usable before audio downloads, with no keys or publishing control', async () => {
  let requests = 0;
  const result = await importPublicRoute(route.id, {
    fetchImpl: async (_url, options) => { requests++; assert.equal(options.headers, undefined); return Response.json(route); },
    saveRouteImpl: async value => value,
  });
  assert.equal(requests, 1);
  assert.equal(result.curated, true);
  assert.equal(result.publicSource, route.id);
  assert.deepEqual(result.guide, route.guide);
  assert.equal(result.publication, undefined);
});

test('personal or previously shared routes cannot enter the curated collection', async () => {
  await assert.rejects(importPublicRoute('personal', { fetchImpl: async () => Response.json({ ...route, curated: false }), saveRouteImpl: assert.fail }), /Invalid curated/);
});
