/** Reputation bands and hostility. LORE.md §5.6, ARCHITECTURE.md §5.6. Pure functions. */
import type { FactionDef } from '@core/schemas';

export type RepBand = 'outlaw' | 'suspect' | 'unknown' | 'trusted' | 'eidgenoss';

/** Outlaw < −60 < Suspect < −20 < Unknown < 20 < Trusted < 60 < Eidgenoss */
export function repBand(value: number): RepBand {
  if (value < -60) return 'outlaw';
  if (value < -20) return 'suspect';
  if (value < 20) return 'unknown';
  if (value < 60) return 'trusted';
  return 'eidgenoss';
}

export function clampRep(value: number): number {
  return Math.max(-100, Math.min(100, value));
}

export function isHostileRep(value: number, def: FactionDef | undefined, flagHostile: boolean): boolean {
  if (flagHostile) return true;
  if (def?.hostileBelow === undefined) return false;
  return value < def.hostileBelow;
}

export function repToastMessage(def: FactionDef | undefined, delta: number): string {
  const name = def?.name ?? 'They';
  return delta >= 0 ? `${name} think better of you.` : `${name} think worse of you.`;
}
