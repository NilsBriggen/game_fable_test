/**
 * Simple prop colliders (task spec: "simple prop colliders (list of AABB/sphere per POI from placed
 * models)"). We use spheres — cheap, and every procedural building in `world/models.ts` is roughly
 * radially symmetric around its origin, so a sphere is a fair approximation for "don't walk through a
 * wall" without needing real per-mesh geometry.
 */
import type { PlacedModel } from '@core/schemas';

export interface Collider {
  x: number;
  z: number;
  radius: number;
}

/** Footprint radius (metres) per model id; anything not listed is treated as walk-through (small props,
 *  boats, fences — decorative or already water-only). The well, cross and hayrack are solid too, so the
 *  crowd that gathers on the square stands around the well instead of inside it. */
export const RADIUS: Record<string, number> = {
  'house.blockbau': 4.2,
  'house.stone': 4.6,
  barn: 5.5,
  church: 5,
  chapel: 3,
  monastery: 7,
  'castle.keep': 7.5,
  'castle.wall': 4.2,
  'castle.tower': 3.2,
  'letzi.wall': 4,
  palisade: 4,
  mill: 3.5,
  'bridge.stone': 0, // walkable across, not a collider
  'bridge.wood': 0,
  well: 2.0,
  cross: 0.6,
  hayrack: 1.8,
};

/** Footprint used by the layout generator to keep models from interpenetrating (includes small props). */
export const SPACING: Record<string, number> = { ...RADIUS, fence: 0.8, tent: 2, campfire: 1, 'rock.small': 0.8, 'rock.large': 1.5 };

export function buildColliders(layout: PlacedModel[]): Collider[] {
  const out: Collider[] = [];
  for (const m of layout) {
    const r = RADIUS[m.modelId];
    if (!r) continue;
    out.push({ x: m.x, z: m.z, radius: r });
  }
  return out;
}

/** Push `pos` out of any overlapping collider (circle-vs-circle), in place. `radius` is the player
 *  capsule's own radius. Cheap O(n) scan — POI-local collider lists are small (tens, not thousands). */
export function resolveCollisions(pos: { x: number; z: number }, colliders: Collider[], radius: number): void {
  for (const c of colliders) {
    const dx = pos.x - c.x, dz = pos.z - c.z;
    const minDist = c.radius + radius;
    const distSq = dx * dx + dz * dz;
    if (distSq >= minDist * minDist || distSq < 1e-8) continue;
    const dist = Math.sqrt(distSq);
    const push = (minDist - dist) / dist;
    pos.x += dx * push;
    pos.z += dz * push;
  }
}
