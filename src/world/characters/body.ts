/**
 * The dressed body: builds the four material layers of one look in bind-pose (T-pose) world space, at two
 * detail levels — `lod 0` (≤ ~3 000 triangles: sculpted head with brow / sockets / nose / jaw, eyes, ears,
 * hair and beard shells, hands with fingers, pleated hems, buckles and pouches) and `lod 1` (≤ ~800,
 * used beyond 25 m: the same silhouette with plain sections).
 *
 * Coordinates: metres, +Y up, the face looks down +Z, +X is the character's left. Bone names are the
 * KayKit Rig_Medium ones (see characters.ts TARGET for the joint positions everything is drawn around).
 */
import { Quaternion, Vector3, Euler } from 'three';
import { SkinBuilder, type Weight } from './skinBuilder';
import {
  BINDE_RED, BINDE_WHITE, LEATHER_C, LINEN, MAIL_C, SHOE_C, STEEL_C, WOOD_C, HAIR_GREY, shade,
  type Look, type ShieldKind, type WeaponKind,
} from './looks';
import { LAYER_GAIN } from '../characterAssets';

export type Bind = Map<string, { pos: Vector3; quat: Quaternion }>;

/** Target bind-pose world positions (metres, T-pose) for a 1.75 m adult. */
export const TARGET: Record<string, [number, number, number]> = {
  root: [0, 0, 0], hips: [0, 0.95, 0], spine: [0, 1.06, 0], chest: [0, 1.26, 0], head: [0, 1.50, 0],
  'upperarm.l': [0.18, 1.42, 0], 'lowerarm.l': [0.46, 1.42, 0], 'wrist.l': [0.70, 1.42, 0],
  'hand.l': [0.75, 1.42, 0], 'handslot.l': [0.82, 1.38, 0],
  'upperarm.r': [-0.18, 1.42, 0], 'lowerarm.r': [-0.46, 1.42, 0], 'wrist.r': [-0.70, 1.42, 0],
  'hand.r': [-0.75, 1.42, 0], 'handslot.r': [-0.82, 1.38, 0],
  'upperleg.l': [0.10, 0.92, 0], 'lowerleg.l': [0.10, 0.50, 0], 'foot.l': [0.10, 0.085, -0.02], 'toes.l': [0.10, 0.03, 0.11],
  'upperleg.r': [-0.10, 0.92, 0], 'lowerleg.r': [-0.10, 0.50, 0], 'foot.r': [-0.10, 0.085, -0.02], 'toes.r': [-0.10, 0.03, 0.11],
};

export interface LookGeometry {
  cloth: import('three').BufferGeometry | null;
  hide: import('three').BufferGeometry | null;     // skin, hair, leather, wooden shafts, shield boards, the horse
  metal: import('three').BufferGeometry | null;
  mail: import('three').BufferGeometry | null;
  /** true when the horse is baked into the `hide` layer */
  mounted: boolean;
  triangles: number;
}

const W_ROOT: Weight[] = [['root', 1]];
const W_HIPS: Weight[] = [['hips', 1]];
const W_SPINE: Weight[] = [['spine', 1]];
const W_MID: Weight[] = [['spine', 0.5], ['chest', 0.5]];
const W_CHEST: Weight[] = [['chest', 1]];
const W_HEAD: Weight[] = [['head', 1]];
const W_NECK: Weight[] = [['chest', 0.5], ['head', 0.5]];

const V = (n: string): Vector3 => new Vector3(TARGET[n][0], TARGET[n][1], TARGET[n][2]);
const P = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);
const smooth = (a: number, b: number, x: number): number => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const g = (x: number, c: number, w: number): number => Math.exp(-((x - c) * (x - c)) / (w * w));

/** saddle height: the rider's rig sits this far above the horse's ground plane. */
export const MOUNT_Y = 0.56;

// ---------------------------------------------------------------------------------------------
// Head
// ---------------------------------------------------------------------------------------------

interface Head {
  c: Vector3; rx: number; ry: number; rz: number; look: Look;
  /** surface point at (th, phi), th = 0 front, +th toward +X; phi = 0 top */
  at: (th: number, phi: number, off?: number, out?: Vector3) => Vector3;
  /** phi for a given unit height sy ∈ [-1, 1] */
  phiOf: (sy: number) => number;
}

/** The sculpted skull: an ellipsoid with a jaw taper, flattened face plane and gaussian features. */
function makeHead(look: Look): Head {
  const s = look.headScale ?? 1;
  const f = look.face;
  const female = !!look.female;
  const c = P(0, 1.585 + (s - 1) * 0.06, 0.006);
  const rx = 0.0765 * s * (female ? 0.96 : 1), ry = 0.117 * s, rz = 0.094 * s;
  const point = (th: number, phi: number, out: Vector3): Vector3 => {
    const sx = Math.sin(phi) * Math.sin(th), sy = Math.cos(phi), sz = Math.sin(phi) * Math.cos(th);
    const front = smooth(0.15, 0.75, sz);
    const ax = Math.abs(sx);
    let d = 0;
    d += 0.0065 * f.brow * front * g(sy, 0.34, 0.09) * smooth(0.85, 0.35, ax);                  // brow ridge
    d -= 0.011 * front * (g(sx, 0.40 * f.eyes, 0.19) + g(sx, -0.40 * f.eyes, 0.19)) * g(sy, 0.15, 0.13);   // eye sockets
    d += 0.006 * f.cheeks * g(sy, -0.06, 0.15) * g(ax, 0.72, 0.22) * smooth(0.05, 0.6, sz);   // cheekbones
    d += 0.010 * front * g(sy, -0.88, 0.15) * g(ax, 0, 0.4);                                  // chin
    d -= 0.003 * front * g(sy, -0.5, 0.1);                                                    // mouth hollow
    d -= 0.004 * g(sy, 0.3, 0.22) * g(ax, 0.9, 0.22) * smooth(-0.3, 0.2, sz);                 // temples
    d += 0.007 * g(sz, -0.9, 0.3) * g(sy, 0.05, 0.35);                                        // occiput
    d += 0.004 * front * g(sx, 0, 0.12) * g(sy, 0.05, 0.22);                                  // nose bridge
    if (female) d -= 0.003 * front * g(sy, 0.34, 0.1);
    // jaw taper below the cheekbones; the nape narrows too
    const t = smooth(-0.1, -1.0, sy);
    const fx = 1 - (0.30 / f.jaw) * t * t * (female ? 1.12 : 1);
    const fz = (sz < 0 ? 1 - 0.22 * t * t : 1) * (1 - 0.13 * front * smooth(0.45, 0.1, sy) * smooth(-0.95, -0.6, sy));
    const nx = sx / rx, ny = sy / ry, nz = sz / rz;
    const nl = Math.hypot(nx, ny, nz) || 1;
    return out.set(c.x + rx * sx * fx + (nx / nl) * d, c.y + ry * sy + (ny / nl) * d, c.z + rz * sz * fz + (nz / nl) * d);
  };
  const tmpA = new Vector3(), tmpB = new Vector3(), tmpC = new Vector3(), tmpD = new Vector3(), n = new Vector3();
  const at = (th: number, phi: number, off = 0, out = new Vector3()): Vector3 => {
    point(th, phi, out);
    if (off === 0) return out;
    const e = 1e-3;
    const p1 = Math.min(Math.PI - 1e-4, Math.max(1e-4, phi));
    point(th + e, p1, tmpA); point(th - e, p1, tmpB); point(th, Math.min(Math.PI, p1 + e), tmpC); point(th, Math.max(0, p1 - e), tmpD);
    n.crossVectors(tmpA.sub(tmpB), tmpC.sub(tmpD));
    // ∂th × ∂phi points inward for this parametrisation (th grows toward +X); flip to outward
    if (n.lengthSq() < 1e-30) n.set(0, 1, 0); else n.normalize().negate();
    return out.addScaledVector(n, off);
  };
  return { c, rx, ry, rz, look, at, phiOf: (sy) => Math.acos(Math.max(-1, Math.min(1, sy))) };
}

