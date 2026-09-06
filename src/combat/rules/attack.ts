/**
 * Attack resolution: d20 + skill vs Defense, Edge/Burden (2d20 best/worst, sources cancel pairwise),
 * damage by weapon dice + soak by damage type (blunt bypasses half soak). ARCHITECTURE.md §5.3. Pure functions.
 */
import type { Rng } from '@core/rng';
import { rollDice } from '@core/rng';
import type { DamageType } from '@core/dsl';
import type { Difficulty } from '@core/context';
import type { AttackRoll } from '@core/services';

export type { Difficulty };

/**
 * 4.4 difficulty scalars (Normal = 1.0 identity). Story softens enemy damage; Hard sharpens it.
 * Applied to ENEMY-originated damage only — the engine passes `attacker.side` through
 * `damageScaleFor`; player damage is untouched on every mode. Pure constants, no RNG.
 */
export function damageScaleFor(difficulty: Difficulty | undefined, attackerSide: 'player' | 'enemy' | 'neutral'): number {
  if (attackerSide !== 'enemy') return 1;
  if (difficulty === 'story') return 0.75;
  if (difficulty === 'hard') return 1.25;
  return 1;
}

/** 4.4: player-side morale checks are easier on Story (DC −2) and harder on Hard (DC +2). */
export function moraleDcShiftFor(difficulty: Difficulty | undefined, unitSide: 'player' | 'enemy' | 'neutral'): number {
  if (unitSide !== 'player') return 0;
  if (difficulty === 'story') return -2;
  if (difficulty === 'hard') return 2;
  return 0;
}

export interface D20Result {
  rolls: [number, number?];
  used: number;
  mode: 'normal' | 'edge' | 'burden';
  breakdown: string[];
}

/** Sources cancel pairwise; net Edge → best of 2d20, net Burden → worst of 2d20, otherwise a flat d20. */
export function rollD20Mode(rng: Rng, edge: string[], burden: string[]): D20Result {
  const netEdge = Math.max(0, edge.length - burden.length);
  const netBurden = Math.max(0, burden.length - edge.length);
  const breakdown: string[] = [...edge.map((s) => `Edge: ${s}`), ...burden.map((s) => `Burden: ${s}`)];
  if (netEdge === 0 && netBurden === 0) {
    const r = rng.die(20);
    return { rolls: [r], used: r, mode: 'normal', breakdown };
  }
  const a = rng.die(20);
  const b = rng.die(20);
  const mode: 'edge' | 'burden' = netEdge > 0 ? 'edge' : 'burden';
  const used = mode === 'edge' ? Math.max(a, b) : Math.min(a, b);
  return { rolls: [a, b], used, mode, breakdown };
}

export interface AttackInputs {
  attackBonus: number; // skill mod + weapon/attack perk mods + flat situational bonuses (stance etc.)
  targetDefense: number;
  edge: string[];
  burden: string[];
  weaponDice: string;
  damageType: DamageType;
  damageBonus: number; // strength or agility (finesse) modifier
  soak: Record<DamageType, number>;
  ignoreSoak?: number;
  critRange?: number; // natural roll ≥ this is a critical hit; default 20
}

export function rollAttack(inputs: AttackInputs, rng: Rng): AttackRoll {
  const d20 = rollD20Mode(rng, inputs.edge, inputs.burden);
  const critRange = inputs.critRange ?? 20;
  const naturalRolled = d20.mode === 'edge' ? Math.max(...d20.rolls.filter((x): x is number => x !== undefined))
    : d20.mode === 'burden' ? Math.min(...d20.rolls.filter((x): x is number => x !== undefined))
    : d20.used;
  const fumble = naturalRolled === 1;
  const critical = naturalRolled >= critRange;
  const total = d20.used + inputs.attackBonus;
  const hit = !fumble && (critical || total >= inputs.targetDefense);

  let damage = 0;
  let damageRaw = 0;
  let soakApplied = 0;
  if (hit) {
    damageRaw = rollDice(inputs.weaponDice, rng) + inputs.damageBonus;
    if (critical) damageRaw += rollDice(inputs.weaponDice, rng);
    const baseSoak = inputs.soak[inputs.damageType] ?? 0;
    soakApplied = Math.max(0, (inputs.damageType === 'blunt' ? Math.floor(baseSoak / 2) : baseSoak) - (inputs.ignoreSoak ?? 0));
    damage = Math.max(0, damageRaw - soakApplied);
  }

  const breakdown = [
    ...d20.breakdown,
    `d20 (${d20.mode}): [${d20.rolls.filter((x) => x !== undefined).join(', ')}] → ${d20.used}`,
    `+${inputs.attackBonus} bonus = ${total} vs Defense ${inputs.targetDefense}`,
    fumble ? 'fumble (natural 1)' : critical ? 'critical hit!' : hit ? 'hit' : 'miss',
  ];
  if (hit) breakdown.push(`damage ${damageRaw} − soak ${soakApplied} = ${damage}`);

  return {
    d20: d20.rolls,
    used: d20.used,
    mode: d20.mode,
    bonus: inputs.attackBonus,
    total,
    targetDefense: inputs.targetDefense,
    hit,
    critical,
    fumble,
    damage,
    damageRaw,
    soak: soakApplied,
    breakdown,
  };
}

export function combineSoak(base: Record<DamageType, number>, extra: Partial<Record<DamageType, number>>): Record<DamageType, number> {
  return { cut: base.cut + (extra.cut ?? 0), thrust: base.thrust + (extra.thrust ?? 0), blunt: base.blunt + (extra.blunt ?? 0) };
}

/**
 * Exact (closed-form, no rolling) hit-chance matching `rollAttack`'s own hit rule precisely: natural 1 always
 * misses, natural ≥ critRange always hits, otherwise d + attackBonus ≥ targetDefense. `hit(d)` is monotonic
 * non-decreasing in d, so P(max(a,b) hits) = 1 − (1 − p)² and P(min(a,b) hits) = p² exactly (not an
 * approximation) — issue 7 / probe 6.
 */
export function estimateHitChance(attackBonus: number, targetDefense: number, critRange: number, mode: 'normal' | 'edge' | 'burden'): number {
  let hits = 0;
  for (let d = 1; d <= 20; d++) {
    if (d === 1) continue; // fumble always misses
    if (d >= critRange || d + attackBonus >= targetDefense) hits++;
  }
  const p = hits / 20;
  if (mode === 'edge') return 1 - (1 - p) ** 2;
  if (mode === 'burden') return p * p;
  return p;
}
