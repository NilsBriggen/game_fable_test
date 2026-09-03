/**
 * Procedural model library: WorldService.spawnModel/registerModel/hasModel/listModels.
 *
 * Every building and prop is authored here as real geometry (log courses, shingle roofs with stone
 * weights, ashlar quoins, crenellations, arched bridges) and skinned with the downloaded CC0 PBR
 * material set from assets.ts — see public/assets/CREDITS-models.md. A model is assembled by `Build`,
 * which bakes each primitive's transform, gives it world-scale UVs and a vertex colour, and merges
 * everything per material: one Mesh per material used, so a model costs 2–5 draw calls, never one per
 * plank. Exploration then merges the *same* material instances again across the whole map
 * (src/exploration/settlements.ts), so all built settlements together cost one draw call per material.
 *
 * Eight shared materials cover every building: logs, planks, shingle, ashlar, drystone, plaster, iron,
 * thatch (+ rock/wool/fire for natural props, tents and campfires). Painted tints are multiplied by each
 * map's own albedo, which for these CC0 sets is both dark and hue-shifted, so every tint carries the
 * per-channel gain in `TINT_GAIN` — measured with `node tools/assets/albedo.mjs`.
 * Real-metre scale (ARCHITECTURE.md §1) and the footprints src/exploration/layout.ts assumes:
 * blockbau 8×6 (±8 % per spawn), stone house 9×7, church nave 9×13 + tower/apse, castle wall segment 8 m,
 * letzi 8 m, bridge 14 m.
 */
import {
  BufferGeometry, Euler, Float32BufferAttribute, Group, Matrix4, Mesh, MeshStandardMaterial, Object3D,
  Quaternion, Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Rng, hashString } from '@core/rng';
import { buildTreeGeometry, treeMaterial, type TreeKind } from './treeGeometry';
import { registerCsmMaterial } from './shadowCsm';
import { propMaterial, type PropTexId } from './assets';
import { CHARACTER_MODEL_IDS, characterModel } from './characters';

// ---------------- materials ----------------

export type MatId = 'logs' | 'planks' | 'shingle' | 'ashlar' | 'drystone' | 'plaster' | 'iron'
  | 'thatch' | 'rock' | 'cloth' | 'fire';

/** id → (texture set, fixed PBR opts). Fixed so every caller lands on the same cached instance. */
const MAT_SPEC: Record<Exclude<MatId, 'fire'>, [PropTexId, { roughness?: number; metalness?: number; normalScale?: number }]> = {
  logs: ['wood-log', { roughness: 0.92, normalScale: 1.1 }],
  planks: ['wood-plank', { roughness: 0.9 }],
  shingle: ['shingle', { roughness: 0.85, normalScale: 1.2 }],
  ashlar: ['stone-block', { roughness: 0.95 }],
  drystone: ['drystone', { roughness: 1, normalScale: 1.3 }],
  plaster: ['plaster', { roughness: 0.88 }],
  iron: ['iron', { roughness: 0.45, metalness: 0.7 }],
  thatch: ['thatch', { roughness: 1, normalScale: 1.2 }],
  rock: ['rock', { roughness: 0.95, normalScale: 1.2 }],
  cloth: ['wool', { roughness: 0.95 }],
};

let fireMaterial: MeshStandardMaterial | null = null;
export function propMat(id: MatId): MeshStandardMaterial {
  if (id === 'fire') {
    if (!fireMaterial) {
      fireMaterial = new MeshStandardMaterial({ color: 0xff9a3c, emissive: 0xff5a10, emissiveIntensity: 2.2, roughness: 0.6 });
      registerCsmMaterial(fireMaterial);
    }
    return fireMaterial;
  }
  const [tex, opts] = MAT_SPEC[id];
  return propMaterial(tex, opts);
}

/** Texture repeat length in metres per material (bigger = coarser grain). */
const UV_METRES: Record<MatId, number> = {
  logs: 1.6, planks: 1.2, shingle: 1.1, ashlar: 2.2, drystone: 1.8, plaster: 2.4,
  iron: 0.6, thatch: 1.4, rock: 1.6, cloth: 0.8, fire: 1,
};

// ---------------- geometry assembly ----------------

/** Per-material gain on the vertex tint. `map * vColor` is unclamped and the ambientCG albedos are far
 *  darker than they look in sRGB (wood-plank averages 0.046 in *linear* light, rock 0.009), so a painted
 *  tone only lands where it was authored if it is multiplied by ≈ 0.8 / meanLinearAlbedo. Measure with
 *  `node tools/assets/albedo.mjs`; rock is capped rather than the 92× its near-black map would ask for. */
const TINT_GAIN: Record<MatId, [number, number, number]> = {
  logs: [7.1, 12.3, 19.5], planks: [10.7, 22.9, 27.6], shingle: [6.2, 8.4, 14.0],
  ashlar: [3.1, 4.0, 9.9], drystone: [4.2, 5.4, 8.3], plaster: [1.20, 1.24, 1.28],
  iron: [2.54, 3.16, 3.65], thatch: [5.3, 6.8, 9.4], rock: [25, 18, 15], cloth: [0.93, 0.93, 0.93],
  fire: [1, 1, 1],
};

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
function boxUv(geo: BufferGeometry, metres: number): void {
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
    uv[i * 2] = u; uv[i * 2 + 1] = v;
  }
  geo.setAttribute('uv', new Float32BufferAttribute(uv, 2));
}

type XYZ = [number, number, number];

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

