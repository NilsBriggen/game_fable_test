import { describe, it, expect, vi } from 'vitest';
import { World } from '@core/ecs';
import { RngStreams } from '@core/rng';
import { GameClock, gameTimeFor } from '@core/clock';
import { EventBus } from '@core/events';
import type { GameEvents } from '@core/events';
import { ServiceRegistry } from '@core/services';
import type { UiService, QuestService, ExplorationService, WorldService, CombatService, Weather } from '@core/services';
import { Transform, Name, Character, Skills, Inventory } from '@core/components';
import { SAVE_SCHEMA_VERSION, SAVE_MAX_BYTES, AUTOSAVE_SLOT, QUICKSAVE_SLOT, MANUAL_SLOTS } from '@core/schemas';
import type { SaveMeta, SerializedCombat } from '@core/schemas';
import type { GameContext } from '@core/context';

import type { SaveHost } from './host';
import {
  MemoryStore, LocalStorageStore, IndexedDbStore, ResilientStore,
  encodeSave, decodeSave, metaFromSave, assertSaveShape,
  ENCODING_GZIP, ENCODING_RAW, createSaveStore,
} from './db';
import { buildSnapshot, applyWorldState } from './snapshot';
import { migrateToCurrent } from './migrations';
import { createSaveService, register } from './index';

// ---------------- test helpers ----------------

/** A tiny stand-in for `GameStateMachine`: `transition()` updates `state`/`prev` the same way (no
 * legality table — the save module doesn't need one; `main.ts` owns that). Exposed separately from
 * `SaveHost.state` (which only declares the read side) so test wiring can drive it explicitly. */
class TestStateMachine {
  state: string;
  prev: string;
  constructor(initial: string) {
    this.state = initial;
    this.prev = initial;
  }
  transition(to: string): void {
    if (to === this.state) return;
    this.prev = this.state;
    this.state = to;
  }
}

/** A SaveHost backed by real (non-WebGL) core classes — GameContext satisfies this structurally,
 * but constructing GameContext itself would create a WebGLRenderer, which is unavailable in Node.
 * By default, wires 'request-state' -> the state machine, mirroring `main.ts`'s
 * `ctx.events.on('request-state', to => ctx.state.transition(to))`, so `doLoad`'s post-emit
 * `host.state.state` check and its `host.state.prev` read on early failure behave exactly as they
 * do against a real `GameContext`. Pass `autoTransition: false` to simulate an illegal/refused
 * transition (state never actually changes), or `prev` to seed a starting value. */
