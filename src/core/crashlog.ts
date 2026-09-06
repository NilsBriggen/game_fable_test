/**
 * 5.4 crash log: bounded in-memory ring with throttled localStorage persistence.
 * Node-safe (no DOM/WebGL); storage access is always tolerant and never throws.
 */

export interface CrashEntry {
  t: number;
  message: string;
  stack?: string;
  state?: string;
  chapter?: string;
}

export type CrashEntryInput = {
  message: string;
  stack?: string;
  state?: string;
  chapter?: string;
  t?: number;
};

export interface CrashLogStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface CrashLogOptions {
  now?: () => number;
  /** Omit to auto-detect global localStorage; pass null for memory-only. */
  storage?: CrashLogStorage | null;
  key?: string;
}

export const CRASHLOG_KEY = 'eidgenossen:crash-log';
export const CRASHLOG_MAX_ENTRIES = 50;
/** Approximate total-bytes cap for the persisted ring (JSON chars; ASCII ≈ bytes). */
export const CRASHLOG_MAX_BYTES = 64 * 1024;
const WRITE_THROTTLE_MS = 1000;
const FIELD_CAP = 2000;

function detectStorage(): CrashLogStorage | null {
  try {
    if (typeof localStorage !== 'undefined') {
      const s = localStorage as unknown as CrashLogStorage;
      if (s && typeof s.getItem === 'function' && typeof s.setItem === 'function') return s;
    }
  } catch {
    /* unavailable (private mode / Node) -> memory fallback */
  }
  return null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function sanitizeLoaded(v: unknown): CrashEntry[] {
  if (!Array.isArray(v)) return [];
  const out: CrashEntry[] = [];
  for (const e of v) {
    if (!isRecord(e) || typeof e['message'] !== 'string') continue;
    const entry: CrashEntry = { t: typeof e['t'] === 'number' ? e['t'] as number : 0, message: (e['message'] as string).slice(0, FIELD_CAP) };
    if (typeof e['stack'] === 'string') entry.stack = (e['stack'] as string).slice(0, FIELD_CAP);
    if (typeof e['state'] === 'string') entry.state = e['state'] as string;
    if (typeof e['chapter'] === 'string') entry.chapter = e['chapter'] as string;
    out.push(entry);
  }
  return out.slice(-CRASHLOG_MAX_ENTRIES);
}

export class CrashLog {
  private entries: CrashEntry[] = [];
  private readonly now: () => number;
  private readonly storage: CrashLogStorage | null;
  private readonly key: string;
  private lastWrite = 0;
  private pending = false;

  constructor(opts: CrashLogOptions = {}) {
    this.now = opts.now ?? (() => Date.now());
    this.key = opts.key ?? CRASHLOG_KEY;
    this.storage = 'storage' in opts ? (opts.storage ?? null) : detectStorage();
    // Tolerant load: corrupt/unexpected payload -> empty, never throw.
    try {
      const raw = this.storage?.getItem(this.key) ?? null;
      if (typeof raw === 'string' && raw.length > 0) {
        this.entries = sanitizeLoaded(JSON.parse(raw) as unknown);
      }
    } catch {
      this.entries = [];
    }
  }

  push(input: CrashEntryInput): void {
    const entry: CrashEntry = {
      t: typeof input.t === 'number' ? input.t : this.now(),
      message: String(input.message).slice(0, FIELD_CAP),
    };
    if (typeof input.stack === 'string' && input.stack.length > 0) entry.stack = input.stack.slice(0, FIELD_CAP);
    if (typeof input.state === 'string') entry.state = input.state;
    if (typeof input.chapter === 'string') entry.chapter = input.chapter;
    this.entries.push(entry);
    if (this.entries.length > CRASHLOG_MAX_ENTRIES) {
      this.entries.splice(0, this.entries.length - CRASHLOG_MAX_ENTRIES);
    }
    // Byte cap (~64KB): drop oldest until within budget.
    while (this.entries.length > 1 && JSON.stringify(this.entries).length > CRASHLOG_MAX_BYTES) {
      this.entries.shift();
    }
    this.persistThrottled();
  }

  list(): CrashEntry[] {
    return this.entries.map((e) => ({ ...e }));
  }

  clear(): void {
    this.entries = [];
    this.pending = false;
    try {
      this.storage?.removeItem(this.key);
    } catch {
      /* tolerant: memory state is already cleared */
    }
    try {
      this.lastWrite = this.now();
    } catch {
      this.lastWrite = 0;
    }
  }

  exportJson(): string {
    try {
      return JSON.stringify({
        version: 1,
        exportedAt: this.now(),
        count: this.entries.length,
        entries: this.list(),
      });
    } catch {
      return '{"version":1,"count":0,"entries":[]}';
    }
  }

  /** Write trailing entries skipped by the throttle. No-op without storage. */
  flush(): void {
    if (!this.pending) return;
    this.writeNow();
  }

  private persistThrottled(): void {
    if (!this.storage) return;
    let now = 0;
    try {
      now = this.now();
    } catch {
      now = 0;
    }
    if (now - this.lastWrite >= WRITE_THROTTLE_MS) {
      this.writeNow(now);
    } else {
      this.pending = true;
    }
  }

  private writeNow(now?: number): void {
    if (!this.storage) {
      this.pending = false;
      return;
    }
    try {
      this.storage.setItem(this.key, JSON.stringify(this.entries));
      this.pending = false;
      this.lastWrite = typeof now === 'number' ? now : this.now();
    } catch {
      /* persistence is best-effort; in-memory ring is authoritative */
    }
  }
}

/** Process-wide singleton bound to real localStorage (memory fallback when unavailable). */
export const crashlog = new CrashLog();
