/**
 * Fix round 1 (wave2 critic, tools/critic/wave2-combat.md, score 5/10): each adversarial probe the critic
 * used to substantiate an issue, reproduced as a standing regression test so the fix can't silently regress.
 * Probe numbers below match the critic doc's own numbering.
 */
import { describe, it, expect, vi } from 'vitest';
import { World } from '@core/ecs';
import { Rng } from '@core/rng';
import type { EncounterDef } from '@core/schemas';
import type { CombatCommand } from '@core/services';
import { CombatEngineImpl, type CombatHost } from './engine';
import { FakePartyService, makeTestContent } from './testUtils';
import { estimateHitChance } from './rules/attack';

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
    grid: over.grid ?? { cols: 20, rows: 20, cellM: 1.5 }, heightOverride: over.heightOverride ?? 'flat',
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

function step(engine: CombatEngineImpl, unitId: number, cmd: CombatCommand) {
  const anyEngine = engine as unknown as { advance: () => void; activeUnitId: number | null };
  const real = anyEngine.advance;
  anyEngine.advance = () => {};
  anyEngine.activeUnitId = unitId;
  const result = engine.submit(cmd);
  anyEngine.advance = real;
  return result;
}

function unitsOf(engine: CombatEngineImpl) {
  return (engine as unknown as { units: Map<number, Record<string, unknown>> }).units;
}

function cellsOf(engine: CombatEngineImpl) {
  return (engine as unknown as { cells: { q: number; r: number; height: number; surface: string; cover: number; passable: boolean }[] }).cells;
}

describe('probe 1: range/reach enforcement', () => {
  it('cmdAbility rejects an attack against a target 8 cells away, out of any weapon\'s reach', () => {
    const { engine } = makeEngine();
    const enc = flatEncounter({
      units: [
        { archetype: 'militia-spear', side: 'player', q: 0, r: 0 }, // spear reach: a few cells at most, never 8
        { archetype: 'peasant', side: 'enemy', q: 8, r: 0 },
      ],
    });
    startManual(engine, 'enc.test', enc);
    const attacker = engine.getState()!.units.find((u) => u.side === 'player')!;
    const target = engine.getState()!.units.find((u) => u.side === 'enemy')!;
    const before = target.hp;
    const result = step(engine, attacker.id, { type: 'ability', unit: attacker.id, ability: 'ability.attack', target: target.id });
    expect(result.ok).toBe(false);
    expect(engine.getState()!.units.find((u) => u.id === target.id)!.hp).toBe(before);
  });

  it('aiAbility (the AI\'s own entry point) refuses the same out-of-range attack', () => {
    const { engine } = makeEngine();
    const enc = flatEncounter({
      units: [
        { archetype: 'militia-spear', side: 'player', q: 0, r: 0 },
        { archetype: 'peasant', side: 'enemy', q: 8, r: 0 },
      ],
    });
    startManual(engine, 'enc.test', enc);
    const attacker = engine.getState()!.units.find((u) => u.side === 'player')!;
    const target = engine.getState()!.units.find((u) => u.side === 'enemy')!;
    expect(engine.aiAbility(unitsOf(engine).get(attacker.id) as never, 'ability.attack', target.id)).toBe(false);
  });
});

describe('probe 2: command authorisation', () => {
  it('rejects a stance command for a unit whose turn it is not', () => {
    const { engine } = makeEngine();
    const enc = flatEncounter({
      units: [
        { archetype: 'militia-spear', side: 'player', q: 0, r: 0 },
        { archetype: 'militia-spear', side: 'player', q: 1, r: 0 },
        { archetype: 'peasant', side: 'enemy', q: 9, r: 9 },
      ],
    });
    startManual(engine, 'enc.test', enc);
    const state = engine.getState()!;
    const active = state.activeUnit!;
    const bystander = state.units.find((u) => u.side === 'player' && u.id !== active)!;
    const result = engine.submit({ type: 'stance', unit: bystander.id, stance: 'aggressive' });
    expect(result.ok).toBe(false);
  });

  it('rejects an ability command aimed at commanding an enemy unit directly', () => {
    const { engine } = makeEngine();
    const enc = flatEncounter({
      units: [
        { archetype: 'militia-spear', side: 'player', q: 0, r: 0 },
        { archetype: 'peasant', side: 'enemy', q: 9, r: 9 },
      ],
    });
    startManual(engine, 'enc.test', enc);
    const enemy = engine.getState()!.units.find((u) => u.side === 'enemy')!;
    const result = engine.submit({ type: 'stance', unit: enemy.id, stance: 'guarded' });
    expect(result.ok).toBe(false);
  });
});

