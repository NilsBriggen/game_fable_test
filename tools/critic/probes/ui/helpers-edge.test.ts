/**
 * Critic probes (wave 3, ui) — edge cases of src/ui/helpers.ts that the builder's own tests do not cover:
 * currency sign/fraction/NaN handling, rotated-grid cell picking at yaw ±π/2 and π checked against the
 * combat engine's own cellToWorldXZ, compass wrap-around and the duplicate 'S' chip, initiative chips with
 * dead/routed/missing/duplicate ids, and the 7-slot save model with out-of-range and duplicate metas.
 * Tests that document a defect are marked DEFECT in their name and assert the *current* behaviour so the
 * sheet can cite them; they should be inverted once the builder fixes the helper.
 */
import { describe, it, expect } from 'vitest';
import {
  formatPfennig, worldToCell, cellToWorldXZ, compassX, compassCardinals, normalizeAngle,
  buildInitiativeChips, buildSaveSlots, formatHitChance,
} from '../../../../src/ui/helpers';
import { cellToWorldXZ as engineCellToWorldXZ } from '../../../../src/combat/rules/grid';
import type { SaveMeta } from '@core/schemas';

const meta = (slot: number, label = `m${slot}`): SaveMeta => ({
  slot, label, createdAt: '', updatedAt: '', chapter: 'prologue-1291', calendar: '', location: 'Altdorf', playtimeSec: 0, schemaVersion: 1, bytes: 1,
});

describe('currency edge cases', () => {
  it('negative composite amounts keep one leading minus and per-part magnitudes', () => {
    const c = formatPfennig(-(240 + 12 + 1));
    expect(c.label).toBe('-1 ℔ 1 s 1 d');
    expect([c.pfund, c.schilling, c.pfennig]).toEqual([-1, -1, -1]);
  });
  it('fractional Pfennig are floored, never shown', () => {
    expect(formatPfennig(7.9).label).toBe('7 d');
    expect(formatPfennig(239.999).label).toBe('239 d'.replace('239 d', '19 s 11 d'));
  });
  it('FIXED r2: a negative fraction below one Pfennig renders as "0 d" with a +0 pfund', () => {
    const c = formatPfennig(-0.5);
    expect(c.label).toBe('0 d');
    expect(Object.is(c.pfund, 0)).toBe(true);
  });
  it('FIXED r2: non-finite input is guarded to 0 d', () => {
    expect(formatPfennig(Number.NaN).label).toBe('0 d');
    expect(formatPfennig(Number.POSITIVE_INFINITY).label).toBe('0 d');
  });
  it('large purses carry over correctly (100 000 d = 416 ℔ 13 s 4 d)', () => {
    expect(formatPfennig(100_000).label).toBe('416 ℔ 13 s 4 d');
  });
});

describe('rotated-grid cell picking vs the combat engine', () => {
  const yaws = [Math.PI / 2, -Math.PI / 2, Math.PI, -Math.PI, 0.3, 2.9];
  for (const yaw of yaws) {
    const grid = { cols: 12, rows: 9, cellM: 1.5, origin: { x: -312.5, z: 918.25, yaw } };
    it(`yaw=${yaw.toFixed(3)}: helpers.cellToWorldXZ matches engine cellToWorldXZ and worldToCell inverts it for every cell`, () => {
      for (let q = 0; q < grid.cols; q++) {
        for (let r = 0; r < grid.rows; r++) {
          const e = engineCellToWorldXZ(q, r, grid as never);
          const h = cellToWorldXZ(q, r, grid);
          expect(h.x).toBeCloseTo(e.x, 9);
          expect(h.z).toBeCloseTo(e.z, 9);
          expect(worldToCell(e.x, e.z, grid)).toEqual({ q, r });
        }
      }
    });
    it(`yaw=${yaw.toFixed(3)}: a point 0.49 cells along local +q still picks the cell, 0.51 picks the neighbour`, () => {
      const c = engineCellToWorldXZ(4, 3, grid as never);
      const cos = Math.cos(yaw), sin = Math.sin(yaw);
      const off = (k: number) => ({ x: c.x + k * grid.cellM * cos, z: c.z + k * grid.cellM * sin }); // local +x axis in world
      const a = off(0.49), b = off(0.51);
      expect(worldToCell(a.x, a.z, grid)).toEqual({ q: 4, r: 3 });
      expect(worldToCell(b.x, b.z, grid)).toEqual({ q: 5, r: 3 });
    });
  }
  it('DEFECT (caller-side): worldToCell does not clamp — a click far off the grid yields negative / oversized cells that combatUi submits as-is', () => {
    const grid = { cols: 8, rows: 6, cellM: 1.5, origin: { x: 0, z: 0, yaw: Math.PI / 2 } };
    const far = worldToCell(0, -100, grid); // 100 m along local -x
    expect(far.q).toBeLessThan(0);
    expect(worldToCell(0, 100, grid).q).toBeGreaterThan(grid.cols - 1);
  });
});

