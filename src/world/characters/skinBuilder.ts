/**
 * Skinned-geometry builder used by the character body (src/world/characters/body.ts): every primitive
 * writes position / normal / uv / vertex-colour / skinIndex / skinWeight straight into flat arrays, so one
 * material layer of a character is exactly one BufferGeometry.
 *
 * The workhorse is `grid`: a parametric surface `f(u, v)` sampled on a (rows × cols) lattice with normals
 * from central differences of `f` itself — that is what lets sculpted heads, pleated skirts, hair shells and
 * hat brims share one code path and still shade smoothly.
 */
import { BufferGeometry, Color, Float32BufferAttribute, Uint16BufferAttribute, Vector3 } from 'three';

export type Weight = [string, number];
export type Gain = [number, number, number];

export interface GridOpts {
  rows: number;                 // v subdivisions (rows + 1 vertex lines)
  cols: number;                 // u subdivisions
  closedU?: boolean;            // u wraps (rings): the last column duplicates the first for a clean seam
  weight: (u: number, v: number) => Weight[];
  color: number | ((u: number, v: number) => number);
  /** texture-space scale: uv = (u * uScale, v * vScale) in metres / uvScale */
  uScale?: number;
  vScale?: number;
  flip?: boolean;               // reverse winding (inside-out surfaces such as a brim's underside)
}

const _a = new Vector3(), _b = new Vector3(), _c = new Vector3(), _d = new Vector3(), _n = new Vector3();

export class SkinBuilder {
  private pos: number[] = [];
  private nrm: number[] = [];
  private uv: number[] = [];
  private col: number[] = [];
  private si: number[] = [];
  private sw: number[] = [];
  private idx: number[] = [];
  private tmp = new Color();
  /** Per-channel multiplier on every vertex colour: `map * vColor` is unclamped and the shared albedo maps
   *  are mid-grey, so the gain restores the painted level (see characterAssets.ts LAYER_GAIN). */
  gain: Gain = [1, 1, 1];

  constructor(private boneIndex: (name: string) => number, private uvScale = 0.35) {}

  get empty(): boolean { return this.pos.length === 0; }
  get triangles(): number { return this.idx.length / 3; }

  vertex(p: Vector3, n: Vector3, u: number, v: number, color: number, w: Weight[]): number {
    const i = this.pos.length / 3;
    this.pos.push(p.x, p.y, p.z);
    this.nrm.push(n.x, n.y, n.z);
    this.uv.push(u, v);
    this.tmp.set(color);
    this.col.push(this.tmp.r * this.gain[0], this.tmp.g * this.gain[1], this.tmp.b * this.gain[2]);
    let total = 0;
    for (const [, x] of w) total += x;
    for (let k = 0; k < 4; k++) {
      const e = w[k];
      this.si.push(e ? this.boneIndex(e[0]) : 0);
      this.sw.push(e ? e[1] / (total || 1) : 0);
    }
    return i;
  }

  face(a: number, b: number, c: number): void { this.idx.push(a, b, c); }

