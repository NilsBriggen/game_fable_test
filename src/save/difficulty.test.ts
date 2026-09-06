/** 4.4: difficulty metadata round-trips through buildSnapshot → encode → decode → applyDifficulty. */
import { describe, it, expect } from 'vitest';
import { World } from '@core/ecs';
import { RngStreams } from '@core/rng';
import { GameClock } from '@core/clock';
import { EventBus } from '@core/events';
import type { GameEvents } from '@core/events';
import { ServiceRegistry } from '@core/services';
import { defaultSettings } from '@core/context';
import type { SaveHost } from './host';
import { MemoryStore, encodeSave, decodeSave } from './db';
import { buildSnapshot, applyDifficulty } from './snapshot';
import { createSaveService } from './index';

function makeHost(seed: number, difficulty?: unknown): SaveHost {
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
    settings: { ...defaultSettings(), difficulty: (difficulty ?? 'normal') as never },
  };
  return host;
}

describe('difficulty save metadata (4.4)', () => {
  it('buildSnapshot records the live difficulty; absent/unknown loads as normal (no migration)', async () => {
    const host = makeHost(5, 'hard');
    const save = buildSnapshot(host, 1, 'Hard Save');
    expect(save.difficulty).toBe('hard');

    const bytes = await encodeSave(save);
    const decoded = await decodeSave(bytes);
    const host2 = makeHost(0, 'story'); // live game on a different mode
    expect(applyDifficulty(host2, decoded)).toBe('hard');
    expect(host2.settings?.difficulty).toBe('hard');

    // old saves omit the field entirely → normal, no crash, no migration
    const legacy = { ...decoded } as Record<string, unknown>;
    delete legacy.difficulty;
    const host3 = makeHost(0, 'hard');
    expect(applyDifficulty(host3, legacy)).toBe('normal');
    expect(host3.settings?.difficulty).toBe('normal');

    // hand-edited garbage → normal
    expect(applyDifficulty(makeHost(0), { difficulty: 'nightmare' })).toBe('normal');
  });

  it('SaveService save→load restores difficulty into the loading host', async () => {
    const host1 = makeHost(11, 'story');
    const store = new MemoryStore();
    const svc1 = createSaveService(host1, store);
    await svc1.save(2, 'Story Save');
    const exported = JSON.parse(await svc1.exportJson(2));
    expect(exported.difficulty).toBe('story');

    const host2 = makeHost(0, 'hard');
    // mirror doLoad's legal-transition wiring: request-state -> state machine
    host2.events.on('request-state', (to) => {
      const st = host2.state as { state: string; prev: string };
      if (to !== st.state) { st.prev = st.state; st.state = to as string; }
    });
    const svc2 = createSaveService(host2, store);
    await svc2.load(2);
    expect(host2.settings?.difficulty).toBe('story');
  });
});
