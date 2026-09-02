import { describe, it, expect, vi } from 'vitest';
import { World } from '@core/ecs';
import { Rng } from '@core/rng';
import type { EncounterDef } from '@core/schemas';
import type { CombatCommand } from '@core/services';
import { CombatEngineImpl, type CombatHost } from './engine';
import { FakePartyService, makeTestContent, makeTestNpc } from './testUtils';

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

/** Starts the encounter WITHOUT letting the engine's normal auto-AI cascade run yet — every unit starts
 *  under manual control via `step()`. Mirrors how a human plays through `submit()` one command at a time. */
function startManual(engine: CombatEngineImpl, encId: string, enc: EncounterDef): Promise<import('@core/services').CombatResult> {
  const anyEngine = engine as unknown as { advance: () => void };
  const real = anyEngine.advance.bind(engine);
  anyEngine.advance = () => {};
  const resultPromise = engine.start(encId, { encounterOverride: enc });
  anyEngine.advance = real;
  return resultPromise;
}

/** Runs exactly one command for `unitId`, bypassing the normal "cascade to the next AI turn" so the test can
 *  inspect state immediately after. Reactions (opportunity attacks, Brace) still resolve for real, inline. */
function step(engine: CombatEngineImpl, unitId: number, cmd: CombatCommand) {
  const anyEngine = engine as unknown as { advance: () => void; activeUnitId: number | null };
  const real = anyEngine.advance;
  anyEngine.advance = () => {};
  anyEngine.activeUnitId = unitId;
  const result = engine.submit(cmd);
  anyEngine.advance = real;
  return result;
}

/** Accepts every queued reaction (player-controlled defenders pause for a real decision — see queueReaction/
 *  queueBrace in engine.ts), without letting the normal turn cascade run afterward. */
function acceptAllReactions(engine: CombatEngineImpl): void {
  const anyEngine = engine as unknown as { advance: () => void };
  const real = anyEngine.advance;
  anyEngine.advance = () => {};
  let guard = 0;
  let pending = engine.getState()?.pendingReaction;
  while (pending && guard++ < 50) {
    engine.submit({ type: 'reaction', unit: pending.unit, accept: true });
    pending = engine.getState()?.pendingReaction;
  }
  anyEngine.advance = real;
}

function unitsOf(engine: CombatEngineImpl) {
  return (engine as unknown as { units: Map<number, Record<string, unknown>> }).units;
}

describe('encounter lifecycle', () => {
  it('start() places units, rolls initiative and is immediately active/serializable (autosave contract)', async () => {
    const { engine } = makeEngine();
    const enc = flatEncounter({
      units: [
        { archetype: 'peasant', side: 'enemy', q: 5, r: 5 },
        { archetype: 'peasant', side: 'player', q: 1, r: 1 },
      ],
    });
    const resultPromise = startManual(engine, 'enc.test', enc);
    expect(engine.isActive()).toBe(true);
    expect(engine.serialize()).not.toBeNull();
    const state = engine.getState()!;
    expect(state.units.length).toBe(2);
    expect(state.order.length).toBe(2);
    engine.submit({ type: 'flee' });
    await resultPromise;
  });

  it('rout ends the encounter once the enemy squad is defeated', async () => {
    const { engine } = makeEngine(101);
    const enc = flatEncounter({
      units: [
        { archetype: 'peasant', side: 'enemy', q: 2, r: 2 },
        { archetype: 'militia-halberd', side: 'player', q: 1, r: 1 },
      ],
      objectives: [{ type: 'rout' }],
    });
    const resultPromise = engine.start('enc.test', { encounterOverride: enc });
    engine.submit({ type: 'auto', rounds: 20 });
    const result = await resultPromise;
    expect(result.outcome).toBe('win');
  }, 10000);
});

describe('initiative', () => {
  it('orders units by roll, ties broken by agility mod then a stable tiebreak', () => {
    const { engine } = makeEngine();
    const enc = flatEncounter({ units: [{ archetype: 'peasant', side: 'enemy', q: 5, r: 5 }, { archetype: 'peasant', side: 'player', q: 1, r: 1 }] });
    startManual(engine, 'enc.test', enc);
    const state = engine.getState()!;
    expect(state.order.length).toBe(2);
    const inits = state.order.map((id) => state.units.find((u) => u.id === id)!.initiative);
    for (let i = 1; i < inits.length; i++) expect(inits[i - 1]).toBeGreaterThanOrEqual(inits[i]);
  });
});

