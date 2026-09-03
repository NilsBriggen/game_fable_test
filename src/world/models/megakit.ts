/**
 * The downloaded model kits, loaded once at boot and composed *synchronously* into `Build` batches:
 *   - Quaternius' CC0 Medieval Village MegaKit (public/assets/models/buildings/megakit.bin): 48 modular
 *     glTF pieces — 2 m wall modules, corners, doors, windows, shutters, dormers, chimneys, balconies,
 *     the wagon — used for their *shapes*; every part is re-projected with the world-scale box UVs of
 *     the shared photo-PBR material set, except the round-tile roof which keeps its own painted map.
 *   - Poly Haven CC0 prop scans (public/assets/models/props/<id>.bin), each with its own diff/nor/rough.
 *
 * The load is a top-level await: `models.ts` (and so the world module) is not evaluated before the
 * kits are in memory, which keeps `WorldService.spawnModel` synchronous and race-free for the per-POI
 * merge in src/exploration/settlements.ts. A missing file (or no `fetch` — unit tests) leaves the kit
 * empty and every building falls back to its procedural form; tests inject the file through
 * `installKit`. Provenance: tools/assets/manifest.json `models`, public/assets/CREDITS-models.md.
 */
import { loadPackedKit, parsePackedKit, type PackedPiece } from '../assets';

export const PROP_IDS = [
  'wooden_bucket_01', 'wooden_crate_01', 'wine_barrel_01', 'wooden_ladder', 'wooden_stool_01',
  'wooden_table_02', 'wooden_axe', 'stone_fire_pit', 'wooden_lantern_01',
] as const;
export type PropId = (typeof PROP_IDS)[number];

const KIT_URL = 'assets/models/buildings/megakit.bin';
const PROP_URL = (id: string): string => `assets/models/props/${id}.bin`;

const pieces = new Map<string, PackedPiece>();

/** Installs a parsed kit (or an EKIT buffer) — the loader below and the unit tests both use it. */
export function installKit(kit: Map<string, PackedPiece> | ArrayBuffer): void {
  const map = kit instanceof ArrayBuffer ? parsePackedKit(kit) : kit;
  for (const [k, v] of map) pieces.set(k, v);
}

export function kitPiece(name: string): PackedPiece | undefined {
  return pieces.get(name);
}
export function hasKit(): boolean {
  return pieces.has('Wall_Plaster_Straight');
}
export function hasProp(id: PropId): boolean {
  return pieces.has(id);
}
export function kitPieceNames(): string[] {
  return [...pieces.keys()];
}

// Boot-time load. `fetch` of a relative URL throws outside a browser, which loadPackedKit turns into null.
const loaded = await Promise.all([loadPackedKit(KIT_URL), ...PROP_IDS.map((id) => loadPackedKit(PROP_URL(id)))]);
for (const kit of loaded) if (kit) installKit(kit);
