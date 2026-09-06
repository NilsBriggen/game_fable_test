import { describe, it, expect } from 'vitest';
import { World } from '@core/ecs';
import { Rng } from '@core/rng';
import { CombatEngineImpl, type CombatHost } from './engine';
import { FakePartyService, makeTestContent } from './testUtils';

/**
 * 3.6 Brunnen balance: enc.brunnen-quay is the combat tutorial (2v2, defeat-all) and must be
 * AI-winnable — both headless playthroughs needed a harness-assist concede at round 28 because the
 * escort AI lost every auto-run. Samples AI-vs-AI across seeds and asserts a real win rate.
 * 'fled' counts as unresolved (stalemate backstop), not a win: the quest's fled branch still advances
 * the story, but the balance bar is outright wins.
 */
async function runBrunnenOnce(seed: number): Promise<{ outcome: string; rounds: number }> {
  const world = new World();
  const content = makeTestContent();
  const party = new FakePartyService(world, content);
  const rng = new Rng(seed);
  const host: CombatHost = { world, content, party, rng };
  const engine = new CombatEngineImpl(host);
  const resultPromise = engine.start('enc.brunnen-quay', {});
  let guard = 0;
  while (engine.isActive() && guard++ < 40) engine.submit({ type: 'auto', rounds: 5 });
  if (engine.isActive()) engine.submit({ type: 'flee' });
  const r = await resultPromise;
  return { outcome: r.outcome, rounds: r.rounds };
}

describe('Brunnen AI-vs-AI winnability (3.6)', () => {
  it('the escort AI wins a real share of tutorial fights without assistance', async () => {
    const seeds = Array.from({ length: 12 }, (_, i) => 5000 + i * 977);
    let wins = 0;
    const rows: string[] = [];
    for (const seed of seeds) {
      const r = await runBrunnenOnce(seed);
      if (r.outcome === 'win') wins++;
      rows.push(`seed=${seed}: ${r.outcome} (round ${r.rounds})`);
    }
    // eslint-disable-next-line no-console
    console.log(`Brunnen win ratio: ${wins}/${seeds.length}\n${rows.join('\n')}`);
    expect(wins / seeds.length).toBeGreaterThanOrEqual(0.5);
  }, 60000);
});
