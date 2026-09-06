/**
 * `WorldService.spawnCharacter` and the `char.*` model factories: a skinned, animated humanoid per
 * archetype, dressed to LORE.md §7 (1291–1315).
 *
 * The mesh is authored in src/world/characters/body.ts (sculpted head with a face, hands with fingers,
 * pleated layered clothing, period headwear, weapon in the hand) and skinned to a skeleton whose *rotations*
 * come from the CC0 KayKit "Rig_Medium" clip pack (public/assets/characters/rig-medium.anims.bin) but whose
 * *bone lengths* are retargeted to adult human proportions — the pack's own proportions are toon (short
 * legs, huge torso). Materials: src/world/characterAssets.ts (Poly Haven wool + leather, ambientCG iron +
 * chainmail), tinted per vertex.
 *
 * At most 4 draw calls per character — one SkinnedMesh per shared PBR material: wool (all woven cloth),
 * hide (skin, hair, leather, wood, the horse of a mounted archetype, weighted to the never-animated root
 * bone), iron (helmets, blades, buckles) and chainmail — with a second, ≤ 800-triangle set swapped in
 * beyond `LOD_FAR` metres (built lazily the first time a character is seen from that far). Geometry is
 * cached per (archetype, variant, lod) and shared between every instance; only the Skeleton and the
 * AnimationMixer are per character.
 *
 * Every `CharacterAnim` maps onto a clip of the pack (see `clipFor`, which documents the reuse), `setSpeed`
 * blends idle → walk → run with the clip's timeScale matched to ground speed, and characters spawned
 * through `spawnModel('char.*')` — which is how exploration and combat get theirs — infer that speed from
 * how far their owner moves them, so an NPC walks without any caller changes.
 */
import {
  AnimationAction, AnimationClip, AnimationMixer, Bone, BufferGeometry, Camera, Color, Group, LoopOnce, LoopRepeat, Matrix4,
  Mesh, MeshStandardMaterial, Object3D, Quaternion, QuaternionKeyframeTrack, Skeleton, SkinnedMesh, Vector3, VectorKeyframeTrack,
} from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import type { CharacterAnim, CharacterHandle } from '@core/services';
import { hashString } from '@core/rng';
import { loadRigAnims, type RigAnims } from './assets';
import { characterMaterial, loadCharacterModel, modelClip, type CharacterLayer, type CharacterModel } from './characterAssets';
import { registerCsmMaterial } from './shadowCsm';
import { MOUNT_Y, TARGET, buildLookGeometry, buildHeldKit, type Bind, type LookGeometry } from './characters/body';
import { HAIR_GREY, LOOKS, LOOK_VARIANTS, bodyFor, isUniform, lookFor, varyLook, type Body, type Look, type WeaponKind } from './characters/looks';

export type { LookGeometry } from './characters/body';
export type { WeaponKind } from './characters/looks';

/** Distance beyond which the ≤ 800-triangle set is drawn (with 3 m of hysteresis on the way back). */
export const LOD_FAR = 25;

// ---------------------------------------------------------------------------------------------
// Skeleton: KayKit rest rotations, human bone lengths
// ---------------------------------------------------------------------------------------------

const san = (n: string) => n.replace(/[.\s]/g, '_');

/** hips-height ratio target/source: scales the animated root+hips translation so the bob stays natural.
 *  KayKit source hips rest ≈ 0.406 m, human target 0.95 m — but a full 2.34× scale of every root/hips
 *  delta would double-count the stride the owner already applies by moving the object, so the constant
 *  is tuned (≈1.21) rather than derived: bob amplitude reads right without foot-speed mismatch. */
const MOTION_SCALE = 1.21;

interface Rig {
  anims: RigAnims;
  order: string[];                       // bone order (== skin index order)
  bind: Bind;                            // retargeted bind-pose world transforms
  boneInverses: Matrix4[];
  clips: Map<string, AnimationClip>;
}

let rig: Rig | null = null;
let rigLoading: Promise<Rig | null> | null = null;

function buildBones(anims: RigAnims): Bone[] {
  const bones = anims.skeleton.map((b) => {
    const o = new Bone();
    o.name = san(b.name);
    o.position.set(b.t[0], b.t[1], b.t[2]);
    o.quaternion.set(b.r[0], b.r[1], b.r[2], b.r[3]);
    return o;
  });
  anims.skeleton.forEach((b, i) => { if (b.parent >= 0) bones[b.parent].add(bones[i]); });
  const roots = bones.filter((_, i) => anims.skeleton[i].parent < 0);
  for (const r of roots) r.updateMatrixWorld(true);

  // Retarget: keep every rest rotation, move each joint to its human-proportioned world position.
  const worldQuat = new Map<string, Quaternion>();
  for (let i = 0; i < bones.length; i++) worldQuat.set(anims.skeleton[i].name, bones[i].getWorldQuaternion(new Quaternion()));
  const inv = new Quaternion();
  for (let i = 0; i < bones.length; i++) {
    const src = anims.skeleton[i];
    const target = TARGET[src.name];
    if (!target) continue;
    const parentName = src.parent >= 0 ? anims.skeleton[src.parent].name : null;
    const parentTarget = parentName ? (TARGET[parentName] ?? [0, 0, 0]) : [0, 0, 0];
    const local = new Vector3(target[0] - parentTarget[0], target[1] - parentTarget[1], target[2] - parentTarget[2]);
    if (parentName) local.applyQuaternion(inv.copy(worldQuat.get(parentName)!).invert());
    bones[i].position.copy(local);
  }
  for (const r of roots) r.updateMatrixWorld(true);
  return bones;
}

