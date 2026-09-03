/**
 * Shared building kit for the model library: materials, geometry primitives, the `Build` accumulator
 * (one merged Mesh per material) and the sub-assemblies every building reuses — shingle roofs laid in
 * real courses, Blockbau log walls notched at the corners, plank doors with strap hinges, shuttered
 * windows with sills, rubble masonry with contiguous ashlar quoins, crenellations, drystone plinths.
 *
 * Everything is authored y-up in metres with the origin **on the ground under the model's footprint**
 * (`src/exploration/settlements.ts` puts that origin on `heightAt`), and every wall that meets the
 * ground carries a buried footing so a downhill spawn never shows daylight under the sill.
 *
 * Materials are the CC0 PBR sets from assets.ts (see public/assets/CREDITS-models.md). Painted tints are
 * multiplied by each map's own albedo, which is dark and hue-shifted, so every tint carries the
 * per-channel gain in `TINT_GAIN` — measured with `node tools/assets/albedo.mjs`.
 */
import {
  BufferGeometry, Euler, Float32BufferAttribute, Group, Matrix4, Mesh, MeshStandardMaterial, Object3D,
  Quaternion, Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { registerCsmMaterial } from '../shadowCsm';
import { propMaterial, type PropTexId } from '../assets';
import { kitPiece } from './megakit';

// ---------------- materials ----------------

export type ProcMatId = 'logs' | 'planks' | 'shingle' | 'ashlar' | 'masonry' | 'drystone' | 'plaster'
  | 'iron' | 'thatch' | 'rock' | 'cloth' | 'fire'
  /** MegaKit round clay tiles (kit UVs + the kit's painted map) */
  | 'tiles'
  /** dark window glass: no map, one shared material */
  | 'glass';
/** `ph-<asset>[-n]`: a Poly Haven scan's own material (megakit.ts). */
export type MatId = ProcMatId | `ph-${string}`;

/** id → (texture set, fixed PBR opts). Fixed so every caller lands on the same cached instance. */
const MAT_SPEC: Record<Exclude<ProcMatId, 'fire' | 'glass'>, [PropTexId, { roughness?: number; metalness?: number; normalScale?: number; glNormal?: boolean }]> = {
  logs: ['wood-log', { roughness: 0.92, normalScale: 1.1 }],
  planks: ['wood-plank', { roughness: 0.9 }],
  shingle: ['shingle', { roughness: 0.88, normalScale: 1.35 }],
  ashlar: ['stone-block', { roughness: 0.95 }],
  masonry: ['masonry', { roughness: 0.97, normalScale: 1.25 }],
  drystone: ['drystone', { roughness: 1, normalScale: 1.3 }],
  plaster: ['plaster', { roughness: 0.88 }],
  iron: ['iron', { roughness: 0.45, metalness: 0.7 }],
  thatch: ['thatch', { roughness: 1, normalScale: 1.2 }],
  rock: ['rock', { roughness: 0.95, normalScale: 1.2 }],
  cloth: ['wool', { roughness: 0.95 }],
  tiles: ['tiles', { roughness: 0.9, normalScale: 0.9, glNormal: true }],
};

let fireMaterial: MeshStandardMaterial | null = null;
let glassMaterial: MeshStandardMaterial | null = null;
export function propMat(id: MatId): MeshStandardMaterial {
  if (id === 'fire') {
    if (!fireMaterial) {
      fireMaterial = new MeshStandardMaterial({ color: 0xff9a3c, emissive: 0xff5a10, emissiveIntensity: 2.2, roughness: 0.6 });
      registerCsmMaterial(fireMaterial);
    }
    return fireMaterial;
  }
  if (id === 'glass') {
    if (!glassMaterial) {
      glassMaterial = new MeshStandardMaterial({ color: 0x1a2028, roughness: 0.25, metalness: 0.4, vertexColors: true });
      registerCsmMaterial(glassMaterial);
    }
    return glassMaterial;
  }
  if (id.startsWith('ph-')) return propMaterial(id as PropTexId, { roughness: 1, glNormal: true });
  const [tex, opts] = MAT_SPEC[id as Exclude<ProcMatId, 'fire' | 'glass'>];
  return propMaterial(tex, opts);
}

export function disposeKitCaches(): void {
  fireMaterial?.dispose();
  fireMaterial = null;
  glassMaterial?.dispose();
  glassMaterial = null;
}

/** Texture repeat length in metres per material (bigger = coarser grain). Chosen so a course of the
 *  mapped stone/shingle reads at its real size: masonry ~0.25 m stones, ashlar ~0.35 m blocks,
 *  shingle ~0.12 m slates. */
const UV_METRES: Record<ProcMatId, number> = {
  logs: 1.6, planks: 1.2, shingle: 1.5, ashlar: 1.7, masonry: 2.6, drystone: 1.8, plaster: 2.4,
  iron: 0.6, thatch: 1.4, rock: 1.6, cloth: 0.8, fire: 1, tiles: 1, glass: 1,
};

/** Per-material gain on the vertex tint. `map * vColor` is unclamped and the CC0 albedos are far darker
 *  than they look in sRGB, so a painted tone only lands where it was authored if it is multiplied by
 *  ≈ 0.8 / meanLinearAlbedo. Measure with `node tools/assets/albedo.mjs`; rock is capped rather than the
 *  80× its near-black map would ask for. The kit's painted tiles and the Poly Haven scans are authored
 *  at their final brightness: gain 1 (`GAIN_ONE`). */
const TINT_GAIN: Record<ProcMatId, [number, number, number]> = {
  logs: [7.1, 12.3, 19.5], planks: [10.7, 22.9, 27.6], shingle: [2.93, 3.45, 4.59],
  ashlar: [3.46, 3.47, 3.51], masonry: [3.40, 4.49, 6.61],
  drystone: [4.2, 5.4, 8.3], plaster: [1.20, 1.24, 1.28],
  iron: [2.54, 3.16, 3.65], thatch: [5.3, 6.8, 9.4], rock: [25, 18, 15], cloth: [0.93, 0.93, 0.93],
  fire: [1, 1, 1], tiles: [1, 1, 1], glass: [1, 1, 1],
};
const GAIN_ONE: [number, number, number] = [1, 1, 1];
const gainOf = (m: MatId): [number, number, number] => (m.startsWith('ph-') ? GAIN_ONE : TINT_GAIN[m as ProcMatId]);
const uvMetresOf = (m: MatId): number => (m.startsWith('ph-') ? 1 : UV_METRES[m as ProcMatId]);

function setColor(geo: BufferGeometry, hex: number, gain: [number, number, number] = [1, 1, 1]): void {
  const n = geo.attributes.position.count;
  const c = new Float32Array(n * 3);
  const r = ((hex >> 16) & 255) / 255, g = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255;
  // sRGB → linear, to match the renderer's colour space (materials sample sRGB maps)
  const lin = (v: number) => (v < 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const lr = lin(r) * gain[0], lg = lin(g) * gain[1], lb = lin(b) * gain[2];
  for (let i = 0; i < n; i++) { c[i * 3] = lr; c[i * 3 + 1] = lg; c[i * 3 + 2] = lb; }
  geo.setAttribute('color', new Float32BufferAttribute(c, 3));
}

/** Triplanar-ish UV projection in the model's own space: the dominant normal axis picks the plane, so
 *  texel density is constant across a model whatever the primitive's own UV layout was. */
function boxUv(geo: BufferGeometry, metres: number, swap = false): void {
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  const s = 1 / metres;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i));
    let u: number, v: number;
    if (ny >= nx && ny >= nz) { u = x * s; v = z * s; }
    else if (nx >= nz) { u = z * s; v = y * s; }
    else { u = x * s; v = y * s; }
    if (swap) { const t = u; u = v; v = t; }
    uv[i * 2] = u; uv[i * 2 + 1] = v;
  }
  geo.setAttribute('uv', new Float32BufferAttribute(uv, 2));
}