  /** Parametric surface. `f(u, v, out)` with u, v ∈ [0, 1]; the outward normal is ∂f/∂u × ∂f/∂v, so author
   *  surfaces with u running counter-clockwise seen from outside when v runs "up". */
  grid(f: (u: number, v: number, out: Vector3) => Vector3, o: GridOpts): void {
    const { rows, cols } = o;
    const du = 1 / cols, dv = 1 / rows;
    const eps = 1e-3;
    const uS = (o.uScale ?? 1) / this.uvScale, vS = (o.vScale ?? 1) / this.uvScale;
    const lattice: number[][] = [];
    for (let j = 0; j <= rows; j++) {
      const v = j * dv;
      const row: number[] = [];
      for (let i = 0; i <= cols; i++) {
        const u = i * du;
        const p = f(u, v, new Vector3());
        // central differences (one-sided at the v ends; wrap in u when closed)
        f(u + eps, v, _a); f(u - eps, v, _b);
        _c.subVectors(_a, _b);
        const v1 = Math.min(1, v + eps), v0 = Math.max(0, v - eps);
        f(u, v1, _a); f(u, v0, _b);
        _d.subVectors(_a, _b);
        _n.crossVectors(_c, _d);
        // eps² × a millimetre primitive is ~1e-17: only a truly degenerate tangent pair may fall back
        if (_n.lengthSq() < 1e-30) _n.set(0, 1, 0); else _n.normalize();
        if (o.flip) _n.negate();
        const color = typeof o.color === 'number' ? o.color : o.color(u, v);
        row.push(this.vertex(p, _n, u * uS, v * vS, color, o.weight(u, v)));
      }
      lattice.push(row);
    }
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const a = lattice[j][i], b = lattice[j][i + 1], c = lattice[j + 1][i + 1], d = lattice[j + 1][i];
        if (o.flip) { this.face(a, c, b); this.face(a, d, c); } else { this.face(a, b, c); this.face(a, c, d); }
      }
    }
  }

  /** Lofted vertical tube through elliptical sections (bottom → top), optional radial folds. */
  loft(sections: { y: number; rx: number; rz: number; cx?: number; cz?: number; w: Weight[]; color?: number; fold?: number }[],
    color: number, opts: { seg?: number; capTop?: boolean; capBottom?: boolean; folds?: number; phase?: number } = {}): void {
    const seg = opts.seg ?? 12;
    const k = opts.folds ?? 0, phase = opts.phase ?? 0;
    const n = sections.length;
    const sec = (v: number) => {
      const t = v * (n - 1);
      const s0 = Math.min(n - 1, Math.floor(t)), s1 = Math.min(n - 1, s0 + 1), f = t - s0;
      const a = sections[s0], b = sections[s1];
      const L = (x: number, y: number) => x + (y - x) * f;
      return { y: L(a.y, b.y), rx: L(a.rx, b.rx), rz: L(a.rz, b.rz), cx: L(a.cx ?? 0, b.cx ?? 0), cz: L(a.cz ?? 0, b.cz ?? 0),
        fold: L(a.fold ?? 0, b.fold ?? 0), s: f < 0.5 ? a : b };
    };
    const avgR = sections.reduce((s, x) => s + x.rx + x.rz, 0) / n / 2;
    const height = Math.abs(sections[n - 1].y - sections[0].y);
    this.grid((u, v, out) => {
      const s = sec(v);
      const a = -u * Math.PI * 2;                 // clockwise from +X so that ∂u × ∂v faces outward
      const r = 1 + (k ? s.fold * Math.sin(k * a + phase) : 0);
      return out.set(s.cx + Math.cos(a) * s.rx * r, s.y, s.cz + Math.sin(a) * s.rz * r);
    }, {
      rows: Math.max(1, n - 1), cols: seg, closedU: true,
      weight: (_u, v) => sec(v).s.w, color: (_u, v) => sec(v).s.color ?? color,
      uScale: Math.PI * 2 * avgR, vScale: height,
    });
    const cap = (s: typeof sections[number], up: boolean) => {
      const nn = new Vector3(0, up ? 1 : -1, 0);
      const centre = this.vertex(new Vector3(s.cx ?? 0, s.y, s.cz ?? 0), nn, 0, 0, s.color ?? color, s.w);
      const ring: number[] = [];
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        ring.push(this.vertex(new Vector3((s.cx ?? 0) + Math.cos(a) * s.rx, s.y, (s.cz ?? 0) + Math.sin(a) * s.rz),
          nn, Math.cos(a) * s.rx / this.uvScale, Math.sin(a) * s.rz / this.uvScale, s.color ?? color, s.w));
      }
      for (let i = 0; i < seg; i++) up ? this.face(centre, ring[i + 1], ring[i]) : this.face(centre, ring[i], ring[i + 1]);
    };
    if (opts.capTop) cap(sections[n - 1], true);
    if (opts.capBottom) cap(sections[0], false);
  }

  /** Tube along a → b with a radius profile (t ∈ [0, 1] along the axis), blended between two bones.
   *  `blend` = where along the tube the weight moves from boneA to boneB (default 0.55 → 0.95). */
  tube(a: Vector3, b: Vector3, profile: { t: number; r: number; color?: number }[], boneA: string, boneB: string, color: number,
    opts: { seg?: number; blend?: [number, number]; capEnd?: boolean; capStart?: boolean; squash?: number; up?: Vector3 } = {}): void {
    const seg = opts.seg ?? 8;
    const dir = new Vector3().subVectors(b, a);
    const len = dir.length() || 1e-4;
    dir.divideScalar(len);
    const up = opts.up ?? (Math.abs(dir.y) > 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0));
    const ax = new Vector3().crossVectors(up, dir).normalize();
    const az = new Vector3().crossVectors(dir, ax).normalize();
    const [b0, b1] = opts.blend ?? [0.55, 0.95];
    const sq = opts.squash ?? 1;
    const prof = (t: number) => {
      let i = 0;
      while (i + 1 < profile.length - 1 && profile[i + 1].t <= t) i++;
      const p = profile[i], q = profile[Math.min(profile.length - 1, i + 1)];
      const f = q.t === p.t ? 0 : Math.max(0, Math.min(1, (t - p.t) / (q.t - p.t)));
      return { r: p.r + (q.r - p.r) * f, color: (f < 0.5 ? p.color : q.color) ?? color };
    };
    const weight = (t: number): Weight[] => {
      const wB = Math.max(0, Math.min(1, (t - b0) / (b1 - b0)));
      return wB <= 0 ? [[boneA, 1]] : wB >= 1 ? [[boneB, 1]] : [[boneA, 1 - wB], [boneB, wB]];
    };
    const rows = Math.max(1, profile.length - 1);
    this.grid((u, v, out) => {
      const ang = u * Math.PI * 2;                // (ax, az, dir) is right-handed: counter-clockwise faces outward
      const { r } = prof(v);
      return out.copy(a).addScaledVector(dir, len * v).addScaledVector(ax, Math.cos(ang) * r).addScaledVector(az, Math.sin(ang) * r * sq);
    }, {
      rows, cols: seg, closedU: true, weight: (_u, v) => weight(v), color: (_u, v) => prof(v).color,
      uScale: Math.PI * 2 * profile[0].r, vScale: len,
    });
    const cap = (t: number, end: boolean) => {
      const { r, color: c } = prof(t);
      const centre = new Vector3().copy(a).addScaledVector(dir, len * t);
      const w = weight(t);
      const nn = end ? dir : dir.clone().negate();
      // rounded cap: a half-ellipsoid fan (rings of 2)
      const ring0: number[] = [], ring1: number[] = [];
      for (let i = 0; i <= seg; i++) {
        const ang = (i / seg) * Math.PI * 2;
        const rad = new Vector3().addScaledVector(ax, Math.cos(ang)).addScaledVector(az, Math.sin(ang) * sq);
        ring0.push(this.vertex(new Vector3().copy(centre).addScaledVector(rad, r), rad.clone().normalize(), i / seg, 0, c, w));
        const p1 = new Vector3().copy(centre).addScaledVector(rad, r * 0.6).addScaledVector(nn, r * 0.7);
        ring1.push(this.vertex(p1, rad.clone().multiplyScalar(0.6).addScaledVector(nn, 0.8).normalize(), i / seg, 0.5, c, w));
      }
      const tip = this.vertex(new Vector3().copy(centre).addScaledVector(nn, r * 0.95), nn.clone(), 0, 1, c, w);
      for (let i = 0; i < seg; i++) {
        if (end) { this.face(ring0[i], ring0[i + 1], ring1[i + 1]); this.face(ring0[i], ring1[i + 1], ring1[i]); this.face(ring1[i], ring1[i + 1], tip); }
        else { this.face(ring0[i], ring1[i + 1], ring0[i + 1]); this.face(ring0[i], ring1[i], ring1[i + 1]); this.face(ring1[i], tip, ring1[i + 1]); }
      }
    };
    if (opts.capEnd) cap(1, true);
    if (opts.capStart) cap(0, false);
  }

  /** Tapered cylinder between two joints (compat wrapper over `tube`). */
  limb(a: Vector3, b: Vector3, r0: number, r1: number, boneA: string, boneB: string, color: number,
    opts: { seg?: number; caps?: boolean; rows?: number } = {}): void {
    const rows = opts.rows ?? 2;
    const profile = [];
    for (let i = 0; i <= rows; i++) profile.push({ t: i / rows, r: r0 + (r1 - r0) * (i / rows) });
    this.tube(a, b, profile, boneA, boneB, color, { seg: opts.seg ?? 8 });
    if (opts.caps) {
      this.ball(b, r1 * 1.02, boneB, color, 6);
      this.ball(a, r0 * 1.02, boneA, color, 6);
    }
  }

  /** Ellipsoid; `r` may be uniform or per-axis. */
  ball(centre: Vector3, r: number | [number, number, number], bone: string, color: number, seg = 10, w?: Weight[]): void {
    const [rx, ry, rz] = typeof r === 'number' ? [r, r, r] : r;
    const rings = Math.max(3, Math.round(seg * 0.6));
    const ww: Weight[] = w ?? [[bone, 1]];
    this.grid((u, v, out) => {
      const th = -u * Math.PI * 2, phi = (1 - v) * Math.PI;   // clockwise so ∂u × ∂v faces outward
      return out.set(centre.x + Math.sin(phi) * Math.cos(th) * rx, centre.y + Math.cos(phi) * ry, centre.z + Math.sin(phi) * Math.sin(th) * rz);
    }, { rows: rings, cols: seg, closedU: true, weight: () => ww, color, uScale: Math.PI * 2 * rx, vScale: Math.PI * ry });
  }

  /** Axis-aligned-then-rotated box. */
  box(centre: Vector3, size: [number, number, number], quat: { x: number; y: number; z: number; w: number } | null, bone: string, color: number, w?: Weight[]): void {
    const [sx, sy, sz] = size;
    const ww: Weight[] = w ?? [[bone, 1]];
    const corners: Vector3[] = [];
    for (const dz of [-1, 1]) for (const dy of [-1, 1]) for (const dx of [-1, 1]) {
      const v = new Vector3(dx * sx / 2, dy * sy / 2, dz * sz / 2);
      if (quat) v.applyQuaternion(quat as never);
      corners.push(v.add(centre));
    }
    const quads: [number, number, number, number, Vector3][] = [
      [0, 1, 3, 2, new Vector3(0, 0, -1)], [4, 6, 7, 5, new Vector3(0, 0, 1)],
      [0, 2, 6, 4, new Vector3(-1, 0, 0)], [1, 5, 7, 3, new Vector3(1, 0, 0)],
      [2, 3, 7, 6, new Vector3(0, 1, 0)], [0, 4, 5, 1, new Vector3(0, -1, 0)],
    ];
    for (const [a, b, c, d, n0] of quads) {
      const n = quat ? n0.clone().applyQuaternion(quat as never) : n0;
      const ia = this.vertex(corners[a], n, 0, 0, color, ww);
      const ib = this.vertex(corners[b], n, sx / this.uvScale, 0, color, ww);
      const ic = this.vertex(corners[c], n, sx / this.uvScale, sy / this.uvScale, color, ww);
      const id = this.vertex(corners[d], n, 0, sy / this.uvScale, color, ww);
      this.face(ia, ic, ib); this.face(ia, id, ic);
    }
  }

  /** Flat triangle with its own face normal (winding a → b → c counter-clockwise seen from outside). */
  tri(a: Vector3, b: Vector3, c: Vector3, color: number, w: Weight[]): void {
    const n = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a)).normalize();
    const ia = this.vertex(a, n, 0, 0, color, w);
    const ib = this.vertex(b, n, 0.1, 0, color, w);
    const ic = this.vertex(c, n, 0, 0.1, color, w);
    this.face(ia, ib, ic);
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
