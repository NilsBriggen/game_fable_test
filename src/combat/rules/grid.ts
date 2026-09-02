/**
 * Combat grid sampling. ARCHITECTURE.md §1 / §5.3. Pure data generation — no Three.js.
 * Square cells, 1.5 m pitch. `heightOverride` presets make encounters (and tests) deterministic without
 * a live WorldService; when the world module is available and no override is given, cells sample real terrain.
 */
import type { EncounterDef, TerrainFeature } from '@core/schemas';
import type { CellView, SurfaceType, WorldService } from '@core/services';

export interface GridInfo {
  cols: number;
  rows: number;
  cellM: number;
  origin: { x: number; z: number; yaw: number };
}

export const CELL_M = 1.5;

export function cellKey(q: number, r: number): string {
  return `${q},${r}`;
}

export function cellIndex(q: number, r: number, cols: number): number {
  return r * cols + q;
}

export function inBounds(q: number, r: number, cols: number, rows: number): boolean {
  return q >= 0 && q < cols && r >= 0 && r < rows;
}

/** local (q,r offset from centre) -> world xz, rotated by yaw around the encounter location. */
export function cellToWorldXZ(q: number, r: number, grid: GridInfo): { x: number; z: number } {
  const lx = (q - (grid.cols - 1) / 2) * grid.cellM;
  const lz = (r - (grid.rows - 1) / 2) * grid.cellM;
  const cos = Math.cos(grid.origin.yaw);
  const sin = Math.sin(grid.origin.yaw);
  return { x: grid.origin.x + lx * cos - lz * sin, z: grid.origin.z + lx * sin + lz * cos };
}

type PresetSample = (q: number, r: number, cols: number, rows: number) => { height: number; surface: SurfaceType; passable: boolean; cover: 0 | 1 | 2; difficult: boolean };

const DIFFICULT_SURFACES = new Set<SurfaceType>(['mud', 'scree', 'snow', 'water']);

function presetFlat(): PresetSample {
  return () => ({ height: 0, surface: 'grass', passable: true, cover: 0, difficult: false });
}

/** Brunnen quay: flat ground, a 1.5 m raised stone quay band down the middle (LORE §6 step 3: "Edge from
 *  high ground on the quay"). */
function presetQuay(): PresetSample {
  return (q, r, cols, rows) => {
    const onQuay = r >= Math.floor(rows * 0.35) && r <= Math.floor(rows * 0.65);
    if (onQuay) return { height: 1.5, surface: 'settlement', passable: true, cover: 0, difficult: false };
    const water = r < Math.floor(rows * 0.2);
    return { height: 0, surface: water ? 'water' : 'grass', passable: true, cover: 0, difficult: water };
  };
}

/** Einsiedeln gate: an abbey precinct wall crossing the grid with a gate gap in the middle. */
function presetGate(): PresetSample {
  return (q, r, cols, rows) => {
    const wallR = Math.floor(rows * 0.5);
    const gateHalfWidth = 2;
    const midQ = Math.floor(cols / 2);
    const isWall = r === wallR && Math.abs(q - midQ) > gateHalfWidth;
    if (isWall) return { height: 2.5, surface: 'settlement', passable: false, cover: 2, difficult: false };
    const nearWall = Math.abs(r - wallR) <= 1;
    return { height: 0, surface: 'settlement', passable: true, cover: nearWall ? 1 : 0, difficult: false };
  };
}

/** Hohle Gasse: a sunken road between high banks — the ambush terrain (LORE §6 step 7). */
function presetGasse(): PresetSample {
  return (q, r, cols, rows) => {
    const mid = rows / 2;
    const d = Math.abs(r - mid);
    if (d < rows * 0.15) return { height: -1.5, surface: 'road', passable: true, cover: 0, difficult: false };
    if (d < rows * 0.35) return { height: 2 + (d - rows * 0.15) * 1.5, surface: 'grass', passable: true, cover: 1, difficult: false };
    return { height: 4, surface: 'forest', passable: true, cover: 2, difficult: true };
  };
}

/** Morgarten: the Ägerisee lies along the WEST edge (low q — real geography, LORE §1/§3), a road strip beside
 *  it, and a slope rising ~12 m to the east (high q) that the Confederates hold. `letzi-wall` cells (impassable
 *  to mounted movers — see `path.ts`) are authored explicitly in `content/encounters.ts`'s `terrainFeatures`,
 *  not baked into this preset, so the encounter controls exactly where the chokepoint sits. Grid is authored
 *  40×24 (LORE §6 step 12, §1): q = depth from the lake (0..39), r = position along the column (0..23).
 */
