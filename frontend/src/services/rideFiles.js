/**
 * Ride files — IndexedDB storage for per-second ride recordings, used to
 * export rides as FIT / TCX after the fact.
 *
 * Stored ride schema:
 *   { id, userId, type: 'workout'|'route', name, startTime (ISO),
 *     ftp, summary, samples: [{ t, timestamp, power, cadence, heartRate,
 *     speed, distance, targetPower?, lat?, lng?, altitude?, routeDistance? }] }
 *
 * The id matches the ride's entry in the localStorage history
 * (openride_workout_history / openride_route_history). Ids are Date.now()
 * values, so they sort chronologically.
 */

import { getActiveUserId } from './userManager';
import { openDB, RIDES_STORE, RIDES_BY_USER_INDEX } from './db';

// Oldest recordings beyond this many per user are pruned on save
// (about 250 KB per hour of riding).
export const MAX_RIDE_FILES_PER_USER = 100;

function requestToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

/** Ids of the active user's recordings, newest first (keys only — no samples loaded). */
async function userRideIds(db) {
  const ids = await requestToPromise(
    db.transaction(RIDES_STORE, 'readonly')
      .objectStore(RIDES_STORE)
      .index(RIDES_BY_USER_INDEX)
      .getAllKeys(getActiveUserId())
  );
  return ids.sort((a, b) => b - a);
}

/**
 * Store a ride recording and prune the user's oldest recordings.
 * Returns the stored entry.
 */
export async function saveRideFile(ride) {
  const db = await openDB();
  const entry = { ...ride, userId: getActiveUserId() };
  const others = (await userRideIds(db)).filter(id => id !== entry.id);
  const prune = others.slice(MAX_RIDE_FILES_PER_USER - 1);

  return new Promise((resolve, reject) => {
    const tx    = db.transaction(RIDES_STORE, 'readwrite');
    const store = tx.objectStore(RIDES_STORE);
    store.put(entry);
    for (const id of prune) store.delete(id);
    tx.oncomplete = () => resolve(entry);
    tx.onerror    = (e) => reject(e.target.error);
  });
}

/** Load a single ride recording, or null. */
export async function loadRideFile(id) {
  const db = await openDB();
  const ride = await requestToPromise(
    db.transaction(RIDES_STORE, 'readonly').objectStore(RIDES_STORE).get(id)
  );
  return ride || null;
}

/** Ids of all recordings belonging to the active user. */
export async function listRideFileIds() {
  const db = await openDB();
  return new Set(await userRideIds(db));
}

/** Delete recordings by id (e.g. when the matching history is cleared). */
export async function deleteRideFiles(ids) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(RIDES_STORE, 'readwrite');
    const store = tx.objectStore(RIDES_STORE);
    for (const id of ids) store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror    = (e) => reject(e.target.error);
  });
}