// ---------------- primitives ----------------

export type XYZ = [number, number, number];

/** Non-indexed primitive helpers. Everything is authored y-up, metres. */
function quad(out: number[], a: Vector3, b: Vector3, c: Vector3, d: Vector3): void {
  for (const [p, q, r] of [[a, b, c], [a, c, d]] as [Vector3, Vector3, Vector3][]) out.push(p.x, p.y, p.z, q.x, q.y, q.z, r.x, r.y, r.z);
}

function fromPositions(pos: number[]): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

export function boxGeo(w: number, h: number, d: number): BufferGeometry {
  const p: number[] = [];
  const v = (x: number, y: number, z: number) => new Vector3(x * w / 2, y * h / 2, z * d / 2);
  quad(p, v(-1, -1, 1), v(1, -1, 1), v(1, 1, 1), v(-1, 1, 1));      // +z
  quad(p, v(1, -1, -1), v(-1, -1, -1), v(-1, 1, -1), v(1, 1, -1));  // -z
  quad(p, v(1, -1, 1), v(1, -1, -1), v(1, 1, -1), v(1, 1, 1));      // +x
  quad(p, v(-1, -1, -1), v(-1, -1, 1), v(-1, 1, 1), v(-1, 1, -1));  // -x
  quad(p, v(-1, 1, 1), v(1, 1, 1), v(1, 1, -1), v(-1, 1, -1));      // +y
  quad(p, v(-1, -1, -1), v(1, -1, -1), v(1, -1, 1), v(-1, -1, 1));  // -y
  return fromPositions(p);
}

/** A box with no bottom or back face — half the triangles, used for roof courses and cladding boards
 *  whose hidden faces are inside the roof/wall anyway. */
export function slabGeo(w: number, h: number, d: number): BufferGeometry {
  const p: number[] = [];
  const v = (x: number, y: number, z: number) => new Vector3(x * w / 2, y * h / 2, z * d / 2);
  quad(p, v(-1, -1, 1), v(1, -1, 1), v(1, 1, 1), v(-1, 1, 1));      // +z (the exposed lip)
  quad(p, v(1, -1, 1), v(1, -1, -1), v(1, 1, -1), v(1, 1, 1));      // +x
  quad(p, v(-1, -1, -1), v(-1, -1, 1), v(-1, 1, 1), v(-1, 1, -1));  // -x
  quad(p, v(-1, 1, 1), v(1, 1, 1), v(1, 1, -1), v(-1, 1, -1));      // +y
  return fromPositions(p);
}

