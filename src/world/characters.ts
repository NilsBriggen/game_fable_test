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
  Group, LoopOnce, Matrix4, Mesh, MeshStandardMaterial, Object3D, Quaternion, QuaternionKeyframeTrack,
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
        this.face(a, b, c); this.face(a, c, d);
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
      for (let i = 0; i < seg; i++) up ? this.face(centre, ring[i], ring[i + 1]) : this.face(centre, ring[i + 1], ring[i]);
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
      this.face(ia, ib, ic); this.face(ia, ic, id);
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

