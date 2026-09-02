/** IndexedDB cache for the generated heightmap, keyed by (seed, geographyVersion). */
const DB_NAME = 'eidgenossen-world-cache';
const STORE = 'heightmaps';

export interface CachedGrid { width: number; height: number; heights: Float32Array; surface: Uint8Array }

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') { resolve(null); return; }
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function keyFor(seed: number, version: number): string {
  return `${seed}:${version}`;
}

export async function loadCachedGrid(seed: number, version: number): Promise<CachedGrid | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(keyFor(seed, version));
      req.onsuccess = () => {
        const v = req.result;
        if (!v) { resolve(null); return; }
        resolve({ width: v.width, height: v.height, heights: new Float32Array(v.heights), surface: new Uint8Array(v.surface) });
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function saveCachedGrid(seed: number, version: number, grid: CachedGrid): Promise<void> {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(
        { width: grid.width, height: grid.height, heights: grid.heights.buffer, surface: grid.surface.buffer },
        keyFor(seed, version),
      );
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}
