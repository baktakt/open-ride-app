import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lngLatToTile, tileRange, tileCount, chooseZoom, decodeTerrarium, createLocalProjection,
  routeBounds, sampleTiles, buildHeightField, heightAt, maxZoomFor, TILE_SIZE,
} from '../src/services/terrain.js';

// Lerum, Sweden
const LAT = 57.77;
const LNG = 12.27;

test('tile coordinates match the Web Mercator scheme', () => {
  const t = lngLatToTile(LNG, LAT, 12);
  assert.equal(Math.floor(t.x), 2187);
  assert.equal(Math.floor(t.y), 1238); // checked against the standard asinh(tan(lat)) formula
  assert.deepEqual(lngLatToTile(0, 0, 1), { x: 1, y: 1 });
});

test('zoom is reduced until the tile budget fits', () => {
  const small = routeBounds([{ lat: LAT, lng: LNG }, { lat: LAT + 0.02, lng: LNG + 0.03 }]);
  assert.equal(chooseZoom(small), 13);
  const large = routeBounds([{ lat: 57, lng: 11 }, { lat: 59, lng: 14 }]);
  const z = chooseZoom(large);
  assert.ok(z < 13);
  assert.ok(tileCount(tileRange(large, z)) <= 64);
});

test('terrarium pixels decode to metres', () => {
  // 32768 + 100.5 m → R=128, G=100, B=128
  const h = decodeTerrarium(new Uint8ClampedArray([128, 100, 128, 255, 128, 0, 0, 255]));
  assert.equal(h[0], 100.5);
  assert.equal(h[1], 0);
});

test('local projection round-trips and measures distances', () => {
  const proj = createLocalProjection(LAT, LNG);
  const p = proj.toLocal(LAT + 0.009, LNG);   // ~1 km north
  assert.ok(Math.abs(p.z + 1001.9) < 5 && Math.abs(p.x) < 1e-9);
  const back = proj.toLatLng(p.x, p.z);
  assert.ok(Math.abs(back.lat - (LAT + 0.009)) < 1e-12);
  const east = proj.toLocal(LAT, LNG + 0.01);
  assert.ok(east.x > 590 && east.x < 600);   // 0.01° lng ≈ 595 m at 57.8°N
});

function flatTiles(range, heightFn) {
  const tiles = new Map();
  for (let x = range.minX; x <= range.maxX; x++) {
    for (let y = range.minY; y <= range.maxY; y++) {
      const h = new Float32Array(TILE_SIZE * TILE_SIZE);
      for (let i = 0; i < h.length; i++) h[i] = heightFn(x, y, i);
      tiles.set(`${x}/${y}`, h);
    }
  }
  return tiles;
}

test('height field samples the tile mosaic and fills gaps', () => {
  const bounds = routeBounds([{ lat: LAT, lng: LNG }, { lat: LAT + 0.01, lng: LNG + 0.01 }], 200);
  const range = tileRange(bounds, 13);
  const tiles = flatTiles(range, () => 42);
  assert.equal(sampleTiles(tiles, 13, LAT, LNG), 42);

  const proj = createLocalProjection(LAT, LNG);
  const field = buildHeightField({ tiles, z: 13, bounds, projection: proj, maxSamples: 50 });
  assert.equal(field.missing, 0);
  assert.ok(field.heights.every(h => h === 42));
  assert.equal(heightAt(field, 0, 0), 42);

  const empty = buildHeightField({ tiles: new Map(), z: 13, bounds, projection: proj, fallbackHeight: 7, maxSamples: 20 });
  assert.equal(empty.missing, empty.cols * empty.rows);
  assert.equal(heightAt(empty, 0, 0), 7);
});

test('heightAt interpolates between grid samples', () => {
  const field = { originX: 0, originZ: 0, spacing: 10, cols: 2, rows: 2, heights: new Float32Array([0, 10, 20, 30]) };
  assert.equal(heightAt(field, 5, 0), 5);
  assert.equal(heightAt(field, 0, 5), 10);
  assert.equal(heightAt(field, 5, 5), 15);
  assert.equal(heightAt(field, 100, 100), 30); // clamped
});

test('zoom cap follows the provider', () => {
  assert.equal(maxZoomFor({ id: 'terrarium', maxZoom: 14 }), 13);      // ~30 m source data
  assert.equal(maxZoomFor({ id: 'lantmateriet', maxZoom: 14 }), 14);   // 1 m source data
  assert.equal(maxZoomFor({ id: 'lantmateriet', maxZoom: 12 }), 12);
});

test('grid cells average the tile pixels instead of point-sampling them', () => {
  // A 1-pixel-wide ridge every 8 pixels: a point sample either hits it or not,
  // the cell average sees its share
  const bounds = routeBounds([{ lat: LAT, lng: LNG }, { lat: LAT + 0.05, lng: LNG + 0.08 }], 0);
  const range = tileRange(bounds, 13);
  const tiles = flatTiles(range, (_x, _y, i) => ((i % TILE_SIZE) % 8 === 0 ? 80 : 0));
  const proj = createLocalProjection(LAT, LNG);
  const field = buildHeightField({ tiles, z: 13, bounds, projection: proj, maxSamples: 120 });
  const values = Array.from(field.heights);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  assert.ok(Math.abs(mean - 10) < 2.5, `mean ${mean}`);       // 80 m on 1 pixel in 8
  assert.ok(Math.max(...values) < 40, 'no cell is just the ridge');
});