describe('compass wrap-around', () => {
  it('a bearing just across the ±π seam from the facing lands next to centre, not at the far edge', () => {
    const d = Math.PI / 180;
    expect(compassX(179 * d, -179 * d, 180)).toBeCloseTo(0.5 - 2 / 180, 6);
    expect(compassX(-179 * d, 179 * d, 180)).toBeCloseTo(0.5 + 2 / 180, 6);
  });
  it('yaw values outside (-π, π] are normalised (3π ≡ π)', () => {
    expect(normalizeAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(compassX(Math.PI, 3 * Math.PI, 180)).toBeCloseTo(0.5);
  });
  it('FIXED r2: facing due south renders exactly one S chip, centred', () => {
    const chips = compassCardinals(Math.PI, 180);
    const s = chips.filter((c) => c.letter === 'S');
    expect(s.length).toBe(1);
    expect(s[0].x).toBeCloseTo(0.5);
  });
  it('a 180° window shows exactly three cardinals when facing a cardinal direction (N: W N E)', () => {
    const chips = compassCardinals(0, 180).map((c) => c.letter).sort();
    expect(chips).toEqual(['E', 'N', 'W']);
  });
});

describe('initiative chips with dead / routed / missing / duplicate units', () => {
  const units = [
    { id: 1, name: 'Kuoni', side: 'player' },
    { id: 2, name: 'Footman', side: 'enemy', down: true },
    { id: 3, name: 'Knight', side: 'enemy', routed: true },
    { id: 4, name: 'Ueli', side: 'player', down: true, routed: true },
  ];
  it('routed counts as down for the strip, dead ids removed from the roster are skipped', () => {
    const chips = buildInitiativeChips([3, 99, 2, 1, 4], units, 1);
    expect(chips.map((c) => c.id)).toEqual([3, 2, 1, 4]);
    expect(chips.map((c) => c.down)).toEqual([true, true, false, true]);
    expect(chips.filter((c) => c.active).map((c) => c.id)).toEqual([1]);
  });
  it('an active id that is down is still flagged active (engine never does this, helper does not guard)', () => {
    const chips = buildInitiativeChips([2, 1], units, 2);
    expect(chips[0]).toMatchObject({ id: 2, active: true, down: true });
  });
  it('DEFECT: duplicate ids in `order` produce duplicate chips', () => {
    expect(buildInitiativeChips([1, 1], units, null)).toHaveLength(2);
  });
});

describe('save slot model', () => {
  it('always yields 7 slots; 0 autosave, 1-5 manual, 6 quicksave read-only for saving', () => {
    const slots = buildSaveSlots([]);
    expect(slots.map((s) => s.slot)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(slots.map((s) => s.kind)).toEqual(['autosave', 'manual', 'manual', 'manual', 'manual', 'manual', 'quicksave']);
    expect(slots.map((s) => s.readOnlySave)).toEqual([false, false, false, false, false, false, true]);
    expect(slots.every((s) => s.empty)).toBe(true);
  });
  it('metas with out-of-range slots (7, -1) are dropped silently rather than crashing or adding slots', () => {
    const slots = buildSaveSlots([meta(7), meta(-1), meta(6)]);
    expect(slots).toHaveLength(7);
    expect(slots[6].empty).toBe(false);
  });
  it('duplicate metas for one slot: the last one wins', () => {
    const slots = buildSaveSlots([meta(3, 'first'), meta(3, 'second')]);
    expect(slots[3].meta?.label).toBe('second');
  });
});

describe('hit-chance formatting bounds', () => {
  it('DEFECT: no clamp — hitChance > 1 or NaN leaks into the card', () => {
    expect(formatHitChance(1.2, [], [])).toBe('120% hit');
    expect(formatHitChance(Number.NaN, [], [])).toBe('NaN% hit');
  });
});
