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
  /** metres above ground the obstacle reaches (camera boom passes over anything lower); buildings ~9 */
  height?: number;
}

/** Footprint radius (metres) per model id; anything not listed is treated as walk-through (small props,
 *  boats — decorative or already water-only). Tents, fences, carts, woodpiles, rocks, troughs and
 *  campfires are solid: the crowd gathers around them, not inside them. */
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
  well: 2.4,
  cross: 0.6,
  'cross.shrine': 0.8,
  hayrack: 1.8,
  'hayrick.tripod': 1.6,
  'hut.fisher': 4.2,
  'palisade.gate': 4,
  tent: 2,
  fence: 0.8,
  campfire: 1,
  'rock.small': 0.8,
  'rock.large': 1.5,
  woodpile: 1.2,
  trough: 1,
  cart: 1.6,
  signpost: 0.4,
  // boat.cargo is water-only like boat (walk-through: no entry).
};

/** Low props the camera looks over (buildings default to 9 m). */
export const HEIGHT: Record<string, number> = { well: 2.6, cross: 2.6, 'cross.shrine': 3.0, hayrack: 3.2, 'hayrick.tripod': 3.4, 'hut.fisher': 4.5 };

/** Footprint used by the layout generator to keep models from interpenetrating (includes small props). */
export const SPACING: Record<string, number> = { ...RADIUS, fence: 0.8, tent: 2, campfire: 1, 'rock.small': 0.8, 'rock.large': 1.5 };

export function buildColliders(layout: PlacedModel[]): Collider[] {
  const out: Collider[] = [];
  for (const m of layout) {
    const r = RADIUS[m.modelId];
    if (!r) continue;
    out.push({ x: m.x, z: m.z, radius: r, height: HEIGHT[m.modelId] });
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
    if (distSq >= minDist * minDist) continue;
    if (distSq < 1e-8) { pos.x = c.x + minDist; continue; } // dead centre: push out along +X instead of sticking
    const dist = Math.sqrt(distSq);
    const push = (minDist - dist) / dist;
    pos.x += dx * push;
    pos.z += dz * push;
  }
}
