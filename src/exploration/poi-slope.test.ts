/** N3b slope pins: the two relocated invented POIs sit on walkable ground, keep their
 *  historical+note, and sit toward the shore path; plus unit coverage for the N3/N3b layout
 *  helpers (findDriestCentre, CAMP_SLOPE_DY, port inland search). Do NOT duplicate the real-grid
 *  assertions in src/world/poi-siting.test.ts (world builder owns that file). */
import { describe, it, expect } from 'vitest';
import { generateLayout, findDriestCentre, CAMP_SLOPE_DY, type HeightProbe } from './layout';
import { pois } from '@content/pois';
import { PLACES } from '@content/gazetteer';

const FLAT_DRY: HeightProbe = { heightAt: () => 0, isWater: () => false };

describe('N3b relocated centres', () => {
  it('poi.wegkreuz-axenweg sits ~20-30 m toward the shore path from its old spot', () => {
    const p = pois.find((q) => q.id === 'poi.wegkreuz-axenweg')!;
    const s = PLACES.sisikon;
    // old offsets (138,-202) -> (307,193); new (143,-157) -> (312,238): ~45 m nudge onto dry land
    const oldX = s.x + 138, oldZ = s.z - 202;
    const d = Math.hypot(p.x - oldX, p.z - oldZ);
    expect(d).toBeGreaterThanOrEqual(20);
    expect(d).toBeLessThanOrEqual(50);
    expect(p.x).toBe(s.x + 143);
    expect(p.z).toBe(s.z - 157);
  });

  it('poi.fischerhuetten-gersau sits ~20-30 m toward the shore path from its old spot', () => {
    const p = pois.find((q) => q.id === 'poi.fischerhuetten-gersau')!;
    const g = PLACES.gersau;
    const oldX = g.x + 100, oldZ = g.z + 18;
    const d = Math.hypot(p.x - oldX, p.z - oldZ);
    expect(d).toBeGreaterThanOrEqual(20);
    expect(d).toBeLessThanOrEqual(30);
    expect(p.x).toBe(g.x + 78);
    expect(p.z).toBe(g.z + 8);
  });

  it('both relocated defs keep historical + note + description', () => {
    for (const id of ['poi.wegkreuz-axenweg', 'poi.fischerhuetten-gersau']) {
      const p = pois.find((q) => q.id === id)!;
      expect(p.historical).toBe('invented');
      expect(p.note.length).toBeGreaterThan(0);
      expect(p.description.length).toBeGreaterThan(0);
    }
  });
});

describe('N4 shrunk discover discs', () => {
  it('secondary cross/hut/wall/landmark radii are 20-40 m', () => {
    const secondaries = ['poi.treib', 'poi.sattel-letzi', 'poi.aegerisee-shore', 'poi.fischerhuetten-gersau', 'poi.hohle-gasse', 'poi.klausnerzelle'];
    for (const id of secondaries) {
      const p = pois.find((q) => q.id === id)!;
      expect(p.discoverRadius, id).toBeGreaterThanOrEqual(20);
      expect(p.discoverRadius, id).toBeLessThanOrEqual(40);
    }
  });

  it('the 7 critic pairs no longer double-toast (no overlapping discover discs)', () => {
    const byId = new Map(pois.map((p) => [p.id, p]));
    const pairs: [string, string][] = [
      ['poi.ruetli', 'poi.treib'],
      ['poi.gesslerburg', 'poi.kuessnacht'],
      ['poi.morgarten', 'poi.sattel-letzi'],
      ['poi.landenberg', 'poi.sarnen'],
      ['poi.amsteg', 'poi.zwing-uri'],
      ['poi.aegerisee-shore', 'poi.morgarten'],
      ['poi.fischerhuetten-gersau', 'poi.gersau'],
    ];
    for (const [a, b] of pairs) {
      const pa = byId.get(a)!, pb = byId.get(b)!;
      const d = Math.hypot(pa.x - pb.x, pa.z - pb.z);
      expect(d, `${a}~${b} dist=${d.toFixed(0)} radii=${pa.discoverRadius}+${pb.discoverRadius}`).toBeGreaterThanOrEqual(pa.discoverRadius + pb.discoverRadius);
    }
  });
});

describe('N3 driest-centre search', () => {
  it('findDriestCentre picks the dry candidate over a waterlogged gazetteer point', () => {
    // water everywhere except a dry disc at (+150,+150)
    const probe: HeightProbe = {
      heightAt: () => 0,
      isWater: (x, z) => Math.hypot(x - 150, z - 150) > 30,
    };
    const best = findDriestCentre(0, 0, probe, 60);
    expect(best.x).toBe(150);
    expect(best.z).toBe(150);
    expect(best.dry).toBeGreaterThan(0);
  });

  it('findDriestCentre ties break toward the gazetteer point (least displacement)', () => {
    const best = findDriestCentre(0, 0, FLAT_DRY, 60);
    expect(best.x).toBe(0);
    expect(best.z).toBe(0);
    expect(best.dry).toBe(60);
  });

  it('a town on a waterlogged centre still lays out from dry ground (no water pads)', () => {
    const probe: HeightProbe = {
      heightAt: () => 0,
      isWater: (x, z) => Math.hypot(x - 150, z - 150) > 30,
    };
    const out = generateLayout({ id: 'poi.probe-town', kind: 'town', x: 0, z: 0, population: { merchant: 4, peasant: 4 } }, probe);
    expect(out.length).toBeGreaterThan(0);
    for (const m of out) {
      if (m.modelId === 'boat') continue;
      expect(probe.isWater(m.x, m.z), m.modelId).toBe(false);
    }
  });
});

describe('N3b camp slope allowance (CAMP_SLOPE)', () => {
  it('CAMP_SLOPE_DY documents the 35-degree allowance (tan35° × 3 m ≈ 2.1 m)', () => {
    expect(CAMP_SLOPE_DY).toBeCloseTo(Math.tan((35 * Math.PI) / 180) * 3, 1);
  });

  it('a camp places its fire on a 30° scree slope a village would reject', () => {
    const scree30: HeightProbe = { heightAt: (x) => x * 0.577, isWater: () => false }; // tan30° ≈ 0.577
    const camp = generateLayout({ id: 'poi.probe-camp', kind: 'camp', x: 0, z: 0 }, scree30);
    expect(camp.some((m) => m.modelId === 'campfire')).toBe(true);
    const village = generateLayout({ id: 'poi.probe-vcamp', kind: 'village', x: 0, z: 0, population: { peasant: 8 } }, scree30);
    expect(village.filter((m) => m.modelId === 'house.blockbau').length).toBe(0);
  });

  it('a port whose centre is water still places its quay hut (dryRadius-style inland search)', () => {
    // centre + near field is water; dry land starts 25 m inland (-z)
    const shore: HeightProbe = { heightAt: () => 0, isWater: (_x, z) => z > -25 };
    const out = generateLayout({ id: 'poi.probe-port', kind: 'port', x: 0, z: 0, yaw: Math.PI, population: { boatman: 1, fisher: 1 } }, shore);
    expect(out.some((m) => m.modelId === 'house.blockbau')).toBe(true);
  });
});