describe('defense composition', () => {
  it('base defense reflects agility modifier and a shield bonus', () => {
    const { engine, content } = makeEngine();
    content.addArchetypes([makeTestNpc({
      id: 'shieldbearer', archetype: 'militia', attributes: { strength: 10, agility: 14, endurance: 10, wits: 10, presence: 10 },
      equipment: { mainHand: 'item.spiess', offHand: 'item.heater-shield' },
    })]);
    const enc = flatEncounter({ units: [{ archetype: 'shieldbearer', side: 'player', q: 1, r: 1 }] });
    startManual(engine, 'enc.test', enc);
    const u = engine.getState()!.units[0];
    // 10 + agilityMod(2) + shield(2) = 14
    expect(u.defense).toBe(14);
  });
});

describe('opportunity attacks and Disengage', () => {
  it('leaving an enemy\'s reach without Disengage provokes an opportunity attack', () => {
    const { engine } = makeEngine(3);
    const enc = flatEncounter({
      units: [
        { archetype: 'habsburg-footman', side: 'enemy', q: 2, r: 2 },
        { archetype: 'militia-spear', side: 'player', q: 3, r: 2 },
      ],
    });
    startManual(engine, 'enc.test', enc);
    const mover = engine.getState()!.units.find((u) => u.side === 'player')!;
    step(engine, mover.id, { type: 'move', unit: mover.id, to: { q: 6, r: 6 } });
    // Round-3 issue 4: the moving militia-spear carries a buckler, so its own Shield Block now queues (it's
    // player-controlled) instead of resolving inline — answer it before checking the log, same as any other
    // reaction a player-controlled unit is asked about.
    acceptAllReactions(engine);
    const log = engine.getState()!.log.map((l) => l.text).join('\n');
    expect(log).toMatch(/attacks/);
  });

  it('Disengage avoids the opportunity attack', () => {
    const { engine } = makeEngine(3);
    const enc = flatEncounter({
      units: [
        { archetype: 'habsburg-footman', side: 'enemy', q: 2, r: 2 },
        { archetype: 'militia-spear', side: 'player', q: 3, r: 2 },
      ],
    });
    startManual(engine, 'enc.test', enc);
    const mover = engine.getState()!.units.find((u) => u.side === 'player')!;
    step(engine, mover.id, { type: 'ability', unit: mover.id, ability: 'ability.disengage' });
    const beforeLen = engine.getState()!.log.length;
    step(engine, mover.id, { type: 'move', unit: mover.id, to: { q: 6, r: 6 } });
    const newLog = engine.getState()!.log.slice(beforeLen).map((l) => l.text).join('\n');
    expect(newLog).not.toMatch(/attacks/);
  });
});