/**
 * A shell wrapped around the skull between `eMin(th)` and `eMax(th)` where e ∈ [0, 1] runs from the crown to
 * the equator and e > 1 hangs straight down by (e − 1) metres — hair, hoods, veils, coifs, helmets.
 */
function shell(b: SkinBuilder, h: Head, o: {
  eMin?: (th: number) => number; eMax: (th: number) => number; off: (th: number, e: number) => number;
  color: number; w: (e: number) => Weight[]; rows: number; cols: number; thMin?: number; thMax?: number; drop?: number;
}): void {
  const thMin = o.thMin ?? -Math.PI, thMax = o.thMax ?? Math.PI;
  const eq = Math.PI / 2 + 0.08;                 // the "equator" sits a little below the widest point
  b.grid((u, v, out) => {
    const th = thMax - u * (thMax - thMin);      // decreasing th so ∂u × ∂v faces outward
    const e0 = o.eMin ? o.eMin(th) : 0, e1 = o.eMax(th);
    const e = e0 + v * (e1 - e0);
    const off = o.off(th, e);
    if (e <= 1) return h.at(th, e * eq, off, out);
    h.at(th, eq, off, out);
    const hang = (e - 1) * (o.drop ?? 1);
    return out.set(out.x, out.y - hang, out.z);
  }, { rows: o.rows, cols: o.cols, weight: (_u, v) => o.w(v), color: o.color, uScale: 0.6, vScale: 0.3 });
}

