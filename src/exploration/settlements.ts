/**
 * Turns every settlement-shaped POI into real geometry: `generateLayout()` (layout.ts, pure data) → one
 * `WorldService.spawnModel()` `Object3D` per `PlacedModel`, positioned on `heightAt` and parented under
 * `getSceneRoots().props`, plus the collider list `player.ts` collides against. Also places Altdorf's
 * gallows pole (task spec: "always place it, hide the hat unless the flag is set") — the hat is the last
 * child `world/models.ts`' `gallowsPole()` factory adds, so it's toggled by index rather than a variant
 * the shared model factory doesn't (and, being someone else's file, can't be made to) support.
 */
import { Group, Object3D } from 'three';
import type { ContentRegistry } from '@core/content';
import type { WorldService } from '@core/services';
import type { PoiKind } from '@core/schemas';
import { PLACES, ROADS } from '@content/gazetteer';
import { generateLayout, type HeightProbe } from './layout';
import { buildColliders, type Collider } from './colliders';

const SETTLEMENT_KINDS = new Set<PoiKind>([
  'village', 'town', 'castle', 'monastery', 'alp', 'pass', 'bridge', 'port', 'camp', 'wall', 'ruin',
  'mill', 'hut', 'cross', 'church', 'chapel',
]);

function gazIdOf(poiId: string): string {
  return poiId.startsWith('poi.') ? poiId.slice(4) : poiId;
}

/** Yaw so the settlement faces the road running through its own gazetteer place, if any (task spec:
 *  "placed on heightAt with yaw facing a road"); 0 (facing south, +z) for POIs off the road network. */
function roadFacingYaw(poiId: string): number {
  const gazId = gazIdOf(poiId);
  for (const road of ROADS) {
    const i = road.via.indexOf(gazId);
    if (i < 0) continue;
    const prev = PLACES[road.via[Math.max(0, i - 1)]];
    const next = PLACES[road.via[Math.min(road.via.length - 1, i + 1)]];
    if (prev && next && (prev !== next)) {
      const dx = next.x - prev.x, dz = next.z - prev.z;
      if (Math.hypot(dx, dz) > 0.01) return Math.atan2(dx, -dz);
    }
  }
  return 0;
}

export interface BuiltSettlements {
  colliders: Collider[];
  gallowsPole: Object3D | null;
}

export function buildSettlements(content: ContentRegistry, world: WorldService, propsRoot: Group, showGesslerHat: boolean): BuiltSettlements {
  const probe: HeightProbe = { heightAt: (x, z) => world.heightAt(x, z), isWater: (x, z) => world.isWater(x, z) };
  const colliders: Collider[] = [];
  let gallowsPole: Object3D | null = null;

  for (const poi of content.pois.values()) {
    if (!SETTLEMENT_KINDS.has(poi.kind)) continue;
    const yaw = roadFacingYaw(poi.id);
    const layout = generateLayout({ id: poi.id, kind: poi.kind, x: poi.x, z: poi.z, yaw, population: poi.population }, probe);
    for (const m of layout) {
      const obj = world.spawnModel(m.modelId, { variant: m.variant, scale: m.scale });
      const y = world.heightAt(m.x, m.z) + (m.dy ?? 0);
      obj.position.set(m.x, y, m.z);
      obj.rotation.y = m.yaw ?? 0;
      propsRoot.add(obj);
    }
    colliders.push(...buildColliders(layout));
  }

  const altdorf = content.pois.get('poi.altdorf');
  if (altdorf) {
    const x = altdorf.x + 12, z = altdorf.z - 6; // "near the lime tree" — a small offset from the well/church
    const pole = world.spawnModel('gallows.pole');
    pole.position.set(x, world.heightAt(x, z), z);
    // gallowsPole() (world/models.ts) adds the pole mesh first, the hat Group second — hide that child
    // when the hat shouldn't be showing yet (only present from Chapter 1, LORE.md §1/§6).
    const hat = pole.children.find((c) => c.type === 'Group');
    if (hat) hat.visible = showGesslerHat;
    propsRoot.add(pole);
    gallowsPole = pole;
    colliders.push({ x, z, radius: 1 });
  }

  return { colliders, gallowsPole };
}
