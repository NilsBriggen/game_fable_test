/**
 * Round-3 minor (wave2-combat.md §"Ranked notable issues" item 5): routed flight stays dry, proactive
 * Disengage / OA avoidance, and haul-out rescue — standing regressions so the minor can't silently regress.
 */
import { describe, it, expect } from 'vitest';
import { World } from '@core/ecs';
import { Rng } from '@core/rng';
import type { EncounterDef } from '@core/schemas';
import { CombatEngineImpl, type CombatHost } from './engine';
import { decideAndAct } from './ai';
import { hasStatus } from './types';
import { FakePartyService, makeTestContent } from './testUtils';

function makeEngine(seed = 42) {
  const world = new World();
  const content = makeTestContent();
  const party = new FakePartyService(world, content);
  const rng = new Rng(seed);
  const host: CombatHost = { world, content, party, rng };
  const engine = new CombatEngineImpl(host);
  return { engine, rng };
}

function flatEncounter(over: Partial<EncounterDef> & { units: EncounterDef['units'] }): EncounterDef {
  return {
    id: over.id ?? 'enc.test', name: over.name ?? 'Test', location: { x: 0, z: 0, yaw: 0 },
    grid: over.grid ?? { cols: 10, rows: 10, cellM: 1.5 }, heightOverride: over.heightOverride ?? 'flat',
    deploy: over.deploy ?? { q: 0, r: 0, cols: 2, rows: 2 }, units: over.units,
    objectives: over.objectives ?? [{ type: 'defeat-all' }],
    terrainFeatures: over.terrainFeatures, scripted: over.scripted,
    historical: 'invented', note: 'test fixture', description: 'test fixture',
  };
}

/** Bypass the turn cascade (mirrors engine.test.ts's startManual) so a single AI turn can be inspected. */
function startNoCascade(engine: CombatEngineImpl, enc: EncounterDef): void {
  const anyEngine = engine as unknown as { advance: () => void };
  const real = anyEngine.advance.bind(engine);
  anyEngine.advance = () => {};
  void engine.start('enc.test', { encounterOverride: enc });
  anyEngine.advance = real;
}

function internalsOf(engine: CombatEngineImpl) {
  return (engine as unknown as { units: Map<number, Parameters<typeof hasStatus>[0]> }).units;
}

describe('routed flight stays dry (wave2-combat item 5)', () => {
  it('a routed enemy never flees onto a water cell, across seeds', () => {
    for (const seed of [3, 4, 5]) {
      const { engine, rng } = makeEngine(seed);
      const enc = flatEncounter({
        grid: { cols: 16, rows: 16, cellM: 1.5 }, heightOverride: 'quay', // water band at low r
        deploy: { q: 2, r: 3, cols: 3, rows: 3 },
        units: [
          { archetype: 'habsburg-footman', side: 'enemy', q: 8, r: 8 },
          { archetype: 'militia-spear', side: 'player', q: 8, r: 10 },
        ],
      });
      startNoCascade(engine, enc);
      const units = engine.unitList();
      const foe = units.find((u) => u.side === 'enemy')!;
      // Force a rout next turn and run the routed turn directly via a full auto burst.
      foe.routed = true;
      const before = engine.cellViewAt(foe.q, foe.r)?.surface;
      void before; void rng;
      // A routed unit flees on its own turn: drive one auto round and check where it landed.
      engine.submit({ type: 'auto', rounds: 1 });
      const after = engine.unitList().find((u) => u.id === foe.id)!;
      const landed = engine.cellViewAt(after.q, after.r);
      expect(landed?.surface).not.toBe('water');
    }
  });

  it('enc.brunnen-quay: water cells are the low-r band (preset geometry this fix mirrors against)', () => {
    const { engine } = makeEngine(1);
    const enc = flatEncounter({
      grid: { cols: 16, rows: 16, cellM: 1.5 }, heightOverride: 'quay',
      units: [{ archetype: 'habsburg-footman', side: 'enemy', q: 8, r: 8 }],
    });
    startNoCascade(engine, enc);
    const waterRows = engine.cellsView().filter((c) => c.surface === 'water').map((c) => c.r);
    expect(waterRows.length).toBeGreaterThan(0);
    expect(Math.max(...waterRows)).toBeLessThan(16 * 0.2); // preset water lives at r < 20% of rows
    // The authored quay units/deploy all sit off the water band (r >= 20% of rows).
    const real = makeTestContent().encounters.get('enc.brunnen-quay')!;
    const minUnitR = Math.min(...real.units.map((u) => u.r), real.deploy.r);
    expect(minUnitR).toBeGreaterThanOrEqual(Math.floor(16 * 0.2));
  });
});

