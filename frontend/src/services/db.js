/**
 * Shared IndexedDB connection for Open Ride.
 *
 * Every module that uses the 'openride' database must open it through here so
 * that all stores and migrations live in one upgrade handler — opening the
 * same database with different versions from different modules fails.
 *
 * Stores:
 *   routes — saved GPX routes            (routeLibrary.js)
 *   rides  — per-second ride recordings  (rideFiles.js)
 */

import { getActiveUserId } from './userManager';

const DB_NAME    = 'openride';
const DB_VERSION = 3;

export const ROUTES_STORE = 'routes';
export const RIDES_STORE  = 'rides';
export const RIDES_BY_USER_INDEX = 'userId';

export function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(ROUTES_STORE)) {
        db.createObjectStore(ROUTES_STORE, { keyPath: 'id' });
      }

      // v1 → v2: stamp existing routes with the current active user so they
      // continue to show up for the initial user after the upgrade.
      if (e.oldVersion < 2) {
        const userId = getActiveUserId();
        if (userId) {
          const tx    = e.target.transaction;
          const store = tx.objectStore(ROUTES_STORE);
          const getAllReq = store.getAll();
          getAllReq.onsuccess = () => {
            for (const route of getAllReq.result || []) {
              if (!route.userId) {
                route.userId = userId;
                store.put(route);
              }
            }
          };
        }
      }

      // v2 → v3: ride recordings
      if (!db.objectStoreNames.contains(RIDES_STORE)) {
        const rides = db.createObjectStore(RIDES_STORE, { keyPath: 'id' });
        rides.createIndex(RIDES_BY_USER_INDEX, 'userId');
      }
    };

    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}
