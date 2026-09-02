/**
 * Pure, DOM-free helpers for the UI module — kept separate from `index.ts` so they are unit-testable
 * under vitest's `node` environment (no jsdom in this project; see BUILDER_RULES.md / ARCHITECTURE.md §5.8).
 */
import type { SaveMeta } from '@core/schemas';

// ---------------- Currency: Pfund (20 Schilling) / Schilling (12 Pfennig) / Pfennig ----------------

export interface Currency { pfund: number; schilling: number; pfennig: number; label: string }

const PFENNIG_PER_SCHILLING = 12;
const SCHILLING_PER_PFUND = 20;
const PFENNIG_PER_PFUND = PFENNIG_PER_SCHILLING * SCHILLING_PER_PFUND; // 240

/** Split a flat Pfennig total into Pfund/Schilling/Pfennig and a short display label, e.g. "3 lb 5 s 4 d". */
export function formatPfennig(totalPfennig: number): Currency {
  const sign = totalPfennig < 0 ? -1 : 1;
  let n = Math.floor(Math.abs(totalPfennig));
  const pfund = Math.floor(n / PFENNIG_PER_PFUND);
  n -= pfund * PFENNIG_PER_PFUND;
  const schilling = Math.floor(n / PFENNIG_PER_SCHILLING);
  const pfennig = n - schilling * PFENNIG_PER_SCHILLING;
  const parts: string[] = [];
  if (pfund) parts.push(`${pfund} ℔`); // ℔ librum
  if (schilling) parts.push(`${schilling} s`);
  if (pfennig || parts.length === 0) parts.push(`${pfennig} d`);
  return { pfund: sign * pfund, schilling: sign * schilling, pfennig: sign * pfennig, label: (sign < 0 ? '-' : '') + parts.join(' ') };
}

// ---------------- Compass ----------------

/** Wrap an angle (radians) into (-PI, PI]. */
export function normalizeAngle(a: number): number {
  let x = a % (Math.PI * 2);
  if (x > Math.PI) x -= Math.PI * 2;
  if (x <= -Math.PI) x += Math.PI * 2;
  return x;
}

/**
 * Map a world bearing (0 = north, radians, clockwise per HudState.compass) to a 0..1 fraction across a
 * compass strip centred on the player's facing (`yaw`), given the strip's field of view in degrees.
 * Returns null when the bearing falls outside the visible window (caller should not render a chip).
 */
export function compassX(bearing: number, yaw: number, windowDeg = 180): number | null {
  const relDeg = (normalizeAngle(bearing - yaw) * 180) / Math.PI;
  const half = windowDeg / 2;
  if (relDeg < -half || relDeg > half) return null;
  return 0.5 + relDeg / windowDeg;
}

const COMPASS_LETTERS: { deg: number; letter: string }[] = [
  { deg: 0, letter: 'N' }, { deg: 90, letter: 'E' }, { deg: 180, letter: 'S' }, { deg: -180, letter: 'S' }, { deg: -90, letter: 'W' },
];

/** Cardinal letter chips visible within the compass window, as {x fraction, letter}. */
export function compassCardinals(yaw: number, windowDeg = 180): { x: number; letter: string }[] {
  const out: { x: number; letter: string }[] = [];
  for (const c of COMPASS_LETTERS) {
    const x = compassX((c.deg * Math.PI) / 180, yaw, windowDeg);
    if (x !== null) out.push({ x, letter: c.letter });
  }
  return out;
}

// ---------------- Combat: hit chance / check odds formatting ----------------

/** "63% hit — Edge: high ground; Burden: exhausted" style breakdown for a hover tooltip. */
export function formatHitChance(hitChance: number, edge: string[], burden: string[]): string {
  const pct = Math.round(hitChance * 100);
  const parts: string[] = [];
  if (edge.length) parts.push(`Edge: ${edge.join(', ')}`);
  if (burden.length) parts.push(`Burden: ${burden.join(', ')}`);
  return parts.length ? `${pct}% hit — ${parts.join('; ')}` : `${pct}% hit`;
}

/** BG3-style bracket odds shown on a dialogue choice, e.g. "[Speech 65%]". */
export function formatCheckOdds(skillLabel: string, pct: number): string {
  return `[${skillLabel} ${Math.round(pct)}%]`;
}

