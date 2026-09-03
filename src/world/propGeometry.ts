/**
 * Shared boulder geometry + material for the vegetation InstancedMesh rock pools.
 * Uses the same CC0 PBR rock material as the `rock.*` models (assets.ts / models.ts), so scattered
 * boulders and placed rocks read as the same stone and share one material instance.
 */
import { Float32BufferAttribute, SphereGeometry, type MeshStandardMaterial } from 'three';
import { propMat } from './models';

const cache = new Map<string, SphereGeometry>();
/** Segment counts by size class: a metre-scale boulder is walked past and needs a silhouette, a
 *  hand-sized stone in a scatter pool never does. Vegetation keeps thousands of these live
 *  (CAPACITY.rock per size class, src/world/vegetation.ts), so the small classes are the cheapest
 *  triangles in the scene to hand back — 20 instead of 70 each. */
export function boulderGeometry(baseRadius: number): SphereGeometry {
  const key = baseRadius.toFixed(2);
  const hit = cache.get(key);
  if (hit) return hit;
  const [wSeg, hSeg] = baseRadius >= 0.8 ? [7, 6] : baseRadius >= 0.35 ? [6, 4] : [5, 3];
  const geo = new SphereGeometry(baseRadius, wSeg, hSeg);
  const pos = geo.attributes.position as Float32BufferAttribute;
  // deterministic jitter (fixed pattern reused by every instance; per-instance variety comes from scale/rotation)
  for (let i = 0; i < pos.count; i++) {
    const n = 1 + (Math.sin(i * 12.9898) * 0.5 + 0.5 - 0.5) * 0.35;
    pos.setXYZ(i, pos.getX(i) * n, pos.getY(i) * n * 0.72, pos.getZ(i) * n);
  }
  geo.computeVertexNormals();
  geo.translate(0, baseRadius * 0.55, 0);
  // The shared prop material is vertex-coloured (models.ts tints every building this way). Rock035's
  // albedo is near-black in linear light (0.005/0.009/0.012), so the grey stone tint carries the same
  // per-channel gain models.ts uses — see TINT_GAIN there and tools/assets/albedo.mjs.
  const c = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) { c[i * 3] = 12.2; c[i * 3 + 1] = 8.2; c[i * 3 + 2] = 5.7; }
  geo.setAttribute('color', new Float32BufferAttribute(c, 3));
  cache.set(key, geo);
  return geo;
}

export function rockMaterial(): MeshStandardMaterial {
  return propMat('rock');
}

export function disposePropGeometry(): void {
  for (const g of cache.values()) g.dispose();
  cache.clear();
}
