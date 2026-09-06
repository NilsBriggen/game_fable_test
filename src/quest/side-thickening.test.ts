/**
 * 4.6 side-quest thickening — one branch test per thickened quest, headless via testHarness fakes.
 * Each test drives the real content through QuestServiceImpl and asserts the NEW branch fires.
 *
 * Engine note (verified 2026-09-06): a quest stage's onEnter list runs as ONE deferred job after
 * the dialogue that triggered the stage returns — `[{dialogue}, {quest:[advance]}]` in onEnter
 * both execute in order, so `offer` onEnter `[{dialogue: giver}, {quest:[advance, next]}]` lands
 * directly on the next stage once runDialogue resolves (no extra drain needed beyond one tick).
 * Tests therefore assert the post-giver stage directly.
 */
import { describe, it, expect } from 'vitest';
import { register as registerQuest, QuestServiceImpl } from './index';
import {
  makeTestContext, spawnTestPlayer, movePlayerToPoi, FakePartyService, FakeExplorationService, FakeCombatService, ScriptedUiService,
  asPartyService, asExplorationService, asCombatService, asUiService,
} from './testHarness';
import { loadContent } from '../content/index';

function flush(): Promise<void> { return new Promise((r) => setTimeout(r, 0)); }
async function drain(quest: QuestServiceImpl, rounds = 30): Promise<void> {
  for (let i = 0; i < rounds; i++) { quest.tick(1); await flush(); }
}

interface SetupOpts {
  seed?: number;
  /** pick policy over the node's *enabled* choice indices + node text */
  pick?: (enabledIndices: number[], nodeText: string) => number;
  skills?: Record<string, number>;
}

async function setup(opts: SetupOpts = {}) {
  const ctx = makeTestContext(opts.seed ?? 1);
  loadContent(ctx.content);
  const playerId = spawnTestPlayer(ctx, { origin: 'uri' });
  const party = new FakePartyService(ctx.world, playerId);
  for (const [s, v] of Object.entries(opts.skills ?? {})) party.skills.set(s, v);
  const exploration = new FakeExplorationService(ctx.world, playerId, ctx.content.pois);
  const combat = new FakeCombatService();
  const ui = new ScriptedUiService(opts.pick
    ? (n) => {
      const enabled: number[] = [];
      n.choices.forEach((c, i) => { if (c.enabled) enabled.push(i); });
      return opts.pick!(enabled, n.text);
    }
    : undefined);
  ctx.services.register('party', asPartyService(party));
  ctx.services.register('exploration', asExplorationService(exploration));
  ctx.services.register('combat', asCombatService(combat));
  ctx.services.register('ui', asUiService(ui));
  await registerQuest(ctx);
  return { ctx, playerId, party, quest: ctx.services.get('quest') as QuestServiceImpl, ui };
}