function boxGeo(w: number, h: number, d: number): BufferGeometry {
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

function cylGeo(rTop: number, rBot: number, h: number, seg = 8, caps = true): BufferGeometry {
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

/** Triangular prism: apex on +y at the centre, extruded along z. Gable roofs, roof ends, wedges. */
function wedgeGeo(w: number, h: number, d: number): BufferGeometry {
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
function blobGeo(r: number, seed: number, squash = 0.8, seg = 8): BufferGeometry {
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

class Build {
  private parts = new Map<MatId, BufferGeometry[]>();

  add(mat: MatId, geo: BufferGeometry, color: number, at: XYZ = [0, 0, 0], rot?: XYZ, scale?: XYZ, order: 'XYZ' | 'YXZ' = 'XYZ'): this {
    _e.set(rot?.[0] ?? 0, rot?.[1] ?? 0, rot?.[2] ?? 0, order);
    _q.setFromEuler(_e);
    _m.compose(new Vector3(at[0], at[1], at[2]), _q, new Vector3(scale?.[0] ?? 1, scale?.[1] ?? 1, scale?.[2] ?? 1));
    geo.applyMatrix4(_m);
    setColor(geo, color, TINT_GAIN[mat]);
    boxUv(geo, UV_METRES[mat]);
    let list = this.parts.get(mat);
    if (!list) { list = []; this.parts.set(mat, list); }
    list.push(geo);
    return this;
  }

  box(mat: MatId, color: number, size: XYZ, at: XYZ, rot?: XYZ): this {
    return this.add(mat, boxGeo(size[0], size[1], size[2]), color, at, rot);
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

// ---------------- shared sub-assemblies ----------------

const SHINGLE_TONE = 0x7b6a52;
const LOG_TONE = 0x9c8156;
const PLANK_TONE = 0x8d7247;
const PLANK_DARK = 0x5d4a2e;
const STONE_TONE = 0x9a958c;
const DRY_TONE = 0x8e8a80;
const PLASTER_TONE = 0xd8d0bc;
const IRON_TONE = 0x8e9298;
const THATCH_TONE = 0xc4a463;

/** Shingled gable roof with a deep Alpine overhang, ridge beam, purlins and stone weights. */
function gableRoof(b: Build, w: number, d: number, rise: number, y: number, opts: { overhang?: number; weights?: boolean; mat?: MatId; tone?: number; at?: [number, number] } = {}): void {
  const [ox, oz] = opts.at ?? [0, 0];
  const oh = opts.overhang ?? 0.7;
  const mat = opts.mat ?? 'shingle';
  const tone = opts.tone ?? (mat === 'thatch' ? THATCH_TONE : SHINGLE_TONE);
  const halfW = w / 2 + oh;
  const slope = Math.hypot(halfW, rise);
  const ang = Math.atan2(rise, halfW);
  const dz = d + oh * 1.4;
  for (const s of [-1, 1]) {
    b.box(mat, tone, [slope, 0.14, dz], [ox + s * halfW / 2, y + rise / 2, oz], [0, 0, -s * ang]);
    // eaves board
    b.box('planks', PLANK_DARK, [0.1, 0.18, dz], [ox + s * halfW, y + 0.02, oz]);
  }
  b.box('planks', PLANK_DARK, [0.18, 0.16, dz + 0.1], [ox, y + rise + 0.02, oz]);   // ridge beam
  b.wedge('planks', PLANK_TONE, [w, rise, 0.12], [ox, y, oz + dz / 2 - 0.06]);      // gable ends
  b.wedge('planks', PLANK_TONE, [w, rise, 0.12], [ox, y, oz - dz / 2 + 0.06]);
  if (opts.weights !== false && mat === 'shingle') {
    for (let i = 0; i < 4; i++) {
      const t = (i + 0.5) / 4;
      const zz = -dz / 2 + t * dz;
      for (const s of [-1, 1]) {
        const u = 0.45 + ((i * 7) % 3) * 0.12;
        b.blob('rock', 0xb9b3a6, 0.18, [ox + s * halfW * u, y + rise * (1 - u) + 0.16, oz + zz], i * 3 + s, 0.6, 5);
      }
    }
  }
}

/** Window: dark recess + shutters or a frame. */
function window(b: Build, x: number, y: number, z: number, w = 0.55, h = 0.7, facing: 'z' | 'x' = 'z', shutters = true): void {
  const rot: XYZ | undefined = facing === 'x' ? [0, Math.PI / 2, 0] : undefined;
  b.box('planks', 0x18140f, [w, h, 0.1], [x, y, z], rot);
  b.box('planks', PLANK_DARK, [w + 0.16, 0.09, 0.14], [x, y + h / 2 + 0.05, z], rot);
  if (shutters) {
    for (const s of [-1, 1]) {
      const off = (w / 2 + 0.09) * s;
      b.box('planks', 0x6b5638, [0.16, h, 0.05], facing === 'z' ? [x + off, y, z + 0.05] : [x + 0.05, y, z + off], rot);
    }
  }
}

function doorway(b: Build, x: number, y: number, z: number, w = 1.05, h = 2.0, facing: 'z' | 'x' = 'z'): void {
  const rot: XYZ | undefined = facing === 'x' ? [0, Math.PI / 2, 0] : undefined;
  b.box('planks', 0x4a3a24, [w, h, 0.09], [x, y + h / 2, z], rot);
  b.box('iron', IRON_TONE, [w * 0.8, 0.07, 0.04], [x, y + h * 0.75, z + (facing === 'z' ? 0.06 : 0)], rot);
  b.box('iron', IRON_TONE, [w * 0.8, 0.07, 0.04], [x, y + h * 0.28, z + (facing === 'z' ? 0.06 : 0)], rot);
}

/** Horizontal log courses on all four walls + protruding cross-jointed corner ends (Blockbau). */
function logWalls(b: Build, w: number, d: number, h: number, y0: number, courseH = 0.34, tone0 = LOG_TONE): void {
  const courses = Math.max(4, Math.round(h / courseH));
  const ch = h / courses;
  const r = ch * 0.52;
  for (let i = 0; i < courses; i++) {
    const y = y0 + ch * (i + 0.5);
    const tone = i % 2 === 0 ? tone0 : 0x8f764e;
    const longWay = i % 2 === 0;
    if (longWay) {
      for (const s of [-1, 1]) b.cyl('logs', tone, r, r, w + 0.5, [0, y, s * d / 2], [0, 0, Math.PI / 2], 7);
    } else {
      for (const s of [-1, 1]) b.cyl('logs', tone, r, r, d + 0.5, [s * w / 2, y, 0], [Math.PI / 2, 0, 0], 7);
    }
  }
  // interior wall plane so the gaps between logs are not see-through
  b.box('planks', 0x5f4c32, [w - 0.1, h, d - 0.1], [0, y0 + h / 2, 0]);
}

// ---------------- houses ----------------

/** Draws a Blockbau house into a caller's Build (the mill reuses it). Returns extra loose children. */
function blockbauInto(b: Build, rng: Rng, variant?: string): Object3D[] {
  const size = variant === 'large' ? { w: 10, d: 7, wallH: 3.6, ridge: 3.2 }
    : variant === 'inn' ? { w: 11.5, d: 8, wallH: 4.4, ridge: 3.4 }
      : variant === 'small' ? { w: 6.5, d: 5.2, wallH: 2.6, ridge: 2.3 }
        : { w: 8, d: 6, wallH: 3.1, ridge: 2.8 };
  // per-spawn variation: no draw-call cost (exploration merges by material anyway) and a village of
  // identical houses reads as a tile set rather than a place
  const jitter = (v: number, k: number) => v * (1 + (rng.next() - 0.5) * k);
  const w = jitter(size.w, 0.16), d = jitter(size.d, 0.12), wallH = jitter(size.wallH, 0.12);
  const ridge = jitter(size.ridge, 0.14);
  const roofTone = [0x6b5a44, 0x7b6849, 0x5d5140][Math.floor(rng.next() * 3)];
  const logTone = [LOG_TONE, 0x8c7350, 0xa88c5f][Math.floor(rng.next() * 3)];
  const hasGallery = variant !== 'small' && rng.next() < 0.7;
  const plinth = 0.55;
  // drystone plinth, with a buried footing so a downhill side never shows daylight under the sill
  b.box('drystone', DRY_TONE, [w + 0.5, plinth, d + 0.5], [0, plinth / 2 - 0.15, 0]);
  b.box('drystone', 0x7c776e, [w + 0.2, 1.8, d + 0.2], [0, -0.9, 0]);
  for (let i = 0; i < 4; i++) {
    const t = (i + 0.5) / 4;
    b.blob('drystone', DRY_TONE, 0.32, [-w / 2 - 0.2 + t * (w + 0.4), plinth * 0.55, d / 2 + 0.22], i, 0.7, 5);
  }
  logWalls(b, w, d, wallH, plinth, 0.34, logTone);
  // upper gable storey in vertical boards
  b.wedge('planks', PLANK_TONE, [w, ridge * 0.92, d * 0.9], [0, plinth + wallH, 0]);
  doorway(b, 0, plinth, d / 2 + 0.06, 1.05, 2.0);
  window(b, -w * 0.3, plinth + wallH * 0.62, d / 2 + 0.08);
  window(b, w * 0.3, plinth + wallH * 0.62, d / 2 + 0.08);
  window(b, -w / 2 - 0.08, plinth + wallH * 0.62, 0, 0.5, 0.6, 'x');
  // gallery (Laube) under the eaves on the long side
  const galY = plinth + wallH * 0.72;
  if (hasGallery) {
    b.box('planks', PLANK_TONE, [w + 0.5, 0.1, 1.0], [0, galY, d / 2 + 0.55]);
    b.box('planks', PLANK_DARK, [w + 0.5, 0.09, 0.09], [0, galY + 0.85, d / 2 + 1.02]);
    for (let i = 0; i <= 6; i++) b.box('planks', PLANK_DARK, [0.07, 0.85, 0.07], [-w / 2 - 0.2 + (i / 6) * (w + 0.4), galY + 0.43, d / 2 + 1.02]);
    for (const s of [-1, 1]) b.cyl('logs', logTone, 0.08, 0.09, galY, [s * (w / 2 + 0.1), galY / 2, d / 2 + 1.0], undefined, 6);
  }
  gableRoof(b, w, d, ridge, plinth + wallH, { tone: roofTone });
  if (variant === 'inn') {   // wrought-iron bracket + painted board (drawn into the same batches)
    b.cyl('iron', IRON_TONE, 0.035, 0.035, 1.1, [w / 2 + 0.5, plinth + wallH * 0.9, d / 2 - 0.6], [0, 0, Math.PI / 2], 6);
    b.box('planks', 0x4e3a22, [0.9, 0.7, 0.06], [w / 2 + 1.0, plinth + wallH * 0.55, d / 2 - 0.6]);
    b.cyl('iron', IRON_TONE, 0.02, 0.02, 0.4, [w / 2 + 1.0, plinth + wallH * 0.75, d / 2 - 0.6], undefined, 5);
  }
  return [];
}

function houseBlockbau(rng: Rng, variant?: string): Object3D {
  const b = new Build();
  const extra = blockbauInto(b, rng, variant);
  return b.emit('house.blockbau', extra);
}

function houseStone(rng: Rng, variant?: string): Object3D {
  const w = variant === 'large' ? 11 : 9, d = 7, ridge = 2.8;
  const wallH = 6.4 * (1 + (rng.next() - 0.5) * 0.14);
  const wash = [PLASTER_TONE, 0xd6c49a, 0xc9c6bb][Math.floor(rng.next() * 3)];
  const b = new Build();
  b.box('plaster', wash, [w, wallH, d], [0, wallH / 2, 0]);
  // ashlar quoins and plinth (+ buried footing for sloping ground)
  b.box('ashlar', STONE_TONE, [w + 0.3, 0.7, d + 0.3], [0, 0.35, 0]);
  b.box('ashlar', 0x8a857c, [w, 1.8, d], [0, -0.9, 0]);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    for (let i = 0; i < 7; i++) {
      const hh = 0.8;
      b.box('ashlar', STONE_TONE, [0.62, hh * 0.62, 0.62], [sx * (w / 2 - 0.16), 0.7 + i * hh + hh / 2, sz * (d / 2 - 0.16)]);
    }
  }
  b.box('ashlar', STONE_TONE, [w + 0.2, 0.18, d + 0.2], [0, wallH * 0.5, 0]);       // belt course
  for (const yy of [wallH * 0.30, wallH * 0.62, wallH * 0.86]) {
    for (const xx of [-w * 0.28, w * 0.28]) window(b, xx, yy, d / 2 + 0.06, 0.6, 0.85);
    window(b, -w / 2 - 0.06, yy, 0, 0.5, 0.8, 'x');
    window(b, w / 2 + 0.06, yy, 1.2, 0.5, 0.8, 'x');
  }
  doorway(b, 0, 0, d / 2 + 0.06, 1.2, 2.3);
  gableRoof(b, w, d, ridge, wallH, { overhang: 0.5 });
  return b.emit('house.stone');
}

function barn(rng: Rng): Object3D {
  const w = 11, d = 7, wallH = 4.4, ridge = 3.4;
  const b = new Build();
  b.box('drystone', DRY_TONE, [w + 0.4, 0.5, d + 0.4], [0, 0.2, 0]);
  b.box('drystone', 0x7c776e, [w, 1.8, d], [0, -0.9, 0]);
  b.box('planks', 0x6f5a3a, [w, wallH, d], [0, 0.45 + wallH / 2, 0]);
  // vertical boarding + corner posts
  for (let i = 0; i <= 12; i++) {
    const x = -w / 2 + (i / 12) * w;
    b.box('planks', i % 2 ? PLANK_TONE : 0x7d6540, [0.28, wallH, 0.08], [x, 0.45 + wallH / 2, d / 2 + 0.04]);
  }
  for (const sx of [-1, 1]) b.box('logs', LOG_TONE, [0.2, wallH, 0.2], [sx * (w / 2 - 0.1), 0.45 + wallH / 2, d / 2 - 0.1]);
  b.box('planks', 0x54432a, [3.2, 3.2, 0.12], [0, 0.45 + 1.6, d / 2 + 0.1]);        // gate
  b.box('iron', IRON_TONE, [3.2, 0.1, 0.05], [0, 0.45 + 2.9, d / 2 + 0.18]);
  b.wedge('planks', PLANK_TONE, [w, ridge * 0.9, d * 0.9], [0, 0.45 + wallH, 0]);
  gableRoof(b, w, d, ridge, 0.45 + wallH, { overhang: 0.8 });
  void rng;
  return b.emit('barn');
}

/** Romanesque village church: nave, apse, west tower with belfry openings and a shingled spire.
 *  Drawn into a caller's `Build` so the monastery can share the same merged material batches. */
function churchInto(b: Build, ox = 0, oz = 0): void {
  const naveW = 9, naveD = 13, wallH = 7.4, ridge = 3.6;
  b.box('ashlar', STONE_TONE, [naveW + 0.5, 0.8, naveD + 0.5], [ox, 0.4, oz]);
  b.box('ashlar', 0x8a857c, [naveW, 2.0, naveD], [ox, -1.0, oz]);
  b.box('plaster', 0xdcd5c2, [naveW, wallH, naveD], [ox, wallH / 2, oz]);
  for (let i = -1; i <= 1; i++) for (const sx of [-1, 1]) {
    b.box('ashlar', STONE_TONE, [0.55, wallH * 0.8, 0.9], [ox + sx * (naveW / 2 + 0.2), wallH * 0.4, oz + i * 3.6]);
  }
  // ashlar quoins on all four corners, so no elevation is a blank plastered slab
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (let i = 0; i < 9; i++) {
    b.box('ashlar', 0x9f9a90, [0.66, 0.5, 0.66], [ox + sx * (naveW / 2 - 0.1), 0.85 + i * 0.8, oz + sz * (naveD / 2 - 0.1)]);
  }
  // round-arched windows: a tall slot plus a stone arch head — long walls…
  for (let i = -1; i <= 1; i++) for (const sx of [-1, 1]) {
    const z = oz + i * 3.6 + 1.8;
    b.box('planks', 0x1a1610, [0.12, 1.9, 0.62], [ox + sx * (naveW / 2 + 0.02), wallH * 0.55, z]);
    b.cyl('ashlar', STONE_TONE, 0.36, 0.36, 0.2, [ox + sx * (naveW / 2 + 0.04), wallH * 0.55 + 0.95, z], [0, 0, Math.PI / 2], 8);
  }
  // …and both gable ends, outboard of the tower (±2.2) and the apse (±2.4) that stand in front of them
  for (const sz of [-1, 1]) for (const dx of [-3.2, 3.2]) {
    b.box('planks', 0x1a1610, [0.5, 1.6, 0.12], [ox + dx, wallH * 0.5, oz + sz * (naveD / 2 + 0.02)]);
    b.cyl('ashlar', STONE_TONE, 0.31, 0.31, 0.2, [ox + dx, wallH * 0.5 + 0.8, oz + sz * (naveD / 2 + 0.04)], [Math.PI / 2, 0, 0], 8);
  }
  // west front: a stone-framed portal beside the tower, and an oculus high in each gable
  b.box('ashlar', STONE_TONE, [2.2, 3.2, 0.3], [ox, 1.6, oz - naveD / 2 - 0.04]);
  doorway(b, ox, 0, oz - naveD / 2 - 0.16, 1.3, 2.4);
  for (const sz of [-1, 1]) {
    b.cyl('ashlar', STONE_TONE, 0.62, 0.62, 0.22, [ox, wallH + 1.3, oz + sz * (naveD / 2 + 0.42)], [Math.PI / 2, 0, 0], 10);
    b.cyl('planks', 0x1a1610, 0.42, 0.42, 0.16, [ox, wallH + 1.3, oz + sz * (naveD / 2 + 0.46)], [Math.PI / 2, 0, 0], 10);
  }
  b.box('ashlar', STONE_TONE, [naveW + 0.24, 0.22, naveD + 0.24], [ox, wallH * 0.52, oz]);   // stringcourse
  // south door with a stone surround
  b.box('ashlar', STONE_TONE, [0.3, 3.0, 1.9], [ox + naveW / 2 + 0.04, 1.5, oz - 1.0]);
  doorway(b, ox + naveW / 2 + 0.14, 0, oz - 1.0, 1.3, 2.4, 'x');
  gableRoof(b, naveW, naveD, ridge, wallH, { overhang: 0.5, weights: false, at: [ox, oz] });
  // apse (east end)
  b.cyl('plaster', 0xdcd5c2, 2.6, 2.7, 5.6, [ox, 2.8, oz + naveD / 2 + 1.1], undefined, 10);
  b.cyl('shingle', SHINGLE_TONE, 0.05, 3.0, 1.6, [ox, 6.4, oz + naveD / 2 + 1.1], undefined, 10);
  // west tower
  const tw = 4.4, th = 15, tz = oz - naveD / 2 - tw / 2 + 0.8;
  b.box('ashlar', STONE_TONE, [tw, th, tw], [ox, th / 2, tz]);
  for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as [number, number][]) {
    for (const off of [-0.7, 0.7]) {
      const x = ox + (dx === 0 ? off : dx * (tw / 2 + 0.02)), z = dz === 0 ? tz + off : tz + dz * (tw / 2 + 0.02);
      b.box('planks', 0x15120d, [dx === 0 ? 0.5 : 0.1, 1.5, dz === 0 ? 0.5 : 0.1], [x, th - 2.2, z]);
    }
  }
  b.box('ashlar', 0x8f8a82, [tw + 0.5, 0.3, tw + 0.5], [ox, th + 0.1, tz]);
  b.cyl('shingle', SHINGLE_TONE, 0.04, tw * 0.78, 5.6, [ox, th + 3, tz], [0, Math.PI / 4, 0], 4);
  b.box('iron', IRON_TONE, [0.1, 1.1, 0.1], [ox, th + 6.3, tz]);
  b.box('iron', IRON_TONE, [0.6, 0.1, 0.1], [ox, th + 6.5, tz]);
  doorway(b, ox, 0, tz - tw / 2 - 0.05, 1.4, 2.6);
}

function church(rng: Rng): Object3D {
  const b = new Build();
  churchInto(b);
  void rng;
  return b.emit('church');
}

function chapel(rng: Rng): Object3D {
  const w = 5, d = 7, wallH = 3.8, ridge = 2.2;
  const b = new Build();
  b.box('drystone', DRY_TONE, [w + 0.4, 0.5, d + 0.4], [0, 0.25, 0]);
  b.box('drystone', 0x7c776e, [w, 1.8, d], [0, -0.9, 0]);
  b.box('plaster', 0xe0d9c6, [w, wallH, d], [0, 0.5 + wallH / 2, 0]);
  for (const sx of [-1, 1]) {
    b.box('planks', 0x1a1610, [0.1, 1.2, 0.45], [sx * (w / 2 + 0.02), 0.5 + wallH * 0.6, 1.2]);
    b.cyl('ashlar', STONE_TONE, 0.27, 0.27, 0.16, [sx * (w / 2 + 0.03), 0.5 + wallH * 0.6 + 0.6, 1.2], [0, 0, Math.PI / 2], 8);
  }
  doorway(b, 0, 0.5, -d / 2 - 0.05, 0.95, 1.9);
  gableRoof(b, w, d, ridge, 0.5 + wallH, { overhang: 0.55, weights: false });
  // ridge turret with a bell
  b.box('planks', PLANK_DARK, [0.7, 0.9, 0.7], [0, 0.5 + wallH + ridge, -d / 2 + 1.0]);
  b.cyl('shingle', SHINGLE_TONE, 0.03, 0.62, 0.8, [0, 0.5 + wallH + ridge + 1.25, -d / 2 + 1.0], [0, Math.PI / 4, 0], 4);
  b.box('iron', IRON_TONE, [0.06, 0.5, 0.06], [0, 0.5 + wallH + ridge + 1.9, -d / 2 + 1.0]);
  b.box('iron', IRON_TONE, [0.3, 0.06, 0.06], [0, 0.5 + wallH + ridge + 1.98, -d / 2 + 1.0]);
  void rng;
  return b.emit('chapel');
}

function monastery(rng: Rng): Object3D {
  const b = new Build();
  churchInto(b);
  const side = 13, wallH = 3.4, cx = 12, cz = 4;
  // cloister: four ranges around a garth, arcaded toward the middle
  for (let k = 0; k < 4; k++) {
    const ang = (Math.PI / 2) * k;
    const ox = cx + Math.sin(ang) * side / 2, oz = cz + Math.cos(ang) * side / 2;
    const len = side + 2.6;
    b.box('plaster', 0xd6cfbb, [len, wallH, 2.6], [ox, wallH / 2, oz], [0, ang, 0]);
    gableRoofRotated(b, len, 2.6, 1.0, wallH, ox, oz, ang);
    for (let i = -2; i <= 2; i++) {
      const px = ox + Math.cos(ang) * i * 2.4 + Math.sin(ang) * -1.35;
      const pz = oz - Math.sin(ang) * i * 2.4 + Math.cos(ang) * -1.35;
      b.cyl('ashlar', STONE_TONE, 0.16, 0.18, 2.4, [px, 1.2, pz], undefined, 8);
      b.cyl('ashlar', STONE_TONE, 0.3, 0.22, 0.25, [px, 2.5, pz], undefined, 8);
    }
  }
  b.box('drystone', DRY_TONE, [0.9, 2.2, 20], [-9, 1.1, 2]);
  void rng;
  return b.emit('monastery');
}

/** Small helper so the cloister ranges can carry a roof at an arbitrary yaw. */
function gableRoofRotated(b: Build, w: number, d: number, rise: number, y: number, x: number, z: number, yaw: number): void {
  const halfW = d / 2 + 0.4;
  const slope = Math.hypot(halfW, rise);
  const ang = Math.atan2(rise, halfW);
  for (const s of [-1, 1]) {
    const ox = x + Math.sin(yaw + Math.PI / 2) * s * halfW / 2, oz = z + Math.cos(yaw + Math.PI / 2) * s * halfW / 2;
    // YXZ: yaw the range first, then tilt the slab in its own frame
    b.add('shingle', boxGeo(w, 0.12, slope), SHINGLE_TONE, [ox, y + rise / 2, oz], [s * ang, yaw, 0], undefined, 'YXZ');
  }
}

// ---------------- castle & fortification ----------------

function crenellate(b: Build, w: number, y: number, at: XYZ, rot: XYZ | undefined, mat: MatId, tone: number, th: number): void {
  const count = Math.max(3, Math.round(w / 1.1));
  const step = w / count;
  for (let i = 0; i < count; i++) {
    if (i % 2) continue;
    const x = -w / 2 + step * (i + 0.5);
    const p: XYZ = [at[0] + Math.cos(rot?.[1] ?? 0) * x, y + 0.45, at[2] - Math.sin(rot?.[1] ?? 0) * x];
    b.box(mat, tone, [step * 0.82, 0.9, th], p, rot);
  }
}

function castleKeep(rng: Rng): Object3D {
  const w = 12, d = 12, h = 18;
  const b = new Build();
  b.box('ashlar', STONE_TONE, [w + 1.2, 1.2, d + 1.2], [0, 0.6, 0]);               // battered plinth
  b.box('ashlar', 0x968f85, [w, h, d], [0, h / 2, 0]);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    for (let i = 0; i < 12; i++) b.box('ashlar', 0xa39c92, [0.75, 0.75, 0.75], [sx * (w / 2 - 0.2), 1.4 + i * 1.45, sz * (d / 2 - 0.2)]);
  }
  // arrow slits
  for (let i = 0; i < 3; i++) for (const sz of [-1, 1]) {
    b.box('planks', 0x14110c, [0.16, 1.2, 0.12], [(i - 1) * 3.2, 6 + i * 2.2, sz * (d / 2 + 0.02)]);
    b.box('planks', 0x14110c, [0.12, 1.2, 0.16], [sz * (w / 2 + 0.02), 8 + i * 2.2, (i - 1) * 3.2]);
  }
  b.box('ashlar', 0xa39c92, [w + 0.9, 0.45, d + 0.9], [0, h + 0.2, 0]);             // corbelled parapet
  for (const [ax, az, yaw] of [[0, d / 2 + 0.3, 0], [0, -d / 2 - 0.3, 0], [w / 2 + 0.3, 0, Math.PI / 2], [-w / 2 - 0.3, 0, Math.PI / 2]] as [number, number, number][]) {
    crenellate(b, w, h + 0.4, [ax, 0, az], [0, yaw, 0], 'ashlar', 0xa39c92, 0.55);
  }
  doorway(b, 0, 1.2, d / 2 + 0.06, 1.4, 2.6);
  b.wedge('shingle', SHINGLE_TONE, [3.0, 1.2, 2.2], [0, 3.8, d / 2 + 1.1]);          // forebuilding porch
  void rng;
  return b.emit('castle.keep');
}

function castleWall(rng: Rng): Object3D {
  const w = 8, h = 6, th = 1.3;
  const b = new Build();
  b.box('ashlar', STONE_TONE, [w, h, th + 0.4], [0, 0.35, 0]);
  b.box('ashlar', 0x968f85, [w, h, th], [0, h / 2, 0]);
  b.box('planks', PLANK_DARK, [w, 0.14, th + 0.9], [0, h - 0.5, 0]);                  // wall walk
  crenellate(b, w, h - 0.4, [0, 0, 0], undefined, 'ashlar', 0xa39c92, th * 0.55);
  for (let i = 0; i < 2; i++) b.box('planks', 0x14110c, [0.14, 0.9, th + 0.04], [(i - 0.5) * 3, h * 0.55, 0]);
  void rng;
  return b.emit('castle.wall');
}

function castleTower(rng: Rng): Object3D {
  const r = 3, h = 14;
  const b = new Build();
  b.cyl('ashlar', STONE_TONE, r * 1.06, r * 1.22, 2.0, [0, 1.0, 0], undefined, 12);
  b.cyl('ashlar', 0x968f85, r, r * 1.06, h - 2, [0, 1 + (h - 2) / 2, 0], undefined, 12);
  b.cyl('ashlar', 0xa39c92, r + 0.45, r + 0.2, 0.5, [0, h - 0.4, 0], undefined, 12);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.box('ashlar', 0xa39c92, [1.1, 0.85, 0.5], [Math.cos(a) * (r + 0.25), h + 0.3, Math.sin(a) * (r + 0.25)], [0, -a, 0]);
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    b.box('planks', 0x14110c, [0.14, 1.1, 0.14], [Math.cos(a) * (r + 0.02), 6 + i, Math.sin(a) * (r + 0.02)], [0, -a, 0]);
  }
  b.cyl('shingle', SHINGLE_TONE, 0.04, r * 1.12, 4.6, [0, h + 3, 0], undefined, 12);
  void rng;
  return b.emit('castle.tower');
}

/** Letzi: a mortarless field-stone barrier wall, 8 m per segment (LORE §4 Letzimauern). */
function letziWall(rng: Rng): Object3D {
  const w = 8, h = 2.5, th = 1.5;
  const b = new Build();
  b.box('drystone', DRY_TONE, [w, h * 0.9, th * 0.8], [0, h * 0.45, 0]);
  let seed = 1;
  for (let course = 0; course < 4; course++) {
    const y = 0.32 + course * 0.6;
    const inset = course * 0.11;
    const n = 7 - course;
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + ((i + 0.5) / n) * w;
      const rr = 0.38 + ((seed * 7) % 5) * 0.03;
      b.blob('drystone', course % 2 ? 0x928c81 : DRY_TONE, rr, [x, y, th / 2 - inset - 0.2], seed++, 0.6, 5);
      b.blob('drystone', 0x8a857b, rr * 0.95, [x, y, -th / 2 + inset + 0.2], seed++, 0.6, 5);
    }
  }
  void rng;
  return b.emit('letzi.wall');
}

function palisade(rng: Rng): Object3D {
  const count = 14, w = 8, h = 2.8;
  const b = new Build();
  for (let i = 0; i < count; i++) {
    const x = -w / 2 + (w / count) * (i + 0.5);
    const jitter = (rng.next() - 0.5) * 0.08;
    const hh = h - rng.next() * 0.2;
    b.cyl('logs', i % 2 ? LOG_TONE : 0x8a7048, 0.13, 0.15, hh, [x, hh / 2, jitter], [0, 0, jitter * 0.5], 7);
    b.cyl('logs', 0x7d6540, 0.02, 0.13, 0.32, [x, hh + 0.16, jitter], undefined, 7);   // sharpened point
  }
  b.box('logs', 0x7d6540, [w, 0.14, 0.14], [0, h * 0.62, 0.16]);
  b.box('logs', 0x7d6540, [w, 0.14, 0.14], [0, h * 0.28, 0.16]);
  return b.emit('palisade');
}

// ---------------- infrastructure ----------------

function bridgeWood(rng: Rng): Object3D {
  const len = 10, w = 2.8;
  const b = new Build();
  for (let i = 0; i < 14; i++) {
    b.box('planks', i % 2 ? PLANK_TONE : 0x82693f, [len / 14 - 0.04, 0.12, w], [-len / 2 + (i + 0.5) * (len / 14), 2.06, 0]);
  }
  for (const s of [-1, 1]) b.box('logs', LOG_TONE, [len, 0.26, 0.26], [0, 1.9, s * (w / 2 - 0.3)]);
  for (let i = 0; i < 3; i++) {
    const x = -len / 2 + (len / 2) * i;
    for (const s of [-1, 1]) {
      b.cyl('logs', 0x8a7048, 0.16, 0.2, 2.0, [x, 1.0, s * (w / 2 - 0.2)], undefined, 7);
      b.cyl('logs', 0x8a7048, 0.09, 0.09, 1.0, [x, 2.6, s * (w / 2)], undefined, 6);
    }
    b.box('logs', 0x8a7048, [0.2, 0.2, w], [x, 1.95, 0]);
  }
  for (const s of [-1, 1]) b.box('logs', 0x7d6540, [len, 0.12, 0.12], [0, 3.1, s * (w / 2)]);
  void rng;
  return b.emit('bridge.wood');
}

function bridgeStone(rng: Rng): Object3D {
  const len = 14, w = 3.4;
  const b = new Build();
  // segmental arch from voussoir blocks
  const R = 4.0, seg = 11;
  for (let i = 0; i < seg; i++) {
    const a = Math.PI * (0.08 + (i / (seg - 1)) * 0.84);
    const x = Math.cos(a) * R, y = 1.1 + Math.sin(a) * R * 0.62;
    b.box('ashlar', i % 2 ? STONE_TONE : 0x8f8a80, [0.9, 0.75, w], [x, y, 0], [0, 0, a - Math.PI / 2]);
  }
  for (const s of [-1, 1]) b.box('ashlar', STONE_TONE, [3.2, 3.4, w], [s * (len / 2 - 1.4), 1.7, 0]);
  b.box('ashlar', 0x8f8a80, [len, 0.5, w], [0, 3.55, 0]);
  b.box('drystone', DRY_TONE, [len - 0.4, 0.18, w - 0.5], [0, 3.85, 0]);
  for (const s of [-1, 1]) {
    b.box('ashlar', STONE_TONE, [len, 0.75, 0.32], [0, 4.15, s * (w / 2 - 0.1)]);
    b.box('ashlar', 0xa39c92, [len, 0.14, 0.44], [0, 4.55, s * (w / 2 - 0.1)]);
  }
  void rng;
  return b.emit('bridge.stone');
}

function mill(rng: Rng): Object3D {
  const b = new Build();
  const extra = blockbauInto(b, rng, 'small');
  const cx = 4.3, cy = 2.0;
  b.cyl('logs', 0x6f5a3a, 0.16, 0.16, 1.4, [cx, cy, 0], [0, 0, Math.PI / 2], 8);       // axle
  for (const s of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      b.box('planks', PLANK_TONE, [0.12, 1.85, 0.12], [cx + s * 0.55, cy + Math.sin(a) * 0.93, Math.cos(a) * 0.93], [a, 0, 0]);
    }
    b.cyl('planks', PLANK_DARK, 1.9, 1.9, 0.1, [cx + s * 0.55, cy, 0], [0, 0, Math.PI / 2], 10);
  }
  for (let i = 0; i < 8; i++) {                                                         // paddles
    const a = (i / 8) * Math.PI * 2;
    b.box('planks', 0x6a5535, [1.2, 0.42, 0.1], [cx, cy + Math.sin(a) * 1.75, Math.cos(a) * 1.75], [a, 0, 0]);
  }
  b.box('planks', PLANK_DARK, [3.2, 0.2, 0.9], [cx + 1.4, cy + 2.1, 0]);                // sluice
  return b.emit('mill', extra);
}

