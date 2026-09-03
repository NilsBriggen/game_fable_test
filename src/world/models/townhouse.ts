/**
 * Buildings composed from the MegaKit pieces (megakit.ts) plus the shared procedural sub-assemblies:
 *   - the stone-and-plaster town house of Luzern / Zug / Sarnen (`house.stone`): rubble ground storey,
 *     limewashed upper storey with half-timber panels, shuttered windows, framed door on a stone
 *     threshold, round-tile roof with a dormer and a chimney;
 *   - the village tavern (`house.blockbau` variant `inn`): the same stone ground storey and jettied
 *     plaster storey with a timber Laube gallery along the eaves side, but under an Alpine stone-weighted
 *     shingle roof (kit.ts `gableRoof`), with the sign bracket, lantern, table and stools of a Sust.
 *
 * Kit wall modules are 2 m wide × 3.12 m tall with their exterior face on local +z (z = +0.09) and their
 * interior at z = −0.31; every wall helper here places the exterior face exactly on the footprint line.
 * Every function returns false without drawing when the kit is not loaded, so the callers can draw the
 * procedural version instead (unit tests, missing asset).
 */
import { Rng } from '@core/rng';
import {
  Build, DRY_TONE, IRON_TONE, MASONRY_TONE, PLANK_DARK, PLANK_TONE, PLASTER_TONE, SHINGLE_TONE, STONE_TONE,
  TIMBER_DARK, TILE_TONE, gableRoof, mixTone, stonePlinth, type XYZ,
} from './kit';
import { hasKit } from './megakit';
import { barrelInto, marketStallInto, woodpileInto } from './props';

type Face = 'front' | 'back' | 'right' | 'left';
const YAW: Record<Face, number> = { front: 0, back: Math.PI, right: Math.PI / 2, left: -Math.PI / 2 };

/** Module-grid helper for one rectangular storey plan: hw/hd are the half-extents of the footprint. */
class Plan {
  constructor(private b: Build, private hw: number, private hd: number) {}

  /** World position of a point given in a wall module's local frame (module `i` on `face`, storey base `y`). */
  local(face: Face, i: number, y: number, dx = 0, dy = 0, dz = 0): XYZ {
    const { hw, hd } = this;
    // module centre along the face, running left → right as seen from outside
    const along = -this.len(face) / 2 + 1 + 2 * i + dx;
    const out = -0.09 + dz;                           // 0 = exterior face on the footprint line
    switch (face) {
      case 'front': return [along, y + dy, hd + out];
      case 'back': return [-along, y + dy, -hd - out];
      case 'right': return [hw + out, y + dy, -along];
      default: return [-hw - out, y + dy, along];
    }
  }
  len(face: Face): number { return face === 'front' || face === 'back' ? this.hw * 2 : this.hd * 2; }
  modules(face: Face): number { return Math.round(this.len(face) / 2); }

  piece(name: string, face: Face, i: number, y: number, tones: Partial<Record<string, number>>, dx = 0, dy = 0, dz = 0, scale?: XYZ): void {
    this.b.piece(name, tones, this.local(face, i, y, dx, dy, dz), [0, YAW[face], 0], scale);
  }
  corners(y: number, tone: number, wide = false): void {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      this.b.piece(wide ? 'Corner_ExteriorWide_Wood' : 'Corner_Exterior_Wood', { planks: tone }, [sx * this.hw, y, sz * this.hd]);
    }
  }
}

/** Tints for the kit materials on a stone ground storey / a plaster upper storey. */
function stoneTones(wash: number): Partial<Record<string, number>> {
  return { masonry: MASONRY_TONE, plaster: wash, planks: TIMBER_DARK, ashlar: STONE_TONE };
}
function plasterTones(wash: number, timber: number): Partial<Record<string, number>> {
  return { plaster: wash, planks: timber, masonry: MASONRY_TONE, ashlar: STONE_TONE };
}

