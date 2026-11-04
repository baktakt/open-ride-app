import { USER_DATA_KEYS } from './userManager.js';
import { openDB, ROUTES_STORE, RIDES_STORE } from './db.js';

const SHARED_KEYS = ['openride_use_emulator', 'openride_connection_type'];
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function withoutKeys(value) {
  if (Array.isArray(value)) return value.map(withoutKeys);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key.toLowerCase() !== 'apikey').map(([key, item]) => [key, withoutKeys(item)]));
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
    const tx = db.transaction([ROUTES_STORE, RIDES_STORE], 'readonly');
    const routes = tx.objectStore(ROUTES_STORE).getAll();
    const rides = tx.objectStore(RIDES_STORE).getAll();
    tx.oncomplete = () => resolve({ routes: routes.result, rides: rides.result });
    tx.onabort = () => reject(tx.error || new Error('Could not read saved routes and rides.'));
    tx.onerror = () => reject(tx.error);
  });
}

async function writeBackupDatabase(records, applyLocal) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([ROUTES_STORE, RIDES_STORE], 'readwrite');
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error || new Error('Backup restore was cancelled.'));
    tx.onerror = () => reject(tx.error);
    try {
      for (const [storeName, entries] of [[ROUTES_STORE, records.routes], [RIDES_STORE, records.rides]]) {
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
    await writeDatabase({ routes: backup.routes, rides: backup.rides }, () => {
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
  return { imported: ['All rider profiles', 'Settings, workouts, history and training programs', 'GPX routes', 'Ride recordings'], skipped: [], warnings: ['API keys were not restored. Reload the page before continuing.'] };
}
