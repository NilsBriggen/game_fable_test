/**
 * Houses, farm buildings and churches. Alemannic Blockbau (horizontal notched logs on a drystone
 * plinth, board gable, shingle roof weighted with stones, Laube gallery under the eaves), the stone
 * town house of Luzern/Zug, the Stadel/barn and Spycher granary on staddle stones, and the Romanesque
 * village church / monastery in coursed rubble with dressed ashlar quoins and round-arched openings.
 *
 * Every footprint is the one src/exploration/layout.ts assumes (see models.test.ts), every origin is on
 * the ground, and every wall that meets the ground has a buried footing so a downhill spawn cannot show
 * daylight under the sill.
 */
import { Object3D } from 'three';
import { Rng } from '@core/rng';
import {
  Build, DRY_TONE, IRON_TONE, LOG_TONE, MASONRY_TONE, PLANK_DARK, PLANK_TONE, PLASTER_TONE, SHINGLE_TONE,
  STONE_TONE, TIMBER_DARK, archedOpening, boardGable, boardWall, chimney, doorway, gableRoof,
  gableRoofRotated, logWalls, mixTone, pyramidRoof, quoins, stonePlinth, windowOpening,
} from './kit';
import { woodpileInto, marketStallInto, barrelInto, ladderInto } from './props';
import { tavernInto, townHouseInto } from './townhouse';

// ---------------- Blockbau farmhouse ----------------

interface HouseSize { w: number; d: number; wallH: number; ridge: number; gallery: boolean }

const HOUSE_SIZES: Record<string, HouseSize> = {
  large: { w: 7.5, d: 7.8, wallH: 3.5, ridge: 2.15, gallery: true },
  inn: { w: 8.2, d: 7.8, wallH: 4.0, ridge: 2.3, gallery: true },
  small: { w: 5.4, d: 5.8, wallH: 2.5, ridge: 1.6, gallery: false },
  default: { w: 7.0, d: 7.8, wallH: 3.05, ridge: 1.95, gallery: true },
};

/**
 * Draws a Blockbau house into a caller's Build (the mill reuses it). The ridge runs along z, so the
 * gable — with the door and the loft hatch — faces +z, which is the side layout.ts turns toward the
 * village square. Returns extra loose children (none today; the signature is kept for the mill).
 */
