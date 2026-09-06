/**
 * Downloaded-asset access for the model/character library: the shared CC0 PBR material set
 * (public/assets/textures/props/**, ambientCG + Poly Haven) and the CC0 animation-clip pack
 * (public/assets/characters/rig-medium.anims.bin, KayKit). See public/assets/CREDITS-models.md.
 *
 * Materials are cached per look: `src/exploration/settlements.ts` merges settlement geometry by
 * *material instance*, so the whole built world costs one draw call per material listed here.
 * Every material uses vertex colours for per-building/per-character tinting, which is why the
 * geometry helpers in models.ts/characters.ts always write a `color` attribute.
 */
import {
  BufferGeometry, Float32BufferAttribute, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace, Texture,
  TextureLoader, Vector2,
} from 'three';
import { registerCsmMaterial } from './shadowCsm';

const BASE = 'assets/textures/props';

export type PropTexId =
  | 'wood-log' | 'wood-plank' | 'shingle' | 'stone-block' | 'masonry' | 'drystone' | 'plaster'
  | 'iron' | 'thatch' | 'rock' | 'wool' | 'leather' | 'chainmail'
  /** the MegaKit's round clay tiles (keeps the kit's own UVs) */
  | 'tiles'
  /** a Poly Haven model's own scan maps: `ph-<asset id>[-n]` */
  | `ph-${string}`;

/** Texture sets that do not live directly under BASE/<id>/ . */
function texDir(id: PropTexId): string {
  if (id === 'tiles') return 'megakit/mk-tiles';
  if (id.startsWith('ph-')) return `ph/${id}`;
  return id;
}

const loader = new TextureLoader();
const texCache = new Map<string, Texture>();

// ---------------------------------------------------------------------------------------------
// Texture upload abstraction (Phase 2 B3: KTX2/Basis migration PREP).
//
// Today's loader path is plain JPEG (TextureLoader → sRGB diff, linear nor/rough). The KTX2
// migration keeps this exact call shape — `uploadPropTexture(id, map)` returns a Texture with
// the same repeat/aniso/colorspace contract — and only swaps the *inside* of `loadImageTexture`
// for a KTX2Loader decode (transcoded to BC7/ETC2/ASTC by renderer capability, sRGB vs linear
// internal format chosen by `map` exactly as the colorSpace assignment below does).
//
// TODO (Phase 2.0 completion, integrator): add the `three/addons/loaders/KTX2Loader.js` npm-side
// module (no new npm dep is added here), create one shared KTX2Loader with
// `ktx2.setTranscoderPath('assets/basis/')` + `ktx2.detectSupport(renderer)`, and inside
// `loadImageTexture` below branch: if `HEAD /assets/textures/.../*.ktx2` (or a committed
// manifest flag per texture id) exists, `ktx2.loadAsync(url)` and copy wrap/aniso/colorSpace
// from the JPEG path. Fallback is the JPEG below — every caller keeps working when the .ktx2
// is missing, and no call site changes when it lands.
// ---------------------------------------------------------------------------------------------

/**
 * Single upload point every prop/character texture goes through. `map` selects the colour
 * contract: 'diff' is sRGB albedo; 'nor'/'rough' are linear data (never sRGB, even after the
 * KTX2 swap — the transcoded format must be linear for those two).
 */
export function loadImageTexture(url: string, map: 'diff' | 'nor' | 'rough'): Texture {
  const t = loader.load(url);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 8;   // keep: grazing timber/stone at eye level needs it; 16 streaked along the view ray
  if (map === 'diff') t.colorSpace = SRGBColorSpace;
  // nor/rough intentionally keep the default (NoColorSpace/linear): marking data maps sRGB
  // would double-convert them in the shader and wash out normals / darken roughness.
  return t;
}

/** Loader hook for the KTX2 migration: resolves the URL a texture id/map loads from. */
export function propTextureUrl(id: PropTexId, map: 'diff' | 'nor' | 'rough'): string {
  return `${BASE}/${texDir(id)}/${map}.jpg`;
}