/** Weidling: the flat-bottomed clinker-built lake boat of the Vierwaldstättersee. */
function boat(rng: Rng): Object3D {
  const len = 8.5, w = 2.2;
  const b = new Build();
  const strakes = 4;
  for (let s = 0; s < strakes; s++) {
    const y = 0.16 + s * 0.19;
    const t = s / strakes;
    for (const side of [-1, 1]) {
      for (let i = 0; i < 7; i++) {
        const u = (i + 0.5) / 7;
        const x = -len / 2 + u * len;
        const taper = 1 - Math.pow(Math.abs(u - 0.5) * 2, 2.2) * 0.88;
        const z = side * (w / 2) * taper * (0.72 + t * 0.3);
        const nz = side * (w / 2) * (1 - Math.pow(Math.abs((i + 1.5) / 7 - 0.5) * 2, 2.2) * 0.88) * (0.72 + t * 0.3);
        const sheer = Math.pow(Math.abs(u - 0.5) * 2, 2.4) * 0.42;   // upswept bow and stern
        b.box('planks', s % 2 ? 0x7a6440 : PLANK_TONE, [len / 7 + 0.06, 0.22, 0.1], [x, y + sheer, (z + nz) / 2],
          [0, Math.atan2(nz - z, len / 7), 0]);
      }
    }
  }
  b.box('planks', 0x6a5535, [len * 0.9, 0.1, w * 0.62], [0, 0.12, 0]);                 // bottom
  for (let i = 0; i < 3; i++) b.box('planks', PLANK_DARK, [0.5, 0.09, w * 0.8], [(i - 1) * 2.0, 0.72, 0]);  // thwarts
  b.box('planks', PLANK_DARK, [0.5, 0.5, 0.14], [-len / 2 + 0.2, 0.55, 0]);              // stem post
  b.box('planks', PLANK_DARK, [0.5, 0.5, 0.14], [len / 2 - 0.2, 0.55, 0]);
  b.cyl('logs', 0x7d6540, 0.05, 0.05, 3.4, [1.4, 0.95, 0.5], [0.2, 0.3, 1.45], 6);      // punt pole
  void rng;
  return b.emit('boat');
}