describe('Brace vs Charge and the Haufen', () => {
  it('4 spearmen in a 2×2 form a Haufen: immune to flanking, and a charge into a front unit pulls ≥ 2 brace attacks', () => {
    const { engine } = makeEngine(7);
    const enc = flatEncounter({
      grid: { cols: 20, rows: 20, cellM: 1.5 },
      units: [
        { archetype: 'militia-spear', side: 'player', q: 5, r: 5 },
        { archetype: 'militia-spear', side: 'player', q: 6, r: 5 },
        { archetype: 'militia-spear', side: 'player', q: 5, r: 6 },
        { archetype: 'militia-spear', side: 'player', q: 6, r: 6 },
        { archetype: 'habsburg-knight', side: 'enemy', q: 5, r: 10, mounted: true },
      ],
    });
    startManual(engine, 'enc.test', enc);
    let state = engine.getState()!;
    const front = state.units.find((u) => u.side === 'player')!;
    expect(front.formation.inHaufen).toBe(true);

    const knight = state.units.find((u) => u.side === 'enemy')!;
    const preview = engine.previewMove(knight.id, { q: 5, r: 7 });
    expect(preview).not.toBeNull(); // must be reachable within the knight's move budget for this test to be meaningful
    step(engine, knight.id, { type: 'move', unit: knight.id, to: { q: 5, r: 7 } });
    acceptAllReactions(engine); // the spearmen are player-controlled: their Brace reactions pause for a decision
    state = engine.getState()!;
    const braceAttacks = state.log.filter((l) => l.kind === 'reaction' && l.text.includes('braces')).length;
    expect(braceAttacks).toBeGreaterThanOrEqual(2);

    // no flanking Edge is possible against a Haufen member
    const spearman = state.units.find((u) => u.side === 'player')!;
    const atkPreview = engine.previewAttack(knight.id, 'ability.attack', spearman.id);
    expect(atkPreview?.context.flanked).toBe(false);
  });

  it('the same 4 units spread apart: no Haufen forms, and flanking becomes geometrically possible', () => {
    const { engine } = makeEngine(7);
    const enc = flatEncounter({
      grid: { cols: 20, rows: 20, cellM: 1.5 },
      units: [
        { archetype: 'militia-spear', side: 'player', q: 1, r: 1 },
        { archetype: 'militia-spear', side: 'player', q: 18, r: 1 },
        { archetype: 'militia-spear', side: 'player', q: 1, r: 18 },
        { archetype: 'militia-spear', side: 'player', q: 5, r: 8 },
        { archetype: 'habsburg-footman', side: 'enemy', q: 5, r: 6 },
        { archetype: 'habsburg-footman', side: 'enemy', q: 5, r: 10 },
      ],
    });
    startManual(engine, 'enc.test', enc);
    const state = engine.getState()!;
    const isolated = state.units.find((u) => u.side === 'player' && u.q === 5 && u.r === 8)!;
    expect(isolated).toBeDefined();
    expect(isolated.formation.inHaufen).toBe(false);
    const [foeA, foeB] = state.units.filter((u) => u.side === 'enemy');
    // foeA (north) and foeB (south) sit on opposite sides of the isolated spearman: flanking is possible.
    const preview = engine.previewAttack(foeA.id, 'ability.attack', isolated.id);
    void foeB;
    expect(preview?.context.flanked).toBe(true);
  });
});

describe('high ground', () => {
  it('attacking from higher ground grants Edge', () => {
    const { engine } = makeEngine();
    const enc = flatEncounter({
      units: [
        { archetype: 'militia-spear', side: 'player', q: 5, r: 5 },
        { archetype: 'peasant', side: 'enemy', q: 5, r: 6 },
      ],
    });
    startManual(engine, 'enc.test', enc);
    const attacker = engine.getState()!.units.find((u) => u.side === 'player')!;
    const target = engine.getState()!.units.find((u) => u.side === 'enemy')!;
    const cells = (engine as unknown as { cells: { q: number; r: number; height: number }[] }).cells;
    cells.find((c) => c.q === attacker.q && c.r === attacker.r)!.height = 2;
    const preview = engine.previewAttack(attacker.id, 'ability.attack', target.id);
    expect(preview?.context.edge).toContain('high ground');
  });
});

describe('shove: ledge fall and drowning', () => {
  it('shoving a unit off a ≥3m ledge causes fall damage and Prone', () => {
    const { engine } = makeEngine(3);
    const enc = flatEncounter({
      units: [
        { archetype: 'militia-spear', side: 'player', q: 5, r: 5 },
        { archetype: 'peasant', side: 'enemy', q: 6, r: 5 },
      ],
    });
    startManual(engine, 'enc.test', enc);
    const shover = engine.getState()!.units.find((u) => u.side === 'player')!;
    const target = engine.getState()!.units.find((u) => u.side === 'enemy')!;
    const cells = (engine as unknown as { cells: { q: number; r: number; height: number }[] }).cells;
    cells.find((c) => c.q === 7 && c.r === 5)!.height = -4; // a ledge 4 m below
    for (let i = 0; i < 30; i++) {
      unitsOf(engine).get(shover.id)!.ap = { action: true, bonus: true, reaction: true, moveM: 9, moveMax: 9 };
      step(engine, shover.id, { type: 'ability', unit: shover.id, ability: 'ability.shove', target: target.id });
      const t = engine.getState()!.units.find((u) => u.id === target.id)!;
      if (t.q === 7) {
        expect(t.status.some((s) => s.id === 'prone')).toBe(true);
        return;
      }
    }
    throw new Error('shove never succeeded across 30 attempts');
  });

  it('shoving a heavily-armoured unit into water causes Drowning', () => {
    const { engine } = makeEngine(5);
    const enc = flatEncounter({
      units: [
        { archetype: 'militia-spear', side: 'player', q: 5, r: 5 },
        { archetype: 'habsburg-footman', side: 'enemy', q: 6, r: 5 }, // mail shirt: thrust soak 2
      ],
    });
    startManual(engine, 'enc.test', enc);
    const shover = engine.getState()!.units.find((u) => u.side === 'player')!;
    const target = engine.getState()!.units.find((u) => u.side === 'enemy')!;
    const cells = (engine as unknown as { cells: { q: number; r: number; surface: string }[] }).cells;
    cells.find((c) => c.q === 7 && c.r === 5)!.surface = 'water';
    for (let i = 0; i < 30; i++) {
      unitsOf(engine).get(shover.id)!.ap = { action: true, bonus: true, reaction: true, moveM: 9, moveMax: 9 };
      step(engine, shover.id, { type: 'ability', unit: shover.id, ability: 'ability.shove', target: target.id });
      const t = engine.getState()!.units.find((u) => u.id === target.id)!;
      if (t.q === 7) {
        expect(t.status.some((s) => s.id === 'drowning')).toBe(true);
        return;
      }
    }
    throw new Error('shove never succeeded across 30 attempts');
  });
});

