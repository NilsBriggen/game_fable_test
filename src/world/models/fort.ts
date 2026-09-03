/**
 * Fortification and infrastructure: the Habsburg-era Bergfried keep and its curtain wall and flanking
 * towers (Zwing Uri, Rotzberg, Schwanau, Gesslerburg), the Letzi drystone barrier of the Waldstätte,
 * a timber palisade, and the wooden and stone bridges of the Gotthard road.
 *
 * Walls are coursed rubble (`masonry`) with dressed ashlar quoins, plinths and dressings — the way a
 * c. 1300 Swiss castle is actually built — rather than one uniform brick face.
 */
import { Object3D } from 'three';
import { Rng } from '@core/rng';
import {
  Build, DRY_TONE, IRON_TONE, LOG_TONE, MASONRY_TONE, PLANK_DARK, PLANK_TONE, SHINGLE_TONE, STONE_TONE,
  TIMBER_DARK, archedOpening, crenellate, doorway, mixTone, pyramidRoof, quoins, type XYZ,
} from './kit';
import { ladderInto } from './props';

/** A vertical arrow slit with its dressed surround, on the given wall face. */
function arrowSlit(b: Build, x: number, y: number, z: number, facing: 'z' | 'x', sign: number, h = 1.2): void {
  const rot: XYZ | undefined = facing === 'x' ? [0, Math.PI / 2, 0] : undefined;
  const at = (t: number, dy: number): XYZ => (facing === 'z' ? [x, y + dy, z + t * sign] : [x + t * sign, y + dy, z]);
  b.box('ashlar', mixTone(STONE_TONE, 0xffffff, 0.05), [0.46, h + 0.5, 0.2], at(0.02, 0), rot);
  b.box('planks', 0x0d0b08, [0.13, h, 0.16], at(0.06, 0), rot);
  b.box('planks', 0x0d0b08, [0.42, 0.13, 0.16], at(0.06, -h * 0.28), rot);              // cross slit
}