function presetMorgarten(): PresetSample {
  return (q, r, cols) => {
    const lakeCols = Math.max(3, Math.floor(cols * 0.12));
    const roadCols = [lakeCols, lakeCols + 2] as const;
    if (q < lakeCols) return { height: -0.3, surface: 'water', passable: true, cover: 0, difficult: true };
    if (q >= roadCols[0] && q <= roadCols[1]) return { height: 0.1, surface: 'road', passable: true, cover: 0, difficult: false };
    const slopeStart = roadCols[1] + 1;
    const t = Math.max(0, (q - slopeStart) / Math.max(1, cols - 1 - slopeStart));
    const height = t * 12;
    const surface: SurfaceType = t > 0.6 ? 'forest' : 'grass';
    return { height, surface, passable: true, cover: 0, difficult: false };
  };
}

const PRESETS: Record<string, () => PresetSample> = {
  flat: presetFlat, quay: presetQuay, gate: presetGate, gasse: presetGasse, morgarten: presetMorgarten,
};

export function buildGrid(
  enc: EncounterDef,
  world: WorldService | undefined,
  opts: { cols?: number; rows?: number } = {},
): { grid: GridInfo; cells: CellView[] } {
  const cols = opts.cols ?? enc.grid.cols;
  const rows = opts.rows ?? enc.grid.rows;
  const cellM = enc.grid.cellM ?? CELL_M;
  const grid: GridInfo = { cols, rows, cellM, origin: { x: enc.location.x, z: enc.location.z, yaw: enc.location.yaw ?? 0 } };
  const sampler = enc.heightOverride ? PRESETS[enc.heightOverride]() : undefined;
  const cells: CellView[] = [];
  for (let r = 0; r < rows; r++) {
    for (let q = 0; q < cols; q++) {
      let cell: CellView;
      if (sampler) {
        const s = sampler(q, r, cols, rows);
        cell = { q, r, height: s.height, surface: s.surface, passable: s.passable, cover: s.cover, difficult: s.difficult || DIFFICULT_SURFACES.has(s.surface) };
      } else if (world) {
        const { x, z } = cellToWorldXZ(q, r, grid);
        try {
          const surface = world.surfaceAt(x, z);
          const height = world.heightAt(x, z);
          const water = world.isWater(x, z);
          cell = { q, r, height, surface, passable: true, cover: 0, difficult: DIFFICULT_SURFACES.has(surface) || water };
        } catch {
          cell = { q, r, height: 0, surface: 'grass', passable: true, cover: 0, difficult: false };
        }
      } else {
        cell = { q, r, height: 0, surface: 'grass', passable: true, cover: 0, difficult: false };
      }
      cells.push(cell);
    }
  }
  applyFeatures(cells, cols, enc.terrainFeatures ?? []);
  return { grid, cells };
}

function applyFeatures(cells: CellView[], cols: number, features: TerrainFeature[]): void {
  features.forEach((f, idx) => {
    for (const [q, r] of f.cells) {
      const c = cells[cellIndex(q, r, cols)];
      if (!c) continue;
      c.feature = f.kind;
      c.featureIndex = idx;
      if (f.kind === 'letzi-wall') c.cover = 2;
    }
  });
}

export function slopeDeg(a: CellView, b: CellView, cellM: number, diag: boolean): number {
  const dist = diag ? cellM * Math.SQRT2 : cellM;
  return (Math.atan2(Math.abs(b.height - a.height), dist) * 180) / Math.PI;
}

export const NEIGHBOR_OFFSETS: { dq: number; dr: number; diag: boolean }[] = [
  { dq: 1, dr: 0, diag: false }, { dq: -1, dr: 0, diag: false }, { dq: 0, dr: 1, diag: false }, { dq: 0, dr: -1, diag: false },
  { dq: 1, dr: 1, diag: true }, { dq: 1, dr: -1, diag: true }, { dq: -1, dr: 1, diag: true }, { dq: -1, dr: -1, diag: true },
];

export function cellDistance(aq: number, ar: number, bq: number, br: number): number {
  // Chebyshev-ish "cell count" for range/reach checks (8-way grid): the number of steps a king would take.
  return Math.max(Math.abs(aq - bq), Math.abs(ar - br));
}