function buildHead(hide: SkinBuilder, metal: SkinBuilder, mail: SkinBuilder, cloth: SkinBuilder, look: Look, lod: number): void {
  const h = makeHead(look);
  const hi = lod === 0;
  const skin = look.skin;
  const w = () => W_HEAD;

  // neck
  hide.tube(P(0, 1.39, 0.006), P(0, 1.50, 0.006), [{ t: 0, r: 0.058 }, { t: 1, r: 0.052 }], 'chest', 'head', skin,
    { seg: hi ? 8 : 6, blend: [0.25, 0.85] });

  // skull
  hide.grid((u, v, out) => h.at(Math.PI - u * Math.PI * 2, (1 - v) * Math.PI, 0, out),
    { rows: hi ? 12 : 6, cols: hi ? 20 : 8, closedU: true, weight: w, color: skin, uScale: 0.5, vScale: 0.35 });

  // nose: a wedge on the face plane
  const bridge = h.at(0, h.phiOf(0.16), 0.004);
  const tip = h.at(0, h.phiOf(-0.20), 0.026 * look.face.nose + 0.004);
  const alaL = h.at(0.16, h.phiOf(-0.27), 0.010);
  const alaR = h.at(-0.16, h.phiOf(-0.27), 0.010);
  const base = h.at(0, h.phiOf(-0.35), 0.005);
  const out = new Vector3(0, 0, 1);
  const tri = (a: Vector3, b: Vector3, c: Vector3, dir: Vector3) => {
    const n = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a));
    if (n.dot(dir) >= 0) hide.tri(a, b, c, skin, W_HEAD); else hide.tri(a, c, b, skin, W_HEAD);
  };
  tri(bridge, tip, alaL, new Vector3(0.5, 0, 1));
  tri(bridge, tip, alaR, new Vector3(-0.5, 0, 1));
  tri(tip, base, alaL, new Vector3(0.3, -1, 0.6));
  tri(tip, base, alaR, new Vector3(-0.3, -1, 0.6));
  void out;

  if (hi) {
    const eyeTh = 0.40 * look.face.eyes, eyePhi = h.phiOf(0.15);
    const white = 0xe8e2d8, dark = 0x241b14;
    for (const s of [1, -1]) {
      const e = h.at(s * eyeTh, eyePhi, -0.007);
      hide.ball(e, [0.0135, 0.0085, 0.0085], 'head', white, 5);
      hide.ball(h.at(s * eyeTh, eyePhi, 0.0025), [0.0055, 0.0055, 0.004], 'head', dark, 5);
      // brow
      const bq = new Quaternion().setFromEuler(new Euler(0, s * eyeTh * 0.9, s * 0.12));
      hide.box(h.at(s * eyeTh * 1.05, h.phiOf(0.30), 0.006), [0.036, 0.0065, 0.010], bq, 'head', look.hair);
      // ear
      hide.ball(h.at(s * 1.52, h.phiOf(0.02), 0.004), [0.010, 0.026, 0.017], 'head', skin, 5);
    }
    // lips
    hide.ball(h.at(0, h.phiOf(-0.50), 0.0015), [0.021, 0.0065, 0.007], 'head', shade(skin, 0.8, 1.12), 6);
  }

  // hair: a bob cut with a fringe (a helmet's padding hides it under the iron)
  const hat = look.head;
  const helmet = hat === 'eisenhut' || hat === 'bascinet' || hat === 'mailCoif';
  const hairLen = look.face.hairLen;
  if (hat === 'tonsure') {
    shell(hide, h, {
      eMin: () => 0.5, eMax: (th) => 0.7 + 0.35 * smooth(0.9, -0.2, Math.cos(th)), off: (th, e) => 0.012 + 0.004 * Math.sin(th * 9 + e * 5),
      color: look.hair, w, rows: hi ? 3 : 2, cols: hi ? 14 : 8,
    });
  } else if (!helmet && hat !== 'headcloth') {
    const front = (th: number) => smooth(-0.15, 0.85, Math.cos(th));
    const back = (th: number) => smooth(0.25, 0.9, -Math.cos(th));
    shell(hide, h, {
      eMax: (th) => { const fr = front(th), bk = back(th); return fr * 0.62 + (1 - fr - bk) * (0.94 + 0.09 * hairLen) + bk * (0.98 + 0.10 * hairLen); },
      off: (th, e) => 0.012 + 0.006 * e + (hi ? 0.004 * Math.sin(th * 8 + e * 4) : 0),
      color: look.hair, w, rows: hi ? 5 : 3, cols: hi ? 16 : 8,
    });
  }
  // beard: a patch over the jaw, thickening toward the chin and (full) hanging below it
  if (hi && look.beard && look.beard !== 'none') {
    const full = look.beard === 'full' || look.beard === 'grey';
    const colour = look.beard === 'grey' ? HAIR_GREY : look.hair;
    const thW = 1.3;
    hide.grid((u, v, o) => {
      const th = thW - u * 2 * thW;
      const side = smooth(0.35, 1, Math.abs(th) / thW);
      const syTop = -0.52 + 0.40 * side;                       // sideburns climb the cheek
      const phiTop = h.phiOf(syTop);
      const phi = phiTop + v * (Math.PI - phiTop);
      const thick = 0.004 + (full ? 0.024 : 0.012) * smooth(0.15, 0.9, v) * (1 - 0.5 * side) + 0.003 * Math.sin(th * 11 + v * 7);
      h.at(th, Math.min(Math.PI - 0.02, phi), thick, o);
      if (full && v > 0.8) o.y -= (v - 0.8) * 0.28;             // hangs 5–6 cm below the chin
      return o;
    }, { rows: 4, cols: 8, weight: w, color: colour, uScale: 0.3, vScale: 0.15 });
    // moustache
    hide.ball(h.at(0, h.phiOf(-0.42), 0.006), [0.03, 0.006, 0.008], 'head', colour, 6);
  }

  const seg = hi ? 12 : 8;
  switch (hat) {
    case 'eisenhut': {   // kettle hat: domed skull, wide down-sloping brim, padded coif under it
      const yb = 1.615 + (look.headScale ?? 1 - 1) * 0.05;
      metal.loft([
        { y: yb, rx: 0.122, rz: 0.128, w: W_HEAD }, { y: yb + 0.045, rx: 0.114, rz: 0.12, w: W_HEAD },
        { y: yb + 0.085, rx: 0.088, rz: 0.093, w: W_HEAD }, { y: yb + 0.112, rx: 0.045, rz: 0.048, w: W_HEAD },
      ], STEEL_C, { seg, capTop: true });
      const brim = (flip: boolean, dy: number) => metal.grid((u, v, o) => {
        const a = -u * Math.PI * 2;
        const r = 0.118 + v * 0.10;
        return o.set(Math.cos(a) * r, yb + dy - v * 0.045 + 0.006 * Math.sin(a * 2) * v, Math.sin(a) * r * 1.05);
      }, { rows: 2, cols: seg, closedU: true, weight: w, color: STEEL_C, flip, uScale: 1, vScale: 0.1 });
      brim(true, 0);
      if (hi) brim(false, -0.006);
      if (look.mail) mailCoif(mail, h, hi);
      else shell(cloth, h, { eMax: (th) => 0.6 + 0.5 * smooth(0.9, 0.2, Math.cos(th)), off: () => 0.022, color: LINEN, w, rows: 2, cols: hi ? 12 : 8 });
      break;
    }
    case 'bascinet': {   // pointed skull with an open face and a mail aventail
      const fr = (th: number) => smooth(0.2, 0.85, Math.cos(th));
      shell(metal, h, {
        eMax: (th) => 0.62 * fr(th) + 1.02 * (1 - fr(th)),
        off: (_th, e) => 0.02 + 0.045 * smooth(0.45, 0, e),
        color: STEEL_C, w, rows: hi ? 5 : 3, cols: seg,
      });
      mail.loft([
        { y: 1.36, rx: 0.20, rz: 0.175, w: W_CHEST, fold: 0.03 }, { y: 1.45, rx: 0.16, rz: 0.15, w: W_NECK, fold: 0.02 },
        { y: 1.53, rx: 0.128, rz: 0.134, w: W_HEAD, fold: 0.01 },
      ], MAIL_C, { seg, folds: hi ? 6 : 0 });
      break;
    }
    case 'mailCoif':
      mailCoif(mail, h, hi);
      break;
    case 'hood': {   // Gugel: cowl framing the face, shoulder cape with pleats, liripipe down the back
      const fr = (th: number) => smooth(0.2, 0.85, Math.cos(th));
      shell(cloth, h, {
        eMax: (th) => 0.60 * fr(th) + 1.09 * (1 - fr(th)),
        off: (th, e) => 0.028 + (hi ? 0.006 * Math.sin(th * 6 + e * 4) : 0),
        color: look.trim, w, rows: hi ? 5 : 3, cols: seg,
      });
      cloth.loft([
        { y: 1.22, rx: 0.25, rz: 0.21, w: W_CHEST, fold: 0.05 }, { y: 1.34, rx: 0.215, rz: 0.185, w: W_CHEST, fold: 0.03 },
        { y: 1.42, rx: 0.16, rz: 0.15, w: W_NECK, fold: 0.015 }, { y: 1.485, rx: 0.135, rz: 0.13, w: W_HEAD, fold: 0.01 },
      ], look.trim, { seg, folds: hi ? 6 : 0, phase: 0.4 });
      if (hi) {
        cloth.tube(P(0, 1.65, -0.11), P(0, 1.50, -0.23), [{ t: 0, r: 0.03 }, { t: 1, r: 0.022 }], 'head', 'head', look.trim, { seg: 6 });
        cloth.tube(P(0, 1.50, -0.23), P(0, 1.22, -0.25), [{ t: 0, r: 0.022 }, { t: 1, r: 0.011 }], 'head', 'chest', look.trim, { seg: 6, capEnd: true, blend: [0.3, 0.9] });
      }
      break;
    }
    case 'coif':   // linen coif tied under the chin — every working man's headwear
      shell(cloth, h, {
        eMax: (th) => 0.56 + 0.54 * smooth(0.9, 0.15, Math.cos(th)),
        off: (th, e) => 0.022 + (hi ? 0.003 * Math.sin(th * 7 + e * 3) : 0),
        color: LINEN, w, rows: hi ? 4 : 2, cols: seg,
      });
      if (hi) cloth.tube(P(0.075, 1.455, 0.03), P(-0.075, 1.455, 0.03), [{ t: 0, r: 0.007 }, { t: 1, r: 0.007 }], 'head', 'head', LINEN, { seg: 4 });
      break;
    case 'cap':    // round woollen cap with a rolled brim
      cloth.loft([
        { y: 1.615, rx: 0.121, rz: 0.129, w: W_HEAD }, { y: 1.64, rx: 0.126, rz: 0.134, w: W_HEAD }, { y: 1.66, rx: 0.118, rz: 0.125, w: W_HEAD },
        { y: 1.70, rx: 0.10, rz: 0.106, w: W_HEAD }, { y: 1.735, rx: 0.05, rz: 0.053, w: W_HEAD },
      ], look.trim, { seg, capTop: true });
      break;
    case 'feltHat': {   // low crowned felt hat, brim dipped at the front, hatband
      const yb = 1.64;
      cloth.loft([
        { y: yb, rx: 0.108, rz: 0.114, w: W_HEAD }, { y: yb + 0.03, rx: 0.106, rz: 0.112, w: W_HEAD, color: shade(look.trim, 0.55) },
        { y: yb + 0.05, rx: 0.104, rz: 0.11, w: W_HEAD }, { y: yb + 0.10, rx: 0.088, rz: 0.093, w: W_HEAD }, { y: yb + 0.125, rx: 0.04, rz: 0.042, w: W_HEAD },
      ], look.trim, { seg, capTop: true });
      const brim = (flip: boolean, dy: number) => cloth.grid((u, v, o) => {
        const a = -u * Math.PI * 2;
        const r = 0.104 + v * 0.105;
        return o.set(Math.cos(a) * r, yb + dy - v * (0.02 + 0.03 * Math.max(0, Math.sin(a) * -1)) + (hi ? 0.006 * Math.sin(a * 3) * v : 0), Math.sin(a) * r * 1.04);
      }, { rows: 2, cols: seg, closedU: true, weight: w, color: look.trim, flip, uScale: 1, vScale: 0.1 });
      brim(true, 0);
      if (hi) brim(false, -0.006);
      break;
    }
    case 'headcloth': {   // veil over the hair and a wimple round chin and neck — a married woman's dress
      const fr = (th: number) => smooth(0.2, 0.85, Math.cos(th));
      shell(cloth, h, {
        eMax: (th) => 0.55 * fr(th) + 1.19 * (1 - fr(th)),
        off: (th, e) => 0.02 + (hi ? 0.005 * Math.sin(th * 7 + e * 4) : 0),
        color: LINEN, w, rows: hi ? 5 : 3, cols: seg,
      });
      cloth.loft([
        { y: 1.35, rx: 0.135, rz: 0.125, w: W_CHEST, fold: 0.02 }, { y: 1.44, rx: 0.10, rz: 0.10, w: W_NECK, fold: 0.01 },
        { y: 1.50, rx: 0.092, rz: 0.098, w: W_HEAD, fold: 0.01 },
      ], LINEN, { seg: hi ? 12 : 8, folds: hi ? 6 : 0 });
      break;
    }
    default: break;
  }
}

