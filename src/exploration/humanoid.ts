/**
 * Merged, low-draw-call humanoid factory. Registered here — before combat's own per-archetype humanoid
 * registration (`src/combat/render.ts` `registerCombatModels`, called from `combat/index.ts` after
 * exploration per main.ts's module order) — under the same "first `registerModel` call for an id wins"
 * convention already used for `char.player`. Fix for the draw-call budget alert: combat's
 * `buildHumanoidModel` spawns 6-10 separate `Mesh` objects per character (torso, head, hat, 2 arms,
 * 2 legs, sometimes a surcoat/cross or a mounted horse's 6 parts); at Altdorf's crowd size that alone
 * accounts for a large share of the draw-call budget. This factory merges every same-material part
 * (all cloth-toned body geometry, then all trim-toned geometry) into a handful of `BufferGeometryUtils
 * .mergeGeometries` calls, landing at ≤ 3 draw calls per character (body, head, optional hat) with no
 * per-frame cost — these NPCs don't animate (only the player does; see `playerModel.ts`).
 *
 * Registered only for the archetype ids exploration's own content (`content/pois.ts` population tables,
 * `content/npcs.ts` named cast) actually uses — `habsburg-knight` (needs its mounted-horse silhouette)
 * and `raubritter` (a pure combat encounter archetype) are deliberately left to combat's own factory.
 */
import {
  BufferGeometry, CapsuleGeometry, ConeGeometry, CylinderGeometry, Group, Mesh,
  MeshStandardMaterial, Object3D, SphereGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { WorldService } from '@core/services';

interface Palette { cloth: number; trim: number; metal: number; skin: number }

/** Mirrors `combat/render.ts`'s `paletteFor` closely enough that a crowd reads the same way it would
 *  under combat's own renderer (peasant tan, militia green, Habsburg white/red, monk black, merchant
 *  brown) — visual continuity across the two renderers matters more than an exact colour match. */
const PALETTES: Record<string, Palette> = {
  peasant: { cloth: 0xb8a074, trim: 0x8a7550, metal: 0x777777, skin: 0xd9b088 },
  militia: { cloth: 0x5a6b4a, trim: 0x3d4a30, metal: 0x9a9a9a, skin: 0xd9b088 },
  habsburg: { cloth: 0xffffff, trim: 0xb01e2c, metal: 0xb7bcc2, skin: 0xd9b088 },
  monk: { cloth: 0x33302b, trim: 0x1c1a17, metal: 0x555555, skin: 0xd9b088 },
  merchant: { cloth: 0x6a4a30, trim: 0x8a6b40, metal: 0x666666, skin: 0xd9b088 },
};

function paletteFor(archetypeId: string): Palette {
  if (archetypeId.startsWith('habsburg') || archetypeId === 'bailiff-guard') return PALETTES.habsburg;
  if (archetypeId.startsWith('militia') || archetypeId === 'saeumer' || archetypeId === 'herder' || archetypeId === 'abbey-man-at-arms') return PALETTES.militia;
  if (archetypeId === 'monk') return PALETTES.monk;
  if (archetypeId === 'merchant' || archetypeId === 'innkeeper' || archetypeId === 'boatman' || archetypeId === 'toll-collector') return PALETTES.merchant;
  return PALETTES.peasant;
}

const HAS_HAT = /^militia|guard|footman|man-at-arms|sergeant|squire/;

const matCache = new Map<string, MeshStandardMaterial>();
function cachedMat(key: string, color: number, roughness = 0.85, metalness = 0): MeshStandardMaterial {
  let m = matCache.get(key);
  if (!m) { m = new MeshStandardMaterial({ color, roughness, metalness }); matCache.set(key, m); }
  return m;
}

/** Bakes a geometry's authored local transform (position/rotation, applied via a throwaway Mesh) into
 *  its vertices, so several differently-placed primitives can be merged into one static BufferGeometry. */
function placed(geo: BufferGeometry, x: number, y: number, z: number, rz = 0): BufferGeometry {
  const g = geo.clone();
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
}

function buildMergedHumanoid(archetypeId: string): Object3D {
  const p = paletteFor(archetypeId);
  const g = new Group();
  g.name = `char.${archetypeId}`;
  const clothMat = cachedMat(`cloth:${p.cloth}`, p.cloth);
  const skinMat = cachedMat('skin', p.skin, 0.9);
  const metalMat = cachedMat('metal', p.metal, 0.4, 0.7);

  // Body: torso + both arms + both legs, one shared cloth tone, merged into a single draw call.
  const bodyParts: BufferGeometry[] = [placed(new CapsuleGeometry(0.22, 0.55, 4, 8), 0, 1.0, 0)];
  const armGeo = new CylinderGeometry(0.05, 0.05, 0.5, 6);
  const legGeo = new CylinderGeometry(0.07, 0.06, 0.6, 6);
  for (const side of [-1, 1]) bodyParts.push(placed(armGeo, 0.26 * side, 1.02, 0, side * 0.18));
  for (const side of [-1, 1]) bodyParts.push(placed(legGeo, 0.1 * side, 0.42, 0));
  const bodyGeo = bodyParts.length > 1 ? mergeGeometries(bodyParts, false) : bodyParts[0];
  if (bodyGeo) {
    const body = new Mesh(bodyGeo, clothMat);
    body.castShadow = true; body.receiveShadow = true;
    g.add(body);
  }

  const head = new Mesh(new SphereGeometry(0.15, 10, 8), skinMat);
  head.position.y = 1.55;
  head.castShadow = true;
  g.add(head);

  if (HAS_HAT.test(archetypeId)) {
    const hat = new Mesh(new ConeGeometry(0.19, 0.14, 10, 1, true), metalMat);
    hat.position.y = 1.68;
    hat.castShadow = true;
    g.add(hat);
  }
  return g; // ≤ 3 draw calls: body, head, optional hat
}

/** Archetype ids exploration's own population tables / named cast actually spawn (see file header for
 *  what's deliberately excluded). Idempotent: `world.hasModel` guards every id, so calling this more than
 *  once, or after combat has already registered its own set, never overwrites an existing registration. */
const EXPLORATION_ARCHETYPES = [
  'peasant', 'herder', 'fisher', 'saeumer', 'militia-spear', 'militia-halberd', 'militia-crossbow',
  'elder', 'monk', 'merchant', 'innkeeper', 'boatman', 'child', 'woman-peasant', 'toll-collector',
  'habsburg-footman', 'habsburg-crossbowman', 'habsburg-sergeant', 'habsburg-squire', 'bailiff-guard',
  'abbey-man-at-arms',
];

export function registerExplorationHumanoids(world: WorldService): void {
  for (const id of EXPLORATION_ARCHETYPES) {
    const modelId = `char.${id}`;
    if (world.hasModel(modelId)) continue;
    world.registerModel(modelId, () => buildMergedHumanoid(id));
  }
}