export function cylGeo(rTop: number, rBot: number, h: number, seg = 8, caps = true): BufferGeometry {
  const p: number[] = [];
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const b0 = new Vector3(Math.cos(a0) * rBot, -h / 2, Math.sin(a0) * rBot);
    const b1 = new Vector3(Math.cos(a1) * rBot, -h / 2, Math.sin(a1) * rBot);
    const t0 = new Vector3(Math.cos(a0) * rTop, h / 2, Math.sin(a0) * rTop);
    const t1 = new Vector3(Math.cos(a1) * rTop, h / 2, Math.sin(a1) * rTop);
    quad(p, b0, t0, t1, b1);
    if (caps) {
      const cT = new Vector3(0, h / 2, 0), cB = new Vector3(0, -h / 2, 0);
      p.push(cT.x, cT.y, cT.z, t1.x, t1.y, t1.z, t0.x, t0.y, t0.z);
      p.push(cB.x, cB.y, cB.z, b0.x, b0.y, b0.z, b1.x, b1.y, b1.z);
    }
  }
  return fromPositions(p);
}

/** Triangular prism: apex on +y at the centre, extruded along z. Gable ends, roof wedges. */
export function wedgeGeo(w: number, h: number, d: number): BufferGeometry {
  const p: number[] = [];
  const A = new Vector3(-w / 2, 0, d / 2), B = new Vector3(w / 2, 0, d / 2), C = new Vector3(0, h, d / 2);
  const A2 = new Vector3(-w / 2, 0, -d / 2), B2 = new Vector3(w / 2, 0, -d / 2), C2 = new Vector3(0, h, -d / 2);
  p.push(A.x, A.y, A.z, B.x, B.y, B.z, C.x, C.y, C.z);
  p.push(B2.x, B2.y, B2.z, A2.x, A2.y, A2.z, C2.x, C2.y, C2.z);
  quad(p, A2, A, C, C2);
  quad(p, B, B2, C2, C);
  quad(p, A2, B2, B, A);
  return fromPositions(p);
}

/** Deformed icosphere-ish boulder (seeded), used for rocks, roof weights and rubble. */
export function blobGeo(r: number, seed: number, squash = 0.8, seg = 8): BufferGeometry {
  const rings = Math.max(3, Math.round(seg * 0.55));
  const rnd = (i: number) => {
    const s = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
    return s - Math.floor(s);
  };
  const grid: Vector3[][] = [];
  for (let j = 0; j <= rings; j++) {
    const phi = (j / rings) * Math.PI;
    const row: Vector3[] = [];
    for (let i = 0; i <= seg; i++) {
      const th = (i / seg) * Math.PI * 2;
      const k = 0.72 + rnd(j * 31 + (i % seg)) * 0.56;
      row.push(new Vector3(Math.sin(phi) * Math.cos(th) * r * k, Math.cos(phi) * r * k * squash, Math.sin(phi) * Math.sin(th) * r * k));
    }
    grid.push(row);
  }
  const p: number[] = [];
  for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) quad(p, grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]);
  return fromPositions(p);
}

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();

export class Build {
  private parts = new Map<MatId, BufferGeometry[]>();

  /** `swapUv` exchanges u and v: a roof slab's dominant normal is +y, so its default projection lays
   *  the shingle courses down the slope instead of along the ridge. */
  add(mat: MatId, geo: BufferGeometry, color: number, at: XYZ = [0, 0, 0], rot?: XYZ, scale?: XYZ, order: 'XYZ' | 'YXZ' = 'XYZ', swapUv = false, keepUv = false): this {
    _e.set(rot?.[0] ?? 0, rot?.[1] ?? 0, rot?.[2] ?? 0, order);
    _q.setFromEuler(_e);
    _m.compose(new Vector3(at[0], at[1], at[2]), _q, new Vector3(scale?.[0] ?? 1, scale?.[1] ?? 1, scale?.[2] ?? 1));
    geo.applyMatrix4(_m);
    setColor(geo, color, gainOf(mat));
    if (!keepUv) boxUv(geo, uvMetresOf(mat), swapUv);
    let list = this.parts.get(mat);
    if (!list) { list = []; this.parts.set(mat, list); }
    list.push(geo);
    return this;
  }

  /**
   * A MegaKit piece (megakit.ts) at `at`, yawed/rotated/scaled like any primitive. `tones` maps the
   * piece's material ids (plaster, planks, masonry, ashlar, tiles, glass) to a tint; a material not in
   * `tones` gets the shared default tone for it. Parts are re-projected with the world-scale box UVs of
   * our own PBR set (so a kit wall and a procedural wall share one texture and one draw call); the tile
   * roof keeps the kit's UVs. Returns false (and draws nothing) when the kit is not loaded.
   */
  piece(name: string, tones: Partial<Record<string, number>>, at: XYZ = [0, 0, 0], rot?: XYZ, scale?: XYZ, order: 'XYZ' | 'YXZ' = 'XYZ'): boolean {
    const p = kitPiece(name);
    if (!p) return false;
    for (const part of p.parts) {
      const mat = part.mat as MatId;
      if (mat === 'glass' && tones.glass === undefined) continue;   // window glass off unless asked for
      const tone = tones[mat] ?? KIT_DEFAULT_TONE[mat] ?? 0xffffff;
      this.add(mat, part.geo.clone(), tone, at, rot, scale, order, false, mat === 'tiles');
    }
    return true;
  }

  /**
   * A Poly Haven prop scan (megakit.ts PROP_IDS) standing on `at` (its lowest point is put on y = 0
   * before the transform, so `at[1]` is the ground/floor it rests on). Own maps, own UVs, tint 1.
   * Returns false when that prop is not loaded, so the caller can draw its procedural stand-in.
   */
  prop(id: string, at: XYZ = [0, 0, 0], rot?: XYZ, scale = 1, order: 'XYZ' | 'YXZ' = 'XYZ'): boolean {
    const p = kitPiece(id);
    if (!p) return false;
    for (const part of p.parts) {
      const g = part.geo.clone();
      g.translate(0, -p.min[1], 0);
      this.add(part.mat as MatId, g, 0xffffff, at, rot, [scale, scale, scale], order, false, true);
    }
    return true;
  }

