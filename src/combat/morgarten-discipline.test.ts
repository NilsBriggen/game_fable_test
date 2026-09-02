import { describe, it, expect } from 'vitest';
import { World } from '@core/ecs';
import { Rng } from '@core/rng';
import { CombatEngineImpl, type CombatHost } from './engine';
import { FakePartyService, makeTestContent } from './testUtils';

async function runOnce(seed: number, charger: boolean): Promise<{ outcome: string; rounds: number }> {
  const world = new World();
  const content = makeTestContent();
  const party = new FakePartyService(world, content);
  const rng = new Rng(seed);
  const host: CombatHost = { world, content, party, rng };
  const engine = new CombatEngineImpl(host);
  const resultPromise = engine.start('enc.morgarten', {});
  if (charger) {
    // Override every player-side militia unit's doctrine right after deployment, before any turn runs.
    for (const u of engine.unitList()) if (u.side === 'player') (u as unknown as { doctrine: string }).doctrine = 'charger';
  }
  let guard = 0;
  while (engine.isActive() && guard++ < 100) engine.submit({ type: 'auto', rounds: 5 });
  if (engine.isActive()) engine.submit({ type: 'flee' });
  const r = await resultPromise;
  return { outcome: r.outcome, rounds: r.rounds };
}

/**
 * Round-3 critic issue 2: "a reckless human who charges down on round 1 wins Morgarten more often and faster
 * than a disciplined one" (charger 92% vs disciplined 83% before this fix) — because the Habsburg column's
 * own footmen never Braced and the sergeant's Rally never reached anyone. Fixed in `ai.ts`: `footmanAct`
 * Braces against a nearby mounted threat exactly like `waldstaetteAct` does, and `sergeantAct` closes the
 * distance to a shaken/routed ally before Rally-ing instead of only checking who's already adjacent.
 *
 * `chargerAct` (a real, reusable AI doctrine, set here by overriding `u.doctrine` directly — never assigned
 * by `doctrineFor`) reproduces the critic's "charger": every militia unit runs at the nearest enemy from
 * round 1, never Braces, never fires a cache. "Disciplined" is just the normal `waldstaette` doctrine already
 * used everywhere else (`morgarten.test.ts`'s sampler).
 */
describe('disciplined vs charger comparison (round-3 critic item 2)', () => {
  it('disciplined militia beat a reckless charger — disciplined >= 70%, charger <= 50%', async () => {
    const seeds = Array.from({ length: 12 }, (_, i) => 1000 + i * 733);
    let disciplinedWins = 0, chargerWins = 0;
    const dRows: string[] = [], cRows: string[] = [];
    for (const seed of seeds) {
      const d = await runOnce(seed, false);
      if (d.outcome === 'win') disciplinedWins++;
      dRows.push(`${seed}: ${d.outcome} (${d.rounds})`);
      const c = await runOnce(seed, true);
      if (c.outcome === 'win') chargerWins++;
      cRows.push(`${seed}: ${c.outcome} (${c.rounds})`);
    }
    // eslint-disable-next-line no-console
    console.log(`disciplined: ${disciplinedWins}/12 = ${(disciplinedWins / 12 * 100).toFixed(0)}%`);
    // eslint-disable-next-line no-console
    console.log(dRows.join('\n'));
    // eslint-disable-next-line no-console
    console.log(`charger: ${chargerWins}/12 = ${(chargerWins / 12 * 100).toFixed(0)}%`);
    // eslint-disable-next-line no-console
    console.log(cRows.join('\n'));
    expect(disciplinedWins / 12).toBeGreaterThanOrEqual(0.7);
    expect(chargerWins / 12).toBeLessThanOrEqual(0.5);
  }, 60000);
});
