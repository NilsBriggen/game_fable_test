/**
 * Village and wayside props: the covered draw-well with its trough, wayside crosses, hay racks (Histen),
 * split-rail fences, woodpiles, market stalls, barrels, carts, gallows pole, camp gear, boats, rocks and
 * stumps, plus the standalone weapon/shield models.
 *
 * The `*Into(b, x, y, z, …)` helpers draw into a caller's `Build` at an offset, so a building can dress
 * itself (a farmhouse stacks its own firewood, a tavern sets out its own stall) without paying for a
 * second Object3D or a second merge pass.
 */
import { Group, Object3D } from 'three';
import { Rng } from '@core/rng';
import {
  Build, DRY_TONE, IRON_TONE, LOG_TONE, PLANK_DARK, PLANK_TONE, SHINGLE_TONE, STONE_TONE, THATCH_TONE,
  TIMBER_DARK, WEIGHT_TONE, doorway, gableRoof, mixTone, pyramidRoof, type XYZ,
} from './kit';

// ---------------- dressing sub-assemblies ----------------

/** A stack of split firewood under a lean-to board, drawn along the given yaw. */
export function woodpileInto(b: Build, x: number, y: number, z: number, yaw = 0, scale = 1): void {
  const len = 2.4 * scale, rows = 5, per = 6;
  const r = 0.09 * scale;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const at = (dx: number, dy: number, dz: number): XYZ => [x + dx * c - dz * s, y + dy, z + dx * s + dz * c];
  for (let j = 0; j < rows; j++) {
    const n = j === rows - 1 ? per - 2 : per;
    for (let i = 0; i < n; i++) {
      const dz = -0.28 * scale + (i % 2) * 0.28 * scale;
      const dx = -len / 2 + ((i + 0.5) / n) * len;
      const tone = (i + j) % 3 === 0 ? 0x9a825a : (i + j) % 3 === 1 ? 0x7d6540 : 0x8c7350;
      b.cyl('logs', tone, r, r * 0.95, 0.52 * scale, at(dx, r + j * r * 2.05, dz), [0, yaw, 0], 6);
    }
  }
  b.box('planks', PLANK_DARK, [len + 0.2, 0.06, 0.8 * scale], at(0, rows * r * 2.05 + 0.06, 0), [0, yaw, 0]);
  b.blob('drystone', WEIGHT_TONE, 0.17, at(len * 0.25, rows * r * 2.05 + 0.16, 0), 3, 0.4, 5);
  // chopping block in front of the stack, the Poly Haven hand axe left stuck in it
  const blk = at(len * 0.1, 0, 0.62 * scale);
  b.cyl('logs', 0x6b5637, 0.2 * scale, 0.22 * scale, 0.5 * scale, [blk[0], blk[1] + 0.25 * scale, blk[2]], undefined, 8);
  b.prop('wooden_axe', [blk[0] + 0.04, blk[1] + 0.36 * scale, blk[2]], [0.25, yaw + 0.6, 0.15], 0.95);
}

/** A stave barrel with iron hoops. */
export function barrelInto(b: Build, x: number, y: number, z: number, r = 0.34, h = 0.86): void {
  b.cyl('planks', 0x6d5836, r * 0.88, r * 0.88, h, [x, y + h / 2, z], undefined, 10);
  b.cyl('planks', mixTone(0x6d5836, 0xffffff, 0.1), r, r, h * 0.5, [x, y + h / 2, z], undefined, 10);
  for (const t of [0.14, 0.5, 0.86]) b.cyl('iron', IRON_TONE, r * (t === 0.5 ? 1.03 : 0.93), r * (t === 0.5 ? 1.03 : 0.93), 0.06, [x, y + h * t, z], undefined, 10, false);
  b.cyl('planks', PLANK_DARK, r * 0.86, r * 0.86, 0.05, [x, y + h + 0.01, z], undefined, 10);
}

