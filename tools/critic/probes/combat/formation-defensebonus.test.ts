import { describe, it, expect } from 'vitest';
import { formationBonus, type FormationUnit } from '../../../../src/combat/rules/formation';

// ARCHITECTURE.md §5.3 / §5.5: "a unit with a reach polearm gains +1 Defense per adjacent allied polearm
// unit (max +3)". The Defense bonus is explicitly gated on the unit ITSELF carrying a polearm — a
// non-polearm unit (crossbowman, dagger-armed footman, ...) standing next to allied pikemen is not
// described anywhere as getting free Defense from it.
//
// src/combat/rules/formation.ts's formationBonus() computes `defenseBonus` from `adjacentPolearms` without
// ever checking `unit.polearm` — so ANY unit (polearm or not) standing next to allied polearm units gets the
// bonus, and engine.ts's effectiveDefense() (engine.ts:1010) folds `u.formation.defenseBonus` straight into
// Defense, and rollMorale() (engine.ts:1681) folds the same number into every morale check's DC comparison.
describe('bug: formationBonus grants the Gewalthaufen Defense bonus to non-polearm units', () => {
  function unit(id: number, q: number, r: number, opts: Partial<FormationUnit> = {}): FormationUnit {
    return { id, q, r, side: 'player', polearm: false, down: false, ...opts };
  }

  it('a non-polearm unit (e.g. a crossbowman) adjacent to 3 allied polearm units gets +0 Defense per §5.3, not +3', () => {
    const crossbowman = unit(1, 2, 2, { polearm: false });
    const pikemen = [unit(2, 1, 2, { polearm: true }), unit(3, 3, 2, { polearm: true }), unit(4, 2, 1, { polearm: true })];
    const all = [crossbowman, ...pikemen];

    const status = formationBonus(crossbowman, all);

    expect(status.adjacentPolearms).toBe(3); // geometry is fine — this part is correct
    // EXPECTED (§5.3, "a unit WITH a reach polearm gains..."): 0, since the crossbowman carries no polearm.
    // ACTUAL: formationBonus never checks `unit.polearm` before computing defenseBonus.
    expect(status.defenseBonus).toBe(0); // <-- fails: actual value is 3
  });
});
