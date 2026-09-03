/**
 * Procedural model library: WorldService.spawnModel/registerModel/hasModel/listModels.
 *
 * Every building and prop is authored as real geometry in `src/world/models/` — log courses notched at
 * the corners, shingle roofs laid in courses and weighted with stones, coursed rubble with dressed
 * ashlar quoins, plank doors on strap hinges, shuttered windows with sills — and skinned with the
 * downloaded CC0 PBR material set from assets.ts (see public/assets/CREDITS-models.md).
 *
 * A model is assembled by `Build` (models/kit.ts), which bakes each primitive's transform, gives it
 * world-scale UVs and a vertex colour, and merges everything per material: one Mesh per material used,
 * so a model costs 3–6 draw calls, never one per plank. Exploration then merges the *same* material
 * instances again per POI (src/exploration/settlements.ts), so a whole settlement costs one draw call
 * per material it uses.
 *
 * Eleven shared materials cover the world: logs, planks, shingle, ashlar, masonry, drystone, plaster,
 * iron, thatch, rock, cloth (+ an emissive `fire`). Real-metre scale (ARCHITECTURE.md §1) and the
 * footprints src/exploration/layout.ts assumes: blockbau ≤ 9×9.5, stone house 9–10.5×7, church nave
 * 9×13 + tower/apse, castle wall segment 8 m, letzi 8 m, bridge 14 m.
 */
import { Mesh, Object3D } from 'three';
import { Rng, hashString } from '@core/rng';
import { buildTreeGeometry, treeMaterial, type TreeKind } from './treeGeometry';
import { CHARACTER_MODEL_IDS, characterModel } from './characters';
import { disposeKitCaches, type MatId } from './models/kit';
import {
  barn, blockbauInto, chapel, church, granary, houseBlockbau, houseStone, marketStall, mill, monastery,
} from './models/buildings';
import {
  bridgeStone, bridgeWood, castleKeep, castleTower, castleWall, letziWall, palisade, ruinWall,
} from './models/fort';
import {
  boat, campfire, cart, crossModel, fenceModel, gallowsPole, hayrack, placeholder, rockModel,
  shieldModel, signpost, stump, tent, trough, weaponModel, well, woodpile,
} from './models/props';

export { propMat } from './models/kit';
export type { MatId };
export { blockbauInto, churchInto } from './models/buildings';

function treeModel(kind: TreeKind, rng: Rng): Object3D {
  const geo = buildTreeGeometry(kind, rng);
  const m = new Mesh(geo, treeMaterial());
  m.castShadow = true;
  m.receiveShadow = true;
  m.name = `tree.${kind}`;
  return m;
}

// ---------------- registry ----------------

export type ModelFactory = (opts: { variant?: string; scale?: number; rng: Rng; seed?: number }) => Object3D;

export class ModelLibrary {
  private factories = new Map<string, ModelFactory>();
  private spawnCount = 0;
  private warnedUnknown = new Set<string>();

  constructor(private seed: number) {
    this.register('house.blockbau', (o) => houseBlockbau(o.rng, o.variant));
    this.register('house.stone', (o) => houseStone(o.rng, o.variant));
    this.register('barn', (o) => barn(o.rng));
    this.register('granary', (o) => granary(o.rng));
    this.register('church', (o) => church(o.rng));
    this.register('chapel', (o) => chapel(o.rng));
    this.register('monastery', (o) => monastery(o.rng));
    this.register('castle.keep', (o) => castleKeep(o.rng));
    this.register('castle.wall', (o) => castleWall(o.rng));
    this.register('castle.tower', (o) => castleTower(o.rng));
    this.register('ruin.wall', (o) => ruinWall(o.rng));
    this.register('letzi.wall', (o) => letziWall(o.rng));
    this.register('palisade', (o) => palisade(o.rng));
    this.register('bridge.wood', (o) => bridgeWood(o.rng));
    this.register('bridge.stone', (o) => bridgeStone(o.rng));
    this.register('mill', (o) => mill(o.rng));
    this.register('boat', (o) => boat(o.rng));
    this.register('cross', (o) => crossModel(o.rng));
    this.register('hayrack', (o) => hayrack(o.rng));
    this.register('fence', (o) => fenceModel(o.rng));
    this.register('well', (o) => well(o.rng));
    this.register('woodpile', (o) => woodpile(o.rng));
    this.register('trough', (o) => trough(o.rng));
    this.register('market.stall', (o) => marketStall(o.rng));
    this.register('gallows.pole', (o) => gallowsPole(o.rng));
    this.register('campfire', (o) => campfire(o.rng));
    this.register('tent', (o) => tent(o.rng));
    this.register('cart', (o) => cart(o.rng));
    this.register('signpost', (o) => signpost(o.rng));
    this.register('rock.large', (o) => rockModel(o.rng, true));
    this.register('rock.small', (o) => rockModel(o.rng, false));
    this.register('tree.spruce', (o) => treeModel('spruce', o.rng));
    this.register('tree.fir', (o) => treeModel('fir', o.rng));
    this.register('tree.larch', (o) => treeModel('larch', o.rng));
    this.register('tree.beech', (o) => treeModel('beech', o.rng));
    this.register('stump', (o) => stump(o.rng));
    // Animated, period-dressed characters (characters.ts). Registered here so exploration's crowd and
    // combat's squads pick them up through their existing first-registration-wins `hasModel` guards.
    for (const id of CHARACTER_MODEL_IDS) {
      // `seed` (when the caller has a stable per-entity one) keeps an NPC's cloth/headwear variant
      // identical across the 300 m freeze/unfreeze cycle; otherwise fall back to the spawn RNG.
      this.register(id, (o) => characterModel(id, { variant: o.variant, seed: o.seed ?? ((o.rng.next() * 0xffffffff) >>> 0) }));
    }
    for (const k of ['spiess', 'halberd', 'crossbow', 'sword', 'dagger', 'staff']) this.register(`weapon.${k}`, () => weaponModel(k));
    for (const k of ['heater', 'buckler']) this.register(`shield.${k}`, () => shieldModel(k));
    this.register('placeholder', () => placeholder());
  }

  register(id: string, factory: ModelFactory): void {
    this.factories.set(id, factory);
  }
  has(id: string): boolean {
    return this.factories.has(id);
  }
  list(): string[] {
    return [...this.factories.keys()];
  }
  spawn(id: string, opts?: { variant?: string; scale?: number; seed?: number }): Object3D {
    if (!this.factories.has(id) && !this.warnedUnknown.has(id)) {
      this.warnedUnknown.add(id);
      console.warn(`[world] spawnModel: unknown model id "${id}", falling back to placeholder`);
    }
    const factory = this.factories.get(id) ?? this.factories.get('placeholder')!;
    const salt = hashString(`${id}:${opts?.variant ?? ''}:${opts?.seed ?? this.spawnCount++}`);
    const rng = new Rng((this.seed ^ salt) >>> 0);
    const obj = factory({ variant: opts?.variant, rng, seed: opts?.seed });
    const scale = opts?.scale ?? 1;
    if (scale !== 1) obj.scale.setScalar(scale);
    return obj;
  }
}

export function disposeModelCaches(): void {
  disposeKitCaches();
}