// ---------------- small props ----------------

function crossModel(rng: Rng): Object3D {
  const b = new Build();
  b.blob('drystone', DRY_TONE, 0.5, [0, 0.12, 0], 3, 0.5, 7);
  b.box('logs', 0x6f5636, [0.16, 2.3, 0.16], [0, 1.2, 0]);
  b.box('logs', 0x6f5636, [1.15, 0.15, 0.14], [0, 1.85, 0]);
  b.wedge('shingle', SHINGLE_TONE, [1.0, 0.28, 0.5], [0, 2.15, 0]);                    // little rain roof
  b.box('iron', IRON_TONE, [0.22, 0.3, 0.03], [0, 1.62, 0.09]);
  void rng;
  return b.emit('cross');
}

/** Alpine drying rack (Histe/Heinzen): poles with crossbars and drying hay. */
function hayrack(rng: Rng): Object3D {
  const b = new Build();
  for (let i = 0; i < 4; i++) {
    const x = (i - 1.5) * 0.75;
    b.cyl('logs', 0x7d6540, 0.06, 0.08, 2.7, [x, 1.35, 0], undefined, 6);
  }
  for (let j = 0; j < 4; j++) b.box('logs', 0x6f5636, [2.6, 0.07, 0.07], [0, 0.6 + j * 0.6, 0]);
  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < 3; i++) {
      const x = -0.9 + i * 0.9;
      b.blob('thatch', THATCH_TONE, 0.45, [x, 0.75 + j * 0.6, (rng.next() - 0.5) * 0.2], i + j * 3, 0.6, 6);
    }
  }
  return b.emit('hayrack');
}