/** A leaning ladder of two rails and rungs. */
export function ladderInto(b: Build, x: number, y: number, z: number, h = 2.4, lean = 0.35): void {
  const rails = 0.42;
  for (const s of [-1, 1]) b.box('logs', 0x8a7048, [0.07, h, 0.07], [x + s * rails / 2, y + h / 2, z + Math.sin(lean) * h / 2], [-lean, 0, 0]);
  const rungs = Math.max(3, Math.round(h / 0.32));
  for (let i = 1; i < rungs; i++) {
    const t = i / rungs;
    b.cyl('logs', 0x9a825a, 0.03, 0.03, rails, [x, y + h * t * Math.cos(lean), z + Math.sin(lean) * h * t], [0, 0, Math.PI / 2], 5);
  }
}

/** Trestle market stall: posts, a striped awning, a board counter and the goods on it. */
export function marketStallInto(b: Build, x: number, y: number, z: number, yaw = 0): void {
  const w = 2.6, d = 1.5, postH = 2.1;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const at = (dx: number, dy: number, dz: number): XYZ => [x + dx * c - dz * s, y + dy, z + dx * s + dz * c];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.cyl('logs', 0x7d6540, 0.055, 0.07, postH, at(sx * w / 2, postH / 2, sz * d / 2), [0, yaw, 0], 6);
  }
  for (const sz of [-1, 1]) b.box('logs', TIMBER_DARK, [w + 0.2, 0.08, 0.08], at(0, postH, sz * d / 2), [0, yaw, 0]);
  // awning: two cloth panels, alternating strips
  for (const sz of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const t = (i + 0.5) / 5;
      b.box('cloth', i % 2 ? 0xb8402f : 0xe0dccd, [w / 5, 0.04, d * 0.72], at(-w / 2 + t * w, postH + 0.18, sz * d * 0.3), [0.42 * sz, yaw, 0]);
    }
  }
  b.cyl('logs', TIMBER_DARK, 0.05, 0.05, w + 0.3, at(0, postH + 0.35, 0), [0, yaw, Math.PI / 2], 5);
  // counter
  b.box('planks', PLANK_TONE, [w - 0.2, 0.09, d - 0.3], at(0, 0.92, 0), [0, yaw, 0]);
  for (const sx of [-1, 1]) {
    b.box('planks', PLANK_DARK, [0.1, 0.9, d - 0.4], at(sx * (w / 2 - 0.3), 0.45, 0), [0, yaw, 0]);
  }
  // goods: crates, a basket of loaves, a cheese wheel — no potatoes, no maize (LORE §7)
  b.box('planks', 0x7a6240, [0.44, 0.34, 0.4], at(-0.72, 1.14, 0), [0, yaw, 0]);
  b.cyl('planks', 0xa78d5c, 0.24, 0.2, 0.22, at(0.05, 1.08, 0.05), [0, yaw, 0], 9);
  for (let i = 0; i < 4; i++) b.blob('cloth', 0xb99a63, 0.1, at(-0.03 + (i % 2) * 0.16, 1.24, -0.02 + Math.floor(i / 2) * 0.14), 11 + i, 0.55, 5);
  b.cyl('cloth', 0xd8c78c, 0.26, 0.26, 0.12, at(0.85, 1.03, 0), [0, yaw, 0], 10);
  b.cyl('cloth', 0xcbba80, 0.22, 0.22, 0.12, at(0.85, 1.15, 0.03), [0, yaw, 0], 10);
  barrelInto(b, x + (0.95) * c - (0.55) * s, y, z + (0.95) * s + (0.55) * c, 0.3, 0.75);
}

/** A hollowed-log water trough. */
export function troughInto(b: Build, x: number, y: number, z: number, yaw = 0, len = 1.9): void {
  b.cyl('logs', 0x8a7048, 0.28, 0.3, len, [x, y + 0.3, z], [0, yaw, Math.PI / 2], 8);
  b.box('logs', mixTone(0x8a7048, 0x000000, 0.4), [len - 0.1, 0.22, 0.34], [x, y + 0.46, z], [0, yaw, 0]);
  b.box('cloth', 0x3f5a63, [len - 0.2, 0.03, 0.28], [x, y + 0.46, z], [0, yaw, 0]);      // water
  for (const s of [-1, 1]) b.box('logs', TIMBER_DARK, [0.16, 0.3, 0.4], [x + Math.cos(yaw) * s * (len / 2 - 0.1), y + 0.15, z + Math.sin(yaw) * s * (len / 2 - 0.1)], [0, yaw, 0]);
}

// ---------------- standalone props ----------------