export function blockbauInto(b: Build, rng: Rng, variant?: string): Object3D[] {
  // the village tavern is the MegaKit-composed Sust when the kit is loaded (townhouse.ts)
  if (variant === 'inn' && tavernInto(b, rng)) return [];
  const size = HOUSE_SIZES[variant ?? 'default'] ?? HOUSE_SIZES.default;
  // per-spawn variation: no draw-call cost (exploration merges by material anyway) and a village of
  // identical houses reads as a tile set rather than a place
  const jitter = (v: number, k: number) => v * (1 + (rng.next() - 0.5) * k);
  const w = jitter(size.w, 0.10), d = jitter(size.d, 0.08), wallH = jitter(size.wallH, 0.10);
  const ridge = jitter(size.ridge, 0.12);
  const roofTone = [SHINGLE_TONE, 0x7d7568, 0x958d80][Math.floor(rng.next() * 3)];
  const logTone = [LOG_TONE, 0x8c7350, 0xa88c5f][Math.floor(rng.next() * 3)];
  const plinth = 0.5;
  const overhang = 0.75;

  stonePlinth(b, w + 0.55, d + 0.55, plinth, Math.floor(rng.next() * 100));
  logWalls(b, w, d, wallH, plinth, 0.27, logTone);

  // gable storey: vertical boards under the rake, with a loft hatch on the square-facing gable
  for (const sz of [-1, 1]) boardGable(b, w, ridge * 0.94, plinth + wallH, sz * (d / 2 - 0.05), mixTone(PLANK_TONE, PLANK_DARK, 0.15));
  b.box('planks', TIMBER_DARK, [0.7, 0.62, 0.09], [w * 0.02, plinth + wallH + ridge * 0.42, d / 2 + 0.02]);
  b.box('iron', IRON_TONE, [0.6, 0.05, 0.03], [w * 0.02, plinth + wallH + ridge * 0.52, d / 2 + 0.07]);

  // openings: door in the gable, shuttered windows on the gable and both eaves walls
  doorway(b, -w * 0.22, plinth, d / 2 + 0.12, 1.05, 2.0, 'z');
  windowOpening(b, w * 0.24, plinth + wallH * 0.58, d / 2 + 0.12, 0.6, 0.72, 'z');
  windowOpening(b, -w / 2 - 0.14, plinth + wallH * 0.58, -d * 0.18, 0.55, 0.65, 'x', { sign: -1 });
  windowOpening(b, w / 2 + 0.14, plinth + wallH * 0.58, -d * 0.18, 0.55, 0.65, 'x');
  if (variant !== 'small') windowOpening(b, w / 2 + 0.14, plinth + wallH * 0.58, d * 0.2, 0.55, 0.65, 'x');

  // Laube: the gallery runs along the +x eaves wall, under the roof overhang
  const galY = plinth + wallH * 0.7;
  if (size.gallery) {
    const gx = w / 2 + 0.5;
    b.box('planks', PLANK_TONE, [1.0, 0.1, d - 0.4], [gx, galY, 0]);
    for (let i = 0; i < 7; i++) b.box('planks', mixTone(PLANK_TONE, 0xffffff, 0.08), [1.0, 0.06, (d - 0.4) / 7 - 0.03], [gx, galY + 0.04, -d / 2 + 0.2 + ((i + 0.5) / 7) * (d - 0.4)]);
    b.box('planks', PLANK_DARK, [0.09, 0.09, d - 0.3], [gx + 0.45, galY + 0.88, 0]);              // hand rail
    for (let i = 0; i <= 7; i++) b.box('planks', PLANK_DARK, [0.07, 0.85, 0.07], [gx + 0.45, galY + 0.45, -d / 2 + 0.15 + (i / 7) * (d - 0.3)]);
    for (const s of [-1, 1]) b.cyl('logs', logTone, 0.08, 0.09, galY, [gx + 0.45, galY / 2, s * (d / 2 - 0.25)], undefined, 6);
    // brackets carrying the gallery floor
    for (const s of [-1, 1]) b.box('logs', mixTone(logTone, 0x000000, 0.2), [0.9, 0.12, 0.12], [gx - 0.05, galY - 0.1, s * (d * 0.28)]);
  }

  // firewood stacked under the far eaves, a bench by the door: a farmstead, not a display model
  woodpileInto(b, -w / 2 - 0.45, 0.0, -d * 0.12, Math.PI / 2, variant === 'small' ? 0.7 : 1.0);
  b.box('planks', PLANK_DARK, [1.3, 0.09, 0.34], [w * 0.26, plinth + 0.42, d / 2 + 0.5]);
  for (const s of [-1, 1]) b.box('planks', TIMBER_DARK, [0.11, 0.42, 0.28], [w * 0.26 + s * 0.5, plinth + 0.21, d / 2 + 0.5]);

  gableRoof(b, w, d, ridge, plinth + wallH, { tone: roofTone, overhang });
  // hearth smoke: a stone stack on the big houses, a shingled smoke hood on the small ones
  if (variant === 'inn' || variant === 'large') {
    chimney(b, -w * 0.2, plinth + wallH + ridge * 0.55, -d * 0.2, 1.5, 0.8, 'masonry', MASONRY_TONE);
  } else {
    b.box('planks', TIMBER_DARK, [0.66, 0.5, 0.66], [0, plinth + wallH + ridge + 0.1, -d * 0.22]);
    pyramidRoof(b, 0.55, 0.34, plinth + wallH + ridge + 0.34, [0, 0, -d * 0.22], 4, roofTone);
  }

  if (variant === 'inn') {
    // wrought-iron bracket + painted board, and the market stall that stands beside a village tavern
    b.cyl('iron', IRON_TONE, 0.035, 0.035, 1.0, [w / 2 + 0.55, plinth + wallH * 0.95, d / 2 - 0.9], [0, 0, Math.PI / 2], 6);
    b.box('planks', 0x4e3a22, [0.85, 0.62, 0.06], [w / 2 + 1.0, plinth + wallH * 0.62, d / 2 - 0.9]);
    b.cyl('iron', IRON_TONE, 0.02, 0.02, 0.36, [w / 2 + 1.0, plinth + wallH * 0.82, d / 2 - 0.9], undefined, 5);
    barrelInto(b, -w * 0.42, 0, d / 2 + 0.55, 0.4);
  }
  return [];
}