function makeHost(seed: number, opts: { state?: string; prev?: string; autoTransition?: boolean } = {}): SaveHost {
  const stateMachine = new TestStateMachine(opts.state ?? 'explore');
  if (opts.prev !== undefined) stateMachine.prev = opts.prev;
  const host: SaveHost = {
    world: new World(),
    rng: new RngStreams(seed),
    clock: new GameClock(),
    events: new EventBus<GameEvents>(),
    services: new ServiceRegistry(),
    state: stateMachine,
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
  if (opts.autoTransition ?? true) {
    host.events.on('request-state', (to) => stateMachine.transition(to as string));
  }
  return host;
}

/** A GameClock whose `set()` always throws — used to simulate a failure *inside* applyWorldState,
 * i.e. after the world has already been reset, to test the worldTouched->'title' branch of load(). */
class ThrowingClock extends GameClock {
  override set(_t: number): void {
    throw new Error('clock.set exploded (simulated post-reset failure)');
  }
}

function populateWorld(world: World, n: number): void {
  for (let i = 0; i < n; i++) {
    const id = world.create();
    world.add(id, Transform, { x: (i % 137) * 3.1, y: 0, z: (i % 91) * 2.7, yaw: (i % 63) * 0.1 });
    world.add(id, Name, { id: `npc.synthetic-${i}`, display: `Synthetic ${i}` });
    world.add(id, Character, {
      attributes: { strength: 8 + (i % 10), agility: 8 + (i % 8), endurance: 10, wits: 9, presence: 9 },
      hp: 20, hpMax: 20, morale: 60, moraleMax: 60, fatigue: i % 100, archetype: 'peasant', level: 1 + (i % 5), down: false,
    });
    world.add(id, Skills, { levels: { sword: { level: i % 100, xp: i * 3 }, athletics: { level: (i * 2) % 100, xp: i } } });
    world.add(id, Inventory, {
      items: [{ instanceId: `item-${i}-a`, defId: 'item.dagger', qty: 1 }, { instanceId: `item-${i}-b`, defId: 'item.bread', qty: 3 }],
      pfennig: i,
      capacityKg: 40,
    });
  }
}

function fakeUi(): { ui: UiService; toasts: string[]; loadingCalls: boolean[] } {
  const toasts: string[] = [];
  const loadingCalls: boolean[] = [];
  const ui: UiService = {
    showHud() {},
    updateHud() {},
    toast(msg) { toasts.push(msg); },
    openMenu() {},
    closeMenu() {},
    currentMenu() { return null; },
    dialogue: { show: async () => 0, hide() {} },
    combat: { show() {}, update() {}, hide() {}, onCommand() {} },
    cutscene: { letterbox() {}, caption: async () => {}, fade: async () => {}, title: async () => {} },
    prompt() {},
    loading(on) { loadingCalls.push(on); },
    confirm: async () => true,
  };
  return { ui, toasts, loadingCalls };
}

function fakeQuestService(): { quest: QuestService; restoreCalls: unknown[] } {
  const restoreCalls: unknown[] = [];
  const quest: QuestService = {
    start() {}, advance() {}, complete() {}, fail() {},
    stage: () => null, isStarted: () => false, isDone: () => false,
    setVar() {}, getVar: () => undefined, setFlag() {}, getFlag: () => undefined,
    reputation: () => 0, reputationBand: () => 'unknown', changeReputation() {}, isHostile: () => false,
    factionDef: () => undefined, evaluate: () => true,
    runEffects: async () => {}, runDialogue: async () => ({ ended: true, lastNode: '', effectsRun: 0 }), runCutscene: async () => {},
    journal: () => [], addJournal() {}, activeQuests: () => [],
    chapter: () => 'prologue-1291', setChapter: async () => {},
    serialize: () => ({ quests: {}, reputation: {}, flags: {}, journal: [], chapter: 'prologue-1291' }),
    restore(s) { restoreCalls.push(s); },
    on: () => () => {},
  };
  return { quest, restoreCalls };
}

function fakeExplorationService(playerId: number): { exploration: ExplorationService; setDiscoveredCalls: string[][] } {
  const setDiscoveredCalls: string[][] = [];
  const exploration: ExplorationService = {
    spawnPlayer: () => playerId, spawnNpc: () => 0, populate() {}, getPlayer: () => playerId,
    teleport() {}, setControlEnabled() {}, getCameraRig: () => ({} as ReturnType<ExplorationService['getCameraRig']>),
    discover() {}, isDiscovered: () => false, discovered: () => [], setDiscovered(ids) { setDiscoveredCalls.push(ids); },
    fastTravel: async () => {}, nearestInteractable: () => null, interactWith() {},
    poiPosition: () => null, poiDef: () => undefined, nearestPoi: () => null,
    setPartyVisible() {}, on: () => () => {},
  };
  return { exploration, setDiscoveredCalls };
}

function fakeWorldService(): { world: WorldService; streamAroundCalls: [number, number, number | undefined][]; setWeatherCalls: Weather[]; setSeasonCalls: string[] } {
  const streamAroundCalls: [number, number, number | undefined][] = [];
  const setWeatherCalls: Weather[] = [];
  const setSeasonCalls: string[] = [];
  const world: WorldService = {
    heightAt: () => 0, normalAt: () => ({} as ReturnType<WorldService['normalAt']>), surfaceAt: () => 'grass', isWater: () => false, slopeAt: () => 0,
    raycast: () => null, regionAt: () => null, setTimeOfDay() {}, getTimeOfDay: () => 0, setCombatFill() {},
    setWeather(w) { setWeatherCalls.push(w); }, getWeather: () => 'clear', setSeason(s) { setSeasonCalls.push(s); },
    streamAround: async (x, z, r) => { streamAroundCalls.push([x, z, r]); },
    isSettled: () => true, placeInstances: () => ({} as ReturnType<WorldService['placeInstances']>), spawnModel: () => ({} as ReturnType<WorldService['spawnModel']>),
    registerModel() {}, hasModel: () => false, listModels: () => [],
    getSceneRoots: () => ({} as ReturnType<WorldService['getSceneRoots']>), getRenderer: () => ({} as ReturnType<WorldService['getRenderer']>),
    getScene: () => ({} as ReturnType<WorldService['getScene']>), getCamera: () => ({} as ReturnType<WorldService['getCamera']>),
    stats: () => ({ chunksLoaded: 0, chunksPending: 0, instances: 0 }),
    worldToMapUv: () => [0, 0], mapImage: async () => '',
  };
  return { world, streamAroundCalls, setWeatherCalls, setSeasonCalls };
}

function sampleCombat(): SerializedCombat {
  return { encounterId: 'enc.test', round: 1, turnIndex: 0, order: [1], rngState: [1, 2, 3, 4], units: [], features: [], objectivesState: {}, log: [] };
}

function fakeCombatService(opts: { active: boolean; serialized?: SerializedCombat | null }): { combat: CombatService; restoreCalls: SerializedCombat[] } {
  const restoreCalls: SerializedCombat[] = [];
  const combat: CombatService = {
    start: async () => ({ outcome: 'win', rounds: 0, downed: [], dead: [], xp: {}, loot: [], log: [] }),
    isActive: () => opts.active, getState: () => null, submit: () => ({ ok: true }),
    previewMove: () => null, previewAttack: () => null, reachable: () => [], targets: () => [],
    cellToWorld: () => ({ x: 0, y: 0, z: 0 }), on: () => () => {},
    serialize: () => opts.serialized ?? null,
    restore: async (s) => { restoreCalls.push(s); },
    stepAi() {}, runScript: async () => ({} as Awaited<ReturnType<CombatService['runScript']>>),
  };
  return { combat, restoreCalls };
}

function metaStub(slot: number, updatedAt: string): SaveMeta {
  return { slot, label: `Slot ${slot}`, createdAt: updatedAt, updatedAt, chapter: 'c', calendar: 'c', location: 'l', playtimeSec: 0, schemaVersion: SAVE_SCHEMA_VERSION, bytes: 1 };
}

function flush(ms = 20): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function makeStubLocalStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => { map.set(k, String(v)); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  } as Storage;
}

