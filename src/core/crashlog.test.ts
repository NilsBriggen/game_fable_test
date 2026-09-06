import { describe, expect, it, vi } from 'vitest';
import {
  CRASHLOG_MAX_BYTES,
  CRASHLOG_MAX_ENTRIES,
  CrashLog,
  type CrashLogStorage,
} from './crashlog';

function memStore(initial?: string): CrashLogStorage & { writes: number; data: Record<string, string> } {
  const data: Record<string, string> = {};
  if (initial !== undefined) data['k'] = initial;
  const s = {
    writes: 0,
    data,
    getItem: (k: string) => (k in data ? (data[k] as string) : null),
    setItem: (k: string, v: string) => { s.writes++; data[k] = v; },
    removeItem: (k: string) => { delete data[k]; },
  };
  return s;
}

describe('crashlog', () => {
  it('caps ring at 50 entries with rotation (oldest dropped)', () => {
    const log = new CrashLog({ now: () => 0, storage: null });
    for (let i = 0; i < CRASHLOG_MAX_ENTRIES + 10; i++) log.push({ message: `m${i}` });
    const list = log.list();
    expect(list).toHaveLength(CRASHLOG_MAX_ENTRIES);
    expect(list[0]?.message).toBe('m10');
    expect(list[list.length - 1]?.message).toBe(`m${CRASHLOG_MAX_ENTRIES + 9}`);
  });

  it('enforces the ~64KB byte cap by dropping oldest', () => {
    let t = 0;
    const log = new CrashLog({ now: () => t++, storage: null });
    // 50 max-length entries ≈ 100KB > 64KB budget: use FIELD_CAP-sized messages
    // (a single oversized push is field-truncated to 2000 chars, so volume must come
    // from entry count, not one giant entry).
    const big = 'x'.repeat(2000);
    for (let i = 0; i < CRASHLOG_MAX_ENTRIES; i++) log.push({ message: `${i}:${big}`.slice(0, 2000) });
    const bytes = JSON.stringify(log.list()).length;
    expect(bytes).toBeLessThanOrEqual(CRASHLOG_MAX_BYTES);
    expect(log.list().length).toBeLessThan(CRASHLOG_MAX_ENTRIES);
    // Newest entry survives intact.
    const list = log.list();
    expect(list[list.length - 1]?.message).toBe(`${CRASHLOG_MAX_ENTRIES - 1}:${big}`.slice(0, 2000));
  });

  it('tolerates corrupt stored payload (loads empty, never throws)', () => {
    const store = memStore('{{{not-json');
    const make = (): CrashLog => new CrashLog({ storage: store, key: 'k' });
    expect(make).not.toThrow();
    expect(make().list()).toEqual([]);
    // Non-array payload is also tolerated.
    const store2 = memStore('{"oops":true}');
    expect(new CrashLog({ storage: store2, key: 'k' }).list()).toEqual([]);
  });

  it('skips malformed entries but keeps valid ones', () => {
    const store = memStore(JSON.stringify([{ nope: 1 }, { message: 42 }, { message: 'ok', t: 7 }]));
    const log = new CrashLog({ storage: store, key: 'k' });
    expect(log.list()).toEqual([{ t: 7, message: 'ok' }]);
  });

  it('exports versioned JSON shape', () => {
    const log = new CrashLog({ now: () => 1234, storage: null });
    log.push({ message: 'boom', stack: 's', state: 'explore', chapter: 'c', t: 99 });
    const parsed = JSON.parse(log.exportJson()) as {
      version: number; exportedAt: number; count: number; entries: unknown[];
    };
    expect(parsed.version).toBe(1);
    expect(parsed.exportedAt).toBe(1234);
    expect(parsed.count).toBe(1);
    expect(parsed.entries).toEqual([{ t: 99, message: 'boom', stack: 's', state: 'explore', chapter: 'c' }]);
  });

  it('throttles persistence to max 1 write/sec, flush() writes trailing', () => {
    let now = 10000;
    const store = memStore();
    const log = new CrashLog({ now: () => now, storage: store, key: 'k' });
    log.push({ message: 'a' });
    expect(store.writes).toBe(1);
    log.push({ message: 'b' });
    log.push({ message: 'c' });
    expect(store.writes).toBe(1);
    log.flush();
    expect(store.writes).toBe(2);
    expect(JSON.parse(store.data['k'] as string)).toHaveLength(3);
    // After the throttle window elapses, pushes write through again.
    now += 1001;
    log.push({ message: 'd' });
    expect(store.writes).toBe(3);
  });

  it('works with memory fallback when localStorage is unavailable', () => {
    const log = new CrashLog({ storage: null });
    expect(() => {
      log.push({ message: 'x' });
      log.flush();
      log.clear();
    }).not.toThrow();
    expect(log.list()).toEqual([]);
  });

  it('clear() empties the ring and storage', () => {
    const store = memStore();
    const log = new CrashLog({ now: () => 5000, storage: store, key: 'k' });
    log.push({ message: 'a' });
    log.clear();
    expect(log.list()).toEqual([]);
    expect(store.getItem('k')).toBeNull();
  });

  it('survives a throwing storage backend', () => {
    const bad: CrashLogStorage = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
      removeItem: () => { throw new Error('denied'); },
    };
    const make = (): CrashLog => new CrashLog({ storage: bad });
    expect(make).not.toThrow();
    const log = make();
    expect(() => {
      log.push({ message: 'a' });
      log.flush();
      log.clear();
      log.exportJson();
    }).not.toThrow();
  });

  it('uses injected now-fn for entry timestamps', () => {
    const times = [111, 222];
    const log = new CrashLog({ now: () => times.shift() ?? 0, storage: null });
    log.push({ message: 'a' });
    log.push({ message: 'b' });
    expect(log.list().map((e) => e.t)).toEqual([111, 222]);
  });

  it('fake timers drive the throttle window', () => {
    vi.useFakeTimers();
    try {
      const store = memStore();
      const log = new CrashLog({ storage: store, key: 'k' });
      log.push({ message: 'a' });
      const afterFirst = store.writes;
      log.push({ message: 'b' });
      expect(store.writes).toBe(afterFirst);
      vi.advanceTimersByTime(1500);
      log.push({ message: 'c' });
      expect(store.writes).toBe(afterFirst + 1);
    } finally {
      vi.useRealTimers();
    }
  });
});