function fenceModel(rng: Rng): Object3D {
  const b = new Build();
  const len = 3;
  for (let i = 0; i < 2; i++) {
    const x = -len / 2 + i * len;
    b.cyl('logs', 0x7d6540, 0.07, 0.09, 1.15, [x, 0.55, 0], [0, 0, (rng.next() - 0.5) * 0.08], 6);
  }
  for (const y of [0.4, 0.72, 1.0]) b.box('logs', 0x8a7048, [len, 0.09, 0.06], [0, y, 0], [0, 0, (rng.next() - 0.5) * 0.02]);
  return b.emit('fence');
}

function well(rng: Rng): Object3D {
  const b = new Build();
  for (let course = 0; course < 2; course++) {
    const n = 7;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + course * 0.4;
      b.blob('drystone', course % 2 ? DRY_TONE : 0x928c81, 0.34, [Math.cos(a) * 0.95, 0.2 + course * 0.45, Math.sin(a) * 0.95], i + course * n, 0.6, 5);
    }
  }
  b.cyl('drystone', DRY_TONE, 0.98, 1.0, 0.9, [0, 0.45, 0], undefined, 12);
  b.cyl('planks', 0x1b1710, 0.86, 0.86, 0.1, [0, 0.86, 0], undefined, 12);
  for (const s of [-1, 1]) b.cyl('logs', 0x7d6540, 0.08, 0.09, 1.9, [s * 0.85, 1.85, 0], undefined, 6);
  b.cyl('logs', 0x6f5636, 0.09, 0.09, 1.9, [0, 2.75, 0], [0, 0, Math.PI / 2], 6);
  b.box('planks', PLANK_TONE, [0.35, 0.3, 0.35], [0.3, 2.75, 0]);                       // windlass drum
  b.cyl('iron', IRON_TONE, 0.012, 0.012, 1.0, [0, 2.25, 0], undefined, 5);
  b.cyl('planks', 0x6a5535, 0.19, 0.16, 0.3, [0, 1.85, 0], undefined, 8);               // bucket
  gableRoof(b, 2.3, 2.3, 0.75, 2.85, { overhang: 0.35, weights: false });
  void rng;
  return b.emit('well');
}