describe('proactive Disengage + OA avoidance (wave2-combat item 5)', () => {
  it('a fragile crossbowman (<=50% HP) threatened at close range Disengages before retreating', () => {
    const { engine, rng } = makeEngine(11);
    const enc = flatEncounter({
      units: [
        { archetype: 'habsburg-crossbowman', side: 'enemy', q: 5, r: 5 },
        { archetype: 'militia-spear', side: 'player', q: 6, r: 5 },
      ],
    });
    startNoCascade(engine, enc);
    const cross = engine.unitList().find((u) => u.side === 'enemy')!;
    // Fragile: halve HP; loaded so the retreat branch (adjacent enemy) is what runs.
    cross.hp = Math.floor(cross.hpMax * 0.4);
    cross.loaded = true;
    const beforeAp = { ...cross.ap };
    void beforeAp;
    decideAndAct(engine, cross, rng);
    const log = (engine.serialize()?.log ?? []).map((l) => (l as { text: string }).text).join('\n');
    expect(log).toMatch(/[Dd]isengage|uses Disengage|break/i);
  });

  it('a healthy footman facing a single provoker does NOT Disengage (keeps its action for the attack)', () => {
    const { engine, rng } = makeEngine(12);
    const enc = flatEncounter({
      units: [
        { archetype: 'habsburg-footman', side: 'enemy', q: 5, r: 5 },
        { archetype: 'peasant', side: 'player', q: 6, r: 5 },
      ],
    });
    startNoCascade(engine, enc);
    const foot = engine.unitList().find((u) => u.side === 'enemy')!;
    expect(foot.hp).toBe(foot.hpMax); // healthy
    decideAndAct(engine, foot, rng);
    // The action must have gone to the attack (or a brace+attack), never to a Disengage.
    expect(hasStatus(foot, 'disengaged')).toBe(false);
    expect(foot.ap.action).toBe(false); // attacked — the action was spent productively
  });

  it('a footman choosing among flanking lines prefers the OA-free one (safe-path tie-break)', () => {
    const { engine, rng } = makeEngine(13);
    const enc = flatEncounter({
      grid: { cols: 12, rows: 12, cellM: 1.5 },
      units: [
        { archetype: 'habsburg-footman', side: 'enemy', q: 2, r: 5 },
        { archetype: 'peasant', side: 'player', q: 7, r: 5 }, // the target
        { archetype: 'habsburg-footman', side: 'enemy', q: 9, r: 5 }, // ally on the far side: both (6,5) and (8,5) flank
        { archetype: 'militia-spear', side: 'player', q: 6, r: 6 }, // threatens (6,5)'s approach, not (8,5)'s
      ],
    });
    startNoCascade(engine, enc);
    const foot = engine.unitList().find((u) => u.side === 'enemy' && u.q === 2)!;
    decideAndAct(engine, foot, rng);
    // Either a flank was taken or the unit closed — the invariant is it never ate a needless OA when a tied
    // safe line existed: it must not stand on a cell adjacent to the spearman when (8,5) was reachable.
    const moved = engine.unitList().find((u) => u.id === foot.id)!;
    expect(!(moved.q === 6 && moved.r === 5)).toBe(true);
  });

  it('AI turn stays within the 200 ms budget on a 40×24 grid with previewMove shortlists', () => {
    const { engine, rng } = makeEngine(21);
    const enc = flatEncounter({
      grid: { cols: 40, rows: 24, cellM: 1.5 },
      units: [
        { archetype: 'habsburg-footman', side: 'enemy', q: 2, r: 2 },
        { archetype: 'habsburg-crossbowman', side: 'enemy', q: 3, r: 3 },
        { archetype: 'habsburg-sergeant', side: 'enemy', q: 4, r: 4 },
        { archetype: 'militia-spear', side: 'player', q: 20, r: 12 },
        { archetype: 'militia-spear', side: 'player', q: 21, r: 12 },
        { archetype: 'militia-halberd', side: 'player', q: 20, r: 13 },
        { archetype: 'militia-halberd', side: 'player', q: 21, r: 13 },
      ],
    });
    startNoCascade(engine, enc);
    for (const u of engine.unitList().filter((x) => x.side === 'enemy')) {
      const t0 = Date.now();
      decideAndAct(engine, u, rng);
      expect(Date.now() - t0).toBeLessThan(200);
    }
  });
});

describe('AI uses haul-out (wave2-combat item 5)', () => {
  it('knight / footman / crossbowman / waldstaette rescue an adjacent drowning ally first', () => {
    const doctrines: { enemy: string; ally: string; player: string }[] = [
      { enemy: 'habsburg-knight', ally: 'habsburg-footman', player: 'peasant' },
      { enemy: 'habsburg-footman', ally: 'habsburg-footman', player: 'peasant' },
      { enemy: 'habsburg-crossbowman', ally: 'habsburg-footman', player: 'peasant' },
      { enemy: 'militia-halberd', ally: 'militia-spear', player: 'peasant' },
    ];
    for (const [i, d] of doctrines.entries()) {
      const { engine, rng } = makeEngine(100 + i);
      const enc = flatEncounter({
        units: [
          { archetype: d.enemy as never, side: 'enemy', q: 5, r: 5 },
          { archetype: d.ally as never, side: 'enemy', q: 6, r: 5 },
          { archetype: d.player as never, side: 'player', q: 9, r: 9 },
        ],
      });
      startNoCascade(engine, enc);
      const map = internalsOf(engine);
      const rescuer = engine.unitList().find((u) => u.side === 'enemy' && u.q === 5)!;
      const victim = engine.unitList().find((u) => u.side === 'enemy' && u.q === 6)!;
      // The victim is drowning on dry land (haul-out only needs the status + adjacency, not water).
      (map.get(victim.id) as { status: { id: string; turns: number }[] }).status = [{ id: 'drowning', turns: 5 }];
      // A far-away enemy keeps the rescuer's turn meaningful after the rescue attempt.
      decideAndAct(engine, rescuer, rng);
      expect(hasStatus(map.get(victim.id) as Parameters<typeof hasStatus>[0], 'drowning')).toBe(false);
      expect((map.get(rescuer.id) as { ap: { bonus: boolean } }).ap.bonus).toBe(false);
    }
  });
});
