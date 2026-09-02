/**
 * Pure progression/derived-stat math for the party module. ARCHITECTURE.md §5.5 + BUILDER_RULES task spec.
 * No ECS, no services here — everything is plain functions over plain numbers so it is trivially unit-testable
 * and reusable by `party/index.ts`.
 */
import { modifier as attrModifier } from '@core/math';
import type { Attributes } from '@core/schemas';

/** Attribute modifier = floor((attr − 10) / 2). Re-exported from core math per the task spec. */
export const modifier = attrModifier;

/** Levels at which a skill's perks unlock. */
export const PERK_LEVELS = [25, 50, 75, 100] as const;

/**
 * XP required to go from `level` to `level + 1`. ARCHITECTURE §5.5: level-up cost grows ~ level^1.6.
 * Rescaled per wave-1 critic (fix round 1, issue 1): the original `20*(level+1)^1.6` made the first
 * level-up (10→11) cost 927 XP — unreachable inside Act 1's ~12 fights (~520 XP total). This curve
 * gives 10→11 ≈ 19 XP (a handful of hits — felt in fight one), 10→25 ≈ 545 XP (first perk roughly
 * two-thirds through Act 1), while keeping the same ^1.6 shape so higher levels still slow down hard.
 * `Math.max(1, …)` guarantees a strictly positive cost even at level 0, so `applySkillXp` can never
 * spin through an infinite/degenerate loop on a zero-cost level.
 */
export function xpToNext(level: number): number {
  return Math.max(1, Math.round(5 + 0.3 * Math.pow(level + 1, 1.6)));
}

export interface SkillProgress {
  level: number;
  xp: number;
}

export interface SkillGrantResult extends SkillProgress {
  levelsGained: number;
  /** perk-threshold levels (25/50/75/100) crossed by this grant, in ascending order */
  perksCrossed: number[];
}

/** Apply an XP grant to a skill, looping level-ups and collecting any perk thresholds crossed. Pure. */
export function applySkillXp(prog: SkillProgress, amount: number, maxLevel = 100): SkillGrantResult {
  let level = prog.level;
  let xp = prog.xp + Math.max(0, amount);
  let levelsGained = 0;
  const perksCrossed: number[] = [];
  while (level < maxLevel) {
    const need = xpToNext(level);
    if (xp < need) break;
    xp -= need;
    level += 1;
    levelsGained += 1;
    if ((PERK_LEVELS as readonly number[]).includes(level)) perksCrossed.push(level);
  }
  if (level >= maxLevel) {
    level = maxLevel;
    xp = 0;
  }
  return { level, xp, levelsGained, perksCrossed };
}

/** Character level = floor(sum(skill levels) / 40). ARCHITECTURE §5.5. */
export function characterLevel(skillLevelSum: number): number {
  return Math.floor(skillLevelSum / 40);
}

/** How many attribute points a character of this level has earned (+1 every 3 levels). */
export function attributePointsEarned(level: number): number {
  return Math.floor(level / 3);
}

/** Attack skill modifier: floor(skillLevel / 10) + attrMod(governing attribute). */
export function skillAttackMod(skillLevel: number, governingAttrScore: number): number {
  return Math.floor(skillLevel / 10) + modifier(governingAttrScore);
}

/** Base (unarmoured, no shield/stance) defense: 10 + agility mod. Combat adds shield/cover/stance on top. */
export function baseDefense(agility: number): number {
  return 10 + modifier(agility);
}

/** HP max = 10 + 2*enduranceMod + level*(3 + enduranceMod), floor 6. */
export function hpMax(endurance: number, level: number): number {
  const em = modifier(endurance);
  return Math.max(6, 10 + 2 * em + level * (3 + em));
}

/** Morale max, 0-100 scale: 40 + 3*presenceMod + leadershipLevel/5. */
export function moraleMax(presence: number, leadershipLevel: number): number {
  return Math.round(40 + 3 * modifier(presence) + leadershipLevel / 5);
}

/** Carry capacity in kg: 20 + 2.5 * strength. */
export function carryCapacityKg(strength: number): number {
  return 20 + 2.5 * strength;
}

/**
 * HP regen for `hours` of rest: hours * max(1, 1 + enduranceMod). Critic fix round 1, issue 6: the
 * un-floored `1 + enduranceMod` hits 0 at endurance 8–9 (a below-average child/elder/merchant would
 * never heal from rest at all); the `Math.max(1, …)` guarantees every character heals *something*.
 */
export function restHeal(hours: number, endurance: number): number {
  return Math.max(0, hours) * Math.max(1, 1 + modifier(endurance));
}

/** Fatigue lost per hour of rest. */
export function restFatigueLoss(hours: number): number {
  return Math.max(0, hours) * 10;
}

export type DamageType = 'cut' | 'thrust' | 'blunt';

/** Sum soak from a list of per-piece soak records (armour pieces stack). */
export function sumSoak(pieces: Partial<Record<DamageType, number>>[]): Record<DamageType, number> {
  const total: Record<DamageType, number> = { cut: 0, thrust: 0, blunt: 0 };
  for (const p of pieces) {
    total.cut += p.cut ?? 0;
    total.thrust += p.thrust ?? 0;
    total.blunt += p.blunt ?? 0;
  }
  return total;
}

/** Preserve the hp:hpMax ratio when hpMax changes (e.g. on level-up). */
export function rescaleHp(hp: number, oldMax: number, newMax: number): number {
  if (oldMax <= 0) return newMax;
  const ratio = hp / oldMax;
  return Math.max(0, Math.min(newMax, Math.round(ratio * newMax)));
}

export type AttrKey = keyof Attributes;