export function castleKeep(rng: Rng): Object3D {
  const w = 12, d = 12, h = 18;
  const b = new Build();
  // battered plinth over a buried footing, rubble shaft, ashlar quoins on every corner
  b.box('masonry', mixTone(MASONRY_TONE, 0x000000, 0.2), [w, 2.4, d], [0, -1.2, 0]);
  b.box('ashlar', STONE_TONE, [w + 1.3, 1.3, d + 1.3], [0, 0.65, 0]);
  b.box('ashlar', mixTone(STONE_TONE, 0x000000, 0.1), [w + 0.7, 0.3, d + 0.7], [0, 1.4, 0]);
  b.box('masonry', MASONRY_TONE, [w, h - 1.3, d], [0, 1.3 + (h - 1.3) / 2, 0]);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) quoins(b, sx * (w / 2 - 0.2), sz * (d / 2 - 0.2), h - 1.6, 1.5, mixTone(STONE_TONE, 0xffffff, 0.06), 0.5);
  // string courses mark the storeys
  for (const y of [6.6, 11.4]) b.box('ashlar', mixTone(STONE_TONE, 0xffffff, 0.06), [w + 0.34, 0.2, d + 0.34], [0, y, 0]);
  // putlog holes left by the scaffolding, in two rings — the detail that says "built by hand"
  for (const y of [4.4, 9.2, 13.8]) for (let i = 0; i < 4; i++) {
    const t = -0.3 + i * 0.2;
    for (const sz of [-1, 1]) b.box('planks', 0x0f0d0a, [0.24, 0.22, 0.14], [t * w, y, sz * (d / 2 + 0.01)]);
    for (const sx of [-1, 1]) b.box('planks', 0x0f0d0a, [0.14, 0.22, 0.24], [sx * (w / 2 + 0.01), y, t * d]);
  }
  for (let i = 0; i < 3; i++) for (const sz of [-1, 1]) {
    arrowSlit(b, (i - 1) * 3.4, 7.4 + (i % 2) * 2.4, sz * (d / 2), 'z', sz);
    arrowSlit(b, sz * (w / 2), 9.6 + (i % 2) * 2.4, (i - 1) * 3.4, 'x', sz);
  }
  // two round-arched windows in the hall storey
  for (const sz of [-1, 1]) archedOpening(b, sz * 2.2, 12.4, d / 2, 0.6, 1.5, 'z', 1);
  // corbelled parapet, wall walk and merlons
  b.box('ashlar', mixTone(STONE_TONE, 0x000000, 0.05), [w + 1.0, 0.5, d + 1.0], [0, h + 0.25, 0]);
  b.box('planks', PLANK_DARK, [w - 0.6, 0.14, d - 0.6], [0, h + 0.55, 0]);
  for (const [ax, az, yaw, run] of [[0, d / 2 + 0.35, 0, w + 1], [0, -d / 2 - 0.35, 0, w + 1], [w / 2 + 0.35, 0, Math.PI / 2, d + 1], [-w / 2 - 0.35, 0, Math.PI / 2, d + 1]] as [number, number, number, number][]) {
    crenellate(b, run, h + 0.5, [ax, 0, az], [0, yaw, 0], 'ashlar', mixTone(STONE_TONE, 0xffffff, 0.06), 0.6);
  }
  // shingled roof set down inside the parapet, so the keep is not an open box from above
  const rr = w / 2 - 0.5;
  pyramidRoof(b, rr, 4.2, h + 0.4, [0, 0, 0], 4, 0x8b8478, Math.PI / 4);
  // raised entrance (Hocheingang) with the timber stair that could be pulled away in a siege
  doorway(b, 0, 3.2, d / 2 + 0.1, 1.35, 2.4, 'z', { frame: 'ashlar', tone: STONE_TONE, arched: true });
  b.box('planks', PLANK_TONE, [1.8, 0.18, 3.9], [0, 1.9, d / 2 + 2.0], [-0.72, 0, 0]);
  for (let i = 0; i < 7; i++) b.box('planks', mixTone(PLANK_TONE, PLANK_DARK, 0.3), [1.8, 0.1, 0.36], [0, 0.6 + i * 0.42, d / 2 + 3.4 - i * 0.5]);
  for (const s of [-1, 1]) for (const t of [0.3, 0.75]) b.cyl('logs', TIMBER_DARK, 0.09, 0.11, 1.2 + t * 1.6, [s * 0.9, (1.2 + t * 1.6) / 2, d / 2 + 3.5 - t * 2.6], undefined, 6);
  void rng;
  return b.emit('castle.keep');
}

export function castleWall(rng: Rng): Object3D {
  const w = 8, h = 6, th = 1.3;
  const b = new Build();
  b.box('masonry', mixTone(MASONRY_TONE, 0x000000, 0.2), [w, 2.2, th], [0, -1.1, 0]);
  b.box('ashlar', STONE_TONE, [w, 0.8, th + 0.5], [0, 0.4, 0]);                      // battered base
  b.box('masonry', MASONRY_TONE, [w, h - 0.8, th], [0, 0.8 + (h - 0.8) / 2, 0]);
  b.box('ashlar', mixTone(STONE_TONE, 0xffffff, 0.06), [w, 0.18, th + 0.24], [0, h - 1.0, 0]);   // corbel course
  // wall walk on timber joists behind the parapet
  b.box('planks', PLANK_DARK, [w, 0.14, th + 1.0], [0, h - 0.55, 0.5]);
  for (let i = 0; i < 5; i++) b.cyl('logs', TIMBER_DARK, 0.08, 0.08, 1.2, [-w / 2 + ((i + 0.5) / 5) * w, h - 0.72, 0.55], [Math.PI / 2, 0, 0], 5);
  crenellate(b, w, h - 0.5, [0, 0, 0], undefined, 'ashlar', mixTone(STONE_TONE, 0xffffff, 0.06), th * 0.55);
  for (let i = 0; i < 2; i++) arrowSlit(b, (i - 0.5) * 3, h * 0.55, -th / 2, 'z', -1, 0.95);
  void rng;
  return b.emit('castle.wall');
}

