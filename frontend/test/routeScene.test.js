import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRoadPath, pointAt, roadRibbon, scatterTrees, seededRandom, ROAD_HEIGHT_OFFSET_M } from '../src/services/routeScene.js';
import { createLocalProjection } from '../src/services/terrain.js';

const proj = createLocalProjection(57.77, 12.27);
// Gentle east-west slope: 1 m per 100 m east
const field = { originX: -5000, originZ: -5000, spacing: 50, cols: 201, rows: 201,
  heights: Float32Array.from({ length: 201 * 201 }, (_, i) => ((i % 201) * 50 - 5000) / 100) };

// 1 km due north
const route = [0, 0.5, 1].map(km => ({ lat: 57.77 + km / 111.32, lng: 12.27, distanceFromStart: km }));

test('road path is evenly resampled and draped on the terrain', () => {
  const path = buildRoadPath(route, proj, field);
  assert.equal(path.points.length, 201);
  assert.equal(path.points[0].d, 0);
  assert.equal(path.points[200].d, 1000);
  assert.ok(Math.abs(path.points[0].y - ROAD_HEIGHT_OFFSET_M) < 1e-6);
  assert.ok(path.points[200].z < -990); // north is −z
});

test('pointAt interpolates and clamps', () => {
  const path = buildRoadPath(route, proj, field);
  const mid = pointAt(path, 502.5);
  assert.ok(Math.abs(mid.z - pointAt(path, 500).z - (pointAt(path, 505).z - pointAt(path, 500).z) / 2) < 1e-6);
  assert.deepEqual(pointAt(path, -10), { ...path.points[0] });
  assert.deepEqual(pointAt(path, 5000), { ...path.points[200] });
});

test('ribbon edges sit half a road width either side (left of travel is west when heading north)', () => {
  const path = buildRoadPath(route, proj, field);
  const { left, right } = roadRibbon(path, 3);
  assert.ok(Math.abs(left[100].x - path.points[100].x + 3) < 1e-6);
  assert.ok(Math.abs(right[100].x - path.points[100].x - 3) < 1e-6);
});

test('trees are deterministic and keep clear of the road', () => {
  const path = buildRoadPath(route, proj, field);
  const a = scatterTrees(path, field, { count: 300, seed: 7 });
  const b = scatterTrees(path, field, { count: 300, seed: 7 });
  assert.equal(a.length, 300);
  assert.deepEqual(a, b);
  for (const t of a) {
    const nearest = Math.min(...path.points.map(p => Math.hypot(p.x - t.x, p.z - t.z)));
    assert.ok(nearest >= 15, `tree ${nearest.toFixed(1)} m from road`);
  }
});

test('seeded random is in [0, 1) and repeatable', () => {
  const r1 = seededRandom(42);
  const r2 = seededRandom(42);
  for (let i = 0; i < 100; i++) {
    const v = r1();
    assert.equal(v, r2());
    assert.ok(v >= 0 && v < 1);
  }
});
