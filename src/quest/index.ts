/**
 * Quest module. ARCHITECTURE.md §4/§5.6. Registers a full `QuestService`: the quest state machine
 * (quests.ts), the condition/effect DSL (conditions.ts/effects.ts), the dialogue runner (dialogue.ts),
 * the cutscene runner (cutscene.ts) and reputation (reputation.ts) are all pure logic wired together here.
 */
import type { GameContext } from '@core/context';
import { EventBus, type Unsubscribe } from '@core/events';
import { gameTimeFor } from '@core/clock';
import { hashString } from '@core/rng';
import type { EntityId } from '@core/ecs';
import { Name, Npc, Player, Transform } from '@core/components';
import type { Effect, FactionId, QuestCondition, SkillId } from '@core/dsl';
import type { FactionDef, SaveFile } from '@core/schemas';
import type {
  CombatResult, DialogueOutcome, JournalEntry, QuestEvents, QuestService,
} from '@core/services';

import { evaluateCondition } from './conditions';
import { runEffects as runEffectsFn } from './effects';
import { clampRep, isHostileRep, repBand, repToastMessage } from './reputation';
import { QuestMachine, type QuestMachineDeps, ADVANCE_TICK_SECONDS } from './quests';
import { runDialogue as runDialogueFn, type DialogueRuntime, type DialogueUiHandle } from './dialogue';
import { runCutscene as runCutsceneFn, type CameraRigHandle, type CutsceneRuntime, type CutsceneUiHandle } from './cutscene';
import type { Runtime } from './runtime';

/** Chapter start dates. ARCHITECTURE.md/LORE.md §1: prologue 1 Aug 1291 06:00, ch1 10 May 1307, ch2 6 Jan 1314 18:00. */
const CHAPTER_START: Record<string, [number, number, number, number, number]> = {
  'prologue-1291': [1291, 8, 1, 6, 0],
  'ch1-1307': [1307, 5, 10, 7, 0],
  'ch2-1314': [1314, 1, 6, 18, 0],
};

const CHAPTER_JOURNAL: Record<string, string> = {
  'prologue-1291': 'August, 1291. Word runs along the lake shore that King Rudolf of Habsburg is dead at Speyer.',
  'ch1-1307': "Sixteen years have passed. It is May, 1307, and the bailiffs' hand lies heavier on the Länder than ever.",
  'ch2-1314': 'The night of the Epiphany, 1314. The old quarrel with Einsiedeln over the March pastures is about to break into the open.',
};

export class QuestServiceImpl implements QuestService, Runtime, DialogueRuntime, CutsceneRuntime {
  readonly machine: QuestMachine;
  private readonly bus = new EventBus<QuestEvents>();
  private repMap = new Map<FactionId, number>();
  private flags = new Map<string, unknown>();
  private chapterId = 'prologue-1291';
  private tickAcc = 0;
  private activeDialogueId = '';

  constructor(private readonly ctx: GameContext) {
    const deps: QuestMachineDeps = {
      getQuestDef: (id) => ctx.content.quests.get(id),
      runEffects: (effects) => this.runEffects(effects),
      now: () => ctx.clock.time,
      poiPosition: (id) => ctx.services.tryGet('exploration')?.poiPosition(id) ?? null,
      emit: (event, ...args) => { (this.bus.emit as (e: string, ...a: unknown[]) => void)(event, ...args); },
    };
    this.machine = new QuestMachine(deps);
  }

  // ---------------------------------------------------------------- helpers
  private playerEntity(): EntityId | null {
    return this.ctx.services.tryGet('party')?.getPlayer() ?? null;
  }

  private findNpcEntity(npcId: string): EntityId | null {
    for (const id of this.ctx.world.query(Name)) {
      if (this.ctx.world.get(id, Name)?.id === npcId) return id;
    }
    return null;
  }

  /** Frame tick, wired by `register()` — cheap: only fires every ADVANCE_TICK_SECONDS. */
  tick(dt: number): void {
    this.tickAcc += dt;
    if (this.tickAcc >= ADVANCE_TICK_SECONDS) {
      this.tickAcc = 0;
      this.machine.checkAdvance(this);
    }
  }