function makeClips(anims: RigAnims): Map<string, AnimationClip> {
  const out = new Map<string, AnimationClip>();
  const srcHips = anims.bind.hips ?? [0, 0.406, 0];
  const dstHips = TARGET.hips;
  for (const [name, clip] of anims.clips) {
    const tracks = [];
    for (const t of clip.tracks) {
      if (t.path === 'quaternion') {
        tracks.push(new QuaternionKeyframeTrack(`${san(t.bone)}.quaternion`, Array.from(t.times), Array.from(t.values)));
      } else {
        // only root/hips carry position tracks; remap them onto the retargeted rest height
        const v = Array.from(t.values);
        const isHips = t.bone === 'hips';
        for (let i = 0; i < v.length; i += 3) {
          v[i] = (v[i] - (isHips ? srcHips[0] : 0)) * MOTION_SCALE + (isHips ? dstHips[0] : 0);
          v[i + 1] = (v[i + 1] - (isHips ? srcHips[1] : 0)) * MOTION_SCALE + (isHips ? dstHips[1] : 0);
          v[i + 2] = (v[i + 2] - (isHips ? srcHips[2] : 0)) * MOTION_SCALE + (isHips ? dstHips[2] : 0);
        }
        tracks.push(new VectorKeyframeTrack(`${san(t.bone)}.position`, Array.from(t.times), v));
      }
    }
    out.set(name, new AnimationClip(name, clip.duration, tracks));
  }
  return out;
}

function ensureRig(): Promise<Rig | null> {
  if (rig) return Promise.resolve(rig);
  if (rigLoading) return rigLoading;
  rigLoading = loadRigAnims().then((anims) => {
    if (!anims) return null;
    const bones = buildBones(anims);
    const bind: Bind = new Map();
    bones.forEach((b, i) => bind.set(anims.skeleton[i].name, {
      pos: b.getWorldPosition(new Vector3()), quat: b.getWorldQuaternion(new Quaternion()),
    }));
    const boneInverses = bones.map((b) => new Matrix4().copy(b.matrixWorld).invert());
    rig = { anims, order: anims.skeleton.map((b) => b.name), bind, boneInverses, clips: makeClips(anims) };
    return rig;
  });
  return rigLoading;
}

/** Bind pose used while the clip pack is still loading (and if it never arrives). */
const FALLBACK_BIND: Bind = (() => {
  const m: Bind = new Map();
  for (const [k, v] of Object.entries(TARGET)) m.set(k, { pos: new Vector3(v[0], v[1], v[2]), quat: new Quaternion() });
  return m;
})();

// ---------------------------------------------------------------------------------------------
// Animation mapping (documented reuse — the CC0 pack has no period-specific clips)
// ---------------------------------------------------------------------------------------------

type ClipPick = { name: string; loop: boolean; hold?: boolean };

/** `CharacterAnim` → KayKit clip, per weapon class. Reuse is deliberate and listed here:
 *  - `idle` is a per-character spread (`Idle_A`/`Idle_B`) so a crowd is not a row of identical statues;
 *    armed characters get the matching weapon idle instead;
 *  - `talk` reuses `Interact` (a gesture with the free hand), `cheer` reuses `Cheering`;
 *  - `flee` reuses `Running_B` (arms higher, faster cadence) so a rout reads differently from a charge;
 *  - `brace` reuses `Melee_Blocking` for everyone, including polearms (shield-less troops plant the haft);
 *  - `shoot` reuses `Throw` and `reload` reuses `Use_Item` for anyone not carrying a crossbow;
 *  - `dead` is the last frame of `Death_A` (`Death_A_Pose`), held. */
export function clipFor(anim: CharacterAnim, weapon: WeaponKind, seed: number, shield = false): ClipPick {
  const twoHand = (weapon === 'spiess' || weapon === 'halberd' || weapon === 'staff' || weapon === 'axe') && !shield;
  const ranged = weapon === 'crossbow';
  switch (anim) {
    case 'idle':
      if (ranged) return { name: 'Holding_B', loop: true };
      // Anything held in the hand slot must use a clip whose hand *grips*: in the pack's empty-handed
      // idles the wrist rolls over and a staff or spear ends up floating horizontally.
      if (weapon === 'staff') return { name: 'Melee_2H_Idle', loop: true };   // `Working_A` splays the arms out
      if (twoHand) return { name: 'Melee_2H_Idle', loop: true };
      if (weapon === 'sword' || weapon === 'lance') return { name: 'Melee_Unarmed_Idle', loop: true };
      // Empty hands: only the two neutral standing idles. `Working_A`/`Holding_B` shape the hands around
      // an object and extend the arm, which reads as reaching into thin air when nothing is held.
      return { name: seed % 2 === 0 ? 'Idle_A' : 'Idle_B', loop: true };
    case 'walk': return { name: seed % 3 === 0 ? 'Walking_C' : 'Walking_A', loop: true };
    case 'run': return { name: 'Running_A', loop: true };
    case 'flee': return { name: 'Running_B', loop: true };
    case 'attack':
      if (ranged) return { name: 'Ranged_2H_Shoot', loop: false };
      if (twoHand) return { name: seed % 2 === 0 ? 'Melee_2H_Attack_Stab' : 'Melee_2H_Attack_Chop', loop: false };
      return { name: seed % 2 === 0 ? 'Melee_1H_Attack_Chop' : 'Melee_1H_Attack_Slice_Diagonal', loop: false };
    case 'shoot': return { name: ranged ? 'Ranged_2H_Shoot' : 'Throw', loop: false };
    case 'reload': return { name: ranged ? 'Ranged_2H_Reload' : 'Use_Item', loop: false };
    case 'hit': return { name: seed % 2 === 0 ? 'Hit_A' : 'Hit_B', loop: false };
    case 'down': return { name: 'Death_A', loop: false };
    case 'dead': return { name: 'Death_A_Pose', loop: false };
    case 'brace': return { name: 'Melee_Blocking', loop: true };
    case 'talk': return { name: 'Interact', loop: false };
    case 'cheer': return { name: 'Cheering', loop: true };
    // 3.5 settlement-life loops (KayKit pack has no dedicated sit/work/limp clips — deliberate reuse,
    // documented here like every other mapping above):
    // - `sit` reuses `Sit_Chair_Idle` (seated weight, settled hands) — inn benches, tavern evenings;
    // - `work` reuses `Working_A` (both arms forward-down, repetitive bend) — wall-building, farm labour;
    // - `limp` reuses `Hit_B`-paced `Walking_B` (shorter, heavier step than Walking_A/C) — wounded walk,
    //   Morgarten carried-off beat. A true asymmetric limp would need a new clip; this reads as hurt
    //   without one.
    case 'sit': return { name: 'Sit_Chair_Idle', loop: true };
    case 'work': return { name: 'Working_A', loop: true };
    case 'limp': return { name: 'Walking_B', loop: true };
    default: return { name: 'Idle_A', loop: true };
  }
}