describe('reload ladder', () => {
  it('a reload-1 (bonus) crossbow costs a bonus action; crossbow-75 (reloadStep -1) makes it free', () => {
    const { engine } = makeEngine();
    const enc = flatEncounter({ units: [{ archetype: 'habsburg-crossbowman', side: 'player', q: 1, r: 1 }, { archetype: 'peasant', side: 'enemy', q: 5, r: 5 }] });
    startManual(engine, 'enc.test', enc);
    const u = engine.getState()!.units.find((x) => x.side === 'player')!;
    let r = step(engine, u.id, { type: 'ability', unit: u.id, ability: 'ability.reload' });
    expect(r.ok).toBe(true);
    let unit = engine.getState()!.units.find((x) => x.id === u.id)!;
    expect(unit.ap.bonus).toBe(false); // reload-1 spent the bonus action
    expect(unit.ap.action).toBe(true);

    const internal = unitsOf(engine).get(u.id)! as unknown as { loaded: boolean; ap: { action: boolean; bonus: boolean; reaction: boolean; moveM: number; moveMax: number }; perkMods: Record<string, number> };
    internal.loaded = false;
    internal.ap = { action: true, bonus: true, reaction: true, moveM: 9, moveMax: 9 };
    internal.perkMods = { ...internal.perkMods, reloadStep: -1 }; // perk.crossbow-75
    r = step(engine, u.id, { type: 'ability', unit: u.id, ability: 'ability.reload' });
    expect(r.ok).toBe(true);
    unit = engine.getState()!.units.find((x) => x.id === u.id)!;
    expect(unit.ap.bonus).toBe(true); // free reload: bonus action untouched
    expect(unit.loaded).toBe(true);
  });
});

