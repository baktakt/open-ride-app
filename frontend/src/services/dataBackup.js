import { USER_DATA_KEYS } from './userManager.js';
import { openDB, ROUTES_STORE, RIDES_STORE, GUIDES_STORE } from './db.js';

const SHARED_KEYS = ['openride_use_emulator', 'openride_connection_type'];
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function withoutKeys(value) {
  if (Array.isArray(value)) return value.map(withoutKeys);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !['apikey', 'secret', 'ownersecret'].includes(key.toLowerCase())).map(([key, item]) => [key, withoutKeys(item)]));
}

function profileData(snapshot) {
  return Object.fromEntries(USER_DATA_KEYS.filter(key => snapshot[key] !== undefined).map(key => {
    const value = typeof snapshot[key] === 'string' ? JSON.parse(snapshot[key]) : snapshot[key];
    if (!isObject(value) && !Array.isArray(value)) throw new Error(`Invalid profile data: ${key}`);
    const arrayKey = ['openride_workout_history', 'openride_route_history', 'openride_custom_workouts'].includes(key);
    if (arrayKey !== Array.isArray(value)) throw new Error(`Invalid profile data: ${key}`);
    return [key, withoutKeys(value)];
  }));
}

export async function readBackupDatabase() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([ROUTES_STORE, RIDES_STORE, GUIDES_STORE], 'readonly');
    const routes = tx.objectStore(ROUTES_STORE).getAll();
    const rides = tx.objectStore(RIDES_STORE).getAll();
    const guides = tx.objectStore(GUIDES_STORE).getAll();
    tx.oncomplete = () => { db.close(); resolve({ routes: routes.result, rides: rides.result, guides: guides.result }); };
    tx.onabort = () => reject(tx.error || new Error('Could not read saved routes and rides.'));
    tx.onerror = () => reject(tx.error);
  });
}

async function writeBackupDatabase(records, applyLocal) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([ROUTES_STORE, RIDES_STORE, GUIDES_STORE], 'readwrite');
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = () => reject(tx.error || new Error('Backup restore was cancelled.'));
    tx.onerror = () => reject(tx.error);
    try {
      for (const [storeName, entries] of [[ROUTES_STORE, records.routes], [RIDES_STORE, records.rides], [GUIDES_STORE, records.guides || []]]) {
        const store = tx.objectStore(storeName);
        store.clear();
        for (const entry of entries) store.put(entry);
      }
      applyLocal();
    } catch (error) {
      tx.abort();
      reject(error);
    }
  });
}

/** Capture active live data and inactive snapshots without switching riders. */
export async function buildFullBackup({ storage = localStorage, readDatabase = readBackupDatabase } = {}) {
  const users = JSON.parse(storage.getItem('openride_users') || '[]');
  const activeUserId = storage.getItem('openride_active_user');
  const profiles = users.map(user => {
    const snapshot = user.id === activeUserId
      ? Object.fromEntries(USER_DATA_KEYS.map(key => [key, storage.getItem(key)]).filter(([, value]) => value !== null))
      : JSON.parse(storage.getItem(`openride_snapshot_${user.id}`) || '{}');
    return { user, data: profileData(snapshot) };
  });
  const records = await readDatabase();
  const ids = new Set(users.map(user => user.id));
  const owned = entries => entries.filter(entry => !entry.userId || ids.has(entry.userId)).map(entry => ({ ...entry, userId: entry.userId || activeUserId }));
  const payload = {
    app: 'Open Ride', version: 2, exportedAt: new Date().toISOString(), activeUserId, profiles,
    shared: Object.fromEntries(SHARED_KEYS.map(key => [key, storage.getItem(key)]).filter(([, value]) => value !== null)),
    routes: owned(records.routes), rides: owned(records.rides),
    guides: await Promise.all(owned(records.guides || []).map(async record => ({ id: record.id, userId: record.userId, guide: record.guide,
      clips: Object.fromEntries(await Promise.all(Object.entries(record.clips).map(async ([id, blob]) => {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = '';
        for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
        return [id, btoa(binary)];
      }))),
    }))),
  };
  validateFullBackup(payload);
  return withoutKeys(payload);
}