/** A framed window (dark glass behind the bars) with shutters in the module `i` of `face`. Open
 *  shutters span 2.5 m — wider than the 2 m module — so a window beside a door or another window
 *  gets its shutters closed instead of clipping through the neighbour. */
function shutteredWindow(p: Plan, face: Face, i: number, y: number, timber: number, shutter: number, closed = false): void {
  p.piece('Window_Wide_Flat1', face, i, y, { planks: timber, glass: GLASS });
  p.piece(closed ? 'WindowShutters_Wide_Flat_Closed' : 'WindowShutters_Wide_Flat_Open', face, i, y, { planks: shutter });
}
const GLASS = 0x8a95a8;

/** The kit door leaf, hung closed in a Door_Flat wall module (opening 1.1 m wide, hinge on the left). */
function doorLeaf(p: Plan, face: Face, i: number, y: number, tone: number): void {
  p.piece('Door_1_Flat', face, i, y, { planks: tone }, -0.535, 0, -0.06);
  p.piece('DoorFrame_Flat_WoodDark', face, i, y, { planks: mixTone(tone, 0x000000, 0.25) }, 0, 0, 0.02);
}

// ---------------- town house ----------------

/**
 * Stone town house: 6 m × 8 m body (3 × 4 modules), ridge along z, door in the +z gable facing the
 * street as layout.ts expects. `variant === 'large'` adds a third storey. Footprint stays inside the
 * 11.5 × 9.5 m models.test.ts asserts (roof 8.24 × 9.0 m).
 */
