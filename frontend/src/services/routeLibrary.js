/**
 * Route Library — IndexedDB storage for multiple GPX routes.
 *
 * Stored route schema:
 *   { id, name, points, totalDistance, elevationGain, minEle, maxEle, createdAt, userId }
 *
 * IndexedDB is used instead of localStorage because parsed GPX route arrays
 * can be several hundred KB each, and users may store many routes.
 */

import { getActiveUserId } from './userManager';
import { openDB, ROUTES_STORE as STORE_NAME } from './db';

/**
 * Save (or overwrite) a route in the library.
 * If entry.id is omitted a new unique id is generated.
 * Returns the stored entry.
 */
export async function saveRoute({ id, name, points, totalDistance, elevationGain, minEle, maxEle }) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const entry = {
      id:            id || `route-${Date.now()}`,
      name:          name || 'Unnamed route',
      points,
      totalDistance,
      elevationGain,
      minEle,
      maxEle,
      createdAt:     new Date().toISOString(),
      userId:        getActiveUserId(),
    };
    store.put(entry);
    tx.oncomplete = () => resolve(entry);
    tx.onerror    = (e) => reject(e.target.error);
  });
}

/**
 * Return all saved routes sorted newest-first.
 * Points arrays are included (full objects).
 */
export async function loadAllRoutes() {
  const db     = await openDB();
  const userId = getActiveUserId();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req   = store.getAll();
    req.onsuccess = () => {
      const all = req.result || [];
      // Include routes that belong to this user, or routes with no userId
      // (legacy routes created before multi-profile support).
      const filtered = all.filter(r => !r.userId || r.userId === userId);
      const sorted   = filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      resolve(sorted);
    };
    req.onerror = (e) => reject(e.target.error);
  });
}

/**
 * Load a single route by id. Returns null if not found.
 */
export async function loadRoute(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req   = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror   = (e) => reject(e.target.error);
  });
}

/**
 * Delete a route by id.
 */
export async function deleteRoute(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror    = (e) => reject(e.target.error);
  });
}

/**
 * Rename a route in-place.
 */
export async function renameRoute(id, newName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req   = store.get(id);
    req.onsuccess = () => {
      const entry = req.result;
      if (!entry) { reject(new Error('Route not found')); return; }
      entry.name = newName;
      store.put(entry);
      tx.oncomplete = () => resolve(entry);
    };
    req.onerror = (e) => reject(e.target.error);
  });
}
