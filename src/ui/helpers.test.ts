import { describe, it, expect } from 'vitest';
import {
  formatPfennig, compassX, normalizeAngle, formatHitChance, formatCheckOdds,
  cellToWorldXZ, worldToCell, buildInitiativeChips, buildSaveSlots,
  buildTargetCardModel, buildTargetCardHitBreakdown, formatPreviewHit,
} from './helpers';
import type { SaveMeta } from '@core/schemas';

describe('formatPfennig', () => {
  it('splits into Pfund/Schilling/Pfennig (240/12)', () => {
    expect(formatPfennig(0)).toMatchObject({ pfund: 0, schilling: 0, pfennig: 0 });
    expect(formatPfennig(4)).toMatchObject({ pfund: 0, schilling: 0, pfennig: 4 });
    expect(formatPfennig(12)).toMatchObject({ pfund: 0, schilling: 1, pfennig: 0 });
    expect(formatPfennig(240)).toMatchObject({ pfund: 1, schilling: 0, pfennig: 0 });
    expect(formatPfennig(240 + 12 * 5 + 4)).toMatchObject({ pfund: 1, schilling: 5, pfennig: 4 });
  });
  it('labels only nonzero components', () => {
    expect(formatPfennig(240).label).toBe('1 ℔');
    expect(formatPfennig(12).label).toBe('1 s');
    expect(formatPfennig(0).label).toBe('0 d');
    expect(formatPfennig(240 + 12 + 1).label).toBe('1 ℔ 1 s 1 d');
  });
  it('handles negative amounts', () => {
    const c = formatPfennig(-12);
    expect(c.schilling).toBe(-1);
    expect(c.label.startsWith('-')).toBe(true);
  });
});

describe('compass', () => {
  it('normalizeAngle wraps into (-PI, PI]', () => {
    expect(normalizeAngle(0)).toBeCloseTo(0);
    expect(normalizeAngle(Math.PI * 2 + 0.1)).toBeCloseTo(0.1);
    expect(normalizeAngle(-Math.PI * 3)).toBeCloseTo(Math.PI);
  });
  it('compassX centres a bearing matching yaw', () => {
    expect(compassX(0, 0, 180)).toBeCloseTo(0.5);
  });
  it('compassX places a bearing 45deg right of facing at 0.75 in a 180deg window', () => {
    const yaw = 0;
    const bearing = Math.PI / 4; // 45 deg
    expect(compassX(bearing, yaw, 180)).toBeCloseTo(0.5 + 45 / 180);
  });
  it('compassX returns null outside the window', () => {
    expect(compassX(Math.PI, 0, 180)).toBeNull(); // due south, 180deg off, at the edge -> excluded
    expect(compassX((100 * Math.PI) / 180, 0, 180)).toBeNull();
  });
  it('compassX is relative to player yaw, not absolute bearing', () => {
    const yaw = Math.PI / 2; // facing east
    expect(compassX(Math.PI / 2, yaw, 180)).toBeCloseTo(0.5); // looking exactly where facing
  });
});

describe('combat formatting', () => {
  it('formatHitChance rounds to percent and lists sources', () => {
    expect(formatHitChance(0.634, [], [])).toBe('63% hit');
    expect(formatHitChance(0.5, ['high ground'], [])).toBe('50% hit — Edge: high ground');
    expect(formatHitChance(0.5, [], ['exhausted'])).toBe('50% hit — Burden: exhausted');
    expect(formatHitChance(0.5, ['flanked'], ['long range'])).toBe('50% hit — Edge: flanked; Burden: long range');
  });
  it('formatHitChance stays the single formatter: legacy 3-arg call shape unchanged', () => {
    expect(formatHitChance(0.5, [], [])).toBe('50% hit');
  });
  it('formatHitChance detail extends (not forks) the base line', () => {
    const base = formatHitChance(0.5, ['flanked'], ['long range']);
    const full = formatHitChance(0.5, ['flanked'], ['long range'], {
      ranged: true, distanceCells: 6, distanceM: 9, heightDelta: 2, flanked: true, charge: false, damage: '1d8',
    });
    expect(full.startsWith(base)).toBe(true);
    expect(full).toContain('Range 6 cells (9.0 m)');
    expect(full).toContain('ranged');
    expect(full).toContain('flanked');
    expect(full).toContain('1d8');
  });
  it('formatHitChance detail skips zero heightDelta and melee labels correctly', () => {
    const s = formatHitChance(0.75, [], [], { ranged: false, distanceCells: 1, distanceM: 1.5, heightDelta: 0, damage: '1d6' });
    expect(s).toBe('75% hit · melee · Range 1 cells (1.5 m) · 1d6');
  });
  it('formatCheckOdds brackets a skill label and percent', () => {
    expect(formatCheckOdds('Speech', 65)).toBe('[Speech 65%]');
    expect(formatCheckOdds('Stealth', 64.6)).toBe('[Stealth 65%]');
  });
});

describe('combat grid cell picking (rotated grid)', () => {
  const grid = { cols: 8, rows: 6, cellM: 1.5, origin: { x: 100, z: -40, yaw: Math.PI / 6 } };
  it('round-trips cellToWorldXZ -> worldToCell for every cell', () => {
    for (let q = 0; q < grid.cols; q++) {
      for (let r = 0; r < grid.rows; r++) {
        const { x, z } = cellToWorldXZ(q, r, grid);
        expect(worldToCell(x, z, grid)).toEqual({ q, r });
      }
    }
  });
  it('centre cell maps back to the grid origin-relative centre', () => {
    const centre = cellToWorldXZ((grid.cols - 1) / 2, (grid.rows - 1) / 2, grid);
    expect(centre.x).toBeCloseTo(grid.origin.x);
    expect(centre.z).toBeCloseTo(grid.origin.z);
  });
  it('handles a zero-yaw grid as a plain axis-aligned lattice', () => {
    const flat = { cols: 4, rows: 4, cellM: 1.5, origin: { x: 0, z: 0, yaw: 0 } };
    // world (1.5, 0) is one cell east of centre (q=1.5) and on the centre row (r=1.5)
    expect(worldToCell(1.5, 0, flat)).toEqual({ q: 3, r: 2 });
  });
});