// ---------------- Combat grid: world <-> cell for a rotated grid (ARCHITECTURE.md §1 / CombatStateView.grid) ----------------

export interface GridLike { cols: number; rows: number; cellM: number; origin: { x: number; z: number; yaw: number } }

/** local (q,r offset from grid centre) -> world xz, rotated by `origin.yaw` around `origin`. Mirrors
 *  combat/rules/grid.ts's cellToWorldXZ (re-implemented here per BUILDER_RULES.md's import boundary —
 *  UI may not import another module's internals). */
export function cellToWorldXZ(q: number, r: number, grid: GridLike): { x: number; z: number } {
  const lx = (q - (grid.cols - 1) / 2) * grid.cellM;
  const lz = (r - (grid.rows - 1) / 2) * grid.cellM;
  const cos = Math.cos(grid.origin.yaw);
  const sin = Math.sin(grid.origin.yaw);
  return { x: grid.origin.x + lx * cos - lz * sin, z: grid.origin.z + lx * sin + lz * cos };
}

/** Inverse of cellToWorldXZ: nearest cell (q,r) for a world position — used to turn a mouse raycast hit
 *  on the ground plane into a combat grid cell. */
export function worldToCell(x: number, z: number, grid: GridLike): { q: number; r: number } {
  const dx = x - grid.origin.x;
  const dz = z - grid.origin.z;
  const cos = Math.cos(grid.origin.yaw);
  const sin = Math.sin(grid.origin.yaw);
  const lx = dx * cos + dz * sin;
  const lz = -dx * sin + dz * cos;
  const q = Math.round(lx / grid.cellM + (grid.cols - 1) / 2) || 0; // `|| 0` folds -0 into 0
  const r = Math.round(lz / grid.cellM + (grid.rows - 1) / 2) || 0;
  return { q, r };
}

// ---------------- Combat: initiative render model ----------------

export interface InitiativeUnitLike { id: number; name: string; side: string; down?: boolean; routed?: boolean }
export interface InitiativeChip { id: number; name: string; side: string; active: boolean; down: boolean }

/** Order the initiative track for rendering: chips in turn order, active unit flagged. Units missing from
 *  the roster (already removed) are skipped rather than crashing the strip. */
export function buildInitiativeChips(order: number[], units: InitiativeUnitLike[], activeId: number | null): InitiativeChip[] {
  const byId = new Map(units.map((u) => [u.id, u]));
  const out: InitiativeChip[] = [];
  for (const id of order) {
    const u = byId.get(id);
    if (!u) continue;
    out.push({ id, name: u.name, side: u.side, active: id === activeId, down: !!(u.down || u.routed) });
  }
  return out;
}

// ---------------- Save slots ----------------

export type SaveSlotKind = 'autosave' | 'manual' | 'quicksave';
export interface SaveSlotView { slot: number; kind: SaveSlotKind; label: string; readOnlySave: boolean; empty: boolean; meta?: SaveMeta }

export const SAVE_SLOT_NUMBERS = [0, 1, 2, 3, 4, 5, 6] as const;

/** Build the fixed 7-slot model (0 autosave, 1-5 manual, 6 quicksave/read-only-for-saving) from whatever
 *  `SaveService.list()` returned, filling in empty slots so the UI never has to special-case a gap. */
export function buildSaveSlots(metas: SaveMeta[]): SaveSlotView[] {
  const bySlot = new Map(metas.map((m) => [m.slot, m]));
  return SAVE_SLOT_NUMBERS.map((slot) => {
    const kind: SaveSlotKind = slot === 0 ? 'autosave' : slot === 6 ? 'quicksave' : 'manual';
    const meta = bySlot.get(slot);
    return {
      slot,
      kind,
      label: kind === 'autosave' ? 'Autosave' : kind === 'quicksave' ? 'Quicksave' : `Slot ${slot}`,
      readOnlySave: kind === 'quicksave',
      empty: !meta,
      meta,
    };
  });
}

// ---------------- Misc formatting ----------------

export function formatWeight(kg: number): string {
  return `${kg.toFixed(1)} kg`;
}

export function formatPlaytime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export function pct(value: number, max: number): number {
  return max > 0 ? clamp01(value / max) * 100 : 0;
}
