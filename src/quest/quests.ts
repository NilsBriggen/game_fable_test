/**
 * Quest state machine. ARCHITECTURE.md §5.6. Pure(ish) over `QuestMachineDeps` — no direct service
 * imports, so it is unit-testable with a tiny fake deps object. `QuestServiceImpl` (src/quest/index.ts)
 * owns one instance and wires it to the real content registry, effect runner and clock.
 */
import type { Effect } from '@core/dsl';
import type { QuestDef } from '@core/schemas';
import type { JournalEntry } from '@core/services';
import { evaluateCondition } from './conditions';
import type { RuntimeReads } from './runtime';

export interface QuestRuntimeState {
  stage: string;
  vars: Record<string, unknown>;
  done: boolean;
  failed: boolean;
  started: number;
}

export interface QuestMachineDeps {
  getQuestDef(id: string): QuestDef | undefined;
  runEffects(effects: Effect[] | undefined): Promise<void>;
  now(): number;
  poiPosition(id: string): { x: number; z: number } | null;
  emit(event: string, ...args: unknown[]): void;
}

export interface ActiveQuestView {
  id: string;
  title: string;
  stage: string;
  objective: string;
  marker?: { x: number; z: number };
}

/** 0.5s cheap-tick interval per ARCHITECTURE.md §5.6 ("advanceWhen evaluation each frame... every 0.5s"). */
export const ADVANCE_TICK_SECONDS = 0.5;

export class QuestMachine {
  readonly quests = new Map<string, QuestRuntimeState>();
  journalEntries: JournalEntry[] = [];

  constructor(private readonly deps: QuestMachineDeps) {}

  private ensure(id: string): QuestRuntimeState {
    let q = this.quests.get(id);
    if (!q) {
      q = { stage: '', vars: {}, done: false, failed: false, started: 0 };
      this.quests.set(id, q);
    }
    return q;
  }

  isStarted(id: string): boolean {
    const q = this.quests.get(id);
    return !!q && q.stage !== '';
  }

  isDone(id: string): boolean {
    return this.quests.get(id)?.done ?? false;
  }

  stage(id: string): string | null {
    const q = this.quests.get(id);
    return q && q.stage !== '' ? q.stage : null;
  }

  getVar(id: string, k: string): unknown {
    return this.quests.get(id)?.vars[k];
  }

  setVar(id: string, k: string, v: unknown): void {
    this.ensure(id).vars[k] = v;
  }

  addJournal(text: string, questId?: string): void {
    const entry: JournalEntry = { time: this.deps.now(), questId, text };
    this.journalEntries.push(entry);
    this.deps.emit('journal', entry);
  }

  async start(id: string): Promise<void> {
    if (this.isStarted(id) || this.isDone(id)) return;
    const def = this.deps.getQuestDef(id);
    if (!def) {
      console.warn(`[quest] start: unknown quest "${id}"`);
      return;
    }
    const q = this.ensure(id);
    q.started = this.deps.now();
    this.deps.emit('quest-started', id);
    await this.deps.runEffects(def.onStart);
    if (def.stages.length) await this.enterStage(id, def.stages[0].id);
  }

  async advance(id: string, stageId: string): Promise<void> {
    if (!this.isStarted(id) || this.isDone(id)) return;
    if (this.stage(id) === stageId) return;
    await this.enterStage(id, stageId);
    this.deps.emit('quest-advanced', id, stageId);
  }

  private async enterStage(id: string, stageId: string): Promise<void> {
    const def = this.deps.getQuestDef(id);
    const stage = def?.stages.find((s) => s.id === stageId);
    const q = this.ensure(id);
    q.stage = stageId;
    if (!stage) {
      console.warn(`[quest] ${id}: unknown stage "${stageId}"`);
      return;
    }
    this.addJournal(stage.journal, id);
    await this.deps.runEffects(stage.onEnter);
  }

  async complete(id: string): Promise<void> {
    const q = this.quests.get(id);
    if (!q || q.done) return;
    q.done = true;
    this.deps.emit('quest-completed', id);
    const def = this.deps.getQuestDef(id);
    await this.deps.runEffects(def?.onComplete);
  }

  async fail(id: string): Promise<void> {
    const q = this.quests.get(id);
    if (!q || q.done) return;
    q.done = true;
    q.failed = true;
    this.deps.emit('quest-failed', id);
    const def = this.deps.getQuestDef(id);
    await this.deps.runEffects(def?.onFail);
  }

  /** Cheap: only started+active quests, only their current stage's `advanceWhen`. */
  checkAdvance(rt: RuntimeReads): void {
    for (const [id, q] of this.quests) {
      if (q.stage === '' || q.done) continue;
      const def = this.deps.getQuestDef(id);
      const stage = def?.stages.find((s) => s.id === q.stage);
      if (!stage?.advanceWhen) continue;
      for (const rule of stage.advanceWhen) {
        if (evaluateCondition(rule.cond, rt)) {
          void this.advance(id, rule.to);
          break;
        }
      }
    }
  }

  activeQuests(): ActiveQuestView[] {
    const out: ActiveQuestView[] = [];
    for (const [id, q] of this.quests) {
      if (q.stage === '' || q.done) continue;
      const def = this.deps.getQuestDef(id);
      if (!def) continue;
      const stage = def.stages.find((s) => s.id === q.stage);
      let marker: { x: number; z: number } | undefined;
      if (stage?.marker) {
        marker = typeof stage.marker === 'string' ? this.deps.poiPosition(stage.marker) ?? undefined : stage.marker;
      }
      out.push({ id, title: def.title, stage: q.stage, objective: stage?.objectiveText ?? stage?.journal ?? '', marker });
    }
    return out;
  }

  serialize(): Record<string, { stage: string; vars: Record<string, unknown>; done: boolean; failed?: boolean; started: number }> {
    const out: Record<string, { stage: string; vars: Record<string, unknown>; done: boolean; failed?: boolean; started: number }> = {};
    for (const [id, q] of this.quests) out[id] = { stage: q.stage, vars: { ...q.vars }, done: q.done, failed: q.failed || undefined, started: q.started };
    return out;
  }

  restore(data: Record<string, { stage: string; vars: Record<string, unknown>; done: boolean; failed?: boolean; started: number }>): void {
    this.quests.clear();
    for (const [id, q] of Object.entries(data ?? {})) {
      this.quests.set(id, { stage: q.stage ?? '', vars: { ...(q.vars ?? {}) }, done: !!q.done, failed: !!q.failed, started: q.started ?? 0 });
    }
  }
}
