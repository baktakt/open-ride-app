import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFullBackup, restoreFullBackup } from '../src/services/dataBackup.js';
import { applyImport } from '../src/services/dataManager.js';
import { switchUser } from '../src/services/userManager.js';

class MemoryStorage {
  values = new Map();
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index]; }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

function fixture() {
  const storage = new MemoryStorage();
  storage.setItem('openride_users', JSON.stringify([{ id: 'a', name: 'Alice' }, { id: 'b', name: 'Bob' }]));
  storage.setItem('openride_active_user', 'a');
  storage.setItem('openride_settings', JSON.stringify({ ftp: 250, apiKey: 'secret-active' }));
  storage.setItem('openride_custom_workouts', JSON.stringify([{ id: 'alice-workout', xml: '<workout/>' }]));
  storage.setItem('openride_snapshot_a', JSON.stringify({ openride_settings: JSON.stringify({ ftp: 100 }) }));
  storage.setItem('openride_snapshot_b', JSON.stringify({ openride_settings: JSON.stringify({ ftp: 180, apiKey: 'secret-inactive' }), openride_custom_workouts: JSON.stringify([{ id: 'bob-workout' }]) }));
  storage.setItem('openride_ai_settings', JSON.stringify({ apiKey: 'secret-global' }));
  storage.setItem('openride_use_emulator', 'true');
  const records = { routes: [{ id: 'route-a', userId: 'a', points: [] }, { id: 'route-b', userId: 'b', points: [] }], rides: [{ id: 123, userId: 'b', samples: [{ power: 200 }] }] };
  return { storage, records };
}

test('exports all riders with fresh active data, owned routes and recordings, without API keys', async () => {
  const { storage, records } = fixture();
  const payload = await buildFullBackup({ storage, readDatabase: async () => records });
  assert.equal(payload.profiles[0].data.openride_settings.ftp, 250);
  assert.equal(payload.profiles[1].data.openride_settings.ftp, 180);
  assert.equal(payload.profiles[1].data.openride_custom_workouts[0].id, 'bob-workout');
  assert.deepEqual(payload.routes, records.routes);
  assert.deepEqual(payload.rides, records.rides);
  assert.ok(!JSON.stringify(payload).includes('secret'));
  assert.equal(storage.getItem('openride_active_user'), 'a');
});

test('round trip restores every rider and preserves ownership when switching profiles', async () => {
  const { storage, records } = fixture();
  const payload = await buildFullBackup({ storage, readDatabase: async () => records });
  const destination = new MemoryStorage();
  destination.setItem('openride_snapshot_old', '{}');
  destination.setItem('openride_ai_settings', '{"apiKey":"keep-local"}');
  let restored;
  await restoreFullBackup(payload, { storage: destination, writeDatabase: async (data, applyLocal) => { restored = data; applyLocal(); } });
  assert.equal(destination.getItem('openride_snapshot_old'), null);
  assert.equal(destination.getItem('openride_use_emulator'), 'true');
  assert.equal(destination.getItem('openride_ai_settings'), '{"apiKey":"keep-local"}');
  globalThis.localStorage = destination;
  switchUser('b');
  assert.equal(JSON.parse(destination.getItem('openride_settings')).ftp, 180);
  assert.equal(JSON.parse(destination.getItem('openride_custom_workouts'))[0].id, 'bob-workout');
  assert.equal(restored.routes.filter(route => route.userId === 'b')[0].id, 'route-b');
  assert.equal(restored.rides[0].userId, 'b');
  switchUser('a');
  assert.equal(JSON.parse(destination.getItem('openride_settings')).ftp, 250);
});

test('invalid owner or duplicate profile is rejected before any writes', async () => {
  const { storage, records } = fixture();
  const payload = await buildFullBackup({ storage, readDatabase: async () => records });
  let writes = 0;
  const options = { storage, writeDatabase: async () => { writes++; } };
  payload.routes[0].userId = 'missing';
  await assert.rejects(restoreFullBackup(payload, options), /ownership/);
  payload.routes[0].userId = 'a';
  payload.profiles.push(payload.profiles[0]);
  await assert.rejects(restoreFullBackup(payload, options), /duplicate/);
  assert.equal(writes, 0);
});

test('failed database transaction restores previous local profile data', async () => {
  const { storage, records } = fixture();
  const payload = await buildFullBackup({ storage, readDatabase: async () => records });
  const before = [...storage.values];
  await assert.rejects(restoreFullBackup(payload, { storage, writeDatabase: async (_, applyLocal) => { applyLocal(); throw new Error('disk full'); } }), /disk full/);
  assert.deepEqual(Object.fromEntries(storage.values), Object.fromEntries(before));
});

test('legacy backup still restores current rider without replacing the rider list', async () => {
  const { storage } = fixture();
  globalThis.localStorage = storage;
  const users = storage.getItem('openride_users');
  await applyImport({ app: 'Open Ride', version: 1, data: { openride_custom_workouts: [{ id: 'legacy' }] } });
  assert.equal(storage.getItem('openride_users'), users);
  assert.equal(JSON.parse(storage.getItem('openride_custom_workouts'))[0].id, 'legacy');
  await assert.rejects(applyImport({ version: 99, data: {} }), /Unsupported/);
});

test('prepared guides round trip with audio and ownership but exclude private cloud keys', async () => {
  const { storage, records } = fixture();
  const hash = 'a'.repeat(64);
  const stopId = '11111111-1111-4111-8111-111111111111';
  records.guides = [{ id: `a:${hash}:en`, userId: 'a', cloud: { secret: 'private-access' }, guide: { version: 1, id: 'guide', routeName: 'Ride', routeHash: hash, language: 'en', stops: [{ id: stopId, title: 'Bridge', text: 'A historic bridge.', distanceKm: 1, lat: 0, lng: 0, sources: [{ title: 'Bridge', url: 'https://en.wikipedia.org/?curid=1' }] }] }, clips: { [stopId]: new Blob(['saved-audio']) } }];
  const payload = await buildFullBackup({ storage, readDatabase: async () => records });
  assert.ok(!JSON.stringify(payload).includes('private-access'));
  let restored;
  await restoreFullBackup(payload, { storage, writeDatabase: async (data, applyLocal) => { restored = data; applyLocal(); } });
  assert.equal(await restored.guides[0].clips[stopId].text(), 'saved-audio');
  assert.equal(restored.guides[0].userId, 'a');
  const invalid = structuredClone(payload); invalid.guides[0].userId = 'missing-profile';
  await assert.rejects(restoreFullBackup(invalid), /ownership/);
});

test('public route backups do not export publishing credentials', async () => {
  const { storage, records } = fixture();
  records.routes[0].publication = { id: 'public-id', secret: 'owner-secret', publishedAt: '2026-11-05' };
  const payload = await buildFullBackup({ storage, readDatabase: async () => records });
  assert.equal(payload.routes[0].publication.id, 'public-id');
  assert.equal(payload.routes[0].publication.secret, undefined);
});
