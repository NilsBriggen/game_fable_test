/**
 * Bug-hunt probe (jsdom): combat's number/Space hotkeys are not gated by whether a menu (e.g. Pause) is
 * open on top of the combat HUD, so they still submit real `CombatCommand`s to the engine while a modal
 * covers the screen.
 *
 * `src/ui/combatUi.ts`'s own `window.addEventListener('keydown', ...)` (:451-463) only bails out on
 * INPUT/TEXTAREA focus and on `root.classList.contains('hidden')` — it never checks `ui.currentMenu()`.
 * Contrast with `src/ui/dialogueUi.ts`'s keyHandler (:104-110), which takes a `menuOpen()` callback for
 * exactly this purpose ("a pause menu over the conversation owns the keyboard", per its own comment) and
 * is wired to it in `src/ui/index.ts:19`. `combatUi`'s keydown handler has no equivalent, and
 * `src/ui/index.ts`'s own top-level keydown handler (:143) returns early for `ctx.state.state === 'paused'`
 * ability/menu hotkeys, but does nothing to stop combatUi's *separate* listener from also firing.
 *
 * Net effect: pause combat (Escape -> Pause modal, `ctx.state` becomes `paused`), then press "1" or Space
 * — the Pause modal is still on screen, but the active unit's ability 1 gets selected / End Turn is
 * submitted to the combat engine underneath it.
 *
 * Uses `@vitest-environment jsdom` (probe config here defaults to 'node'); wires a minimal fake `combat`
 * service (the real engine is out of `src/ui`'s scope) plus the `request-state` bridge `main.ts` normally
 * provides.
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
import type { CombatEvents, CombatStateView, CombatCommand } from '../../../../src/core/services';

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
  events.on('request-state', (to: any) => ctx.state.transition(to)); // main.ts:43 bridge
  return ctx;
}

describe('BUG: combat hotkeys are not gated by an open menu', () => {
  it('DEFECT: pressing Space submits end-turn to the combat engine while the Pause modal is open', async () => {
    const ctx = makeCtx();
    const submitted: CombatCommand[] = [];
    const combatListeners: Partial<Record<keyof CombatEvents, ((...a: any[]) => void)[]>> = {};
    const fakeCombat = {
      on: (ev: keyof CombatEvents, cb: (...a: any[]) => void) => { (combatListeners[ev] ??= []).push(cb); return () => undefined; },
      submit: (cmd: CombatCommand) => { submitted.push(cmd); return { ok: true }; },
    };
    ctx.services.register('combat', fakeCombat as any);

    await register(ctx);
    const ui = ctx.services.get('ui');
    ctx.state.transition('explore');
    ctx.state.transition('combat');

    const view: CombatStateView = {
      encounterId: 'e', name: 'Skirmish', phase: 'active', round: 1, order: [7 as any], activeUnit: 7 as any,
      units: [{
        id: 7 as any, name: 'Kuoni', side: 'player', q: 0, r: 0, hp: 20, hpMax: 20, morale: 40, moraleMax: 40,
        initiative: 10, ap: { action: true, bonus: true, reaction: true, moveM: 9, moveMax: 9 }, status: [],
        stance: 'neutral', loaded: true, mounted: false, down: false, routed: false, defense: 10,
        weapon: null, abilities: ['ability.strike'], formation: { adjacentPolearms: 0, inHaufen: false, defenseBonus: 0 },
        isPlayerControlled: true, archetype: 'player', attributes: {} as any,
      }],
      grid: { cols: 1, rows: 1, cellM: 1, origin: { x: 0, z: 0, yaw: 0 } }, cells: [], objectives: [], log: [],
      deployZone: { q: 0, r: 0, cols: 1, rows: 1 },
    };
    for (const cb of combatListeners.state ?? []) cb(view); // combatUi.show(view)

    // Player opens Pause over the live fight (real flow: Escape -> ui.openMenu('pause')).
    ui.openMenu('pause');
    expect(ctx.state.state).toBe('paused');
    expect(document.querySelector('.eid-modal-wrap')?.textContent).toContain('Paused');

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true, cancelable: true }));

    expect(submitted).toContainEqual({ type: 'end-turn', unit: 7 });
  });
});