// ---- a minimal in-memory IDBFactory stub (no fake-indexeddb dependency; see BUILDER_RULES §deps) ----
function installFakeIndexedDb(opts: { failOpen?: boolean } = {}): { uninstall: () => void } {
  interface FakeReq { onsuccess: (() => void) | null; onerror: (() => void) | null; onupgradeneeded?: (() => void) | null; onblocked?: (() => void) | null; result: unknown; error: Error | null }
  function makeReq<T>(run: () => T): FakeReq {
    const req: FakeReq = { onsuccess: null, onerror: null, result: undefined, error: null };
    queueMicrotask(() => {
      try {
        req.result = run();
        req.onsuccess?.();
      } catch (err) {
        req.error = err instanceof Error ? err : new Error(String(err));
        req.onerror?.();
      }
    });
    return req;
  }
  const rows = new Map<number, unknown>();
  const objectStore = {
    get: (key: number) => makeReq(() => rows.get(key)),
    put: (value: { slot: number }) => makeReq(() => { rows.set(value.slot, value); }),
    delete: (key: number) => makeReq(() => { rows.delete(key); }),
    getAll: () => makeReq(() => [...rows.values()]),
  };
  const db = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => objectStore,
    transaction: () => ({ objectStore: () => objectStore }),
  };
  const fakeIndexedDB = {
    open() {
      if (opts.failOpen) {
        const req: FakeReq = { onsuccess: null, onerror: null, onblocked: null, result: undefined, error: new Error('simulated IndexedDB failure (private mode)') };
        queueMicrotask(() => req.onerror?.());
        return req;
      }
      const req: FakeReq = { onsuccess: null, onerror: null, onupgradeneeded: null, result: db, error: null };
      queueMicrotask(() => { req.onupgradeneeded?.(); req.onsuccess?.(); });
      return req;
    },
  };
  const orig = (globalThis as { indexedDB?: unknown }).indexedDB;
  (globalThis as { indexedDB?: unknown }).indexedDB = fakeIndexedDB;
  return { uninstall() { (globalThis as { indexedDB?: unknown }).indexedDB = orig; } };
}

// ---------------- tests ----------------