describe('initiative render model', () => {
  const units = [
    { id: 1, name: 'Kuoni', side: 'player' },
    { id: 2, name: 'Habsburg footman', side: 'enemy', down: true },
    { id: 3, name: 'Ueli', side: 'player' },
  ];
  it('orders chips per the order array and flags the active unit', () => {
    const chips = buildInitiativeChips([3, 1, 2], units, 3);
    expect(chips.map((c) => c.id)).toEqual([3, 1, 2]);
    expect(chips[0].active).toBe(true);
    expect(chips[1].active).toBe(false);
    expect(chips.find((c) => c.id === 2)?.down).toBe(true);
  });
  it('skips ids not present in the roster', () => {
    const chips = buildInitiativeChips([99, 1], units, null);
    expect(chips.map((c) => c.id)).toEqual([1]);
  });
  it('buildTargetCardModel without preview keeps the legacy card (hit null)', () => {
    const u = {
      id: 8, name: 'Reisläufer', side: 'enemy', q: 1, r: 1, hp: 12, hpMax: 12, morale: 40, moraleMax: 60,
      initiative: 0, ap: { action: true, bonus: true, reaction: true, moveM: 9, moveMax: 9 },
      status: [], stance: 'neutral', loaded: false, mounted: false, down: false, routed: false,
      defense: 11, weapon: null, abilities: [],
      formation: { adjacentPolearms: 0, inHaufen: false, defenseBonus: 0 },
      isPlayerControlled: false, archetype: 'peasant', attributes: {},
    } as never;
    const m = buildTargetCardModel(u as never);
    expect(m?.name).toBe('Reisläufer');
    expect(m?.hit ?? null).toBeNull();
  });
  it('buildTargetCardModel attaches the hit breakdown when a preview is supplied', () => {
    const u = {
      id: 8, name: 'Reisläufer', side: 'enemy', q: 4, r: 1, hp: 12, hpMax: 12, morale: 40, moraleMax: 60,
      initiative: 0, ap: { action: true, bonus: true, reaction: true, moveM: 9, moveMax: 9 },
      status: [], stance: 'neutral', loaded: false, mounted: false, down: false, routed: false,
      defense: 11, weapon: null, abilities: [],
      formation: { adjacentPolearms: 0, inHaufen: false, defenseBonus: 0 },
      isPlayerControlled: false, archetype: 'peasant', attributes: {},
    } as never;
    const preview = {
      hitChance: 0.6,
      context: { edge: ['high ground'], burden: [], ranged: true, distanceCells: 6, heightDelta: 2, flanked: false, charge: false },
      damage: '1d8',
    };
    const m = buildTargetCardModel(u as never, preview, 1.5);
    expect(m?.hit).toMatchObject({
      hitChance: 0.6, edge: ['high ground'], burden: [], ranged: true,
      distanceCells: 6, distanceM: 9, heightDelta: 2, flanked: false, charge: false,
      damage: '1d8', cover: null,
    });
    expect(m?.hit?.hitLine).toContain('60% hit');
    expect(m?.hit?.hitLine).toContain('Range 6 cells (9.0 m)');
  });
  it('formatPreviewHit / buildTargetCardHitBreakdown convert cells to metres via cellM', () => {
    const preview = {
      hitChance: 0.5, context: { edge: [], burden: ['long range'], ranged: true, distanceCells: 2, heightDelta: -1, flanked: true, charge: true }, damage: '1d6',
    };
    expect(formatPreviewHit(preview, 1.5)).toContain('Range 2 cells (3.0 m)');
    expect(buildTargetCardHitBreakdown(preview, 2).distanceM).toBe(4);
    expect(buildTargetCardHitBreakdown(preview).hitLine).toBe(formatPreviewHit(preview));
    // cover is not in AttackContext — the model reports the gap explicitly
    expect(buildTargetCardHitBreakdown(preview).cover).toBeNull();
  });
});

describe('save slot model', () => {
  it('produces 7 fixed slots with kinds and fills in metas', () => {
    const metas: SaveMeta[] = [
      { slot: 0, label: 'Autosave', createdAt: '', updatedAt: '', chapter: 'prologue-1291', calendar: '', location: '', playtimeSec: 10, schemaVersion: 1, bytes: 100 },
      { slot: 2, label: 'Slot 2', createdAt: '', updatedAt: '', chapter: 'prologue-1291', calendar: '', location: '', playtimeSec: 10, schemaVersion: 1, bytes: 100 },
    ];
    const slots = buildSaveSlots(metas);
    expect(slots).toHaveLength(7);
    expect(slots[0]).toMatchObject({ slot: 0, kind: 'autosave', empty: false });
    expect(slots[1]).toMatchObject({ slot: 1, kind: 'manual', empty: true });
    expect(slots[2]).toMatchObject({ slot: 2, kind: 'manual', empty: false });
    expect(slots[6]).toMatchObject({ slot: 6, kind: 'quicksave', readOnlySave: true });
  });
});