function mailCoif(mail: SkinBuilder, h: Head, hi: boolean): void {
  const fr = (th: number) => smooth(0.2, 0.85, Math.cos(th));
  shell(mail, h, {
    eMax: (th) => 0.62 * fr(th) + 1.0 * (1 - fr(th)),
    off: () => 0.012, color: MAIL_C, w: () => W_HEAD, rows: hi ? 4 : 3, cols: hi ? 14 : 8,
  });
  mail.loft([
    { y: 1.34, rx: 0.21, rz: 0.18, w: W_CHEST, fold: 0.03 }, { y: 1.42, rx: 0.16, rz: 0.15, w: W_NECK, fold: 0.02 },
    { y: 1.50, rx: 0.118, rz: 0.122, w: W_HEAD, fold: 0.01 },
  ], MAIL_C, { seg: hi ? 12 : 8, folds: hi ? 6 : 0 });
}

// ---------------------------------------------------------------------------------------------
// Hands
// ---------------------------------------------------------------------------------------------

/** Palm-down hands (the rig's `handslot` hangs under the palm): a palm, four half-curled fingers, a thumb. */
function buildHand(hide: SkinBuilder, look: Look, side: 'l' | 'r', lod: number): void {
  const s = side === 'l' ? 1 : -1;
  const hand = `hand.${side}`, wrist = `wrist.${side}`;
  const skin = look.skin;
  const wy = 1.42;
  hide.box(P(s * 0.777, wy - 0.003, 0.002), [0.075, 0.03, 0.08], null, hand, skin);
  if (lod > 0) return;
  hide.tube(P(s * 0.69, wy, 0), P(s * 0.745, wy, 0), [{ t: 0, r: 0.037 }, { t: 1, r: 0.034 }], wrist, hand, skin, { seg: 6, blend: [0.4, 0.9], squash: 0.85 });
  const seg = 4;
  const lens = [1.0, 1.08, 1.0, 0.8];
  const zs = [0.029, 0.010, -0.009, -0.027];
  for (let i = 0; i < 4; i++) {
    const L = lens[i], z = zs[i];
    const a = P(s * 0.812, wy - 0.004, z), m = P(s * (0.812 + 0.03 * L), wy - 0.014, z), t = P(s * (0.812 + 0.042 * L), wy - 0.042 * L, z);
    hide.tube(a, m, [{ t: 0, r: 0.0095 }, { t: 1, r: 0.0088 }], hand, hand, skin, { seg, up: new Vector3(0, 0, 1) });
    hide.tube(m, t, [{ t: 0, r: 0.0088 }, { t: 1, r: 0.0072 }], hand, hand, skin, { seg, capEnd: true, up: new Vector3(0, 0, 1) });
  }
  hide.tube(P(s * 0.762, wy - 0.006, 0.038), P(s * 0.795, wy - 0.02, 0.066), [{ t: 0, r: 0.011 }, { t: 1, r: 0.0085 }], hand, hand, skin, { seg, capEnd: true });
}

// ---------------------------------------------------------------------------------------------
// Weapons, shields, belt kit
// ---------------------------------------------------------------------------------------------

/** Places a weapon authored in the hand-slot's own local frame (grip at origin, blade along +Y —
 *  the convention the KayKit rig's `handslot.*` bones are authored for) into bind-pose world space. */
function slotFrame(bind: Bind, slot: string): { at: (x: number, y: number, z: number) => Vector3; q: Quaternion } {
  const b = bind.get(slot) ?? { pos: V(slot), quat: new Quaternion() };
  return {
    at: (x: number, y: number, z: number) => new Vector3(x, y, z).applyQuaternion(b.quat).add(b.pos),
    q: b.quat,
  };
}

/** Sheathed sidearm at the right hip — how a Messer/Schweizerdolch is actually carried off the battlefield. */
function buildBeltDagger(hide: SkinBuilder, metal: SkinBuilder): void {
  const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.35);
  hide.box(P(-0.19, 0.80, 0.03), [0.05, 0.30, 0.025], q, 'hips', LEATHER_C);
  metal.box(P(-0.19, 0.945, 0.055), [0.035, 0.05, 0.02], q, 'hips', STEEL_C);
  hide.box(P(-0.19, 0.985, 0.07), [0.028, 0.09, 0.022], q, 'hips', 0x3a2a1c);
}