export function crossModel(rng: Rng): Object3D {
  const b = new Build();
  // a cairn of field stones round the foot, an oak post, a shingled rain roof and a small iron corpus
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    b.blob('drystone', i % 2 ? DRY_TONE : mixTone(DRY_TONE, 0xffffff, 0.12), 0.26, [Math.cos(a) * 0.42, 0.14, Math.sin(a) * 0.42], i, 0.62, 5);
  }
  b.blob('drystone', DRY_TONE, 0.36, [0, 0.16, 0], 21, 0.55, 6);
  b.box('logs', 0x6f5636, [0.17, 2.35, 0.17], [0, 1.2, 0]);
  b.box('logs', 0x6f5636, [1.15, 0.16, 0.15], [0, 1.88, 0]);
  for (const s of [-1, 1]) b.box('logs', mixTone(0x6f5636, 0x000000, 0.2), [0.3, 0.3, 0.1], [s * 0.16, 1.72, 0], [0, 0, s * 0.78]);   // corner braces
  for (const s of [-1, 1]) b.slab('shingle', SHINGLE_TONE, [0.62, 0.06, 0.46], [s * 0.15, 2.24, 0], [0, 0, -s * 0.55]);
  b.box('iron', mixTone(IRON_TONE, 0x6a5a3a, 0.4), [0.2, 0.3, 0.03], [0, 1.66, 0.1]);
  void rng;
  return b.emit('cross');
}

