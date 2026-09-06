/**
 * Water surface geometry: the lake polygons of the Vierwaldstättersee are strongly concave (five
 * arms radiating from Brunnen), so the triangulation has to be a real ear clip — a centroid fan
 * would lay water over the land between the arms.
 */
import { describe, it, expect } from 'vitest';
import { LAKES } from '@content/gazetteer';
import { earClip, signedArea, waterBodyMix, waterFresnelFactor, waterSunLobeFactor, waterSunSpecFactor } from './water';
import { wobbleShore } from './geodata';
import { pointInPolygon } from '@core/math';

function triArea(a: [number, number], b: [number, number], c: [number, number]): number {
  return Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
}

describe('lake triangulation', () => {
  it('triangulates every gazetteer lake into n-2 triangles', () => {
    for (const lake of LAKES) {
      const tris = earClip(lake.poly);
      expect(tris.length % 3, lake.id).toBe(0);
      expect(tris.length / 3, lake.id).toBe(lake.poly.length - 2);
    }
  });

  it('covers exactly the polygon area (no gaps, no overlap)', () => {
    for (const lake of LAKES) {
      const tris = earClip(lake.poly);
      let sum = 0;
      for (let i = 0; i < tris.length; i += 3) {
        sum += triArea(lake.poly[tris[i]], lake.poly[tris[i + 1]], lake.poly[tris[i + 2]]);
      }
      const target = Math.abs(signedArea(lake.poly));
      expect(Math.abs(sum - target) / target, lake.id).toBeLessThan(1e-6);
    }
  });

  it('never puts a triangle centroid outside its lake (the concave-arm bug)', () => {
    for (const lake of LAKES) {
      const tris = earClip(lake.poly);
      for (let i = 0; i < tris.length; i += 3) {
        const a = lake.poly[tris[i]], b = lake.poly[tris[i + 1]], c = lake.poly[tris[i + 2]];
        const cx = (a[0] + b[0] + c[0]) / 3, cz = (a[1] + b[1] + c[1]) / 3;
        expect(pointInPolygon(cx, cz, lake.poly), `${lake.id} @ ${cx.toFixed(0)},${cz.toFixed(0)}`).toBe(true);
      }
    }
  });

  it('documents the Urnersee centroid-fan behaviour on the current polygon (east shore follows the Axen landmarks)', () => {
    // History: the old 10-point Urnersee polygon cut a straight chord from Flüelen to Brunnen and
    // was strongly concave there, so a centroid fan spilled water over the land between the arms —
    // this test guarded that a fan fails. The east shore now follows the authored Axen landmarks
    // (Tellsplatte/Sisikon/Axenfluh, gazetteer.ts), which made the raw 15-point polygon convex
    // enough that a centroid fan mostly stays inside (fan-outside == 0; the deterministic wobble
    // adds 1-2 ear triangles whose centroid grazes outside on the wobbled 45-point shore variant).
    // The ear-clip invariant itself (previous test) is what matters and still holds on both
    // variants, so this guard now documents the current counts instead of requiring failure.
    const urnersee = LAKES.find((l) => l.id === 'urnersee')!;
    const wob = wobbleShore(urnersee.poly);
    const fanOutside = (poly: [number, number][]): number => {
      const n = poly.length;
      let cx = 0, cz = 0;
      for (const [x, z] of poly) { cx += x; cz += z; }
      cx /= n; cz /= n;
      let outside = 0;
      for (let i = 0; i < n; i++) {
        const a = poly[i], b = poly[(i + 1) % n];
        const mx = (cx + a[0] + b[0]) / 3, mz = (cz + a[1] + b[1]) / 3;
        if (!pointInPolygon(mx, mz, poly)) outside++;
      }
      return outside;
    };
    const rawOutside = fanOutside(urnersee.poly);
    const wobOutside = fanOutside(wob);
    // eslint-disable-next-line no-console
    console.log(`[water] urnersee fan-outside: raw ${rawOutside}/${urnersee.poly.length}, wobbled ${wobOutside}/${wob.length}`);
    // The raw authored polygon is near-convex (fan works, <=1 grazing triangle); the wobbled shore
    // variant keeps a couple of concave ears. Either way the fan is not a valid triangulation for
    // these shores — ear clipping (previous tests) is.
    expect(rawOutside).toBeLessThanOrEqual(1);
    expect(wobOutside).toBeLessThanOrEqual(3);
    // The real invariant survives the polygon change: ear clipping never spills water over land.
    for (const poly of [urnersee.poly, wob]) {
      const tris = earClip(poly);
      for (let i = 0; i < tris.length; i += 3) {
        const a = poly[tris[i]], b = poly[tris[i + 1]], c = poly[tris[i + 2]];
        const cx = (a[0] + b[0] + c[0]) / 3, cz = (a[1] + b[1] + c[1]) / 3;
        expect(pointInPolygon(cx, cz, poly)).toBe(true);
      }
    }
  });
});

describe('water look factors (Wave 3 flat-cyan fix)', () => {
  it('ramps the body mix deep->shallow monotonically', () => {
    const depths = [0, 0.015, 0.05, 0.1, 0.2, 0.3, 0.5, 1];
    let prev = -Infinity;
    for (const d of depths) {
      const m = waterBodyMix(d);
      expect(m).toBeGreaterThanOrEqual(0);
      expect(m).toBeLessThanOrEqual(1);
      expect(m).toBeGreaterThanOrEqual(prev);
      prev = m;
    }
    expect(waterBodyMix(0)).toBe(0);
    expect(waterBodyMix(1)).toBe(1);
  });

  it('keeps the Fresnel factor in 0..1 and finite at grazing angles', () => {
    for (const ndv of [0, 0.001, 0.05, 0.5, 0.999, 1, -1, 2, NaN, Infinity]) {
      for (const depth of [0, 0.01, 0.02, 0.5, NaN]) {
        const f = waterFresnelFactor(ndv, depth);
        expect(Number.isFinite(f)).toBe(true);
        expect(f).toBeGreaterThanOrEqual(0);
        expect(f).toBeLessThanOrEqual(1);
      }
    }
    // Grazing must reflect more sky than straight-down open water.
    expect(waterFresnelFactor(0, 0.5)).toBeGreaterThan(waterFresnelFactor(1, 0.5));
    // Foam suppresses the mirror but never goes negative or NaN.
    expect(waterFresnelFactor(0, 0)).toBeLessThan(waterFresnelFactor(0, 0.5));
  });

  it('keeps the sun lobe and glitter factors in 0..1 with no NaN', () => {
    for (const cosRH of [0, 0.25, 0.5, 0.9, 0.999, 1, -0.5, 2, NaN, Infinity, -Infinity]) {
      for (const fn of [waterSunLobeFactor, waterSunSpecFactor]) {
        const v = fn(cosRH);
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
    expect(waterSunLobeFactor(1)).toBe(1);
    expect(waterSunSpecFactor(1)).toBe(1);
    expect(waterSunLobeFactor(0)).toBe(0);
    expect(waterSunSpecFactor(0)).toBe(0);
  });
});