  // ---------------------------------------------------------------- RuntimeReads
  getFlag(key: string): unknown { return this.flags.get(key); }
  getStage(id: string): string | null { return this.machine.stage(id); }
  isStarted(id: string): boolean { return this.machine.isStarted(id); }
  isDone(id: string): boolean { return this.machine.isDone(id); }
  getVar(id: string, k: string): unknown { return this.machine.getVar(id, k); }
  getRep(faction: string): number { return this.repMap.get(faction) ?? 0; }
  getChapter(): string { return this.chapterId; }
  getOrigin(): 'uri' | 'schwyz' | 'unterwalden' | null {
    const p = this.playerEntity();
    if (p == null) return null;
    return this.ctx.world.get(p, Player)?.origin ?? null;
  }
  isDiscovered(poiId: string): boolean { return this.ctx.services.tryGet('exploration')?.isDiscovered(poiId) ?? false; }
  getPfennig(): number {
    const p = this.playerEntity();
    return p != null ? this.ctx.services.tryGet('party')?.pfennig(p) ?? 0 : 0;
  }
  getSkillLevel(skill: string): number {
    const p = this.playerEntity();
    return p != null ? this.ctx.services.tryGet('party')?.skillLevel(p, skill) ?? 0 : 0;
  }
  hasItem(itemId: string, qty: number): boolean {
    const p = this.playerEntity();
    return p != null ? (this.ctx.services.tryGet('party')?.countItem(p, itemId) ?? 0) >= qty : false;
  }
  hasCompanion(npcId: string): boolean {
    const e = this.findNpcEntity(npcId);
    return e != null && (this.ctx.services.tryGet('party')?.isMember(e) ?? false);
  }
  getHour(): number { return this.ctx.clock.hour; }

  // ---------------------------------------------------------------- RuntimeWrites
  setFlag(key: string, value: unknown): void {
    this.flags.set(key, value);
    this.bus.emit('flag-changed', key, value);
    this.machine.checkAdvance(this);
  }
  async questOp(op: 'start' | 'advance' | 'complete' | 'fail', questId: string, stage?: string): Promise<void> {
    if (op === 'start') await this.machine.start(questId);
    else if (op === 'advance') await this.machine.advance(questId, stage ?? '');
    else if (op === 'complete') await this.machine.complete(questId);
    else await this.machine.fail(questId);
    // Any quest transition can unblock another quest's advanceWhen (e.g. {questDone: '...'}) — recheck.
    this.machine.checkAdvance(this);
  }
  setVar(id: string, k: string, v: unknown): void {
    this.machine.setVar(id, k, v);
    this.machine.checkAdvance(this);
  }
  changeRep(faction: string, delta: number, reason: string): void {
    const next = clampRep(this.getRep(faction) + delta);
    this.repMap.set(faction, next);
    this.bus.emit('reputation-changed', faction, next, delta, reason);
    if (delta !== 0) {
      const msg = repToastMessage(this.ctx.content.factions.get(faction), delta);
      const ui = this.ctx.services.tryGet('ui');
      if (ui) ui.toast(msg, 'quest'); else console.info(`[rep] ${msg}`);
    }
    this.machine.checkAdvance(this);
  }
  giveItem(itemId: string, qty: number): void {
    const p = this.playerEntity();
    if (p != null) this.ctx.services.tryGet('party')?.addItem(p, itemId, qty);
  }
  takeItem(itemId: string, qty: number): void {
    const p = this.playerEntity();
    if (p != null) this.ctx.services.tryGet('party')?.removeItem(p, itemId, qty);
  }
  addPfennig(delta: number): void {
    const p = this.playerEntity();
    if (p != null) this.ctx.services.tryGet('party')?.addPfennig(p, delta);
  }
  skillXp(skill: SkillId, amount: number): void {
    const p = this.playerEntity();
    if (p != null) this.ctx.services.tryGet('party')?.grantSkillXp(p, skill, amount);
  }
  async runEncounter(id: string): Promise<CombatResult> {
    return this.ctx.services.get('combat').start(id);
  }
  teleport(poiId: string): void {
    const p = this.playerEntity();
    const pos = this.ctx.services.tryGet('exploration')?.poiPosition(poiId);
    if (p != null && pos) this.ctx.services.tryGet('exploration')?.teleport(p, pos.x, pos.z);
  }
  addCompanion(npcId: string): void {
    const party = this.ctx.services.tryGet('party');
    if (!party) return;
    let entity = this.findNpcEntity(npcId);
    if (entity == null) {
      const def = this.ctx.content.npcs.get(npcId);
      if (!def) { console.warn(`[quest] addCompanion: unknown npc "${npcId}"`); return; }
      const exploration = this.ctx.services.tryGet('exploration');
      entity = exploration ? exploration.spawnNpc(def) : party.createCharacter(def);
    }
    party.addMember(entity, 'companion');
  }
  removeCompanion(npcId: string): void {
    const entity = this.findNpcEntity(npcId);
    if (entity != null) this.ctx.services.tryGet('party')?.removeMember(entity);
  }
  async runCutsceneById(id: string): Promise<void> { return this.runCutscene(id); }
  advanceTime(hours: number): void { this.ctx.clock.advanceHours(hours); }
  async setChapterAsync(chapter: string): Promise<void> { return this.setChapter(chapter); }
  setTimeExact(y: number, m: number, d: number, h?: number): void { this.ctx.clock.set(gameTimeFor(y, m, d, h ?? 0)); }
  toast(msg: string): void {
    const ui = this.ctx.services.tryGet('ui');
    if (ui) ui.toast(msg, 'quest'); else console.info(`[toast] ${msg}`);
  }
  addJournalEntry(text: string, questId?: string): void { this.machine.addJournal(text, questId); }
  discoverPoi(poiId: string): void { this.ctx.services.tryGet('exploration')?.discover(poiId); }
  npcMove(npcId: string, poiId: string): void {
    const entity = this.findNpcEntity(npcId);
    const pos = this.ctx.services.tryGet('exploration')?.poiPosition(poiId);
    if (entity == null || !pos) return;
    const t = this.ctx.world.get(entity, Transform);
    if (t) { t.x = pos.x; t.z = pos.z; }
    const npc = this.ctx.world.get(entity, Npc);
    if (npc) npc.targetPoi = poiId;
  }
  npcRemove(npcId: string): void {
    const entity = this.findNpcEntity(npcId);
    if (entity == null) return;
    const party = this.ctx.services.tryGet('party');
    if (party?.isMember(entity)) party.removeMember(entity);
    this.ctx.world.destroy(entity);
  }
  async runDialogueById(id: string): Promise<void> { await this.runDialogue(id); }
  restParty(hours: number): void { this.ctx.services.tryGet('party')?.rest(hours); }
  setMusic(id: string): void { console.info(`[music] ${id}`); }
  endAct(id: string): void {
    this.setFlag(`act-complete:${id}`, true);
    this.machine.addJournal(`Here ends the tale, for now, of the ${id === 'act1' ? 'first years of the Eidgenossen' : id}.`);
    this.toast('Act One is complete.');
  }

