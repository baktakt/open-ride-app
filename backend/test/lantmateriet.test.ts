import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { openCOG, pickImage, readWindow, CogSource } from '../src/lantmateriet/cog.js';
import { toSweref99tm } from '../src/lantmateriet/sweref.js';
import { decodePngRgb, encodePngRgb, terrariumHeights, terrariumRgb } from '../src/lantmateriet/png.js';
import { pixelLatLng, tileBounds } from '../src/lantmateriet/provider.js';
import { createTerrainTileService } from '../src/terrainTiles.js';
import { writeCog } from './helpers/cogWriter.js';

// ─── Synthetic terrain model around Lerum ────────────────────────────────────
// 8 × 8 km at 8 m (and a 32 m overview); heights are a known plane so every
// rendered pixel can be checked exactly.
const E0 = 334000;
const N1 = 6410000;            // north edge
const SIZE_M = 8000;
const height = (e: number, n: number): number => 20 + (e - E0) / 100 + (n - (N1 - SIZE_M)) / 50;

function grid(res: number): { width: number; height: number; tileSize: number; values: Float32Array } {
  const cells = SIZE_M / res;
  const values = new Float32Array(cells * cells);
  for (let r = 0; r < cells; r++) {
    for (let c = 0; c < cells; c++) values[r * cells + c] = height(E0 + (c + 0.5) * res, N1 - (r + 0.5) * res);
  }
  values[0] = -9999; // one nodata cell in the corner
  return { width: cells, height: cells, tileSize: 256, values };
}

const COG = writeCog([grid(8), grid(32)], { originX: E0, originY: N1, res: 8, nodata: -9999 });
const COG_PREDICTOR3 = writeCog([grid(8)], { originX: E0, originY: N1, res: 8, nodata: -9999 }, 3);
const COG_URL = 'https://dl1.lantmateriet.se/hojd/data/grid/mhm/64_3/m640_33.tif';
const AUTH = 'Basic ' + Buffer.from('rider:secret').toString('base64');
const FALLBACK_HEIGHT = 7;