function gallowsPole(rng: Rng): Object3D {
  const b = new Build();
  b.blob('drystone', DRY_TONE, 0.75, [0, 0.15, 0], 5, 0.4, 8);
  b.cyl('logs', 0x6f5636, 0.11, 0.16, 4.6, [0, 2.3, 0], undefined, 8);
  b.box('logs', 0x6f5636, [0.6, 0.12, 0.12], [0.2, 4.5, 0]);
  // Gessler's hat sits in its own Group: settlements.ts toggles the first child Group's visibility.
  const hatB = new Build();
  hatB.cyl('cloth', 0x3a3f52, 0.5, 0.52, 0.07, [0, 4.62, 0], undefined, 12);
  hatB.cyl('cloth', 0x3a3f52, 0.3, 0.36, 0.34, [0, 4.83, 0], undefined, 10);
  hatB.box('iron', 0xb8912e, [0.16, 0.16, 0.04], [0, 4.68, 0.34]);
  const hat = new Group();
  hat.name = 'gessler-hat';
  for (const m of hatB.meshes()) hat.add(m);
  void rng;
  return b.emit('gallows.pole', [hat]);
}

function campfire(rng: Rng): Object3D {
  const b = new Build();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.blob('rock', 0xb2ada1, 0.22, [Math.cos(a) * 0.58, 0.1, Math.sin(a) * 0.58], i, 0.6, 6);
  }
  for (let i = 0; i < 4; i++) {
    const a = (Math.PI / 4) * i;
    b.cyl('logs', 0x54432a, 0.06, 0.08, 0.95, [0, 0.14, 0], [0, a, Math.PI / 2 - 0.15], 6);
  }
  b.blob('rock', 0x50463a, 0.28, [0, 0.06, 0], 9, 0.35, 7);                             // ash bed
  b.cyl('fire', 0xffa040, 0.02, 0.22, 0.6, [0, 0.42, 0], undefined, 6);
  b.cyl('fire', 0xffd070, 0.02, 0.13, 0.34, [0, 0.3, 0.06], undefined, 6);
  void rng;
  return b.emit('campfire');
}

