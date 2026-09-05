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
  if (!Number.isFinite(totalPfennig)) totalPfennig = 0;
  const whole = Math.trunc(totalPfennig);
  const sign = whole < 0 ? -1 : 1;
  let n = Math.abs(whole);
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
  { deg: 0, letter: 'N' }, { deg: 90, letter: 'E' }, { deg: 180, letter: 'S' }, { deg: -90, letter: 'W' },
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

// ---------------- Combat: enemy inspect card + reaction prompt (pure render models) ----------------

import type { CombatantView, CombatStateView } from '@core/services';

export interface TargetCardModel {
  name: string;
  hpLine: string;
  defLine: string;
  statuses: string[];
  formationLine: string | null;
  /** false when the unit is gone (down/dead/routed) — the card must hide, not go stale. */
  alive: boolean;
}

/** Pure model for the enemy inspect card (`.cbt-target-card`): null means "hide the card".
 *  Mirrors `renderTargetCard`'s decision logic so it is unit-testable without a DOM. */
export function buildTargetCardModel(u: CombatantView | null | undefined): TargetCardModel | null {
  if (!u) return null;
  const alive = !u.down && u.hp > 0 && !u.routed;
  if (!alive) return null;
  return {
    name: u.name,
    hpLine: `HP ${u.hp}/${u.hpMax} · Morale ${u.morale}/${u.moraleMax}`,
    defLine: `Defense ${u.defense}${u.weapon ? ` · ${u.weapon.name}` : ''}${u.mounted ? ' · mounted' : ''}`,
    statuses: u.status.map((st) => st.id),
    formationLine: u.formation.inHaufen ? `Haufen +${u.formation.defenseBonus}` : null,
    alive: true,
  };
}

/** Null when the hovered unit is not an inspectable enemy of the active unit, else the card model. */
export function targetCardForHover(
  hovered: CombatantView | null | undefined,
  active: CombatantView | null | undefined,
): TargetCardModel | null {
  if (!hovered || !active) return null;
  if (hovered.side === active.side) return null;
  return buildTargetCardModel(hovered);
}

/** Refresh decision for an already-visible card on a fresh `CombatStateView` (called from
 *  `renderAll`/`update`, not only mousemove): returns 'hide' when the tracked unit is gone or
 *  the phase ended, 'refresh' when the caller should re-render (same unit, new numbers). */
export function targetCardRefresh(
  view: CombatStateView,
  cardUnitId: number | null | undefined,
): 'hide' | 'refresh' {
  if (cardUnitId === null || cardUnitId === undefined) return 'hide';
  if (view.phase === 'ended') return 'hide';
  const cu = view.units.find((u) => u.id === cardUnitId);
  if (!cu) return 'hide';
  return buildTargetCardModel(cu) ? 'refresh' : 'hide';
}

export interface ReactionPromptModel {
  question: string;
  unitId: number;
  abilityName: string;
}

/** Pure model for the reaction modal (`.cbt-reaction-modal`): null means "no modal".
 *  `abilityName` resolves via the passed lookup (content registry in-game, a stub in tests). */
export function buildReactionPrompt(
  view: CombatStateView,
  abilityNameOf: (abilityId: string) => string | undefined,
): ReactionPromptModel | null {
  const r = view.pendingReaction;
  if (!r) return null;
  const unitName = view.units.find((u) => u.id === r.unit)?.name ?? String(r.unit);
  const targetName = view.units.find((u) => u.id === r.target)?.name ?? String(r.target);
  const abilityName = abilityNameOf(r.ability) ?? r.ability;
  return {
    question: `${unitName} may ${abilityName} against ${targetName} — Accept?`,
    unitId: r.unit as number,
    abilityName,
  };
}

// ---------------- Trade: per-merchant stock ----------------

export const MERCHANT_STOCK: string[] = ['item.bread', 'item.alpkaese', 'item.wine', 'item.rope', 'item.torch', 'item.bandage', 'item.herbs', 'item.salt-sack'];

/** Small per-POI restock addendum: a merchant town stocks its own wares on top of the
 *  global fallback, so Luzern/Zug/Altdorf read differently from a roadside stall. */
const MERCHANT_RESTOCK: Record<string, string[]> = {
  'poi.luzern': ['item.cloth-bale', 'item.salt-sack', 'item.wine', 'item.salve', 'item.fishing-line'],
  'poi.zug': ['item.hammer', 'item.rope', 'item.torch', 'item.bread', 'item.leather-boots'],
  'poi.altdorf': ['item.rope', 'item.mule-tack', 'item.salt-sack', 'item.bread', 'item.flint'],
  'poi.schwyz': ['item.alpkaese', 'item.dried-meat', 'item.axe', 'item.bandage'],
  'poi.stans': ['item.alpkaese', 'item.bread', 'item.herbs'],
  'poi.sarnen': ['item.dried-meat', 'item.herbs', 'item.rope'],
  'poi.brunnen': ['item.fishing-line', 'item.bread', 'item.wine'],
  'poi.arth': ['item.bread', 'item.dried-meat', 'item.rope'],
  'poi.einsiedeln': ['item.psalter', 'item.herbs', 'item.salve', 'item.bread'],
};

/** Resolve a merchant's stock: carried stall `Container` items first (what the world
 *  actually spawned), merged with the small per-POI restock addendum when `merchantId`
 *  (a `poi.*` id from `Interactable.data.merchant`) is known, else the global fallback.
 *  Unknown defIds are kept here (the renderer filters via `itemDef`) so tests can assert
 *  the raw merge order. */
export function resolveMerchantStock(
  carriedDefIds: string[] | null | undefined,
  merchantId?: string | null,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (id: string): void => { if (!seen.has(id)) { seen.add(id); out.push(id); } };
  if (carriedDefIds && carriedDefIds.length) {
    for (const id of carriedDefIds) push(id);
  }
  if (merchantId && MERCHANT_RESTOCK[merchantId]) {
    for (const id of MERCHANT_RESTOCK[merchantId]!) push(id);
  }
  if (!out.length) return [...MERCHANT_STOCK];
  return out;
}

// ---------------- Creation preview (scratch-entity derived stats) ----------------

export interface CreationPreviewModel { hp: number; defense: number; morale: number; speed: string }

function attrMod(v: number): number {
  return Math.floor((v - 10) / 2);
}

/** Plain-attribute fallback estimate (used when `party.derived()` is unavailable). */
export function creationPreviewFallback(attrs: { endurance: number; agility: number; presence: number }): CreationPreviewModel {
  return {
    hp: 20 + attrMod(attrs.endurance) * 4,
    defense: 10 + attrMod(attrs.agility),
    morale: 60 + attrMod(attrs.presence) * 3,
    speed: '4.0 m/s',
  };
}

/** Null-safe wrapper around `party.derived()` values for the creation preview:
 *  missing/throwing derived falls back to the plain-attribute estimate. */
export function creationPreviewFromDerived(derived: { defense: number } | null | undefined, attrs: { endurance: number; agility: number; presence: number }): CreationPreviewModel {
  if (derived && Number.isFinite(derived.defense)) {
    return { hp: NaN, defense: derived.defense, morale: NaN, speed: '' };
  }
  return creationPreviewFallback(attrs);
}

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