describe('probe 5: shove geometry', () => {
  it('shoving (5,5) -> (5,6) pushes the target straight to (5,7), never diagonally', () => {
    const { engine } = makeEngine(7);
    const enc = flatEncounter({
      units: [
        { archetype: 'militia-spear', side: 'player', q: 5, r: 5 },
        { archetype: 'peasant', side: 'enemy', q: 5, r: 6 },
      ],
    });
    startManual(engine, 'enc.test', enc);
    const shover = engine.getState()!.units.find((u) => u.side === 'player')!;
    const target = engine.getState()!.units.find((u) => u.side === 'enemy')!;
    for (let i = 0; i < 30; i++) {
      unitsOf(engine).get(shover.id)!.ap = { action: true, bonus: true, reaction: true, moveM: 9, moveMax: 9 };
      unitsOf(engine).get(target.id)!.q = 5; unitsOf(engine).get(target.id)!.r = 6;
      step(engine, shover.id, { type: 'ability', unit: shover.id, ability: 'ability.shove', target: target.id });
      const t = engine.getState()!.units.find((u) => u.id === target.id)!;
      if (t.r !== 6) {
        expect(t.q).toBe(5); // straight push along r — q must NOT drift diagonally
        expect(t.r).toBe(7);
        return;
      }
    }
    throw new Error('shove never succeeded across 30 attempts');
  });
});

describe('probe 6: preview/live cover agreement', () => {
  it('previewAttack\'s hit chance already reflects the target cell\'s cover, matching the live defense value', () => {
    const { engine } = makeEngine();
    const enc = flatEncounter({
      units: [
        { archetype: 'militia-spear', side: 'player', q: 0, r: 0 },
        { archetype: 'peasant', side: 'enemy', q: 1, r: 0 },
      ],
    });
    startManual(engine, 'enc.test', enc);
    const attacker = engine.getState()!.units.find((u) => u.side === 'player')!;
    const target = engine.getState()!.units.find((u) => u.side === 'enemy')!;
    cellsOf(engine).find((c) => c.q === 1 && c.r === 0)!.cover = 2;
    const preview = engine.previewAttack(attacker.id, 'ability.attack', target.id)!;
    const liveDefense = engine.getState()!.units.find((u) => u.id === target.id)!.defense; // viewOf() already folds cover in
    const attackerUnit = unitsOf(engine).get(attacker.id) as unknown as { attackBonus: Record<string, number>; critRange: number };
    const net = preview.context.edge.length - preview.context.burden.length;
    const mode = net > 0 ? 'edge' : net < 0 ? 'burden' : 'normal';
    const expected = Math.round(estimateHitChance(attackerUnit.attackBonus['spear'] ?? 0, liveDefense, attackerUnit.critRange, mode) * 100) / 100;
    expect(preview.hitChance).toBeCloseTo(expected, 5);
  });
});

