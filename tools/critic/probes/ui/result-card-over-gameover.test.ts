/**
 * Bug-hunt probe (jsdom): on a full-party-wipe loss, the combat result card and the dedicated game-over
 * screen are two independent, un-coordinated full-screen overlays that both end up in the DOM at once.
 *
 * Sequence from `combat/engine.ts`'s `finish()` (reproduced here without the real engine):
 *   1. `emitState()` — combat's `on('state', ...)` handler in `src/ui/index.ts` (:118-121) is already
 *      `shown`, so it calls `combatUi.update(view)`, which renders the Victory/Defeat/Fled card
 *      (`combatUi.ts:303-319`, `.cbt-result`, z-index 95) into the still-visible `#combat-root`.
 *   2. `bus.emit('end', result)` — `src/ui/index.ts:122` calls `combatUi.hideAfterResult()`, which hides
 *      every other combat panel but *keeps* the result card up (it has child nodes).
 *   3. `host.events.emit('request-state', 'gameover')` — `src/ui/index.ts`'s `ctx.state.onChange` listener
 *      (:166-172) calls `showGameOver()`, which shows `.gameover-root` (z-index 90) — a *second*,
 *      independent "you lost" panel, underneath the result card but already in the live DOM.
 *
 * Neither screen is told about the other: `renderResult`'s Continue button (`combatUi.ts:316`) only
 * clears/hides the result card; `showGameOver` is never suppressed when a result card is already up. The
 * player sees "Defeat / Continue", clicks it, and a second "The field is lost" screen appears underneath.
 *
 * Uses `@vitest-environment jsdom` (the shared probe config here defaults to 'node') because the defect is
 * only observable in the DOM tree, and wires a minimal fake `combat` service + the `request-state` bridge
 * that `main.ts` normally provides (out of `src/ui`'s scope, so reproduced by hand here).
 */
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { PerspectiveCamera } from 'three';
import { register } from '../../../../src/ui/index';
import { GameStateMachine } from '../../../../src/core/state';
import { EventBus } from '../../../../src/core/events';
import { ServiceRegistry } from '../../../../src/core/services';
import { ContentRegistry } from '../../../../src/core/content';
import type { GameContext } from '../../../../src/core/context';
import type { CombatEvents, CombatStateView, CombatResult } from '../../../../src/core/services';

function makeCtx() {
  const canvas = document.createElement('canvas');
  const uiRoot = document.createElement('div');
  document.body.appendChild(uiRoot);
  const events = new EventBus<any>();
  const ctx = {
    world: { get: () => undefined },
    events,
    services: new ServiceRegistry(),
    state: new GameStateMachine(),
    content: new ContentRegistry(),
    settings: { quality: 'high', shadowRes: 2048, renderScale: 1, viewDistance: 4000, showFps: false, invertY: false, masterVolume: 0.8, language: 'en' },
    applySettings: () => {},
    canvas,
    uiRoot,
    gfx: { camera: new PerspectiveCamera() },
  } as unknown as GameContext;
  // main.ts:43 — the bridge from 'request-state' to the real state machine; ui/index.ts assumes it exists.
  events.on('request-state', (to: any) => ctx.state.transition(to));
  return ctx;
}

describe('BUG: combat result card stacks with the game-over screen', () => {
  it('DEFECT: both .cbt-result and .gameover-root are visible together after a full-wipe loss', async () => {
    const ctx = makeCtx();
    const combatListeners: Partial<Record<keyof CombatEvents, ((...a: any[]) => void)[]>> = {};
    const fakeCombat = {
      on: (ev: keyof CombatEvents, cb: (...a: any[]) => void) => {
        (combatListeners[ev] ??= []).push(cb);
        return () => undefined;
      },
    };
    ctx.services.register('combat', fakeCombat as any);

    await register(ctx);
    ctx.state.transition('explore');
    ctx.state.transition('combat');

    const result: CombatResult = { outcome: 'lose', rounds: 3, downed: [], dead: [1 as any], xp: {} as any, loot: [], log: ['The company is overrun.'] };
    const endedView: CombatStateView = {
      encounterId: 'e', name: 'Ambush', phase: 'ended', round: 3, order: [], activeUnit: null, units: [],
      grid: { cols: 1, rows: 1, cellM: 1, origin: { x: 0, z: 0, yaw: 0 } }, cells: [], objectives: [], log: [],
      deployZone: { q: 0, r: 0, cols: 1, rows: 1 }, result,
    };

    // 1. emitState() with the final ('ended') view — first call, so combatUi.show() renders the result card.
    for (const cb of combatListeners.state ?? []) cb(endedView);
    // 2. bus.emit('end', result) — hides the rest of the combat HUD, keeps the result card.
    for (const cb of combatListeners.end ?? []) cb(result);
    // 3. engine.ts:657 — full wipe -> request-state('gameover').
    ctx.events.emit('request-state', 'gameover');

    const resultCard = document.querySelector('.cbt-result');
    const gameoverRoot = document.querySelector('.gameover-root') as HTMLElement | null;
    expect(resultCard).toBeTruthy();
    expect(resultCard?.textContent).toContain('Defeat');
    expect(gameoverRoot).toBeTruthy();
    expect(gameoverRoot?.style.display).not.toBe('none'); // both up at once — the bug
    expect(ctx.state.state).toBe('gameover');
  });
});