function tex(id: PropTexId, map: 'diff' | 'nor' | 'rough'): Texture {
  const key = `${id}/${map}`;
  let t = texCache.get(key);
  if (t) return t;
  t = loadImageTexture(propTextureUrl(id, map), map);
  texCache.set(key, t);
  return t;
}

export interface PropMatOpts {
  roughness?: number;
  metalness?: number;
  normalScale?: number;
  /** flat tint multiplied on top of the vertex colours */
  color?: number;
  transparent?: boolean;
  /** glTF-convention (+Y) normal maps sampled through the model's own UVs: flip Y like GLTFLoader does */
  glNormal?: boolean;
}

const matCache = new Map<string, MeshStandardMaterial>();

/**
 * §3.5 wet sheen: rain/fog weather lowers roughness and raises env response on every shared prop
 * material (no new materials — the cache keys are unchanged, so merged settlement batches keep one
 * mesh per material). Called from the world stream tick with the sky's wetness; idempotent per value.
 */
let lastWet = -1;
export function applyWetSheen(wetness: number): void {
  const wet = wetness > 0.5;
  if ((wet ? 1 : 0) === lastWet) return;
  lastWet = wet ? 1 : 0;
  for (const m of matCache.values()) {
    try {
      const base = Number(m.userData.baseRoughness ?? NaN);
      if (!Number.isFinite(base)) {
        m.userData.baseRoughness = m.roughness;
        m.userData.baseEnv = m.envMapIntensity;
      }
      const b0 = Number(m.userData.baseRoughness);
      const e0 = Number(m.userData.baseEnv ?? 1);
      m.roughness = wet ? Math.max(0.15, b0 - 0.25) : b0;
      m.envMapIntensity = wet ? e0 + 0.5 : e0;
      m.needsUpdate = false; // uniform-only change: no recompile
    } catch { /* one bad material must not break the frame */ }
  }
}

/** A shared PBR material built from one downloaded ambientCG set. Keyed by look, never per object. */
export function propMaterial(id: PropTexId, opts: PropMatOpts = {}): MeshStandardMaterial {
  const key = `${id}|${opts.roughness ?? ''}|${opts.metalness ?? ''}|${opts.normalScale ?? ''}|${opts.color ?? ''}|${opts.glNormal ? 'gl' : ''}`;
  let m = matCache.get(key);
  if (m) return m;
  m = new MeshStandardMaterial({
    map: tex(id, 'diff'),
    normalMap: tex(id, 'nor'),
    roughnessMap: tex(id, 'rough'),
    roughness: opts.roughness ?? 1,
    metalness: opts.metalness ?? 0,
    color: opts.color ?? 0xffffff,
    vertexColors: true,
  });
  m.normalScale = new Vector2(opts.normalScale ?? 1, (opts.normalScale ?? 1) * (opts.glNormal ? -1 : 1));
  // Shared, cached and long-lived: exploration disposes an NPC's materials when it freezes the NPC
  // (src/exploration/npc.ts), which would otherwise drop the GPU program for every merged building
  // using the same instance. Only disposeAssetCaches() really frees these.
  m.dispose = () => {};
  registerCsmMaterial(m);
  matCache.set(key, m);
  return m;
}

// ---------------------------------------------------------------------------------------------
// Character animation pack (KayKit Rig_Medium, re-packed by tools/assets/fetch.mjs)
// ---------------------------------------------------------------------------------------------

export interface RigBone { name: string; parent: number; t: [number, number, number]; r: [number, number, number, number] }
export interface RigTrack { bone: string; path: 'quaternion' | 'position'; times: Float32Array; values: Float32Array }
export interface RigClip { name: string; duration: number; tracks: RigTrack[] }
export interface RigAnims {
  bones: string[];
  /** source rest-pose world translation per bone */
  bind: Record<string, [number, number, number]>;
  skeleton: RigBone[];
  clips: Map<string, RigClip>;
}

let rigPromise: Promise<RigAnims | null> | null = null;