/** Validate the entire file before writing either storage system. */
export function validateFullBackup(payload) {
  if (payload?.app !== 'Open Ride' || payload.version !== 2 || !Array.isArray(payload.profiles) || !payload.profiles.length) throw new Error('Invalid all-rider backup.');
  const ids = new Set();
  for (const profile of payload.profiles) {
    const user = profile?.user;
    if (!isObject(user) || typeof user.id !== 'string' || !user.id || typeof user.name !== 'string' || ids.has(user.id) || !isObject(profile.data)) throw new Error('Invalid or duplicate rider profile.');
    ids.add(user.id);
    profileData(profile.data);
  }
  if (!ids.has(payload.activeUserId)) throw new Error('Backup active rider is missing.');
  for (const key of ['routes', 'rides']) {
    if (!Array.isArray(payload[key])) throw new Error(`Backup is missing ${key}.`);
    const seen = new Set();
    for (const entry of payload[key]) {
      if (!isObject(entry) || !['string', 'number'].includes(typeof entry.id) || seen.has(entry.id) || !ids.has(entry.userId) || !Array.isArray(entry[key === 'routes' ? 'points' : 'samples'])) throw new Error(`Invalid ownership or record in ${key}.`);
      seen.add(entry.id);
    }
  }
  if (payload.guides !== undefined) {
    if (!Array.isArray(payload.guides)) throw new Error('Invalid saved guides.');
    const seen = new Set();
    for (const record of payload.guides) {
      if (!isObject(record) || !ids.has(record.userId) || typeof record.id !== 'string' || seen.has(record.id) || !isObject(record.guide) || !Array.isArray(record.guide.stops) || !['en', 'sv'].includes(record.guide.language) || !/^[a-f0-9]{64}$/.test(record.guide.routeHash) || record.id !== `${record.userId}:${record.guide.routeHash}:${record.guide.language}` || !isObject(record.clips)) throw new Error('Invalid guide ownership or data.');
      seen.add(record.id);
      if (record.guide.version !== 1 || record.guide.stops.length < 1 || record.guide.stops.length > 16 || typeof record.guide.id !== 'string' || typeof record.guide.routeName !== 'string') throw new Error('Invalid guide manifest.');
      const stops = new Set();
      for (const stop of record.guide.stops) {
        if (!isObject(stop) || typeof stop.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(stop.id) || stops.has(stop.id) || typeof stop.text !== 'string' || stop.text.length > 650 || typeof stop.title !== 'string' || !Number.isFinite(stop.distanceKm) || stop.distanceKm < 0 || !Number.isFinite(stop.lat) || Math.abs(stop.lat) > 90 || !Number.isFinite(stop.lng) || Math.abs(stop.lng) > 180 || !Array.isArray(stop.sources) || !stop.sources.length || stop.sources.some(source => !isObject(source) || typeof source.title !== 'string' || !/^https:\/\/[a-z0-9.-]+\/[^\s]*$/i.test(source.url))) throw new Error('Invalid saved guide story.');
        stops.add(stop.id);
      }
      if (Object.keys(record.clips).some(id => !stops.has(id))) throw new Error('Unexpected guide audio.');
      for (const audio of Object.values(record.clips)) if (typeof audio !== 'string' || audio.length > 4194304 || !/^[A-Za-z0-9+/]*={0,2}$/.test(audio) || audio.length % 4) throw new Error('Invalid saved guide audio.');
    }
  }
  if (payload.shared !== undefined && !isObject(payload.shared)) throw new Error('Invalid shared settings.');
  for (const key of SHARED_KEYS) {
    if (payload.shared?.[key] !== undefined && typeof payload.shared[key] !== 'string') throw new Error('Invalid shared setting value.');
  }
}

/** Replace all riders and their records, restoring localStorage on write failure. */
export async function restoreFullBackup(payload, { storage = localStorage, writeDatabase = writeBackupDatabase } = {}) {
  validateFullBackup(payload);
  const backup = withoutKeys(payload);
  const previous = new Map();
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (USER_DATA_KEYS.includes(key) || SHARED_KEYS.includes(key) || key === 'openride_users' || key === 'openride_active_user' || key.startsWith('openride_snapshot_')) previous.set(key, storage.getItem(key));
  }
  const touched = new Set(previous.keys());
  const put = (key, value) => { touched.add(key); storage.setItem(key, value); };
  try {
    await writeDatabase({ routes: backup.routes, rides: backup.rides, guides: (backup.guides || []).map(record => ({ ...record, cloud: null, clips: Object.fromEntries(Object.entries(record.clips).map(([id, base64]) => [id, new Blob([Uint8Array.from(atob(base64), char => char.charCodeAt(0))], { type: 'audio/wav' })])) })) }, () => {
      previous.forEach((_, key) => storage.removeItem(key));
      put('openride_users', JSON.stringify(backup.profiles.map(profile => profile.user)));
      put('openride_active_user', backup.activeUserId);
      for (const profile of backup.profiles) {
        const data = profileData(profile.data);
        const snapshot = Object.fromEntries(Object.entries(data).map(([key, value]) => [key, JSON.stringify(value)]));
        put(`openride_snapshot_${profile.user.id}`, JSON.stringify(snapshot));
        if (profile.user.id === backup.activeUserId) Object.entries(snapshot).forEach(([key, value]) => put(key, value));
      }
      for (const key of SHARED_KEYS) if (backup.shared?.[key] !== undefined) put(key, backup.shared[key]);
    });
  } catch (error) {
    touched.forEach(key => storage.removeItem(key));
    previous.forEach((value, key) => storage.setItem(key, value));
    throw error;
  }
  return { imported: ['All rider profiles', 'Settings, workouts, history and training programs', 'GPX routes', 'Ride recordings', 'Downloaded route narration'], skipped: [], warnings: ['Optional AI workout keys were not restored. Reload the page before continuing.'] };
}
