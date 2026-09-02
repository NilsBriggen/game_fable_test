import { describe, it, expect } from 'vitest';
import { register, QuestServiceImpl } from './index';
import {
  makeTestContext, spawnTestPlayer, FakePartyService, FakeExplorationService, FakeCombatService, ScriptedUiService,
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
});