  box(mat: MatId, color: number, size: XYZ, at: XYZ, rot?: XYZ): this {
    return this.add(mat, boxGeo(size[0], size[1], size[2]), color, at, rot);
  }
  /** Box without its bottom/back faces (roof courses, cladding): same look, 4 triangles instead of 12. */
  slab(mat: MatId, color: number, size: XYZ, at: XYZ, rot?: XYZ, order: 'XYZ' | 'YXZ' = 'XYZ', swapUv = false): this {
    return this.add(mat, slabGeo(size[0], size[1], size[2]), color, at, rot, undefined, order, swapUv);
  }
  cyl(mat: MatId, color: number, rTop: number, rBot: number, h: number, at: XYZ, rot?: XYZ, seg = 8, caps = true): this {
    return this.add(mat, cylGeo(rTop, rBot, h, seg, caps), color, at, rot);
  }
  wedge(mat: MatId, color: number, size: XYZ, at: XYZ, rot?: XYZ): this {
    return this.add(mat, wedgeGeo(size[0], size[1], size[2]), color, at, rot);
  }
  blob(mat: MatId, color: number, r: number, at: XYZ, seed: number, squash = 0.8, seg = 8): this {
    return this.add(mat, blobGeo(r, seed, squash, seg), color, at);
  }

  /** Emits one merged Mesh per material. `extra` children (e.g. the toggleable gallows hat) are added last. */
  emit(name: string, extra?: Object3D[]): Group {
    const g = new Group();
    g.name = name;
    for (const [mat, geos] of this.parts) {
      if (!geos.length) continue;
      const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
      if (!merged) continue;
      const m = new Mesh(merged, propMat(mat));
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    }
    if (extra) for (const e of extra) g.add(e);
    return g;
  }

  /** Emits into an existing group without a new Group wrapper (sub-assemblies). */
  meshes(): Mesh[] {
    return this.emit('tmp').children.filter((c): c is Mesh => (c as Mesh).isMesh === true);
  }
}

// ---------------- shared tones ----------------

export const SHINGLE_TONE = 0x9c9488;
export const SHINGLE_DARK = 0x6f6a60;
export const LOG_TONE = 0x9c8156;
export const PLANK_TONE = 0x8d7247;
export const PLANK_DARK = 0x5d4a2e;
export const TIMBER_DARK = 0x4a3a24;
export const STONE_TONE = 0x9a958c;
export const MASONRY_TONE = 0x938d80;
export const DRY_TONE = 0x8e8a80;
export const PLASTER_TONE = 0xd8d0bc;
export const IRON_TONE = 0x8e9298;
export const THATCH_TONE = 0xc4a463;
export const WEIGHT_TONE = 0x8f8b82;
/** Kit tile roofs are tinted down from the painted orange toward weathered terracotta. */
export const TILE_TONE = 0x9a7a66;

/** Default tint per kit material id when `Build.piece` is not told otherwise. */
const KIT_DEFAULT_TONE: Partial<Record<string, number>> = {
  plaster: PLASTER_TONE, planks: PLANK_DARK, masonry: MASONRY_TONE, ashlar: STONE_TONE, tiles: TILE_TONE, glass: 0xffffff,
};

// ---------------- roofs ----------------

export interface RoofOpts {
  /** eaves overhang beyond the wall face (Alpine roofs are deep) */
  overhang?: number;
  /** stones weighing the shingles down (only meaningful on a shingle roof) */
  weights?: boolean;
  mat?: MatId;
  tone?: number;
  /** xz offset of the roof's centre */
  at?: [number, number];
  /** purlins protruding past the gable ends */
  purlins?: boolean;
  /** barge boards along the gable rake */
  barge?: boolean;
  /** course pitch along the slope; 0.4 m is a shingle course, 0.9 m a stone slab */
  course?: number;
}

/**
 * Shingled gable roof laid in real courses: each course is a slab whose lower lip overhangs the course
 * below, so the eaves and the rake read as a stack of shingles rather than one flat plane. Adds a ridge
 * cap, eaves fascia, protruding purlins and — the Alpine signature — stones weighing the shingles down.
 * `w` is the span across the slopes, `d` the length along the ridge, `rise` the height of the ridge over
 * the eaves, `y` the eaves level.
 */
