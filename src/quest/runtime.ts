/**
 * Narrow interfaces the pure condition/effect/dialogue/quest logic depends on. `QuestServiceImpl`
 * (src/quest/index.ts) implements the full `Runtime` interface by wiring to the real services; unit
 * tests build small fake objects implementing just what a given test needs. Keeping this separate from
 * `QuestServiceImpl` is what makes src/quest/*.ts "pure logic, heavily tested" per the task spec.
 */
import type { CombatResult } from '@core/services';

/** Read-only state the condition evaluator needs. */
export interface RuntimeReads {
  getFlag(key: string): unknown;
  getStage(questId: string): string | null;
  isStarted(questId: string): boolean;
  isDone(questId: string): boolean;
  getVar(questId: string, key: string): unknown;
  getRep(faction: string): number;
  getChapter(): string;
  getOrigin(): 'uri' | 'schwyz' | 'unterwalden' | null;
  isDiscovered(poiId: string): boolean;
  getPfennig(): number;
  getSkillLevel(skill: string): number;
  hasItem(itemId: string, qty: number): boolean;
  hasCompanion(npcId: string): boolean;
  getHour(): number;
}

/** Mutating operations the effect runner needs, on top of the reads above. */
export interface RuntimeWrites {
  setFlag(key: string, value: unknown): void;
  questOp(op: 'start' | 'advance' | 'complete' | 'fail', questId: string, stage?: string): Promise<void>;
  setVar(questId: string, key: string, value: unknown): void;
  changeRep(faction: string, delta: number, reason: string): void;
  giveItem(itemId: string, qty: number): void;
  takeItem(itemId: string, qty: number): void;
  addPfennig(delta: number): void;
  skillXp(skill: string, amount: number): void;
  runEncounter(id: string): Promise<CombatResult>;
  teleport(poiId: string): void;
  addCompanion(npcId: string): void;
  removeCompanion(npcId: string): void;
  runCutsceneById(id: string, questId?: string): Promise<void>;
  advanceTime(hours: number): void;
  setChapterAsync(chapter: string): Promise<void>;
  setTimeExact(y: number, m: number, d: number, h?: number): void;
  toast(msg: string): void;
  addJournalEntry(text: string, questId?: string): void;
  discoverPoi(poiId: string): void;
  npcMove(npcId: string, poiId: string): void;
  npcRemove(npcId: string): void;
  runDialogueById(id: string, questId?: string): Promise<void>;
  restParty(hours: number): void;
  setMusic(id: string): void;
  endAct(id: string): void;
}

export type Runtime = RuntimeReads & RuntimeWrites;
