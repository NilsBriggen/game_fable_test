/**
 * Critic probe — reproduces "effects on a quest that isn't started": every one of the six side
 * quests (src/content/quests/side/*) is offered purely via an NPC's `dialogueRoot`
 * (src/content/npcs.ts), and that opening dialogue's "agree" choice only ever does
 * `{quest: ['advance', questId, nextStage]}` — never `{quest: ['start', questId]}`.
 * `QuestMachine.advance()` (src/quest/quests.ts) is a silent no-op when `!isStarted(id)`, so talking
 * to the giver NPC and picking "agree" produces dialogue text and NPC-side effects (rep etc. on later
 * nodes) but the quest itself never starts: it never appears in the journal, the active-quest tracker,
 * or save data, and every later `quest:['advance',...]` in that same quest's dialogue chain is *also*
 * silently dropped for the same reason. Confirmed for all six side quests below.
 */
import { describe, it, expect } from 'vitest';
import { register as registerQuest, QuestServiceImpl } from '../../../../src/quest/index';
import {
  makeTestContext, spawnTestPlayer, FakePartyService, FakeExplorationService, FakeCombatService, ScriptedUiService,
  asPartyService, asExplorationService, asCombatService, asUiService,
} from '../../../../src/quest/testHarness';
import { loadContent } from '../../../../src/content/index';

const CASES: { quest: string; dialogue: string; giverNpc: string }[] = [
  { quest: 'quest.alpstreit', dialogue: 'dlg.alpstreit-dispute', giverNpc: 'npc.melchior-arnold' },
  { quest: 'quest.bad-zu-wolfenschiessen', dialogue: 'dlg.bad-wolfenschiessen', giverNpc: 'npc.jost-durrer' },
  { quest: 'quest.der-saeumer', dialogue: 'dlg.saeumer-escort', giverNpc: 'npc.niklaus-planzer' },
  { quest: 'quest.drache-vom-pilatus', dialogue: 'dlg.drache-pilatus', giverNpc: 'npc.trudi-meier' },
  { quest: 'quest.fischer-von-gersau', dialogue: 'dlg.fischer-gersau', giverNpc: 'npc.uli-fischer' },
  { quest: 'quest.schuetzenkoenig', dialogue: 'dlg.schuetzenkoenig-entry', giverNpc: 'npc.burkhard-wyrsch' },
];

async function setup() {
  const ctx = makeTestContext(1);
  loadContent(ctx.content);
  const playerId = spawnTestPlayer(ctx, { origin: 'uri' });
  const party = new FakePartyService(ctx.world, playerId);
  const exploration = new FakeExplorationService(ctx.world, playerId, ctx.content.pois);
  const combat = new FakeCombatService();
  const ui = new ScriptedUiService(); // picks first enabled choice — "agree"/accept every time
  ctx.services.register('party', asPartyService(party));
  ctx.services.register('exploration', asExplorationService(exploration));
  ctx.services.register('combat', asCombatService(combat));
  ctx.services.register('ui', asUiService(ui));
  await registerQuest(ctx);
  const quest = ctx.services.get('quest') as QuestServiceImpl;
  return { quest };
}

describe('side quests never start (giver dialogue only ever quest:advance, never quest:start)', () => {
  for (const { quest: qid, dialogue, giverNpc } of CASES) {
    it(`${qid}: talking to ${giverNpc} (${dialogue}) and picking "agree" does NOT start the quest`, async () => {
      const { quest } = await setup();
      expect(quest.isStarted(qid)).toBe(false);
      await quest.runDialogue(dialogue);
      // Bug: the quest is still not started — the dialogue's `{quest:['advance', ...]}` effect was a
      // silent no-op inside QuestMachine.advance() because isStarted(qid) was false. Expected behaviour
      // would be quest.isStarted(qid) === true after accepting the quest offer.
      expect(quest.isStarted(qid)).toBe(false);
      expect(quest.stage(qid)).toBeNull();
    });
  }
});
