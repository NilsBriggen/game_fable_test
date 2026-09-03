/**
 * Materials for the character layers (src/world/characters.ts). Two of the four skinned layers use the
 * CC0 Poly Haven sets fetched by tools/assets/fetch-characters.mjs into public/assets/characters/textures/**
 * (credits: public/assets/CREDITS-characters.md); iron and chainmail reuse the ambientCG prop sets.
 *
 * Every material is shared by every character (one instance per layer) and tinted per vertex, the same
 * convention as assets.ts: `map * vColor` with the map neutral, so the vertex colour is the dye / skin tone
 * and the map only contributes weave, grain and roughness. Exploration disposes an NPC's materials when it
 * freezes the NPC, so `dispose` is a no-op here as in assets.ts.
 */
import {
  AnimationClip, Bone, Box3, Mesh, MeshStandardMaterial, Object3D, QuaternionKeyframeTrack, RepeatWrapping, Skeleton,
  SkinnedMesh, SRGBColorSpace, Texture, TextureLoader, Vector2, Vector3, VectorKeyframeTrack,
} from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { propMaterial } from './assets';
import { registerCsmMaterial } from './shadowCsm';

export type CharacterLayer = 'cloth' | 'hide' | 'metal' | 'mail';

const BASE = 'assets/characters/textures';
const loader = new TextureLoader();
const texCache = new Map<string, Texture>();

function tex(set: 'wool' | 'hide', map: 'diff' | 'nor' | 'rough'): Texture {
  const key = `${set}/${map}`;
  let t = texCache.get(key);
  if (t) return t;
  t = loader.load(`${BASE}/${key}.jpg`);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 8;
  if (map === 'diff') t.colorSpace = SRGBColorSpace;
  texCache.set(key, t);
  return t;
}

/** Mean linear albedo of each diffuse map (node tools/assets/fetch-characters.mjs prints them); the
 *  geometry builder multiplies its vertex colours by ≈ 0.9 / albedo so a painted tone lands as painted. */
export const LAYER_GAIN: Record<CharacterLayer, [number, number, number]> = {
  cloth: [4.84, 5.2, 5.66],   // poly_wool_herringbone: neutral grey, linear 0.186/0.173/0.159
  hide: [3.04, 3.18, 4.31],   // leather_white: warm off-white, linear 0.296/0.283/0.209
  metal: [2.54, 3.16, 3.65],  // Metal041B (ambientCG, see tools/assets/albedo.mjs)
  mail: [9.4, 9.2, 8.7],      // Chainmail004
};

const matCache = new Map<CharacterLayer, MeshStandardMaterial>();

function make(set: 'wool' | 'hide', roughness: number, normalScale: number, roughMap: boolean): MeshStandardMaterial {
  const m = new MeshStandardMaterial({
    map: tex(set, 'diff'), normalMap: tex(set, 'nor'), roughnessMap: roughMap ? tex(set, 'rough') : null,
    roughness, metalness: 0, vertexColors: true,
  });
  m.normalScale = new Vector2(normalScale, normalScale);
  m.dispose = () => {};
  registerCsmMaterial(m);
  return m;
}

/** The shared material of one character layer. */
export function characterMaterial(layer: CharacterLayer): MeshStandardMaterial {
  const hit = matCache.get(layer);
  if (hit) return hit;
  let m: MeshStandardMaterial;
  switch (layer) {
    case 'cloth': m = make('wool', 1.0, 1.1, true); break;            // rough map mean 0.70 → matte wool
    case 'hide': m = make('hide', 0.78, 0.7, false); break;           // its rough map is a 0.34 gloss: skin/hair stay matte without it
    case 'metal': m = propMaterial('iron', { roughness: 0.45, metalness: 0.7 }); break;   // same instance models.ts uses
    default: m = propMaterial('chainmail', { roughness: 0.5, metalness: 0.8 }); break;
  }
  matCache.set(layer, m);
  return m;
}

export function disposeCharacterAssets(): void {
  for (const t of texCache.values()) t.dispose();
  texCache.clear();
  for (const [k, m] of matCache) if (k === 'cloth' || k === 'hide') MeshStandardMaterial.prototype.dispose.call(m);
  matCache.clear();
}

// ---------------------------------------------------------------------------------------------
// Mixamo bodies and clips (public/assets/characters/models/*.glb, clips/*.glb — see CREDITS-characters.md)
// ---------------------------------------------------------------------------------------------

/** A loaded character body: the GLTF scene kept as a template (instances are SkeletonUtils clones). */
export interface CharacterModel {
  id: string;
  template: Object3D;
  /** bind-pose bounding box of the template, in the template's own units after its root scale */
  height: number;
  minY: number;
  /** rest position of the Hips bone in the skeleton's (unscaled) units */
  hipRest: Vector3;
  /** clip cache per model: hips translation rescaled to this skeleton, root motion dropped */
  clips: Map<string, AnimationClip | null>;
}

/** Track names in the clip GLBs are `mixamorig:Hips`, the converted bodies carry `mixamorigHips`
 *  (GLTFExporter strips the colon); both collapse to `Hips`, which is also a legal PropertyBinding name. */
export const boneName = (n: string): string => n.replace(/^mixamorig\d*:?/, '').replace(/[:\s]/g, '');

/** Multi-mesh Mixamo FBX files come out of FBXLoader with one full skeleton copy per mesh (identical
 *  hierarchies, identical rest poses, identical names). Animation binds by name and would move only the
 *  first copy, so every SkinnedMesh is rebound to the first skeleton and the copies are dropped. */