/** Loads and parses the clip pack once. Resolves null (silently) if the file is missing. */
export function loadRigAnims(): Promise<RigAnims | null> {
  if (rigPromise) return rigPromise;
  rigPromise = (async () => {
    let buf: ArrayBuffer;
    try {
      const res = await fetch('assets/characters/rig-medium.anims.bin');
      if (!res.ok) return null;
      buf = await res.arrayBuffer();
    } catch {
      return null;
    }
    const view = new DataView(buf);
    if (String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)) !== 'EANM') return null;
    const headerLen = view.getUint32(4, true);
    const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, headerLen))) as {
      bones: string[]; bind: Record<string, [number, number, number]>; skeleton: RigBone[];
      clips: { name: string; duration: number; tracks: { bone: string; path: 'quaternion' | 'position'; times: { off: number; len: number }; values: { off: number; len: number } }[] }[];
    };
    // `new Float32Array(buf, off)` requires a 4-aligned offset and the JSON header is arbitrary length,
    // so copy the payload out instead of viewing it in place (one 0.5 MB copy, once).
    const data = new Float32Array(buf.slice(8 + headerLen));
    const clips = new Map<string, RigClip>();
    for (const c of header.clips) {
      clips.set(c.name, {
        name: c.name,
        duration: Math.max(c.duration, 1 / 30),
        tracks: c.tracks.map((t) => ({
          bone: t.bone,
          path: t.path,
          times: data.subarray(t.times.off, t.times.off + t.times.len),
          values: data.subarray(t.values.off, t.values.off + t.values.len),
        })),
      });
    }
    return { bones: header.bones, bind: header.bind, skeleton: header.skeleton, clips };
  })();
  return rigPromise;
}

// ---------------------------------------------------------------------------------------------
// Packed model kits (EKIT, written by tools/assets/fetch.mjs `packKit`): the MegaKit building pieces
// and the Poly Haven prop scans. One header JSON + one float32 payload; each piece is a list of
// indexed parts, one per material id.
// ---------------------------------------------------------------------------------------------

export interface PackedPart { mat: string; geo: BufferGeometry }
export interface PackedPiece { min: [number, number, number]; max: [number, number, number]; tris: number; parts: PackedPart[] }

interface EkitRange { off: number; len: number }
interface EkitHeader {
  pieces: Record<string, { min: [number, number, number]; max: [number, number, number]; tris: number;
    parts: { mat: string; pos: EkitRange; nor: EkitRange; uv: EkitRange; idx: EkitRange }[] }>;
}

/** Parses an EKIT buffer. Geometries come back *non-indexed* (the building kit merges non-indexed
 *  primitives) with position/normal/uv; the caller adds the colour attribute. */
export function parsePackedKit(buf: ArrayBuffer): Map<string, PackedPiece> {
  const view = new DataView(buf);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== 'EKIT') throw new Error('not an EKIT file');
  const headerLen = view.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, headerLen))) as EkitHeader;
  const data = new Float32Array(buf.slice(8 + headerLen));
  const out = new Map<string, PackedPiece>();
  for (const [name, p] of Object.entries(header.pieces)) {
    const parts: PackedPart[] = p.parts.map((part) => {
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(data.subarray(part.pos.off, part.pos.off + part.pos.len), 3));
      g.setAttribute('normal', new Float32BufferAttribute(data.subarray(part.nor.off, part.nor.off + part.nor.len), 3));
      g.setAttribute('uv', new Float32BufferAttribute(data.subarray(part.uv.off, part.uv.off + part.uv.len), 2));
      const idx = data.subarray(part.idx.off, part.idx.off + part.idx.len);
      g.setIndex(Array.from(idx, (v) => v | 0));
      return { mat: part.mat, geo: g.toNonIndexed() };
    });
    out.set(name, { min: p.min, max: p.max, tris: p.tris, parts });
  }
  return out;
}

/** Fetches and parses one packed kit. Resolves null (silently) when the file is missing or there is
 *  no fetch (unit tests): every consumer has a procedural fallback. */
export async function loadPackedKit(url: string): Promise<Map<string, PackedPiece> | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return parsePackedKit(await res.arrayBuffer());
  } catch {
    return null;
  }
}

export function disposeAssetCaches(): void {
  for (const t of texCache.values()) t.dispose();
  texCache.clear();
  for (const m of matCache.values()) MeshStandardMaterial.prototype.dispose.call(m);
  matCache.clear();
  rigPromise = null;
}