describe('4.6 side-quest thickening branches', () => {
  it('der-saeumer: safe choice (unload, advanceTime) reaches a clean reward with the purse', async () => {
    // offer(accept) -> walk to the bridge -> crossing dialogue, pick "Unload..." (index 1)
    const { ctx, playerId, quest, party } = await setup({
      pick: (enabled, text) => (text.includes('spans the gorge') ? (enabled[1] ?? enabled[0]) : enabled[0]),
    });
    const t0 = ctx.clock.time;
    await quest.runDialogue('dlg.saeumer-escort');
    await drain(quest);
    expect(quest.stage('quest.der-saeumer')).toBe('offer'); // parked until the player walks
    movePlayerToPoi(ctx, playerId, 'poi.teufelsbruecke');
    await drain(quest);
    // crossing's onEnter dialogue auto-fires on arrival; the pick policy chose "Unload..."
    // (advanceTime 6 + clean) — no manual second runDialogue needed.
    expect(quest.getVar('quest.der-saeumer', 'crossing')).toBe('clean');
    expect(quest.stage('quest.der-saeumer')).toBe('reward-clean');
    expect(ctx.clock.time).toBeGreaterThan(t0); // the safe choice costs hours
    await drain(quest);
    expect(quest.isDone('quest.der-saeumer')).toBe(true);
    expect(party.items.get('item.pfennig-purse')).toBe(1);
  });

  it('der-saeumer: rough reward carries reduced rep and no purse (cut-loose route)', async () => {
    // bridge node: pick "Risk it" (index 2, athletics DC15) with athletics 0 at seed 1
    // (verified: risk-it fails -> ledge-fight) then "Cut the load loose" -> ledge-loss.
    // Deterministic per the seed hunt (seeds 1,2,3,6,8,9,11,12 all reach reward-rough).
    const { ctx, playerId, quest, party } = await setup({
      seed: 1,
      skills: { athletics: 0 },
      pick: (enabled, text) => {
        if (text.includes('spans the gorge')) return enabled[2] ?? enabled[0]; // risk it
        if (text.includes('jams against the parapet')) return enabled[1] ?? enabled[0]; // cut loose
        return enabled[0];
      },
    });
    await quest.runDialogue('dlg.saeumer-escort');
    await drain(quest);
    expect(quest.stage('quest.der-saeumer')).toBe('offer'); // parked until the player walks
    movePlayerToPoi(ctx, playerId, 'poi.teufelsbruecke');
    await drain(quest);
    // crossing auto-fires on arrival; the policy picked risk-it (seed 7: athletics 0 fails
    // DC15) then cut-loose at the ledge-fight node.
    expect(quest.getVar('quest.der-saeumer', 'crossing')).toBe('rough');
    expect(quest.stage('quest.der-saeumer')).toBe('reward-rough');
    await drain(quest);
    expect(quest.isDone('quest.der-saeumer')).toBe(true);
    expect(party.items.get('item.pfennig-purse') ?? 0).toBe(0);
    expect(quest.reputation('saeumer')).toBe(5);
    const journals = quest.journal().filter((j) => j.questId === 'quest.der-saeumer').map((j) => j.text);
    expect(journals.some((t) => t.includes('salt sack lighter'))).toBe(true);
  });

  it('alpstreit: inspect -> examine -> hearing chain with keen-eyed observation', async () => {
    const { ctx, playerId, quest } = await setup({ skills: { alpine: 40, speech: 40 } });
    await quest.runDialogue('dlg.alpstreit-dispute');
    await drain(quest);
    expect(quest.stage('quest.alpstreit')).toBe('inspect');
    movePlayerToPoi(ctx, playerId, 'poi.steinerberg');
    await drain(quest);
    // examine auto-fires dlg.alpstreit-inspect on arrival (alpine 40 passes DC12 at seed 1).
    expect(quest.getVar('quest.alpstreit', 'inspected')).toBe('keen');
    // the keen-eyed outcome advances to the hearing, whose own onEnter dialogue may auto-fire
    // on entry too (speech 40 resolves by die roll) — accept hearing or ruling here.
    expect(['hearing', 'ruling']).toContain(quest.stage('quest.alpstreit'));
    const journals = quest.journal().filter((j) => j.questId === 'quest.alpstreit').map((j) => j.text);
    expect(journals.some((t) => t.includes('disputed slope'))).toBe(true);
    expect(journals.some((t) => t.includes('letzi'))).toBe(true);
  });

  it('alpstreit: hearing advances to ruling and completes', async () => {
    const { ctx, playerId, quest } = await setup({ skills: { alpine: 40, speech: 40 } });
    await quest.runDialogue('dlg.alpstreit-dispute');
    await drain(quest);
    movePlayerToPoi(ctx, playerId, 'poi.steinerberg');
    await drain(quest);
    // examine auto-fired the inspect dialogue; the hearing may have auto-fired as well —
    // only drive it manually if still parked there.
    if (quest.stage('quest.alpstreit') === 'hearing') await quest.runDialogue('dlg.alpstreit-hearing');
    await drain(quest);
    expect(quest.stage('quest.alpstreit')).toBe('ruling');
    await drain(quest);
    expect(quest.isDone('quest.alpstreit')).toBe(true);
  });

  it('fischer-von-gersau: success path journals freedom and completes without the toll flag', async () => {
    const { quest } = await setup({ skills: { speech: 100 } });
    await quest.runDialogue('dlg.fischer-gersau');
    await drain(quest);
    // speech 100: bonus 10, DC14 succeeds unless the roll is 1-3; seed 1 rolls high (verified)
    await quest.runDialogue('dlg.fischer-gersau-confront');
    await drain(quest);
    expect(quest.getVar('quest.fischer-von-gersau', 'toll')).toBe('beaten');
    expect(quest.stage('quest.fischer-von-gersau')).toBe('freedom');
    await quest.runDialogue('dlg.fischer-gersau-return');
    await drain(quest);
    expect(quest.isDone('quest.fischer-von-gersau')).toBe(true);
    expect(quest.getFlag('gersau-toll-owed')).toBeUndefined();
    const journals = quest.journal().filter((j) => j.questId === 'quest.fischer-von-gersau').map((j) => j.text);
    expect(journals.some((t) => t.includes('unmolested'))).toBe(true);
  });

  it('fischer-von-gersau: fail path journals tribute and sets gersau-toll-owed', async () => {
    // pick the last choice ("Leave him to his ledger") -> confront-fail -> tribute
    const { quest } = await setup({ pick: (enabled, text) => (text.includes('ledger') ? enabled[enabled.length - 1] : enabled[0]) });
    await quest.runDialogue('dlg.fischer-gersau');
    await drain(quest);
    await quest.runDialogue('dlg.fischer-gersau-confront');
    await drain(quest);
    expect(quest.getVar('quest.fischer-von-gersau', 'toll')).toBe('standing');
    expect(quest.stage('quest.fischer-von-gersau')).toBe('tribute');
    await quest.runDialogue('dlg.fischer-gersau-return');
    await drain(quest);
    expect(quest.isDone('quest.fischer-von-gersau')).toBe(true);
    expect(quest.getFlag('gersau-toll-owed')).toBe(true);
    const journals = quest.journal().filter((j) => j.questId === 'quest.fischer-von-gersau').map((j) => j.text);
    expect(journals.some((t) => t.includes('grudgingly softened') || t.includes('toll stands'))).toBe(true);
    // journals differ between the two paths
    expect(journals.some((t) => t.includes('yielded'))).toBe(false);
  });

  it('drache-vom-pilatus: truth marks the cache, cache beat grants the salt sack', async () => {
    const { ctx, playerId, quest, party } = await setup({ skills: { stealth: 40 } });
    await quest.runDialogue('dlg.drache-pilatus');
    await drain(quest);
    expect(quest.stage('quest.drache-vom-pilatus')).toBe('offer'); // parked until the player walks
    movePlayerToPoi(ctx, playerId, 'poi.luzern');
    await drain(quest);
    expect(quest.stage('quest.drache-vom-pilatus')).toBe('climb');
    movePlayerToPoi(ctx, playerId, 'poi.pilatus');
    await drain(quest);
    // truth auto-fires its summit dialogue on entry (stealth 40): the cache is marked, the
    // cache beat is entered, and its own dialogue auto-fires (first choice -> share).
    expect(quest.getVar('quest.drache-vom-pilatus', 'cache')).toBe('marked');
    expect(['cache', 'resolution']).toContain(quest.stage('quest.drache-vom-pilatus'));
    // the cache beat's own dialogue auto-fires on entry (first choice -> share): the quest may
    // already be complete — drive the cache dialogue only if still parked there.
    if (quest.stage('quest.drache-vom-pilatus') === 'cache') {
      // no salt granted yet — the grant lives in the cache beat, not the summit dialogue
      expect(party.items.get('item.salt-sack') ?? 0).toBe(0);
      await quest.runDialogue('dlg.drache-pilatus-cache');
      await drain(quest);
    }
    expect(quest.isDone('quest.drache-vom-pilatus')).toBe(true);
    // the physical cache beat (not the summit dialogue) granted the salt
    expect(party.items.get('item.salt-sack')).toBe(1);
  });

  it('schuetzenkoenig: contest records a placing and completes', async () => {
    const { ctx, playerId, quest } = await setup({ skills: { crossbow: 40 } });
    await quest.runDialogue('dlg.schuetzenkoenig-entry');
    await drain(quest);
    expect(quest.stage('quest.schuetzenkoenig')).toBe('offer'); // parked until the player walks
    movePlayerToPoi(ctx, playerId, 'poi.altdorf');
    await drain(quest);
    // contest auto-fires on arrival (heats -> shoot via first choice; crossbow 40 vs DC18/DC13
    // resolves by die roll — either way a placing is recorded and the quest completes).
    expect(quest.stage('quest.schuetzenkoenig')).toBe('prize');
    expect(quest.getVar('quest.schuetzenkoenig', 'placing')).toBeDefined();
    await drain(quest);
    expect(quest.isDone('quest.schuetzenkoenig')).toBe(true);
    const journals = quest.journal().filter((j) => j.questId === 'quest.schuetzenkoenig').map((j) => j.text);
    expect(journals.some((t) => t.includes('heats'))).toBe(true);
  });

  it('schuetzenkoenig: asking Burkhard first still reaches the shoot (talk detour)', async () => {
    // heats node: pick index 1 ("Ask Burkhard...") -> talk -> shoot; then first choice (crown attempt)
    const { ctx, playerId, quest, ui } = await setup({
      skills: { crossbow: 100 },
      pick: (enabled, text) => (text.includes('early heats') ? (enabled[1] ?? enabled[0]) : enabled[0]),
    });
    await quest.runDialogue('dlg.schuetzenkoenig-entry');
    await drain(quest);
    expect(quest.stage('quest.schuetzenkoenig')).toBe('offer'); // parked until the player walks
    movePlayerToPoi(ctx, playerId, 'poi.altdorf');
    await drain(quest);
    // contest auto-fires on arrival; the policy took the "Ask Burkhard" detour at the heats node.
    expect(ui.log.some((l) => l.includes('Beat mine'))).toBe(true);
    expect(quest.getVar('quest.schuetzenkoenig', 'placing')).toBeDefined();
  });

  it('bad-zu-wolfenschiessen: clean hide advances the clock and completes quietly', async () => {
    const { quest, ctx } = await setup({ skills: { stealth: 100 } });
    const t0 = ctx.clock.time;
    await quest.runDialogue('dlg.bad-wolfenschiessen');
    await drain(quest);
    await quest.runDialogue('dlg.bad-wolfenschiessen-hide');
    await drain(quest);
    expect(quest.getVar('quest.bad-zu-wolfenschiessen', 'haste')).toBe('dawn-met');
    expect(quest.stage('quest.bad-zu-wolfenschiessen')).toBe('quiet');
    expect(ctx.clock.time).toBeGreaterThan(t0); // advanceTime pressure fired
    await drain(quest);
    expect(quest.isDone('quest.bad-zu-wolfenschiessen')).toBe(true);
    expect(quest.getFlag('wolfenschiessen-clerk-coming')).toBeUndefined();
  });

  it('bad-zu-wolfenschiessen: sloppy hide sets the clerk-coming flag and plays the consequence beat', async () => {
    // pick "plain work" (last choice) -> hide-messy -> exposed -> clerk dialogue
    const { quest, ui } = await setup({ pick: (enabled, text) => (text.includes('great deal') ? enabled[enabled.length - 1] : enabled[0]) });
    await quest.runDialogue('dlg.bad-wolfenschiessen');
    await drain(quest);
    await quest.runDialogue('dlg.bad-wolfenschiessen-hide');
    await drain(quest);
    expect(quest.getVar('quest.bad-zu-wolfenschiessen', 'haste')).toBe('slow');
    expect(quest.stage('quest.bad-zu-wolfenschiessen')).toBe('exposed');
    expect(quest.getFlag('wolfenschiessen-clerk-coming')).toBe(true);
    await quest.runDialogue('dlg.bad-wolfenschiessen-clerk');
    await drain(quest);
    expect(quest.isDone('quest.bad-zu-wolfenschiessen')).toBe(true);
    expect(ui.log.some((l) => l.includes('Sarnen'))).toBe(true);
    const journals = quest.journal().filter((j) => j.questId === 'quest.bad-zu-wolfenschiessen').map((j) => j.text);
    expect(journals.some((t) => t.includes('too slow') || t.includes('clerk'))).toBe(true);
  });

  it('save round-trip preserves the new vars/flags mid-quest', async () => {
    const { quest } = await setup({ skills: { speech: 100 } });
    await quest.runDialogue('dlg.fischer-gersau');
    await drain(quest);
    await quest.runDialogue('dlg.fischer-gersau-confront');
    await drain(quest);
    const saved = quest.serialize();
    expect(saved.quests['quest.fischer-von-gersau'].vars['toll']).toBe('beaten');
    // restore into a fresh service
    const second = await setup({ skills: { speech: 100 } });
    second.quest.restore(saved);
    expect(second.quest.getVar('quest.fischer-von-gersau', 'toll')).toBe('beaten');
    expect(second.quest.stage('quest.fischer-von-gersau')).toBe('freedom');
  });
});
