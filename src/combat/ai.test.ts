import { describe, it, expect } from 'vitest';
import { World } from '@core/ecs';
import { Rng } from '@core/rng';
import type { EncounterDef } from '@core/schemas';
import { CombatEngineImpl, type CombatHost } from './engine';
import { decideAndAct } from './ai';
import { FakePartyService, makeTestContent } from './testUtils';

function makeEngine(seed: number) {
  const world = new World();
  const content = makeTestContent();
  const party = new FakePartyService(world, content);
  const rng = new Rng(seed);
  const host: CombatHost = { world, content, party, rng };
  const engine = new CombatEngineImpl(host);
  return { engine, rng };
}

function startNoCascade(engine: CombatEngineImpl, enc: EncounterDef): void {
  const anyEngine = engine as unknown as { advance: () => void };
  const real = anyEngine.advance.bind(engine);
  anyEngine.advance = () => {};
  void engine.start('enc.test', { encounterOverride: enc });
  anyEngine.advance = real;
}

describe('knight AI doctrine', () => {
  it('never charges into a Haufen front when an isolated non-polearm target exists', () => {
    // Deterministic across a spread of seeds: a knight, a 2x2 spear Haufen, and one isolated peasant target
    // both within charge range. The knight must attack the peasant, not a Haufen member.
    for (const seed of [1, 2, 3, 4, 5]) {
      const { engine, rng } = makeEngine(seed);
      const enc: EncounterDef = {
        id: 'enc.test', name: 'Test', location: { x: 0, z: 0, yaw: 0 },
        grid: { cols: 20, rows: 20, cellM: 1.5 }, heightOverride: 'flat',
        deploy: { q: 0, r: 0, cols: 2, rows: 2 },
        units: [
          { archetype: 'militia-spear', side: 'player', q: 5, r: 5 },
          { archetype: 'militia-spear', side: 'player', q: 6, r: 5 },
          { archetype: 'militia-spear', side: 'player', q: 5, r: 6 },
          { archetype: 'militia-spear', side: 'player', q: 6, r: 6 },
          { archetype: 'peasant', side: 'player', q: 9, r: 5 }, // isolated, non-polearm, in range too
          { archetype: 'habsburg-knight', side: 'enemy', q: 9, r: 9, mounted: true },
        ],
        objectives: [{ type: 'defeat-all' }],
        historical: 'invented', note: 'test fixture', description: 'test fixture',
      };
      startNoCascade(engine, enc);
      const units = engine.unitList();
      const knight = units.find((u) => u.side === 'enemy')!;
      const haufenFront = units.filter((u) => u.archetype === 'militia');
      expect(haufenFront.every((u) => u.formation.inHaufen)).toBe(true);

      decideAndAct(engine, knight, rng);

      const log = engine.serialize()!.log.join('\n');
      const attackedHaufen = haufenFront.some((u) => log.includes(`attacks ${u.name}`));
      expect(attackedHaufen).toBe(false);
    }
  });

  it('decides within budget (no pathological slowness) on a large grid', () => {
    const { engine, rng } = makeEngine(9);
    const enc: EncounterDef = {
      id: 'enc.test', name: 'Test', location: { x: 0, z: 0, yaw: 0 },
      grid: { cols: 40, rows: 24, cellM: 1.5 }, heightOverride: 'flat',
      deploy: { q: 0, r: 0, cols: 2, rows: 2 },
      units: [
        { archetype: 'militia-spear', side: 'player', q: 5, r: 5 },
        { archetype: 'habsburg-knight', side: 'enemy', q: 35, r: 20, mounted: true },
      ],
      objectives: [{ type: 'defeat-all' }],
      historical: 'invented', note: 'test fixture', description: 'test fixture',
    };
    startNoCascade(engine, enc);
    const knight = engine.unitList().find((u) => u.side === 'enemy')!;
    const t0 = Date.now();
    decideAndAct(engine, knight, rng);
    expect(Date.now() - t0).toBeLessThan(200); // ARCHITECTURE §5.3 / §2: AI turn decides in ≤ 200 ms
  });
});
