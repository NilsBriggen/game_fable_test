import { describe, it, expect } from 'vitest';
import { generateLayout, type HeightProbe, type LayoutInput } from './layout';

const FLAT_DRY: HeightProbe = { heightAt: () => 0, isWater: () => false };

function counts(items: { modelId: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items) out[it.modelId] = (out[it.modelId] ?? 0) + 1;
  return out;
}

describe('generateLayout — model counts per kind', () => {
  it('village: 6–14 house.blockbau around a well + church/chapel + a cross', () => {
    const input: LayoutInput = { id: 'poi.testvillage', kind: 'village', x: 0, z: 0, population: { peasant: 6, elder: 2 } };
    const out = generateLayout(input, FLAT_DRY);
    const c = counts(out);
    expect(c['house.blockbau']).toBeGreaterThanOrEqual(6);
    expect(c['house.blockbau']).toBeLessThanOrEqual(14);
    expect(c['well']).toBe(1);
    expect((c['church'] ?? 0) + (c['chapel'] ?? 0)).toBe(1);
    expect(c['cross']).toBe(1);
  });

  it('village population count scales the house count within [6,14]', () => {
    const small = generateLayout({ id: 'poi.small', kind: 'village', x: 0, z: 0, population: { peasant: 1 } }, FLAT_DRY);
    const big = generateLayout({ id: 'poi.big', kind: 'village', x: 0, z: 0, population: { peasant: 20, elder: 3, merchant: 2 } }, FLAT_DRY);
    const cs = counts(small)['house.blockbau'];
    const cb = counts(big)['house.blockbau'];
    expect(cs).toBeGreaterThanOrEqual(6);
    expect(cb).toBe(14); // clamps at the task-spec ceiling
    expect(cb).toBeGreaterThanOrEqual(cs);
  });

  it('town: house.stone rows + a castle.wall perimeter with a gate gap + a church', () => {
    const out = generateLayout({ id: 'poi.luzern', kind: 'town', x: 0, z: 0, population: { merchant: 4, peasant: 4 } }, FLAT_DRY);
    const c = counts(out);
    expect(c['house.stone']).toBeGreaterThanOrEqual(10);
    expect(c['castle.wall']).toBeGreaterThan(0);
    expect((c['church'] ?? 0) + (c['chapel'] ?? 0)).toBe(1);
  });

  it('castle: a keep + 4 towers + wall segments', () => {
    const out = generateLayout({ id: 'poi.attinghausen', kind: 'castle', x: 0, z: 0 }, FLAT_DRY);
    const c = counts(out);
    expect(c['castle.keep']).toBe(1);
    expect(c['castle.tower']).toBe(4);
    expect(c['castle.wall']).toBe(4);
  });

  it('monastery: the monastery model (church + cloister) plus a cross', () => {
    const out = generateLayout({ id: 'poi.einsiedeln', kind: 'monastery', x: 0, z: 0 }, FLAT_DRY);
    const c = counts(out);
    expect(c['monastery']).toBe(1);
    expect(c['cross']).toBe(1);
  });

  it('alp: 1–3 huts', () => {
    const one = counts(generateLayout({ id: 'poi.alp1', kind: 'alp', x: 0, z: 0 }, FLAT_DRY))['house.blockbau'];
    const three = counts(generateLayout({ id: 'poi.alp2', kind: 'alp', x: 0, z: 0, population: { herder: 6 } }, FLAT_DRY))['house.blockbau'];
    expect(one).toBeGreaterThanOrEqual(1);
    expect(one).toBeLessThanOrEqual(3);
    expect(three).toBe(3);
  });

  it('pass: a hospice + cross', () => {
    const c = counts(generateLayout({ id: 'poi.gotthard', kind: 'pass', x: 0, z: 0 }, FLAT_DRY));
    expect(c['house.stone']).toBe(1);
    expect(c['cross']).toBe(1);
  });

  it('bridge: a single bridge.stone at the given yaw', () => {
    const out = generateLayout({ id: 'poi.teufelsbruecke', kind: 'bridge', x: 0, z: 0, yaw: 1.2 }, FLAT_DRY);
    expect(out).toHaveLength(1);
    expect(out[0].modelId).toBe('bridge.stone');
  });

  it('port: boats scaled by boatman+fisher population, plus a small quay building', () => {
    const c = counts(generateLayout({ id: 'poi.brunnen', kind: 'port', x: 0, z: 0, population: { boatman: 2, fisher: 2 } }, FLAT_DRY));
    expect(c['boat']).toBe(5); // clamped to [2,5]
    expect(c['house.blockbau']).toBe(1);
  });

  it('landmark/viewpoint/battlefield/meadow: no built layout', () => {
    for (const kind of ['landmark', 'viewpoint', 'battlefield', 'meadow'] as const) {
      expect(generateLayout({ id: `poi.${kind}`, kind, x: 0, z: 0 }, FLAT_DRY)).toHaveLength(0);
    }
  });
});

describe('generateLayout — never places a model on water', () => {
  it('an all-water probe places nothing (dry-spot search exhausted, item skipped)', () => {
    const allWater: HeightProbe = { heightAt: () => 0, isWater: () => true };
    const out = generateLayout({ id: 'poi.sunken', kind: 'village', x: 500, z: 500, population: { peasant: 8 } }, allWater);
    expect(out).toHaveLength(0);
  });

  it('nudges buildings out of a partially-flooded footprint instead of placing them in it', () => {
    // South of the settlement centre (z > 10) is water; everything returned must be north of that line.
    const halfWater: HeightProbe = { heightAt: () => 0, isWater: (_x, z) => z > 10 };
    const out = generateLayout({ id: 'poi.shoreline', kind: 'village', x: 0, z: 0, population: { peasant: 10 } }, halfWater);
    expect(out.length).toBeGreaterThan(0);
    for (const m of out) expect(m.z).toBeLessThanOrEqual(10);
  });

  it('is deterministic: the same POI id lays out identically across calls', () => {
    const input: LayoutInput = { id: 'poi.determinism', kind: 'village', x: 12, z: -34, yaw: 0.5, population: { peasant: 9 } };
    const a = generateLayout(input, FLAT_DRY);
    const b = generateLayout(input, FLAT_DRY);
    expect(a).toEqual(b);
  });

  it('too-steep ground is also rejected, not just water: a flat disk around the centre, cliff beyond it', () => {
    const cliff: HeightProbe = {
      heightAt: (x, z) => Math.max(0, Math.hypot(x, z) - 8) * 10, // flat within 8 m of centre, near-vertical beyond
      isWater: () => false,
    };
    const out = generateLayout({ id: 'poi.cliffside', kind: 'village', x: 0, z: 0, population: { peasant: 8 } }, cliff);
    expect(out.length).toBeGreaterThan(0);
    // every placed building must sit on a locally gentle patch (finite-difference < 3.5 m over 3 m, matching layout.ts)
    for (const m of out) {
      const h0 = cliff.heightAt(m.x, m.z);
      expect(Math.abs(cliff.heightAt(m.x + 3, m.z) - h0)).toBeLessThan(3.5);
      expect(Math.abs(cliff.heightAt(m.x, m.z + 3) - h0)).toBeLessThan(3.5);
    }
  });
});
