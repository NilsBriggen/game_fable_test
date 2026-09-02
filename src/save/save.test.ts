import { describe, it, expect } from 'vitest';
import { World } from '@core/ecs';
import { RngStreams } from '@core/rng';
import { GameClock, gameTimeFor } from '@core/clock';
import { EventBus } from '@core/events';
import type { GameEvents } from '@core/events';
import { ServiceRegistry } from '@core/services';
import type { UiService } from '@core/services';
import { Transform, Name, Character, Skills, Inventory } from '@core/components';
import { SAVE_SCHEMA_VERSION, SAVE_MAX_BYTES } from '@core/schemas';
import type { SaveMeta } from '@core/schemas';

import type { SaveHost } from './host';
import { MemoryStore, encodeSave, decodeSave, ENCODING_GZIP, ENCODING_RAW } from './db';
import { buildSnapshot, applyWorldState } from './snapshot';
import { migrateToCurrent } from './migrations';
import { createSaveService } from './index';

// ---------------- test helpers ----------------

/** A SaveHost backed by real (non-WebGL) core classes — GameContext satisfies this structurally,
 * but constructing GameContext itself would create a WebGLRenderer, which is unavailable in Node. */
function makeHost(seed: number): SaveHost {
  const host: SaveHost = {
    world: new World(),
    rng: new RngStreams(seed),
    clock: new GameClock(),
    events: new EventBus<GameEvents>(),
    services: new ServiceRegistry(),
    state: { state: 'explore' },
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

function metaStub(slot: number, updatedAt: string): SaveMeta {
  return { slot, label: `Slot ${slot}`, updatedAt, chapter: 'c', calendar: 'c', location: 'l', playtimeSec: 0, schemaVersion: SAVE_SCHEMA_VERSION, bytes: 1 };
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

describe('corrupt saves', () => {
  it('decodeSave rejects corrupt bytes', async () => {
    const bad = new Uint8Array([ENCODING_GZIP, 9, 9, 9, 9, 9, 9, 9]); // gzip header, garbage body
    await expect(decodeSave(bad)).rejects.toThrow();
  });

  it('SaveService.load() catches a corrupt save, toasts a warning, and returns to title', async () => {
    const bad = new Uint8Array([ENCODING_GZIP, 9, 9, 9, 9, 9, 9, 9]);
    const store = new MemoryStore();
    await store.put(5, bad, metaStub(5, new Date().toISOString()));

    const host = makeHost(1);
    const { ui, toasts } = fakeUi();
    host.services.register('ui', ui);
    const stateEvents: unknown[] = [];
    host.events.on('request-state', (s) => stateEvents.push(s));

    const svc = createSaveService(host, store);
    await expect(svc.load(5)).resolves.toBeUndefined(); // load() must not throw — it catches internally

    expect(toasts.some((t) => /could not load save/i.test(t))).toBe(true);
    expect(stateEvents).toEqual(['loading', 'title']);
  });
});

describe('SaveStore', () => {
  it('MemoryStore.list() orders by updatedAt desc; delete() removes a slot', async () => {
    const store = new MemoryStore();
    await store.put(1, new Uint8Array([0]), metaStub(1, '2026-01-01T00:00:00.000Z'));
    await store.put(2, new Uint8Array([0]), metaStub(2, '2026-03-01T00:00:00.000Z'));
    await store.put(3, new Uint8Array([0]), metaStub(3, '2026-02-01T00:00:00.000Z'));

    expect((await store.list()).map((m) => m.slot)).toEqual([2, 3, 1]);

    await store.delete(2);
    expect((await store.list()).map((m) => m.slot)).toEqual([3, 1]);
    expect(await store.get(2)).toBeNull();
  });
});

describe('SaveService import/export', () => {
  it('exportJson / importJson round-trip a save', async () => {
    const host = makeHost(99);
    populateWorld(host.world, 10);
    const store = new MemoryStore();
    const svc = createSaveService(host, store);

    const meta = await svc.save(3, 'Export Test');
    expect(meta.slot).toBe(3);

    const json = await svc.exportJson(3);
    const parsed = JSON.parse(json);
    expect(parsed.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(parsed.world.entities.length).toBe(10);

    const imported = await svc.importJson(json, 4);
    expect(imported.slot).toBe(4);
    const list = await svc.list();
    expect(list.map((m) => m.slot).sort()).toEqual([3, 4]);
  });
});