/** `CharacterAnim` → Mixamo clip (public/assets/characters/clips), per weapon class. Reuse, deliberately:
 *  - polearms and staffs use the two-handed sword set (both hands on the haft), the crossbow the plain
 *    idle with `Aiming` / `Reloading` for shoot / reload;
 *  - `flee` is `Running_Tired`, `brace` the sword-and-shield block (shield-less troops: `Standing_Block_Idle`);
 *  - `down` is `Falling_Down` clamped on its last frame, `dead` the same clip held at its end. */
export function mixamoClipFor(anim: CharacterAnim, weapon: WeaponKind, seed: number, shield = false): ClipPick & { hold?: boolean } {
  const twoHand = (weapon === 'spiess' || weapon === 'halberd' || weapon === 'staff' || weapon === 'axe' || weapon === 'lance') && !shield;
  const sword = weapon === 'sword' || (shield && weapon !== 'crossbow');
  const ranged = weapon === 'crossbow';
  switch (anim) {
    case 'idle':
      if (twoHand) return { name: 'Great_Sword_Idle', loop: true };
      if (sword) return { name: 'Sword_And_Shield_Idle', loop: true };
      return { name: ['Idle', 'Standing_Idle', 'Standing_Idle_02', 'Idle'][seed % 4], loop: true };   // Standing_Idle_03 crouches to examine the ground
    case 'walk': return { name: twoHand ? 'Great_Sword_Walk' : sword ? 'Sword_And_Shield_Walk' : 'Walking', loop: true };
    case 'run': return { name: 'Running', loop: true };
    case 'flee': return { name: 'Running_Tired', loop: true };
    case 'attack':
      if (ranged) return { name: 'Aiming', loop: false };
      if (twoHand) return { name: seed % 2 === 0 ? 'Two_Hand_Sword_Combo' : 'Great_Sword_Slash', loop: false };
      if (sword) return { name: seed % 2 === 0 ? 'Sword_And_Shield_Slash' : 'Sword_And_Shield_Attack', loop: false };
      return { name: 'Stabbing', loop: false };
    case 'shoot': return { name: 'Aiming', loop: false };
    case 'reload': return { name: 'Reloading', loop: false };
    case 'hit': return { name: sword ? 'Sword_And_Shield_Impact' : seed % 2 === 0 ? 'Hit_Reaction' : 'Hit_To_Body', loop: false };
    case 'down': return { name: 'Falling_Down', loop: false };
    case 'dead': return { name: 'Falling_Down', loop: false, hold: true };
    case 'brace': return { name: sword ? 'Blocking' : 'Standing_Block_Idle', loop: true };
    case 'talk': return { name: 'Talking', loop: false };
    case 'cheer': return { name: 'Cheering', loop: true };
    // 3.5 settlement-life loops from the downloaded Mixamo set (manifest "clips"):
    // - `sit` = Sitting_Idle (seated, settled weight) — inn benches, tavern evenings;
    // - `work` = Standing_Idle_03 (bent to the ground, examining/working at foot level) — wall-building,
    //   farm labour. Excluded from the idle pool for exactly this bend; here the bend IS the point.
    // - `limp` = Running_Tired played slow (heavy, uneven tread) — wounded walk, Morgarten carried-off.
    case 'sit': return { name: 'Sitting_Idle', loop: true };
    case 'work': return { name: 'Standing_Idle_03', loop: true };
    case 'limp': return { name: 'Running_Tired', loop: true };
    default: return { name: 'Idle', loop: true };
  }
}

/** A per-instance copy of a body material whose cloth is dyed by `tint` while skin-toned texels keep their
 *  colour (a plain colour multiply would recolour faces and hands too: Mixamo bodies are one material).
 *  Skin is detected per texel as warm mid-tones (r > g > b, moderate saturation). Material.clone() does not
 *  carry the CSM hook, so the clone is registered again. */
/** Hair/beard dyes for bodies whose hair is painted grey-white (the Peasant Man's beard): applied to the
 *  low-saturation texels above the neck line, so the same body reads as a white-, brown-, black- or
 *  red-bearded man by seed. Index 0 keeps the texture (elders). */
const HAIR_DYES: [number, number, number][] = [
  [1, 1, 1], [0.5, 0.36, 0.22], [0.24, 0.2, 0.17], [0.72, 0.42, 0.22], [0.62, 0.5, 0.36], [0.4, 0.3, 0.2],
];