  // ---------------------------------------------------------------- DialogueRuntime extras
  getDialogueDef(id: string) { return this.ctx.content.dialogues.get(id); }
  npcDisplayName(id: string): string | undefined { return this.ctx.content.npcs.get(id)?.name; }
  npcPortrait(id: string): string | undefined { return this.ctx.content.npcs.get(id)?.portrait; }
  entityDisplayName(entity: EntityId): string | undefined { return this.ctx.world.get(entity, Name)?.display; }
  playerGivenName(): string {
    const p = this.playerEntity();
    return (p != null ? this.ctx.world.get(p, Player)?.givenName : undefined) ?? 'Traveller';
  }
  playerFamilyName(): string {
    const p = this.playerEntity();
    return (p != null ? this.ctx.world.get(p, Player)?.familyName : undefined) ?? '';
  }
  playerOriginLabel(): string {
    const o = this.getOrigin();
    return o ? o[0].toUpperCase() + o.slice(1) : '';
  }
  timeLabel(): string { return this.ctx.clock.calendar().label; }
  skillAttrMod(skill: string): number {
    const attr = this.ctx.content.skills.get(skill)?.attribute;
    const p = this.playerEntity();
    if (!attr || p == null) return 0;
    return this.ctx.services.tryGet('party')?.attrMod(p, attr) ?? 0;
  }
  rollD20(): number {
    return this.ctx.rng.world.fork(hashString(this.activeDialogueId || 'dialogue')).die(20);
  }
  ui(): DialogueUiHandle | undefined { return this.ctx.services.tryGet('ui')?.dialogue; }
  emitDialogueEvent(event: 'dialogue-started' | 'dialogue-ended', id: string): void { this.bus.emit(event, id); }

