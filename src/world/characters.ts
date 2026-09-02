/**
 * `WorldService.spawnCharacter` and the `char.*` model factories: a skinned, animated humanoid per
 * archetype, dressed to LORE.md §7 (1291–1315).
 *
 * The mesh is authored here (proportioned body, head with face, hands, layered clothing, hat/hood,
 * weapon in the hand) and skinned to a skeleton whose *rotations* come from the CC0 KayKit "Rig_Medium"
 * clip pack (public/assets/characters/rig-medium.anims.bin) but whose *bone lengths* are retargeted to
 * adult human proportions — the pack's own proportions are toon (short legs, huge torso).
 * 2–3 draw calls per character: cloth, metal, mail; geometry is cached per look and shared.
 */
import {
  AnimationAction, AnimationClip, AnimationMixer, Bone, BufferGeometry, Color, Float32BufferAttribute,
  Group, LoopOnce, LoopRepeat, Matrix4, Mesh, MeshStandardMaterial, Object3D, Quaternion, QuaternionKeyframeTrack,
  Skeleton, SkinnedMesh, Uint16BufferAttribute, Vector3, VectorKeyframeTrack,
} from 'three';
import type { CharacterAnim, CharacterHandle } from '@core/services';
import { Rng, hashString } from '@core/rng';
import { loadRigAnims, propMaterial, type RigAnims } from './assets';

// ---------------------------------------------------------------------------------------------
// Skeleton: KayKit rest rotations, human bone lengths
// ---------------------------------------------------------------------------------------------

const san = (n: string) => n.replace(/[.\s]/g, '_');

/** Target bind-pose world positions (metres, T-pose) for a 1.75 m adult. */
const TARGET: Record<string, [number, number, number]> = {
  root: [0, 0, 0], hips: [0, 0.95, 0], spine: [0, 1.06, 0], chest: [0, 1.26, 0], head: [0, 1.50, 0],
  'upperarm.l': [0.18, 1.42, 0], 'lowerarm.l': [0.46, 1.42, 0], 'wrist.l': [0.70, 1.42, 0],
  'hand.l': [0.75, 1.42, 0], 'handslot.l': [0.82, 1.38, 0],
  'upperarm.r': [-0.18, 1.42, 0], 'lowerarm.r': [-0.46, 1.42, 0], 'wrist.r': [-0.70, 1.42, 0],
  'hand.r': [-0.75, 1.42, 0], 'handslot.r': [-0.82, 1.38, 0],
  'upperleg.l': [0.10, 0.92, 0], 'lowerleg.l': [0.10, 0.50, 0], 'foot.l': [0.10, 0.085, -0.02], 'toes.l': [0.10, 0.03, 0.11],
  'upperleg.r': [-0.10, 0.92, 0], 'lowerleg.r': [-0.10, 0.50, 0], 'foot.r': [-0.10, 0.085, -0.02], 'toes.r': [-0.10, 0.03, 0.11],
};
/** hips-height ratio target/source: scales the animated root+hips translation so the bob stays natural. */
const MOTION_SCALE = 1.21;

interface Rig {
  anims: RigAnims;
  order: string[];                       // bone order (== skin index order)
  bind: Map<string, { pos: Vector3; quat: Quaternion }>;   // retargeted bind-pose world transforms
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

function makeClips(anims: RigAnims, bind: Map<string, { pos: Vector3; quat: Quaternion }>): Map<string, AnimationClip> {
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
  void bind;
  return out;
}

function ensureRig(): Promise<Rig | null> {
  if (rig) return Promise.resolve(rig);
  if (rigLoading) return rigLoading;
  rigLoading = loadRigAnims().then((anims) => {
    if (!anims) return null;
    const bones = buildBones(anims);
    const bind = new Map<string, { pos: Vector3; quat: Quaternion }>();
    bones.forEach((b, i) => bind.set(anims.skeleton[i].name, {
      pos: b.getWorldPosition(new Vector3()), quat: b.getWorldQuaternion(new Quaternion()),
    }));
    const boneInverses = bones.map((b) => new Matrix4().copy(b.matrixWorld).invert());
    rig = { anims, order: anims.skeleton.map((b) => b.name), bind, boneInverses, clips: makeClips(anims, bind) };
    return rig;
  });
  return rigLoading;
}

/** Bind pose used while the clip pack is still loading (and if it never arrives). */
const FALLBACK_BIND = (() => {
  const m = new Map<string, { pos: Vector3; quat: Quaternion }>();
  for (const [k, v] of Object.entries(TARGET)) m.set(k, { pos: new Vector3(v[0], v[1], v[2]), quat: new Quaternion() });
  return m;
})();

// ---------------------------------------------------------------------------------------------
// Geometry builder (skinned, vertex-coloured)
// ---------------------------------------------------------------------------------------------

type Weight = [string, number];

class SkinBuilder {
  private pos: number[] = [];
  private nrm: number[] = [];
  private uv: number[] = [];
  private col: number[] = [];
  private si: number[] = [];
  private sw: number[] = [];
  private idx: number[] = [];
  private tmp = new Color();

  constructor(private boneIndex: (name: string) => number, private uvScale = 0.35) {}

  get empty(): boolean { return this.pos.length === 0; }

  private vertex(p: Vector3, n: Vector3, u: number, v: number, color: number, w: Weight[]): number {
    const i = this.pos.length / 3;
    this.pos.push(p.x, p.y, p.z);
    this.nrm.push(n.x, n.y, n.z);
    this.uv.push(u, v);
    this.tmp.set(color);
    this.col.push(this.tmp.r, this.tmp.g, this.tmp.b);
    let total = 0;
    for (const [, x] of w) total += x;
    for (let k = 0; k < 4; k++) {
      const e = w[k];
      this.si.push(e ? this.boneIndex(e[0]) : 0);
      this.sw.push(e ? e[1] / (total || 1) : 0);
    }
    return i;
  }

  private face(a: number, b: number, c: number): void { this.idx.push(a, b, c); }