export function gableRoof(b: Build, w: number, d: number, rise: number, y: number, opts: RoofOpts = {}): void {
  const [ox, oz] = opts.at ?? [0, 0];
  const oh = opts.overhang ?? 0.7;
  const mat = opts.mat ?? 'shingle';
  const tone = opts.tone ?? (mat === 'thatch' ? THATCH_TONE : SHINGLE_TONE);
  const halfW = w / 2 + oh;
  const slope = Math.hypot(halfW, rise);
  const ang = Math.atan2(rise, halfW);
  const dz = d + oh * 1.4;
  const pitchStep = opts.course ?? 0.42;
  const n = Math.max(3, Math.round(slope / pitchStep));
  const len = slope / n;

  if (mat === 'thatch') {
    // thatch is one thick continuous mat, not courses
    for (const s of [-1, 1]) {
      b.box(mat, tone, [slope, 0.3, dz], [ox + s * halfW / 2, y + rise / 2, oz], [0, 0, -s * ang]);
    }
    b.cyl('thatch', tone, 0.22, 0.22, dz, [ox, y + rise + 0.02, oz], [Math.PI / 2, 0, 0], 6);
  } else {
    const nx = Math.sin(ang), ny = Math.cos(ang);          // roof-plane normal in the x/y plane
    for (const s of [-1, 1]) {
      for (let i = 0; i < n; i++) {
        // t = 0 at the eaves, 1 at the ridge; each course overlaps the one below by ~40 %
        const t = (i + 0.5) / n;
        const x = ox + s * halfW * (1 - t);
        const yy = y + rise * t;
        const shade = i % 2 === 0 ? tone : mixTone(tone, SHINGLE_DARK, 0.35);
        b.slab(mat, shade, [len * 1.42, 0.075, dz], [x, yy + 0.035, oz], [0, 0, -s * ang], 'XYZ', true);
        // the exposed butt of the course, standing proud of the one below: this is the horizontal
        // shadow line every 0.4 m that makes a roof read as shingles instead of a painted plane
        const bx = ox + s * halfW * (1 - i / n), by = y + rise * (i / n);
        b.slab(mat, mixTone(shade, SHINGLE_DARK, 0.3), [0.13, 0.07, dz], [bx + s * nx * 0.06, by + ny * 0.06 + 0.035, oz], [0, 0, -s * ang], 'XYZ', true);
      }
      // sarking board under the courses, so the underside of the eaves is solid timber, not a gap
      b.box('planks', PLANK_DARK, [slope, 0.06, dz], [ox + s * halfW / 2, y + rise / 2 - 0.06, oz], [0, 0, -s * ang]);
      // eaves fascia
      b.box('planks', PLANK_DARK, [0.09, 0.2, dz], [ox + s * halfW, y - 0.02, oz]);
    }
    // ridge: two capping boards leaning against each other + the ridge beam under them
    for (const s of [-1, 1]) b.slab(mat, mixTone(tone, SHINGLE_DARK, 0.5), [0.42, 0.08, dz + 0.06], [ox + s * 0.13, y + rise + 0.09, oz], [0, 0, -s * 0.9], 'XYZ', true);
    b.cyl('planks', PLANK_DARK, 0.1, 0.1, dz + 0.16, [ox, y + rise - 0.04, oz], [Math.PI / 2, 0, 0], 6);
  }

  if (opts.purlins !== false) {
    for (const s of [-1, 1]) for (const t of [0.34, 0.7]) {
      b.cyl('planks', PLANK_DARK, 0.075, 0.075, dz + 0.24, [ox + s * halfW * (1 - t), y + rise * t - 0.1, oz], [Math.PI / 2, 0, 0], 5);
    }
  }
  if (opts.barge !== false) {
    // barge boards along both rakes of both gables — the strongest silhouette line on an Alpine roof
    for (const sz of [-1, 1]) for (const s of [-1, 1]) {
      b.box('planks', PLANK_DARK, [slope, 0.17, 0.07], [ox + s * halfW / 2, y + rise / 2 + 0.1, oz + sz * (dz / 2 + 0.04)], [0, 0, -s * ang]);
    }
  }
  if (opts.weights !== false && mat === 'shingle') {
    for (let i = 0; i < 5; i++) {
      const tz = (i + 0.5) / 5;
      const zz = -dz / 2 + tz * dz;
      for (const s of [-1, 1]) {
        const u = 0.30 + ((i * 7) % 4) * 0.14;
        b.blob('drystone', WEIGHT_TONE, 0.3, [ox + s * halfW * (1 - u), y + rise * u + 0.1, oz + zz], i * 3 + s, 0.3, 6);
      }
    }
  }
}

/** Half-way between two packed sRGB tones. */
export function mixTone(a: number, b: number, t: number): number {
  const r = Math.round(((a >> 16) & 255) * (1 - t) + ((b >> 16) & 255) * t);
  const g = Math.round(((a >> 8) & 255) * (1 - t) + ((b >> 8) & 255) * t);
  const bl = Math.round((a & 255) * (1 - t) + (b & 255) * t);
  return (r << 16) | (g << 8) | bl;
}

/** Hipped/pyramid roof in courses, for towers, wells and market stalls. `sides` = 4 (pyramid) or more. */
export function pyramidRoof(b: Build, r: number, h: number, y: number, at: XYZ = [0, 0, 0], sides = 4, tone = SHINGLE_TONE, yaw = Math.PI / 4): void {
  const n = Math.max(3, Math.round(Math.hypot(r, h) / 0.45));
  for (let i = 0; i < n; i++) {
    const t = i / n, t1 = (i + 1) / n;
    const shade = i % 2 === 0 ? tone : mixTone(tone, SHINGLE_DARK, 0.35);
    b.add('shingle', cylGeo(r * (1 - t1) * 1.02, r * (1 - t) * 1.06, h / n + 0.05, sides, false), shade,
      [at[0], y + h * t + h / (2 * n), at[2]], [0, yaw, 0]);
  }
  b.cyl('shingle', mixTone(tone, SHINGLE_DARK, 0.5), 0.06, 0.14, 0.24, [at[0], y + h + 0.05, at[2]], undefined, 5);
}

