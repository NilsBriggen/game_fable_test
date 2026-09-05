/**
 * Turns every settlement-shaped POI into real geometry: `generateLayout()` (layout.ts, pure data) → one
 * `WorldService.spawnModel()` `Object3D` per `PlacedModel`, positioned on `heightAt`. Draw-call budget fix
 * (coordinator alert: 5 295 draw calls at Altdorf, target ≤ 1 200): rather than adding each building's
 * ~14 individual sub-meshes to the scene as-is, every spawned object's meshes are baked (via their world
 * matrix) into a flat list of transformed geometries keyed by *material* and merged with
 * `BufferGeometryUtils.mergeGeometries` **once, globally, across every settlement on the map** — so the
 * whole prop layer costs one draw call per distinct material (wood, stone, shingle, a few plaster tints,
 * …: a few dozen, not thousands) no matter how many houses, walls or wells exist. Also builds the
 * collider list `player.ts` collides against.
 */
import { BufferAttribute, BufferGeometry, Group, Material, Mesh, Object3D } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ContentRegistry } from '@core/content';
import type { WorldService } from '@core/services';
import type { PlacedModel, PoiKind } from '@core/schemas';
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
    if (prev && next && prev !== next) {
      const dx = next.x - prev.x, dz = next.z - prev.z;
      if (Math.hypot(dx, dz) > 0.01) return Math.atan2(dx, -dz);
    }
  }
  return 0;
}

export interface SettlementPlan {
  poiId: string;
  x: number;
  z: number;
  layout: PlacedModel[];
  /** per-POI activity anchors for NpcSystem.populate (critic N2): well/church/inn/house pads */
  anchors: PoiAnchors;
  /** merged meshes currently in the scene (empty while the village is out of build range) */
  meshes: Mesh[];
}

export interface BuiltSettlements {
  colliders: Collider[];
  gallowsPole: Object3D | null;
  /** every settlement's layout; geometry is built on demand by `buildSettlementMeshes` (index.ts LOD) */
  plans: SettlementPlan[];
}

/** Build range (m): a village's merged geometry exists only while the player is within this radius, and
 *  is disposed again beyond BUILD_DROP_M. All ~60 settlements built up front kept ~800 MB of vertex data
 *  in the JS heap (harness census wave2e/wave2g) for villages that are hidden past 1.2 km anyway. */
export const BUILD_M = 1500;
export const BUILD_DROP_M = 2200;

export function buildSettlementMeshes(plan: SettlementPlan, world: WorldService, propsRoot: Group): void {
  if (plan.meshes.length) return;
  const byMat = new Map<Material, BufferGeometry[]>();
  for (const m of plan.layout) {
    const obj = world.spawnModel(m.modelId, { variant: m.variant });
    const y = world.heightAt(m.x, m.z) + (m.dy ?? 0);
    collectBaked(obj, m.x, y, m.z, m.yaw ?? 0, m.scale ?? 1, byMat);
  }
  plan.meshes = emitMerged(byMat, propsRoot, plan.poiId, plan.x, plan.z);
}

export function dropSettlementMeshes(plan: SettlementPlan, propsRoot: Group): void {
  for (const m of plan.meshes) { propsRoot.remove(m); m.geometry.dispose(); }
  plan.meshes = [];
}

/** Accumulates every mesh's world-transformed geometry into `byMat`, keyed by the *material instance*
 *  (world/models.ts caches materials by look, e.g. one shared `stoneMat()`, so this naturally groups
 *  same-looking geometry across every building on the map, not just within one). */
function collectBaked(obj: Object3D, x: number, y: number, z: number, yaw: number, scale: number, byMat: Map<Material, BufferGeometry[]>): void {
  obj.position.set(x, y, z);
  obj.rotation.y = yaw;
  if (scale !== 1) obj.scale.setScalar(scale);
  obj.updateMatrixWorld(true); // unparented root: matrixWorld == this placement's full local-to-world chain
  obj.traverse((child) => {
    const mesh = child as Mesh;
    if (!(mesh as { isMesh?: boolean }).isMesh) return;
    const mat = mesh.material as Material;
    if (Array.isArray(mat)) return; // none of world/models.ts's factories use multi-material meshes
    const cloned = mesh.geometry.clone();
    // .toNonIndexed() warns loudly if the geometry has no index already (true for the roof-gable
    // triangles in world/models.ts) — only call it when there's actually an index to strip, so every
    // geometry still ends up in the same uniform (non-indexed) format for mergeGeometries below.
    const geo = cloned.index ? cloned.toNonIndexed() : cloned;
    geo.applyMatrix4(mesh.matrixWorld);
    let list = byMat.get(mat);
    if (!list) { list = []; byMat.set(mat, list); }
    list.push(geo);
  });
}

/** Merges each material's accumulated geometry into one static mesh and adds it to `propsRoot` — the
 *  actual draw-call reduction: N buildings sharing a material become 1 draw call, not N×(meshes/building). */
