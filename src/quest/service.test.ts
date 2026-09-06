import { describe, it, expect, vi } from 'vitest';
import { register, QuestServiceImpl } from './index';
import { loadContent } from '../content/index';
function loadContentInto(ctx: ReturnType<typeof makeTestContext>): void { loadContent(ctx.content); }
import {
  makeTestContext, spawnTestPlayer, movePlayerToPoi, FakePartyService, FakeExplorationService, FakeCombatService, ScriptedUiService,
  asPartyService, asExplorationService, asCombatService, asUiService,
} from './testHarness';
import type { QuestDef, DialogueDef, FactionDef, CutsceneDef } from '@core/schemas';

function setup() {
  const ctx = makeTestContext();
  const playerId = spawnTestPlayer(ctx, { origin: 'schwyz', givenName: 'Ruodi', familyName: 'Gisler' });
  const party = new FakePartyService(ctx.world, playerId);
  const pois = new Map<string, { id: string; x: number; z: number } & Record<string, unknown>>([
    ['poi.ruetli', { id: 'poi.ruetli', x: -186, z: -74 } as never],
  ]);
  const exploration = new FakeExplorationService(ctx.world, playerId, pois as never);
  const combat = new FakeCombatService();
  ctx.services.register('party', asPartyService(party));
  ctx.services.register('exploration', asExplorationService(exploration));
  ctx.services.register('combat', asCombatService(combat));
  return { ctx, party, exploration, combat, playerId };
}

function flush(): Promise<void> { return new Promise((r) => setTimeout(r, 0)); }

const habsburg: FactionDef = { id: 'habsburg', name: 'House of Habsburg-Austria', kind: 'house', hostileTo: [], hostileBelow: -40, description: '', historical: true, note: 'x' };

