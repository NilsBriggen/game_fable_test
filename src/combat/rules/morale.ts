/**
 * Morale checks. ARCHITECTURE.md §5.3: d20 + presence mod + leadership/10 + formation bonus + derived
 * moraleBonus vs DC (10 base + severity); fail → Shaken; fail by ≥5 → Routed.
 */
import type { Rng } from '@core/rng';
import type { MoraleResult } from '@core/services';

export interface MoraleCheckInputs {
  presenceMod: number;
  leadershipLevel: number;
  formationBonus: number;
  moraleBonusPerk: number;
  dc: number;
  edge?: boolean; // inHaufen: Edge on morale checks
}

export function moraleCheck(inputs: MoraleCheckInputs, rng: Rng): MoraleResult {
  const rolls = inputs.edge ? [rng.die(20), rng.die(20)] : [rng.die(20)];
  const roll = inputs.edge ? Math.max(...rolls) : rolls[0];
  const bonus = inputs.presenceMod + Math.floor(inputs.leadershipLevel / 10) + inputs.formationBonus + inputs.moraleBonusPerk;
  const total = roll + bonus;
  const margin = total - inputs.dc;
  const passed = margin >= 0;
  const outcome: MoraleResult['outcome'] = passed ? 'steady' : margin <= -5 ? 'routed' : 'shaken';
  return { roll, bonus, dc: inputs.dc, passed, margin, outcome };
}

/** DC 10 base + 2 per additional trigger severity step (ARCHITECTURE §5.3). */
export function moraleDc(severity: number): number {
  return 10 + 2 * Math.max(0, severity - 1);
}
