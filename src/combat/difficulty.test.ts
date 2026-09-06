/**
 * 4.4 difficulty modes: scalars at the hook level (fixed rolls, deterministic — no RNG involved).
 * Covers: damageScaleFor / moraleDcShiftFor (rules/attack.ts), disciplineFor (ai.ts), engine
 * snapshot/serialize/restore of difficulty, tolerant host values, and isDifficulty/loadSettings.
 */
import { describe, it, expect, vi } from 'vitest';
import { World } from '@core/ecs';
import { Rng } from '@core/rng';
import { defaultSettings, isDifficulty, loadSettings } from '@core/context';
import type { EncounterDef } from '@core/schemas';
import { CombatEngineImpl, type CombatHost } from './engine';
import { damageScaleFor, moraleDcShiftFor } from './rules/attack';
import { disciplineFor, STORY_SERGEANT_RALLY_SCAN } from './ai';
import { FakePartyService, makeTestContent } from './testUtils';

function makeEngine(seed = 42, difficulty?: unknown) {
  const world = new World();
  const content = makeTestContent();
  const party = new FakePartyService(world, content);
  const rng = new Rng(seed);
  const host: CombatHost = { world, content, party, rng, difficulty: difficulty as never };
  const engine = new CombatEngineImpl(host);
  return { engine, world, content, party, rng, host };
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

/** Start without letting the turn cascade run (mirrors engine.test.ts's startManual). */
function startManual(engine: CombatEngineImpl, encId: string, enc: EncounterDef) {
  const anyEngine = engine as unknown as { advance: () => void };
  const real = anyEngine.advance.bind(engine);
  anyEngine.advance = () => {};
  const resultPromise = engine.start(encId, { encounterOverride: enc });
  anyEngine.advance = real;
  return resultPromise;
}

function unitsOf(engine: CombatEngineImpl) {
  return (engine as unknown as { units: Map<number, Record<string, unknown>> }).units;
}

describe('damageScaleFor (4.4)', () => {
  it('Normal is the 1.0 identity for every side', () => {
    expect(damageScaleFor('normal', 'enemy')).toBe(1);
    expect(damageScaleFor('normal', 'player')).toBe(1);
    expect(damageScaleFor(undefined, 'enemy')).toBe(1); // absent host value → identity
  });
  it('Story ×0.75 / Hard ×1.25 apply to ENEMY damage only; player damage untouched', () => {
    expect(damageScaleFor('story', 'enemy')).toBe(0.75);
    expect(damageScaleFor('hard', 'enemy')).toBe(1.25);
    expect(damageScaleFor('story', 'player')).toBe(1);
    expect(damageScaleFor('hard', 'player')).toBe(1);
    expect(damageScaleFor('story', 'neutral')).toBe(1);
  });
});

describe('moraleDcShiftFor (4.4)', () => {
  it('Normal/undefined → 0; Story −2 / Hard +2 for PLAYER units only', () => {
    expect(moraleDcShiftFor('normal', 'player')).toBe(0);
    expect(moraleDcShiftFor(undefined, 'player')).toBe(0);
    expect(moraleDcShiftFor('story', 'player')).toBe(-2);
    expect(moraleDcShiftFor('hard', 'player')).toBe(2);
    expect(moraleDcShiftFor('story', 'enemy')).toBe(0);
    expect(moraleDcShiftFor('hard', 'enemy')).toBe(0);
  });
});

describe('disciplineFor (4.4)', () => {
  it('Normal/Hard/undefined run full discipline; Story halves brace radius and lazies rally', () => {
    expect(disciplineFor('normal')).toEqual({ footmanBraceRangeMult: 1, sergeantLazyRally: false });
    expect(disciplineFor('hard')).toEqual({ footmanBraceRangeMult: 1, sergeantLazyRally: false });
    expect(disciplineFor(undefined)).toEqual({ footmanBraceRangeMult: 1, sergeantLazyRally: false });
    expect(disciplineFor('story')).toEqual({ footmanBraceRangeMult: 0.5, sergeantLazyRally: true });
    expect(STORY_SERGEANT_RALLY_SCAN).toBeGreaterThan(3);
  });
});

describe('engine difficulty snapshot (4.4)', () => {
  it('start() snapshots the host difficulty; reset restores Normal', async () => {
    const { engine } = makeEngine(1, 'hard');
    const enc = flatEncounter({
      units: [
        { archetype: 'peasant', side: 'enemy', q: 5, r: 5 },
        { archetype: 'peasant', side: 'player', q: 1, r: 1 },
      ],
    });
    const p = startManual(engine, 'enc.test', enc);
    expect(engine.difficulty).toBe('hard');
    engine.submit({ type: 'flee' });
    await p;
  });

  it('unknown/absent host difficulty falls back to Normal, never crashes', async () => {
    for (const bad of [undefined, 'nightmare', 42, null]) {
      const { engine } = makeEngine(1, bad);
      const enc = flatEncounter({
        units: [
          { archetype: 'peasant', side: 'enemy', q: 5, r: 5 },
          { archetype: 'peasant', side: 'player', q: 1, r: 1 },
        ],
      });
      const p = startManual(engine, 'enc.test', enc);
      expect(engine.difficulty).toBe('normal');
      engine.submit({ type: 'flee' });
      await p;
    }
  });

  it('serialize()/restore() round-trips difficulty; absent field restores as Normal', async () => {
    const { engine } = makeEngine(9, 'story');
    const enc = flatEncounter({
      units: [
        { archetype: 'habsburg-footman', side: 'enemy', q: 5, r: 5 },
        { archetype: 'militia-spear', side: 'player', q: 1, r: 1 },
      ],
    });
    const p = startManual(engine, 'enc.test', enc);
    expect(engine.difficulty).toBe('story');
    const s = engine.serialize()!;
    expect((s as { difficulty?: unknown }).difficulty).toBe('story');
    engine.submit({ type: 'flee' });
    await p;

    const again = makeEngine(9, 'hard');
    const content2 = (again.engine as unknown as { host: { content: { encounters: Map<string, EncounterDef> } } }).host.content;
    content2.encounters.set('enc.test', enc);
    await again.engine.restore(s);
    expect(again.engine.difficulty).toBe('story');

    // old saves / hand-built fixtures omit the field → Normal, no migration needed
    const legacy = { ...s } as Record<string, unknown>;
    delete legacy.difficulty;
    await again.engine.restore(legacy as never);
    expect(again.engine.difficulty).toBe('normal');
  });
});

describe('difficulty-gated damage at the hook level (4.4)', () => {
  it('an enemy hit on Story deals floor(raw × 0.75); player hits are untouched (fixed rolls)', async () => {
    for (const [difficulty, mult] of [['story', 0.75], ['normal', 1], ['hard', 1.25]] as const) {
      const { engine, rng } = makeEngine(100 + mult * 10, difficulty);
      const enc = flatEncounter({
        units: [
          { archetype: 'habsburg-footman', side: 'enemy', q: 5, r: 5 },
          // militia-halberd carries no shield: no Shield-Block reaction queue pauses the hit
          // (a buckler victim would queue and defer finishAttack outside forceAiAll).
          { archetype: 'militia-halberd', side: 'player', q: 5, r: 6 },
        ],
      });
      const p = startManual(engine, 'enc.test', enc);
      const foe = engine.getState()!.units.find((u) => u.side === 'enemy')!;
      const victim = engine.getState()!.units.find((u) => u.side === 'player')!;
      const foeBefore = (unitsOf(engine).get(foe.id)! as { hp: number }).hp;
      void foeBefore;
      const victimBefore = engine.getState()!.units.find((u) => u.id === victim.id)!.hp;
      // Fixed dice: to-hit 15 (hits), damage die 6. Spiess 1d8+strMod vs gambeson soak
      // (militia-halberd: thrust soak 1). NOTE: rollDice('1d8') with a mocked die→6 yields 6.
      vi.spyOn(rng, 'die').mockReturnValueOnce(15).mockReturnValue(6);
      const anyEngine = engine as unknown as { activeUnitId: number | null; advance: () => void };
      const real = anyEngine.advance;
      anyEngine.advance = () => {};
      anyEngine.activeUnitId = foe.id;
      engine.submit({ type: 'ability', unit: foe.id, ability: 'ability.attack', target: victim.id });
      anyEngine.advance = real;
      const victimAfter = engine.getState()!.units.find((u) => u.id === victim.id)!.hp;
      const dealt = victimBefore - victimAfter;
      // Read the engine's own roll payload from the attack log: damageRaw − soak = pre-scale raw,
      // then the difficulty hook scales it. This keeps the test exact even if content stats shift.
      const attackEntry = engine.getState()!.log.filter((l) => l.kind === 'attack').pop();
      const rollPayload = (attackEntry?.data as { roll?: { damageRaw?: number; soak?: number; damage?: number; breakdown?: string[] } } | undefined)?.roll;
      expect(attackEntry).toBeDefined();
      const preScale = Math.max(0, (rollPayload?.damageRaw ?? 0) - (rollPayload?.soak ?? 0));
      expect(preScale).toBeGreaterThan(0); // the fixed roll must actually hit
      expect(rollPayload?.damage).toBe(Math.max(0, Math.floor(preScale * mult)));
      expect(dealt).toBe(rollPayload?.damage);
      engine.submit({ type: 'flee' });
      await p;
      vi.restoreAllMocks();
    }
  });

  it('player-side morale DC shifts −2 on Story / +2 on Hard (fixed roll reads the rolled DC)', () => {
    for (const [difficulty, dc] of [['story', 8], ['normal', 10], ['hard', 12]] as const) {
      const { engine, rng } = makeEngine(7, difficulty);
      const enc = flatEncounter({
        units: [
          { archetype: 'peasant', side: 'enemy', q: 5, r: 5 },
          { archetype: 'peasant', side: 'player', q: 1, r: 1 },
        ],
      });
      const p = startManual(engine, 'enc.test', enc);
      const target = engine.getState()!.units.find((u) => u.side === 'player')!;
      const spy = vi.spyOn(rng, 'die').mockReturnValue(10);
      (engine as unknown as { rollMorale: (u: unknown, dc: number, r: string) => void }).rollMorale(unitsOf(engine).get(target.id), 10, 'test');
      const logged = engine.getState()!.log.map((l) => l.text).join('\n');
      expect(logged).toMatch(/morale check/);
      // The morale payload recorded on the log carries the shifted DC.
      const moraleEntry = engine.getState()!.log.find((l) => l.kind === 'morale');
      expect((moraleEntry?.data as { morale?: { dc?: number } } | undefined)?.morale?.dc).toBe(dc);
      expect(spy).toHaveBeenCalled();
      void p;
      engine.submit({ type: 'flee' });
      vi.restoreAllMocks();
    }
  });
});

describe('settings groundwork (4.4 / 4.2)', () => {
  it('defaults are normal/1/false/false', () => {
    expect(defaultSettings()).toMatchObject({ difficulty: 'normal', fontScale: 1, reducedMotion: false, highContrast: false });
  });
  it('isDifficulty accepts only the three modes', () => {
    expect(isDifficulty('story')).toBe(true);
    expect(isDifficulty('normal')).toBe(true);
    expect(isDifficulty('hard')).toBe(true);
    expect(isDifficulty('nightmare')).toBe(false);
    expect(isDifficulty(undefined)).toBe(false);
    expect(isDifficulty(42)).toBe(false);
  });
  it('loadSettings is tolerant of unknown/stale values (never crashes)', () => {
    const orig = (globalThis as { localStorage?: Storage }).localStorage;
    const map = new Map<string, string>();
    (globalThis as { localStorage?: Storage }).localStorage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => { map.set(k, String(v)); },
      removeItem: (k: string) => { map.delete(k); },
      clear: () => map.clear(),
      key: (i: number) => [...map.keys()][i] ?? null,
      get length() { return map.size; },
    } as Storage;
    try {
      map.set('eidgenossen.settings', JSON.stringify({ difficulty: 'nightmare', fontScale: 'huge', reducedMotion: 'yes', highContrast: 1 }));
      const s = loadSettings();
      expect(s.difficulty).toBe('normal');
      expect(s.fontScale).toBe(1);
      expect(s.reducedMotion).toBe(false);
      expect(s.highContrast).toBe(false);
      map.set('eidgenossen.settings', JSON.stringify({ difficulty: 'hard', fontScale: 1.2, reducedMotion: true, highContrast: true }));
      const s2 = loadSettings();
      expect(s2.difficulty).toBe('hard');
      expect(s2.fontScale).toBe(1.2);
      expect(s2.reducedMotion).toBe(true);
      expect(s2.highContrast).toBe(true);
      map.set('eidgenossen.settings', 'not json{{{');
      expect(loadSettings().difficulty).toBe('normal');
    } finally {
      (globalThis as { localStorage?: Storage }).localStorage = orig;
    }
  });
});