function tintedClone(mat: MeshStandardMaterial, tint: [number, number, number], hair?: { dye: [number, number, number]; neckY: number }): MeshStandardMaterial {
  const c = mat.clone();
  c.onBeforeCompile = (shader) => {
    shader.uniforms.uDye = { value: new Vector3(tint[0], tint[1], tint[2]) };
    shader.uniforms.uHair = { value: hair ? new Vector3(hair.dye[0], hair.dye[1], hair.dye[2]) : new Vector3(1, 1, 1) };
    shader.uniforms.uNeckY = { value: hair ? hair.neckY : 1e9 };
    // bind-pose height of the texel (geometry units, before skinning) — tells hair from a linen shirt
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vBindY;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBindY = position.y;');
    shader.fragmentShader = shader.fragmentShader
      .replace('uniform vec3 diffuse;', 'uniform vec3 diffuse;\nuniform vec3 uDye;\nuniform vec3 uHair;\nuniform float uNeckY;\nvarying float vBindY;')
      .replace('#include <map_fragment>', `#include <map_fragment>
      {
        vec3 c = diffuseColor.rgb;
        float warm = c.r - c.b;
        float sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
        // skin: warm mid-tones (ruddy cheeks included); grey: hair, beards, iron — neither takes the dye
        float skin = step(c.g, c.r) * step(c.b, c.g) * smoothstep(0.03, 0.1, warm) * (1.0 - smoothstep(0.55, 0.75, warm)) * smoothstep(0.16, 0.3, c.r);
        float grey = 1.0 - smoothstep(0.04, 0.1, sat);
        // grey above the neck line is hair or beard: it takes the hair dye instead of the cloth dye
        // the beard texels are warm off-white, not neutral grey: above the neck the grey test is wider
        float hairGrey = 1.0 - smoothstep(0.12, 0.30, sat);
        float hairMask = hairGrey * step(uNeckY, vBindY) * (1.0 - skin);
        skin = max(skin, grey);
        diffuseColor.rgb = mix(c * uDye, c, skin);
        diffuseColor.rgb = mix(diffuseColor.rgb, c * uHair, hairMask);
      }`);
  };
  c.dispose = () => {};   // shared textures; exploration disposes NPC materials on freeze
  c.userData.tintedClone = true; // per-instance material (see Character.dispose): owned by the character
  registerCsmMaterial(c);
  return c;
}

/** Where the procedural weapon (grip at the origin, blade along +Y) sits in the Mixamo `RightHand` bone's
 *  frame, and the shield board in `LeftForeArm`'s — tuned on the sheet renders. */
const HAND_R_FRAME = { pos: new Vector3(0, 0.07, 0.0), quat: new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2) };
// shield: the forearm bone's Y runs along the arm and its -Z faces away from the body, so the board's long
// axis (local Y) is turned onto the bone's X to hang vertically, its face (-Z) already outward
const SHIELD_FRAME = { pos: new Vector3(0, 0.14, 0.0), quat: new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2) };   // point down

// ---------------------------------------------------------------------------------------------
// Geometry cache
// ---------------------------------------------------------------------------------------------

const geoCache = new Map<string, LookGeometry>();

function lookGeometry(key: string, look: Look, rigOrder: string[], bind: Bind, mounted: boolean, lod: number): LookGeometry {
  const hit = geoCache.get(key);
  if (hit) return hit;
  const index = new Map(rigOrder.map((n, i) => [n, i]));
  const built = buildLookGeometry(look, (n) => index.get(n) ?? 0, bind, mounted, lod);
  // Shared across every character of this look; exploration disposes an NPC's geometry when it freezes
  // the NPC, which must not free the pooled buffer (see disposeCharacterCaches).
  for (const g of [built.cloth, built.hide, built.metal, built.mail]) {
    if (!g) continue;
    if (g.boundingSphere) g.boundingSphere.radius *= 1.6;   // skinned poses reach past the bind pose
    g.dispose = () => {};
  }
  geoCache.set(key, built);
  return built;
}

const LAYERS: [CharacterLayer, keyof LookGeometry][] = [['cloth', 'cloth'], ['hide', 'hide'], ['metal', 'metal'], ['mail', 'mail']];

/** The rig root doubles as a distance-LOD switch: the renderer calls `update(camera)` on anything with
 *  `isLOD` before projecting its children, which is where the far set is (lazily) built and swapped in. */
class RigRoot extends Group {
  readonly isLOD = true;
  autoUpdate = true;
  near: SkinnedMesh[] = [];
  far: SkinnedMesh[] | null = null;
  farBuilder: (() => SkinnedMesh[]) | null = null;
  private isFar = false;
  private v = new Vector3();
  private w = new Vector3();
  update(camera: Camera): void {
    if (!this.farBuilder) return;
    this.v.setFromMatrixPosition(camera.matrixWorld);
    this.w.setFromMatrixPosition(this.matrixWorld);
    const d = this.v.distanceTo(this.w);
    const far = this.isFar ? d > LOD_FAR - 3 : d > LOD_FAR;
    if (far === this.isFar) return;
    this.isFar = far;
    if (this.shadowOnly) {           // downloaded bodies: no far set, they just stop casting shadows
      for (const m of this.near) m.castShadow = !far;
      return;
    }
    if (far && !this.far) {
      this.far = this.farBuilder();
      for (const m of this.far) this.add(m);
    }
    for (const m of this.near) m.visible = !far;
    if (this.far) for (const m of this.far) m.visible = far;
  }
  shadowOnly = false;
}

// ---------------------------------------------------------------------------------------------
// CharacterHandle
// ---------------------------------------------------------------------------------------------

const WALK_MPS = 1.35;
const RUN_MPS = 3.6;

