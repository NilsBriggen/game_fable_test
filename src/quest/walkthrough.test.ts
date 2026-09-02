/**
 * Headless Act 1 walkthrough — the proof the main-quest spine is connected end to end. Registers all
 * real content, starts `quest.der-eid`, drives every travel/arrival gate by actually moving the fake
 * player's position (critic wave3-quest.md round 2 #1: gates are `{nearPoi}`/`{inRegion}` — presence,
 * not the one-time `discovered` flag) and every dialogue choice, fakes combat as an automatic win, and
 * asserts the chain reaches `quest.brunnen-1315` complete with the expected chapter transitions and
 * flags. Run twice with different choice policies — critic wave3-quest.md round 1 #3/#6: a "last
 * enabled choice everywhere" run must reach the Pact of Brunnen exactly like the "first enabled choice"
 * run, proving there is no soft-lock on any branch (e.g. Abt Johannes's "say nothing" option).
 */
import { describe, it, expect } from 'vitest';
import { register as registerQuest, QuestServiceImpl } from './index';
import {
  makeTestContext, spawnTestPlayer, movePlayerToPoi, FakePartyService, FakeExplorationService, FakeCombatService, ScriptedUiService,
  asPartyService, asExplorationService, asCombatService, asUiService,
} from './testHarness';
import { loadContent } from '../content/index';
import type { DialogueNodeView } from '@core/services';

function flush(): Promise<void> { return new Promise((r) => setTimeout(r, 0)); }
/** Flushes microtasks AND drives the quest module's periodic advanceWhen tick (ARCHITECTURE.md §5.6:
 *  every 0.5s) — required now that `{nearPoi}`/`{inRegion}` gates have no discrete "you arrived" event
 *  to react to; only the periodic sweep (or another quest transition) re-checks them. */
async function drain(quest: QuestServiceImpl, rounds = 40): Promise<void> {
  for (let i = 0; i < rounds; i++) { quest.tick(1); await flush(); }
}

const TRAVEL_POIS = ['poi.altdorf', 'poi.ruetli', 'poi.tellsplatte', 'poi.hohle-gasse', 'poi.zwing-uri', 'poi.sattel-letzi', 'poi.morgarten', 'poi.brunnen'];

function pickFirstEnabled(n: DialogueNodeView): number {
  return Math.max(0, n.choices.findIndex((c) => c.enabled));
}
function pickLastEnabled(n: DialogueNodeView): number {
  let last = -1;
  n.choices.forEach((c, i) => { if (c.enabled) last = i; });
  return Math.max(0, last);
}

async function runWalkthrough(policy: 'first' | 'last') {
  const ctx = makeTestContext(1291);
  loadContent(ctx.content);
  expect(ctx.content.validate()).toEqual([]);

  const playerId = spawnTestPlayer(ctx, { origin: 'uri', givenName: 'Kuoni', familyName: 'Imhof' });
  const party = new FakePartyService(ctx.world, playerId);
  // Give every skill a mid-level baseline so the spine's skill checks resolve without needing a
  // scripted RNG — the walkthrough is testing *connectivity*, not check odds.
  for (const skill of ctx.content.skills.keys()) party.skills.set(skill, 40);
  const exploration = new FakeExplorationService(ctx.world, playerId, ctx.content.pois);
  const combat = new FakeCombatService(); // defaultOutcome is 'win' for every encounter id
  const ui = new ScriptedUiService(policy === 'first' ? pickFirstEnabled : pickLastEnabled);

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
  quest.on('quest-failed', (id) => trace.push(`fail:${id}`));

  // --- Prologue: the two genuinely player-initiated beats (arriving at Altdorf, talking to Fürst) ---
  quest.start('quest.der-eid');
  await drain(quest);
  expect(quest.stage('quest.der-eid')).toBe('fluelen-news');

  movePlayerToPoi(ctx, playerId, 'poi.altdorf');
  await drain(quest);
  expect(quest.stage('quest.der-eid')).toBe('altdorf-message');

  await quest.runDialogue('dlg.walter-fuerst');
  await drain(quest);

  // Chapter-seam parking (critic wave3-quest.md round 2 #1): the sealing cutscene ends with the player
  // still physically at the Rütli in 1307 — der-hut's very first stage must NOT proceed until the
  // player has actually walked to Altdorf, even though Altdorf was already visited in the prologue.
  movePlayerToPoi(ctx, playerId, 'poi.ruetli');
  await drain(quest);
  expect(quest.isDone('quest.der-eid')).toBe(true);
  expect(quest.isStarted('quest.der-hut')).toBe(true);
  expect(quest.stage('quest.der-hut')).toBe('travel-altdorf'); // parked: player is at the Rütli, not Altdorf
  expect(quest.chapter()).toBe('ch1-1307');

  movePlayerToPoi(ctx, playerId, 'poi.altdorf');
  await drain(quest);
  expect(quest.stage('quest.der-hut')).not.toBe('travel-altdorf'); // unparked now that the player arrived

  // Every other travel/arrival gate up to (not including) marchenstreit's Einsiedeln park — der-hut's
  // Tellsplatte/Hohle Gasse, Burgenbruch's chosen castle (Zwing Uri, per the "storm it yourself" choice
  // both policies reach — see dlg.burgenbruch-council), muster-1315's Sattel letzi.
  for (const poi of TRAVEL_POIS) {
    movePlayerToPoi(ctx, playerId, poi);
    await drain(quest, 30);
  }

  // Chapter 2's first arrival gate (critic wave3-quest.md round 3 #1): after the Schwyz Landsgemeinde
  // argument, marchenstreit must park at travel-einsiedeln — not resolve the raid/speech choice before
  // the player has actually walked to the abbey.
  expect(quest.isStarted('quest.marchenstreit')).toBe(true);
  expect(quest.stage('quest.marchenstreit')).toBe('travel-einsiedeln');

  movePlayerToPoi(ctx, playerId, 'poi.einsiedeln');
  await drain(quest, 60);
  expect(quest.stage('quest.marchenstreit')).not.toBe('travel-einsiedeln');
  expect(quest.isDone('quest.marchenstreit')).toBe(true);

  // muster-1315 has just started and parks at travel-sattel first — the player needs to be physically
  // back at the letzi (not still at Einsiedeln) before it can proceed through letzi-craft/recruit.
  expect(quest.isStarted('quest.muster-1315')).toBe(true);
  movePlayerToPoi(ctx, playerId, 'poi.sattel-letzi');
  await drain(quest, 60);

  // muster-1315 must likewise park at travel-zug after recruiting, before scouting Leopold's camp.
  expect(quest.stage('quest.muster-1315')).toBe('travel-zug');

  movePlayerToPoi(ctx, playerId, 'poi.zug');
  await drain(quest, 60);
  expect(quest.isDone('quest.muster-1315')).toBe(true);

  // morgarten and brunnen-1315's own travel-* gates: poi.morgarten/poi.brunnen were visited earlier in
  // the bulk loop, long before these quests existed — presence gates need the player there *now*.
  movePlayerToPoi(ctx, playerId, 'poi.morgarten');
  await drain(quest, 60);
  movePlayerToPoi(ctx, playerId, 'poi.brunnen');
  await drain(quest, 100);

  return { quest, ctx, party, exploration, combat, trace };
}