export function townHouseInto(b: Build, rng: Rng, variant?: string): boolean {
  if (!hasKit()) return false;
  const hw = 3, hd = 4, plinth = 0.4, storey = 3.0;
  const storeys = variant === 'large' ? 3 : 2;
  const wash = [PLASTER_TONE, 0xd6c49a, 0xc9c6bb, 0xdccbb0][Math.floor(rng.next() * 4)];
  const timber = [TIMBER_DARK, 0x5a4629, 0x3f3220][Math.floor(rng.next() * 3)];
  const shutter = [0x6b5638, 0x5a6a5a, 0x7a4a3a][Math.floor(rng.next() * 3)];
  const p = new Plan(b, hw, hd);

  stonePlinth(b, hw * 2 + 0.5, hd * 2 + 0.5, plinth, Math.floor(rng.next() * 100));
  // ground storey: coursed rubble, door in the middle of the street gable, small round-headed lights
  const g = stoneTones(wash);
  const y0 = plinth;
  p.piece('Wall_UnevenBrick_Door_Flat', 'front', 1, y0, g);
  doorLeaf(p, 'front', 1, y0, 0x4d3c23);
  p.piece('Wall_UnevenBrick_Window_Wide_Flat', 'front', 0, y0, g);
  shutteredWindow(p, 'front', 0, y0, timber, shutter, true);
  p.piece('Wall_UnevenBrick_Window_Thin_Round', 'front', 2, y0, g);
  p.piece('Window_Thin_Round1', 'front', 2, y0, { planks: timber, glass: GLASS });
  for (const face of ['left', 'right'] as Face[]) {
    for (let i = 0; i < 4; i++) {
      const win = i === 1 || i === 3;
      p.piece(win ? 'Wall_UnevenBrick_Window_Wide_Flat' : 'Wall_UnevenBrick_Straight', face, i, y0, g);
      if (win) shutteredWindow(p, face, i, y0, timber, shutter);
    }
  }
  for (let i = 0; i < 3; i++) p.piece(i === 1 ? 'Wall_UnevenBrick_Window_Thin_Round' : 'Wall_UnevenBrick_Straight', 'back', i, y0, g);
  p.piece('Window_Thin_Round1', 'back', 1, y0, { planks: timber, glass: GLASS });
  // string course between the storeys
  b.box('ashlar', mixTone(STONE_TONE, 0xffffff, 0.08), [hw * 2 + 0.3, 0.16, hd * 2 + 0.3], [0, y0 + storey + 0.02, 0]);

  // upper storeys: limewash, half-timber panels on the gables, shuttered windows
  const u = plasterTones(wash, timber);
  for (let s = 1; s < storeys; s++) {
    const y = plinth + storey * s;
    for (const face of ['front', 'back'] as Face[]) {
      for (let i = 0; i < 3; i++) {
        const win = i !== 1 || face === 'front';
        p.piece(win ? 'Wall_Plaster_Window_Wide_Flat' : 'Wall_Plaster_WoodGrid', face, i, y, u);
        if (win) shutteredWindow(p, face, i, y, timber, shutter, face === 'front' && i !== 1);
      }
    }
    for (const face of ['left', 'right'] as Face[]) {
      for (let i = 0; i < 4; i++) {
        const win = i % 2 === (s % 2);
        p.piece(win ? 'Wall_Plaster_Window_Wide_Flat' : i === 0 ? 'Wall_Plaster_WoodGrid' : 'Wall_Plaster_Straight', face, i, y, u);
        if (win) shutteredWindow(p, face, i, y, timber, shutter);
      }
    }
    p.corners(y, timber, true);
  }
  // roof: the kit's 6 × 8 tile roof (ridge along z), gable boards, a dormer to the street, a chimney
  const top = plinth + storey * storeys;
  const tiles = { tiles: TILE_TONE, planks: timber };
  b.piece('Roof_RoundTiles_6x8', tiles, [0, top, 0], undefined, [1, 1, 0.93]);   // 9.0 m long: inside the 9.5 m footprint
  // the gable board stands 0.79 m proud of its origin: inset so the ends stay inside the footprint
  for (const sz of [-1, 1]) b.piece('Roof_Front_Brick6', { plaster: wash, planks: timber }, [0, top, sz * (hd - 0.35)], [0, sz > 0 ? 0 : Math.PI, 0]);
  b.piece('Roof_Dormer_RoundTile', { ...tiles, plaster: wash, glass: GLASS }, [1.5, top + 0.6, 0.4]);
  b.piece('Prop_Chimney2', { masonry: MASONRY_TONE }, [-0.7, top + 3.3, -hd * 0.35]);
  // threshold and a stone step down to the street
  b.box('drystone', mixTone(DRY_TONE, 0xffffff, 0.1), [1.6, 0.14, 0.6], [0, plinth - 0.02, hd + 0.35]);
  b.box('drystone', DRY_TONE, [1.6, plinth * 0.55, 0.4], [0, plinth * 0.27, hd + 0.62]);
  return true;
}

// ---------------- tavern ----------------

/**
 * Village tavern / Sust: stone ground storey, jettied plaster storey with a Laube gallery along the +x
 * eaves, Alpine shingle roof weighted with stones. Same 6 × 8 m body and street-facing +z gable as the
 * Blockbau it replaces, so layout.ts' placement and the models.test.ts footprint still hold.
 */