class Character implements CharacterHandle {
  readonly object = new Group();
  rigged = false;
  private mixer: AnimationMixer | null = null;
  private actions = new Map<string, AnimationAction>();
  private clips: Map<string, AnimationClip> | null = null;
  private current: AnimationAction | null = null;
  private currentAnim: CharacterAnim | null = null;
  private locomotion: CharacterAnim = 'idle';
  private oneShotUntil = 0;
  private time = 0;
  private meshes: (Mesh | SkinnedMesh)[] = [];
  private skeleton: Skeleton | null = null;
  private disposed = false;
  private weapon: WeaponKind;
  private hasShield = false;
  private seed: number;
  /** fallback (no clip pack): bones driven directly by `poseFallback` */
  private fbBones: Map<string, Bone> | null = null;
  private fbPhase = 0;
  /** mounted: thigh bones re-opened every frame (the pack only has a chair-sitting clip) */
  private mountLegs: Bone[] = [];
  private lastPos = new Vector3();
  /** speed inferred from how far the owner moved the object, when nobody calls setSpeed() */
  private autoSpeed = 0;
  private fbSpeed = 0;
  private explicitSpeed = false;
  /** set when a downloaded body is in use: clips come from characterAssets.modelClip instead of the KayKit pack */
  private bodyModel: CharacterModel | null = null;
  private clipsReady = false;
  readonly createdAt = performance.now();

  constructor(private archetype: string, opts: { variant?: string; mounted?: boolean; seed?: number } = {}) {
    const look = lookFor(archetype);
    this.seed = opts.seed ?? hashString(archetype);
    const main = (look.mainHand ?? 'none') as WeaponKind;
    this.weapon = main === 'dagger' ? 'none' : main;   // a sheathed sidearm leaves the hands free
    this.hasShield = (look.offHand ?? 'none') !== 'none';
    this.object.name = `char.${archetype}`;
    // an explicit `mounted: false` (combat fighting a knight on foot) wins over the look's own default
    const mounted = opts.mounted ?? (opts.variant === 'mounted' || !!look.mounted);
    registerTicker(this);          // ticked from now on, whatever happens to the async build below
    // a downloaded body when the archetype has one and the character is on foot (the horse is procedural)
    const body = mounted ? null : bodyFor(archetype, this.seed);
    const procedural = () => ensureRig()
      .then((r) => { if (!this.disposed) this.build(look, mounted, r); })
      .catch((e) => { console.warn('[characters] rig unavailable, fallback pose kept:', e); });
    if (body) {
      loadCharacterModel(body.id)
        .then((m) => { if (this.disposed) return; if (m) this.buildBody(look, body, m); else return procedural(); })
        .catch((e) => { console.warn('[characters] body build failed, procedural fallback:', e); return procedural(); });
    } else {
      void procedural();
    }
  }

