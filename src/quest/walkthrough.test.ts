/**
 * Headless Act 1 walkthrough — the proof the main-quest spine is connected end to end. Registers all
 * real content, starts `quest.der-eid`, drives the two player-initiated beats (discovering Altdorf,
 * talking to Walter Fürst) plus every dialogue choice via a scripted "always pick the first enabled
 * choice" UI policy, fakes combat as an automatic win, and asserts the chain reaches
 * `quest.brunnen-1315` complete with the expected chapter transitions and flags.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { register as registerQuest, QuestServiceImpl } from './index';
import {
  makeTestContext, spawnTestPlayer, FakePartyService, FakeExplorationService, FakeCombatService, ScriptedUiService,
  asPartyService, asExplorationService, asCombatService, asUiService,
} from './testHarness';
import { loadContent } from '../content/index';

function flush(): Promise<void> { return new Promise((r) => setTimeout(r, 0)); }
async function drain(rounds = 40): Promise<void> { for (let i = 0; i < rounds; i++) await flush(); }

describe('Act 1 headless walkthrough', () => {
  it('runs the full main-quest spine from quest.der-eid to quest.brunnen-1315 complete', async () => {
    const ctx = makeTestContext(1291);
    loadContent(ctx.content);
    const contentProblems = ctx.content.validate();
    expect(contentProblems).toEqual([]);

    const playerId = spawnTestPlayer(ctx, { origin: 'uri', givenName: 'Kuoni', familyName: 'Imhof' });
    const party = new FakePartyService(ctx.world, playerId);
    // Give every skill a mid-level baseline so the spine's skill checks resolve without needing a
    // scripted RNG — the walkthrough is testing *connectivity*, not check odds.
    for (const skill of ctx.content.skills.keys()) party.skills.set(skill, 40);
    const exploration = new FakeExplorationService(ctx.world, playerId, ctx.content.pois);
    const combat = new FakeCombatService(); // defaultOutcome is 'win' for every encounter id
    const ui = new ScriptedUiService(); // default policy: always pick the first *enabled* choice

    ctx.services.register('party', asPartyService(party));
    ctx.services.register('exploration', asExplorationService(exploration));
    ctx.services.register('combat', asCombatService(combat));
    ctx.services.register('ui', asUiService(ui));

    await registerQuest(ctx);
    const quest = ctx.services.get('quest') as QuestServiceImpl;

    const trace: string[] = [];
    quest.on('quest-started', (id) => trace.push(`start:${id}`));
    quest.on('quest-advanced', (id, stage) => trace.push(`${id}:${stage}`));
    quest.on('quest-completed', (id) => trace.push(`complete:${id}`));
    quest.on('flag-changed', (k, v) => { if (k === 'act-complete:act1') trace.push(`flag:act-complete:act1=${v}`); });

    // --- Prologue -----------------------------------------------------------------------------
    quest.start('quest.der-eid');
    await drain();
    expect(quest.stage('quest.der-eid')).toBe('fluelen-news');

    exploration.discover('poi.altdorf'); // tutorial POI discovery gates the first stage
    await drain();
    expect(quest.stage('quest.der-eid')).toBe('altdorf-message');

    await quest.runDialogue('dlg.walter-fuerst'); // the message-carrying beat is player-initiated
    await drain();
    // 'escort' onEnter fires enc.brunnen-quay (fake win) -> advanceWhen -> 'ruetli-oath' -> dialogue
    // -> 'sealing' -> cutscene -> completes quest.der-eid, sets ch1-1307, starts quest.der-hut, which
    // itself immediately drives the rest of the spine to quest.brunnen-1315 the same way.
    await drain(200);

    expect(quest.isDone('quest.der-eid')).toBe(true);
    expect(quest.isDone('quest.der-hut')).toBe(true);
    expect(quest.isDone('quest.burgenbruch')).toBe(true);
    expect(quest.isDone('quest.epilog-1308')).toBe(true);
    expect(quest.isDone('quest.marchenstreit')).toBe(true);
    expect(quest.isDone('quest.muster-1315')).toBe(true);
    expect(quest.isDone('quest.morgarten')).toBe(true);
    expect(quest.isDone('quest.brunnen-1315')).toBe(true);

    expect(quest.chapter()).toBe('ch2-1314');
    expect(exploration.populateCalls).toEqual(['ch1-1307', 'ch2-1314']);
    expect(party.chapterApplied).toEqual(['ch1-1307', 'ch2-1314']);
    expect(combat.calls).toEqual(['enc.brunnen-quay', 'enc.hohle-gasse', 'enc.einsiedeln-gate', 'enc.morgarten']);
    expect(quest.getFlag('hunenberg-warning')).toBe(true); // default-picked "trust the warning"
    expect(quest.getFlag('act-complete:act1')).toBe(true);

    // Journal reads "as it is told" for the legend beats.
    const journalText = quest.journal().map((j) => j.text).join('\n');
    expect(journalText).toMatch(/as it is told/i);
    expect(journalText).toMatch(/letter was sealed/);

    console.log('--- Act 1 walkthrough stage trace ---');
    for (const t of trace) console.log(t);
    expect(trace).toContain('complete:quest.brunnen-1315');
  }, 20000);
});