export function tavernInto(b: Build, rng: Rng): boolean {
  if (!hasKit()) return false;
  const hw = 3, hd = 4, plinth = 0.45, storey = 3.0;
  const wash = [PLASTER_TONE, 0xdccbb0][Math.floor(rng.next() * 2)];
  const timber = 0x4a3a24;
  const shutter = 0x6b5638;
  const roofTone = [SHINGLE_TONE, 0x7d7568][Math.floor(rng.next() * 2)];
  const p = new Plan(b, hw, hd);

  stonePlinth(b, hw * 2 + 0.5, hd * 2 + 0.5, plinth, Math.floor(rng.next() * 100));
  const g = stoneTones(wash);
  p.piece('Wall_UnevenBrick_Door_Round', 'front', 1, plinth, g);
  p.piece('Door_1_Round', 'front', 1, plinth, { planks: 0x4d3c23 }, -0.535, 0, -0.06);
  p.piece('Wall_UnevenBrick_Window_Wide_Flat', 'front', 0, plinth, g);
  shutteredWindow(p, 'front', 0, plinth, timber, shutter, true);
  p.piece('Wall_UnevenBrick_Window_Wide_Flat', 'front', 2, plinth, g);
  shutteredWindow(p, 'front', 2, plinth, timber, shutter, true);
  for (const face of ['left', 'right'] as Face[]) {
    for (let i = 0; i < 4; i++) {
      const win = i === 1 || i === 2;
      p.piece(win ? 'Wall_UnevenBrick_Window_Wide_Flat' : 'Wall_UnevenBrick_Straight', face, i, plinth, g);
      if (win) shutteredWindow(p, face, i, plinth, timber, shutter, i === 2);
    }
  }
  for (let i = 0; i < 3; i++) p.piece('Wall_UnevenBrick_Straight', 'back', i, plinth, g);

  // upper storey
  const y1 = plinth + storey;
  const u = plasterTones(wash, timber);
  for (let i = 0; i < 3; i++) {
    p.piece('Wall_Plaster_Window_Wide_Flat', 'front', i, y1, u);
    shutteredWindow(p, 'front', i, y1, timber, shutter, i !== 1);
    p.piece(i === 1 ? 'Wall_Plaster_Window_Wide_Flat' : 'Wall_Plaster_WoodGrid', 'back', i, y1, u);
  }
  shutteredWindow(p, 'back', 1, y1, timber, shutter);
  for (let i = 0; i < 4; i++) {
    p.piece(i % 2 ? 'Wall_Plaster_Window_Wide_Flat' : 'Wall_Plaster_WoodGrid', 'left', i, y1, u);
    if (i % 2) shutteredWindow(p, 'left', i, y1, timber, shutter);
    // the gallery side: doors onto the Laube instead of windows
    p.piece(i === 1 ? 'Wall_Plaster_Door_Flat' : 'Wall_Plaster_Window_Wide_Flat', 'right', i, y1, u);
    if (i !== 1) p.piece('Window_Wide_Flat1', 'right', i, y1, { planks: timber, glass: GLASS });
  }
  p.corners(y1, timber, true);
  // Laube: plank floor on log brackets, the kit's turned railing, posts up to the eaves
  const gx = hw + 0.55;
  b.box('planks', PLANK_TONE, [1.1, 0.1, hd * 2 - 0.2], [gx, y1 + 0.02, 0]);
  for (let i = 0; i < 4; i++) b.piece('Balcony_Simple_Straight', { planks: PLANK_DARK }, [hw + 0.1, y1 + 0.02, -hd + 1 + 2 * i], [0, Math.PI / 2, 0]);
  for (const s of [-1, 1]) b.box('logs', 0x6f5a3a, [1.1, 0.14, 0.14], [gx - 0.1, y1 - 0.1, s * (hd * 0.55)]);
  for (const s of [-1, 1]) b.cyl('logs', 0x7d6540, 0.08, 0.1, y1 + 0.02, [gx + 0.45, (y1 + 0.02) / 2, s * (hd - 0.3)], undefined, 6);
  for (const s of [-1, 1]) b.cyl('logs', 0x7d6540, 0.07, 0.07, storey - 0.4, [gx + 0.45, y1 + (storey - 0.4) / 2, s * (hd - 0.3)], undefined, 6);

  // roof: Alpine shingles, deep eaves, stone weights (kit.ts), board gables inside the rake
  const top = y1 + storey;
  const ridge = 2.4;
  for (const sz of [-1, 1]) b.piece('Roof_Front_Brick6', { plaster: wash, planks: timber }, [0, top - 0.02, sz * (hd - 0.35)], [0, sz > 0 ? 0 : Math.PI, 0], [1, ridge / 4.38 * 1.02, 1]);
  gableRoof(b, hw * 2, hd * 2, ridge, top, { tone: roofTone, overhang: 0.8 });
  b.box('masonry', MASONRY_TONE, [0.8, 1.6, 0.8], [-1.0, top + ridge * 0.55 + 0.8, -hd * 0.25]);
  b.box('ashlar', mixTone(STONE_TONE, 0xffffff, 0.1), [1.0, 0.14, 1.0], [-1.0, top + ridge * 0.55 + 1.6, -hd * 0.25]);

  // the tavern's yard: sign bracket with a lantern, table and stools by the door, a barrel, crates,
  // the market stall beside it, firewood along the back
  const sx = hw + 0.05, sz = hd - 0.6;
  b.cyl('iron', IRON_TONE, 0.035, 0.035, 1.1, [sx + 0.5, y1 + 0.6, sz], [0, 0, Math.PI / 2], 6);
  b.box('planks', 0x4e3a22, [0.9, 0.62, 0.06], [sx + 0.95, y1 + 0.2, sz]);
  if (!b.prop('wooden_lantern_01', [sx + 0.35, y1 + 0.05, sz], undefined, 1.1)) {
    b.cyl('iron', IRON_TONE, 0.09, 0.11, 0.3, [sx + 0.35, y1 + 0.2, sz], undefined, 6);
  }
  // everything in the yard stands on the ground (y = 0), outside the plinth's 4.25 m half-depth
  const ty: XYZ = [-hw + 0.9, 0, hd + 0.25];   // the yard stays inside the 9.5 m depth: the roof eaves reach 4.7 m
  if (!b.prop('wooden_table_02', ty, [0, 0.25, 0])) b.box('planks', PLANK_TONE, [1.2, 0.06, 0.7], [ty[0], 0.75, ty[2]]);
  for (const [dx, dz, yaw] of [[-0.75, 0.15, 0.4], [0.7, -0.2, -1.2]]) {
    if (!b.prop('wooden_stool_01', [ty[0] + dx, 0, ty[2] + dz], [0, yaw, 0])) b.box('planks', PLANK_DARK, [0.4, 0.45, 0.4], [ty[0] + dx, 0.22, ty[2] + dz]);
  }
  if (!b.prop('wine_barrel_01', [hw - 0.6, 0, hd + 0.4], [0, 0.5, 0])) barrelInto(b, hw - 0.6, 0, hd + 0.4, 0.38);
  if (!b.prop('wooden_crate_01', [hw - 1.6, 0, hd + 0.35], [0, 0.2, 0])) b.box('planks', 0x7a6240, [0.8, 0.4, 0.4], [hw - 1.6, 0.2, hd + 0.35]);
  // stone step up to the door, bench beside it
  b.box('drystone', mixTone(DRY_TONE, 0xffffff, 0.1), [1.6, 0.14, 0.5], [0, plinth - 0.02, hd + 0.3]);
  b.box('drystone', DRY_TONE, [1.6, plinth * 0.55, 0.35], [0, plinth * 0.27, hd + 0.55]);
  b.box('planks', PLANK_DARK, [1.3, 0.09, 0.34], [hw * 0.55, 0.42, hd + 0.4]);
  for (const s of [-1, 1]) b.box('planks', TIMBER_DARK, [0.11, 0.42, 0.28], [hw * 0.55 + s * 0.5, 0.21, hd + 0.4]);
  marketStallInto(b, -hw - 1.55, 0, hd * 0.2, Math.PI / 2);   // inside the 10.5 m width with the sign bracket opposite
  woodpileInto(b, -hw - 0.5, 0, -hd * 0.45, Math.PI / 2, 0.9);
  return true;
}

/** The kit's four-wheel farm wagon (Prop_Wagon, 4 m long along −z). Returns false without the kit. */
export function wagonInto(b: Build, x: number, y: number, z: number, yaw = 0): boolean {
  return b.piece('Prop_Wagon', { planks: 0x7a6440 }, [x, y, z], [0, yaw, 0]);
}