/** Small helper so a range at an arbitrary yaw (cloister walks) can carry a courses roof. */
export function gableRoofRotated(b: Build, w: number, d: number, rise: number, y: number, x: number, z: number, yaw: number): void {
  const halfW = d / 2 + 0.4;
  const slope = Math.hypot(halfW, rise);
  const ang = Math.atan2(rise, halfW);
  const n = Math.max(2, Math.round(slope / 0.5));
  for (const s of [-1, 1]) {
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const rr = halfW * (1 - t);
      const ox = x + Math.sin(yaw + Math.PI / 2) * s * rr, oz = z + Math.cos(yaw + Math.PI / 2) * s * rr;
      const shade = i % 2 === 0 ? SHINGLE_TONE : SHINGLE_DARK;
      // YXZ: yaw the range first, then tilt the slab in its own frame
      b.add('shingle', slabGeo(w, 0.09, (slope / n) * 1.4), shade, [ox, y + rise * t + 0.04, oz], [s * ang, yaw, 0], undefined, 'YXZ');
    }
  }
}

// ---------------- openings ----------------

/**
 * A window: a recessed dark opening, a timber frame all round with a sill that sticks out, and (by
 * default) two board shutters folded flat against the wall on iron strap hinges.
 * `facing` is the wall normal axis; (x, y, z) is the centre of the opening on the wall face.
 */
export function windowOpening(b: Build, x: number, y: number, z: number, w = 0.55, h = 0.7,
  facing: 'z' | 'x' = 'z', opts: { shutters?: boolean; frame?: MatId; tone?: number; sign?: number } = {}): void {
  const rot: XYZ | undefined = facing === 'x' ? [0, Math.PI / 2, 0] : undefined;
  const sgn = opts.sign ?? 1;                       // which way the wall faces (+1 = +z / +x)
  const out = (t: number): XYZ => (facing === 'z' ? [x, y, z + t * sgn] : [x + t * sgn, y, z]);
  const side = (t: number, yy: number): XYZ => (facing === 'z' ? [x + t, yy, z + 0.02 * sgn] : [x + 0.02 * sgn, yy, z + t]);
  const frameMat = opts.frame ?? 'planks';
  const frameTone = opts.tone ?? PLANK_DARK;
  // recess: a dark box set back into the wall
  b.box('planks', 0x14110c, [w, h, 0.22], out(-0.10), rot);
  // frame: jambs, head, sill
  for (const s of [-1, 1]) b.box(frameMat, frameTone, [0.1, h + 0.2, 0.16], side(s * (w / 2 + 0.05), y), rot);
  b.box(frameMat, frameTone, [w + 0.2, 0.11, 0.18], out(0.02), rot);
  b.box(frameMat, frameTone, [w + 0.2, 0.11, 0.18], side(0, y + h / 2 + 0.05), rot);
  b.box(frameMat, mixTone(frameTone, 0xffffff, 0.15), [w + 0.34, 0.1, 0.26], side(0, y - h / 2 - 0.06), rot);   // sill, proud of the wall
  if (opts.shutters !== false) {
    for (const s of [-1, 1]) {
      const off = (w / 2 + 0.17) * s;
      const p: XYZ = facing === 'z' ? [x + off, y, z + 0.06 * sgn] : [x + 0.06 * sgn, y, z + off];
      b.box('planks', 0x6b5638, [0.3, h * 0.98, 0.05], p, rot);
      for (const hy of [y - h * 0.32, y + h * 0.32]) {
        const hp: XYZ = facing === 'z' ? [x + off * 0.72, hy, z + 0.10 * sgn] : [x + 0.10 * sgn, hy, z + off * 0.72];
        b.box('iron', IRON_TONE, [0.34, 0.05, 0.02], hp, rot);
      }
    }
  }
}

/** A narrow round-headed opening (church nave, belfry, chapel) with dressed voussoirs over it. */
export function archedOpening(b: Build, x: number, y: number, z: number, w: number, h: number,
  facing: 'z' | 'x', sign: number, tone = STONE_TONE): void {
  const rot: XYZ | undefined = facing === 'x' ? [0, Math.PI / 2, 0] : undefined;
  const at = (t: number, dx: number, dy: number): XYZ => (facing === 'z' ? [x + dx, y + dy, z + t * sign] : [x + t * sign, y + dy, z + dx]);
  b.box('planks', 0x100d09, [w, h, 0.3], at(-0.14, 0, 0), rot);                       // dark splayed reveal
  for (const s of [-1, 1]) b.box('ashlar', tone, [0.16, h + 0.1, 0.26], at(0.0, s * (w / 2 + 0.08), 0), rot);
  b.box('ashlar', tone, [w + 0.32, 0.14, 0.28], at(0.0, 0, -h / 2 - 0.07), rot);       // sill
  // voussoirs around the head
  const R = w / 2 + 0.08;
  for (let i = 0; i < 5; i++) {
    const a = Math.PI * (0.08 + (i / 4) * 0.84);
    b.box('ashlar', i % 2 ? tone : mixTone(tone, 0x000000, 0.12), [0.2, 0.24, 0.28],
      at(0.0, Math.cos(a) * R, h / 2 + Math.sin(a) * R * 0.62), facing === 'x' ? [0, Math.PI / 2, a - Math.PI / 2] : [0, 0, a - Math.PI / 2]);
  }
}

/**
 * A door: a stone or timber surround, a leaf of vertical boards with a visible gap between them, two
 * iron strap hinges, a ring handle and a threshold stone. `y` is the ground level at the wall.
 */