export function houseBlockbau(rng: Rng, variant?: string): Object3D {
  const b = new Build();
  const extra = blockbauInto(b, rng, variant);
  return b.emit('house.blockbau', extra);
}

// ---------------- stone town house ----------------

export function houseStone(rng: Rng, variant?: string): Object3D {
  const b = new Build();
  if (townHouseInto(b, rng, variant)) return b.emit('house.stone');   // MegaKit-composed (townhouse.ts)
  const w = variant === 'large' ? 10.4 : 8.6, d = 7, ridge = 2.5;
  const wallH = 6.4 * (1 + (rng.next() - 0.5) * 0.12);
  const wash = [PLASTER_TONE, 0xd6c49a, 0xc9c6bb][Math.floor(rng.next() * 3)];
  // rubble ground storey, limewashed upper storeys, ashlar quoins tying the corners
  b.box('masonry', MASONRY_TONE, [w, 2.6, d], [0, 1.3, 0]);
  b.box('plaster', wash, [w - 0.06, wallH - 2.5, d - 0.06], [0, 2.5 + (wallH - 2.5) / 2, 0]);
  b.box('masonry', mixTone(MASONRY_TONE, 0x000000, 0.15), [w, 2.0, d], [0, -1.0, 0]);              // buried footing
  b.box('ashlar', STONE_TONE, [w + 0.4, 0.55, d + 0.4], [0, 0.28, 0]);                              // plinth course
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) quoins(b, sx * (w / 2 - 0.14), sz * (d / 2 - 0.14), wallH - 0.5, 0.5);
  b.box('ashlar', mixTone(STONE_TONE, 0xffffff, 0.08), [w + 0.22, 0.2, d + 0.22], [0, 2.62, 0]);    // string course
  for (const yy of [wallH * 0.32, wallH * 0.62, wallH * 0.86]) {
    for (const xx of [-w * 0.28, w * 0.28]) windowOpening(b, xx, yy, d / 2 + 0.06, 0.6, 0.85, 'z', { shutters: yy > 3 });
    windowOpening(b, -w / 2 - 0.06, yy, -1.0, 0.5, 0.8, 'x', { sign: -1, shutters: false });
    windowOpening(b, w / 2 + 0.06, yy, 1.2, 0.5, 0.8, 'x', { shutters: false });
  }
  doorway(b, 0, 0, d / 2 + 0.1, 1.2, 2.3, 'z', { frame: 'ashlar', tone: STONE_TONE, arched: true });
  gableRoof(b, w, d, ridge, wallH, { overhang: 0.55, tone: SHINGLE_TONE });
  chimney(b, -w * 0.28, wallH + ridge * 0.5, 0, 1.7, 0.8);
  return b.emit('house.stone');
}

// ---------------- Stadel (barn) and Spycher (granary) ----------------