  /** Lofted vertical tube through elliptical sections (bottom → top). Used for torsos, skirts, hats. */
  loft(sections: { y: number; rx: number; rz: number; cx?: number; cz?: number; w: Weight[]; color?: number }[],
    color: number, opts: { seg?: number; capTop?: boolean; capBottom?: boolean } = {}): void {
    const seg = opts.seg ?? 12;
    const rows: number[][] = [];
    for (let s = 0; s < sections.length; s++) {
      const sec = sections[s];
      const next = sections[Math.min(sections.length - 1, s + 1)];
      const prev = sections[Math.max(0, s - 1)];
      const dy = next.y - prev.y || 1;
      const dr = ((next.rx + next.rz) - (prev.rx + prev.rz)) / 2;
      const row: number[] = [];
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        const p = new Vector3((sec.cx ?? 0) + ca * sec.rx, sec.y, (sec.cz ?? 0) + sa * sec.rz);
        const n = new Vector3(ca * sec.rz, -dr / dy * ((sec.rx + sec.rz) / 2), sa * sec.rx).normalize();
        row.push(this.vertex(p, n, (a * (sec.rx + sec.rz) / 2) / this.uvScale, sec.y / this.uvScale, sec.color ?? color, sec.w));
      }
      rows.push(row);
    }
    for (let s = 0; s + 1 < rows.length; s++) {
      for (let i = 0; i < seg; i++) {
        const a = rows[s][i], b = rows[s][i + 1], c = rows[s + 1][i + 1], d = rows[s + 1][i];
        // wound so the outward face (analytic normal above) is the front face
        this.face(a, c, b); this.face(a, d, c);
      }
    }
    const cap = (sec: typeof sections[number], up: boolean) => {
      const n = new Vector3(0, up ? 1 : -1, 0);
      const centre = this.vertex(new Vector3(sec.cx ?? 0, sec.y, sec.cz ?? 0), n, 0, 0, sec.color ?? color, sec.w);
      const ring: number[] = [];
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        ring.push(this.vertex(new Vector3((sec.cx ?? 0) + Math.cos(a) * sec.rx, sec.y, (sec.cz ?? 0) + Math.sin(a) * sec.rz),
          n, Math.cos(a) * sec.rx / this.uvScale, Math.sin(a) * sec.rz / this.uvScale, sec.color ?? color, sec.w));
      }
      for (let i = 0; i < seg; i++) up ? this.face(centre, ring[i + 1], ring[i]) : this.face(centre, ring[i], ring[i + 1]);
    };
    if (opts.capTop) cap(sections[sections.length - 1], true);
    if (opts.capBottom) cap(sections[0], false);
  }

  /** Tapered cylinder between two joints, blended onto both bones near the far end. */
  limb(a: Vector3, b: Vector3, r0: number, r1: number, boneA: string, boneB: string, color: number,
    opts: { seg?: number; caps?: boolean } = {}): void {
    const seg = opts.seg ?? 8;
    const dir = new Vector3().subVectors(b, a);
    const len = dir.length() || 1e-4;
    dir.divideScalar(len);
    const up = Math.abs(dir.y) > 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
    const ax = new Vector3().crossVectors(up, dir).normalize();
    const az = new Vector3().crossVectors(dir, ax).normalize();
    const steps = 3;
    const rows: number[][] = [];
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const r = r0 + (r1 - r0) * t;
      const centre = new Vector3().copy(a).addScaledVector(dir, len * t);
      const wB = Math.max(0, Math.min(1, (t - 0.55) / 0.4));
      const w: Weight[] = wB <= 0 ? [[boneA, 1]] : wB >= 1 ? [[boneB, 1]] : [[boneA, 1 - wB], [boneB, wB]];
      const row: number[] = [];
      for (let i = 0; i <= seg; i++) {
        const ang = (i / seg) * Math.PI * 2;
        const n = new Vector3().addScaledVector(ax, Math.cos(ang)).addScaledVector(az, Math.sin(ang));
        row.push(this.vertex(new Vector3().copy(centre).addScaledVector(n, r), n, (ang * r) / this.uvScale, (len * t) / this.uvScale, color, w));
      }
      rows.push(row);
    }
    for (let s = 0; s + 1 < rows.length; s++) {
      for (let i = 0; i < seg; i++) {
        this.face(rows[s][i], rows[s][i + 1], rows[s + 1][i + 1]);
        this.face(rows[s][i], rows[s + 1][i + 1], rows[s + 1][i]);
      }
    }
    if (opts.caps !== false) {
      this.ball(b, r1 * 1.02, boneB, color, 6);
      this.ball(a, r0 * 1.02, boneA, color, 6);
    }
  }

  /** Ellipsoid; `r` may be uniform or per-axis. */
  ball(centre: Vector3, r: number | [number, number, number], bone: string, color: number, seg = 10, w?: Weight[]): void {
    const [rx, ry, rz] = typeof r === 'number' ? [r, r, r] : r;
    const rings = Math.max(4, Math.round(seg * 0.6));
    const ww: Weight[] = w ?? [[bone, 1]];
    const grid: number[][] = [];
    for (let j = 0; j <= rings; j++) {
      const phi = (j / rings) * Math.PI;
      const row: number[] = [];
      for (let i = 0; i <= seg; i++) {
        const th = (i / seg) * Math.PI * 2;
        const nx = Math.sin(phi) * Math.cos(th), ny = Math.cos(phi), nz = Math.sin(phi) * Math.sin(th);
        const p = new Vector3(centre.x + nx * rx, centre.y + ny * ry, centre.z + nz * rz);
        const n = new Vector3(nx / rx, ny / ry, nz / rz).normalize();
        row.push(this.vertex(p, n, (th * rx) / this.uvScale, (phi * ry) / this.uvScale, color, ww));
      }
      grid.push(row);
    }
    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < seg; i++) {
        this.face(grid[j][i], grid[j][i + 1], grid[j + 1][i + 1]);
        this.face(grid[j][i], grid[j + 1][i + 1], grid[j + 1][i]);
      }
    }
  }

  /** Axis-aligned-then-rotated box. */
  box(centre: Vector3, size: [number, number, number], quat: Quaternion | null, bone: string, color: number, w?: Weight[]): void {
    const [sx, sy, sz] = size;
    const ww: Weight[] = w ?? [[bone, 1]];
    const corners: Vector3[] = [];
    for (const dz of [-1, 1]) for (const dy of [-1, 1]) for (const dx of [-1, 1]) {
      const v = new Vector3(dx * sx / 2, dy * sy / 2, dz * sz / 2);
      if (quat) v.applyQuaternion(quat);
      corners.push(v.add(centre));
    }
    // faces as (i0,i1,i2,i3) quads on the 8 corners: order is x fastest, then y, then z
    const quads: [number, number, number, number, Vector3][] = [
      [0, 1, 3, 2, new Vector3(0, 0, -1)], [4, 6, 7, 5, new Vector3(0, 0, 1)],
      [0, 2, 6, 4, new Vector3(-1, 0, 0)], [1, 5, 7, 3, new Vector3(1, 0, 0)],
      [2, 3, 7, 6, new Vector3(0, 1, 0)], [0, 4, 5, 1, new Vector3(0, -1, 0)],
    ];
    for (const [a, b, c, d, n0] of quads) {
      const n = quat ? n0.clone().applyQuaternion(quat) : n0;
      const ia = this.vertex(corners[a], n, 0, 0, color, ww);
      const ib = this.vertex(corners[b], n, sx / this.uvScale, 0, color, ww);
      const ic = this.vertex(corners[c], n, sx / this.uvScale, sy / this.uvScale, color, ww);
      const id = this.vertex(corners[d], n, 0, sy / this.uvScale, color, ww);
      this.face(ia, ic, ib); this.face(ia, id, ic);
    }
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new Float32BufferAttribute(this.col, 3));
    g.setAttribute('skinIndex', new Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

// ---------------------------------------------------------------------------------------------
// Looks: archetype → period dress (LORE.md §7)
// ---------------------------------------------------------------------------------------------

type HeadWear = 'none' | 'hood' | 'cap' | 'eisenhut' | 'bascinet' | 'headcloth' | 'feltHat' | 'tonsure' | 'coif';

interface Look {
  cloth: number; trim: number; skin: number; hair: number;
  /** hem height in metres: 0.62 knee tunic, 0.15 long gown/habit */
  hem: number;
  head: HeadWear;
  mail?: boolean;
  plates?: boolean;
  surcoat?: boolean;          // Habsburg red-white-red
  apron?: number;             // apron colour
  cloak?: number;
  beard?: 'none' | 'short' | 'grey';
  female?: boolean;
  scale?: number;
  mainHand?: string;          // item id
  offHand?: string;           // item id
  mounted?: boolean;
}


// ---------------------------------------------------------------------------------------------
// Look table: archetype → 1291–1315 Alemannic dress (LORE.md §7)
// ---------------------------------------------------------------------------------------------

const SKIN_T = 0xd7a882;
const HAIR_BROWN = 0x4a3524;
const HAIR_GREY = 0x9c968c;
const LEATHER_C = 0x503a26;
const WOOD_C = 0x7a5f3c;
const STEEL_C = 0xa9b0b8;
const MAIL_C = 0x8d949c;
const BINDE_RED = 0xa11f28;   // Habsburg-Austrian Bindenschild red
const BINDE_WHITE = 0xe6e2d8;

/** Weapon kinds the hand slots understand (LORE.md §7 Act-1 list). */
export type WeaponKind = 'spiess' | 'halberd' | 'crossbow' | 'sword' | 'dagger' | 'staff' | 'axe' | 'none';
type ShieldKind = 'heater' | 'buckler' | 'none';

const BASE: Look = { cloth: 0xa79570, trim: 0x6d5e42, skin: SKIN_T, hair: HAIR_BROWN, hem: 0.62, head: 'none' };
const L = (o: Partial<Look>): Look => ({ ...BASE, ...o });

/** Every archetype id used by content/archetypes.ts, exploration's crowd and combat's squads. */
const LOOKS: Record<string, Look> = {
  peasant: L({ cloth: 0xa08a63, trim: 0x6a5a3f, head: 'hood', beard: 'short' }),
  'woman-peasant': L({ cloth: 0x7d6a86, trim: 0x5d4d66, hem: 0.10, head: 'headcloth', female: true, apron: 0xd9d2c0, scale: 0.95 }),
  child: L({ cloth: 0xa9986f, trim: 0x74653f, hem: 0.55, head: 'cap', scale: 0.66 }),
  herder: L({ cloth: 0x6f6a4e, trim: 0x4c4834, head: 'feltHat', mainHand: 'staff', beard: 'short' }),
  fisher: L({ cloth: 0x6c7a76, trim: 0x47524f, head: 'cap', mainHand: 'dagger' }),
  boatman: L({ cloth: 0x5b6a80, trim: 0x3d4757, head: 'cap', mainHand: 'staff' }),
  saeumer: L({ cloth: 0x8a6a44, trim: 0x5c452b, head: 'hood', mainHand: 'spiess', cloak: 0x6b5636, beard: 'short' }),
  elder: L({ cloth: 0x4c4a52, trim: 0x33323a, hem: 0.16, head: 'feltHat', beard: 'grey', hair: HAIR_GREY, mainHand: 'staff' }),
  monk: L({ cloth: 0x2f2c27, trim: 0x1d1b17, hem: 0.11, head: 'tonsure', hair: 0x6b6258 }),
  merchant: L({ cloth: 0x7a2f38, trim: 0x4d1d24, hem: 0.35, head: 'feltHat', cloak: 0x3b3a52, beard: 'short' }),
  innkeeper: L({ cloth: 0x7a4a34, trim: 0x543323, head: 'cap', apron: 0xc9c2ac, beard: 'short' }),
  'toll-collector': L({ cloth: 0x5f4a63, trim: 0x3f3143, hem: 0.40, head: 'cap' }),
  'militia-spear': L({ cloth: 0xbdb08d, trim: 0x5d6b46, head: 'eisenhut', mainHand: 'spiess', offHand: 'buckler', beard: 'short' }),
  'militia-halberd': L({ cloth: 0xb6a988, trim: 0x5d6b46, head: 'eisenhut', mainHand: 'halberd', beard: 'short' }),
  'militia-crossbow': L({ cloth: 0xb2a483, trim: 0x5d6b46, head: 'eisenhut', mainHand: 'crossbow' }),
  'habsburg-footman': L({ cloth: 0x8d8a84, trim: 0x5b5854, head: 'eisenhut', mail: true, surcoat: true, mainHand: 'spiess', offHand: 'heater' }),
  'habsburg-crossbowman': L({ cloth: 0xbdb08d, trim: 0x5b5854, head: 'eisenhut', mail: true, mainHand: 'crossbow' }),
  'habsburg-sergeant': L({ cloth: 0x8d8a84, trim: 0x5b5854, head: 'bascinet', mail: true, surcoat: true, plates: true, mainHand: 'sword', offHand: 'heater', beard: 'short' }),
  'habsburg-knight': L({ cloth: 0x8d8a84, trim: 0x5b5854, head: 'bascinet', mail: true, surcoat: true, plates: true, mainHand: 'sword', offHand: 'heater', mounted: true }),
  'habsburg-squire': L({ cloth: 0xa8a094, trim: 0x5b5854, head: 'coif', mail: true, mainHand: 'sword' }),
  'bailiff-guard': L({ cloth: 0x8d8a84, trim: 0x5b5854, head: 'eisenhut', mail: true, surcoat: true, mainHand: 'halberd' }),
  'abbey-man-at-arms': L({ cloth: 0x4a4640, trim: 0x2f2c27, head: 'coif', mail: true, mainHand: 'spiess', offHand: 'heater' }),
  raubritter: L({ cloth: 0x4f4238, trim: 0x342b24, head: 'bascinet', mail: true, mainHand: 'sword', offHand: 'heater', beard: 'short' }),
  player: L({ cloth: 0xcbb98f, trim: 0x8a7a58, head: 'hood', mainHand: 'dagger' }),
};

/** Archetype → look, tolerating both `peasant` and `char.peasant`, plus the loose ids combat coins. */
function lookFor(archetype: string): Look {
  const id = archetype.startsWith('char.') ? archetype.slice(5) : archetype;
  const direct = LOOKS[id];
  if (direct) return direct;
  if (id.includes('knight')) return LOOKS['habsburg-knight'];
  if (id.includes('sergeant')) return LOOKS['habsburg-sergeant'];
  if (id.includes('crossbow')) return LOOKS['militia-crossbow'];
  if (id.includes('halberd')) return LOOKS['militia-halberd'];
  if (id.includes('militia') || id.includes('guard') || id.includes('footman') || id.includes('man-at-arms')) return LOOKS['militia-spear'];
  if (id.includes('monk') || id.includes('abbot') || id.includes('priest')) return LOOKS.monk;
  if (id.includes('woman') || id.includes('frau')) return LOOKS['woman-peasant'];
  if (id.includes('merchant') || id.includes('innkeeper')) return LOOKS.merchant;
  return LOOKS.peasant;
}

// ---------------------------------------------------------------------------------------------
// Dressed body geometry
// ---------------------------------------------------------------------------------------------

const W_HIPS: Weight[] = [['hips', 1]];
const W_SPINE: Weight[] = [['spine', 1]];
const W_MID: Weight[] = [['spine', 0.5], ['chest', 0.5]];
const W_CHEST: Weight[] = [['chest', 1]];
const W_HEAD: Weight[] = [['head', 1]];

const V = (n: string): Vector3 => new Vector3(TARGET[n][0], TARGET[n][1], TARGET[n][2]);
const P = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);

