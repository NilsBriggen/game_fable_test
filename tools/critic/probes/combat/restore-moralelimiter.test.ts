import { describe, it, expect } from 'vitest';
import { World } from '@core/ecs';
import { Rng } from '@core/rng';
import type { EncounterDef } from '@core/schemas';
import { CombatEngineImpl, type CombatHost } from '../../../../src/combat/engine';
import { FakePartyService, makeTestContent } from '../../../../src/combat/testUtils';

// engine.ts's own comment (line ~110): "issue 8: at most one morale check per unit per *reason* per round
// (reset each `startRound`)" — tryMoraleTrigger() uses the private `moraleCheckedThisRound` Map to enforce
// this. But serialize() (engine.ts:1767) never writes that Map into SerializedCombat, and restore()
// (engine.ts:1793) calls resetState() and never repopulates it from the save — so a save/load performed
// mid-round silently forgets which (unit, reason) pairs were already checked THIS round, and the same
// (unit, reason) can trigger a second, independent morale roll in the very same round it already resolved
// one for. That's a genuine save/restore round-trip field loss, not just theoretical: it's reachable by any
// quicksave/quickload during a round where a morale trigger already fired.

function makeEngine(seed = 42) {
  const world = new World();
  const content = makeTestContent();
  const party = new FakePartyService(world, content);
  const rng = new Rng(seed);
  const host: CombatHost = { world, content, party, rng };
  const engine = new CombatEngineImpl(host);
  return { engine, world, content, party, rng };
}

function flatEncounter(over: Partial<EncounterDef> & { units: EncounterDef['units'] }): EncounterDef {
  return {
    id: over.id ?? 'enc.test', name: over.name ?? 'Test', location: { x: 0, z: 0, yaw: 0 },
    grid: over.grid ?? { cols: 10, rows: 10, cellM: 1.5 }, heightOverride: over.heightOverride ?? 'flat',
    deploy: over.deploy ?? { q: 0, r: 0, cols: 2, rows: 2 }, units: over.units,
    objectives: over.objectives ?? [{ type: 'defeat-all' }], loseObjectives: over.loseObjectives,
    terrainFeatures: over.terrainFeatures, scripted: over.scripted,
    historical: 'invented', note: 'test fixture', description: 'test fixture',
  };
}

function startManual(engine: CombatEngineImpl, encId: string, enc: EncounterDef) {
  const anyEngine = engine as unknown as { advance: () => void };
  const real = anyEngine.advance.bind(engine);
  anyEngine.advance = () => {};
  const resultPromise = engine.start(encId, { encounterOverride: enc });
  anyEngine.advance = real;
  return resultPromise;
}

type EngineInternals = {
  tryMoraleTrigger: (u: unknown, reason: string, dc: number) => void;
  log: { kind: string; text: string; unit?: number }[];
};

describe('bug: restore() loses the per-round morale-check limiter', () => {
  it('a (unit, reason) pair already checked this round can be checked again right after a save/restore', async () => {
    const enc = flatEncounter({ units: [{ archetype: 'peasant', side: 'enemy', q: 5, r: 5 }, { archetype: 'peasant', side: 'player', q: 1, r: 1 }] });

    const { engine } = makeEngine(7);
    startManual(engine, 'enc.test', enc);
    const target = engine.getState()!.units.find((u) => u.side === 'enemy')!;
    const internalTarget = (engine as unknown as { units: Map<number, unknown> }).units.get(target.id);
    const eng = engine as unknown as EngineInternals;

    eng.tryMoraleTrigger(internalTarget, 'damage', 10);
    const moraleLogsAfterFirst = eng.log.filter((l) => l.kind === 'morale' && l.unit === target.id).length;
    expect(moraleLogsAfterFirst).toBe(1);

    eng.tryMoraleTrigger(internalTarget, 'damage', 10); // same reason, same round: must be a no-op
    const moraleLogsAfterSecond = eng.log.filter((l) => l.kind === 'morale' && l.unit === target.id).length;
    expect(moraleLogsAfterSecond).toBe(1); // confirmed: the limiter works pre-restore

    // Round-trip through serialize()/restore(), as a save/quickload would.
    const snapshot = engine.serialize()!;
    const { engine: engine2, content: content2 } = makeEngine(7);
    (content2 as unknown as { encounters: Map<string, EncounterDef> }).encounters.set('enc.test', enc);
    await engine2.restore(snapshot);

    const eng2 = engine2 as unknown as EngineInternals;
    const internalTarget2 = (engine2 as unknown as { units: Map<number, unknown> }).units.get(target.id);
    eng2.tryMoraleTrigger(internalTarget2, 'damage', 10); // same round, same reason, right after restore

    const moraleLogsAfterRestore = eng2.log.filter((l) => l.kind === 'morale' && l.unit === target.id).length;
    // EXPECTED (limiter should have round-tripped): stays 1 (still suppressed this round).
    // ACTUAL: moraleCheckedThisRound was not serialized/restored, so this fires a brand new roll -> 2.
    expect(moraleLogsAfterRestore).toBe(1); // <-- fails: actual value is 2
  });
});