describe('save round-trip (snapshot -> compress -> decompress -> restore)', () => {
  it('round-trips 5000 entities via gzip, preserving components, RNG continuation and clock', async () => {
    const host1 = makeHost(42);
    populateWorld(host1.world, 5000);
    host1.clock.set(gameTimeFor(1315, 11, 15, 7, 30));
    host1.playtimeSec = 12345;

    const save = buildSnapshot(host1, 1, 'Test Save');
    expect(save.world.entities.length).toBe(5000);

    // The RNG stream continues *after* the snapshot: the number the original stream produces next
    // must match what a restored stream produces next.
    const expectedNext = host1.rng.world.next();

    const bytes = await encodeSave(save);
    expect(bytes[0]).toBe(ENCODING_GZIP); // Node 22 has CompressionStream
    expect(bytes.byteLength).toBeLessThan(SAVE_MAX_BYTES);
    // eslint-disable-next-line no-console
    console.log(`[save.test] 5000-entity save: ${bytes.byteLength.toLocaleString()} compressed bytes (budget ${SAVE_MAX_BYTES.toLocaleString()})`);

    const decoded = await decodeSave(bytes);
    const migrated = migrateToCurrent(decoded);

    const host2 = makeHost(0);
    applyWorldState(host2, migrated);

    expect(host2.world.count()).toBe(5000);
    expect(host2.clock.time).toBe(host1.clock.time);
    expect(host2.playtimeSec).toBe(12345);
    expect(host2.seed).toBe(42);
    expect(host2.rng.world.next()).toBe(expectedNext);

    // Spot-check a few entities explicitly...
    for (const id of [1, 2500, 5000]) {
      expect(host2.world.get(id, Transform)).toEqual(host1.world.get(id, Transform));
      expect(host2.world.get(id, Name)).toEqual(host1.world.get(id, Name));
      expect(host2.world.get(id, Character)).toEqual(host1.world.get(id, Character));
      expect(host2.world.get(id, Skills)).toEqual(host1.world.get(id, Skills));
      expect(host2.world.get(id, Inventory)).toEqual(host1.world.get(id, Inventory));
    }
    // ...and the whole world, exactly.
    expect(JSON.stringify(host2.world.serialize())).toBe(JSON.stringify(host1.world.serialize()));
  }, 30000);

  it('round-trips via the raw fallback when CompressionStream is unavailable', async () => {
    const host1 = makeHost(7);
    populateWorld(host1.world, 200);
    const save = buildSnapshot(host1, 2, 'Raw Path');

    const origCs = globalThis.CompressionStream;
    const origDs = globalThis.DecompressionStream;
    // @ts-expect-error deliberately removing for this test
    delete globalThis.CompressionStream;
    // @ts-expect-error deliberately removing for this test
    delete globalThis.DecompressionStream;
    try {
      const bytes = await encodeSave(save);
      expect(bytes[0]).toBe(ENCODING_RAW);
      const decoded = await decodeSave(bytes);
      expect(decoded.seed).toBe(7);
      expect(decoded.world.entities.length).toBe(200);
      expect(decoded.playerOrigin).toBe(save.playerOrigin);
    } finally {
      globalThis.CompressionStream = origCs;
      globalThis.DecompressionStream = origDs;
    }
  });

  it('throws over the SAVE_MAX_BYTES budget (monkey-patched via an oversized flags blob) and logs diagnostics', async () => {
    const host = makeHost(1);
    populateWorld(host.world, 5);
    const save = buildSnapshot(host, AUTOSAVE_SLOT);
    // High-entropy hex digits (not a repeated character): gzip only gets ~46% off this (measured),
    // so 3x the byte budget of raw text survives compression comfortably above SAVE_MAX_BYTES.
    const rng = new RngStreams(1).world;
    let bloat = '';
    const targetLen = SAVE_MAX_BYTES * 3;
    while (bloat.length < targetLen) bloat += rng.nextU32().toString(16).padStart(8, '0');
    (save.flags as Record<string, unknown>).bloat = bloat;

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(encodeSave(save)).rejects.toThrow(/exceeds/i);
      expect(errSpy).toHaveBeenCalled();
    } finally {
      errSpy.mockRestore();
    }
  });

  it('buildSnapshot refuses to snapshot while a load is in progress', () => {
    const host = makeHost(1, { state: 'loading' });
    expect(() => buildSnapshot(host, AUTOSAVE_SLOT)).toThrow(/load is in progress/i);
  });

  it('buildSnapshot throws instead of silently dropping the combat block when combat is active but unserialisable', () => {
    const host = makeHost(1);
    const { combat } = fakeCombatService({ active: true, serialized: null });
    host.services.register('combat', combat);
    expect(() => buildSnapshot(host, AUTOSAVE_SLOT)).toThrow(/combat is active/i);
  });

  it('carries weather/season from the world service and the clock', () => {
    const host = makeHost(1);
    const { world } = fakeWorldService();
    host.services.register('world', world);
    const save = buildSnapshot(host, AUTOSAVE_SLOT);
    expect(save.weather).toBe('clear');
    expect(save.season).toBe(host.clock.season());
  });
});

