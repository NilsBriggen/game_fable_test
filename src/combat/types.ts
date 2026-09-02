/** Private engine-internal types. Not exported outside the combat module. */
import type { EntityId } from '@core/ecs';
import type { Attributes, Side, WeaponProperty } from '@core/schemas';
import type { DamageType } from '@core/dsl';
import type { StatusEffect, Stance } from '@core/components';
import type { GridInfo } from './rules/grid';

export interface WeaponInfo {
  defId: string;
  name: string;
  hands: 1 | 2;
  reach: 1 | 2 | 3;
  damage: string;
  damageType: DamageType;
  properties: WeaponProperty[];
  range?: { short: number; long: number };
  ammo?: string;
}

export interface Unit {
  id: EntityId;
  name: string;
  side: Side;
  archetype: string;
  q: number;
  r: number;
  hp: number;
  hpMax: number;
  morale: number;
  moraleMax: number;
  attributes: Attributes;
  attackBonus: Record<string, number>;
  soak: Record<DamageType, number>;
  defenseBase: number;
  speedMBase: number;
  initiativeBonus: number;
  weapon: WeaponInfo | null;
  ranged: WeaponInfo | null;
  ammoQty: number;
  shield: boolean;
  ap: { action: boolean; bonus: boolean; reaction: boolean; moveM: number; moveMax: number };
  status: StatusEffect[];
  stance: Stance;
  loaded: boolean;
  mounted: boolean;
  down: boolean;
  dead: boolean;
  bleedTurns: number;
  routed: boolean;
  initiative: number;
  isPlayerControlled: boolean;
  doctrine: string;
  chargeCells: number;
  perkMods: Record<string, number>;
  critRange: number;
  modelId?: string;
  group?: string;
  npcId?: string;
  formation: { adjacentPolearms: number; inHaufen: boolean; defenseBonus: number; haufenId?: number };
  freeReloadUsedThisTurn: boolean;
  hasActedThisTurn: boolean;
  leadershipLevel: number;
  herbalismLevel: number;
}

export interface PendingReactionItem {
  unitId: EntityId;
  ability: string;
  trigger: string;
  targetId: EntityId;
  /** resolves with true=accept the reaction, false=decline */
  resolve: (accept: boolean) => void;
}

export function hasStatus(u: Unit, id: string): boolean {
  return u.status.some((s) => s.id === id);
}
export function addStatus(u: Unit, id: string, turns: number): void {
  const existing = u.status.find((s) => s.id === id);
  if (existing) existing.turns = Math.max(existing.turns, turns);
  else u.status.push({ id, turns });
}
export function removeStatus(u: Unit, id: string): void {
  u.status = u.status.filter((s) => s.id !== id);
}

export function isPolearm(w: WeaponInfo | null): boolean {
  return !!w && (w.properties.includes('brace') || w.properties.includes('reach'));
}

export interface EngineGrid extends GridInfo {}