describe('Act 1 headless walkthrough', () => {
  it('first-enabled-choice policy: runs the full main-quest spine from quest.der-eid to quest.brunnen-1315 complete', async () => {
    const { quest, party, exploration, combat, trace } = await runWalkthrough('first');

    expect(quest.isDone('quest.der-eid')).toBe(true);
    expect(quest.isDone('quest.der-hut')).toBe(true);
    expect(quest.isDone('quest.burgenbruch')).toBe(true);
    expect(quest.isDone('quest.epilog-1308')).toBe(true);
    expect(quest.isDone('quest.marchenstreit')).toBe(true);
    expect(quest.isDone('quest.muster-1315')).toBe(true);
    expect(quest.isDone('quest.morgarten')).toBe(true);
    expect(quest.isDone('quest.brunnen-1315')).toBe(true);

    expect(quest.chapter()).toBe('ch2-1314');
    expect(party.chapterApplied).toEqual(['ch1-1307', 'ch2-1314']);
    expect(exploration.populateCalls).toEqual(['ch1-1307', 'ch2-1314']);
    expect(combat.calls).toEqual(['enc.brunnen-quay', 'enc.hohle-gasse', 'enc.einsiedeln-gate', 'enc.morgarten']);
    expect(quest.getFlag('hunenberg-warning')).toBe(true); // first-enabled = "trust the warning"
    expect(quest.getFlag('act-complete:act1')).toBe(true);
    // Tell joined and left again as a Chapter 1 companion (critic wave3-quest.md #6).
    expect(party.members.size).toBe(1); // back to just the player by epilogue

    const journalText = quest.journal().map((j) => j.text).join('\n');
    expect(journalText).toMatch(/as it is told/i);
    expect(journalText).toMatch(/letter was sealed/);
    expect(journalText).toMatch(/give no year/);
    expect(journalText).toMatch(/bought his office|has bought his office/);

    console.log('--- Act 1 walkthrough stage trace (first-enabled) ---');
    for (const t of trace) console.log(t);
    expect(trace).toContain('complete:quest.brunnen-1315');
  }, 20000);

  it('critic wave3-quest.md #3/#6: last-enabled-choice policy also reaches the Pact of Brunnen (no soft-lock, e.g. at Abt Johannes)', async () => {
    const { quest, combat, trace } = await runWalkthrough('last');

    expect(quest.isDone('quest.der-eid')).toBe(true);
    expect(quest.isDone('quest.der-hut')).toBe(true);
    expect(quest.isDone('quest.burgenbruch')).toBe(true);
    expect(quest.isDone('quest.epilog-1308')).toBe(true);
    expect(quest.isDone('quest.marchenstreit')).toBe(true);
    expect(quest.isDone('quest.muster-1315')).toBe(true);
    expect(quest.isDone('quest.morgarten')).toBe(true);
    expect(quest.isDone('quest.brunnen-1315')).toBe(true);
    expect(quest.getFlag('act-complete:act1')).toBe(true);
    expect(quest.getFlag('hunenberg-warning')).toBe(false); // last-enabled = "distrust it"
    // The "restraint" branch was picked, which routes through Abt Johannes's "say nothing" choice —
    // the exact soft-lock the critic found. It must still land on marchenstreit's raid encounter.
    expect(combat.calls).toContain('enc.einsiedeln-gate');

    console.log('--- Act 1 walkthrough stage trace (last-enabled) ---');
    for (const t of trace) console.log(t);
    expect(trace).toContain('complete:quest.brunnen-1315');
  }, 20000);
});