function tent(rng: Rng): Object3D {
  const w = 2.8, d = 3.4, h = 2.0;
  const b = new Build();
  b.wedge('cloth', 0xc9bb99, [w, h, d], [0, 0, 0]);
  b.box('cloth', 0xb5a487, [w * 0.98, 0.06, d * 0.98], [0, 0.03, 0]);
  b.cyl('logs', 0x7d6540, 0.05, 0.06, h + 0.5, [0, (h + 0.5) / 2, d / 2 + 0.15], undefined, 6);
  b.cyl('logs', 0x7d6540, 0.05, 0.06, h + 0.5, [0, (h + 0.5) / 2, -d / 2 - 0.15], undefined, 6);
  b.cyl('logs', 0x6f5636, 0.04, 0.04, d + 0.6, [0, h + 0.2, 0], [Math.PI / 2, 0, 0], 6);
  for (const s of [-1, 1]) for (const z of [-1, 1]) {
    b.cyl('logs', 0x54432a, 0.03, 0.03, 0.5, [s * (w / 2 + 0.35), 0.2, z * d * 0.3], [0.4 * s, 0, 0.35 * s], 5);
  }
  void rng;
  return b.emit('tent');
}

function cart(rng: Rng): Object3D {
  const b = new Build();
  b.box('planks', PLANK_TONE, [2.5, 0.16, 1.4], [0, 0.92, 0]);
  for (let i = 0; i < 6; i++) b.box('planks', i % 2 ? PLANK_TONE : 0x7a6440, [2.5, 0.35, 0.1], [0, 1.14, -0.7 + (i / 5) * 1.4]);
  for (const s of [-1, 1]) {
    b.box('planks', PLANK_DARK, [2.5, 0.42, 0.09], [0, 1.2, s * 0.72]);
    b.box('logs', 0x6f5636, [0.12, 0.5, 0.12], [-1.1, 1.0, s * 0.7]);
  }
  for (const s of [-1, 1]) {
    b.cyl('logs', 0x6f5636, 0.55, 0.55, 0.12, [0.55, 0.6, s * 0.78], [0, 0, Math.PI / 2], 12);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI;
      b.box('logs', 0x8a7048, [0.06, 1.02, 0.06], [0.55, 0.6, s * 0.78], [a, 0, 0]);
    }
    b.cyl('iron', IRON_TONE, 0.58, 0.58, 0.06, [0.55, 0.6, s * 0.86], [0, 0, Math.PI / 2], 12);
  }
  b.box('logs', 0x7d6540, [2.0, 0.11, 0.11], [-2.0, 0.95, 0.35]);
  b.box('logs', 0x7d6540, [2.0, 0.11, 0.11], [-2.0, 0.95, -0.35]);
  void rng;
  return b.emit('cart');
}