export function barn(rng: Rng): Object3D {
  const w = 9.5, d = 7.4, wallH = 4.2, ridge = 2.6, floor = 0.75;
  const b = new Build();
  // the threshing floor stands on stone piers with a plank deck (mice and damp), not on the ground
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.cyl('drystone', DRY_TONE, 0.42, 0.5, floor, [sx * (w / 2 - 0.5), floor / 2, sz * (d / 2 - 0.5)], undefined, 7);
  }
  for (const sx of [-1, 1]) b.cyl('drystone', DRY_TONE, 0.4, 0.48, floor, [sx * (w / 2 - 0.5), floor / 2, 0], undefined, 7);
  b.box('drystone', mixTone(DRY_TONE, 0x000000, 0.2), [w - 0.6, 2.0, d - 0.6], [0, -0.95, 0]);
  b.box('planks', PLANK_DARK, [w, 0.22, d], [0, floor + 0.11, 0]);
  b.box('planks', 0x4c3d26, [w - 0.3, wallH, d - 0.3], [0, floor + 0.2 + wallH / 2, 0]);            // dark interior
  for (const sz of [-1, 1]) boardWall(b, w, wallH, floor + 0.2, sz * (d / 2), 'z', PLANK_TONE, 0.32);
  for (const sx of [-1, 1]) boardWall(b, d, wallH, floor + 0.2, sx * (w / 2), 'x', PLANK_TONE, 0.32);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('logs', mixTone(LOG_TONE, 0x000000, 0.3), [0.22, wallH + 0.3, 0.22], [sx * (w / 2 - 0.08), floor + 0.2 + wallH / 2, sz * (d / 2 - 0.08)]);
  // gate with diagonal bracing
  b.box('planks', 0x241c11, [3.2, 3.2, 0.1], [0, floor + 1.8, d / 2 + 0.04]);
  for (let i = 0; i < 8; i++) b.box('planks', i % 2 ? 0x5a4629 : 0x4d3c23, [0.38, 3.15, 0.07], [-1.55 + i * 0.42, floor + 1.8, d / 2 + 0.1]);
  for (const s of [-1, 1]) b.box('planks', TIMBER_DARK, [3.5, 0.15, 0.06], [0, floor + 1.8 + s * 0.05, d / 2 + 0.16], [0, 0, s * 0.75]);
  b.box('planks', TIMBER_DARK, [3.5, 0.18, 0.09], [0, floor + 3.45, d / 2 + 0.14]);
  for (const s of [-1, 1]) b.box('planks', TIMBER_DARK, [0.16, 3.3, 0.1], [s * 1.72, floor + 1.8, d / 2 + 0.14]);
  // ramp up to the gate, and the hay-hoist beam out of the gable
  // ramp: kept inside the 13 × 10 m footprint models.test.ts documents for the Stadel
  b.box('planks', mixTone(PLANK_TONE, PLANK_DARK, 0.3), [3.0, 0.16, 1.9], [0, floor * 0.5, d / 2 + 0.92], [0.36, 0, 0]);
  b.cyl('logs', TIMBER_DARK, 0.11, 0.12, 1.6, [0, floor + 0.2 + wallH + ridge * 0.55, d / 2 + 0.7], [Math.PI / 2, 0, 0], 6);
  for (const sz of [-1, 1]) boardGable(b, w, ridge * 0.92, floor + 0.2 + wallH, sz * (d / 2 - 0.05), mixTone(PLANK_TONE, PLANK_DARK, 0.25));
  gableRoof(b, w, d, ridge, floor + 0.2 + wallH, { overhang: 0.85, tone: 0x7d7568 });
  void rng;
  return b.emit('barn');
}

/** Spycher: the grain store, lifted clear of the ground on mushroom-capped staddle stones. */
export function granary(rng: Rng): Object3D {
  const w = 3.6, d = 3.0, wallH = 2.2, ridge = 1.15, floor = 0.95;
  const b = new Build();
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * (w / 2 - 0.45), z = sz * (d / 2 - 0.4);
    b.cyl('drystone', DRY_TONE, 0.24, 0.3, floor - 0.16, [x, (floor - 0.16) / 2, z], undefined, 8);
    b.cyl('drystone', mixTone(DRY_TONE, 0xffffff, 0.12), 0.13, 0.46, 0.18, [x, floor - 0.07, z], undefined, 9);   // mouse cap
  }
  b.box('planks', PLANK_DARK, [w + 0.3, 0.16, d + 0.3], [0, floor + 0.08, 0]);
  logWalls(b, w, d, wallH, floor + 0.16, 0.25, mixTone(LOG_TONE, PLANK_DARK, 0.2));
  for (const sz of [-1, 1]) boardGable(b, w, ridge * 0.9, floor + 0.16 + wallH, sz * (d / 2 - 0.04));
  doorway(b, 0, floor + 0.16, d / 2 + 0.1, 0.75, 1.5, 'z');
  // the Poly Haven ladder scan leaning on the sill; the procedural ladder stands in without the asset
  if (!b.prop('wooden_ladder', [0.55, 0, d / 2 + 0.75], [-0.42, 0, 0], 1.15)) ladderInto(b, 0, 0, d / 2 + 0.62, floor + 0.4, 0.5);
  gableRoof(b, w, d, ridge, floor + 0.16 + wallH, { overhang: 0.55, tone: 0x8b8478 });
  void rng;
  return b.emit('granary');
}

// ---------------- church, chapel, monastery ----------------

/**
 * Romanesque village church: coursed-rubble nave with ashlar quoins and pilaster strips, round-arched
 * windows with real voussoirs, a semicircular apse, a west tower with twin belfry openings and a
 * shingled spire. Drawn into a caller's `Build` so the monastery can share the same merged batches.
 */
