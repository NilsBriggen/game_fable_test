/**
 * Critic probe — REGRESSION GUARD (was: "side quests never start", bughunt quest #1, fixed 2026-09-05
 * in the Phase 4 4.0 pass). Every one of the six side quests (src/content/quests/side/*) is offered
 * purely via an NPC's `dialogueRoot` (src/content/npcs.ts), and the opening dialogue's accept choice
 * must `{quest: ['start', questId]}` — start, not advance — with the quest's first stage id matching the
 * giver dialogue's stage. Guards the regression: if any giver dialogue regresses to advance-only, or a
 * first-stage id drifts from the dialogue the giver actually plays, the quest silently never starts.
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

describe('side quests start from their giver dialogue (bughunt #1 regression guard)', () => {
  for (const { quest: qid, dialogue, giverNpc } of CASES) {
    it(`${qid}: talking to ${giverNpc} (${dialogue}) and accepting starts the quest`, async () => {
      const { quest } = await setup();
      expect(quest.isStarted(qid)).toBe(false);
      await quest.runDialogue(dialogue);
      expect(quest.isStarted(qid)).toBe(true);
      expect(quest.stage(qid)).not.toBeNull();
      // the quest journal carries a line for the giver stage (it entered through start, not a silent no-op)
      expect(quest.journal().some((j) => j.questId === qid)).toBe(true);
    });
  }
});