function buildWeapon(hide: SkinBuilder, metal: SkinBuilder, bind: Bind, kind: WeaponKind, lod: number): void {
  if (kind === 'none') return;
  if (kind === 'dagger') { if (lod === 0) buildBeltDagger(hide, metal); return; }
  const f = slotFrame(bind, 'handslot.r');
  const seg = lod === 0 ? 6 : 4;
  const box = (b: SkinBuilder, c: Vector3, size: [number, number, number], color: number) => b.box(c, size, f.q, 'handslot.r', color);
  const haft = (y0: number, y1: number, r0: number, r1: number) =>
    hide.tube(f.at(0, y0, 0), f.at(0, y1, 0), [{ t: 0, r: r0 }, { t: 1, r: r1 }], 'handslot.r', 'handslot.r', WOOD_C, { seg });
  const spike = (y0: number, y1: number, r0: number) =>
    metal.tube(f.at(0, y0, 0), f.at(0, y1, 0), [{ t: 0, r: r0 }, { t: 1, r: 0.004 }], 'handslot.r', 'handslot.r', STEEL_C, { seg });
  switch (kind) {
    case 'spiess': // 2.5 m ash spear
      haft(-0.42, 1.62, 0.021, 0.019);
      spike(1.62, 1.95, 0.034);
      break;
    case 'halberd': // axe blade + spike on a 2 m haft (LORE §7)
      haft(-0.46, 1.30, 0.024, 0.022);
      spike(1.30, 1.60, 0.03);
      box(metal, f.at(0.135, 1.14, 0), [0.24, 0.30, 0.012], STEEL_C);
      box(metal, f.at(-0.075, 1.20, 0), [0.13, 0.07, 0.011], STEEL_C);   // rear hook
      break;
    case 'crossbow': // stirrup + belt hook only — no windlass (LORE §7)
      box(hide, f.at(0, 0.16, 0), [0.055, 0.60, 0.05], WOOD_C);
      box(metal, f.at(0, 0.40, 0), [0.66, 0.028, 0.022], STEEL_C);
      box(metal, f.at(0, 0.45, 0.0), [0.03, 0.02, 0.10], STEEL_C);
      break;
    case 'sword':
      hide.tube(f.at(0, -0.12, 0), f.at(0, 0.06, 0), [{ t: 0, r: 0.019 }, { t: 1, r: 0.018 }], 'handslot.r', 'handslot.r', LEATHER_C, { seg });
      box(metal, f.at(0, 0.09, 0), [0.21, 0.024, 0.028], STEEL_C);
      box(metal, f.at(0, 0.50, 0), [0.052, 0.78, 0.013], STEEL_C);
      metal.ball(f.at(0, -0.15, 0), 0.03, 'handslot.r', STEEL_C, seg);
      break;
    case 'axe':
      haft(-0.30, 0.40, 0.021, 0.02);
      box(metal, f.at(0.09, 0.38, 0), [0.18, 0.20, 0.014], STEEL_C);
      break;
    case 'staff':
      haft(-0.75, 0.95, 0.022, 0.019);
      break;
    case 'lance':   // couched knightly lance (LORE §10 `item.lance`, mounted Habsburg kit only)
      haft(-0.9, 2.4, 0.038, 0.02);
      spike(2.4, 2.62, 0.026);
      metal.ball(f.at(0, -0.12, 0), [0.10, 0.05, 0.10], 'handslot.r', STEEL_C, seg);   // vamplate
      break;
    default: break;
  }
}

function buildShield(hide: SkinBuilder, metal: SkinBuilder, cloth: SkinBuilder, bind: Bind, kind: ShieldKind, habsburg: boolean, lod: number): void {
  if (kind === 'none') return;
  const f = slotFrame(bind, 'handslot.l');
  if (kind === 'buckler') {
    // a round wooden board with an iron boss: a short tube along the slot's -Z (the board's axis)
    hide.tube(f.at(0, 0.02, -0.075), f.at(0, 0.02, -0.105), [{ t: 0, r: 0.145 }, { t: 1, r: 0.145 }], 'handslot.l', 'handslot.l', WOOD_C,
      { seg: lod === 0 ? 12 : 8, capStart: true, capEnd: true });
    if (lod === 0) metal.ball(f.at(0, 0.02, -0.115), [0.055, 0.055, 0.045], 'handslot.l', STEEL_C, 6);
    return;
  }
  // heater shield: planked board, tapering to a point, painted with the bearer's colours
  const board = (dy: number, w: number, h: number, color: number) =>
    cloth.box(f.at(0, dy, -0.11), [w, h, 0.024], f.q, 'handslot.l', color);
  const hi = habsburg ? BINDE_RED : 0x7a6240, mid = habsburg ? BINDE_WHITE : 0x7a6240;
  board(0.26, 0.52, 0.18, hi);
  board(0.08, 0.52, 0.18, mid);
  board(-0.10, 0.48, 0.18, hi);
  board(-0.26, 0.34, 0.16, hi);
  cloth.box(f.at(0, -0.38, -0.11), [0.18, 0.12, 0.024], f.q, 'handslot.l', hi);
  if (lod === 0) metal.ball(f.at(0, 0.08, -0.135), [0.055, 0.055, 0.035], 'handslot.l', STEEL_C, 6);
}

// ---------------------------------------------------------------------------------------------
// Body
// ---------------------------------------------------------------------------------------------

type Section = { y: number; rx: number; rz: number; cx?: number; cz?: number; w: Weight[]; color?: number; fold?: number };

/** The far set keeps every other section (and the last), halving a loft's rows. */
const thin = (sec: Section[], hi: boolean): Section[] => hi ? sec : sec.filter((_, i) => i % 2 === 0 || i === sec.length - 1);