/** Alpine drying rack (Histe/Heinzen): poles with crossbars and drying hay. */
export function hayrack(rng: Rng): Object3D {
  const b = new Build();
  for (let i = 0; i < 4; i++) {
    const x = (i - 1.5) * 0.75;
    b.cyl('logs', 0x7d6540, 0.06, 0.08, 2.7, [x, 1.35, 0], undefined, 6);
    b.blob('drystone', DRY_TONE, 0.16, [x, 0.06, 0], i, 0.5, 5);
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

export function fenceModel(rng: Rng): Object3D {
  const b = new Build();
  const len = 3;
  for (let i = 0; i < 2; i++) {
    const x = -len / 2 + i * len;
    b.cyl('logs', 0x7d6540, 0.07, 0.1, 1.2, [x, 0.58, 0], [0, 0, (rng.next() - 0.5) * 0.08], 6);
    b.cyl('logs', 0x6f5636, 0.02, 0.07, 0.2, [x, 1.24, 0], undefined, 6);
  }
  for (const y of [0.4, 0.72, 1.02]) {
    b.box('logs', 0x8a7048, [len, 0.09, 0.06], [0, y, 0], [0, 0, (rng.next() - 0.5) * 0.02]);
    b.box('logs', mixTone(0x8a7048, 0x000000, 0.3), [len * 0.5, 0.05, 0.03], [len * 0.1, y + 0.03, 0.04], [0, 0, (rng.next() - 0.5) * 0.05]);
  }
  // a diagonal brace: the split-rail fences of an Alpine pasture are never perfectly rectilinear
  b.box('logs', 0x8a7048, [1.5, 0.07, 0.05], [-len * 0.2, 0.72, 0.06], [0, 0, 0.5]);
  return b.emit('fence');
}

/** Covered draw-well: a coursed stone curb, a windlass with a crank, a bucket on a rope, and the
 *  hollowed-log trough that always stands beside a village well. */
export function well(rng: Rng): Object3D {
  const b = new Build();
  const r = 0.85;
  for (let course = 0; course < 3; course++) {
    const n = 9;
    for (let i = 0; i < n; i++) {
      const a = ((i + (course % 2) * 0.5) / n) * Math.PI * 2;
      const shade = (i + course) % 3 === 0 ? DRY_TONE : (i + course) % 3 === 1 ? mixTone(DRY_TONE, 0x000000, 0.12) : mixTone(DRY_TONE, 0xffffff, 0.1);
      b.box('drystone', shade, [0.46, 0.24, 0.34], [Math.cos(a) * r, 0.12 + course * 0.24, Math.sin(a) * r], [0, -a, 0]);
    }
  }
  b.cyl('drystone', mixTone(DRY_TONE, 0x000000, 0.25), r * 0.92, r * 0.92, 0.72, [0, 0.36, 0], undefined, 12);
  b.cyl('ashlar', mixTone(STONE_TONE, 0xffffff, 0.1), r + 0.12, r + 0.12, 0.1, [0, 0.79, 0], undefined, 12);   // coping
  b.cyl('planks', 0x0d0b08, r * 0.8, r * 0.8, 0.06, [0, 0.76, 0], undefined, 12);                              // dark water
  // posts, windlass drum with a crank, rope and bucket
  for (const s of [-1, 1]) b.cyl('logs', 0x7d6540, 0.075, 0.095, 1.75, [s * (r - 0.05), 1.66, 0], undefined, 7);
  b.cyl('logs', 0x6f5636, 0.075, 0.075, 2.0, [0, 2.5, 0], [0, 0, Math.PI / 2], 7);
  b.cyl('logs', PLANK_TONE, 0.17, 0.17, 0.6, [0, 2.5, 0], [0, 0, Math.PI / 2], 9);                             // drum
  b.cyl('iron', IRON_TONE, 0.02, 0.02, 0.3, [r + 0.05, 2.5, 0], [0, 0, Math.PI / 2], 5);
  b.cyl('iron', IRON_TONE, 0.02, 0.02, 0.28, [r + 0.2, 2.36, 0], undefined, 5);
  // rope down to the Poly Haven bucket standing on the coping (procedural bucket without the asset)
  if (b.prop('wooden_bucket_01', [r * 0.55, 0.84, 0.25], [0, 0.6, 0])) {
    b.cyl('iron', mixTone(IRON_TONE, 0x6b5638, 0.6), 0.012, 0.012, 1.1, [r * 0.55, 1.95, 0.25], [0, 0, 0.05], 5);
  } else {
    b.cyl('iron', mixTone(IRON_TONE, 0x6b5638, 0.6), 0.012, 0.012, 1.1, [0, 1.95, 0], undefined, 5);           // rope
    b.cyl('planks', 0x6a5535, 0.18, 0.15, 0.28, [0, 1.32, 0], undefined, 9);
    b.cyl('iron', IRON_TONE, 0.185, 0.185, 0.03, [0, 1.42, 0], undefined, 9, false);
  }
  gableRoof(b, 2.05, 1.9, 0.55, 2.72, { overhang: 0.3, weights: false, purlins: false, tone: SHINGLE_TONE, course: 0.28 });
  troughInto(b, 0, 0, r + 1.05, 0, 1.9);
  // a cobbled apron so the well is not standing in bare grass
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.3;
    b.blob('drystone', i % 2 ? mixTone(DRY_TONE, 0xffffff, 0.15) : DRY_TONE, 0.24, [Math.cos(a) * (r + 0.5), 0.03, Math.sin(a) * (r + 0.5)], 30 + i, 0.25, 5);
  }
  void rng;
  return b.emit('well');
}

export function woodpile(rng: Rng): Object3D {
  const b = new Build();
  woodpileInto(b, 0, 0, 0, 0, 1.15);
  void rng;
  return b.emit('woodpile');
}

export function trough(rng: Rng): Object3D {
  const b = new Build();
  troughInto(b, 0, 0, 0, 0, 2.2);
  void rng;
  return b.emit('trough');
}

export function gallowsPole(rng: Rng): Object3D {
  const b = new Build();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    b.blob('drystone', i % 2 ? DRY_TONE : mixTone(DRY_TONE, 0xffffff, 0.1), 0.34, [Math.cos(a) * 0.55, 0.16, Math.sin(a) * 0.55], 5 + i, 0.5, 5);
  }
  b.cyl('logs', 0x6f5636, 0.11, 0.17, 4.6, [0, 2.3, 0], undefined, 8);
  b.box('logs', 0x6f5636, [0.62, 0.13, 0.13], [0.2, 4.48, 0]);
  for (const s of [-1, 1]) b.box('logs', mixTone(0x6f5636, 0x000000, 0.25), [0.5, 0.1, 0.1], [s * 0.22, 4.18, 0], [0, 0, s * 0.8]);
  b.box('iron', IRON_TONE, [0.16, 0.05, 0.05], [0, 4.42, 0]);
  // Gessler's hat sits in its own Group: settlements.ts toggles the first child Group's visibility.
  const hatB = new Build();
  hatB.cyl('cloth', 0x3a3f52, 0.5, 0.52, 0.07, [0, 4.62, 0], undefined, 12);
  hatB.cyl('cloth', 0x3a3f52, 0.3, 0.36, 0.34, [0, 4.83, 0], undefined, 10);
  hatB.cyl('cloth', mixTone(0x3a3f52, 0x000000, 0.3), 0.315, 0.315, 0.08, [0, 4.7, 0], undefined, 10, false);
  hatB.box('iron', 0xb8912e, [0.16, 0.16, 0.04], [0, 4.68, 0.34]);
  const hat = new Group();
  hat.name = 'gessler-hat';
  for (const m of hatB.meshes()) hat.add(m);
  void rng;
  return b.emit('gallows.pole', [hat]);
}

