/**
 * Storage layer. ARCHITECTURE.md §3.4, §5.7.
 * - `SaveStore` is the storage abstraction; `IndexedDbStore` / `LocalStorageStore` / `MemoryStore` implement it.
 * - `encodeSave`/`decodeSave` turn a `SaveFile` into bytes: JSON → UTF-8 → gzip (`CompressionStream`) when
 *   available, else raw, with a 1-byte header (0 = raw, 1 = gzip) so `decodeSave` can tell them apart.
 */
import type { SaveFile, SaveMeta } from '@core/schemas';
import { SAVE_MAX_BYTES } from '@core/schemas';
import type { SerializedWorld } from '@core/ecs';
import { calendarFromGameTime } from '@core/clock';

export interface SaveStore {
  get(slot: number): Promise<Uint8Array | null>;
  /** Reads just one slot's `SaveMeta` — cheaper than `list()` (which fetches every slot's bytes too)
   * when only the metadata for one known slot is needed, e.g. `existingCreatedAt`. */
  getMeta(slot: number): Promise<SaveMeta | null>;
  put(slot: number, bytes: Uint8Array, meta: SaveMeta): Promise<void>;
  delete(slot: number): Promise<void>;
  list(): Promise<SaveMeta[]>;
}

function byUpdatedAtDesc(a: SaveMeta, b: SaveMeta): number {
  return b.updatedAt.localeCompare(a.updatedAt);
}

// ---------------- IndexedDB ----------------

const DB_NAME = 'eidgenossen';
const STORE_NAME = 'saves';
const DB_VERSION = 1;

interface Row {
  slot: number;
  meta: SaveMeta;
  bytes: Uint8Array;
}

export class IndexedDbStore implements SaveStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        let req: IDBOpenDBRequest;
        try {
          req = indexedDB.open(DB_NAME, DB_VERSION);
        } catch (err) {
          reject(err);
          return;
        }
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'slot' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
        req.onblocked = () => reject(new Error('IndexedDB open blocked'));
      });
    }
    return this.dbPromise;
  }

  private async tx(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    const db = await this.open();
    return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
  }

  async get(slot: number): Promise<Uint8Array | null> {
    const store = await this.tx('readonly');
    return new Promise((resolve, reject) => {
      const req = store.get(slot);
      req.onsuccess = () => resolve(req.result ? (req.result as Row).bytes : null);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB get failed'));
    });
  }

  async getMeta(slot: number): Promise<SaveMeta | null> {
    const store = await this.tx('readonly');
    return new Promise((resolve, reject) => {
      const req = store.get(slot);
      req.onsuccess = () => resolve(req.result ? (req.result as Row).meta : null);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB get failed'));
    });
  }

  async put(slot: number, bytes: Uint8Array, meta: SaveMeta): Promise<void> {
    const store = await this.tx('readwrite');
    return new Promise((resolve, reject) => {
      const row: Row = { slot, meta, bytes };
      const req = store.put(row);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error ?? new Error('IndexedDB put failed'));
    });
  }

  async delete(slot: number): Promise<void> {
    const store = await this.tx('readwrite');
    return new Promise((resolve, reject) => {
      const req = store.delete(slot);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error ?? new Error('IndexedDB delete failed'));
    });
  }

  async list(): Promise<SaveMeta[]> {
    const store = await this.tx('readonly');
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result as Row[]).map((r) => r.meta).sort(byUpdatedAtDesc));
      req.onerror = () => reject(req.error ?? new Error('IndexedDB getAll failed'));
    });
  }
}

// ---------------- In-memory (tests, and a fallback if IndexedDB throws) ----------------

export class MemoryStore implements SaveStore {
  private rows = new Map<number, Row>();

  async get(slot: number): Promise<Uint8Array | null> {
    return this.rows.get(slot)?.bytes ?? null;
  }
  async getMeta(slot: number): Promise<SaveMeta | null> {
    return this.rows.get(slot)?.meta ?? null;
  }
  async put(slot: number, bytes: Uint8Array, meta: SaveMeta): Promise<void> {
    this.rows.set(slot, { slot, meta, bytes });
  }
  async delete(slot: number): Promise<void> {
    this.rows.delete(slot);
  }
  async list(): Promise<SaveMeta[]> {
    return [...this.rows.values()].map((r) => r.meta).sort(byUpdatedAtDesc);
  }
}

// ---------------- localStorage (base64) fallback ----------------