function signpost(rng: Rng): Object3D {
  const b = new Build();
  b.blob('drystone', DRY_TONE, 0.35, [0, 0.1, 0], 2, 0.5, 6);
  b.cyl('logs', 0x7d6540, 0.09, 0.11, 2.5, [0, 1.25, 0], undefined, 7);
  for (let i = 0; i < 2; i++) {
    const y = 2.0 - i * 0.42;
    const yaw = i === 0 ? 0.25 : -0.9;
    b.box('planks', PLANK_TONE, [1.0, 0.24, 0.05], [Math.cos(yaw) * 0.5, y, -Math.sin(yaw) * 0.5], [0, yaw, 0]);
  }
  b.wedge('shingle', SHINGLE_TONE, [0.5, 0.2, 0.4], [0, 2.5, 0]);
  void rng;
  return b.emit('signpost');
}

function rockModel(rng: Rng, big: boolean): Object3D {
  const b = new Build();
  const r = big ? 1.7 + rng.next() * 0.7 : 0.5 + rng.next() * 0.3;
  const seed = Math.floor(rng.next() * 1000);
  b.blob('rock', 0xb9b3a6, r, [0, r * 0.55, 0], seed, 0.78, big ? 10 : 7);
  if (big) {
    b.blob('rock', 0xaea89b, r * 0.5, [r * 0.7, r * 0.35, r * 0.3], seed + 1, 0.7, 7);
    b.blob('rock', 0xc2bcae, r * 0.35, [-r * 0.8, r * 0.25, -r * 0.2], seed + 2, 0.7, 6);
  }
  return b.emit(big ? 'rock.large' : 'rock.small');
}

function stump(rng: Rng): Object3D {
  const b = new Build();
  const r = 0.36 + rng.next() * 0.1;
  b.cyl('logs', 0x6b5637, r * 0.92, r * 1.1, 0.62, [0, 0.31, 0], undefined, 9);
  b.cyl('logs', 0x9c8156, r * 0.92, r * 0.92, 0.05, [0, 0.62, 0], undefined, 9);        // sawn face
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rng.next();
    b.cyl('logs', 0x5d4a2e, 0.07, 0.13, 0.5, [Math.cos(a) * r * 0.9, 0.1, Math.sin(a) * r * 0.9], [Math.sin(a) * 1.2, 0, -Math.cos(a) * 1.2], 5);
  }
  return b.emit('stump');
}

// ---------------- weapons & shields (standalone; the in-hand copies live in characters.ts) ----------------

/** Grip at the origin, blade up +Y — the same convention the hand-slot geometry uses. */
function weaponModel(kind: string): Object3D {
  const b = new Build();
  const HAFT = 0x8f7a5c, STEEL = 0xa9b0b8;
  switch (kind) {
    case 'spiess':
      b.cyl('logs', HAFT, 0.021, 0.023, 2.05, [0, 0.60, 0], undefined, 7);
      b.cyl('iron', STEEL, 0.004, 0.036, 0.33, [0, 1.79, 0], undefined, 6);
      break;
    case 'halberd':
      b.cyl('logs', HAFT, 0.023, 0.026, 1.78, [0, 0.42, 0], undefined, 7);
      b.cyl('iron', STEEL, 0.005, 0.032, 0.30, [0, 1.45, 0], undefined, 6);
      b.box('iron', STEEL, [0.24, 0.30, 0.012], [0.135, 1.14, 0]);
      b.box('iron', STEEL, [0.13, 0.07, 0.011], [-0.075, 1.20, 0]);
      break;
    case 'crossbow':
      b.box('logs', HAFT, [0.055, 0.60, 0.05], [0, 0.16, 0]);
      b.box('iron', STEEL, [0.66, 0.028, 0.022], [0, 0.40, 0]);
      b.box('iron', STEEL, [0.03, 0.02, 0.10], [0, 0.45, 0]);
      break;
    case 'sword':
      b.cyl('logs', 0x503a26, 0.019, 0.019, 0.18, [0, -0.03, 0], undefined, 6);
      b.box('iron', STEEL, [0.21, 0.024, 0.028], [0, 0.09, 0]);
      b.box('iron', STEEL, [0.052, 0.78, 0.013], [0, 0.50, 0]);
      b.blob('iron', STEEL, 0.032, [0, -0.15, 0], 3, 0.9, 6);
      break;
    case 'dagger':
      b.cyl('logs', 0x503a26, 0.016, 0.016, 0.12, [0, -0.04, 0], undefined, 6);
      b.box('iron', STEEL, [0.10, 0.018, 0.02], [0, 0.05, 0]);
      b.box('iron', STEEL, [0.032, 0.30, 0.009], [0, 0.20, 0]);
      break;
    default: // staff
      b.cyl('logs', HAFT, 0.021, 0.024, 1.70, [0, 0.20, 0], undefined, 7);
      break;
  }
  return b.emit(`weapon.${kind}`);
}

function shieldModel(kind: string): Object3D {
  const b = new Build();
  if (kind === 'buckler') {
    b.cyl('planks', 0x7a6240, 0.15, 0.15, 0.03, [0, 0, 0], [Math.PI / 2, 0, 0], 12);
    b.blob('iron', 0xa9b0b8, 0.06, [0, 0, 0.04], 2, 0.7, 8);
    return b.emit('shield.buckler');
  }
  for (const [dy, w, h] of [[0.26, 0.52, 0.18], [0.08, 0.52, 0.18], [-0.10, 0.48, 0.18], [-0.26, 0.34, 0.16]] as [number, number, number][]) {
    b.box('planks', 0x7a6240, [w, h, 0.024], [0, dy, 0]);
  }
  b.blob('iron', 0xa9b0b8, 0.055, [0, 0.08, 0.03], 5, 0.6, 8);
  return b.emit('shield.heater');
}

function placeholder(): Object3D {
  const b = new Build();
  b.box('planks', 0xff00ff, [1, 1, 1], [0, 0.5, 0]);
  return b.emit('placeholder');
}

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
    this.register('church', (o) => church(o.rng));
    this.register('chapel', (o) => chapel(o.rng));
    this.register('monastery', (o) => monastery(o.rng));
    this.register('castle.keep', (o) => castleKeep(o.rng));
    this.register('castle.wall', (o) => castleWall(o.rng));
    this.register('castle.tower', (o) => castleTower(o.rng));
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
  fireMaterial?.dispose();
  fireMaterial = null;
}
