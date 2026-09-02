/** Condition / effect data DSL shared by quest, dialogue, exploration and combat. ARCHITECTURE.md §5.4 */
import type { DiceExpr } from './rng';

export type FactionId = string;
export type QuestId = string;
export type SkillId = string;
export type ItemId = string;
export type PoiId = string;
export type NpcId = string;
export type EncounterId = string;
export type CutsceneId = string;
export type StatusId = string;
export type DamageType = 'cut' | 'thrust' | 'blunt';

export type QuestCondition =
  | { all: QuestCondition[] }
  | { any: QuestCondition[] }
  | { not: QuestCondition }
  | { flag: string; eq?: unknown }
  | { questStage: [QuestId, string] }
  | { questStarted: QuestId }
  | { questDone: QuestId }
  | { rep: [FactionId, '>=' | '<', number] }
  | { skill: [SkillId, '>=', number] }
  | { hasItem: [ItemId, number?] }
  | { hasCompanion: NpcId }
  | { chapter: string }
  | { timeOfDay: [number, number] }
  | { var: [QuestId, string, unknown] }
  | { origin: 'uri' | 'schwyz' | 'unterwalden' }
  | { discovered: PoiId }
  | { pfennig: ['>=', number] };

export type Effect =
  | { setFlag: [string, unknown] }
  | { quest: ['start' | 'advance' | 'complete' | 'fail', QuestId, string?] }
  | { setVar: [QuestId, string, unknown] }
  | { rep: [FactionId, number] }
  | { giveItem: [ItemId, number] }
  | { takeItem: [ItemId, number] }
  | { pfennig: number }
  | { skillXp: [SkillId, number] }
  | { encounter: EncounterId }
  | { teleport: PoiId }
  | { addCompanion: NpcId }
  | { removeCompanion: NpcId }
  | { cutscene: CutsceneId }
  | { advanceTime: number }
  | { setChapter: string }
  | { setTime: [number, number, number, number?] }
  | { toast: string }
  | { journal: string }
  | { discover: PoiId }
  | { npcMove: [NpcId, PoiId] }
  | { npcRemove: NpcId }
  | { dialogue: string }
  | { rest: number }
  | { music: string }
  | { end: 'act1' };

export type CombatEffect =
  | { damage: { dice: DiceExpr; type: DamageType; bonus?: 'strength' | 'agility' | 'none' } }
  | { status: { id: StatusId; turns: number } }
  | { removeStatus: StatusId }
  | { push: { cells: number } }
  | { pull: { cells: number } }
  | { moraleCheck: { dc: number } }
  | { heal: DiceExpr }
  | { reload: 1 | 2 }
  | { rally: { radius: number } }
  | { stance: 'aggressive' | 'guarded' | 'braced' | 'neutral' }
  | { line: { cells: number; effect: CombatEffect } }
  | { cone: { cells: number; effect: CombatEffect } }
  | { terrainFeature: { use: string } }
  | { disengage: true }
  | { dash: true }
  | { stabilize: true };