export class LocalStorageStore implements SaveStore {
  private prefix = 'eidgenossen:save:';
  private indexKey = 'eidgenossen:save-index';

  private index(): number[] {
    try {
      const raw = localStorage.getItem(this.indexKey);
      return raw ? (JSON.parse(raw) as number[]) : [];
    } catch {
      return [];
    }
  }
  private setIndex(slots: number[]): void {
    localStorage.setItem(this.indexKey, JSON.stringify(slots));
  }

  async get(slot: number): Promise<Uint8Array | null> {
    const raw = localStorage.getItem(this.prefix + slot);
    if (!raw) return null;
    const { bytesBase64 } = JSON.parse(raw) as { bytesBase64: string };
    return base64ToBytes(bytesBase64);
  }

  async getMeta(slot: number): Promise<SaveMeta | null> {
    const raw = localStorage.getItem(this.prefix + slot);
    if (!raw) return null;
    const { meta } = JSON.parse(raw) as { meta: SaveMeta };
    return meta;
  }

  async put(slot: number, bytes: Uint8Array, meta: SaveMeta): Promise<void> {
    localStorage.setItem(this.prefix + slot, JSON.stringify({ meta, bytesBase64: bytesToBase64(bytes) }));
    const idx = this.index();
    if (!idx.includes(slot)) {
      idx.push(slot);
      this.setIndex(idx);
    }
  }

  async delete(slot: number): Promise<void> {
    localStorage.removeItem(this.prefix + slot);
    this.setIndex(this.index().filter((s) => s !== slot));
  }