function emitMerged(byMat: Map<Material, BufferGeometry[]>, propsRoot: Group, clusterName = 'settlements', cx = 0, cz = 0): Mesh[] {
  const out: Mesh[] = [];
  for (const [mat, geos] of byMat) {
    if (geos.length === 0) continue;
    let merged: BufferGeometry | null = null;
    try {
      merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    } catch (err) {
      console.warn('[exploration] settlement geometry merge failed for one material; skipping that batch', err);
    }
    if (!merged) continue;
    const mesh = new Mesh(merged, mat);
    mesh.name = clusterName;
    mesh.castShadow = true;
    mesh.userData.settlement = { x: cx, z: cz }; // distance culling in ExplorationImpl.update
    mesh.receiveShadow = true;
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    // Static geometry lives on the GPU only: the merged villages held ~850 MB of vertex arrays in the JS
    // heap (harness memory census, wave2e) against a 512 MB budget. Arrays are dropped once uploaded;
    // nothing raycasts or re-uploads these meshes (colliders are the sphere list, not the mesh).
    releaseOnUpload(merged);
    mesh.raycast = () => {};
    propsRoot.add(mesh);
    out.push(mesh);
  }
  return out;
}

function releaseOnUpload(geometry: BufferGeometry): void {
  const drop = function (this: { array: ArrayLike<number> }) {
    const ctor = (this.array as unknown as { constructor: new (n: number) => ArrayLike<number> }).constructor;
    this.array = new ctor(0);
  };
  for (const attr of Object.values(geometry.attributes)) (attr as BufferAttribute).onUpload(drop);
  if (geometry.index) geometry.index.onUpload(drop);
}

/** Per-POI activity anchors for NPC scheduling (critic N2): world coords of the well, church,
 *  inn (house.blockbau with variant 'inn', else the first house) and every house pad, derived from
 *  the settlement's own generated layout. Empty when the layout placed nothing of that kind. */
export interface PoiAnchors {
  well: { x: number; z: number } | null;
  church: { x: number; z: number } | null;
  inn: { x: number; z: number } | null;
  houses: { x: number; z: number }[];
}

export function anchorsForLayout(layout: PlacedModel[]): PoiAnchors {
  let well: PoiAnchors['well'] = null;
  let church: PoiAnchors['church'] = null;
  let inn: PoiAnchors['inn'] = null;
  const houses: { x: number; z: number }[] = [];
  for (const m of layout) {
    if (m.modelId === 'well' && !well) well = { x: m.x, z: m.z };
    else if ((m.modelId === 'church' || m.modelId === 'chapel' || m.modelId === 'monastery') && !church) church = { x: m.x, z: m.z };
    else if ((m.modelId === 'house.blockbau' || m.modelId === 'house.stone')) {
      houses.push({ x: m.x, z: m.z });
      if (m.variant === 'inn' && !inn) inn = { x: m.x, z: m.z };
    }
  }
  if (!inn && houses.length) inn = houses[0];
  return { well, church, inn, houses };
}

/** Lays out every settlement (colliders for all, so NPC spawns and the player collide everywhere) and
 *  builds geometry only for those within BUILD_M of `near` (all of them when `near` is omitted — tests). */
export function buildSettlements(content: ContentRegistry, world: WorldService, propsRoot: Group, showGesslerHat: boolean, near?: { x: number; z: number }): BuiltSettlements {
  const probe: HeightProbe = { heightAt: (x, z) => world.heightAt(x, z), isWater: (x, z) => world.isWater(x, z) };
  const colliders: Collider[] = [];
  const plans: SettlementPlan[] = [];

  // One merged mesh per (POI, material): a per-settlement bounding sphere keeps far villages frustum- and
  // shadow-culled (requests/art-1.md), while everything within one settlement stays one draw call per material.
  for (const poi of content.pois.values()) {
    if (!SETTLEMENT_KINDS.has(poi.kind)) continue;
    const yaw = roadFacingYaw(poi.id);
    const layout = generateLayout({ id: poi.id, kind: poi.kind, x: poi.x, z: poi.z, yaw, population: poi.population }, probe);
    const plan: SettlementPlan = { poiId: poi.id, x: poi.x, z: poi.z, layout, anchors: anchorsForLayout(layout), meshes: [] };
    plans.push(plan);
    if (!near || Math.hypot(poi.x - near.x, poi.z - near.z) < BUILD_M) buildSettlementMeshes(plan, world, propsRoot);
    colliders.push(...buildColliders(layout));
  }

  // The gallows pole is kept out of the merge pass: its hat needs to stay independently toggleable
  // (task spec — place it always, hide the hat unless the flag is set), which a merged static mesh can't
  // do. One extra object's ~2 draw calls is immaterial next to the savings above.
  let gallowsPole: Object3D | null = null;
  const altdorf = content.pois.get('poi.altdorf');
  if (altdorf) {
    const x = altdorf.x + 3, z = altdorf.z - 8; // between the well and the church, in the default north-facing view
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

  return { colliders, gallowsPole, plans };
}
