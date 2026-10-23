import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createTerrainTileService, validateTile, listProviders } from '../src/terrainTiles.js';

const terrarium = { id: 'terrarium', name: 't', maxZoom: 14, attribution: '', tileUrl: () => '' };

test('tile coordinates are validated', () => {
  assert.equal(validateTile(terrarium, 12, 2253, 1150), null);
  assert.match(validateTile(terrarium, 15, 0, 0) ?? '', /Zoom/);
  assert.match(validateTile(terrarium, 2, 4, 0) ?? '', /out of range/);
  assert.match(validateTile(terrarium, 2, 0, -1) ?? '', /out of range/);
  assert.match(validateTile(terrarium, 1.5, 0, 0) ?? '', /integers/);
  assert.match(validateTile(undefined, 1, 0, 0) ?? '', /Unknown/);
});

test('providers are listed without their upstream URLs', () => {
  const providers = listProviders();
  assert.ok(providers.some(p => p.id === 'terrarium'));
  assert.ok(providers.every(p => !('tileUrl' in p)));
});

test('cached tiles are served from disk without contacting the provider', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'openride-terrain-'));
  const file = path.join(dir, 'terrarium', '10', '5', '7.png');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, Buffer.from('cached-tile'));

  const service = createTerrainTileService(dir);
  const result = await service.getTile('terrarium', 10, 5, 7);
  assert.equal(result.status, 'ok');
  assert.ok(result.status === 'ok' && result.cached && result.body.toString() === 'cached-tile');
  await fs.rm(dir, { recursive: true });
});

test('invalid requests are rejected before any lookup', async () => {
  const service = createTerrainTileService(os.tmpdir());
  assert.equal((await service.getTile('nope', 1, 0, 0)).status, 'invalid');
  assert.equal((await service.getTile('terrarium', 20, 0, 0)).status, 'invalid');
});
