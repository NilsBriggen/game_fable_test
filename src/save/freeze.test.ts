/**
 * Phase 5.3 save-compat freeze suite. Schema stays SAVE_SCHEMA_VERSION=1; no new migration.
 * Pure Node-side tests (no WebGLRenderer): golden fixtures per slot-kind round-trip through
 * encodeSave -> decodeSave -> migrateToCurrent -> assertSaveShape, refuse-newer leaves stored
 * bytes untouched, corrupt bytes are rejected, and unknown component names pass the shape check
 * (documents the drop-with-warning policy applied at load: World.load warns and skips
 * unregistered component types rather than failing).
 *
 * NOTE on queueing: SaveServiceImpl serialises save()/load() against each other through its
 * internal `busy` chain (see src/save/index.ts), because a save racing a load could snapshot a
 * half-restored world. list()/delete()/importJson()/exportJson() intentionally BYPASS that
 * queue — they are metadata/byte-level operations that never touch the live world, so they
 * cannot corrupt an in-progress load. A dedicated race test is skipped: with MemoryStore the
 * interleavings resolve deterministically in call order and would not exercise anything real.
 */
import { describe, it, expect } from 'vitest';
import { SAVE_SCHEMA_VERSION } from '@core/schemas';
import type { SaveFile, SerializedCombat } from '@core/schemas';
import { MemoryStore, encodeSave, decodeSave, assertSaveShape, metaFromSave } from './db';
import { migrateToCurrent } from './migrations';
import { applyDifficulty } from './snapshot';
import { createSaveService } from './index';
import { World } from '@core/ecs';
import { RngStreams } from '@core/rng';
import { GameClock } from '@core/clock';
import { EventBus } from '@core/events';
import type { GameEvents } from '@core/events';
import { ServiceRegistry } from '@core/services';
import type { SaveHost } from './host';

function makeHost(seed: number): SaveHost {
  const host: SaveHost = {
    world: new World(),
    rng: new RngStreams(seed),
    clock: new GameClock(),
    events: new EventBus<GameEvents>(),
    services: new ServiceRegistry(),
    state: { state: 'explore', prev: 'explore' },
    seed,
    playtimeSec: 0,
    reseed(newSeed: number) {
      host.seed = newSeed;
      host.rng = new RngStreams(newSeed);
    },
    resetWorld() {
      host.world.clear();
      host.playtimeSec = 0;
    },
  };
  return host;
}

function baseSave(slot: number, seed: number): SaveFile {
  const now = new Date().toISOString();
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    slot,
    label: `Freeze slot ${slot}`,
    createdAt: now,
    updatedAt: now,
    seed,
    gameTime: 123456.0,
    chapter: 'prologue-1291',
    world: { nextId: 1, entities: [] },
    playerId: 0,
    party: [],
    quests: {},
    reputation: {},
    discovered: ['poi.fluelen'],
    flags: { met_werner: true },
    journal: [{ time: 123456.0, text: 'Swore the oath.' }],
    rngState: { world: [1, 2, 3, 4] },
    playtimeSec: 3600,
    playerOrigin: 'uri',
    location: 'Flüelen',
    weather: 'clear',
    season: 'summer',
    difficulty: 'hard',
    thumbnailDataUrl: 'data:image/jpeg;base64,/9j/4AAQ',
  };
}

function sampleCombatBlock(): SerializedCombat {
  return {
    encounterId: 'enc.morgarten',
    round: 3,
    turnIndex: 1,
    order: [1, 2],
    rngState: [9, 8, 7, 6],
    units: [{ id: 1 }],
    features: [],
    objectivesState: {},
    log: [],
    phase: 'active',
  } as unknown as SerializedCombat;
}

