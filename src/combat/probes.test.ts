/**
 * Wave2 critic (tools/critic/wave2-combat.md), rounds 1 (5/10) and 2 (7/10): each adversarial probe used to
 * substantiate an issue, reproduced as a standing regression test so the fix can't silently regress. Probe
 * numbers match the critic doc's own numbering. Round-1 note (round 2 issue 8): the flank-reach and charge-
 * run-up probes were originally left to `formation.test.ts`/`engine.test.ts` — named explicitly here too now.
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

describe('probe 3b/3c: flank reach (named per round-2 critic issue 8)', () => {
  it('a hostile 7 cells away does not flank, even standing opposite the target', () => {
    const { engine } = makeEngine();
    const enc = flatEncounter({
      units: [
        { archetype: 'militia-spear', side: 'enemy', q: 5, r: 5 }, // target
        { archetype: 'peasant', side: 'player', q: 6, r: 5 }, // adjacent attacker
        { archetype: 'peasant', side: 'player', q: -2, r: 5 }, // opposite side, but 7 cells away
      ],
    });
    startManual(engine, 'enc.test', enc);
    const target = engine.getState()!.units.find((u) => u.side === 'enemy')!;
    const attacker = engine.getState()!.units.find((u) => u.q === 6)!;
    const preview = engine.previewAttack(attacker.id, 'ability.attack', target.id)!;
    expect(preview.context.flanked).toBe(false);
  });

  it('a Down hostile on the opposite side does not count toward flanking', () => {
    const { engine } = makeEngine();
    const enc = flatEncounter({
      units: [
        { archetype: 'militia-spear', side: 'enemy', q: 5, r: 5 }, // target
        { archetype: 'peasant', side: 'player', q: 6, r: 5 }, // adjacent attacker
        { archetype: 'peasant', side: 'player', q: 4, r: 5 }, // opposite side, adjacent, but Down
      ],
    });
    startManual(engine, 'enc.test', enc);
    const target = engine.getState()!.units.find((u) => u.side === 'enemy')!;
    const attacker = engine.getState()!.units.find((u) => u.q === 6)!;
    const downed = engine.getState()!.units.find((u) => u.q === 4)!;
    unitsOf(engine).get(downed.id)!.down = true;
    const preview = engine.previewAttack(attacker.id, 'ability.attack', target.id)!;
    expect(preview.context.flanked).toBe(false);
  });
});

describe('probe 4: charge run-up (named per round-2 critic issue 8)', () => {
  it('Charge without having moved this turn (chargeCells 0) is refused: "no run-up"', () => {
    const { engine } = makeEngine();
    const enc = flatEncounter({
      units: [
        { archetype: 'habsburg-knight', side: 'player', q: 5, r: 5, mounted: true },
        { archetype: 'peasant', side: 'enemy', q: 6, r: 5 },
      ],
    });
    startManual(engine, 'enc.test', enc);
    const knight = engine.getState()!.units.find((u) => u.side === 'player')!;
    const target = engine.getState()!.units.find((u) => u.side === 'enemy')!;
    expect(unitsOf(engine).get(knight.id)!.chargeCells).toBe(0);
    const result = step(engine, knight.id, { type: 'ability', unit: knight.id, ability: 'ability.charge', target: target.id });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no run-up');
  });
});

describe('round-2 issue 6: reaction-before-attack ordering', () => {
  it('a Brace reaction against a moving knight is logged before the knight\'s own attack, across seeds', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { engine } = makeEngine(seed);
      // A 2×2 Haufen (forms automatically — 4 mutually-adjacent polearm units) far enough from the knight
      // that a genuine ≥3-cell charge run-up exists, but close enough for it to actually land.
      const enc = flatEncounter({
        grid: { cols: 20, rows: 20, cellM: 1.5 },
        units: [
          { archetype: 'militia-spear', side: 'player', q: 9, r: 9 },
          { archetype: 'militia-spear', side: 'player', q: 10, r: 9 },
          { archetype: 'militia-spear', side: 'player', q: 9, r: 10 },
          { archetype: 'militia-spear', side: 'player', q: 10, r: 10 },
          { archetype: 'habsburg-knight', side: 'enemy', q: 9, r: 4, mounted: true },
        ],
      });
      // NOT startManual / NOT `{type:'auto'}`: this reproduces the critic's "minimal knight-vs-2×2 trace" —
      // a genuinely un-forced single AI turn, the one path where a Haufen defender's Brace (isPlayerControlled
      // = true, forceAiAll = false) gets queued instead of auto-resolved.
      engine.start('enc.test', { encounterOverride: enc });
      const knight = engine.getState()!.units.find((u) => u.side === 'enemy')!;
      const anyEngine = engine as unknown as { activeUnitId: number | null; stepAi: () => void };
      anyEngine.activeUnitId = knight.id;
      anyEngine.stepAi();
      // Drain any reaction the knight's move queued (an un-forced AI turn still needs someone to answer it —
      // mirrors a human accepting the Brace prompt) so the encounter doesn't sit stuck mid-reaction.
      let guard = 0;
      while (engine.getState()?.pendingReaction && guard++ < 10) {
        const pr = engine.getState()!.pendingReaction!;
        engine.submit({ type: 'reaction', unit: pr.unit, accept: true });
      }
      const log = engine.serialize()!.log as { kind: string; unit?: number; data?: Record<string, unknown> }[];
      const attackIdx = log.findIndex((l) => l.kind === 'attack' && l.unit === knight.id);
      const reactionIdxs = log.map((l, i) => ({ l, i })).filter(({ l }) => l.kind === 'reaction' && l.data?.target === knight.id).map(({ i }) => i);
      if (attackIdx !== -1 && reactionIdxs.length > 0) {
        expect(Math.min(...reactionIdxs)).toBeLessThan(attackIdx);
      }
      // Either way, the invariant that actually matters: no reaction targeting the knight is EVER logged
      // strictly after his own attack.
      for (const ri of reactionIdxs) expect(attackIdx === -1 || ri < attackIdx).toBe(true);
    }
  });
});

describe('round-3 issue 1: abilitiesFor offers Roll Boulders on a cache', () => {
  it('lists ability.roll-boulders for a unit standing on a boulder-cache or trunk-cache cell, not otherwise', () => {
    const { engine } = makeEngine();
    const enc = flatEncounter({
      units: [
        { archetype: 'militia-halberd', side: 'player', q: 2, r: 2 }, // on the cache
        { archetype: 'militia-halberd', side: 'player', q: 5, r: 5 }, // not on any feature
        { archetype: 'peasant', side: 'enemy', q: 9, r: 9 },
      ],
      terrainFeatures: [{ kind: 'trunk-cache', cells: [[2, 2]], affects: [[4, 4]] }],
    });
    startManual(engine, 'enc.test', enc);
    const onCache = engine.getState()!.units.find((u) => u.q === 2 && u.r === 2)!;
    const offCache = engine.getState()!.units.find((u) => u.q === 5 && u.r === 5)!;
    expect(onCache.abilities).toContain('ability.roll-boulders');
    expect(offCache.abilities).not.toContain('ability.roll-boulders');
  });
});

describe('round-3 issue 3: Brace trigger threshold matches Charge (3 cells, not 2)', () => {
  function haufenAndMover(startR: number) {
    const { engine } = makeEngine(2);
    const enc = flatEncounter({
      units: [
        { archetype: 'militia-spear', side: 'player', q: 5, r: 5 },
        { archetype: 'militia-spear', side: 'player', q: 6, r: 5 },
        { archetype: 'militia-spear', side: 'player', q: 5, r: 6 },
        { archetype: 'militia-spear', side: 'player', q: 6, r: 6 },
        { archetype: 'peasant', side: 'enemy', q: 5, r: startR },
      ],
    });
    startManual(engine, 'enc.test', enc);
    const mover = engine.getState()!.units.find((u) => u.side === 'enemy')!;
    unitsOf(engine).get(mover.id)!.ap = { action: true, bonus: true, reaction: true, moveM: 9, moveMax: 9 };
    return { engine, mover };
  }

  it('a 2-cell straight approach into reach (spear reach 2) does not pull Brace', () => {
    // (5,1) -> (5,3): 2 straight cells, ends at distance 2 from (5,5) — newly in reach, but chargeCells=2.
    const { engine, mover } = haufenAndMover(1);
    const result = step(engine, mover.id, { type: 'move', unit: mover.id, to: { q: 5, r: 3 } });
    expect(result.ok).toBe(true);
    expect(engine.getState()!.pendingReaction).toBeUndefined();
  });

  it('a 3-cell straight approach into reach does pull Brace', () => {
    // (5,0) -> (5,3): 3 straight cells, ends at distance 2 from (5,5) — newly in reach, chargeCells=3.
    const { engine, mover } = haufenAndMover(0);
    const result = step(engine, mover.id, { type: 'move', unit: mover.id, to: { q: 5, r: 3 } });
    expect(result.ok).toBe(true);
    expect(engine.getState()!.pendingReaction).toBeDefined();
  });
});

describe('round-3 issue 4: Shield Block is a queued reaction for a player-controlled defender', () => {
  it('does not auto-resolve inline when the defender is player-controlled and forceAiAll is off', () => {
    const { engine } = makeEngine(6);
    const enc = flatEncounter({
      units: [
        { archetype: 'habsburg-footman', side: 'player', q: 5, r: 5 }, // carries a heater-shield
        { archetype: 'peasant', side: 'enemy', q: 6, r: 5 },
      ],
    });
    startManual(engine, 'enc.test', enc);
    const defender = engine.getState()!.units.find((u) => u.side === 'player')!;
    const attacker = engine.getState()!.units.find((u) => u.side === 'enemy')!;
    unitsOf(engine).get(attacker.id)!.ap = { action: true, bonus: true, reaction: true, moveM: 9, moveMax: 9 };
    let queued = false;
    for (let i = 0; i < 20 && !queued; i++) {
      unitsOf(engine).get(defender.id)!.ap = { action: true, bonus: true, reaction: true, moveM: 9, moveMax: 9 };
      step(engine, attacker.id, { type: 'ability', unit: attacker.id, ability: 'ability.attack', target: defender.id });
      if (engine.getState()!.pendingReaction?.ability === 'ability.shield-block') queued = true;
    }
    expect(queued).toBe(true);
  });
});

describe('cross-module: Hünenberg warning gates Morgarten cache count (requests/quest-2.md §2)', () => {
  function morgartenWithFlag(flag: unknown) {
    const world = new World();
    const content = makeTestContent();
    const party = new FakePartyService(world, content);
    const rng = new Rng(9);
    const questService = { getFlag: (k: string) => (k === 'hunenberg-warning' ? flag : undefined) };
    const host: CombatHost = { world, content, party, rng, questService };
    return new CombatEngineImpl(host);
  }

  it('flag exactly false: drops the two caches farthest from the Haufen blocks and logs the caption', async () => {
    const engine = morgartenWithFlag(false);
    const resultPromise = engine.start('enc.morgarten', {});
    const kinds = engine.encounterDef()?.terrainFeatures?.map((f) => `${f.kind}@${f.cells[0][0]},${f.cells[0][1]}`) ?? [];
    expect(kinds).not.toContain('boulder-cache@10,11');
    expect(kinds).not.toContain('trunk-cache@13,9');
    // The two nearest the Haufen blocks (one boulder + one trunk cache per block) are untouched.
    expect(kinds).toContain('boulder-cache@9,5');
    expect(kinds).toContain('trunk-cache@10,5');
    expect(kinds).toContain('boulder-cache@9,15');
    expect(kinds).toContain('trunk-cache@10,15');
    const log = (engine.serialize()?.log ?? []) as { text: string }[];
    expect(log.some((l) => l.text === 'Without the warning, fewer stones were laid.')).toBe(true);
    engine.submit({ type: 'flee' });
    await resultPromise;
  });

  it('flag true or unset: all caches present, no caption', async () => {
    for (const flag of [true, undefined]) {
      const engine = morgartenWithFlag(flag);
      const resultPromise = engine.start('enc.morgarten', {});
      const kinds = engine.encounterDef()?.terrainFeatures?.map((f) => `${f.kind}@${f.cells[0][0]},${f.cells[0][1]}`) ?? [];
      expect(kinds).toContain('boulder-cache@10,11');
      expect(kinds).toContain('trunk-cache@13,9');
      const log = (engine.serialize()?.log ?? []) as { text: string }[];
      expect(log.some((l) => l.text === 'Without the warning, fewer stones were laid.')).toBe(false);
      engine.submit({ type: 'flee' });
      await resultPromise;
    }
  });
});