  /** Mixamo body: a SkeletonUtils clone of the shared template, scaled to `body.height` with its soles on
   *  the origin, materials cloned per instance for the seed's tint, weapon/shield authored procedurally and
   *  hung on the hand bones. Clips are Mixamo's, retargeted per body in characterAssets.modelClip. */
  private buildBody(look: Look, body: Body, model: CharacterModel): void {
    const inst = cloneSkeleton(model.template) as Object3D;
    const rigRoot = new RigRoot();
    rigRoot.shadowOnly = true;
    // ±5 % stature per seed so a crowd sharing one body is not one silhouette twenty times
    const k = (body.height / model.height) * (0.95 + ((this.seed >>> 5) % 7) * (0.1 / 6));
    rigRoot.scale.setScalar(k);
    rigRoot.position.y = -model.minY * k;
    rigRoot.add(inst);
    this.object.add(rigRoot);
    const tint = body.tints ? body.tints[this.seed % body.tints.length] : null;
    inst.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
      if (tint) {
        let hair: { dye: [number, number, number]; neckY: number } | undefined;
        if (body.hair) {
          // neck line at 84 % of the bind-pose height (T-pose hands sit at ~80 %), in the mesh's own units
          const g = m.geometry; if (!g.boundingBox) g.computeBoundingBox();
          const bb = g.boundingBox!;
          const grey = look.beard === 'grey' || look.hair === HAIR_GREY;
          hair = { dye: grey ? HAIR_DYES[0] : HAIR_DYES[1 + ((this.seed >>> 7) % (HAIR_DYES.length - 1))], neckY: bb.min.y + (bb.max.y - bb.min.y) * 0.84 };
        }
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        const cloned = mats.map((mat) => tintedClone(mat as MeshStandardMaterial, tint, hair));
        m.material = Array.isArray(m.material) ? cloned : cloned[0];
      }
      this.meshes.push(m);
      rigRoot.near.push(m as unknown as SkinnedMesh);
    });
    // held kit: procedural weapon / shield on the hand bones, counter-scaled to metres
    const kit = buildHeldKit((look.mainHand ?? 'none') as WeaponKind, (look.offHand ?? 'none') as import('./characters/looks').ShieldKind, !!look.surcoat);
    inst.updateMatrixWorld(true);
    const hang = (bone: string, parts: { geometry: BufferGeometry; layer: CharacterLayer }[], frame: { pos: Vector3; quat: Quaternion }) => {
      const b = inst.getObjectByName(bone);
      if (!b || !parts.length) return;
      const holder = new Group();
      const ws = b.getWorldScale(new Vector3());
      holder.scale.set(1 / (ws.x || 1), 1 / (ws.y || 1), 1 / (ws.z || 1));
      holder.position.copy(frame.pos).divide(ws);        // frame.pos is metres; the bone's units are the rig's (cm)
      holder.quaternion.copy(frame.quat);
      for (const p of parts) {
        const m = new Mesh(p.geometry, characterMaterial(p.layer));
        m.castShadow = true;
        m.userData.heldKit = true; // owned by this character (see dispose): never a shared-cache mesh
        holder.add(m);
        this.meshes.push(m);
      }
      b.add(holder);
    };
    hang('RightHand', kit.weapon, HAND_R_FRAME);
    hang('LeftForeArm', kit.shield, SHIELD_FRAME);
    rigRoot.farBuilder = () => [];
    this.bodyModel = model;
    this.mixer = new AnimationMixer(inst);
    this.rigged = true;
    this.clipsReady = true;
    void this.start('idle', 0);
    this.mixer.update(0);
  }

  private build(baseLook: Look, mounted: boolean, r: Rig | null): void {
    const order = r ? r.order : Object.keys(TARGET);
    const bind = r ? r.bind : FALLBACK_BIND;
    const v = this.seed % LOOK_VARIANTS;
    const look = varyLook(baseLook, v);
    // soldiers keep one livery, so the cache key ignores the cloth part of the variant only via varyLook
    const key = `${this.archetype}|v${v}${isUniform(baseLook) ? 'u' : ''}|${mounted ? 'm' : ''}|${r ? 'rig' : 'fb'}`;
    const geo = lookGeometry(`${key}|0`, look, order, bind, mounted, 0);

    const bones = r ? buildBones(r.anims) : fallbackBones(order);
    const root = bones.find((b) => b.parent === null || !(b.parent instanceof Bone)) ?? bones[0];
    const boneInverses = r ? r.boneInverses : bones.map((b) => new Matrix4().copy(b.matrixWorld).invert());
    const skeleton = new Skeleton(bones, boneInverses);
    this.skeleton = skeleton;
    const rigRoot = new RigRoot();
    rigRoot.add(root);
    if (look.scale && look.scale !== 1) rigRoot.scale.setScalar(look.scale);
    this.object.add(rigRoot);

    const makeMeshes = (g: LookGeometry): SkinnedMesh[] => {
      const out: SkinnedMesh[] = [];
      for (const [layer, field] of LAYERS) {
        const geometry = g[field] as BufferGeometry | null;
        if (!geometry) continue;
        const m = new SkinnedMesh(geometry, characterMaterial(layer) as MeshStandardMaterial);
        m.castShadow = true;
        m.receiveShadow = true;
        m.bind(skeleton, new Matrix4());
        out.push(m);
      }
      return out;
    };
    rigRoot.near = makeMeshes(geo);
    for (const m of rigRoot.near) { rigRoot.add(m); this.meshes.push(m); }
    rigRoot.farBuilder = () => {
      const far = makeMeshes(lookGeometry(`${key}|1`, look, order, bind, mounted, 1));
      for (const m of far) { m.visible = false; this.meshes.push(m); }
      return far;
    };

    if (mounted) {
      rigRoot.position.y = MOUNT_Y;                // rider in the saddle; the horse is part of `hide`
      this.mountLegs = [bones.find((b) => b.name === san('upperleg.l')), bones.find((b) => b.name === san('upperleg.r'))]
        .filter((b): b is Bone => !!b);
    }

    // Relaxed rest pose first, for everyone: the bind pose is a T-pose, so anything that later keeps a
    // mixer from running (a build that races a teardown, a character the scheduler never reaches) would
    // otherwise leave a scarecrow standing in the square.
    this.fbBones = new Map(bones.map((b) => [b.name, b]));
    this.poseFallback(0, 0);
    if (r) {
      this.mixer = new AnimationMixer(rigRoot);
      this.clips = r.clips;
      this.rigged = true;
      if (mounted) {
        const sit = this.action('Sit_Chair_Idle');
        if (sit) { sit.play(); this.current = sit; this.currentAnim = 'idle'; }
      } else {
        this.start('idle', 0);
      }
      // Apply frame 0 straight away: a character built while the game is paused (dialogue, cutscene) or
      // one spawned in the frame the screenshot is taken would otherwise render in its bind T-pose.
      this.mixer.update(0);
    }
  }

  /** crossfade into `anim`; returns when a one-shot has finished (immediately for loops). */
  play(anim: CharacterAnim, opts: { loop?: boolean; speed?: number; fade?: number } = {}): Promise<void> {
    const pick = this.bodyModel ? mixamoClipFor(anim, this.weapon, this.seed, this.hasShield) : clipFor(anim, this.weapon, this.seed, this.hasShield);
    const loop = opts.loop ?? pick.loop;
    const dur = this.start(anim, opts.fade ?? 0.22, opts.speed ?? 1, loop);
    if (loop) return Promise.resolve();
    this.oneShotUntil = this.time + dur;
    return new Promise((resolve) => { this.pending.push({ at: this.oneShotUntil, resolve }); });
  }

  /** The animation currently held — lets owners (NPC settlement poses) avoid restarting a loop. */
  currentAnimName(): CharacterAnim { return this.currentAnim ?? 'idle'; }

  private pending: { at: number; resolve: () => void }[] = [];

  /** Clip actions are created the first time a character actually plays that clip. Mixamo clips load
   *  asynchronously: the first request for one returns null and `start` re-runs once it has arrived. */
  private action(name: string): AnimationAction | null {
    const hit = this.actions.get(name);
    if (hit) return hit;
    if (!this.mixer) return null;
    let clip: AnimationClip | null | undefined = this.clips?.get(name);
    if (this.bodyModel) {
      clip = this.bodyModel.clips.get(name);
      if (clip === undefined && !this.pendingClips.has(name)) {
        this.pendingClips.add(name);
        void modelClip(this.bodyModel, name).then((c) => {
          this.pendingClips.delete(name);
          if (this.disposed || !c) return;
          if (this.wanted && this.wanted.name === name) { const w = this.wanted; this.wanted = null; this.start(w.anim, w.fade, w.speed, w.loop); }
        });
      }
    }
    if (!clip) return null;
    const a = this.mixer.clipAction(clip);
    a.enabled = true;
    this.actions.set(name, a);
    return a;
  }
  private pendingClips = new Set<string>();
  private wanted: { name: string; anim: CharacterAnim; fade: number; speed: number; loop?: boolean } | null = null;

  private start(anim: CharacterAnim, fade: number, speed = 1, loopOverride?: boolean): number {
    const pick = this.bodyModel ? mixamoClipFor(anim, this.weapon, this.seed, this.hasShield) : clipFor(anim, this.weapon, this.seed, this.hasShield);
    const next = this.action(pick.name);
    this.currentAnim = anim;
    if (!next) { this.wanted = { name: pick.name, anim, fade, speed, loop: loopOverride }; return 0.5; }
    this.wanted = null;
    const loop = loopOverride ?? pick.loop;
    next.reset();
    next.timeScale = speed;
    next.clampWhenFinished = !loop;
    next.setLoop(loop ? LoopRepeat : LoopOnce, loop ? Infinity : 1);
    next.enabled = true;
    if (this.current && this.current !== next && fade > 0) {
      next.crossFadeFrom(this.current, fade, false);
      next.play();
    } else {
      this.current?.stop();
      next.play();
    }
    this.current = next;
    if (pick.hold) { next.time = Math.max(0, next.getClip().duration - 1e-3); next.paused = true; }   // held last frame (dead)
    return next.getClip().duration / Math.max(0.05, speed);
  }

  /** Blend idle → walk → run from real velocity; timeScale keeps footfalls matched to ground speed. */
  setSpeed(mps: number): void {
    this.explicitSpeed = true;
    this.fbSpeed = mps;
    this.applySpeed(mps);
  }

  private applySpeed(mps: number): void {
    if (!this.mixer || this.time < this.oneShotUntil) return;
    const want: CharacterAnim = mps < 0.25 ? 'idle' : mps < 2.4 ? 'walk' : 'run';
    const scale = want === 'walk' ? Math.max(0.55, Math.min(1.8, mps / WALK_MPS))
      : want === 'run' ? Math.max(0.7, Math.min(1.6, mps / RUN_MPS)) : 1;
    if (want !== this.locomotion || this.currentAnim !== want) {
      this.locomotion = want;
      this.start(want, 0.25, scale);
    } else if (this.current) {
      this.current.timeScale = scale;
    }
  }

  update(dt: number): void {
    if (this.disposed) return;
    this.time += dt;
    if (!this.explicitSpeed && dt > 0) {
      const p = this.object.position;
      const d = Math.hypot(p.x - this.lastPos.x, p.z - this.lastPos.z);
      this.lastPos.copy(p);
      const inst = d / dt;
      // the owner teleports NPCs when they unfreeze — ignore impossible jumps
      this.autoSpeed = inst > 12 ? 0 : this.autoSpeed + (inst - this.autoSpeed) * Math.min(1, dt * 6);
      this.applySpeed(this.autoSpeed);
    }
    if (this.fbBones && !this.mixer) this.poseFallback(dt, this.explicitSpeed ? this.fbSpeed : this.autoSpeed);
    void this.clipsReady;
    this.mixer?.update(dt);
    for (const leg of this.mountLegs) leg.rotateX(-0.75);  // chair-sit → straddle
    if (this.pending.length && this.time >= this.pending[0].at) {
      const done = this.pending.filter((p) => this.time >= p.at);
      this.pending = this.pending.filter((p) => this.time < p.at);
      for (const p of done) p.resolve();
      if (this.time >= this.oneShotUntil && this.currentAnim !== 'dead' && this.currentAnim !== 'down') {
        this.start(this.locomotion, 0.2);
      }
    }
  }

  /** No clip pack: drop the arms out of the T-pose and swing the limbs from ground speed. */
  private poseFallback(dt: number, mps: number): void {
    const B = this.fbBones!;
    this.fbPhase += dt * (1.6 + mps * 0.55);
    const swing = Math.min(1, mps / 3.2) * 0.55 * Math.sin(this.fbPhase * Math.PI * 2);
    const sway = Math.sin(this.fbPhase * Math.PI) * 0.03;
    const set = (name: string, x: number, y: number, z: number): void => {
      const b = B.get(san(name));
      if (b) b.rotation.set(x, y, z);
    };
    const armDown = 1.42;
    set('upperarm.l', 0.06 - swing * 0.6, 0, -armDown);
    set('upperarm.r', 0.06 + swing * 0.6, 0, armDown);
    set('lowerarm.l', 0, 0, -0.22);
    set('lowerarm.r', 0, 0, 0.22);
    set('upperleg.l', swing, 0, 0.03);
    set('upperleg.r', -swing, 0, -0.03);
    set('lowerleg.l', Math.max(0, -swing) * 0.7, 0, 0);
    set('lowerleg.r', Math.max(0, swing) * 0.7, 0, 0);
    set('spine', sway * 0.5, 0, 0);
    set('chest', -0.04, 0, 0);
  }

  setVisible(v: boolean): void { this.object.visible = v; }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.mixer?.stopAllAction();
    this.skeleton?.dispose();
    this.object.parent?.remove(this.object);
    // Per-instance held-kit meshes (userData.heldKit, hung on the hand bones) and per-instance
    // tinted material clones are owned by this character, not the shared caches — dispose their
    // geometries/materials so combat removeUnit/clearAfterEnd doesn't leak one set per unit per fight.
    // Shared-cache procedural meshes (dispose === noop, no heldKit flag, untinted) are skipped: freeing
    // a pooled buffer would tear it out from under every other character using it.
    for (const m of this.meshes) {
      const mesh = m as Mesh & { userData?: { heldKit?: boolean } };
      const mat = mesh.material as unknown;
      const mats = Array.isArray(mat) ? mat : mat ? [mat] : [];
      for (const mm of mats) {
        const owned = mesh.userData?.heldKit === true
          || (mm as { userData?: { tintedClone?: boolean } }).userData?.tintedClone === true;
        if (owned) (mm as { dispose?: () => void }).dispose?.();
      }
      if (mesh.userData?.heldKit === true) mesh.geometry?.dispose?.();
    }
    for (const p of this.pending) p.resolve();
    this.pending = [];
    this.meshes = [];
    unregisterTicker(this);
  }
}