export interface LookGeometry {
  cloth: BufferGeometry | null;
  hide: BufferGeometry | null;     // skin, hair, leather, wooden shafts, shield boards
  metal: BufferGeometry | null;
  mail: BufferGeometry | null;
  /** true when the look carries a horse (mounted) — the horse is a separate static mesh */
  mounted: boolean;
}

/** Places a weapon authored in the hand-slot's own local frame (grip at origin, blade along +Y —
 *  the convention the KayKit rig's `handslot.*` bones are authored for) into bind-pose world space. */
function slotFrame(bind: Map<string, { pos: Vector3; quat: Quaternion }>, slot: string):
{ at: (x: number, y: number, z: number) => Vector3; q: Quaternion } {
  const b = bind.get(slot) ?? { pos: V(slot), quat: new Quaternion() };
  return {
    at: (x: number, y: number, z: number) => new Vector3(x, y, z).applyQuaternion(b.quat).add(b.pos),
    q: b.quat,
  };
}

function buildHead(hide: SkinBuilder, metal: SkinBuilder, mail: SkinBuilder, cloth: SkinBuilder, look: Look): void {
  // neck + skull + face
  hide.limb(P(0, 1.38, 0), P(0, 1.50, 0), 0.058, 0.052, 'chest', 'head', look.skin, { seg: 8, caps: false });
  hide.ball(P(0, 1.585, 0.004), [0.098, 0.125, 0.107], 'head', look.skin, 12);
  hide.ball(P(0, 1.572, 0.096), [0.022, 0.032, 0.03], 'head', look.skin, 6);        // nose
  for (const s of [-1, 1]) hide.ball(P(s * 0.098, 1.585, -0.005), [0.02, 0.035, 0.022], 'head', look.skin, 6);
  const eye = 0x2b2118;
  for (const s of [-1, 1]) hide.ball(P(s * 0.042, 1.607, 0.082), [0.016, 0.014, 0.012], 'head', eye, 6);
  if (look.head === 'tonsure') {
    hide.loft([{ y: 1.60, rx: 0.101, rz: 0.110, w: W_HEAD }, { y: 1.645, rx: 0.086, rz: 0.094, w: W_HEAD }], look.hair, { seg: 12 });
  } else if (look.head !== 'coif' && look.head !== 'bascinet') {
    hide.ball(P(0, 1.615, -0.014), [0.104, 0.104, 0.116], 'head', look.hair, 12);   // hair cap
  }
  if (look.beard === 'short' || look.beard === 'grey') {
    hide.ball(P(0, 1.527, 0.052), [0.072, 0.055, 0.072], 'head', look.beard === 'grey' ? HAIR_GREY : look.hair, 8);
  }

  switch (look.head) {
    case 'eisenhut': // kettle hat: shallow dome + wide down-turned brim
      metal.ball(P(0, 1.628, 0), [0.122, 0.088, 0.128], 'head', STEEL_C, 12);
      metal.ball(P(0, 1.596, 0), [0.215, 0.028, 0.225], 'head', STEEL_C, 14);
      break;
    case 'bascinet':
      metal.ball(P(0, 1.60, -0.005), [0.118, 0.155, 0.126], 'head', STEEL_C, 12);
      metal.ball(P(0, 1.70, -0.02), [0.05, 0.06, 0.05], 'head', STEEL_C, 8);
      mail.loft([{ y: 1.56, rx: 0.125, rz: 0.132, w: W_HEAD }, { y: 1.44, rx: 0.15, rz: 0.15, w: W_HEAD },
        { y: 1.36, rx: 0.175, rz: 0.16, w: W_CHEST }], MAIL_C, { seg: 12 });
      break;
    case 'coif':
      mail.ball(P(0, 1.592, 0), [0.118, 0.135, 0.126], 'head', MAIL_C, 12);
      mail.loft([{ y: 1.50, rx: 0.128, rz: 0.132, w: W_HEAD }, { y: 1.40, rx: 0.16, rz: 0.15, w: W_CHEST },
        { y: 1.33, rx: 0.19, rz: 0.165, w: W_CHEST }], MAIL_C, { seg: 12 });
      break;
    case 'hood':
      cloth.ball(P(0, 1.60, -0.012), [0.124, 0.142, 0.136], 'head', look.trim, 12);
      cloth.ball(P(0, 1.655, -0.085), [0.055, 0.06, 0.075], 'head', look.trim, 8);   // liripipe point
      cloth.loft([{ y: 1.44, rx: 0.155, rz: 0.145, w: W_HEAD }, { y: 1.34, rx: 0.215, rz: 0.185, w: W_CHEST },
        { y: 1.22, rx: 0.245, rz: 0.205, w: W_CHEST }], look.trim, { seg: 12 });     // shoulder cape
      break;
    case 'cap':
      cloth.ball(P(0, 1.622, 0), [0.112, 0.078, 0.118], 'head', look.trim, 10);
      break;
    case 'feltHat':
      cloth.ball(P(0, 1.618, 0), [0.198, 0.024, 0.205], 'head', look.trim, 14);
      cloth.ball(P(0, 1.658, 0), [0.108, 0.078, 0.114], 'head', look.trim, 10);
      break;
    case 'headcloth':
      cloth.ball(P(0, 1.596, -0.006), [0.122, 0.132, 0.130], 'head', look.trim, 12);
      cloth.loft([{ y: 1.53, rx: 0.126, rz: 0.128, w: W_HEAD }, { y: 1.40, rx: 0.155, rz: 0.145, w: W_CHEST },
        { y: 1.30, rx: 0.16, rz: 0.15, w: W_CHEST }], look.trim, { seg: 12 });
      break;
    default: break;
  }
}