function mergeSkeletons(root: Object3D): void {
  const canon = new Map<string, Bone>();
  const extra: Bone[] = [];
  root.traverse((o) => {
    const b = o as Bone;
    if (!b.isBone) return;
    if (!canon.has(b.name)) canon.set(b.name, b); else extra.push(b);
  });
  if (!extra.length) return;
  root.traverse((o) => {
    const m = o as SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    const bones = m.skeleton.bones.map((b) => canon.get(b.name) ?? b);
    m.bind(new Skeleton(bones, m.skeleton.boneInverses), m.bindMatrix);
  });
  // drop the duplicate hierarchies: their roots are extra bones hanging off a non-bone node
  for (const b of extra) if (b.parent && !(b.parent as Bone).isBone) b.parent.remove(b);
}

const modelCache = new Map<string, Promise<CharacterModel | null>>();
const clipCache = new Map<string, Promise<{ clip: AnimationClip; hipY: number } | null>>();

function gltfLoader(): GLTFLoader | null {
  try { return new GLTFLoader(); } catch { return null; }
}

/** Loads a body once. Resolves null (and logs once) when the file is missing or the loader cannot run
 *  here (node tests), which sends the caller to the procedural fallback. */
export function loadCharacterModel(id: string): Promise<CharacterModel | null> {
  const hit = modelCache.get(id);
  if (hit) return hit;
  const p = (async (): Promise<CharacterModel | null> => {
    const loader = gltfLoader();
    if (!loader) return null;
    let gltf: GLTF;
    try { gltf = await loader.loadAsync(`assets/characters/models/${id}.glb`); } catch (e) {
      if (typeof window !== 'undefined') console.warn(`[characters] body ${id}.glb unavailable, procedural fallback:`, (e as Error).message ?? e);
      return null;
    }
    const template = gltf.scene;
    template.traverse((o) => { o.name = boneName(o.name); });
    mergeSkeletons(template);
    template.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) {
        m.castShadow = true; m.receiveShadow = true;
        // skinned: the bind-pose sphere does not follow the animation, so widen it rather than skip culling
        m.geometry.computeBoundingSphere();
        if (m.geometry.boundingSphere) m.geometry.boundingSphere.radius *= 1.8;
        // shared with every instance (SkeletonUtils.clone keeps geometry): exploration disposes an NPC's
        // geometry when it freezes the NPC, which must not free the template
        m.geometry.dispose = () => {};
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
          const s = mat as MeshStandardMaterial;
          if (s.map) { s.map.anisotropy = 4; }
          registerCsmMaterial(s);
        }
      }
    });
    template.updateMatrixWorld(true);
    const box = new Box3().setFromObject(template);
    const hips = template.getObjectByName('Hips');
    return {
      id, template, height: box.max.y - box.min.y, minY: box.min.y,
      hipRest: hips ? hips.position.clone() : new Vector3(0, 100, 0), clips: new Map(),
    };
  })();
  modelCache.set(id, p);
  return p;
}

/** Loads a bones-only Mixamo clip once: quaternion tracks plus the Hips translation, bone names normalised. */
export function loadClip(name: string): Promise<{ clip: AnimationClip; hipY: number } | null> {
  const hit = clipCache.get(name);
  if (hit) return hit;
  const p = (async () => {
    const loader = gltfLoader();
    if (!loader) return null;
    let gltf: GLTF;
    try { gltf = await loader.loadAsync(`assets/characters/clips/${name}.glb`); } catch (e) {
      if (typeof window !== 'undefined') console.warn(`[characters] clip ${name}.glb unavailable:`, (e as Error).message ?? e);
      return null;
    }
    const src = gltf.animations[0];
    if (!src) return null;
    let hipY = 1;
    gltf.scene.traverse((o) => { if (boneName(o.name) === 'Hips') hipY = o.position.y || 1; });
    const tracks = [];
    for (const t of src.tracks) {
      const dot = t.name.lastIndexOf('.');
      const node = boneName(t.name.slice(0, dot)), prop = t.name.slice(dot + 1);
      if (prop === 'quaternion') tracks.push(new QuaternionKeyframeTrack(`${node}.quaternion`, Array.from(t.times), Array.from(t.values)));
      else if (prop === 'position' && node === 'Hips') tracks.push(new VectorKeyframeTrack(`${node}.position`, Array.from(t.times), Array.from(t.values)));
    }
    return { clip: new AnimationClip(name, src.duration, tracks), hipY };
  })();
  clipCache.set(name, p);
  return p;
}

/** The clip retargeted onto one body: Hips translation scaled to that skeleton's hip height with the X/Z
 *  root motion replaced by the rest offset (the owner moves the object; the clip must not). */
export async function modelClip(model: CharacterModel, name: string): Promise<AnimationClip | null> {
  const hit = model.clips.get(name);
  if (hit !== undefined) return hit;
  const raw = await loadClip(name);
  if (!raw) { model.clips.set(name, null); return null; }
  const k = model.hipRest.y / raw.hipY;
  // only bones this body has (Castle Guards have no finger bones): a missing target logs a warning per frame
  const have = new Set<string>();
  model.template.traverse((o) => { if ((o as Bone).isBone) have.add(o.name); });
  const tracks = raw.clip.tracks.filter((t) => have.has(t.name.slice(0, t.name.lastIndexOf('.')))).map((t) => {
    if (!(t instanceof VectorKeyframeTrack)) return t;
    const v = Array.from(t.values);
    for (let i = 0; i < v.length; i += 3) { v[i] = model.hipRest.x; v[i + 1] *= k; v[i + 2] = model.hipRest.z; }
    return new VectorKeyframeTrack(t.name, Array.from(t.times), v);
  });
  const clip = new AnimationClip(name, raw.clip.duration, tracks);
  model.clips.set(name, clip);
  return clip;
}

export function disposeCharacterModels(): void {
  modelCache.clear();
  clipCache.clear();
}