describe('save-compat freeze (schema stays v1)', () => {
  it('pins SAVE_SCHEMA_VERSION=1 (no schema bump in this workstream)', () => {
    expect(SAVE_SCHEMA_VERSION).toBe(1);
  });

  it.each([
    { kind: 'manual slot 1', slot: 1, seed: 101 },
    { kind: 'autosave slot 0', slot: 0, seed: 102 },
    { kind: 'quick slot 6', slot: 6, seed: 103 },
  ])('golden fixture round-trips: $kind', async ({ slot, seed }) => {
    const save = baseSave(slot, seed);
    const bytes = await encodeSave(save);
    const decoded = await decodeSave(bytes);
    const migrated = migrateToCurrent(decoded);
    expect(() => assertSaveShape(migrated)).not.toThrow();
    expect(migrated.seed).toBe(seed);
    expect(migrated.slot).toBe(slot);
    expect(migrated.chapter).toBe('prologue-1291');
    expect(migrated.difficulty).toBe('hard');
  });

  it('mid-combat fixture round-trips with its combat block intact', async () => {
    const save = baseSave(1, 201);
    save.combat = sampleCombatBlock();
    const migrated = migrateToCurrent(await decodeSave(await encodeSave(save)));
    expect(() => assertSaveShape(migrated)).not.toThrow();
    expect(migrated.combat?.encounterId).toBe('enc.morgarten');
    expect(migrated.combat?.round).toBe(3);
  });

  it('legacy fixture without difficulty/weather/season/thumbnail round-trips; difficulty defaults to normal', async () => {
    const save = baseSave(1, 202);
    delete save.difficulty;
    delete save.weather;
    delete save.season;
    delete save.thumbnailDataUrl;
    const migrated = migrateToCurrent(await decodeSave(await encodeSave(save)));
    expect(() => assertSaveShape(migrated)).not.toThrow();
    expect(migrated.seed).toBe(202);
    expect(migrated.chapter).toBe('prologue-1291');
    // Tolerant-optional: absent difficulty loads as 'normal' via applyDifficulty (no migration).
    expect(applyDifficulty({}, migrated)).toBe('normal');
  });

  it('refuse-newer: schemaVersion 999 throws and stored bytes are untouched', async () => {
    expect(() => migrateToCurrent({ schemaVersion: 999 })).toThrow(/newer/i);

    const store = new MemoryStore();
    const good = baseSave(3, 303);
    const goodBytes = await encodeSave(good);
    await store.put(3, goodBytes, metaFromSave(good, goodBytes.byteLength));
    const before = (await store.get(3))?.slice();

    const host = makeHost(1);
    const svc = createSaveService(host, store);
    const newerJson = JSON.stringify({ ...good, schemaVersion: 999 });
    await expect(svc.importJson(newerJson, 3)).rejects.toThrow(/newer/i);
    expect(await store.get(3)).toEqual(before);
  });

  it('corrupt matrix: decodeSave rejects empty, truncated-gzip, bad-header and garbage-gzip bytes', async () => {
    // 1. empty (empty-string equivalent: zero bytes)
    await expect(decodeSave(new Uint8Array([]))).rejects.toThrow();
    await expect(decodeSave(new TextEncoder().encode(''))).rejects.toThrow();
    // 2. bad encoding byte
    await expect(decodeSave(new Uint8Array([42, 1, 2, 3]))).rejects.toThrow(/unknown encoding byte/i);
    // 3. gzip header with garbage body
    await expect(decodeSave(new Uint8Array([1, 9, 9, 9, 9, 9]))).rejects.toThrow();
    // 4. truncated valid gzip body
    const valid = await encodeSave(baseSave(1, 404));
    expect(valid[0]).toBe(1); // gzip path under Node
    await expect(decodeSave(valid.subarray(0, Math.max(2, Math.floor(valid.length / 2))))).rejects.toThrow();
  });

  it('unknown-component tolerance: entity with an unregistered component name passes assertSaveShape', async () => {
    // Documents the drop-with-warning policy: World.load warns and skips unknown component
    // types instead of failing, so saves referencing removed/renamed components stay loadable.
    const save = baseSave(1, 505);
    save.world = { nextId: 2, entities: [{ id: 1, components: { 'mod.future-gadget': { level: 9 } } }] };
    expect(() => assertSaveShape(save)).not.toThrow();
    const migrated = migrateToCurrent(await decodeSave(await encodeSave(save)));
    expect(() => assertSaveShape(migrated)).not.toThrow();
  });

  describe('assertSaveShape optional-shape hardening', () => {
    function good(): SaveFile {
      return baseSave(1, 606);
    }
    it('absent optionals pass (tolerant)', () => {
      const save = good() as unknown as Record<string, unknown>;
      delete save.discovered;
      delete save.flags;
      delete save.journal;
      delete save.playtimeSec;
      delete save.location;
      delete save.weather;
      delete save.season;
      delete save.difficulty;
      delete save.combat;
      delete save.thumbnailDataUrl;
      expect(() => assertSaveShape(save)).not.toThrow();
    });
    it.each([
      { field: 'discovered', value: 'poi.fluelen', match: /discovered/i },
      { field: 'flags', value: [], match: /flags/i },
      { field: 'journal', value: {}, match: /journal/i },
      { field: 'playtimeSec', value: -5, match: /playtimeSec/i },
      { field: 'playtimeSec', value: Number.NaN, match: /playtimeSec/i },
      { field: 'location', value: 42, match: /location/i },
      { field: 'weather', value: 7, match: /weather/i },
      { field: 'season', value: null, match: /season/i },
      { field: 'difficulty', value: 3, match: /difficulty/i },
      { field: 'combat', value: 'fight', match: /combat/i },
      { field: 'thumbnailDataUrl', value: 123, match: /thumbnailDataUrl/i },
    ])('rejects malformed $field', ({ field, value, match }) => {
      const save = good() as unknown as Record<string, unknown>;
      save[field] = value;
      expect(() => assertSaveShape(save)).toThrow(match);
    });
    it('accepts a location object with finite x/z, or null', () => {
      const a = good() as unknown as Record<string, unknown>;
      a.location = { x: 10, z: -20 };
      expect(() => assertSaveShape(a)).not.toThrow();
      const b = good() as unknown as Record<string, unknown>;
      b.location = null;
      expect(() => assertSaveShape(b)).not.toThrow();
      const c = good() as unknown as Record<string, unknown>;
      c.location = { x: Number.NaN, z: 0 };
      expect(() => assertSaveShape(c)).toThrow(/location/i);
    });
    it('accepts a combat object with a phase string', () => {
      const save = good();
      save.combat = sampleCombatBlock();
      expect(() => assertSaveShape(save)).not.toThrow();
    });
  });
});