function buildWeapon(hide: SkinBuilder, metal: SkinBuilder, bind: Map<string, { pos: Vector3; quat: Quaternion }>,
  kind: WeaponKind): void {
  if (kind === 'none') return;
  const f = slotFrame(bind, 'handslot.r');
  const box = (b: SkinBuilder, c: Vector3, size: [number, number, number], color: number) =>
    b.box(c, size, f.q, 'handslot.r', color);
  switch (kind) {
    case 'spiess': // 2.5 m ash spear
      hide.limb(f.at(0, -0.55, 0), f.at(0, 1.62, 0), 0.021, 0.019, 'handslot.r', 'handslot.r', WOOD_C, { seg: 6, caps: false });
      metal.limb(f.at(0, 1.62, 0), f.at(0, 1.95, 0), 0.036, 0.004, 'handslot.r', 'handslot.r', STEEL_C, { seg: 6, caps: false });
      break;
    case 'halberd': // axe blade + spike on a 2 m haft (LORE §7)
      hide.limb(f.at(0, -0.62, 0), f.at(0, 1.30, 0), 0.024, 0.022, 'handslot.r', 'handslot.r', WOOD_C, { seg: 6, caps: false });
      metal.limb(f.at(0, 1.30, 0), f.at(0, 1.60, 0), 0.032, 0.005, 'handslot.r', 'handslot.r', STEEL_C, { seg: 6, caps: false });
      box(metal, f.at(0.135, 1.14, 0), [0.24, 0.30, 0.012], STEEL_C);
      box(metal, f.at(-0.075, 1.20, 0), [0.13, 0.07, 0.011], STEEL_C);   // rear hook
      break;
    case 'crossbow': // stirrup + belt hook only — no windlass (LORE §7)
      box(hide, f.at(0, 0.16, 0), [0.055, 0.60, 0.05], WOOD_C);
      box(metal, f.at(0, 0.40, 0), [0.66, 0.028, 0.022], STEEL_C);
      box(metal, f.at(0, 0.45, 0.0), [0.03, 0.02, 0.10], STEEL_C);
      break;
    case 'sword':
      hide.limb(f.at(0, -0.12, 0), f.at(0, 0.06, 0), 0.019, 0.018, 'handslot.r', 'handslot.r', LEATHER_C, { seg: 6 });
      box(metal, f.at(0, 0.09, 0), [0.21, 0.024, 0.028], STEEL_C);
      box(metal, f.at(0, 0.50, 0), [0.052, 0.78, 0.013], STEEL_C);
      metal.ball(f.at(0, -0.15, 0), 0.03, 'handslot.r', STEEL_C, 8);
      break;
    case 'dagger': // Schweizerdolch / Bauernwehr at the belt hand
      hide.limb(f.at(0, -0.10, 0), f.at(0, 0.02, 0), 0.016, 0.015, 'handslot.r', 'handslot.r', LEATHER_C, { seg: 6 });
      box(metal, f.at(0, 0.05, 0), [0.10, 0.018, 0.02], STEEL_C);
      box(metal, f.at(0, 0.20, 0), [0.032, 0.30, 0.009], STEEL_C);
      break;
    case 'axe':
      hide.limb(f.at(0, -0.30, 0), f.at(0, 0.40, 0), 0.021, 0.02, 'handslot.r', 'handslot.r', WOOD_C, { seg: 6, caps: false });
      box(metal, f.at(0.09, 0.38, 0), [0.18, 0.20, 0.014], STEEL_C);
      break;
    case 'staff':
      hide.limb(f.at(0, -0.75, 0), f.at(0, 0.95, 0), 0.022, 0.019, 'handslot.r', 'handslot.r', WOOD_C, { seg: 6, caps: false });
      break;
    default: break;
  }
}