/** Builds all four material layers of one look, in bind-pose (T-pose) world space. */
export function buildLookGeometry(look: Look, boneIndex: (n: string) => number, bind: Bind, mounted = false, lod = 0): LookGeometry {
  const cloth = new SkinBuilder(boneIndex, 0.30);
  const hide = new SkinBuilder(boneIndex, 0.26);
  const metal = new SkinBuilder(boneIndex, 0.20);
  const mail = new SkinBuilder(boneIndex, 0.09);
  cloth.gain = LAYER_GAIN.cloth;
  hide.gain = LAYER_GAIN.hide;
  metal.gain = LAYER_GAIN.metal;
  mail.gain = LAYER_GAIN.mail;

  const hi = lod === 0;
  const hem = look.hem;
  const female = !!look.female;
  const seg = hi ? 12 : 6;          // armour / belt / cloak lofts
  const segT = hi ? 16 : 8;         // the tunic itself: 6 pleats need the samples
  const segL = hi ? 8 : 5;
  const FOLDS = hi ? 6 : 0;

  // ---- legs: woollen hose, leather turnshoes ----
  for (const s of ['l', 'r'] as const) {
    const up = V(`upperleg.${s}`), knee = V(`lowerleg.${s}`), ankle = V(`foot.${s}`).setY(0.11);
    const hose = look.trim;
    cloth.tube(up.clone().setY(up.y + 0.03), knee, [{ t: 0, r: 0.088 }, { t: 1, r: 0.066 }], `upperleg.${s}`, `lowerleg.${s}`, hose, { seg: segL, blend: [0.7, 1] });
    if (hi) cloth.ball(knee, [0.063, 0.06, 0.066], `lowerleg.${s}`, hose, 7, [[`upperleg.${s}`, 0.4], [`lowerleg.${s}`, 0.6]]);
    cloth.tube(knee, ankle, [{ t: 0, r: 0.064 }, { t: 0.5, r: 0.058 }, { t: 1, r: 0.044 }], `lowerleg.${s}`, `foot.${s}`, hose, { seg: segL, blend: [0.75, 1] });
    const fx = TARGET[`foot.${s}`][0];
    if (hi) {
      hide.tube(P(fx, 0.052, -0.075), P(fx, 0.032, 0.14), [{ t: 0, r: 0.042 }, { t: 0.35, r: 0.052 }, { t: 0.72, r: 0.047 }, { t: 1, r: 0.028 }],
        `foot.${s}`, `toes.${s}`, SHOE_C, { seg: 8, squash: 0.78, capStart: true, capEnd: true, blend: [0.55, 0.9], up: new Vector3(0, 1, 0) });
      hide.ball(P(fx, 0.088, -0.022), [0.046, 0.04, 0.048], `foot.${s}`, SHOE_C, 7);
    } else {
      hide.box(P(fx, 0.05, 0.03), [0.10, 0.09, 0.24], null, `foot.${s}`, SHOE_C);
    }
  }

  // ---- body: tunic (cotte) / gown, cut at `hem`, pleated below the belt ----
  const sec: Section[] = [];
  if (female) {
    sec.push({ y: hem, rx: 0.34, rz: 0.265, w: W_HIPS, fold: 0.045 });
    sec.push({ y: 0.55, rx: 0.285, rz: 0.215, w: W_HIPS, fold: 0.03 });
    sec.push({ y: 0.90, rx: 0.215, rz: 0.16, w: W_HIPS, fold: 0.01 });
    sec.push({ y: 0.98, rx: 0.185, rz: 0.14, w: W_HIPS, fold: 0.006 });
    sec.push({ y: 1.07, rx: 0.172, rz: 0.13, w: W_SPINE, fold: 0.006 });
    sec.push({ y: 1.20, rx: 0.19, rz: 0.15, cz: 0.015, w: W_MID, fold: 0.006 });
    sec.push({ y: 1.30, rx: 0.195, rz: 0.145, w: W_CHEST });
    sec.push({ y: 1.385, rx: 0.205, rz: 0.135, w: W_CHEST });
    sec.push({ y: 1.43, rx: 0.14, rz: 0.10, w: W_CHEST });
    sec.push({ y: 1.455, rx: 0.07, rz: 0.066, w: W_CHEST });
  } else {
    const c = look.child;
    sec.push({ y: hem, rx: 0.27, rz: 0.21, w: W_HIPS, fold: 0.035 });
    if (hem < 0.72) sec.push({ y: (hem + 0.90) / 2, rx: 0.235, rz: 0.18, w: W_HIPS, fold: 0.02 });
    sec.push({ y: 0.90, rx: 0.205, rz: 0.155, w: W_HIPS, fold: 0.008 });
    sec.push({ y: 0.965, rx: 0.20, rz: 0.15, w: W_HIPS, fold: 0.006 });
    sec.push({ y: 1.07, rx: 0.19, rz: 0.145, w: W_SPINE, fold: 0.006 });
    sec.push({ y: 1.20, rx: 0.205, rz: 0.155, w: W_MID, fold: 0.006 });
    sec.push({ y: 1.30, rx: 0.215, rz: 0.155, w: W_CHEST });
    sec.push({ y: 1.385, rx: c ? 0.20 : 0.215, rz: 0.145, w: W_CHEST });
    sec.push({ y: 1.43, rx: 0.155, rz: 0.11, w: W_CHEST });
    sec.push({ y: 1.455, rx: 0.075, rz: 0.07, w: W_CHEST });
  }
  cloth.loft(thin(sec, hi), look.cloth, { seg: segT, capBottom: true, capTop: true, folds: FOLDS });
  // hem band + collar in the trim colour
  if (hi) {
    const s0 = sec[0];
    cloth.loft([{ y: hem - 0.002, rx: s0.rx + 0.006, rz: s0.rz + 0.006, w: W_HIPS, fold: s0.fold },
      { y: hem + 0.035, rx: s0.rx + 0.004, rz: s0.rz + 0.004, w: W_HIPS, fold: (s0.fold ?? 0) * 0.9 }], shade(look.cloth, 0.72), { seg: segT, folds: FOLDS });
    cloth.loft([{ y: 1.43, rx: 0.10, rz: 0.088, w: W_CHEST }, { y: 1.47, rx: 0.078, rz: 0.072, w: W_CHEST }], shade(look.cloth, 0.72), { seg: 10 });
  }

  // ---- shoulders + sleeves to the wrist, bare hands ----
  for (const s of ['l', 'r'] as const) {
    const sh = V(`upperarm.${s}`), el = V(`lowerarm.${s}`), wr = V(`wrist.${s}`);
    const sx = s === 'l' ? 1 : -1;
    cloth.ball(sh.clone().setX(sh.x - sx * 0.02).setY(sh.y - 0.012), [0.07, 0.062, 0.064], 'chest', look.cloth, hi ? 8 : 5, [['chest', 0.55], [`upperarm.${s}`, 0.45]]);
    cloth.tube(sh, el, [{ t: 0, r: 0.067 }, { t: 1, r: 0.054 }], `upperarm.${s}`, `lowerarm.${s}`, look.cloth, { seg: segL, blend: [0.65, 1] });
    if (hi) cloth.ball(el, [0.053, 0.052, 0.052], `lowerarm.${s}`, look.cloth, 7, [[`upperarm.${s}`, 0.4], [`lowerarm.${s}`, 0.6]]);
    cloth.tube(el, wr, [{ t: 0, r: 0.054 }, { t: 0.78, r: 0.044 }, { t: 0.8, r: 0.048, color: shade(look.cloth, 0.72) }, { t: 1, r: 0.046, color: shade(look.cloth, 0.72) }],
      `lowerarm.${s}`, `wrist.${s}`, look.cloth, { seg: segL, blend: [0.65, 1] });
    buildHand(hide, look, s, lod);
  }

  buildHead(hide, metal, mail, cloth, look, lod);

  // ---- belt, buckle, strap end, pouch ----
  hide.loft([{ y: 0.925, rx: 0.207, rz: 0.157, w: W_HIPS }, { y: 0.965, rx: 0.208, rz: 0.158, w: W_HIPS }], LEATHER_C, { seg });
  if (hi) {
    metal.box(P(0, 0.945, 0.16), [0.045, 0.05, 0.012], null, 'hips', STEEL_C);
    hide.box(P(0.035, 0.86, 0.157), [0.03, 0.15, 0.01], new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.12), 'hips', LEATHER_C);
    if (look.pouch) hide.ball(P(-0.165, 0.865, 0.10), [0.05, 0.062, 0.036], 'hips', LEATHER_C, 6);
  }

  if (look.apron !== undefined) {
    const ah = female ? 0.28 : Math.max(0.35, hem + 0.05);
    const rxAt = (y: number) => 0.205 + (0.95 - y) / (0.95 - hem) * ((female ? 0.34 : 0.27) - 0.205);
    const rzAt = (y: number) => 0.155 + (0.95 - y) / (0.95 - hem) * ((female ? 0.265 : 0.21) - 0.155);
    cloth.grid((u, v, o) => {
      const x = -0.17 + u * 0.34;
      const y = ah + v * (0.95 - ah);
      const rx = rxAt(y), rz = rzAt(y);
      const zs = rz * Math.sqrt(Math.max(0, 1 - (x / rx) * (x / rx)));
      return o.set(x, y, zs + 0.014 + (hi ? 0.009 * Math.sin(u * Math.PI * 5) * (1 - v) : 0));
    }, { rows: hi ? 4 : 2, cols: hi ? 10 : 6, weight: (_u, v) => v > 0.7 ? W_HIPS : W_HIPS, color: look.apron, uScale: 0.34, vScale: 0.6 });
  }
  if (look.cloak !== undefined) {
    cloth.loft([
      { y: Math.max(0.5, hem + 0.08), rx: 0.27, rz: 0.225, w: W_HIPS, fold: 0.04 }, { y: 0.9, rx: 0.25, rz: 0.2, w: W_HIPS, fold: 0.03 },
      { y: 1.20, rx: 0.245, rz: 0.19, w: W_CHEST, fold: 0.02 }, { y: 1.42, rx: 0.19, rz: 0.16, w: W_CHEST, fold: 0.01 },
    ], look.cloak, { seg, folds: FOLDS, phase: 1 });
    if (hi) metal.ball(P(0, 1.415, 0.15), 0.02, 'chest', 0xb8a36a, 6);
  }

  // ---- armour (LORE §7: Confederates gambeson + Eisenhut, Habsburg troops mail + surcoat) ----
  if (look.gambeson) {   // quilted coat: vertical stitched channels, hip length, sleeveless over the tunic
    cloth.loft(thin([
      { y: 0.78, rx: 0.25, rz: 0.19, w: W_HIPS, fold: 0.01 }, { y: 0.95, rx: 0.225, rz: 0.17, w: W_HIPS, fold: 0.01 },
      { y: 1.07, rx: 0.215, rz: 0.16, w: W_SPINE, fold: 0.01 }, { y: 1.20, rx: 0.228, rz: 0.17, w: W_MID, fold: 0.01 },
      { y: 1.31, rx: 0.238, rz: 0.172, w: W_CHEST, fold: 0.008 }, { y: 1.39, rx: 0.24, rz: 0.16, w: W_CHEST, fold: 0.006 },
      { y: 1.435, rx: 0.16, rz: 0.115, w: W_CHEST }, { y: 1.458, rx: 0.08, rz: 0.072, w: W_CHEST },
    ], hi), shade(look.cloth, 1.06), { seg, folds: hi ? 12 : 0, capTop: true });
    if (hi) for (const s of ['l', 'r'] as const) {
      cloth.tube(V(`upperarm.${s}`), V(`lowerarm.${s}`), [{ t: 0, r: 0.074 }, { t: 1, r: 0.062 }], `upperarm.${s}`, `lowerarm.${s}`, shade(look.cloth, 1.06), { seg: segL, blend: [0.65, 1] });
    }
  }
  if (look.mail) {
    mail.loft(thin([
      { y: 0.72, rx: 0.245, rz: 0.19, w: W_HIPS, fold: 0.012 }, { y: 0.94, rx: 0.215, rz: 0.16, w: W_HIPS, fold: 0.006 },
      { y: 1.07, rx: 0.205, rz: 0.15, w: W_SPINE }, { y: 1.20, rx: 0.22, rz: 0.16, w: W_MID },
      { y: 1.31, rx: 0.232, rz: 0.165, w: W_CHEST }, { y: 1.39, rx: 0.235, rz: 0.155, w: W_CHEST },
      { y: 1.435, rx: 0.16, rz: 0.115, w: W_CHEST }, { y: 1.46, rx: 0.08, rz: 0.075, w: W_CHEST },
    ], hi), MAIL_C, { seg, folds: FOLDS, capTop: true });
    if (hi) for (const s of ['l', 'r'] as const) {
      mail.tube(V(`upperarm.${s}`), V(`lowerarm.${s}`), [{ t: 0, r: 0.076 }, { t: 1, r: 0.064 }], `upperarm.${s}`, `lowerarm.${s}`, MAIL_C, { seg: segL, blend: [0.65, 1] });
      mail.tube(V(`lowerarm.${s}`), V(`wrist.${s}`), [{ t: 0, r: 0.064 }, { t: 1, r: 0.05 }], `lowerarm.${s}`, `wrist.${s}`, MAIL_C, { seg: segL, blend: [0.65, 1] });
    }
  }
  if (look.plates && hi) { // coat of plates: riveted horizontal bands over the mail
    metal.loft([
      { y: 1.02, rx: 0.236, rz: 0.17, w: W_SPINE }, { y: 1.10, rx: 0.232, rz: 0.168, w: W_SPINE }, { y: 1.11, rx: 0.238, rz: 0.172, w: W_MID },
      { y: 1.19, rx: 0.234, rz: 0.17, w: W_MID }, { y: 1.20, rx: 0.24, rz: 0.174, w: W_MID }, { y: 1.28, rx: 0.238, rz: 0.172, w: W_CHEST },
      { y: 1.29, rx: 0.244, rz: 0.176, w: W_CHEST }, { y: 1.35, rx: 0.242, rz: 0.174, w: W_CHEST },
    ], 0x6d6f74, { seg });
  }
  if (look.surcoat) {
    cloth.loft(thin([
      { y: 0.55, rx: 0.265, rz: 0.205, w: W_HIPS, color: BINDE_RED, fold: 0.03 },
      { y: 0.92, rx: 0.228, rz: 0.17, w: W_HIPS, color: BINDE_RED, fold: 0.012 },
      { y: 0.98, rx: 0.225, rz: 0.168, w: W_HIPS, color: BINDE_WHITE, fold: 0.01 },
      { y: 1.14, rx: 0.228, rz: 0.17, w: W_SPINE, color: BINDE_WHITE, fold: 0.008 },
      { y: 1.20, rx: 0.235, rz: 0.175, w: W_MID, color: BINDE_RED, fold: 0.008 },
      { y: 1.34, rx: 0.248, rz: 0.178, w: W_CHEST, color: BINDE_RED },
      { y: 1.40, rx: 0.22, rz: 0.15, w: W_CHEST, color: BINDE_RED },
    ], hi), BINDE_RED, { seg, folds: FOLDS, phase: 2 });
  }

  const habsburg = !!look.surcoat;
  buildWeapon(hide, metal, bind, (look.mainHand ?? 'none') as WeaponKind, lod);
  buildShield(hide, metal, cloth, bind, (look.offHand ?? 'none') as ShieldKind, habsburg, lod);
  if (mounted) buildHorse(hide, -MOUNT_Y, lod);

  return {
    cloth: cloth.empty ? null : cloth.build(),
    hide: hide.empty ? null : hide.build(),
    metal: metal.empty ? null : metal.build(),
    mail: mail.empty ? null : mail.build(),
    mounted,
    triangles: cloth.triangles + hide.triangles + metal.triangles + mail.triangles,
  };
}