export function churchInto(b: Build, ox = 0, oz = 0): void {
  const naveW = 9, naveD = 13, wallH = 7.4, ridge = 3.0;
  b.box('masonry', MASONRY_TONE, [naveW, wallH, naveD], [ox, wallH / 2, oz]);
  b.box('masonry', mixTone(MASONRY_TONE, 0x000000, 0.2), [naveW, 2.2, naveD], [ox, -1.1, oz]);        // buried footing
  b.box('ashlar', STONE_TONE, [naveW + 0.5, 0.75, naveD + 0.5], [ox, 0.37, oz]);                      // battered plinth
  b.box('ashlar', mixTone(STONE_TONE, 0x000000, 0.08), [naveW + 0.3, 0.2, naveD + 0.3], [ox, 0.8, oz]);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) quoins(b, ox + sx * (naveW / 2 - 0.16), oz + sz * (naveD / 2 - 0.16), wallH - 0.9, 0.85, mixTone(STONE_TONE, 0xffffff, 0.05), 0.46);
  // pilaster strips (Lisenen) between the window bays
  for (const i of [-1, 0, 1]) for (const sx of [-1, 1]) {
    b.box('ashlar', mixTone(STONE_TONE, 0x000000, 0.05), [0.34, wallH - 1.0, 0.8], [ox + sx * (naveW / 2 + 0.12), 0.85 + (wallH - 1.0) / 2, oz + i * 3.9]);
  }
  // round-arched windows: long walls…
  for (const i of [-1, 0, 1]) for (const sx of [-1, 1]) {
    archedOpening(b, ox + sx * (naveW / 2), wallH * 0.56, oz + i * 3.9 + 1.95, 0.62, 1.8, 'x', sx);
  }
  // …and both gable ends, outboard of the tower and the apse that stand in front of them
  for (const sz of [-1, 1]) for (const dx of [-3.1, 3.1]) {
    archedOpening(b, ox + dx, wallH * 0.5, oz + sz * (naveD / 2), 0.5, 1.5, 'z', sz);
  }
  // corbel frieze under the eaves — the Romanesque signature at eye level
  for (const sx of [-1, 1]) {
    const n = Math.round(naveD / 0.75);
    for (let i = 0; i < n; i++) b.box('ashlar', i % 2 ? STONE_TONE : mixTone(STONE_TONE, 0x000000, 0.12), [0.3, 0.24, 0.4], [ox + sx * (naveW / 2 + 0.1), wallH - 0.35, oz - naveD / 2 + ((i + 0.5) / n) * naveD]);
  }
  b.box('ashlar', mixTone(STONE_TONE, 0xffffff, 0.08), [naveW + 0.45, 0.2, naveD + 0.45], [ox, wallH - 0.08, oz]);  // eaves cornice
  // west front: stone-framed portal, oculus in each gable
  b.box('ashlar', STONE_TONE, [2.6, 3.6, 0.34], [ox, 1.8, oz - naveD / 2 - 0.08]);
  doorway(b, ox, 0, oz - naveD / 2 - 0.24, 1.3, 2.3, 'z', { frame: 'ashlar', tone: STONE_TONE, arched: true, sign: -1 });
  for (const sz of [-1, 1]) {
    b.cyl('ashlar', STONE_TONE, 0.62, 0.62, 0.24, [ox, wallH + 1.3, oz + sz * (naveD / 2 + 0.4)], [Math.PI / 2, 0, 0], 10);
    b.cyl('planks', 0x120f0a, 0.42, 0.42, 0.18, [ox, wallH + 1.3, oz + sz * (naveD / 2 + 0.46)], [Math.PI / 2, 0, 0], 10);
  }
  // south door with a stone surround
  b.box('ashlar', STONE_TONE, [0.34, 3.2, 2.1], [ox + naveW / 2 + 0.06, 1.6, oz - 1.0]);
  doorway(b, ox + naveW / 2 + 0.2, 0, oz - 1.0, 1.25, 2.3, 'x', { frame: 'ashlar', tone: STONE_TONE, arched: true });
  for (const sz of [-1, 1]) b.wedge('masonry', MASONRY_TONE, [naveW, ridge * 0.98, 0.5], [ox, wallH, oz + sz * (naveD / 2 - 0.25)]);
  gableRoof(b, naveW, naveD, ridge, wallH, { overhang: 0.5, weights: false, at: [ox, oz], tone: 0x8b8478 });
  // apse (east end)
  b.cyl('masonry', MASONRY_TONE, 2.6, 2.75, 5.6, [ox, 2.8, oz + naveD / 2 + 1.1], undefined, 10);
  b.cyl('ashlar', STONE_TONE, 2.95, 3.05, 0.6, [ox, 0.3, oz + naveD / 2 + 1.1], undefined, 10);
  archedOpening(b, ox, 3.4, oz + naveD / 2 + 3.7, 0.5, 1.4, 'z', 1);
  pyramidRoof(b, 3.05, 1.9, 5.6, [ox, 0, oz + naveD / 2 + 1.1], 10, 0x8b8478, 0);
  // west tower
  const tw = 4.4, th = 15, tz = oz - naveD / 2 - tw / 2 + 0.8;
  b.box('masonry', MASONRY_TONE, [tw, th, tw], [ox, th / 2, tz]);
  b.box('masonry', mixTone(MASONRY_TONE, 0x000000, 0.2), [tw, 2.2, tw], [ox, -1.1, tz]);
  b.box('ashlar', STONE_TONE, [tw + 0.5, 0.75, tw + 0.5], [ox, 0.37, tz]);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) quoins(b, ox + sx * (tw / 2 - 0.16), tz + sz * (tw / 2 - 0.16), th - 0.9, 0.85, mixTone(STONE_TONE, 0xffffff, 0.05), 0.46);
  for (const y of [5.2, 9.6]) b.box('ashlar', mixTone(STONE_TONE, 0xffffff, 0.06), [tw + 0.3, 0.18, tw + 0.3], [ox, y, tz]);   // string courses
  // twin belfry openings on each face, with the colonnette between them
  for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as [number, number][]) {
    for (const off of [-0.72, 0.72]) {
      const x = ox + (dx === 0 ? off : dx * (tw / 2));
      const z = dz === 0 ? tz + off : tz + dz * (tw / 2);
      archedOpening(b, x, th - 2.3, z, 0.5, 1.4, dx === 0 ? 'z' : 'x', dx === 0 ? dz : dx);
    }
    const cx = ox + (dx === 0 ? 0 : dx * (tw / 2 + 0.02)), cz = dz === 0 ? tz : tz + dz * (tw / 2 + 0.02);
    b.cyl('ashlar', STONE_TONE, 0.11, 0.12, 1.5, [cx, th - 2.3, cz], undefined, 7);
  }
  for (const sx of [-1, 1]) b.box('ashlar', STONE_TONE, [0.2, 1.1, 0.16], [ox + sx * 0.1, th * 0.55, tz - tw / 2 - 0.02]);
  b.box('ashlar', mixTone(STONE_TONE, 0xffffff, 0.1), [tw + 0.55, 0.32, tw + 0.55], [ox, th + 0.12, tz]);
  pyramidRoof(b, tw * 0.82, 5.4, th + 0.28, [ox, 0, tz], 4, 0x8b8478);
  b.box('iron', IRON_TONE, [0.09, 1.1, 0.09], [ox, th + 6.3, tz]);
  b.box('iron', IRON_TONE, [0.6, 0.09, 0.09], [ox, th + 6.5, tz]);
  doorway(b, ox, 0, tz - tw / 2 - 0.06, 1.35, 2.5, 'z', { frame: 'ashlar', tone: STONE_TONE, arched: true, sign: -1 });
}