function buildShield(hide: SkinBuilder, metal: SkinBuilder, cloth: SkinBuilder,
  bind: Map<string, { pos: Vector3; quat: Quaternion }>, kind: ShieldKind, habsburg: boolean): void {
  if (kind === 'none') return;
  const f = slotFrame(bind, 'handslot.l');
  if (kind === 'buckler') {
    hide.ball(f.at(0, 0.02, -0.09), [0.145, 0.145, 0.022], 'handslot.l', WOOD_C, 12);
    metal.ball(f.at(0, 0.02, -0.115), [0.055, 0.055, 0.045], 'handslot.l', STEEL_C, 8);
    return;
  }
  // heater shield: planked board, tapering to a point, painted with the bearer's colours
  const board = (dy: number, w: number, h: number, color: number) =>
    cloth.box(f.at(0, dy, -0.10), [w, h, 0.022], f.q, 'handslot.l', color);
  if (habsburg) {                     // red-white-red Bindenschild
    board(0.20, 0.42, 0.14, BINDE_RED);
    board(0.06, 0.42, 0.14, BINDE_WHITE);
    board(-0.08, 0.40, 0.14, BINDE_RED);
  } else {
    board(0.20, 0.42, 0.14, 0x6d5638);
    board(0.06, 0.42, 0.14, 0x6d5638);
    board(-0.08, 0.40, 0.14, 0x6d5638);
  }
  cloth.box(f.at(0, -0.20, -0.10), [0.26, 0.12, 0.022], f.q, 'handslot.l', habsburg ? BINDE_RED : 0x6d5638);
  metal.ball(f.at(0, 0.05, -0.122), [0.05, 0.05, 0.03], 'handslot.l', STEEL_C, 8);
}