export function doorway(b: Build, x: number, y: number, z: number, w = 1.05, h = 2.0, facing: 'z' | 'x' = 'z',
  opts: { frame?: MatId; tone?: number; sign?: number; arched?: boolean } = {}): void {
  const rot: XYZ | undefined = facing === 'x' ? [0, Math.PI / 2, 0] : undefined;
  const sgn = opts.sign ?? 1;
  const at = (t: number, dx: number, yy: number): XYZ => (facing === 'z' ? [x + dx, yy, z + t * sgn] : [x + t * sgn, yy, z + dx]);
  const frameMat = opts.frame ?? 'planks';
  const frameTone = opts.tone ?? TIMBER_DARK;
  b.box('planks', 0x0e0c09, [w, h, 0.2], at(-0.1, 0, y + h / 2), rot);                 // opening
  // leaf: vertical boards, each its own plank so the joints read
  const boards = Math.max(3, Math.round(w / 0.28));
  for (let i = 0; i < boards; i++) {
    const bx = -w / 2 + ((i + 0.5) / boards) * w;
    b.box('planks', i % 2 ? 0x5a4629 : 0x4d3c23, [w / boards - 0.025, h - 0.04, 0.07], at(0.0, bx, y + h / 2), rot);
  }
  for (const hy of [y + h * 0.22, y + h * 0.78]) {
    b.box('iron', IRON_TONE, [w * 0.86, 0.07, 0.03], at(0.05, 0, hy), rot);            // strap hinges
    b.box('iron', mixTone(IRON_TONE, 0x000000, 0.2), [0.1, 0.14, 0.05], at(0.05, -w / 2 + 0.06, hy), rot);
  }
  b.cyl('iron', IRON_TONE, 0.055, 0.055, 0.035, at(0.09, w * 0.30, y + h * 0.5), facing === 'z' ? [Math.PI / 2, 0, 0] : [0, 0, Math.PI / 2], 8, false);
  // surround
  for (const s of [-1, 1]) b.box(frameMat, frameTone, [0.16, h + 0.16, 0.2], at(0.02, s * (w / 2 + 0.08), y + h / 2), rot);
  if (opts.arched) {
    const R = w / 2 + 0.08;
    for (let i = 0; i < 5; i++) {
      const a = Math.PI * (0.08 + (i / 4) * 0.84);
      b.box(frameMat, frameTone, [0.2, 0.26, 0.22], at(0.02, Math.cos(a) * R, y + h + Math.sin(a) * R * 0.55),
        facing === 'x' ? [0, Math.PI / 2, a - Math.PI / 2] : [0, 0, a - Math.PI / 2]);
    }
  } else {
    b.box(frameMat, frameTone, [w + 0.4, 0.2, 0.22], at(0.02, 0, y + h + 0.09), rot);  // lintel
  }
  b.box('drystone', mixTone(DRY_TONE, 0xffffff, 0.1), [w + 0.3, 0.13, 0.5], at(0.16, 0, y + 0.06), rot);   // threshold
}

// ---------------- walls ----------------

/**
 * Blockbau log walls. Every course carries all four walls — the two running along x sit half a course
 * below the two running along z, so the round log ends cross over each other at the corners the way a
 * notched (verkämmt) corner does, and no elevation shows the gap-toothed banding a two-wall course does.
 */
export function logWalls(b: Build, w: number, d: number, h: number, y0: number, courseH = 0.27, tone0 = LOG_TONE): void {
  const courses = Math.max(5, Math.round(h / courseH));
  const ch = h / courses;
  const r = ch * 0.56;
  const ext = 0.34;                                  // protruding log ends at the corners
  for (let i = 0; i < courses; i++) {
    const tone = i % 2 === 0 ? tone0 : mixTone(tone0, 0x6f5a3a, 0.4);
    const yx = y0 + ch * (i + 0.5);
    const yz = y0 + ch * (i + 1.0);
    for (const s of [-1, 1]) b.cyl('logs', tone, r, r * 0.96, w + ext * 2, [0, yx, s * (d / 2 - r * 0.4)], [0, 0, Math.PI / 2], 6);
    if (yz + r < y0 + h) {
      for (const s of [-1, 1]) b.cyl('logs', mixTone(tone, 0xffffff, 0.08), r, r * 0.96, d + ext * 2, [s * (w / 2 - r * 0.4), yz, 0], [Math.PI / 2, 0, 0], 6);
    }
  }
  // chinked interior plane, so the gaps between logs are never see-through
  b.box('planks', 0x3d3020, [w - 0.16, h, d - 0.16], [0, y0 + h / 2, 0]);
  // sill beam on the plinth and a wall plate under the eaves
  for (const s of [-1, 1]) {
    b.box('logs', mixTone(tone0, 0x000000, 0.25), [w + ext * 2, 0.16, 0.2], [0, y0 + 0.06, s * (d / 2 + 0.02)]);
    b.box('logs', mixTone(tone0, 0x000000, 0.25), [w + ext * 2, 0.16, 0.2], [0, y0 + h - 0.06, s * (d / 2 + 0.02)]);
  }
}