export function church(rng: Rng): Object3D {
  const b = new Build();
  churchInto(b);
  void rng;
  return b.emit('church');
}

export function chapel(rng: Rng): Object3D {
  const w = 4.8, d = 6.6, wallH = 3.6, ridge = 1.9;
  const b = new Build();
  b.box('masonry', MASONRY_TONE, [w, wallH, d], [0, 0.45 + wallH / 2, 0]);
  b.box('masonry', mixTone(MASONRY_TONE, 0x000000, 0.2), [w, 2.0, d], [0, -1.0, 0]);
  b.box('ashlar', STONE_TONE, [w + 0.45, 0.5, d + 0.45], [0, 0.25, 0]);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) quoins(b, sx * (w / 2 - 0.14), sz * (d / 2 - 0.14), wallH - 0.3, 0.6, STONE_TONE, 0.4);
  b.box('plaster', 0xe4ddca, [w - 0.16, wallH - 0.5, d - 0.16], [0, 0.7 + (wallH - 0.5) / 2, 0]);      // limewash over the rubble
  for (const sx of [-1, 1]) archedOpening(b, sx * (w / 2), 0.45 + wallH * 0.55, 1.1, 0.42, 1.15, 'x', sx);
  doorway(b, 0, 0.45, -d / 2 - 0.08, 0.95, 1.9, 'z', { frame: 'ashlar', tone: STONE_TONE, arched: true, sign: -1 });
  for (const sz of [-1, 1]) b.wedge('masonry', MASONRY_TONE, [w, ridge * 0.94, 0.45], [0, 0.45 + wallH, sz * (d / 2 - 0.22)]);
  gableRoof(b, w, d, ridge, 0.45 + wallH, { overhang: 0.55, weights: true, tone: 0x8b8478 });
  // ridge turret with a bell
  const ty = 0.45 + wallH + ridge;
  b.box('planks', TIMBER_DARK, [0.66, 0.9, 0.66], [0, ty + 0.45, -d / 2 + 1.0]);
  for (const s of [-1, 1]) b.box('planks', 0x100d09, [0.06, 0.55, 0.34], [s * 0.34, ty + 0.5, -d / 2 + 1.0]);
  b.cyl('iron', mixTone(IRON_TONE, 0x8a6a2a, 0.5), 0.11, 0.16, 0.24, [0, ty + 0.5, -d / 2 + 1.0], undefined, 8);
  pyramidRoof(b, 0.62, 0.85, ty + 0.9, [0, 0, -d / 2 + 1.0], 4, 0x8b8478);
  b.box('iron', IRON_TONE, [0.05, 0.5, 0.05], [0, ty + 2.05, -d / 2 + 1.0]);
  b.box('iron', IRON_TONE, [0.28, 0.05, 0.05], [0, ty + 2.13, -d / 2 + 1.0]);
  void rng;
  return b.emit('chapel');
}