export function castleTower(rng: Rng): Object3D {
  const r = 3, h = 14;
  const b = new Build();
  b.cyl('masonry', mixTone(MASONRY_TONE, 0x000000, 0.2), r * 1.2, r * 1.3, 2.2, [0, -1.0, 0], undefined, 12);
  b.cyl('ashlar', STONE_TONE, r * 1.06, r * 1.24, 2.0, [0, 1.0, 0], undefined, 12);
  b.cyl('masonry', MASONRY_TONE, r, r * 1.06, h - 2, [0, 1 + (h - 2) / 2, 0], undefined, 12);
  for (const y of [5.4, 9.8]) b.cyl('ashlar', mixTone(STONE_TONE, 0xffffff, 0.07), r + 0.14, r + 0.14, 0.18, [0, y, 0], undefined, 12);
  b.cyl('ashlar', mixTone(STONE_TONE, 0x000000, 0.05), r + 0.5, r + 0.24, 0.55, [0, h - 0.4, 0], undefined, 12);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.box('ashlar', mixTone(STONE_TONE, 0xffffff, 0.06), [1.15, 1.0, 0.55], [Math.cos(a) * (r + 0.28), h + 0.4, Math.sin(a) * (r + 0.28)], [0, -a, 0]);
    b.box('ashlar', mixTone(STONE_TONE, 0xffffff, 0.14), [1.24, 0.12, 0.65], [Math.cos(a) * (r + 0.28), h + 0.96, Math.sin(a) * (r + 0.28)], [0, -a, 0]);
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    b.box('ashlar', mixTone(STONE_TONE, 0xffffff, 0.05), [0.5, 1.6, 0.24], [Math.cos(a) * (r + 0.02), 6 + i, Math.sin(a) * (r + 0.02)], [0, -a, 0]);
    b.box('planks', 0x0d0b08, [0.14, 1.1, 0.2], [Math.cos(a) * (r + 0.06), 6 + i, Math.sin(a) * (r + 0.06)], [0, -a, 0]);
  }
  pyramidRoof(b, r * 1.1, 4.4, h + 1.0, [0, 0, 0], 12, 0x8b8478, 0);
  void rng;
  return b.emit('castle.tower');
}

/** Letzi: a mortarless field-stone barrier wall, 8 m per segment (LORE §4 Letzimauern). */
export function letziWall(rng: Rng): Object3D {
  const w = 8, h = 2.5, th = 1.5;
  const b = new Build();
  b.box('drystone', mixTone(DRY_TONE, 0x000000, 0.25), [w, h * 0.92, th * 0.72], [0, h * 0.46, 0]);
  b.box('drystone', mixTone(DRY_TONE, 0x000000, 0.35), [w, 1.4, th * 0.8], [0, -0.7, 0]);   // buried footing
  let seed = 1;
  for (let course = 0; course < 5; course++) {
    const y = 0.26 + course * 0.5;
    const inset = course * 0.09;
    const n = 8 - course;
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + ((i + 0.5) / n) * w;
      const rr = 0.36 + ((seed * 7) % 5) * 0.03;
      b.blob('drystone', course % 2 ? mixTone(DRY_TONE, 0x000000, 0.1) : DRY_TONE, rr, [x, y, th / 2 - inset - 0.2], seed++, 0.55, 5);
      b.blob('drystone', mixTone(DRY_TONE, 0xffffff, 0.08), rr * 0.95, [x, y, -th / 2 + inset + 0.2], seed++, 0.55, 5);
    }
  }
  // capping stones and the timber fighting step behind it
  for (let i = 0; i < 7; i++) b.blob('drystone', mixTone(DRY_TONE, 0xffffff, 0.14), 0.24, [-w / 2 + ((i + 0.5) / 7) * w, h * 0.92, 0], 90 + i, 0.4, 5);
  b.box('planks', PLANK_DARK, [w, 0.12, 0.9], [0, 1.1, -th / 2 - 0.45]);
  for (let i = 0; i < 4; i++) b.cyl('logs', TIMBER_DARK, 0.09, 0.1, 1.1, [-w / 2 + ((i + 0.5) / 4) * w, 0.55, -th / 2 - 0.8], undefined, 5);
  void rng;
  return b.emit('letzi.wall');
}

export function palisade(rng: Rng): Object3D {
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
  for (let i = 0; i < 3; i++) b.cyl('logs', TIMBER_DARK, 0.08, 0.09, 2.2, [-w / 2 + ((i + 0.5) / 3) * w, 0.85, 0.8], [-0.7, 0, 0], 5);   // shores
  b.box('drystone', DRY_TONE, [w, 0.35, 0.7], [0, 0.12, 0.2]);
  return b.emit('palisade');
}