/** Skeleton for the no-download fallback: the TARGET rest pose, parented like the real rig. */
function fallbackBones(order: string[]): Bone[] {
  const PARENT: Record<string, string | null> = {
    root: null, hips: 'root', spine: 'hips', chest: 'spine', head: 'chest',
    'upperarm.l': 'chest', 'lowerarm.l': 'upperarm.l', 'wrist.l': 'lowerarm.l', 'hand.l': 'wrist.l', 'handslot.l': 'hand.l',
    'upperarm.r': 'chest', 'lowerarm.r': 'upperarm.r', 'wrist.r': 'lowerarm.r', 'hand.r': 'wrist.r', 'handslot.r': 'hand.r',
    'upperleg.l': 'hips', 'lowerleg.l': 'upperleg.l', 'foot.l': 'lowerleg.l', 'toes.l': 'foot.l',
    'upperleg.r': 'hips', 'lowerleg.r': 'upperleg.r', 'foot.r': 'lowerleg.r', 'toes.r': 'foot.r',
  };
  const bones = order.map((n) => { const b = new Bone(); b.name = san(n); return b; });
  const byName = new Map(order.map((n, i) => [n, bones[i]]));
  order.forEach((n, i) => {
    const p = PARENT[n];
    const parent = p ? byName.get(p) : null;
    const t = TARGET[n] ?? [0, 0, 0];
    const pt = p ? (TARGET[p] ?? [0, 0, 0]) : [0, 0, 0];
    bones[i].position.set(t[0] - pt[0], t[1] - pt[1], t[2] - pt[2]);
    if (parent) parent.add(bones[i]);
  });
  for (const b of bones) if (!(b.parent instanceof Bone)) b.updateMatrixWorld(true);
  return bones;
}