/** Vertical board cladding (barns, gable storeys, granaries) with visible joints and battens. */
export function boardWall(b: Build, w: number, h: number, y0: number, z: number, facing: 'z' | 'x' = 'z',
  tone = PLANK_TONE, boardW = 0.3): void {
  const n = Math.max(3, Math.round(w / boardW));
  const rot: XYZ | undefined = facing === 'x' ? [0, Math.PI / 2, 0] : undefined;
  for (let i = 0; i < n; i++) {
    const t = -w / 2 + ((i + 0.5) / n) * w;
    const shade = i % 3 === 0 ? mixTone(tone, PLANK_DARK, 0.45) : i % 3 === 1 ? tone : mixTone(tone, 0xffffff, 0.12);
    const p: XYZ = facing === 'z' ? [t, y0 + h / 2, z] : [z, y0 + h / 2, t];
    b.box('planks', shade, [w / n - 0.03, h, 0.06], p, rot);
  }
}

/** A gable filled with vertical boards under the rake, instead of one flat wedge. */
export function boardGable(b: Build, w: number, rise: number, y0: number, z: number, tone = PLANK_TONE, boardW = 0.32): void {
  const n = Math.max(4, Math.round(w / boardW));
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + ((i + 0.5) / n) * w;
    const hh = Math.max(0.12, rise * (1 - Math.abs(x) / (w / 2)));
    const shade = i % 3 === 0 ? mixTone(tone, PLANK_DARK, 0.4) : i % 3 === 1 ? tone : mixTone(tone, 0xffffff, 0.1);
    b.box('planks', shade, [w / n - 0.03, hh, 0.07], [x, y0 + hh / 2, z]);
  }
}

/**
 * A rubble-masonry wall block with contiguous ashlar quoins at both vertical corners of the given face.
 * The quoins alternate long/short so they read as bonded stones, not as a ladder of detached cubes
 * (which is what the previous spaced-block quoins looked like at 10 m).
 */
export function quoins(b: Build, x: number, z: number, h: number, y0 = 0, tone = STONE_TONE, block = 0.42): void {
  const n = Math.max(2, Math.round(h / block));
  for (let i = 0; i < n; i++) {
    const long = i % 2 === 0;
    const y = y0 + (i + 0.5) * (h / n);
    const shade = i % 3 === 0 ? tone : i % 3 === 1 ? mixTone(tone, 0x000000, 0.1) : mixTone(tone, 0xffffff, 0.08);
    b.box('ashlar', shade, [long ? 0.78 : 0.46, h / n - 0.02, long ? 0.46 : 0.78], [x, y, z]);
  }
}

/** Merlons on a wall walk. `w` is the run, `at`/`rot` the wall's own placement. */
export function crenellate(b: Build, w: number, y: number, at: XYZ, rot: XYZ | undefined, mat: MatId, tone: number, th: number): void {
  const count = Math.max(3, Math.round(w / 1.1));
  const step = w / count;
  for (let i = 0; i < count; i++) {
    if (i % 2) continue;
    const x = -w / 2 + step * (i + 0.5);
    const p: XYZ = [at[0] + Math.cos(rot?.[1] ?? 0) * x, y + 0.55, at[2] - Math.sin(rot?.[1] ?? 0) * x];
    b.box(mat, tone, [step * 0.82, 1.1, th], p, rot);
    b.box('ashlar', mixTone(tone, 0xffffff, 0.15), [step * 0.9, 0.12, th + 0.1], [p[0], y + 1.16, p[2]], rot);  // capping
  }
}

/** A drystone plinth course under a timber building, plus a footing buried deep enough for a slope. */
export function stonePlinth(b: Build, w: number, d: number, h: number, seed = 0, tone = DRY_TONE): void {
  b.box('drystone', tone, [w, h, d], [0, h / 2, 0]);
  b.box('drystone', mixTone(tone, 0x000000, 0.15), [w - 0.3, 2.0, d - 0.3], [0, -1.0, 0]);       // buried footing
  // a course of visible field stones around the base, so the plinth is masonry and not a kerb
  const per = Math.max(3, Math.round(w / 0.85));
  for (let i = 0; i < per; i++) {
    const t = (i + 0.5) / per;
    for (const sz of [-1, 1]) b.blob('drystone', i % 2 ? tone : mixTone(tone, 0xffffff, 0.12), 0.3, [-w / 2 + t * w, h * 0.42, sz * (d / 2 - 0.03)], seed + i * 2 + sz, 0.66, 5);
  }
  const perD = Math.max(2, Math.round(d / 0.9));
  for (let i = 0; i < perD; i++) {
    const t = (i + 0.5) / perD;
    for (const sx of [-1, 1]) b.blob('drystone', i % 2 ? mixTone(tone, 0x000000, 0.08) : tone, 0.29, [sx * (w / 2 - 0.03), h * 0.42, -d / 2 + t * d], seed + 40 + i * 2 + sx, 0.66, 5);
  }
}

/** A masonry chimney stack rising through a roof slope, with a capping and a smoke opening. */
export function chimney(b: Build, x: number, y: number, z: number, h: number, w = 0.75, mat: MatId = 'masonry', tone = MASONRY_TONE): void {
  b.box(mat, tone, [w, h, w], [x, y + h / 2, z]);
  b.box('ashlar', mixTone(STONE_TONE, 0xffffff, 0.1), [w + 0.22, 0.14, w + 0.22], [x, y + h, z]);
  b.box('planks', 0x0d0b08, [w * 0.5, 0.12, w * 0.5], [x, y + h + 0.08, z]);
  for (const s of [-1, 1]) b.box('ashlar', STONE_TONE, [w + 0.3, 0.1, 0.14], [x, y + h + 0.24, z + s * (w / 2 + 0.06)]);
}