export function campfire(rng: Rng): Object3D {
  const b = new Build();
  // the Poly Haven stone ring (a 1.45 m scan) when loaded, else a ring of procedural boulders
  if (!b.prop('stone_fire_pit', [0, 0, 0], [0, 0.4, 0], 0.9)) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      b.blob('rock', 0xb2ada1, 0.22, [Math.cos(a) * 0.58, 0.1, Math.sin(a) * 0.58], i, 0.6, 6);
    }
  }
  for (let i = 0; i < 4; i++) {
    const a = (Math.PI / 4) * i;
    b.cyl('logs', 0x54432a, 0.06, 0.08, 0.95, [0, 0.14, 0], [0, a, Math.PI / 2 - 0.15], 6);
  }
  b.blob('rock', 0x50463a, 0.28, [0, 0.06, 0], 9, 0.35, 7);                             // ash bed
  b.cyl('fire', 0xffa040, 0.02, 0.22, 0.6, [0, 0.42, 0], undefined, 6);
  b.cyl('fire', 0xffd070, 0.02, 0.13, 0.34, [0, 0.3, 0.06], undefined, 6);
  // tripod and kettle over the fire
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    b.cyl('logs', 0x6f5636, 0.03, 0.035, 1.5, [Math.cos(a) * 0.36, 0.72, Math.sin(a) * 0.36], [Math.sin(a) * 0.46, 0, -Math.cos(a) * 0.46], 5);
  }
  b.cyl('iron', mixTone(IRON_TONE, 0x000000, 0.4), 0.17, 0.13, 0.24, [0, 0.86, 0], undefined, 9);
  void rng;
  return b.emit('campfire');
}

export function tent(rng: Rng): Object3D {
  const w = 2.8, d = 3.4, h = 2.0;
  const b = new Build();
  b.wedge('cloth', 0xc9bb99, [w, h, d], [0, 0, 0]);
  b.box('cloth', 0xb5a487, [w * 0.98, 0.06, d * 0.98], [0, 0.03, 0]);
  b.cyl('logs', 0x7d6540, 0.05, 0.06, h + 0.5, [0, (h + 0.5) / 2, d / 2 + 0.15], undefined, 6);
  b.cyl('logs', 0x7d6540, 0.05, 0.06, h + 0.5, [0, (h + 0.5) / 2, -d / 2 - 0.15], undefined, 6);
  b.cyl('logs', 0x6f5636, 0.04, 0.04, d + 0.6, [0, h + 0.2, 0], [Math.PI / 2, 0, 0], 6);
  for (const s of [-1, 1]) for (const z of [-1, 1]) {
    b.cyl('logs', 0x54432a, 0.03, 0.03, 0.5, [s * (w / 2 + 0.35), 0.2, z * d * 0.3], [0.4 * s, 0, 0.35 * s], 5);
    b.cyl('iron', mixTone(IRON_TONE, 0x6b5638, 0.5), 0.008, 0.008, 0.75, [s * (w / 2 + 0.2), 0.62, z * d * 0.3], [0, 0, s * 0.85], 4);
  }
  void rng;
  return b.emit('tent');
}