describe('morale: Shaken → Routed → rout ends the encounter; Rally clears Shaken', () => {
  it('a failing-badly morale check applies Routed', () => {
    const { engine, rng } = makeEngine();
    const enc = flatEncounter({ units: [{ archetype: 'peasant', side: 'enemy', q: 5, r: 5 }, { archetype: 'peasant', side: 'player', q: 1, r: 1 }] });
    startManual(engine, 'enc.test', enc);
    const target = engine.getState()!.units.find((u) => u.side === 'enemy')!;
    const internalUnit = unitsOf(engine).get(target.id)! as unknown as { routed: boolean };
    vi.spyOn(rng, 'die').mockReturnValueOnce(1);
    (engine as unknown as { rollMorale: (u: unknown, dc: number, r: string) => void }).rollMorale(unitsOf(engine).get(target.id), 10, 'test');
    expect(internalUnit.routed).toBe(true);
  });

  it('a narrowly-failing morale check applies Shaken', () => {
    const { engine, rng } = makeEngine();
    const enc = flatEncounter({ units: [{ archetype: 'peasant', side: 'enemy', q: 5, r: 5 }, { archetype: 'peasant', side: 'player', q: 1, r: 1 }] });
    startManual(engine, 'enc.test', enc);
    const target = engine.getState()!.units.find((u) => u.side === 'enemy')!;
    const internalUnit = unitsOf(engine).get(target.id)! as unknown as { status: { id: string }[] };
    vi.spyOn(rng, 'die').mockReturnValueOnce(8);
    (engine as unknown as { rollMorale: (u: unknown, dc: number, r: string) => void }).rollMorale(unitsOf(engine).get(target.id), 10, 'test');
    expect(internalUnit.status.some((s) => s.id === 'shaken')).toBe(true);
  });

  it('Rally clears Shaken on nearby allies', () => {
    const { engine } = makeEngine();
    const enc = flatEncounter({
      units: [
        { archetype: 'peasant', side: 'enemy', q: 9, r: 9 },
        { archetype: 'militia-spear', side: 'player', q: 2, r: 1 },
        { archetype: 'habsburg-sergeant', side: 'player', q: 1, r: 1 },
      ],
    });
    startManual(engine, 'enc.test', enc);
    const shaken = engine.getState()!.units.find((u) => u.archetype === 'militia')!;
    const leader = engine.getState()!.units.find((u) => u.archetype === 'sergeant')!;
    const internalShaken = unitsOf(engine).get(shaken.id)! as unknown as { status: { id: string; turns: number }[] };
    internalShaken.status.push({ id: 'shaken', turns: 3 });
    const r = step(engine, leader.id, { type: 'ability', unit: leader.id, ability: 'ability.rally' });
    expect(r.ok).toBe(true);
    expect(internalShaken.status.some((s) => s.id === 'shaken')).toBe(false);
  });

  it('the encounter ends in a win once every living enemy is Routed or Down/dead', async () => {
    const { engine } = makeEngine();
    const enc = flatEncounter({
      units: [{ archetype: 'peasant', side: 'enemy', q: 5, r: 5 }, { archetype: 'militia-spear', side: 'player', q: 1, r: 1 }],
      objectives: [{ type: 'rout' }],
    });
    const resultPromise = startManual(engine, 'enc.test', enc);
    const enemy = engine.getState()!.units.find((u) => u.side === 'enemy')!;
    (unitsOf(engine).get(enemy.id)! as unknown as { routed: boolean }).routed = true;
    (engine as unknown as { advance: () => void }).advance();
    const result = await resultPromise;
    expect(result.outcome).toBe('win');
  });
});

describe('boulder cache environment interaction', () => {
  it('Roll Boulders hits every unit on its affects line for 2d10 blunt, Prone, and a morale check', () => {
    const { engine } = makeEngine(11);
    const enc = flatEncounter({
      units: [
        { archetype: 'militia-halberd', side: 'player', q: 5, r: 8 },
        { archetype: 'habsburg-footman', side: 'enemy', q: 5, r: 7 },
      ],
      terrainFeatures: [{ kind: 'boulder-cache', cells: [[5, 8]], affects: [[5, 7]] }],
    });
    startManual(engine, 'enc.test', enc);
    const roller = engine.getState()!.units.find((u) => u.side === 'player')!;
    const victim = engine.getState()!.units.find((u) => u.side === 'enemy')!;
    const before = victim.hp;
    const r = step(engine, roller.id, { type: 'ability', unit: roller.id, ability: 'ability.roll-boulders' });
    if (!r.ok) console.log('roll-boulders failed:', r.reason, JSON.stringify(engine.getState()?.cells.find((c) => c.q === 5 && c.r === 10)));
    expect(r.ok).toBe(true);
    const after = engine.getState()!.units.find((u) => u.id === victim.id)!;
    expect(after.hp).toBeLessThan(before);
    expect(after.status.some((s) => s.id === 'prone')).toBe(true);
    expect(engine.getState()!.log.some((l) => l.kind === 'feature')).toBe(true);
    expect(engine.getState()!.log.some((l) => l.kind === 'morale')).toBe(true);
  });
});

