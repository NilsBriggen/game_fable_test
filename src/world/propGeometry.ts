/** Shared boulder geometry + material for the vegetation InstancedMesh rock pools. */
import { Float32BufferAttribute, MeshStandardMaterial, SphereGeometry } from 'three';
import { registerCsmMaterial } from './shadowCsm';

const cache = new Map<string, SphereGeometry>();
export function boulderGeometry(baseRadius: number): SphereGeometry {
  const key = baseRadius.toFixed(2);
  const hit = cache.get(key);
  if (hit) return hit;
  const geo = new SphereGeometry(baseRadius, 7, 6);
  const pos = geo.attributes.position as Float32BufferAttribute;
  // deterministic jitter (fixed pattern reused by every instance; per-instance variety comes from scale/rotation)
  for (let i = 0; i < pos.count; i++) {
    const n = 1 + (Math.sin(i * 12.9898) * 0.5 + 0.5 - 0.5) * 0.35;
    pos.setXYZ(i, pos.getX(i) * n, pos.getY(i) * n * 0.72, pos.getZ(i) * n);
  }
  geo.computeVertexNormals();
  geo.translate(0, baseRadius * 0.55, 0);
  cache.set(key, geo);
  return geo;
}

let mat: MeshStandardMaterial | null = null;
export function rockMaterial(): MeshStandardMaterial {
  if (mat) return mat;
  mat = new MeshStandardMaterial({ color: 0x7a746a, roughness: 0.95 });
  registerCsmMaterial(mat);
  return mat;
}

export function disposePropGeometry(): void {
  for (const g of cache.values()) g.dispose();
  cache.clear();
  mat?.dispose();
  mat = null;
}
