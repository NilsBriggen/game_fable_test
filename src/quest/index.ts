/**
 * Quest module. ARCHITECTURE.md §4/§5.6. Registers a full `QuestService`: the quest state machine
 * (quests.ts), the condition/effect DSL (conditions.ts/effects.ts), the dialogue runner (dialogue.ts),
 * the cutscene runner (cutscene.ts) and reputation (reputation.ts) are all pure logic wired together here.
 */
import type { GameContext } from '@core/context';
import { EventBus, type Unsubscribe } from '@core/events';
import { gameTimeFor } from '@core/clock';
import { hashString } from '@core/rng';
import { strings } from '@core/i18n';
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
  private chapterSet = false;
  private tickAcc = 0;
  private activeDialogueId = '';
  /** >0 while a `runCutscene()` or `runDialogue()` call (possibly several nested/interleaved) is
   *  mid-flight — a "scene" in the sense that nothing else should visibly interrupt it. */
  private sceneDepth = 0;
  /** Effects queued by `runEffects` while `sceneDepth > 0`; drained once the outermost scene ends. */
  private deferredEffects: Array<() => Promise<void>> = [];
  /** quest ids whose *next* `start()` (however it's triggered — including a plain `{quest:['start',id]}}`
   *  content effect, which cannot itself carry options) should be silent-journalled. Round 3 #3: the
   *  Morgarten retry needs this for `quest.morgarten` itself, not just the muster hub that restarts it. */
  private pendingSilentStart = new Set<string>();
  /** POI ids already celebrated with the §2.2 discovery stinger (one chime per POI per session). */
  private celebratedDiscovery = new Set<string>();

  constructor(private readonly ctx: GameContext) {
    const deps: QuestMachineDeps = {
      getQuestDef: (id) => ctx.content.quests.get(id),
      runEffects: (effects, questId) => this.runEffects(effects, questId),
      now: () => ctx.clock.time,
      poiPosition: (id) => ctx.services.tryGet('exploration')?.poiPosition(id) ?? null,
      emit: (event, ...args) => { (this.bus.emit as (e: string, ...a: unknown[]) => void)(event, ...args); },
    };
    this.machine = new QuestMachine(deps);
    // Critic wave3-quest.md round 1 #7 / round 2 #3: a lost Morgarten must be recoverable, not a dead
    // end — send the player back through the whole muster-year hub rather than an instant re-fight.
    this.bus.on('quest-failed', (id) => {
      if (id !== 'quest.morgarten') return;
      // Reset quest.morgarten too — otherwise it stays permanently `done` (failed) and the retried
      // muster hub's own `{quest:['start','quest.morgarten']}` effect silently no-ops.
      this.machine.reset('quest.morgarten');
      this.machine.reset('quest.muster-1315');
      // 3.1 retry beat: marks this muster pass as the second one so `travel-sattel`
      // routes through the `sattel-retry` stage once. Cleared in the hub's `ready` stage.
      this.setFlag('morgarten.retry', true);
      // Round 3 #3: quest.morgarten's own restart (triggered later, from the retried muster hub's
      // 'ready' stage via a plain content effect) must be silent too, or its travel-morgarten/battle
      // stages journal a second time verbatim.
      this.pendingSilentStart.add('quest.morgarten');
      // Round 2 #3: un-cache the muster hub's own rolled dialogue checks so "better prepared this
      // time" can actually change the letzi/recruit/scout outcome, not just replay the first attempt.
      this.machine.clearVarPrefix('_dialogue', 'dlg.muster-');
      this.machine.clearVarPrefix('_dialogue', 'dlg.heinrich-von-hunenberg');
      // Round 2 #3: the retry re-enters every muster stage, so its per-stage journal lines are
      // silenced (see `silentJournal`) and replaced with one line marking this as the second pass.
      this.machine.addJournal('Carried off the field once, you gather what is left and ready yourselves to march on Morgarten again.', 'quest.muster-1315');
      this.machine.start('quest.muster-1315', { silentJournal: true })
        .then(() => this.machine.checkAdvance(this))
        .catch((e) => console.error('[quest] retry-from-muster failed', e));
    });
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
  playerPosition(): { x: number; z: number } | null {
    const p = this.playerEntity();
    if (p == null) return null;
    const t = this.ctx.world.get(p, Transform);
    return t ? { x: t.x, z: t.z } : null;
  }
  poiPosition(poiId: string): { x: number; z: number } | null {
    return this.ctx.services.tryGet('exploration')?.poiPosition(poiId) ?? null;
  }
  regionIdAt(x: number, z: number): string | null {
    return this.ctx.services.tryGet('world')?.regionAt(x, z)?.id ?? null;
  }

  // ---------------------------------------------------------------- RuntimeWrites
  setFlag(key: string, value: unknown): void {
    this.flags.set(key, value);
    this.bus.emit('flag-changed', key, value);
    this.machine.checkAdvance(this);
  }
  async questOp(op: 'start' | 'advance' | 'complete' | 'fail', questId: string, stage?: string): Promise<void> {
    if (op === 'start') {
      const silentJournal = this.pendingSilentStart.delete(questId);
      await this.machine.start(questId, { silentJournal });
    } else if (op === 'advance') await this.machine.advance(questId, stage ?? '');
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
    const combat = this.ctx.services.tryGet('combat');
    if (!combat) {
      console.warn(`[quest] runEncounter: no combat service registered — resolving "${id}" as a default win`);
      return { outcome: 'win', rounds: 0, downed: [], dead: [], xp: {}, loot: [], log: [] };
    }
    if (this.ctx.state.state === 'gameover') {
      // the whole party is dead: no retry loop from here — the player loads a save
      return { outcome: 'lose', rounds: 0, downed: [], dead: [], xp: {}, loot: [], log: [] };
    }
    return combat.start(id);
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
  async runCutsceneById(id: string, questId?: string): Promise<void> { return this.runCutscene(id, questId); }
  advanceTime(hours: number): void { this.ctx.clock.advanceHours(hours); }
  async setChapterAsync(chapter: string): Promise<void> { return this.setChapter(chapter); }
  setTimeExact(y: number, m: number, d: number, h?: number): void { this.ctx.clock.set(gameTimeFor(y, m, d, h ?? 0)); }
  toast(msg: string): void {
    const ui = this.ctx.services.tryGet('ui');
    if (ui) ui.toast(msg, 'quest'); else console.info(`[toast] ${msg}`);
  }
  addJournalEntry(text: string, questId?: string): void { this.machine.addJournal(text, questId); }
  discoverPoi(poiId: string): void {
    const first = !this.celebratedDiscovery.has(poiId);
    if (first) this.celebratedDiscovery.add(poiId);
    this.ctx.services.tryGet('exploration')?.discover(poiId);
    // Discovery chime: the committed `discover` one-shot when present, bark blip otherwise.
    // The set-guard keeps fast-travel/discover-spam from chiming repeatedly.
    if (first) {
      try {
        const audio = (this.ctx.services.tryGet('ui') as unknown as { audio?: { barkBlip(): void; playStinger(name: string): void } } | undefined)?.audio;
        audio?.playStinger('discover');
        audio?.barkBlip();
      } catch { /* audio must never break quest flow */ }
    }
  }
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
  async runDialogueById(id: string, questId?: string): Promise<void> { await this.runDialogue(id, undefined, questId); }
  restParty(hours: number): void { this.ctx.services.tryGet('party')?.rest(hours); }
  setMusic(id: string): void {
    // 3.4 + Flow §2.2: the {music} DSL effect prefers a committed file track and falls back to the
    // procedural bed. Quest ids use the music.* namespace (e.g. 'music.tavern'); the bus takes the bed
    // name after the dot. Unknown beds stop the music rather than throwing. No UI service yet = no-op.
    // Headless fakes may only implement playMusic (no playMusicTrack) — fall back to it directly.
    const uiAudio = (this.ctx.services.tryGet('ui') as unknown as {
      audio?: { playMusicTrack?(bed: string): Promise<boolean>; playMusic(id: string): void };
    } | undefined)?.audio;
    if (uiAudio) {
      const bed = id.startsWith('music.') ? id.slice('music.'.length) : id;
      try {
        if (typeof uiAudio.playMusicTrack === 'function') void uiAudio.playMusicTrack(bed);
        else uiAudio.playMusic(bed);
      } catch { /* audio must never break quest flow */ }
    }
  }
  endAct(id: string): void {
    this.setFlag(`act-complete:${id}`, true);
    this.machine.addJournal(`Here ends the tale, for now, of the ${id === 'act1' ? 'first years of the Eidgenossen' : id}.`);
    this.toast('Act One is complete.');
  }

  // ---------------------------------------------------------------- DialogueRuntime extras
  getDialogueDef(id: string) { return this.ctx.content.dialogues.get(id); }
  // 4.3 i18n: display-time lookup backed by the shared catalog (locale from settings, en fallback).
  // The catalog's en table is filled at content load (register(), below); overlays load from JSON.
  t(id: string): string { return strings.t(id); }
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
  start(questId: string): void { this.questOp('start', questId).catch((e) => console.error(`[quest] start(${questId}) failed`, e)); }
  advance(questId: string, stageId: string): void { this.questOp('advance', questId, stageId).catch((e) => console.error(`[quest] advance(${questId},${stageId}) failed`, e)); }
  complete(questId: string): void { this.questOp('complete', questId).catch((e) => console.error(`[quest] complete(${questId}) failed`, e)); }
  fail(questId: string): void { this.questOp('fail', questId).catch((e) => console.error(`[quest] fail(${questId}) failed`, e)); }
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
  /**
   * Critic wave3-quest.md round 1 #2 / round 2 #2: while a cutscene OR a dialogue is mid-flight
   * (`sceneDepth>0`), any effects run here (a quest stage's onStart/onEnter/onComplete/onFail, a
   * dialogue node/choice, a cutscene step) are queued instead of run inline, so a follow-on quest's
   * dialogue/cutscene can never open on top of a scene that hasn't finished yet — dialogues get the
   * same nesting guard cutscenes already had, so nothing pops up mid-conversation either.
   * `runCutscene`/`runDialogue` drain the queue once the *outermost* scene call returns — see below.
   */
  async runEffects(effects: Effect[] | undefined, questId?: string): Promise<void> {
    if (this.sceneDepth > 0) {
      // Do NOT return a promise tied to the deferred job's completion: whoever called us (a cutscene
      // step or a dialogue node, most likely) must not block waiting for work that is deliberately
      // scheduled for *after* this very scene call returns — that would deadlock (the drain that
      // resolves the job only runs once the outer runCutscene()/runDialogue() call has itself finished).
      this.deferredEffects.push(() => runEffectsFn(effects, this, questId).catch((e) => console.error('[quest] deferred effects threw', e)));
      return;
    }
    return runEffectsFn(effects, this, questId);
  }
  private async drainDeferredIfOutermost(): Promise<void> {
    if (this.sceneDepth !== 0) return;
    while (this.deferredEffects.length) {
      const job = this.deferredEffects.shift()!;
      await job();
    }
  }
  dialogueExists(dialogueId: string): boolean {
    return this.ctx.content.dialogues.has(dialogueId);
  }

  async runDialogue(dialogueId: string, speakerEntity?: EntityId, questId?: string): Promise<DialogueOutcome> {
    this.activeDialogueId = dialogueId;
    this.sceneDepth++;
    let outcome: DialogueOutcome;
    try {
      outcome = await runDialogueFn(dialogueId, this, speakerEntity, questId);
    } finally {
      this.sceneDepth--;
    }
    await this.drainDeferredIfOutermost();
    return outcome;
  }
  async runCutscene(cutsceneId: string, questId?: string): Promise<void> {
    this.sceneDepth++;
    try {
      await runCutsceneFn(cutsceneId, this, questId);
    } finally {
      this.sceneDepth--;
    }
    await this.drainDeferredIfOutermost();
  }
  journal(): JournalEntry[] { return this.machine.journalEntries; }
  addJournal(text: string, questId?: string): void { this.machine.addJournal(text, questId); }
  activeQuests() { return this.machine.activeQuests(); }
  chapter(): string { return this.chapterId; }
  /** Phase 2 A1.3: full per-playthrough reset for same-page new games. resetWorld() clears the ECS,
   *  but quest flags/reputation/journal/machine survive it — a second newGame() after progress would
   *  otherwise inherit a finished quest graph. Subscribed to 'new-game' (emitted by main.ts newGame()
   *  before setChapter/start), so no caller changes are needed. */
  resetForNewGame(): void {
    this.machine.restore({});
    this.repMap = new Map();
    this.flags = new Map();
    this.pendingSilentStart.clear();
    this.celebratedDiscovery.clear();
    this.deferredEffects = [];
    this.sceneDepth = 0;
    this.chapterId = 'prologue-1291';
    this.chapterSet = false;
  }
  async setChapter(chapter: string): Promise<void> {
    // Critic wave3-quest.md #9: main.ts's newGame() calls setChapter('prologue-1291') and then
    // exploration.populate(chapter) itself — a second setChapter with the same chapter (or any
    // accidental double-call) must not re-populate the world or duplicate the chapter journal entry.
    if (this.chapterSet && chapter === this.chapterId) return;
    this.chapterId = chapter;
    this.chapterSet = true;
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
    // Round 2 #4: a restored save always has a definite chapter — derive chapterSet from its presence
    // so a subsequent setChapter(sameChapter) (e.g. a stale caller re-issuing the load-time call) stays
    // a no-op instead of re-populating the world / duplicating the chapter journal line after load.
    this.chapterSet = !!s.chapter;
  }
  on<K extends keyof QuestEvents & string>(event: K, cb: (...a: QuestEvents[K]) => void): Unsubscribe {
    return this.bus.on(event, cb);
  }
}

export async function register(ctx: GameContext): Promise<void> {
  const svc = new QuestServiceImpl(ctx);
  ctx.services.register('quest', svc);
  // 4.3 i18n: fill the shared catalog's en table from loaded content (extraction source of truth at
  // runtime), then overlay any delivered translation JSON and select the settings locale. Overlays are
  // fetched, not bundled — a missing file is a silent en fallback, never a boot failure.
  fillEnCatalog(ctx);
  // 4.3: test harnesses build a GameContext-shaped partial without settings — default to en there.
  const locale = ctx.settings?.language ?? 'en';
  strings.setLocale(locale);
  void loadLocaleOverlay(locale);
  ctx.onSettings?.((s) => {
    strings.setLocale(s.language);
    void loadLocaleOverlay(s.language);
  });
  ctx.scheduler.add({ name: 'quest-advance', phase: 'always', order: 500, update: (dt: number) => svc.tick(dt) });
  // Phase 2 A1.3: 'new-game' fires in main.ts newGame() before setChapter/start — reset first.
  ctx.events.on('new-game', () => svc.resetForNewGame());
  const exploration = ctx.services.tryGet('exploration');
  exploration?.on('poi-discovered', () => svc.machine.checkAdvance(svc));
  exploration?.on('fast-travel', () => svc.machine.checkAdvance(svc));
  exploration?.on('region-entered', () => svc.machine.checkAdvance(svc));
  ctx.events.on('time-changed', () => svc.machine.checkAdvance(svc));
  ctx.events.on('chapter-changed', () => svc.machine.checkAdvance(svc));
}

/**
 * 4.3 i18n: runtime mirror of the extraction script (`tools/i18n/extract.test.ts`) — the same walk,
 * same IDs. The snapshot JSON is the translators' contract; this fill is the game's. A drift test
 * (`src/quest/i18n.test.ts`) asserts they agree, so content edits can't silently desync the catalog
 * from the snapshot.
 */
export function fillEnCatalog(ctx: GameContext): void {
  const table: Record<string, string> = {};
  const put = (id: string, v: unknown): void => {
    if (typeof v === 'string' && v.length) table[id] = v;
  };
  const toasts = (effects: { toast?: string }[] | undefined): string[] =>
    Array.isArray(effects) ? effects.filter((e) => typeof e?.toast === 'string' && e.toast.length).map((e) => e.toast as string) : [];
  for (const q of ctx.content.quests.values()) {
    const qid = q.id.replace(/^quest\./, '');
    put(`quest.${qid}.title`, q.title);
    put(`quest.${qid}.description`, q.description);
    for (const s of q.stages) {
      put(`quest.${qid}.stage.${s.id}.journal`, s.journal);
      put(`quest.${qid}.stage.${s.id}.objective`, s.objectiveText);
      toasts(s.onEnter as { toast?: string }[]).forEach((t, i) => put(`quest.${qid}.stage.${s.id}.toast.${i}`, t));
    }
    toasts(q.onStart as { toast?: string }[]).forEach((t, i) => put(`quest.${qid}.onStart.${i}`, t));
    toasts(q.onComplete as { toast?: string }[]).forEach((t, i) => put(`quest.${qid}.onComplete.${i}`, t));
    toasts(q.onFail as { toast?: string }[]).forEach((t, i) => put(`quest.${qid}.onFail.${i}`, t));
  }
  for (const d of ctx.content.dialogues.values()) {
    const did = d.id.replace(/^dlg\./, '');
    for (const [nid, n] of Object.entries(d.nodes)) {
      put(`dlg.${did}.node.${nid}.text`, n.text);
      (n.variants ?? []).forEach((v, i) => put(`dlg.${did}.node.${nid}.variant.${i}`, v.text));
      (n.choices ?? []).forEach((ch, i) => put(`dlg.${did}.node.${nid}.choice.${i}`, ch.text));
    }
  }
  for (const cs of ctx.content.cutscenes.values()) {
    const cid = cs.id.replace(/^cs\./, '');
    cs.steps.forEach((step, i) => put(`cs.${cid}.shot.${i}.caption`, step.caption));
  }
  strings.loadEn(table);
}

/** Fetch a delivered translation overlay (`tools/i18n/strings.<locale>.json` served from base). */
async function loadLocaleOverlay(locale: string): Promise<void> {
  if (locale === 'en') return;
  try {
    const res = await fetch(`tools/i18n/strings.${locale}.json`);
    if (!res.ok) return;
    const table = (await res.json()) as Record<string, string>;
    strings.setOverlay(locale as 'de' | 'gsw', table);
  } catch { /* missing/unparseable overlay = silent en fallback */ }
}