function mockFetch(cog: Buffer, { status = 206, stacRateLimited = 0, truncateBlocks = 0 }: { status?: number; stacRateLimited?: number; truncateBlocks?: number } = {}) {
  const calls: string[] = [];
  let stacCalls = 0;
  let truncated = 0;
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (url.startsWith('https://api.lantmateriet.se/stac-hojd/')) {
      stacCalls += 1;
      if (stacCalls <= stacRateLimited) return new Response('slow down', { status: 429, headers: { 'Retry-After': '0' } });
      // footprint of the synthetic file (roughly; the filter only needs overlap)
      const features = [{ bbox: [12.15, 57.70, 12.33, 57.81], assets: { data: { href: COG_URL } } }];
      return new Response(JSON.stringify({ features }), { status: 200 });
    }
    if (url === COG_URL) {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      if (headers.Authorization !== AUTH || status === 401) return new Response('no', { status: 401 });
      const [, s, e] = /bytes=(\d+)-(\d+)/.exec(headers.Range ?? '') ?? [];
      let body = cog.subarray(Number(s), Number(e) + 1);
      // block reads (past the 64 KB header) can be cut short, like a dropped connection
      if (Number(s) >= 65536 && truncated < truncateBlocks) {
        truncated += 1;
        body = body.subarray(0, Math.floor(body.length / 2));
      }
      return new Response(new Uint8Array(body), { status });
    }
    if (url.includes('/terrarium/')) {
      return new Response(new Uint8Array(encodePngRgb(256, 256, terrariumRgb(new Float32Array(65536).fill(FALLBACK_HEIGHT)))), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { impl, calls };
}

function tileAt(lat: number, lng: number, z: number): [number, number] {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const y = Math.floor(((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n);
  return [x, y];
}

const tmp = (): Promise<string> => fs.mkdtemp(path.join(os.tmpdir(), 'openride-lm-'));

// ─── Projection ──────────────────────────────────────────────────────────────

test('SWEREF 99 TM matches PROJ (EPSG:4326 → EPSG:3006) to the millimetre', () => {
  // reference values computed with pyproj 3.8
  const reference: Array<[number, number, number, number]> = [
    [57.77, 12.27, 337624.963, 6406377.305],   // Lerum
    [62.0, 15.0, 500000.000, 6874180.148],     // central meridian
    [55.4, 11.0, 246750.748, 6146585.950],     // south-west (Skåne)
    [68.9, 24.1, 864459.447, 7670285.568],     // far north-east
    [59.33, 18.06, 674079.257, 6580798.387],   // Stockholm
  ];
  for (const [lat, lng, e, n] of reference) {
    const [pe, pn] = toSweref99tm(lat, lng);
    assert.ok(Math.abs(pe - e) < 0.002 && Math.abs(pn - n) < 0.002, `${lat},${lng}: ${pe},${pn}`);
  }
});

// ─── PNG / terrarium ─────────────────────────────────────────────────────────

test('terrarium PNG round-trips heights to 1/256 m', () => {
  const heights = Float32Array.from({ length: 65536 }, (_, i) => -50 + i * 0.037);
  const png = encodePngRgb(256, 256, terrariumRgb(heights));
  const decoded = terrariumHeights(decodePngRgb(png).rgb);
  for (let i = 0; i < heights.length; i += 97) assert.ok(Math.abs(decoded[i] - heights[i]) <= 1 / 512 + 1e-6);
});

// ─── COG reader ──────────────────────────────────────────────────────────────

test('COG reader finds the full image and its overview, georeferencing and nodata', async () => {
  const { impl } = mockFetch(COG);
  const info = await openCOG(COG_URL, { headers: { Authorization: AUTH }, cacheDir: null, fetchImpl: impl });
  assert.equal(info.originX, E0);
  assert.equal(info.originY, N1);
  assert.equal(info.nodata, -9999);
  assert.deepEqual(info.images.map(i => [i.width, i.resX]), [[1000, 8], [250, 32]]);
  assert.equal(pickImage(info, 10), 0);   // 10 m pixels need the 8 m image
  assert.equal(pickImage(info, 40), 1);   // 40 m pixels can use the 32 m overview
  assert.equal(pickImage(info, 2), 0);    // nothing finer exists
});

for (const [name, cog] of [['predictor 1', COG], ['floating-point predictor 3', COG_PREDICTOR3]] as const) {
  test(`COG windows decode correctly (${name}) and blocks are cached`, async () => {
    const dir = await tmp();
    const { impl, calls } = mockFetch(cog);
    const source: CogSource = { headers: { Authorization: AUTH }, cacheDir: dir, fetchImpl: impl };
    const info = await openCOG(COG_URL, source);
    const win = await readWindow(info, 0, 250, 250, 260, 270, source); // crosses a block boundary
    for (let r = 0; r < 20; r++) {
      for (let c = 0; c < 10; c++) {
        const expected = height(E0 + (250 + c + 0.5) * 8, N1 - (250 + r + 0.5) * 8);
        assert.ok(Math.abs(win[r * 10 + c] - expected) < 1e-3);
      }
    }
    const corner = await readWindow(info, 0, 0, 0, 1, 1, source);
    assert.ok(Number.isNaN(corner[0]), 'nodata becomes NaN');

    const before = calls.length;
    await readWindow(info, 0, 250, 250, 260, 270, source);
    assert.equal(calls.length, before, 'second read is served from the block cache');
    await fs.rm(dir, { recursive: true });
  });
}

test('COG reader reports wrong credentials as HTTP 401 without retrying', async () => {
  const { impl, calls } = mockFetch(COG);
  await assert.rejects(openCOG(COG_URL, { headers: { Authorization: 'Basic bad' }, cacheDir: null, fetchImpl: impl }), /HTTP 401/);
  assert.equal(calls.length, 1);
});

// ─── Rendered tiles through the tile service ─────────────────────────────────

async function renderedHeights(z: number, options: { status?: number } = {}) {
  const dir = await tmp();
  const { impl, calls } = mockFetch(COG, options);
  const service = createTerrainTileService(dir, { lantmateriet: { user: 'rider', pass: 'secret' }, fetchImpl: impl });
  const [x, y] = tileAt(57.77, 12.27, z);
  const result = await service.getTile('lantmateriet', z, x, y);
  assert.equal(result.status, 'ok');
  if (result.status !== 'ok') throw new Error('unreachable');
  return { heights: terrariumHeights(decodePngRgb(result.body).rgb), x, y, dir, calls, result, service };
}

test('a z13 tile over Lerum reproduces the terrain model at every pixel', async () => {
  const { heights, x, y, dir } = await renderedHeights(13);
  let checked = 0;
  for (let j = 0; j < 256; j += 5) {
    for (let i = 0; i < 256; i += 5) {
      const { lat, lng } = pixelLatLng(13, x, y, i, j);
      const [e, n] = toSweref99tm(lat, lng);
      assert.ok(Math.abs(heights[j * 256 + i] - height(e, n)) < 0.02, `pixel ${i},${j}`);
      checked += 1;
    }
  }
  assert.ok(checked > 2500);
  // the 8 m image was used, not the 32 m overview
  const levels = await fs.readdir(path.join(dir, 'lantmateriet', 'blocks', 'm640_33'));
  assert.deepEqual(levels, ['0']);
  await fs.rm(dir, { recursive: true });
});

test('a coarse z11 tile uses the overview and fills areas outside the model from the fallback', async () => {
  const { heights, x, y, dir } = await renderedHeights(11);
  const levels = await fs.readdir(path.join(dir, 'lantmateriet', 'blocks', 'm640_33'));
  assert.deepEqual(levels, ['1']);

  let inside = 0;
  let outside = 0;
  for (let j = 0; j < 256; j += 4) {
    for (let i = 0; i < 256; i += 4) {
      const { lat, lng } = pixelLatLng(11, x, y, i, j);
      const [e, n] = toSweref99tm(lat, lng);
      const h = heights[j * 256 + i];
      const margin = 64; // two overview cells from the model's edge
      if (e > E0 + margin && e < E0 + SIZE_M - margin && n < N1 - margin && n > N1 - SIZE_M + margin) {
        assert.ok(Math.abs(h - height(e, n)) < 0.05, `inside ${i},${j}: ${h} vs ${height(e, n)}`);
        inside += 1;
      } else if (e < E0 - margin || e > E0 + SIZE_M + margin || n > N1 + margin || n < N1 - SIZE_M - margin) {
        assert.equal(h, FALLBACK_HEIGHT);
        outside += 1;
      }
    }
  }
  assert.ok(inside > 100 && outside > 100, `inside ${inside}, outside ${outside}`);
  await fs.rm(dir, { recursive: true });
});

test('wrong credentials fall back to terrarium and are not cached as Lantmäteriet tiles', async () => {
  const { result, x, y, dir, service, calls } = await renderedHeights(13, { status: 401 });
  assert.ok(result.status === 'ok' && result.source === 'terrarium');
  await assert.rejects(fs.access(path.join(dir, 'lantmateriet', '13', String(x), `${y}.png`)));
  // next request tries Lantmäteriet again (once credentials are fixed it recovers)
  const before = calls.length;
  await service.getTile('lantmateriet', 13, x, y);
  assert.ok(calls.slice(before).some(u => u.startsWith('https://dl1.lantmateriet.se/')));
  await fs.rm(dir, { recursive: true });
});

test('tile bounds and pixel centres agree', () => {
  const [minLng, minLat, maxLng, maxLat] = tileBounds(13, 4375, 2475);
  const first = pixelLatLng(13, 4375, 2475, 0, 0);
  const last = pixelLatLng(13, 4375, 2475, 255, 255);
  assert.ok(first.lng > minLng && first.lat < maxLat && last.lng < maxLng && last.lat > minLat);
});

test('neighbouring tiles share one catalogue search, kept on disk, and rate limits are retried', async () => {
  const dir = await tmp();
  const { impl, calls } = mockFetch(COG, { stacRateLimited: 1 });
  const lm = { user: 'rider', pass: 'secret' };
  const service = createTerrainTileService(dir, { lantmateriet: lm, fetchImpl: impl });
  const [x, y] = tileAt(57.77, 12.27, 14);
  // neighbours inside the same z10 area (16 × 16 z14 tiles)
  const dx = (x & 15) < 15 ? 1 : -1;
  const dy = (y & 15) < 15 ? 1 : -1;
  const results = await Promise.all([[x, y], [x + dx, y], [x, y + dy]].map(([tx, ty]) => service.getTile('lantmateriet', 14, tx, ty)));
  assert.ok(results.every(r => r.status === 'ok' && r.source === 'lantmateriet'), 'rendered despite one 429');
  const stac = calls.filter(u => u.includes('stac-hojd'));
  assert.equal(stac.length, 2, 'one rate-limited attempt + one search for the whole area');

  // a fresh server (empty memory) reuses the search saved on disk
  const { impl: impl2, calls: calls2 } = mockFetch(COG);
  const restarted = createTerrainTileService(dir, { lantmateriet: lm, fetchImpl: impl2 });
  await restarted.getTile('lantmateriet', 14, x + dx, y + dy);
  assert.equal(calls2.filter(u => u.includes('stac-hojd')).length, 0);
  await fs.rm(dir, { recursive: true });
});

test('files whose footprint misses the tile are skipped', async () => {
  const dir = await tmp();
  const { impl, calls } = mockFetch(COG);
  const service = createTerrainTileService(dir, { lantmateriet: { user: 'rider', pass: 'secret' }, fetchImpl: impl });
  // z14 tile in the same z10 area but east of the file's footprint (lng > 12.33)
  const [x, y] = tileAt(57.77, 12.36, 14);
  const result = await service.getTile('lantmateriet', 14, x, y);
  assert.ok(result.status === 'ok' && result.source === 'terrarium');
  assert.ok(!calls.some(u => u === COG_URL), 'no download for a file that cannot cover the tile');
  await fs.rm(dir, { recursive: true });
});

test('a block download cut short is retried, and a damaged cached block is downloaded again', async () => {
  const dir = await tmp();
  const { impl } = mockFetch(COG, { truncateBlocks: 2 });
  const source: CogSource = { headers: { Authorization: AUTH }, cacheDir: dir, fetchImpl: impl };
  const info = await openCOG(COG_URL, source);
  const win = await readWindow(info, 0, 100, 100, 101, 101, source);
  assert.ok(Math.abs(win[0] - height(E0 + 100.5 * 8, N1 - 100.5 * 8)) < 1e-3, 'correct value despite truncated transfers');

  // corrupt the cached block on disk: the next read must notice and refetch
  const blockFile = path.join(dir, 'blocks', 'm640_33', '0', '0_0.bin');
  await fs.writeFile(blockFile, Buffer.from('not a deflate stream'));
  const again = await readWindow(info, 0, 100, 100, 101, 101, source);
  assert.ok(Math.abs(again[0] - win[0]) < 1e-6);
  assert.ok((await fs.readFile(blockFile)).length > 100, 'the good block replaced the damaged one');
  await fs.rm(dir, { recursive: true });
});