/** Builds all four material layers of one look, in bind-pose (T-pose) world space. */
function buildLookGeometry(look: Look, boneIndex: (n: string) => number,
  bind: Map<string, { pos: Vector3; quat: Quaternion }>): LookGeometry {
  const cloth = new SkinBuilder(boneIndex, 0.30);
  const hide = new SkinBuilder(boneIndex, 0.26);
  const metal = new SkinBuilder(boneIndex, 0.20);
  const mail = new SkinBuilder(boneIndex, 0.09);

  const hem = look.hem;
  const female = !!look.female;

  // ---- legs: woollen hose, leather shoes ----
  for (const s of ['l', 'r'] as const) {
    cloth.limb(V(`upperleg.${s}`), V(`lowerleg.${s}`), 0.088, 0.062, `upperleg.${s}`, `lowerleg.${s}`, look.trim, { seg: 8 });
    cloth.limb(V(`lowerleg.${s}`), V(`foot.${s}`).setY(0.10), 0.062, 0.043, `lowerleg.${s}`, `foot.${s}`, look.trim, { seg: 8 });
    const fx = TARGET[`foot.${s}`][0];
    hide.box(P(fx, 0.048, 0.028), [0.10, 0.085, 0.235], null, `foot.${s}`, LEATHER_C);
    hide.box(P(fx, 0.030, 0.135), [0.088, 0.055, 0.09], null, `toes.${s}`, LEATHER_C);
  }

  // ---- body: tunic / gown, cut at `hem` ----
  const sections: { y: number; rx: number; rz: number; w: Weight[]; color?: number }[] = [];
  sections.push({ y: hem, rx: female ? 0.30 : 0.27, rz: female ? 0.22 : 0.20, w: W_HIPS });
  if (hem < 0.72) sections.push({ y: (hem + 0.92) / 2, rx: 0.235, rz: 0.175, w: W_HIPS });
  sections.push({ y: 0.94, rx: female ? 0.20 : 0.19, rz: 0.14, w: W_HIPS });
  sections.push({ y: 1.07, rx: female ? 0.165 : 0.178, rz: female ? 0.12 : 0.128, w: W_SPINE });
  sections.push({ y: 1.21, rx: female ? 0.195 : 0.197, rz: female ? 0.152 : 0.142, w: W_MID });
  sections.push({ y: 1.33, rx: 0.212, rz: 0.146, w: W_CHEST });
  sections.push({ y: 1.415, rx: 0.148, rz: 0.118, w: W_CHEST });
  cloth.loft(sections, look.cloth, { seg: 14, capBottom: true });

  // shoulders + arms (sleeves to the wrist, bare hands)
  for (const s of ['l', 'r'] as const) {
    cloth.ball(V(`upperarm.${s}`), [0.082, 0.078, 0.078], `chest`, look.cloth, 8);
    cloth.limb(V(`upperarm.${s}`), V(`lowerarm.${s}`), 0.066, 0.052, `upperarm.${s}`, `lowerarm.${s}`, look.cloth, { seg: 8 });
    cloth.limb(V(`lowerarm.${s}`), V(`wrist.${s}`), 0.052, 0.042, `lowerarm.${s}`, `wrist.${s}`, look.cloth, { seg: 8 });
    hide.ball(V(`hand.${s}`), [0.048, 0.038, 0.055], `hand.${s}`, look.skin, 8);
  }

  buildHead(hide, metal, mail, cloth, look);

  // ---- belt ----
  hide.loft([{ y: 0.925, rx: 0.196, rz: 0.147, w: W_HIPS }, { y: 0.968, rx: 0.198, rz: 0.149, w: W_HIPS }],
    LEATHER_C, { seg: 14 });

  if (look.apron !== undefined) {
    cloth.box(P(0, (hem + 0.95) / 2, 0.145), [0.34, 0.95 - hem, 0.02], null, 'hips', look.apron);
  }
  if (look.cloak !== undefined) {
    cloth.loft([{ y: 1.40, rx: 0.20, rz: 0.165, w: W_CHEST }, { y: 1.15, rx: 0.26, rz: 0.215, w: W_CHEST },
      { y: Math.max(0.55, hem + 0.1), rx: 0.29, rz: 0.245, w: W_HIPS }], look.cloak, { seg: 14 });
  }

  // ---- armour ----
  if (look.mail) {
    mail.loft([
      { y: 0.70, rx: 0.238, rz: 0.183, w: W_HIPS }, { y: 0.94, rx: 0.208, rz: 0.155, w: W_HIPS },
      { y: 1.07, rx: 0.196, rz: 0.142, w: W_SPINE }, { y: 1.22, rx: 0.214, rz: 0.157, w: W_MID },
      { y: 1.335, rx: 0.228, rz: 0.161, w: W_CHEST }, { y: 1.40, rx: 0.16, rz: 0.13, w: W_CHEST },
    ], MAIL_C, { seg: 14 });
    for (const s of ['l', 'r'] as const) {
      mail.limb(V(`upperarm.${s}`), V(`lowerarm.${s}`), 0.079, 0.062, `upperarm.${s}`, `lowerarm.${s}`, MAIL_C, { seg: 8 });
    }
  }
  if (look.plates) { // coat of plates: riveted horizontal bands over the mail
    metal.loft([{ y: 1.02, rx: 0.232, rz: 0.166, w: W_SPINE }, { y: 1.18, rx: 0.226, rz: 0.166, w: W_MID },
      { y: 1.34, rx: 0.238, rz: 0.170, w: W_CHEST }], 0x6d6f74, { seg: 14 });
  }
  if (look.surcoat) {
    cloth.loft([
      { y: 0.56, rx: 0.256, rz: 0.196, w: W_HIPS, color: BINDE_RED },
      { y: 0.92, rx: 0.222, rz: 0.168, w: W_HIPS, color: BINDE_RED },
      { y: 0.98, rx: 0.220, rz: 0.166, w: W_HIPS, color: BINDE_WHITE },
      { y: 1.14, rx: 0.222, rz: 0.164, w: W_SPINE, color: BINDE_WHITE },
      { y: 1.20, rx: 0.228, rz: 0.170, w: W_MID, color: BINDE_RED },
      { y: 1.35, rx: 0.244, rz: 0.176, w: W_CHEST, color: BINDE_RED },
    ], BINDE_RED, { seg: 14 });
  }

  const habsburg = !!look.surcoat;
  buildWeapon(hide, metal, bind, (look.mainHand ?? 'none') as WeaponKind);
  buildShield(hide, metal, cloth, bind, (look.offHand ?? 'none') as ShieldKind, habsburg);

  return {
    cloth: cloth.empty ? null : cloth.build(),
    hide: hide.empty ? null : hide.build(),
    metal: metal.empty ? null : metal.build(),
    mail: mail.empty ? null : mail.build(),
    mounted: !!look.mounted,
  };
}