  async list(): Promise<SaveMeta[]> {
    const metas: SaveMeta[] = [];
    for (const slot of this.index()) {
      const raw = localStorage.getItem(this.prefix + slot);
      if (!raw) continue;
      const { meta } = JSON.parse(raw) as { meta: SaveMeta };
      metas.push(meta);
    }
    return metas.sort(byUpdatedAtDesc);
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ---------------- Automatic store selection ----------------

/** Falls back to `fallback` (and stays there) the first time `primary` throws — e.g. IndexedDB in private mode. */
export class ResilientStore implements SaveStore {
  private useFallback = false;
  constructor(private primary: SaveStore, private fallback: SaveStore, private fallbackName: string) {}

  private async run<T>(fn: (s: SaveStore) => Promise<T>): Promise<T> {
    if (this.useFallback) return fn(this.fallback);
    try {
      return await fn(this.primary);
    } catch (err) {
      this.useFallback = true;
      console.info(`[save] IndexedDB failed (${err instanceof Error ? err.message : String(err)}); falling back to ${this.fallbackName}`);
      return fn(this.fallback);
    }
  }

  get(slot: number): Promise<Uint8Array | null> { return this.run((s) => s.get(slot)); }
  getMeta(slot: number): Promise<SaveMeta | null> { return this.run((s) => s.getMeta(slot)); }
  put(slot: number, bytes: Uint8Array, meta: SaveMeta): Promise<void> { return this.run((s) => s.put(slot, bytes, meta)); }
  delete(slot: number): Promise<void> { return this.run((s) => s.delete(slot)); }
  list(): Promise<SaveMeta[]> { return this.run((s) => s.list()); }
}

let loggedStoreKind = false;
function logStoreOnce(kind: string, extra?: string): void {
  if (loggedStoreKind) return;
  loggedStoreKind = true;
  console.info(`[save] using ${kind} storage${extra ? ` (${extra})` : ''}`);
}

/** Picks IndexedDB when available (falling back to localStorage/memory if it throws), else localStorage, else memory. */
export function createSaveStore(): SaveStore {
  const hasIndexedDb = typeof indexedDB !== 'undefined';
  const hasLocalStorage = typeof localStorage !== 'undefined';
  if (hasIndexedDb) {
    logStoreOnce('IndexedDB');
    const fallback: SaveStore = hasLocalStorage ? new LocalStorageStore() : new MemoryStore();
    return new ResilientStore(new IndexedDbStore(), fallback, hasLocalStorage ? 'localStorage' : 'in-memory');
  }
  if (hasLocalStorage) {
    logStoreOnce('localStorage', 'IndexedDB unavailable');
    return new LocalStorageStore();
  }
  logStoreOnce('in-memory', 'no persistent storage available');
  return new MemoryStore();
}

// ---------------- Serialize / compress ----------------

export const ENCODING_RAW = 0;
export const ENCODING_GZIP = 1;

export function hasCompressionStream(): boolean {
  return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
}

// Note: writer.write()/close() reject independently of the readable side failing (e.g. malformed
// gzip input); an un-awaited rejection there surfaces as a Node unhandledRejection even though the
// real error is already reported (and handled) via the `Response(...).arrayBuffer()` read below.
// Swallow those secondary rejections here — the caller sees the error exactly once.
function swallow(p: Promise<unknown>): void {
  p.catch(() => {});
}

async function gzip(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  swallow(writer.write(data as BufferSource));
  swallow(writer.close());
  const buf = await new Response(cs.readable).arrayBuffer();
  return new Uint8Array(buf);
}

async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  swallow(writer.write(data as BufferSource));
  swallow(writer.close());
  const buf = await new Response(ds.readable).arrayBuffer();
  return new Uint8Array(buf);
}

/** Logs the 5 largest component types by encoded byte size, to help diagnose an over-budget save. */
function logLargestComponents(world: SerializedWorld): void {
  const sizes = new Map<string, number>();
  const enc = new TextEncoder();
  for (const e of world.entities) {
    for (const [type, data] of Object.entries(e.components)) {
      sizes.set(type, (sizes.get(type) ?? 0) + enc.encode(JSON.stringify(data)).length);
    }
  }
  const top = [...sizes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  console.error('[save] save file exceeds the size budget; largest component types by byte size:');
  for (const [type, bytes] of top) console.error(`  ${type}: ${bytes.toLocaleString()} bytes`);
}

/** SaveFile -> JSON -> UTF-8 -> gzip (when available) -> [1-byte header][body]. Throws if over SAVE_MAX_BYTES. */
export async function encodeSave(save: SaveFile): Promise<Uint8Array> {
  const json = JSON.stringify(save);
  const utf8 = new TextEncoder().encode(json);
  let header: number;
  let body: Uint8Array;
  if (hasCompressionStream()) {
    header = ENCODING_GZIP;
    body = await gzip(utf8);
  } else {
    header = ENCODING_RAW;
    body = utf8;
  }
  const out = new Uint8Array(body.length + 1);
  out[0] = header;
  out.set(body, 1);
  if (out.byteLength > SAVE_MAX_BYTES) {
    logLargestComponents(save.world);
    throw new Error(
      `Save exceeds the ${(SAVE_MAX_BYTES / 1024 / 1024).toFixed(1)} MB budget ` +
      `(${out.byteLength.toLocaleString()} bytes, ${header === ENCODING_GZIP ? 'gzip' : 'raw'} encoding). ` +
      'See console for the largest component types.',
    );
  }
  return out;
}

/** Inverse of `encodeSave`. Throws a clear error on empty/corrupt/oversized-header bytes or invalid JSON. */
export async function decodeSave(bytes: Uint8Array): Promise<SaveFile> {
  if (!bytes || bytes.length < 1) throw new Error('Corrupt save: no data');
  const header = bytes[0];
  const body = bytes.subarray(1);
  let utf8: Uint8Array;
  if (header === ENCODING_GZIP) {
    try {
      utf8 = await gunzip(body);
    } catch (err) {
      throw new Error(`Corrupt save: gzip decompression failed (${err instanceof Error ? err.message : String(err)})`);
    }
  } else if (header === ENCODING_RAW) {
    utf8 = body;
  } else {
    throw new Error(`Corrupt save: unknown encoding byte ${header}`);
  }
  const json = new TextDecoder().decode(utf8);
  try {
    return JSON.parse(json) as SaveFile;
  } catch (err) {
    throw new Error(`Corrupt save: invalid JSON (${err instanceof Error ? err.message : String(err)})`);
  }
}

/** Derives `SaveMeta` from a `SaveFile`. The calendar label always comes from `save.gameTime` (via
 * `calendarFromGameTime`), never from a live clock — that keeps `importJson()`'s meta honest about
 * the *save's* date instead of showing whatever date the current playthrough happens to be at. */
export function metaFromSave(save: SaveFile, bytes: number): SaveMeta {
  return {
    slot: save.slot,
    label: save.label,
    createdAt: save.createdAt,
    updatedAt: save.updatedAt,
    chapter: save.chapter,
    calendar: calendarFromGameTime(save.gameTime).label,
    location: save.location,
    playtimeSec: save.playtimeSec,
    thumbnailDataUrl: save.thumbnailDataUrl,
    schemaVersion: save.schemaVersion,
    bytes,
  };
}

/** Structural sanity check run after `decodeSave`+`migrateToCurrent` (on load, and on `importJson`
 * for arbitrary pasted-in files) — catches shapes that parse as JSON but aren't a real save. */
export function assertSaveShape(save: unknown): asserts save is SaveFile {
  if (!save || typeof save !== 'object') throw new Error('Invalid save: not an object');
  const s = save as Record<string, unknown>;
  if (typeof s.schemaVersion !== 'number') throw new Error('Invalid save: missing numeric schemaVersion');
  if (typeof s.seed !== 'number') throw new Error('Invalid save: missing numeric seed');
  if (typeof s.gameTime !== 'number') throw new Error('Invalid save: missing numeric gameTime');
  const world = s.world as { entities?: unknown } | undefined;
  if (!world || !Array.isArray(world.entities)) throw new Error('Invalid save: world.entities is not an array');
  const rngState = s.rngState as { world?: unknown } | undefined;
  if (!rngState || !Array.isArray(rngState.world)) throw new Error('Invalid save: rngState.world is not an array');
  // core fields and per-entity shape, so a pasted file fails at import rather than inside a later load
  if (typeof s.chapter !== 'string') throw new Error('Invalid save: missing chapter');
  if (typeof s.playerId !== 'number') throw new Error('Invalid save: missing numeric playerId');
  if (!Array.isArray(s.party)) throw new Error('Invalid save: party is not an array');
  if (!s.quests || typeof s.quests !== 'object') throw new Error('Invalid save: quests is not an object');
  // Optional-shape checks (tolerant: absent optionals pass; present-but-malformed rejects).
  if (s.discovered !== undefined && !Array.isArray(s.discovered)) throw new Error('Invalid save: discovered is not an array');
  if (s.flags !== undefined && (typeof s.flags !== 'object' || s.flags === null || Array.isArray(s.flags))) {
    throw new Error('Invalid save: flags is not an object');
  }
  if (s.journal !== undefined && !Array.isArray(s.journal)) throw new Error('Invalid save: journal is not an array');
  if (
    s.playtimeSec !== undefined &&
    (typeof s.playtimeSec !== 'number' || !Number.isFinite(s.playtimeSec) || s.playtimeSec < 0)
  ) {
    throw new Error('Invalid save: playtimeSec must be a finite number >= 0');
  }
  // Current schema stores location as a display string; accept that, plus a coordinate
  // object { x, z } or null for forward-tolerance — anything else is malformed.
  if (s.location !== undefined && s.location !== null) {
    const loc = s.location;
    if (typeof loc === 'string') {
      // ok: current SaveFile.location
    } else if (typeof loc === 'object' && !Array.isArray(loc)) {
      const o = loc as Record<string, unknown>;
      if (typeof o.x !== 'number' || !Number.isFinite(o.x) || typeof o.z !== 'number' || !Number.isFinite(o.z)) {
        throw new Error('Invalid save: location object must have finite x/z');
      }
    } else {
      throw new Error('Invalid save: location must be a string, an object with finite x/z, or null');
    }
  }
  if (s.weather !== undefined && typeof s.weather !== 'string') throw new Error('Invalid save: weather must be a string when present');
  if (s.season !== undefined && typeof s.season !== 'string') throw new Error('Invalid save: season must be a string when present');
  if (s.difficulty !== undefined && typeof s.difficulty !== 'string') {
    throw new Error('Invalid save: difficulty must be a string when present');
  }
  if (s.thumbnailDataUrl !== undefined && typeof s.thumbnailDataUrl !== 'string') {
    throw new Error('Invalid save: thumbnailDataUrl must be a string when present');
  }
  // SerializedCombat currently carries no `phase` field; require an object and only check
  // `phase` when present so both current saves and future phased saves pass.
  if (s.combat !== undefined && s.combat !== null) {
    if (typeof s.combat !== 'object' || Array.isArray(s.combat)) throw new Error('Invalid save: combat is not an object');
    const c = s.combat as Record<string, unknown>;
    if (c.phase !== undefined && typeof c.phase !== 'string') {
      throw new Error('Invalid save: combat.phase must be a string when present');
    }
  }
  for (const e of world.entities as unknown[]) {
    const ent = e as { id?: unknown; components?: unknown };
    if (!ent || typeof ent.id !== 'number' || !ent.components || typeof ent.components !== 'object') throw new Error('Invalid save: malformed entity');
  }
}