describe('migrations', () => {
  it('migrates a v0 save to v1 (questFlags -> flags), exercising the migration mechanism', () => {
    const v0 = { schemaVersion: 0, seed: 1, gameTime: 0, questFlags: { met_werner: true }, world: { nextId: 1, entities: [] } };
    const migrated = migrateToCurrent(v0) as unknown as { schemaVersion: number; flags: Record<string, unknown>; questFlags?: unknown };
    expect(migrated.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(migrated.flags).toEqual({ met_werner: true });
    expect(migrated.questFlags).toBeUndefined();
  });

  it('refuses a save newer than the current schema', () => {
    expect(() => migrateToCurrent({ schemaVersion: SAVE_SCHEMA_VERSION + 1 })).toThrow(/newer/i);
  });
});

describe('assertSaveShape', () => {
  it('accepts a well-formed save and rejects shapes missing required arrays/fields', () => {
    const host = makeHost(1);
    populateWorld(host.world, 2);
    const save = buildSnapshot(host, AUTOSAVE_SLOT);
    expect(() => assertSaveShape(save)).not.toThrow();

    expect(() => assertSaveShape({})).toThrow(/schemaVersion/i);
    expect(() => assertSaveShape({ schemaVersion: 1, seed: 1, gameTime: 0, world: {}, rngState: { world: [] } })).toThrow(/world\.entities/i);
    expect(() => assertSaveShape({ schemaVersion: 1, seed: 1, gameTime: 0, world: { entities: [] }, rngState: {} })).toThrow(/rngState\.world/i);
  });
});

describe('corrupt / invalid saves', () => {
  it('decodeSave rejects corrupt bytes', async () => {
    const bad = new Uint8Array([ENCODING_GZIP, 9, 9, 9, 9, 9, 9, 9]); // gzip header, garbage body
    await expect(decodeSave(bad)).rejects.toThrow();
  });

  it('SaveService.load() catches a failure before the world is touched and returns to the pre-load state, not a hardcoded title', async () => {
    const bad = new Uint8Array([ENCODING_GZIP, 9, 9, 9, 9, 9, 9, 9]);
    const store = new MemoryStore();
    await store.put(5, bad, metaStub(5, new Date().toISOString()));

    // Starting state is 'paused' (distinct from 'title') so the assertion proves ctx.state.prev was
    // actually used to return to wherever the load was started from, not that 'title' happens to be
    // correct by coincidence — the pause menu's "load game" is exactly this scenario.
    const host = makeHost(1, { state: 'paused' });
    const { ui, toasts } = fakeUi();
    host.services.register('ui', ui);
    const stateEvents: unknown[] = [];
    host.events.on('request-state', (s) => stateEvents.push(s));

    const svc = createSaveService(host, store);
    await expect(svc.load(5)).resolves.toBeUndefined(); // load() must not throw — it catches internally

    expect(toasts.some((t) => /could not load save/i.test(t))).toBe(true);
    expect(stateEvents).toEqual(['loading', 'paused']);
  });

  it('a failure *after* the world has been reset still returns to title, not the stale pre-load state', async () => {
    const host1 = makeHost(2);
    populateWorld(host1.world, 3);
    const fixture = buildSnapshot(host1, AUTOSAVE_SLOT);
    const bytes = await encodeSave(fixture);
    const store = new MemoryStore();
    await store.put(AUTOSAVE_SLOT, bytes, metaFromSave(fixture, bytes.byteLength));

    const host2 = makeHost(0);
    host2.clock = new ThrowingClock(); // throws inside applyWorldState, *after* resetWorld()/world.load()
    const { ui } = fakeUi();
    host2.services.register('ui', ui);
    const stateEvents: unknown[] = [];
    host2.events.on('request-state', (s) => stateEvents.push(s));

    await createSaveService(host2, store).load(AUTOSAVE_SLOT);
    expect(stateEvents).toEqual(['loading', 'title']);
  });

  it('doLoad bails out (toast, no storage access) when the loading transition did not actually happen', async () => {
    // autoTransition: false simulates a real GameStateMachine refusing e.g. dialogue -> loading:
    // state.state never becomes 'loading' at all.
    const host = makeHost(1, { state: 'dialogue', autoTransition: false });
    const store = new MemoryStore();
    const getSpy = vi.spyOn(store, 'get');
    const { ui, toasts } = fakeUi();
    host.services.register('ui', ui);

    await createSaveService(host, store).load(1);

    expect(getSpy).not.toHaveBeenCalled(); // never touched storage
    expect(toasts.some((t) => /cannot load/i.test(t))).toBe(true);
    expect(host.state.state).toBe('dialogue'); // left exactly where it was
  });

  it('importJson rejects structurally invalid JSON with a clear error', async () => {
    const host = makeHost(1);
    const svc = createSaveService(host, new MemoryStore());
    await expect(svc.importJson('not json', 3)).rejects.toThrow(/invalid save json/i);
    await expect(svc.importJson('{}', 3)).rejects.toThrow();
    await expect(svc.importJson(JSON.stringify({ schemaVersion: 1 }), 3)).rejects.toThrow(/invalid save/i);
    await expect(svc.importJson(JSON.stringify({ schemaVersion: 1, seed: 1, gameTime: 0 }), 3)).rejects.toThrow(/world\.entities/i);
  });
});

describe('SaveService.load() success path', () => {
  it('restores world, calls quest.restore/exploration.setDiscovered/world.setWeather, streams around the player, and ends in explore', async () => {
    const host1 = makeHost(11);
    populateWorld(host1.world, 5);
    const fixture = buildSnapshot(host1, AUTOSAVE_SLOT);
    fixture.playerId = 1; // entity 1 exists (from populateWorld) and carries a Transform
    fixture.discovered = ['poi.fluelen'];
    fixture.weather = 'rain';
    fixture.season = 'winter';
    const bytes = await encodeSave(fixture);
    const store = new MemoryStore();
    await store.put(AUTOSAVE_SLOT, bytes, metaFromSave(fixture, bytes.byteLength));

    const host2 = makeHost(0);
    const { ui, loadingCalls } = fakeUi();
    const { quest, restoreCalls: questRestoreCalls } = fakeQuestService();
    const { exploration, setDiscoveredCalls } = fakeExplorationService(1);
    const { world, streamAroundCalls, setWeatherCalls, setSeasonCalls } = fakeWorldService();
    host2.services.register('ui', ui);
    host2.services.register('quest', quest);
    host2.services.register('exploration', exploration);
    host2.services.register('world', world);

    const stateEvents: unknown[] = [];
    host2.events.on('request-state', (s) => stateEvents.push(s));
    let worldCountAtLoaded = -1;
    host2.events.on('loaded', () => { worldCountAtLoaded = host2.world.count(); });

    await createSaveService(host2, store).load(AUTOSAVE_SLOT);

    expect(stateEvents).toEqual(['loading', 'explore']);
    expect(worldCountAtLoaded).toBe(5); // 'loaded' fires after the world is populated
    expect(questRestoreCalls).toHaveLength(1);
    expect((questRestoreCalls[0] as { chapter: string }).chapter).toBe(fixture.chapter);
    expect(setDiscoveredCalls).toEqual([['poi.fluelen']]);
    expect(streamAroundCalls).toHaveLength(1);
    expect(setWeatherCalls).toEqual(['rain']);
    expect(setSeasonCalls).toEqual(['winter']); // issue 1: season is restored via world.setSeason, not write-only
    expect(loadingCalls[loadingCalls.length - 1]).toBe(false);
  });

  it('restores a mid-combat save into the combat state and calls combat.restore', async () => {
    const host1 = makeHost(12);
    populateWorld(host1.world, 3);
    const { combat: combatForSave } = fakeCombatService({ active: true, serialized: sampleCombat() });
    host1.services.register('combat', combatForSave);
    const fixture = buildSnapshot(host1, AUTOSAVE_SLOT);
    fixture.playerId = 1;
    const bytes = await encodeSave(fixture);
    const store = new MemoryStore();
    await store.put(AUTOSAVE_SLOT, bytes, metaFromSave(fixture, bytes.byteLength));

    const host2 = makeHost(0);
    const { ui } = fakeUi();
    const { combat: combatForLoad, restoreCalls: combatRestoreCalls } = fakeCombatService({ active: false });
    host2.services.register('ui', ui);
    host2.services.register('combat', combatForLoad);
    const stateEvents: unknown[] = [];
    host2.events.on('request-state', (s) => stateEvents.push(s));

    await createSaveService(host2, store).load(AUTOSAVE_SLOT);

    expect(stateEvents).toEqual(['loading', 'combat']);
    expect(combatRestoreCalls).toHaveLength(1);
    expect(combatRestoreCalls[0].encounterId).toBe('enc.test');
  });
});

describe('SaveStore', () => {
  it('MemoryStore.list() orders by updatedAt desc; delete() removes a slot', async () => {
    const store = new MemoryStore();
    await store.put(1, new Uint8Array([0]), metaStub(1, '2026-01-01T00:00:00.000Z'));
    await store.put(2, new Uint8Array([0]), metaStub(2, '2026-03-01T00:00:00.000Z'));
    await store.put(3, new Uint8Array([0]), metaStub(3, '2026-02-01T00:00:00.000Z'));

    expect((await store.list()).map((m) => m.slot)).toEqual([2, 3, 1]);
    expect((await store.getMeta(3))?.updatedAt).toBe('2026-02-01T00:00:00.000Z'); // getMeta (issue 5): single-slot lookup

    await store.delete(2);
    expect((await store.list()).map((m) => m.slot)).toEqual([3, 1]);
    expect(await store.get(2)).toBeNull();
  });

  it('LocalStorageStore round-trips bytes/meta through a stub localStorage (base64)', async () => {
    const origLs = (globalThis as { localStorage?: Storage }).localStorage;
    (globalThis as { localStorage?: Storage }).localStorage = makeStubLocalStorage();
    try {
      const store = new LocalStorageStore();
      const bytes = new Uint8Array([1, 2, 3, 4, 250, 251]);
      await store.put(1, bytes, metaStub(1, '2026-01-01T00:00:00.000Z'));
      expect(await store.get(1)).toEqual(bytes);
      expect((await store.list()).map((m) => m.slot)).toEqual([1]);
      expect((await store.getMeta(1))?.slot).toBe(1); // getMeta (issue 5)
      await store.delete(1);
      expect(await store.get(1)).toBeNull();
      expect(await store.list()).toEqual([]);
    } finally {
      (globalThis as { localStorage?: Storage }).localStorage = origLs;
    }
  });

  it('IndexedDbStore round-trips through a minimal in-memory IDBFactory stub', async () => {
    const { uninstall } = installFakeIndexedDb();
    try {
      const store = new IndexedDbStore();
      const bytes = new Uint8Array([9, 8, 7]);
      await store.put(1, bytes, metaStub(1, '2026-01-01T00:00:00.000Z'));
      expect(await store.get(1)).toEqual(bytes);
      expect((await store.list()).map((m) => m.slot)).toEqual([1]);
      expect((await store.getMeta(1))?.slot).toBe(1); // getMeta (issue 5)
      await store.delete(1);
      expect(await store.get(1)).toBeNull();
    } finally {
      uninstall();
    }
  });

  it('ResilientStore falls back to the secondary store (and stays there) the first time the primary throws', async () => {
    let calls = 0;
    const alwaysFails: { get: () => Promise<null>; getMeta: () => Promise<null>; put: () => Promise<void>; delete: () => Promise<void>; list: () => Promise<never[]> } = {
      get: async () => { calls++; throw new Error('boom'); },
      getMeta: async () => { calls++; throw new Error('boom'); },
      put: async () => { calls++; throw new Error('boom'); },
      delete: async () => { calls++; throw new Error('boom'); },
      list: async () => { calls++; throw new Error('boom'); },
    };
    const fallback = new MemoryStore();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resilient = new ResilientStore(alwaysFails as any, fallback, 'memory');

    await resilient.put(1, new Uint8Array([1]), metaStub(1, '2026-01-01T00:00:00.000Z'));
    expect(calls).toBe(1); // tried the primary once, then fell back
    expect(await fallback.get(1)).toEqual(new Uint8Array([1]));

    await resilient.put(2, new Uint8Array([2]), metaStub(2, '2026-01-02T00:00:00.000Z'));
    expect(calls).toBe(1); // stayed on the fallback; primary not retried
    expect(await fallback.get(2)).toEqual(new Uint8Array([2]));
    expect((await resilient.getMeta(2))?.slot).toBe(2); // getMeta forwards through the fallback too
  });

  it('createSaveStore() picks IndexedDB when available, and falls back cleanly when IndexedDB.open() throws', async () => {
    // Case 1: healthy fake IndexedDB is used directly.
    {
      const { uninstall } = installFakeIndexedDb();
      try {
        const store = createSaveStore();
        await store.put(9, new Uint8Array([1]), metaStub(9, new Date().toISOString()));
        expect(await store.get(9)).toEqual(new Uint8Array([1]));
      } finally {
        uninstall();
      }
    }
    // Case 2: IndexedDB errors on open (e.g. private mode) -> falls back to localStorage.
    {
      const { uninstall } = installFakeIndexedDb({ failOpen: true });
      const origLs = (globalThis as { localStorage?: Storage }).localStorage;
      (globalThis as { localStorage?: Storage }).localStorage = makeStubLocalStorage();
      try {
        const store = createSaveStore();
        await store.put(10, new Uint8Array([2]), metaStub(10, new Date().toISOString()));
        expect(await store.get(10)).toEqual(new Uint8Array([2]));
      } finally {
        uninstall();
        (globalThis as { localStorage?: Storage }).localStorage = origLs;
      }
    }
  });
});

describe('SaveService import/export', () => {
  it('exportJson / importJson round-trip a save, with a slot-independent calendar label', async () => {
    const host = makeHost(99);
    populateWorld(host.world, 10);
    host.clock.set(gameTimeFor(1315, 11, 15, 7, 30));
    const store = new MemoryStore();
    const svc = createSaveService(host, store);

    const meta = await svc.save(3, 'Export Test');
    expect(meta.slot).toBe(3);
    expect(meta.calendar).toBe('15 November 1315, 07:30');

    const json = await svc.exportJson(3);
    const parsed = JSON.parse(json);
    expect(parsed.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(parsed.world.entities.length).toBe(10);

    // Import while the host's *live* clock is at a totally different date: the imported save's
    // meta.calendar must reflect the save's own gameTime, not whatever date host.clock is at now.
    host.clock.set(gameTimeFor(1291, 8, 1, 6, 0));
    const imported = await svc.importJson(json, 4);
    expect(imported.slot).toBe(4);
    expect(imported.calendar).toBe('15 November 1315, 07:30');

    const list = await svc.list();
    expect(list.map((m) => m.slot).sort()).toEqual([3, 4]);
  });

  it('save() preserves createdAt across an overwrite of the same slot, reading it from SaveMeta (no re-decode)', async () => {
    const host = makeHost(1);
    populateWorld(host.world, 2);
    const store = new MemoryStore();
    const svc = createSaveService(host, store);

    const first = await svc.save(AUTOSAVE_SLOT);
    await flush(5);
    const second = await svc.save(AUTOSAVE_SLOT);

    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt >= first.updatedAt).toBe(true);
  });
});

describe('slot layout (@core/schemas)', () => {
  it('quicksave uses a dedicated slot outside the manual range, distinct from the autosave slot', () => {
    expect(AUTOSAVE_SLOT).toBe(0);
    expect(MANUAL_SLOTS).toContain(1);
    expect(MANUAL_SLOTS).not.toContain(QUICKSAVE_SLOT);
    expect(QUICKSAVE_SLOT).not.toBe(AUTOSAVE_SLOT);
  });
});

describe('register(): autosave scheduling and gating', () => {
  it('defers autosave requests raised outside explore, and fires once back in explore', async () => {
    const fakeScheduler = {
      systems: [] as { name: string; phase: string; update: (dt: number) => void }[],
      add(s: { name: string; phase: string; update: (dt: number) => void }) { this.systems.push(s); },
    };
    const stateHolder = { state: 'dialogue' };
    const baseHost = makeHost(1);
    const ctx = {
      ...baseHost,
      scheduler: fakeScheduler,
      state: stateHolder,
    };

    await register(ctx as unknown as GameContext);
    const svc = ctx.services.get('save');

    const sys = fakeScheduler.systems.find((s) => s.name === 'save-autosave');
    expect(sys).toBeTruthy();

    // chapter-changed requests an autosave; state is 'dialogue', so it must be deferred, not fired.
    ctx.events.emit('chapter-changed', 'ch1-1307');
    sys!.update(1.5);
    await flush();
    expect(await svc.list()).toHaveLength(0);

    // Back in explore: the next scheduler tick must pick up the deferred autosave.
    stateHolder.state = 'explore';
    sys!.update(1.5);
    await flush();
    const list = await svc.list();
    expect(list.map((m) => m.slot)).toContain(AUTOSAVE_SLOT);
  });

  it('clears a deferred autosave on load-finish (loaded) and load-start (state-changed -> loading), so it cannot fire stale afterward', async () => {
    const fakeScheduler = {
      systems: [] as { name: string; update: (dt: number) => void }[],
      add(s: { name: string; update: (dt: number) => void }) { this.systems.push(s); },
    };
    const stateHolder = { state: 'dialogue' };
    const ctx = { ...makeHost(1), scheduler: fakeScheduler, state: stateHolder };
    await register(ctx as unknown as GameContext);
    const svc = ctx.services.get('save');
    const sys = fakeScheduler.systems.find((s) => s.name === 'save-autosave')!;

    ctx.events.emit('chapter-changed', 'ch1-1307'); // defers an autosave (state is 'dialogue')
    ctx.events.emit('loaded'); // a load just finished -> the stale deferred request must not survive it
    stateHolder.state = 'explore';
    sys.update(1.5);
    await flush();
    expect(await svc.list()).toHaveLength(0);

    stateHolder.state = 'dialogue'; // back to a non-explore state so the next request defers again
    ctx.events.emit('chapter-changed', 'ch1-1307'); // defer another one
    ctx.events.emit('state-changed', 'explore', 'loading'); // a load *beginning* also clears it
    stateHolder.state = 'explore';
    sys.update(1.5);
    await flush();
    expect(await svc.list()).toHaveLength(0);
  });

  it('autosaves immediately (not deferred) on the explore->combat transition, carrying the combat block', async () => {
    const fakeScheduler = { systems: [] as { name: string; update: (dt: number) => void }[], add(s: { name: string; update: (dt: number) => void }) { this.systems.push(s); } };
    const stateHolder = { state: 'explore' };
    const baseHost = makeHost(1);
    populateWorld(baseHost.world, 2);
    const { combat } = fakeCombatService({ active: true, serialized: sampleCombat() });
    baseHost.services.register('combat', combat);
    const ctx = { ...baseHost, scheduler: fakeScheduler, state: stateHolder };

    await register(ctx as unknown as GameContext);
    const svc = ctx.services.get('save');

    ctx.events.emit('state-changed', 'explore', 'combat');
    await flush();

    const list = await svc.list();
    expect(list.map((m) => m.slot)).toContain(AUTOSAVE_SLOT);
    const exported = JSON.parse(await svc.exportJson(AUTOSAVE_SLOT));
    expect(exported.combat.encounterId).toBe('enc.test');
  });

  it('never autosaves on explore->dialogue or other non-combat transitions', async () => {
    const fakeScheduler = { systems: [] as { name: string; update: (dt: number) => void }[], add(s: { name: string; update: (dt: number) => void }) { this.systems.push(s); } };
    const stateHolder = { state: 'explore' };
    const ctx = { ...makeHost(1), scheduler: fakeScheduler, state: stateHolder };
    await register(ctx as unknown as GameContext);
    const svc = ctx.services.get('save');

    ctx.events.emit('state-changed', 'explore', 'dialogue');
    await flush();
    expect(await svc.list()).toHaveLength(0);
  });

  it('registering twice (e.g. HMR re-eval) does not double-register the service', async () => {
    const fakeScheduler = { systems: [] as unknown[], add(s: unknown) { this.systems.push(s); } };
    const ctx = { ...makeHost(1), scheduler: fakeScheduler };
    await register(ctx as unknown as GameContext);
    const firstCount = fakeScheduler.systems.length;
    await register(ctx as unknown as GameContext);
    expect(fakeScheduler.systems.length).toBe(firstCount); // second call was a no-op
  });
});