export function cart(rng: Rng): Object3D {
  const b = new Build();
  // the MegaKit farm wagon when the kit is loaded (4 m along -z: centre it on the origin like the cart)
  if (b.piece('Prop_Wagon', { planks: 0x7a6440 }, [0, 0, 1.1])) {
    void rng;
    return b.emit('cart');
  }
  const wheelR = 0.56;
  b.box('planks', PLANK_TONE, [2.5, 0.16, 1.4], [0, 0.92, 0]);
  for (let i = 0; i < 6; i++) b.box('planks', i % 2 ? PLANK_TONE : 0x7a6440, [2.5, 0.35, 0.1], [0, 1.14, -0.7 + (i / 5) * 1.4]);
  for (const s of [-1, 1]) {
    b.box('planks', PLANK_DARK, [2.5, 0.42, 0.09], [0, 1.2, s * 0.72]);
    b.box('logs', 0x6f5636, [0.12, 0.5, 0.12], [-1.1, 1.0, s * 0.7]);
  }
  for (const s of [-1, 1]) {
    b.cyl('logs', 0x6f5636, 0.16, 0.16, 0.16, [0.55, wheelR, s * 0.78], [0, 0, Math.PI / 2], 8);   // hub
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI;
      b.box('logs', 0x8a7048, [0.06, wheelR * 1.86, 0.06], [0.55, wheelR, s * 0.78], [a, 0, 0]);
    }
    for (let i = 0; i < 8; i++) {                                                                   // felloes
      const a = (i / 8) * Math.PI * 2;
      b.box('logs', mixTone(0x8a7048, 0x000000, 0.2), [0.09, 0.45, 0.1], [0.55, wheelR + Math.sin(a) * wheelR * 0.93, s * 0.78 + Math.cos(a) * wheelR * 0.93], [a, 0, 0]);
    }
    b.cyl('iron', IRON_TONE, wheelR, wheelR, 0.05, [0.55, wheelR, s * 0.86], [0, 0, Math.PI / 2], 14, false);
  }
  b.cyl('logs', 0x6f5636, 0.07, 0.07, 1.8, [0.55, wheelR, 0], [0, 0, Math.PI / 2], 6);              // axle
  b.box('logs', 0x7d6540, [2.0, 0.11, 0.11], [-2.0, 0.95, 0.35]);
  b.box('logs', 0x7d6540, [2.0, 0.11, 0.11], [-2.0, 0.95, -0.35]);
  b.box('logs', TIMBER_DARK, [0.12, 0.11, 0.8], [-2.9, 0.95, 0]);
  void rng;
  return b.emit('cart');
}

export function signpost(rng: Rng): Object3D {
  const b = new Build();
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    b.blob('drystone', DRY_TONE, 0.2, [Math.cos(a) * 0.28, 0.08, Math.sin(a) * 0.28], 2 + i, 0.55, 5);
  }
  b.cyl('logs', 0x7d6540, 0.09, 0.12, 2.5, [0, 1.25, 0], undefined, 7);
  for (let i = 0; i < 2; i++) {
    const y = 2.0 - i * 0.42;
    const yaw = i === 0 ? 0.25 : -0.9;
    b.box('planks', PLANK_TONE, [1.0, 0.24, 0.05], [Math.cos(yaw) * 0.5, y, -Math.sin(yaw) * 0.5], [0, yaw, 0]);
    b.box('planks', PLANK_DARK, [0.14, 0.26, 0.06], [Math.cos(yaw) * 0.06, y, -Math.sin(yaw) * 0.06], [0, yaw, 0]);
  }
  for (const s of [-1, 1]) b.slab('shingle', SHINGLE_TONE, [0.34, 0.05, 0.4], [s * 0.09, 2.5, 0], [0, 0, -s * 0.6]);
  void rng;
  return b.emit('signpost');
}

export function rockModel(rng: Rng, big: boolean): Object3D {
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

export function stump(rng: Rng): Object3D {
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

/** Weidling: the flat-bottomed clinker-built lake boat of the Vierwaldstättersee. */
export function boat(rng: Rng): Object3D {
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

// ---------------- weapons & shields (standalone; the in-hand copies live in characters.ts) ----------------

/** Grip at the origin, blade up +Y — the same convention the hand-slot geometry uses. */
export function weaponModel(kind: string): Object3D {
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

export function shieldModel(kind: string): Object3D {
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

export function placeholder(): Object3D {
  const b = new Build();
  b.box('planks', 0xff00ff, [1, 1, 1], [0, 0.5, 0]);
  return b.emit('placeholder');
}