// ---------------------------------------------------------------------------------------------
// Horse (mounted archetypes)
// ---------------------------------------------------------------------------------------------

/** Draws the horse into the rider's `hide` layer, weighted 100 % to the (never-animated) root bone, so a
 *  mounted knight still costs 4 draw calls. `dy` cancels the rider's saddle offset. */
function buildHorse(b: SkinBuilder, dy: number, lod: number): void {
  const HIDE = 0x6e4f2f, DARK = 0x3a2c1d;
  const hi = lod === 0;
  const Q = (x: number, y: number, z: number) => P(x, y + dy, z);
  b.ball(Q(0, 1.10, 0), [0.29, 0.33, 0.82], 'root', HIDE, hi ? 9 : 6);            // barrel
  b.ball(Q(0, 1.30, 0.62), [0.19, 0.30, 0.26], 'root', HIDE, hi ? 7 : 5);        // shoulder
  b.ball(Q(0, 1.24, -0.60), [0.26, 0.30, 0.30], 'root', HIDE, hi ? 7 : 5);       // croup
  b.tube(Q(0, 1.32, 0.66), Q(0, 1.76, 0.98), [{ t: 0, r: 0.16 }, { t: 1, r: 0.105 }], 'root', 'root', HIDE, { seg: hi ? 8 : 6 });
  b.ball(Q(0, 1.80, 1.08), [0.095, 0.115, 0.21], 'root', HIDE, hi ? 8 : 6);       // head
  b.ball(Q(0, 1.73, 1.20), [0.072, 0.075, 0.095], 'root', DARK, hi ? 6 : 5);      // muzzle
  if (hi) for (const s of [-1, 1]) b.ball(Q(s * 0.06, 1.92, 1.00), [0.025, 0.05, 0.02], 'root', HIDE, 5);
  for (const [x, z] of [[-0.22, 0.55], [0.22, 0.55], [-0.24, -0.55], [0.24, -0.55]] as [number, number][]) {
    b.tube(Q(x, 1.02, z), Q(x, 0.05, z), [{ t: 0, r: 0.085 }, { t: 0.65, r: 0.045 }, { t: 0.85, r: 0.042 }, { t: 0.87, r: 0.05, color: DARK }, { t: 1, r: 0.05, color: DARK }],
      'root', 'root', HIDE, { seg: hi ? 6 : 5, capEnd: hi });
  }
  b.tube(Q(0, 1.32, -0.80), Q(0, 0.86, -1.02), [{ t: 0, r: 0.06 }, { t: 1, r: 0.03 }], 'root', 'root', DARK, { seg: 5, capEnd: true });  // tail
  b.box(Q(0, 1.42, -0.02), [0.42, 0.10, 0.48], null, 'root', LEATHER_C);                       // saddle
  for (const s of [-1, 1]) b.box(Q(s * 0.31, 1.18, -0.02), [0.02, 0.38, 0.56], null, 'root', BINDE_RED);   // saddle cloth down both flanks
  void W_ROOT;
}