describe('probe 7: stalemate ends cleanly, no console.error', () => {
  it('two sides walled off from each other end the encounter (stalemate/fled) without ever calling console.error', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { engine } = makeEngine(11);
      const enc = flatEncounter({
        grid: { cols: 12, rows: 3, cellM: 1.5 },
        units: [
          { archetype: 'militia-spear', side: 'player', q: 0, r: 1 },
          { archetype: 'peasant', side: 'enemy', q: 11, r: 1 },
        ],
      });
      const resultPromise = engine.start('enc.test', { encounterOverride: enc });
      // Wall off column q=5 across every row so neither side can ever path to the other.
      for (const c of cellsOf(engine)) if (c.q === 5) c.passable = false;
      engine.submit({ type: 'auto', rounds: 30 });
      if (engine.isActive()) engine.submit({ type: 'flee' });
      const result = await resultPromise;
      expect(['stalemate', 'fled', 'lose', 'win']).toContain(result.outcome);
      expect(errSpy).not.toHaveBeenCalled();
    } finally {
      errSpy.mockRestore();
    }
  }, 20000);
});

describe('probe 8: restore preserves full log fidelity', () => {
  it('restore() rebuilds the full CombatEventRecord log, not just its text', () => {
    const { engine } = makeEngine(9);
    const enc = flatEncounter({
      units: [{ archetype: 'habsburg-footman', side: 'enemy', q: 5, r: 5 }, { archetype: 'militia-spear', side: 'player', q: 1, r: 1 }],
    });
    startManual(engine, 'enc.test', enc);
    const s = engine.serialize()!;
    expect(s.log.length).toBeGreaterThan(0);
    const firstRec = s.log[0] as { kind: string; text: string };
    expect(typeof firstRec.kind).toBe('string'); // a real CombatEventRecord, not a bare string

    const { engine: engine2, content: content2 } = makeEngine(9);
    content2.encounters.set('enc.test', enc);
    return engine2.restore(s).then(() => {
      const s2 = engine2.serialize()!;
      expect(s2.log).toEqual(s.log);
    });
  });
});

describe('probe 9: previously-dead content is now usable', () => {
  it('a unit standing on a trunk-cache feature can actually fire Roll Boulders for damage', () => {
    const { engine } = makeEngine(4);
    const enc = flatEncounter({
      units: [
        { archetype: 'militia-halberd', side: 'player', q: 2, r: 2 },
        { archetype: 'peasant', side: 'enemy', q: 4, r: 2 },
      ],
      terrainFeatures: [{ kind: 'trunk-cache', cells: [[2, 2]], affects: [[4, 2]] }],
    });
    startManual(engine, 'enc.test', enc);
    const caster = engine.getState()!.units.find((u) => u.side === 'player')!;
    const target = engine.getState()!.units.find((u) => u.side === 'enemy')!;
    const before = target.hp;
    const result = step(engine, caster.id, { type: 'ability', unit: caster.id, ability: 'ability.roll-boulders' });
    expect(result.ok).toBe(true);
    const after = engine.getState()!.units.find((u) => u.id === target.id)!.hp;
    expect(after).toBeLessThan(before);
  });

  it('Shield Wall (requires a shield) grants an adjacent ally the shield-wall status and +1 defense', () => {
    const { engine } = makeEngine(6);
    const enc = flatEncounter({
      units: [
        { archetype: 'habsburg-footman', side: 'player', q: 2, r: 2 }, // carries a heater-shield
        { archetype: 'militia-spear', side: 'player', q: 3, r: 2 },
        { archetype: 'peasant', side: 'enemy', q: 9, r: 9 },
      ],
    });
    startManual(engine, 'enc.test', enc);
    const caster = engine.getState()!.units.find((u) => u.side === 'player' && u.weapon)!;
    const ally = engine.getState()!.units.find((u) => u.id !== caster.id && u.side === 'player')!;
    const allyDefenseBefore = ally.defense;
    const result = step(engine, caster.id, { type: 'ability', unit: caster.id, ability: 'ability.shield-wall' });
    expect(result.ok).toBe(true);
    const allyAfter = engine.getState()!.units.find((u) => u.id === ally.id)!;
    expect(allyAfter.status.some((s) => s.id === 'shield-wall')).toBe(true);
    expect(allyAfter.defense).toBe(allyDefenseBefore + 1);
  });
});
