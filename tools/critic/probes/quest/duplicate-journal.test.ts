/**
 * Critic probe — "duplicate journal entries" via the escort/Hohle-Gasse "lose and retry" loops.
 * `quest.der-eid`'s `escort-recover` stage (src/content/quests/act1/der-eid.ts) and
 * `quest.der-hut`'s `hohle-gasse-recover` stage (src/content/quests/act1/der-hut.ts) both respond to
 * a lost encounter by re-`advance`-ing straight back into the stage that just ran the encounter —
 * *without* the `{silentJournal: true}` treatment that `QuestServiceImpl`'s own Morgarten/muster-1315
 * retry loop (src/quest/index.ts, the `quest-failed` handler) uses for exactly this reason. Since
 * `QuestMachine.enterStage` (src/quest/quests.ts) journals `stage.journal` on every entry unless
 * `silentJournal` is set, and a plain `{quest:['advance', ...]}` effect never sets it, losing the
 * encounter a second time re-adds the *exact same* stage journal line verbatim.
 */
import { describe, it, expect } from 'vitest';
import { register as registerQuest, QuestServiceImpl } from '../../../../src/quest/index';
import {
  makeTestContext, spawnTestPlayer, movePlayerToPoi, FakePartyService, FakeExplorationService, FakeCombatService, ScriptedUiService,
  asPartyService, asExplorationService, asCombatService, asUiService,
} from '../../../../src/quest/testHarness';
import { loadContent } from '../../../../src/content/index';

function flush(): Promise<void> { return new Promise((r) => setTimeout(r, 0)); }
async function drain(quest: QuestServiceImpl, rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i++) { quest.tick(1); await flush(); }
}

describe('duplicate journal entries on a lost-encounter retry loop', () => {
  it('quest.der-eid: losing enc.brunnen-quay once, then winning the retry, journals "A boat carries the elder..." twice', async () => {
    const ctx = makeTestContext(2);
    loadContent(ctx.content);
    const playerId = spawnTestPlayer(ctx, { origin: 'uri' });
    const party = new FakePartyService(ctx.world, playerId);
    const exploration = new FakeExplorationService(ctx.world, playerId, ctx.content.pois);
    const combat = new FakeCombatService();
    let calls = 0;
    combat.start = async (id: string) => {
      combat.calls.push(id);
      calls++;
      return calls === 1
        ? { outcome: 'lose' as const, rounds: 1, downed: [], dead: [], xp: {}, loot: [], log: [] }
        : { outcome: 'win' as const, rounds: 1, downed: [], dead: [], xp: {}, loot: [], log: [] };
    };
    const ui = new ScriptedUiService();
    ctx.services.register('party', asPartyService(party));
    ctx.services.register('exploration', asExplorationService(exploration));
    ctx.services.register('combat', asCombatService(combat));
    ctx.services.register('ui', asUiService(ui));
    await registerQuest(ctx);
    const quest = ctx.services.get('quest') as QuestServiceImpl;

    quest.start('quest.der-eid');
    await drain(quest);
    movePlayerToPoi(ctx, playerId, 'poi.altdorf');
    await drain(quest);
    expect(quest.stage('quest.der-eid')).toBe('altdorf-message');
    // altdorf-message has no advanceWhen in content — advance it manually the way dlg.walter-fuerst would.
    await quest.runDialogue('dlg.walter-fuerst');
    await drain(quest, 10);
    await drain(quest, 10);

    expect(combat.calls.filter((c) => c === 'enc.brunnen-quay').length).toBe(2); // proves the retry loop actually fired

    const escortLines = quest.journal().filter((j) => j.text.startsWith('A boat carries the elder toward Steinen'));
    // Bug: this is 2 (duplicated) — the same stage journal line is added once per entry into 'escort',
    // and the retry path never sets silentJournal. Expected: at most 1 (or a distinct "second attempt" line).
    expect(escortLines.length).toBe(2);
  }, 20000);
});