describe('objectives', () => {
  it('survive(N): met once the round counter reaches N', () => {
    const { engine } = makeEngine();
    const enc = flatEncounter({
      units: [{ archetype: 'peasant', side: 'enemy', q: 5, r: 5 }, { archetype: 'peasant', side: 'player', q: 1, r: 1 }],
      objectives: [{ type: 'survive', turns: 2 }],
    });
    startManual(engine, 'enc.test', enc);
    expect((engine as unknown as { objectiveMet: (d: unknown) => boolean }).objectiveMet({ type: 'survive', turns: 2 })).toBe(false);
    (engine as unknown as { round: number }).round = 2;
    expect((engine as unknown as { objectiveMet: (d: unknown) => boolean }).objectiveMet({ type: 'survive', turns: 2 })).toBe(true);
  });

  it('trigger-features(kind, count): tracks how many distinct features of a kind have fired', () => {
    const { engine } = makeEngine();
    const enc = flatEncounter({
      units: [{ archetype: 'militia-halberd', side: 'player', q: 5, r: 8 }],
      objectives: [{ type: 'trigger-features', kind: 'boulder-cache', count: 1 }],
      terrainFeatures: [{ kind: 'boulder-cache', cells: [[5, 8]], affects: [[5, 7]] }],
    });
    startManual(engine, 'enc.test', enc);
    const roller = engine.getState()!.units[0];
    step(engine, roller.id, { type: 'ability', unit: roller.id, ability: 'ability.roll-boulders' });
    (engine as unknown as { updateObjectiveProgress: () => void }).updateObjectiveProgress();
    const obj = engine.getState()!.objectives[0];
    expect(obj.done).toBe(true);
  });

  it('protect(player): a lose objective fires when no player-controlled unit remains standing', async () => {
    const { engine, party } = makeEngine();
    const hero = party.createCharacter(makeTestNpc({ id: 'hero', archetype: 'peasant', attributes: { strength: 10, agility: 10, endurance: 10, wits: 10, presence: 10 } }));
    party.addToParty(hero);
    const enc = flatEncounter({
      units: [{ archetype: 'peasant', side: 'enemy', q: 5, r: 5 }],
      objectives: [{ type: 'defeat-all' }],
      loseObjectives: [{ type: 'protect', npc: 'player' }],
    });
    const resultPromise = startManual(engine, 'enc.test', enc);
    (unitsOf(engine).get(hero)! as unknown as { dead: boolean }).dead = true;
    (engine as unknown as { advance: () => void }).advance();
    const result = await resultPromise;
    expect(result.outcome).toBe('lose');
  });
});

describe('scripted events', () => {
  it('fires the actions attached to a given round exactly once', () => {
    const { engine } = makeEngine();
    const enc = flatEncounter({
      units: [{ archetype: 'peasant', side: 'enemy', q: 5, r: 5 }, { archetype: 'militia-spear', side: 'player', q: 1, r: 1 }],
      scripted: [{ round: 1, actions: [{ caption: 'The trap is sprung.' }] }],
    });
    (engine as unknown as { round: number });
    // let startRound() actually run for round 1 (do NOT stub advance here)
    engine.start('enc.test', { encounterOverride: enc });
    expect(engine.getState()!.log.some((l) => l.text === 'The trap is sprung.')).toBe(true);
  });
});

describe('serialize / restore', () => {
  it('restoring a serialized state produces an identical state view', () => {
    const { engine } = makeEngine(9);
    const enc = flatEncounter({
      units: [{ archetype: 'habsburg-footman', side: 'enemy', q: 5, r: 5 }, { archetype: 'militia-spear', side: 'player', q: 1, r: 1 }],
    });
    startManual(engine, 'enc.test', enc);
    const before = engine.getState();
    const s = engine.serialize()!;

    const { engine: engine2 } = makeEngine(9);
    const content2 = (engine2 as unknown as { host: { content: { encounters: Map<string, EncounterDef> } } }).host.content;
    content2.encounters.set('enc.test', enc);
    return engine2.restore(s).then(() => {
      const after = engine2.getState();
      expect(after?.round).toBe(before?.round);
      expect(after?.units.map((u) => ({ id: u.id, hp: u.hp, q: u.q, r: u.r }))).toEqual(before?.units.map((u) => ({ id: u.id, hp: u.hp, q: u.q, r: u.r })));
      expect(after?.order).toEqual(before?.order);
      expect(after?.phase).toBe(before?.phase);
    });
  });
});

describe('Morgarten full autoplay', () => {
  it('runs 8 rounds to completion without throwing, and the log records a rockfall', async () => {
    const { engine, content } = makeEngine(2026);
    expect(content.encounters.get('enc.morgarten')).toBeDefined();
    const resultPromise = engine.start('enc.morgarten');
    expect(() => engine.submit({ type: 'auto', rounds: 8 })).not.toThrow();
    // getState().log is truncated to the last 50 entries for the UI; serialize() carries the full log.
    const fullLog = ((engine.serialize()?.log ?? []) as { text: string }[]).map((l) => l.text).join('\n');
    expect(fullLog.toLowerCase()).toMatch(/boulder|struck by a rolling/);
    if (engine.isActive()) engine.submit({ type: 'flee' });
    await resultPromise;
  }, 30000);
});