describe('QuestServiceImpl (register + integration)', () => {
  it('registers a QuestService on the registry', async () => {
    const { ctx } = setup();
    await register(ctx);
    expect(ctx.services.has('quest')).toBe(true);
    expect(ctx.services.get('quest')).toBeInstanceOf(QuestServiceImpl);
  });

  it('reputation: change, band, hostility, toast', async () => {
    const { ctx } = setup();
    ctx.content.addFactions([habsburg]);
    await register(ctx);
    const quest = ctx.services.get('quest');
    expect(quest.reputation('habsburg')).toBe(0);
    expect(quest.reputationBand('habsburg')).toBe('unknown');
    quest.changeReputation('habsburg', -50, 'test');
    expect(quest.reputation('habsburg')).toBe(-50);
    expect(quest.reputationBand('habsburg')).toBe('suspect');
    expect(quest.isHostile('habsburg')).toBe(true);
    quest.changeReputation('habsburg', 200, 'test'); // clamps
    expect(quest.reputation('habsburg')).toBe(100);
    expect(quest.reputationBand('habsburg')).toBe('eidgenoss');
  });

  it('flags and vars round-trip through the public API', async () => {
    const { ctx } = setup();
    await register(ctx);
    const quest = ctx.services.get('quest');
    quest.setFlag('hunenberg-warning', true);
    expect(quest.getFlag('hunenberg-warning')).toBe(true);
    quest.setVar('quest.x', 'k', 42);
    expect(quest.getVar('quest.x', 'k')).toBe(42);
  });

  it('a full quest lifecycle: start -> stage -> advance -> complete, with journal entries', async () => {
    const { ctx } = setup();
    const def: QuestDef = {
      id: 'quest.test', title: 'A Test Quest', kind: 'main', chapter: 'prologue-1291', historical: 'invented', note: 'x', description: 'x',
      stages: [
        { id: 's1', journal: 'It begins.' },
        { id: 's2', journal: 'It continues.' },
      ],
      onComplete: [{ toast: 'Done!' }],
    };
    ctx.content.addQuests([def]);
    await register(ctx);
    const quest = ctx.services.get('quest');
    quest.start('quest.test');
    await flush();
    expect(quest.isStarted('quest.test')).toBe(true);
    expect(quest.stage('quest.test')).toBe('s1');
    quest.advance('quest.test', 's2');
    await flush();
    expect(quest.stage('quest.test')).toBe('s2');
    quest.complete('quest.test');
    await flush();
    expect(quest.isDone('quest.test')).toBe(true);
    expect(quest.journal().map((j) => j.text)).toEqual(['It begins.', 'It continues.']);
  });

  it('runDialogue drives a scripted UI and runs effects (giveItem via party fake)', async () => {
    const { ctx, party } = setup();
    const ui = new ScriptedUiService();
    ctx.services.register('ui', asUiService(ui));
    const dlg: DialogueDef = {
      id: 'dlg.test', historical: 'invented', note: 'x', root: 'a',
      nodes: {
        a: { speaker: 'narrator', text: 'Take this.', choices: [{ text: 'Thanks', effects: [{ giveItem: ['item.bread', 1] }], end: true }] },
      },
    };
    ctx.content.addDialogues([dlg]);
    await register(ctx);
    const quest = ctx.services.get('quest');
    const outcome = await quest.runDialogue('dlg.test');
    expect(outcome.ended).toBe(true);
    expect(party.items.get('item.bread')).toBe(1);
    expect(ui.log).toContain('Take this.');
  });

  it('runCutscene requests cutscene state then returns to explore, and runs embedded effects', async () => {
    const { ctx } = setup();
    const ui = new ScriptedUiService();
    ctx.services.register('ui', asUiService(ui));
    const stateLog: string[] = [];
    ctx.events.on('request-state', (s) => stateLog.push(s as string));
    const cs: CutsceneDef = {
      id: 'cs.test', historical: 'invented', note: 'x',
      steps: [{ caption: 'A storm gathers.', effects: [{ setFlag: ['sealed', true] }] }],
    };
    ctx.content.addCutscenes([cs]);
    await register(ctx);
    const quest = ctx.services.get('quest');
    await quest.runCutscene('cs.test');
    expect(quest.getFlag('sealed')).toBe(true);
    expect(stateLog).toEqual(['cutscene', 'explore']);
    expect(ui.log).toContain('[caption] A storm gathers.');
  });

  it('setChapter sets the clock, calls party.applyChapter/exploration.populate, and journals', async () => {
    const { ctx, party, exploration } = setup();
    await register(ctx);
    const quest = ctx.services.get('quest');
    await quest.setChapter('ch1-1307');
    expect(quest.chapter()).toBe('ch1-1307');
    expect(party.chapterApplied).toEqual(['ch1-1307']);
    expect(exploration.populateCalls).toEqual(['ch1-1307']);
    const cal = ctx.clock.calendar();
    expect(cal.year).toBe(1307);
    expect(cal.month).toBe(5);
    expect(cal.day).toBe(10);
    expect(quest.journal().at(-1)?.text).toMatch(/Sixteen years/);
  });

  it('encounter effect calls CombatService.start and stores the outcome as a var', async () => {
    const { ctx, combat } = setup();
    combat.results.set('enc.brunnen-quay', { outcome: 'win', rounds: 2, downed: [], dead: [], xp: {}, loot: [], log: [] });
    await register(ctx);
    const quest = ctx.services.get('quest');
    await quest.runEffects([{ encounter: 'enc.brunnen-quay' }]);
    expect(combat.calls).toEqual(['enc.brunnen-quay']);
    expect(quest.getVar('_system', 'lastCombat.outcome')).toBe('win');
  });

  it('serialize -> restore round-trips quests/reputation/flags/journal/chapter exactly', async () => {
    const { ctx } = setup();
    ctx.content.addFactions([habsburg]);
    const def: QuestDef = {
      id: 'quest.test', title: 'T', kind: 'main', chapter: 'prologue-1291', historical: 'invented', note: 'x', description: 'x',
      stages: [{ id: 's1', journal: 'Start.' }],
    };
    ctx.content.addQuests([def]);
    await register(ctx);
    const quest = ctx.services.get('quest');
    quest.start('quest.test');
    await flush();
    quest.setFlag('a-flag', 'value');
    quest.changeReputation('habsburg', -15, 'test');
    await quest.setChapter('ch1-1307');
    const saved = quest.serialize();

    const { ctx: ctx2 } = setup();
    ctx2.content.addFactions([habsburg]);
    ctx2.content.addQuests([def]);
    await register(ctx2);
    const quest2 = ctx2.services.get('quest');
    quest2.restore(saved);
    expect(quest2.serialize()).toEqual(saved);
    expect(quest2.stage('quest.test')).toBe('s1');
    expect(quest2.getFlag('a-flag')).toBe('value');
    expect(quest2.reputation('habsburg')).toBe(-15);
    expect(quest2.chapter()).toBe('ch1-1307');
  });

  it('critic wave3-quest.md #9: setChapter is idempotent — a second call with the same chapter does not re-populate or duplicate the journal entry', async () => {
    const { ctx, party, exploration } = setup();
    await register(ctx);
    const quest = ctx.services.get('quest');
    await quest.setChapter('ch1-1307');
    await quest.setChapter('ch1-1307'); // e.g. main.ts calling setChapter then ex.populate(chapter) redundantly
    expect(party.chapterApplied).toEqual(['ch1-1307']);
    expect(exploration.populateCalls).toEqual(['ch1-1307']);
    expect(quest.journal().filter((j) => j.text.includes('Sixteen years'))).toHaveLength(1);
    // A genuinely different chapter still goes through.
    await quest.setChapter('ch2-1314');
    expect(party.chapterApplied).toEqual(['ch1-1307', 'ch2-1314']);
  });

  it('critic wave3-quest.md #4: runEncounter with no combat service resolves a default win (with a warning) instead of hanging/throwing', async () => {
    const ctx = makeTestContext();
    const playerId = spawnTestPlayer(ctx);
    ctx.services.register('party', asPartyService(new FakePartyService(ctx.world, playerId)));
    // Deliberately no 'combat' service registered.
    await register(ctx);
    const quest = ctx.services.get('quest');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await quest.runEffects([{ encounter: 'enc.brunnen-quay' }]);
    expect(quest.getVar('_system', 'lastCombat.outcome')).toBe('win');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('critic wave3-quest.md #4: start/advance/complete/fail never produce an unhandled rejection, even when an effect throws', async () => {
    const { ctx } = setup();
    const def: QuestDef = {
      id: 'quest.boom', title: 'Boom', kind: 'main', chapter: 'prologue-1291', historical: 'invented', note: 'x', description: 'x',
      stages: [{ id: 's1', journal: 'x', onEnter: [{ encounter: 'enc.does-not-exist' }] }],
    };
    ctx.content.addQuests([def]);
    await register(ctx);
    const quest = ctx.services.get('quest');
    const combat = ctx.services.get('combat') as unknown as { start: () => Promise<never> };
    // Force a genuine throw from the combat service to prove .catch() is really there.
    (ctx.services as unknown as { impl: Record<string, unknown> });
    ctx.services.register('combat', { start: async () => { throw new Error('boom'); } } as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let unhandled: unknown = null;
    const onUnhandled = (e: unknown) => { unhandled = e; };
    (globalThis as unknown as { process: { on: (e: string, cb: (x: unknown) => void) => void } }).process.on('unhandledRejection', onUnhandled);
    quest.start('quest.boom'); // fire-and-forget, per the public QuestService API
    await flush();
    await flush();
    (globalThis as unknown as { process: { off: (e: string, cb: (x: unknown) => void) => void } }).process.off('unhandledRejection', onUnhandled);
    expect(unhandled).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
    void combat;
  });

  it("critic wave3-quest.md #2: runDialogue requests the 'dialogue' state and returns to 'explore'", async () => {
    const { ctx } = setup();
    const ui = new ScriptedUiService();
    ctx.services.register('ui', asUiService(ui));
    const dlg: DialogueDef = { id: 'dlg.test', historical: 'invented', note: 'x', root: 'a', nodes: { a: { speaker: 'narrator', text: 'Hi.', end: true } } };
    ctx.content.addDialogues([dlg]);
    await register(ctx);
    const quest = ctx.services.get('quest');
    const states: string[] = [];
    ctx.events.on('request-state', (s) => states.push(s as string));
    await quest.runDialogue('dlg.test');
    expect(states).toEqual(['dialogue', 'explore']);
  });

  it('critic wave3-quest.md #2: a quest cascade triggered from inside a cutscene is deferred until the cutscene fully finishes all its own steps (never opens a dialogue mid-scene)', async () => {
    const { ctx } = setup();
    const ui = new ScriptedUiService();
    ctx.services.register('ui', asUiService(ui));
    const dlg: DialogueDef = { id: 'dlg.next', historical: 'invented', note: 'x', root: 'a', nodes: { a: { speaker: 'narrator', text: 'Next quest dialogue.', end: true } } };
    const nextQuest: QuestDef = {
      id: 'quest.next', title: 'Next', kind: 'main', chapter: 'prologue-1291', historical: 'invented', note: 'x', description: 'x',
      stages: [{ id: 's1', journal: 'x', onEnter: [{ dialogue: 'dlg.next' }] }],
    };
    const cs: CutsceneDef = {
      id: 'cs.outer', historical: 'invented', note: 'x',
      steps: [
        { caption: 'Scene opens.' },
        { effects: [{ quest: ['start', 'quest.next'] }] }, // starts a quest whose first stage opens a dialogue
        { caption: 'Scene closes.' }, // must run BEFORE the dialogue above, not after
      ],
    };
    ctx.content.addDialogues([dlg]);
    ctx.content.addQuests([nextQuest]);
    ctx.content.addCutscenes([cs]);
    await register(ctx);
    const quest = ctx.services.get('quest');
    await quest.runCutscene('cs.outer');
    // By the time runCutscene() resolves, BOTH of the outer cutscene's captions logged, in order,
    // and the deferred quest's dialogue also ran (queued to fire only after) — with the outer
    // cutscene's own steps never interrupted mid-scene by the inner dialogue.
    const captionLines = ui.log.filter((l) => l.startsWith('[caption]'));
    expect(captionLines).toEqual(['[caption] Scene opens.', '[caption] Scene closes.']);
    expect(quest.isStarted('quest.next')).toBe(true);
    expect(ui.log).toContain('Next quest dialogue.');
    // The dialogue line must appear AFTER both captions in the log, proving it ran after the scene closed.
    expect(ui.log.indexOf('Next quest dialogue.')).toBeGreaterThan(ui.log.indexOf('[caption] Scene closes.'));
  });

  it('critic wave3-quest.md #9: a lost Morgarten fails the quest and retries from the muster stage (not an instant re-fight)', async () => {
    const { ctx } = setup();
    loadContentInto(ctx);
    const playerId = spawnTestPlayer(ctx);
    // Re-register a party bound to the real player entity used by loadContent-driven content.
    const party = new FakePartyService(ctx.world, playerId);
    for (const skill of ctx.content.skills.keys()) party.skills.set(skill, 40);
    ctx.services.register('party', asPartyService(party));
    const exploration = new FakeExplorationService(ctx.world, playerId, ctx.content.pois);
    ctx.services.register('exploration', asExplorationService(exploration));
    // Loses exactly once, then wins — isolates "does the retry actually re-run the muster hub" from
    // "does it eventually converge" (a combat mock that always loses would retry forever).
    let morgartenCalls = 0;
    const combat = new FakeCombatService();
    combat.start = async (id: string) => {
      combat.calls.push(id);
      if (id === 'enc.morgarten') { morgartenCalls++; return { outcome: morgartenCalls === 1 ? 'lose' : 'win', rounds: 1, downed: [], dead: [], xp: {}, loot: [], log: [] }; }
      return combat.defaultOutcome;
    };
    ctx.services.register('combat', asCombatService(combat));
    await register(ctx);
    const quest = ctx.services.get('quest') as QuestServiceImpl;
    const trace: string[] = [];
    quest.on('quest-failed', (id) => trace.push(`fail:${id}`));
    quest.on('quest-started', (id) => trace.push(`start:${id}`));
    quest.on('quest-completed', (id) => trace.push(`complete:${id}`));
    quest.start('quest.muster-1315');
    // Gates are now `{nearPoi}` (presence), not the one-time `discovered` flag — cycle the fake
    // player through every POI this retry loop needs repeatedly, so whichever gate is *currently*
    // active sees the player there on some pass (both the first attempt and the retried one).
    const cyclePois = ['poi.sattel-letzi', 'poi.zug', 'poi.morgarten', 'poi.brunnen'];
    for (let i = 0; i < 400 && !quest.isDone('quest.brunnen-1315'); i++) {
      movePlayerToPoi(ctx, playerId, cyclePois[i % cyclePois.length]);
      quest.tick(1);
      await flush();
    }
    expect(morgartenCalls).toBe(2); // lost once, then fought again and won
    expect(trace).toContain('fail:quest.morgarten');
    // quest.muster-1315 ran twice (reset + retried), not stuck on an instant re-fight of the same battle.
    expect(trace.filter((t) => t === 'start:quest.muster-1315')).toHaveLength(2);
    expect(trace.filter((t) => t === 'complete:quest.muster-1315')).toHaveLength(2); // both the first (failed) run and the retry complete the muster hub itself; only Morgarten fails
    expect(quest.isDone('quest.morgarten')).toBe(true);
    expect(quest.isDone('quest.brunnen-1315')).toBe(true); // the retried run reaches the end of Act 1
    expect(quest.getFlag('morgarten.retry')).toBe(false); // the retried hub's ready stage clears the retry marker
  });

  it("3.4: {music} effects drive the UI audio bus (bed name after the 'music.' dot)", async () => {
    const { ctx } = setup();
    const played: string[] = [];
    const ui = new ScriptedUiService();
    (ui as unknown as { audio: { playMusic(id: string): void } }).audio = { playMusic: (id) => played.push(id) };
    ctx.services.register('ui', asUiService(ui));
    await register(ctx);
    const quest = ctx.services.get('quest') as QuestServiceImpl;
    await quest.runEffects([{ music: 'music.tavern' }]);
    expect(played).toEqual(['tavern']);
    await quest.runEffects([{ music: 'music.battle' }]);
    expect(played).toEqual(['tavern', 'battle']);
  });

  it("3.4: {music} with no audio on the UI service is a silent no-op (headless)", async () => {
    const { ctx } = setup();
    const ui = new ScriptedUiService(); // no .audio — headless fake
    ctx.services.register('ui', asUiService(ui));
    await register(ctx);
    const quest = ctx.services.get('quest') as QuestServiceImpl;
    await expect(quest.runEffects([{ music: 'music.tavern' }])).resolves.toBeUndefined();
  });

  it('critic wave3-quest.md round 2 #2 (probe 9): "So sworn" (the oath dialogue\'s own close) is shown before the sealing cutscene\'s caption, not after', async () => {
    const { ctx } = setup();
    loadContentInto(ctx);
    const playerId = spawnTestPlayer(ctx);
    const party = new FakePartyService(ctx.world, playerId);
    for (const skill of ctx.content.skills.keys()) party.skills.set(skill, 40);
    ctx.services.register('party', asPartyService(party));
    const exploration = new FakeExplorationService(ctx.world, playerId, ctx.content.pois);
    ctx.services.register('exploration', asExplorationService(exploration));
    ctx.services.register('combat', asCombatService(new FakeCombatService()));
    const ui = new ScriptedUiService();
    ctx.services.register('ui', asUiService(ui));
    await register(ctx);
    const quest = ctx.services.get('quest') as QuestServiceImpl;

    async function drainLocal(rounds = 40): Promise<void> { for (let i = 0; i < rounds; i++) { quest.tick(1); await flush(); } }

    quest.start('quest.der-eid');
    await drainLocal();
    movePlayerToPoi(ctx, playerId, 'poi.altdorf');
    await drainLocal();
    await quest.runDialogue('dlg.walter-fuerst');
    await drainLocal();
    movePlayerToPoi(ctx, playerId, 'poi.ruetli');
    await drainLocal(60);

    expect(quest.isDone('quest.der-eid')).toBe(true); // the whole chain, including the sealing cutscene, ran

    const swornIdx = ui.log.findIndex((l) => l.includes('So sworn'));
    const sealingCaptionIdx = ui.log.findIndex((l) => l.startsWith('[caption]') && l.includes('By torchlight on the Rütli meadow'));
    expect(swornIdx).toBeGreaterThanOrEqual(0);
    expect(sealingCaptionIdx).toBeGreaterThanOrEqual(0);
    expect(swornIdx).toBeLessThan(sealingCaptionIdx); // the dialogue's own line is shown before its effect's cutscene opens
  });
});
