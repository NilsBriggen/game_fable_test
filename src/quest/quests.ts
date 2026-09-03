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
  /** when true, `enterStage` skips `addJournal` for this run — used by retry loops (e.g. Morgarten's
   *  muster hub) so replaying the same stages doesn't duplicate their journal lines every attempt. */
  silentJournal?: boolean;
}

export interface QuestMachineDeps {
  getQuestDef(id: string): QuestDef | undefined;
  runEffects(effects: Effect[] | undefined, questId?: string): Promise<void>;
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

  async start(id: string, opts: { silentJournal?: boolean } = {}): Promise<void> {
    if (this.isStarted(id) || this.isDone(id)) return;
    const def = this.deps.getQuestDef(id);
    if (!def) {
      console.warn(`[quest] start: unknown quest "${id}"`);
      return;
    }
    const q = this.ensure(id);
    q.started = this.deps.now();
    q.silentJournal = !!opts.silentJournal;
    this.deps.emit('quest-started', id);
    await this.deps.runEffects(def.onStart, id);
    if (def.stages.length) await this.enterStage(id, def.stages[0].id);
  }

  async advance(id: string, stageId: string): Promise<void> {
    if (this.isDone(id)) return;
    // a giver dialogue may `advance` a quest nobody has started yet (all six side quests did): start it
    // first — the first stage's journal line is the natural "quest started" entry — then move on
    if (!this.isStarted(id)) {
      if (!this.deps.getQuestDef(id)) return;
      await this.start(id);
      if (this.isDone(id)) return;
    }
    if (this.stage(id) === stageId) return;
    await this.enterStage(id, stageId);
  }

  private async enterStage(id: string, stageId: string): Promise<void> {
    const def = this.deps.getQuestDef(id);
    const stage = def?.stages.find((s) => s.id === stageId);
    const q = this.ensure(id);
    q.stage = stageId;
    // Pre-order: listeners (HUD objective, journal, save thumbnails) must see the stage change
    // before onEnter's own effects (which may re-enter checkAdvance, start other quests, etc.) run.
    this.deps.emit('quest-advanced', id, stageId);
    if (!stage) {
      console.warn(`[quest] ${id}: unknown stage "${stageId}"`);
      return;
    }
    // a retry loop (escort-recover → escort) re-enters a stage the journal already carries: don't repeat it
    const last = [...this.journalEntries].reverse().find((j) => j.questId === id);
    if (!q.silentJournal && last?.text !== stage.journal) this.addJournal(stage.journal, id);
    await this.deps.runEffects(stage.onEnter, id);
  }

  async complete(id: string): Promise<void> {
    const q = this.quests.get(id);
    if (!q || q.done) return;
    q.done = true;
    this.deps.emit('quest-completed', id);
    const def = this.deps.getQuestDef(id);
    await this.deps.runEffects(def?.onComplete, id);
  }

  async fail(id: string): Promise<void> {
    const q = this.quests.get(id);
    if (!q || q.done) return;
    q.done = true;
    q.failed = true;
    this.deps.emit('quest-failed', id);
    const def = this.deps.getQuestDef(id);
    await this.deps.runEffects(def?.onFail, id);
  }

  /** Clears a quest's runtime state entirely so it can be `start()`ed again (retry loops). */
  reset(id: string): void {
    this.quests.delete(id);
  }

  /** Deletes every var on `id` whose key starts with `prefix` — used to un-cache rolled dialogue
   *  checks (`_dialogue` pseudo-quest, keys `dlg.<id>:...`) so a retried hub can roll fresh again. */
  clearVarPrefix(id: string, prefix: string): void {
    const q = this.quests.get(id);
    if (!q) return;
    for (const k of Object.keys(q.vars)) if (k.startsWith(prefix)) delete q.vars[k];
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
          this.advance(id, rule.to).catch((e) => console.error(`[quest] advanceWhen ${id} -> ${rule.to} threw`, e));
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
