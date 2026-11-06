import { openDB, GUIDES_STORE } from './db.js';
import { getActiveUserId } from './userManager.js';

const key = (hash, language) => `${getActiveUserId()}:${hash}:${language}`;

export async function savePreparedGuide(guide, clips = {}, cloud = null) {
  const db = await openDB();
  const record = { id: key(guide.routeHash, guide.language), userId: getActiveUserId(), guide, clips, cloud };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(GUIDES_STORE, 'readwrite');
    tx.objectStore(GUIDES_STORE).put(record);
    tx.oncomplete = () => { db.close(); resolve(record); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function loadPreparedGuide(hash, language) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(GUIDES_STORE, 'readonly');
    const request = tx.objectStore(GUIDES_STORE).get(key(hash, language));
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}