export function bridgeWood(rng: Rng): Object3D {
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
  for (const s of [-1, 1]) for (let i = 0; i < 4; i++) b.box('logs', 0x7d6540, [0.08, 0.55, 0.08], [-len / 2 + ((i + 0.5) / 4) * len, 2.85, s * (w / 2)]);
  void rng;
  return b.emit('bridge.wood');
}

export function bridgeStone(rng: Rng): Object3D {
  const len = 14, w = 3.4;
  const b = new Build();
  // segmental arch from voussoir blocks, rubble spandrels, ashlar parapet
  const R = 4.0, seg = 13;
  for (let i = 0; i < seg; i++) {
    const a = Math.PI * (0.06 + (i / (seg - 1)) * 0.88);
    const x = Math.cos(a) * R, y = 1.1 + Math.sin(a) * R * 0.62;
    b.box('ashlar', i % 2 ? STONE_TONE : mixTone(STONE_TONE, 0x000000, 0.1), [0.82, 0.8, w], [x, y, 0], [0, 0, a - Math.PI / 2]);
  }
  for (const s of [-1, 1]) b.box('masonry', MASONRY_TONE, [3.4, 3.6, w], [s * (len / 2 - 1.4), 1.8, 0]);
  for (const s of [-1, 1]) b.box('masonry', mixTone(MASONRY_TONE, 0x000000, 0.2), [3.4, 2.0, w], [s * (len / 2 - 1.4), -1.0, 0]);
  b.box('masonry', MASONRY_TONE, [len, 0.9, w], [0, 3.35, 0]);
  b.box('ashlar', mixTone(STONE_TONE, 0xffffff, 0.06), [len, 0.2, w + 0.2], [0, 3.85, 0]);
  b.box('drystone', DRY_TONE, [len - 0.4, 0.16, w - 0.6], [0, 4.0, 0]);                  // cobbled deck
  for (const s of [-1, 1]) {
    b.box('masonry', MASONRY_TONE, [len, 0.85, 0.34], [0, 4.3, s * (w / 2 - 0.1)]);
    b.box('ashlar', mixTone(STONE_TONE, 0xffffff, 0.12), [len, 0.16, 0.48], [0, 4.78, s * (w / 2 - 0.1)]);
  }
  void rng;
  return b.emit('bridge.stone');
}

/** A ruined wall stub with fallen rubble, for `ruin` POIs (spawned as `castle.wall` at 0.7 scale today). */
export function ruinWall(rng: Rng): Object3D {
  const b = new Build();
  const w = 6, h = 3.4, th = 1.1;
  b.box('masonry', MASONRY_TONE, [w, h, th], [0, h / 2, 0]);
  b.box('masonry', mixTone(MASONRY_TONE, 0x000000, 0.2), [w, 1.8, th], [0, -0.9, 0]);
  for (const sx of [-1, 1]) quoins(b, sx * (w / 2 - 0.16), 0, h - 0.4, 0.2, STONE_TONE, 0.44);
  // broken top: a stepped stack of loose stones
  for (let i = 0; i < 9; i++) {
    const x = -w / 2 + ((i + 0.5) / 9) * w;
    const hh = 0.2 + Math.abs(Math.sin(i * 2.1)) * 0.8;
    b.box('masonry', i % 2 ? MASONRY_TONE : mixTone(MASONRY_TONE, 0xffffff, 0.1), [w / 9 - 0.05, hh, th * 0.9], [x, h + hh / 2 - 0.05, 0]);
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.blob('drystone', DRY_TONE, 0.3 + (i % 3) * 0.08, [Math.cos(a) * (w * 0.36 + (i % 2)), 0.14, Math.sin(a) * 1.6], 60 + i, 0.55, 5);
  }
  ladderInto(b, w * 0.3, 0, th / 2 + 0.3, 2.0, 0.3);
  b.cyl('iron', mixTone(IRON_TONE, 0x6a5a3a, 0.5), 0.02, 0.02, 0.5, [w * 0.3, 2.1, th / 2 + 0.5], undefined, 5);
  void rng;
  return b.emit('ruin.wall');
}