// ---------------------------------------------------------------------------------------------
// Horse (mounted archetypes) — static, one extra draw call, shares the `hide` material
// ---------------------------------------------------------------------------------------------

let horseGeo: BufferGeometry | null = null;
function horseGeometry(): BufferGeometry {
  if (horseGeo) return horseGeo;
  const b = new SkinBuilder(() => 0, 0.4);
  const HIDE = 0x53412c, DARK = 0x2e2419;
  b.ball(P(0, 1.16, 0), [0.33, 0.36, 0.86], 'root', HIDE, 12);
  b.ball(P(0, 1.34, 0.68), [0.17, 0.30, 0.24], 'root', HIDE, 10);        // shoulder/neck base
  b.limb(P(0, 1.36, 0.70), P(0, 1.72, 1.02), 0.15, 0.10, 'root', 'root', HIDE, { seg: 8 });
  b.ball(P(0, 1.76, 1.13), [0.09, 0.11, 0.20], 'root', HIDE, 8);          // head
  b.ball(P(0, 1.70, 1.24), [0.07, 0.07, 0.09], 'root', DARK, 6);          // muzzle
  for (const s of [-1, 1]) b.ball(P(s * 0.06, 1.88, 1.04), [0.025, 0.05, 0.02], 'root', HIDE, 5);
  for (const [x, z] of [[-0.22, 0.55], [0.22, 0.55], [-0.24, -0.55], [0.24, -0.55]] as [number, number][]) {
    b.limb(P(x, 1.05, z), P(x, 0.36, z), 0.075, 0.045, 'root', 'root', HIDE, { seg: 6 });
    b.limb(P(x, 0.36, z), P(x, 0.06, z), 0.045, 0.05, 'root', 'root', DARK, { seg: 6 });
  }
  b.limb(P(0, 1.32, -0.80), P(0, 0.86, -1.02), 0.06, 0.03, 'root', 'root', DARK, { seg: 6 });  // tail
  b.box(P(0, 1.48, -0.02), [0.44, 0.10, 0.50], null, 'root', LEATHER_C);                        // saddle
  const g = b.build();
  g.deleteAttribute('skinIndex');
  g.deleteAttribute('skinWeight');
  horseGeo = g;
  g.dispose = () => {};
  return g;
}

// ---------------------------------------------------------------------------------------------
// Animation mapping (documented reuse — the CC0 pack has no period-specific clips)
// ---------------------------------------------------------------------------------------------

type ClipPick = { name: string; loop: boolean };

/** `CharacterAnim` → KayKit clip, per weapon class. Reuse is deliberate and listed here:
 *  - `talk` reuses `Interact` (a gesture with the free hand), `cheer` reuses `Cheering`;
 *  - `flee` reuses `Running_B` (arms higher, faster cadence) so a rout reads differently from a charge;
 *  - `brace` reuses `Melee_Blocking` for everyone, including polearms (shield-less troops plant the haft);
 *  - `shoot`/`reload` fall back to the melee attack for anyone not carrying a crossbow;
 *  - `dead` is the last frame of `Death_A` (`Death_A_Pose`), held. */
export function clipFor(anim: CharacterAnim, weapon: WeaponKind, seed: number): ClipPick {
  const twoHand = weapon === 'spiess' || weapon === 'halberd' || weapon === 'staff' || weapon === 'axe';
  const ranged = weapon === 'crossbow';
  switch (anim) {
    case 'idle':
      if (ranged) return { name: 'Holding_B', loop: true };
      if (twoHand) return { name: 'Melee_2H_Idle', loop: true };
      if (weapon === 'sword') return { name: 'Melee_Unarmed_Idle', loop: true };
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
    default: return { name: 'Idle_A', loop: true };
  }
}

// ---------------------------------------------------------------------------------------------
// Materials + geometry cache
// ---------------------------------------------------------------------------------------------

const geoCache = new Map<string, LookGeometry>();

