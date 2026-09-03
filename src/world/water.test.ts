/**
 * Water surface geometry: the lake polygons of the Vierwaldstättersee are strongly concave (five
 * arms radiating from Brunnen), so the triangulation has to be a real ear clip — a centroid fan
 * would lay water over the land between the arms.
 */
import { describe, it, expect } from 'vitest';
import { LAKES } from '@content/gazetteer';
import { earClip, signedArea } from './water';
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

  it('a centroid fan would fail that test on the Urnersee (regression guard)', () => {
    const urnersee = LAKES.find((l) => l.id === 'urnersee')!;
    const n = urnersee.poly.length;
    let cx = 0, cz = 0;
    for (const [x, z] of urnersee.poly) { cx += x; cz += z; }
    cx /= n; cz /= n;
    let outside = 0;
    for (let i = 0; i < n; i++) {
      const a = urnersee.poly[i], b = urnersee.poly[(i + 1) % n];
      const mx = (cx + a[0] + b[0]) / 3, mz = (cz + a[1] + b[1]) / 3;
      if (!pointInPolygon(mx, mz, urnersee.poly)) outside++;
    }
    expect(outside).toBeGreaterThan(0);
  });
});
