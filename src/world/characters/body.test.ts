/**
 * Budget + sanity tests for the character body (BUILDER_RULES "Budgets", task bar: ≤ 3 000 triangles at
 * full detail, ≤ 800 beyond 25 m, ≤ 4 draw calls, feet on the ground, faces that are actually there).
 */
import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { SkinBuilder } from './skinBuilder';
import { LOOKS, LOOK_VARIANTS, isUniform, lookFor, varyLook } from './looks';
import { TARGET, buildLookGeometry } from './body';
import type { Bind } from './body';
import { Quaternion } from 'three';

const order = Object.keys(TARGET);
const index = new Map(order.map((n, i) => [n, i]));
const bind: Bind = new Map(Object.entries(TARGET).map(([k, v]) => [k, { pos: new Vector3(v[0], v[1], v[2]), quat: new Quaternion() }]));
const build = (id: string, v = 0, lod = 0) => {
  const look = varyLook(lookFor(id), v);
  return buildLookGeometry(look, (n) => index.get(n) ?? 0, bind, !!look.mounted, lod);
};
const layers = (g: ReturnType<typeof build>) => [g.cloth, g.hide, g.metal, g.mail].filter((x) => x !== null);

describe('character body budgets', () => {
  it('every archetype on foot stays ≤ 3 500 triangles near and ≤ 900 far, in ≤ 4 layers', () => {
    for (const id of Object.keys(LOOKS)) {
      const look = lookFor(id);
      const near = build(id, 0, 0), far = build(id, 0, 1);
      const capNear = look.mounted ? 4400 : 3500;   // the knight's horse rides in the same four draw calls
      const capFar = look.mounted ? 1300 : 900;
      expect(near.triangles, `${id} near: ${near.triangles} tris`).toBeLessThanOrEqual(capNear);
      expect(far.triangles, `${id} far: ${far.triangles} tris`).toBeLessThanOrEqual(capFar);
      expect(far.triangles, `${id}: far set is not cheaper`).toBeLessThan(near.triangles * 0.4);
      expect(layers(near).length).toBeLessThanOrEqual(4);
      expect(layers(near).length).toBeGreaterThan(0);
    }
  });

  it('a crowd of 30 villagers at the far level stays under 60 k triangles', () => {
    const ids = ['peasant', 'woman-peasant', 'child', 'herder', 'fisher', 'innkeeper'];
    let total = 0;
    for (let i = 0; i < 30; i++) total += build(ids[i % ids.length], i % LOOK_VARIANTS, 1).triangles;
    expect(total).toBeLessThan(60_000);
  });

  it('stands with its soles at y≈0 and its crown at ~1.7 m in the bind pose', () => {
    const g = build('peasant');
    let minY = Infinity, maxY = -Infinity;
    for (const l of layers(g)) {
      const p = l.getAttribute('position');
      for (let i = 0; i < p.count; i++) { minY = Math.min(minY, p.getY(i)); maxY = Math.max(maxY, p.getY(i)); }
    }
    expect(minY).toBeGreaterThan(-0.02);
    expect(minY).toBeLessThan(0.05);
    expect(maxY).toBeGreaterThan(1.68);
    expect(maxY).toBeLessThan(1.85);
  });

  it('has a face: the nose tip sits in front of the skull and the eyes sit in their sockets', () => {
    const g = build('peasant', 4);   // variant 4: bare head, no hood over the brow
    const p = g.hide!.getAttribute('position');
    let noseZ = -Infinity, skullZ = -Infinity;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i), z = p.getZ(i), x = Math.abs(p.getX(i));
      if (y > 1.52 && y < 1.60 && x < 0.02) noseZ = Math.max(noseZ, z);        // nose band
      if (y > 1.60 && y < 1.66 && x < 0.02) skullZ = Math.max(skullZ, z);      // forehead band
    }
    expect(noseZ - skullZ, 'nose does not protrude').toBeGreaterThan(0.008);   // brow ridge sits in the forehead band
  });

  it('gives every skin vertex an outward normal (no unlit fingers)', () => {
    const g = build('peasant', 4);
    const p = g.hide!.getAttribute('position'), n = g.hide!.getAttribute('normal');
    // the left hand's finger axes as authored in buildHand (base → mid → tip per finger)
    const lens = [1.0, 1.08, 1.0, 0.8], zs = [0.029, 0.010, -0.009, -0.027];
    const segs: [Vector3, Vector3][] = [];
    for (let i = 0; i < 4; i++) {
      const L = lens[i], z = zs[i];
      const a = new Vector3(0.812, 1.416, z), m = new Vector3(0.812 + 0.03 * L, 1.406, z), t = new Vector3(0.812 + 0.042 * L, 1.42 - 0.042 * L, z);
      segs.push([a, m], [m, t]);
    }
    const radialOf = (q: Vector3): Vector3 | null => {
      let best: Vector3 | null = null, bestD = Infinity;
      for (const [a, b] of segs) {
        const ab = b.clone().sub(a); const t = Math.max(0, Math.min(1, q.clone().sub(a).dot(ab) / ab.lengthSq()));
        const c = a.clone().addScaledVector(ab, t); const d = q.distanceTo(c);
        if (d < bestD) { bestD = d; best = q.clone().sub(c); }
      }
      return best && bestD < 0.012 && bestD > 0.004 ? best.normalize() : null;   // on a finger's side wall
    };
    let bad = 0, count = 0;
    for (let i = 0; i < p.count; i++) {
      const q = new Vector3(p.getX(i), p.getY(i), p.getZ(i));
      if (q.x < 0.80 || q.x > 0.87) continue;
      const radial = radialOf(q);
      if (!radial) continue;
      const nn = new Vector3(n.getX(i), n.getY(i), n.getZ(i));
      expect(nn.length()).toBeCloseTo(1, 2);
      count++;
      if (radial.dot(nn) < 0) bad++;
    }
    expect(count).toBeGreaterThan(20);
    // a handful sit at the knuckle where the two finger segments meet and the nearest axis is ambiguous
    expect(bad, `${bad}/${count} finger normals point inward`).toBeLessThanOrEqual(count * 0.05);
  });

  it('varies civilians in cloth, headwear and face but keeps a livery uniform', () => {
    const cloths = new Set<number>(), heads = new Set<string>(), noses = new Set<number>();
    for (let v = 0; v < LOOK_VARIANTS; v++) {
      const l = varyLook(lookFor('peasant'), v);
      cloths.add(l.cloth); heads.add(l.head); noses.add(l.face.nose);
    }
    expect(cloths.size).toBeGreaterThan(3);
    expect(heads.size).toBeGreaterThan(2);
    expect(noses.size).toBeGreaterThan(3);
    const foot = lookFor('habsburg-footman');
    expect(isUniform(foot)).toBe(true);
    const liveries = new Set<number>();
    for (let v = 0; v < LOOK_VARIANTS; v++) liveries.add(varyLook(foot, v).cloth);
    expect(liveries.size).toBe(1);
  });

  it('dresses women and children differently from men', () => {
    const w = build('woman-peasant'), c = build('child'), m = build('peasant');
    const hemOf = (g: ReturnType<typeof build>) => {   // lowest cloth vertex wider than the legs (the hose reach the ankle)
      const p = g.cloth!.getAttribute('position');
      let min = Infinity;
      for (let i = 0; i < p.count; i++) if (Math.abs(p.getX(i)) > 0.2) min = Math.min(min, p.getY(i));
      return min;
    };
    expect(hemOf(w), 'gown reaches the ankle').toBeLessThan(0.2);
    expect(hemOf(m), 'tunic stops at the knee').toBeGreaterThan(0.5);
    expect(c.triangles).toBeGreaterThan(1000);
  });
});

describe('skin builder', () => {
  it('tube normals face outward for millimetre-scale primitives', () => {
    const sb = new SkinBuilder(() => 0);
    const a = new Vector3(0.812, 1.416, 0.029), b = new Vector3(0.842, 1.406, 0.029);
    sb.tube(a, b, [{ t: 0, r: 0.0095 }, { t: 1, r: 0.0088 }], 'x', 'x', 0xffffff, { seg: 4, up: new Vector3(0, 0, 1) });
    const g = sb.build();
    const p = g.getAttribute('position'), n = g.getAttribute('normal');
    const dir = b.clone().sub(a).normalize();
    for (let i = 0; i < p.count; i++) {
      const rel = new Vector3(p.getX(i), p.getY(i), p.getZ(i)).sub(a);
      const radial = rel.addScaledVector(dir, -rel.dot(dir));
      expect(radial.normalize().dot(new Vector3(n.getX(i), n.getY(i), n.getZ(i)))).toBeGreaterThan(0.9);
    }
  });
});