function lookGeometry(key: string, look: Look, rigOrder: string[],
  bind: Map<string, { pos: Vector3; quat: Quaternion }>): LookGeometry {
  const hit = geoCache.get(key);
  if (hit) return hit;
  const index = new Map(rigOrder.map((n, i) => [n, i]));
  const built = buildLookGeometry(look, (n) => index.get(n) ?? 0, bind);
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

const CLOTH_MAT = () => propMaterial('wool', { roughness: 0.95 });
const HIDE_MAT = () => propMaterial('leather', { roughness: 0.85 });
const METAL_MAT = () => propMaterial('iron', { roughness: 0.42, metalness: 0.75 });
const MAIL_MAT = () => propMaterial('chainmail', { roughness: 0.5, metalness: 0.8 });

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
  private current: AnimationAction | null = null;
  private currentAnim: CharacterAnim | null = null;
  private locomotion: CharacterAnim = 'idle';
  private oneShotUntil = 0;
  private time = 0;
  private meshes: (Mesh | SkinnedMesh)[] = [];
  private skeleton: Skeleton | null = null;
  private disposed = false;
  private weapon: WeaponKind;
  private seed: number;
  /** speed inferred from how far the owner moved the object, when nobody calls setSpeed() */
  private lastPos = new Vector3();
  private autoSpeed = 0;
  private explicitSpeed = false;
  readonly createdAt = performance.now();

  constructor(private archetype: string, opts: { variant?: string; mounted?: boolean; seed?: number } = {}) {
    const look = lookFor(archetype);
    this.seed = opts.seed ?? hashString(archetype);
    this.weapon = (look.mainHand ?? 'none') as WeaponKind;
    this.object.name = `char.${archetype}`;
    const mounted = opts.mounted || opts.variant === 'mounted' || !!look.mounted;
    ensureRig().then((r) => {
      if (this.disposed) return;
      this.build(look, mounted, r);
    });
  }

  private build(look: Look, mounted: boolean, r: Rig | null): void {
    const order = r ? r.order : Object.keys(TARGET);
    const bind = r ? r.bind : FALLBACK_BIND;
    const key = `${this.archetype}|${mounted ? 'm' : ''}|${r ? 'rig' : 'fb'}`;
    const geo = lookGeometry(key, look, order, bind);

    const bones = r ? buildBones(r.anims) : fallbackBones(order);
    const root = bones.find((b) => b.parent === null || !(b.parent instanceof Bone)) ?? bones[0];
    const boneInverses = r ? r.boneInverses : bones.map((b) => new Matrix4().copy(b.matrixWorld).invert());
    const skeleton = new Skeleton(bones, boneInverses);
    this.skeleton = skeleton;
    const rigRoot = new Group();
    rigRoot.add(root);
    if (look.scale && look.scale !== 1) rigRoot.scale.setScalar(look.scale);
    this.object.add(rigRoot);

    const add = (g: BufferGeometry | null, mat: MeshStandardMaterial): void => {
      if (!g) return;
      const m = new SkinnedMesh(g, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      m.bind(skeleton, new Matrix4());
      rigRoot.add(m);
      this.meshes.push(m);
    };
    add(geo.cloth, CLOTH_MAT());
    add(geo.hide, HIDE_MAT());
    add(geo.metal, METAL_MAT());
    add(geo.mail, MAIL_MAT());

    if (mounted) {
      const horse = new Mesh(horseGeometry(), HIDE_MAT());
      horse.castShadow = true;
      horse.receiveShadow = true;
      this.object.add(horse);
      rigRoot.position.y = 1.30;                      // in the saddle
      rigRoot.scale.multiplyScalar(0.98);
      this.meshes.push(horse);
    }

    if (r) {
      this.mixer = new AnimationMixer(rigRoot);
      this.rigged = true;
      for (const [name, clip] of r.clips) {
        const a = this.mixer.clipAction(clip);
        a.enabled = true;
        this.actions.set(name, a);
      }
      const startAnim: CharacterAnim = mounted ? 'idle' : this.currentAnim ?? 'idle';
      if (mounted) {
        const sit = this.actions.get('Sit_Chair_Idle');
        if (sit) { sit.play(); this.current = sit; this.currentAnim = 'idle'; }
      } else {
        this.start(startAnim, 0);
      }
    }
    registerTicker(this);
  }

  /** crossfade into `anim`; returns when a one-shot has finished (immediately for loops). */
  play(anim: CharacterAnim, opts: { loop?: boolean; speed?: number; fade?: number } = {}): Promise<void> {
    const pick = clipFor(anim, this.weapon, this.seed);
    const loop = opts.loop ?? pick.loop;
    const dur = this.start(anim, opts.fade ?? 0.22, opts.speed ?? 1, loop);
    if (loop) return Promise.resolve();
    this.oneShotUntil = this.time + dur;
    return new Promise((resolve) => { this.pending.push({ at: this.oneShotUntil, resolve }); });
  }

  private pending: { at: number; resolve: () => void }[] = [];

  private start(anim: CharacterAnim, fade: number, speed = 1, loopOverride?: boolean): number {
    const pick = clipFor(anim, this.weapon, this.seed);
    const next = this.actions.get(pick.name);
    this.currentAnim = anim;
    if (!next) return 0.5;
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
    return next.getClip().duration / Math.max(0.05, speed);
  }

  /** Blend idle → walk → run from real velocity; timeScale keeps footfalls matched to ground speed. */
  setSpeed(mps: number): void {
    this.explicitSpeed = true;
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
    this.mixer?.update(dt);
    if (this.pending.length && this.time >= this.pending[0].at) {
      const done = this.pending.filter((p) => this.time >= p.at);
      this.pending = this.pending.filter((p) => this.time < p.at);
      for (const p of done) p.resolve();
      if (this.time >= this.oneShotUntil && this.currentAnim !== 'dead' && this.currentAnim !== 'down') {
        this.start(this.locomotion, 0.2);
      }
    }
  }

  setVisible(v: boolean): void { this.object.visible = v; }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.mixer?.stopAllAction();
    this.skeleton?.dispose();
    this.object.parent?.remove(this.object);
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

/** Archetype ids the look table covers (without the `char.` prefix). */
export const CHARACTER_ARCHETYPES = Object.keys(LOOKS);

/** Model ids the library registers so `spawnModel('char.<archetype>')` yields an animated character. */
export const CHARACTER_MODEL_IDS = Object.keys(LOOKS).map((id) => `char.${id}`);

export function characterModel(modelId: string, opts: { variant?: string; scale?: number; seed?: number } = {}): Object3D {
  const handle = spawnCharacter(modelId, { variant: opts.variant, seed: opts.seed });
  if (opts.scale && opts.scale !== 1) handle.object.scale.setScalar(opts.scale);
  return handle.object;
}

export function disposeCharacterCaches(): void {
  for (const c of [...live]) c.dispose();
  for (const g of geoCache.values()) {
    for (const b of [g.cloth, g.hide, g.metal, g.mail]) if (b) BufferGeometry.prototype.dispose.call(b);
  }
  geoCache.clear();
  if (horseGeo) { BufferGeometry.prototype.dispose.call(horseGeo); horseGeo = null; }
  rig = null;
  rigLoading = null;
}