export function monastery(rng: Rng): Object3D {
  const b = new Build();
  churchInto(b);
  const side = 13, wallH = 3.4, cx = 12, cz = 4;
  // cloister: four ranges around a garth, arcaded toward the middle
  for (let k = 0; k < 4; k++) {
    const ang = (Math.PI / 2) * k;
    const ox = cx + Math.sin(ang) * side / 2, oz = cz + Math.cos(ang) * side / 2;
    const len = side + 2.6;
    b.box('masonry', MASONRY_TONE, [len, wallH, 2.6], [ox, wallH / 2, oz], [0, ang, 0]);
    b.box('plaster', 0xd6cfbb, [len - 0.1, wallH - 0.8, 2.4], [ox, 0.5 + (wallH - 0.8) / 2, oz], [0, ang, 0]);
    gableRoofRotated(b, len, 2.6, 1.0, wallH, ox, oz, ang);
    for (let i = -2; i <= 2; i++) {
      const px = ox + Math.cos(ang) * i * 2.4 + Math.sin(ang) * -1.35;
      const pz = oz - Math.sin(ang) * i * 2.4 + Math.cos(ang) * -1.35;
      b.cyl('ashlar', STONE_TONE, 0.16, 0.18, 2.4, [px, 1.2, pz], undefined, 8);
      b.cyl('ashlar', mixTone(STONE_TONE, 0xffffff, 0.1), 0.3, 0.22, 0.25, [px, 2.5, pz], undefined, 8);
      b.cyl('ashlar', mixTone(STONE_TONE, 0xffffff, 0.1), 0.24, 0.3, 0.2, [px, 0.06, pz], undefined, 8);
    }
  }
  b.box('drystone', DRY_TONE, [0.9, 2.2, 20], [-9, 1.1, 2]);
  void rng;
  return b.emit('monastery');
}

// ---------------- mill ----------------

export function mill(rng: Rng): Object3D {
  const b = new Build();
  const extra = blockbauInto(b, rng, 'small');
  const cx = 3.9, cy = 2.0;
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
  for (const s of [-1, 1]) b.box('planks', TIMBER_DARK, [3.2, 0.35, 0.08], [cx + 1.4, cy + 2.25, s * 0.45]);
  b.cyl('logs', TIMBER_DARK, 0.1, 0.12, cy + 2.0, [cx + 2.8, (cy + 2.0) / 2, 0], undefined, 6);
  return b.emit('mill', extra);
}

/** A trestle market stall, registered on its own and set beside the tavern in a village. */
export function marketStall(rng: Rng): Object3D {
  const b = new Build();
  marketStallInto(b, 0, 0, 0, rng.next() * 0.4);
  return b.emit('market.stall');
}