// ---------------------------------------------------------------------------------------------
// Held kit for the downloaded bodies: weapon and shield authored in the hand slot's own frame
// ---------------------------------------------------------------------------------------------

export interface HeldPart { geometry: import('three').BufferGeometry; layer: 'cloth' | 'hide' | 'metal' | 'mail' }

/** Weapon (grip at the origin, blade along +Y) and shield (boss at the origin, face toward −Z) as plain
 *  geometry in metres, for hanging on a Mixamo hand bone; the skin attributes are unused there. */
export function buildHeldKit(weapon: WeaponKind, shield: ShieldKind, habsburg: boolean): { weapon: HeldPart[]; shield: HeldPart[] } {
  const local: Bind = new Map([
    ['handslot.r', { pos: new Vector3(), quat: new Quaternion() }],
    ['handslot.l', { pos: new Vector3(), quat: new Quaternion() }],
  ]);
  const mk = () => ({ cloth: new SkinBuilder(() => 0, 0.3), hide: new SkinBuilder(() => 0, 0.26), metal: new SkinBuilder(() => 0, 0.2) });
  const gains = (b: ReturnType<typeof mk>) => { b.cloth.gain = LAYER_GAIN.cloth; b.hide.gain = LAYER_GAIN.hide; b.metal.gain = LAYER_GAIN.metal; };
  const parts = (b: ReturnType<typeof mk>): HeldPart[] => {
    const out: HeldPart[] = [];
    if (!b.cloth.empty) out.push({ geometry: b.cloth.build(), layer: 'cloth' });
    if (!b.hide.empty) out.push({ geometry: b.hide.build(), layer: 'hide' });
    if (!b.metal.empty) out.push({ geometry: b.metal.build(), layer: 'metal' });
    return out;
  };
  const w = mk(); gains(w);
  if (weapon !== 'dagger') buildWeapon(w.hide, w.metal, local, weapon, 0);
  const s = mk(); gains(s);
  buildShield(s.hide, s.metal, s.cloth, local, shield, habsburg, 0);
  return { weapon: parts(w), shield: parts(s) };
}
