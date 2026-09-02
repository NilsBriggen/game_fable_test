/**
 * Downloaded-asset access for the model/character library: the shared CC0 PBR material set
 * (public/assets/textures/props/**, ambientCG) and the CC0 animation-clip pack
 * (public/assets/characters/rig-medium.anims.bin, KayKit). See public/assets/CREDITS-models.md.
 *
 * Materials are cached per look: `src/exploration/settlements.ts` merges settlement geometry by
 * *material instance*, so the whole built world costs one draw call per material listed here.
 * Every material uses vertex colours for per-building/per-character tinting, which is why the
 * geometry helpers in models.ts/characters.ts always write a `color` attribute.
 */
import {
  MeshStandardMaterial, RepeatWrapping, SRGBColorSpace, Texture, TextureLoader, Vector2,
} from 'three';
import { registerCsmMaterial } from './shadowCsm';

const BASE = 'assets/textures/props';

export type PropTexId =
  | 'wood-log' | 'wood-plank' | 'shingle' | 'stone-block' | 'drystone' | 'plaster'
  | 'iron' | 'thatch' | 'rock' | 'wool' | 'leather' | 'chainmail';

const loader = new TextureLoader();
const texCache = new Map<string, Texture>();

function tex(id: PropTexId, map: 'diff' | 'nor' | 'rough'): Texture {
  const key = `${id}/${map}`;
  let t = texCache.get(key);
  if (t) return t;
  t = loader.load(`${BASE}/${key}.jpg`);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 8;
  if (map === 'diff') t.colorSpace = SRGBColorSpace;
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
}

const matCache = new Map<string, MeshStandardMaterial>();

/** A shared PBR material built from one downloaded ambientCG set. Keyed by look, never per object. */
export function propMaterial(id: PropTexId, opts: PropMatOpts = {}): MeshStandardMaterial {
  const key = `${id}|${opts.roughness ?? ''}|${opts.metalness ?? ''}|${opts.normalScale ?? ''}|${opts.color ?? ''}`;
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
  m.normalScale = new Vector2(opts.normalScale ?? 1, opts.normalScale ?? 1);
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

export function disposeAssetCaches(): void {
  for (const t of texCache.values()) t.dispose();
  texCache.clear();
  for (const m of matCache.values()) MeshStandardMaterial.prototype.dispose.call(m);
  matCache.clear();
  rigPromise = null;
}