  // ---------------------------------------------------------------- CutsceneRuntime extras
  getCutsceneDef(id: string) { return this.ctx.content.cutscenes.get(id); }
  cutsceneUi(): CutsceneUiHandle | undefined { return this.ctx.services.tryGet('ui')?.cutscene; }
  cameraRig(): CameraRigHandle | undefined { return this.ctx.services.tryGet('exploration')?.getCameraRig(); }
  setWorldTime(hour: number): void {
    this.ctx.services.tryGet('world')?.setTimeOfDay(hour);
    this.ctx.clock.setHour(hour);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setWorldWeather(w: string): void { this.ctx.services.tryGet('world')?.setWeather(w as any); }
  requestState(state: string): void { this.ctx.events.emit('request-state', state); }

  // ---------------------------------------------------------------- QuestService (public API)
  start(questId: string): void { void this.questOp('start', questId); }
  advance(questId: string, stageId: string): void { void this.questOp('advance', questId, stageId); }
  complete(questId: string): void { void this.questOp('complete', questId); }
  fail(questId: string): void { void this.questOp('fail', questId); }
  stage(questId: string): string | null { return this.machine.stage(questId); }
  reputation(faction: string): number { return this.getRep(faction); }
  reputationBand(faction: string) { return repBand(this.getRep(faction)); }
  changeReputation(faction: string, delta: number, reason: string): void { this.changeRep(faction, delta, reason); }
  isHostile(faction: string): boolean {
    const def = this.ctx.content.factions.get(faction);
    return isHostileRep(this.getRep(faction), def, !!this.flags.get(`hostile:${faction}`));
  }
  factionDef(id: string): FactionDef | undefined { return this.ctx.content.factions.get(id); }
  evaluate(cond: QuestCondition | undefined): boolean { return evaluateCondition(cond, this); }
  async runEffects(effects: Effect[] | undefined): Promise<void> { return runEffectsFn(effects, this); }
  async runDialogue(dialogueId: string, speakerEntity?: EntityId): Promise<DialogueOutcome> {
    this.activeDialogueId = dialogueId;
    return runDialogueFn(dialogueId, this, speakerEntity);
  }
  async runCutscene(cutsceneId: string): Promise<void> { return runCutsceneFn(cutsceneId, this); }
  journal(): JournalEntry[] { return this.machine.journalEntries; }
  addJournal(text: string, questId?: string): void { this.machine.addJournal(text, questId); }
  activeQuests() { return this.machine.activeQuests(); }
  chapter(): string { return this.chapterId; }
  async setChapter(chapter: string): Promise<void> {
    this.chapterId = chapter;
    const start = CHAPTER_START[chapter];
    if (start) this.ctx.clock.set(gameTimeFor(...start));
    this.ctx.services.tryGet('party')?.applyChapter(chapter);
    this.ctx.services.tryGet('exploration')?.populate(chapter);
    this.ctx.events.emit('chapter-changed', chapter);
    this.machine.addJournal(CHAPTER_JOURNAL[chapter] ?? `The chapter turns: ${chapter}.`);
    this.machine.checkAdvance(this);
  }
  serialize(): Pick<SaveFile, 'quests' | 'reputation' | 'flags' | 'journal' | 'chapter'> {
    return {
      quests: this.machine.serialize(),
      reputation: Object.fromEntries(this.repMap) as Record<string, number>,
      flags: Object.fromEntries(this.flags),
      journal: this.machine.journalEntries,
      chapter: this.chapterId,
    };
  }
  restore(s: Pick<SaveFile, 'quests' | 'reputation' | 'flags' | 'journal' | 'chapter'>): void {
    this.machine.restore(s.quests);
    this.repMap = new Map(Object.entries(s.reputation ?? {}));
    this.flags = new Map(Object.entries(s.flags ?? {}));
    this.machine.journalEntries = [...(s.journal ?? [])];
    this.chapterId = s.chapter ?? 'prologue-1291';
  }
  on<K extends keyof QuestEvents & string>(event: K, cb: (...a: QuestEvents[K]) => void): Unsubscribe {
    return this.bus.on(event, cb);
  }
}

export async function register(ctx: GameContext): Promise<void> {
  const svc = new QuestServiceImpl(ctx);
  ctx.services.register('quest', svc);
  ctx.scheduler.add({ name: 'quest-advance', phase: 'always', order: 500, update: (dt: number) => svc.tick(dt) });
  const exploration = ctx.services.tryGet('exploration');
  exploration?.on('poi-discovered', () => svc.machine.checkAdvance(svc));
  exploration?.on('fast-travel', () => svc.machine.checkAdvance(svc));
  exploration?.on('region-entered', () => svc.machine.checkAdvance(svc));
  ctx.events.on('time-changed', () => svc.machine.checkAdvance(svc));
  ctx.events.on('chapter-changed', () => svc.machine.checkAdvance(svc));
}
