import { describe, it, expect } from 'vitest';
import { formationBonus, isFlanked, type FormationUnit } from './formation';

function unit(id: number, q: number, r: number, side: 'player' | 'enemy' = 'player', polearm = true): FormationUnit {
  return { id, q, r, side, polearm, down: false };
}

describe('formationBonus (Gewalthaufen)', () => {
  it('grants +1 Defense per adjacent allied polearm unit, capped at +3', () => {
    const centre = unit(1, 2, 2);
    const ring = [unit(2, 1, 2), unit(3, 3, 2), unit(4, 2, 1), unit(5, 2, 3), unit(6, 1, 1)];
    const all = [centre, ...ring];
    const status = formationBonus(centre, all);
    expect(status.adjacentPolearms).toBe(5);
    expect(status.defenseBonus).toBe(3);
  });

  it('a 2×2 block of 4 mutually-adjacent polearm allies forms a Haufen', () => {
    const units = [unit(1, 0, 0), unit(2, 1, 0), unit(3, 0, 1), unit(4, 1, 1)];
    for (const u of units) {
      const status = formationBonus(u, units);
      expect(status.inHaufen).toBe(true);
    }
    // all four share the same Haufen id
    const ids = units.map((u) => formationBonus(u, units).haufenId);
    expect(new Set(ids).size).toBe(1);
  });

  it('the same 4 units spread apart do NOT form a Haufen', () => {
    const units = [unit(1, 0, 0), unit(2, 5, 0), unit(3, 0, 5), unit(4, 5, 5)];
    for (const u of units) {
      const status = formationBonus(u, units);
      expect(status.inHaufen).toBe(false);
      expect(status.adjacentPolearms).toBe(0);
    }
  });

  it('a down unit contributes no formation bonus and gets none itself', () => {
    const centre = unit(1, 2, 2);
    const dead = { ...unit(2, 1, 2), down: true };
    const status = formationBonus(centre, [centre, dead]);
    expect(status.adjacentPolearms).toBe(0);
    const deadStatus = formationBonus(dead, [centre, dead]);
    expect(deadStatus.defenseBonus).toBe(0);
    expect(deadStatus.inHaufen).toBe(false);
  });
});

describe('isFlanked', () => {
  it('is true when two hostiles sit on opposite sides of the target', () => {
    const target = { q: 5, r: 5 };
    const attacker = { q: 4, r: 5 };
    const other = { q: 6, r: 5 };
    expect(isFlanked(target, attacker, [other])).toBe(true);
  });

  it('is false when hostiles are on the same side', () => {
    const target = { q: 5, r: 5 };
    const attacker = { q: 4, r: 5 };
    const other = { q: 4, r: 6 };
    expect(isFlanked(target, attacker, [other])).toBe(false);
  });

  it('is false with only one attacker', () => {
    const target = { q: 5, r: 5 };
    const attacker = { q: 4, r: 5 };
    expect(isFlanked(target, attacker, [])).toBe(false);
  });
});