// ---------------------------------------------------------------------------------------------
// Ticker: characters spawned through `spawnModel('char.*')` have no owner calling update()
// ---------------------------------------------------------------------------------------------

const live = new Set<Character>();
function registerTicker(c: Character): void { live.add(c); }
function unregisterTicker(c: Character): void { live.delete(c); }

/** Advances every live character. Called once per frame from the world module's scheduler system.
 *  Characters whose owner removed them from the scene (exploration's 300 m NPC freeze) are dropped. */
export function updateCharacters(dt: number): void {
  const now = performance.now();
  for (const c of live) {
    if (!c.object.parent && now - c.createdAt > 2000) { c.dispose(); continue; }
    c.update(dt);
  }
}

export function spawnCharacter(archetype: string, opts: { variant?: string; mounted?: boolean; seed?: number } = {}): CharacterHandle {
  return new Character(archetype, opts);
}

/** Every Mixamo clip name mixamoClipFor can request (3.5 warmup): the full set the world prefetches
 *  at boot / on load so settlement NPCs never play their first seconds in the bind pose. Must stay in
 *  sync with mixamoClipFor's returns — models.test.ts asserts coverage. */
export const CHARACTER_CLIP_NAMES = [
  'Idle', 'Standing_Idle', 'Standing_Idle_02', 'Walking', 'Running', 'Running_Tired',
  'Sword_And_Shield_Idle', 'Sword_And_Shield_Walk', 'Great_Sword_Idle', 'Great_Sword_Walk',
  'Great_Sword_Slash', 'Two_Hand_Sword_Combo', 'Sword_And_Shield_Slash', 'Sword_And_Shield_Attack',
  'Stabbing', 'Aiming', 'Reloading', 'Blocking', 'Standing_Block_Idle', 'Sword_And_Shield_Impact',
  'Hit_Reaction', 'Hit_To_Body', 'Falling_Down', 'Talking', 'Cheering',
  'Sitting_Idle', 'Standing_Idle_03',
];

/** Archetype ids the look table covers (without the `char.` prefix). */
export const CHARACTER_ARCHETYPES = Object.keys(LOOKS);

/** Model ids the library registers so `spawnModel('char.<archetype>')` yields an animated character. */
export const CHARACTER_MODEL_IDS = Object.keys(LOOKS).map((id) => `char.${id}`);

export function characterModel(modelId: string, opts: { variant?: string; scale?: number; seed?: number } = {}): Object3D {
  const handle = spawnCharacter(modelId, { variant: opts.variant, seed: opts.seed });
  if (opts.scale && opts.scale !== 1) handle.object.scale.setScalar(opts.scale);
  return handle.object;
}

/** Builds one look's geometry outside the scene (tests, tooling): triangles per LOD, no cache. */
export function measureLook(archetype: string, seed = 0, lod = 0, mounted = false): LookGeometry {
  const look = varyLook(lookFor(archetype), seed % LOOK_VARIANTS);
  const order = Object.keys(TARGET);
  const index = new Map(order.map((n, i) => [n, i]));
  return buildLookGeometry(look, (n) => index.get(n) ?? 0, FALLBACK_BIND, mounted || !!look.mounted, lod);
}

export function disposeCharacterCaches(): void {
  for (const c of [...live]) c.dispose();
  for (const g of geoCache.values()) {
    for (const b of [g.cloth, g.hide, g.metal, g.mail]) if (b) BufferGeometry.prototype.dispose.call(b);
  }
  geoCache.clear();
  rig = null;
  rigLoading = null;
}
