/**
 * Bug-hunt probe (jsdom): the combat "target card" (enemy inspect tooltip, `.cbt-target-card`) is only
 * ever (re)rendered from the canvas `mousemove` handler (`combatUi.ts:363`, inside `onCanvasMouseMove`).
 * `renderAll()` (`combatUi.ts:321-334`, called by both `show()` and `update()` — i.e. on every
 * `CombatStateView` broadcast from the engine) never calls `renderTargetCard`. So once the card is up for
 * a hovered enemy, it keeps showing that enemy's last-known HP/status/Defense through any number of state
 * updates — including the update where that same enemy goes down or dies — until the mouse physically
 * moves again. A player who lands the killing blow and then just watches the log without wiggling the
 * mouse sees a target card for a unit that is no longer there.
 *
 * Uses `@vitest-environment jsdom` (probe config here defaults to 'node') and a real Three.js
 * `PerspectiveCamera` for the screen-projection math `combatUi.ts` performs; `getBoundingClientRect` is
 * stubbed since jsdom lays out nothing.
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
import type { CombatEvents, CombatStateView, CombatantView } from '../../../../src/core/services';

function makeCtx() {
  const canvas = document.createElement('canvas');
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON() { return this; } } as DOMRect);
  const uiRoot = document.createElement('div');
  document.body.appendChild(uiRoot);
  const events = new EventBus<any>();
  const camera = new PerspectiveCamera(50, 800 / 600, 0.1, 2000);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  const ctx = {
    world: { get: () => undefined },
    events,
    services: new ServiceRegistry(),
    state: new GameStateMachine(),
    content: new ContentRegistry(),
    settings: { quality: 'high', shadowRes: 2048, renderScale: 1, viewDistance: 4000, showFps: false, invertY: false, masterVolume: 0.8, language: 'en' },
    applySettings: () => {},
    canvas, uiRoot,
    gfx: { camera },
  } as unknown as GameContext;
  events.on('request-state', (to: any) => ctx.state.transition(to));
  return ctx;
}

function unit(over: Partial<CombatantView>): CombatantView {
  return {
    id: 0 as any, name: '?', side: 'player', q: 0, r: 0, hp: 1, hpMax: 1, morale: 1, moraleMax: 1, initiative: 0,
    ap: { action: true, bonus: true, reaction: true, moveM: 0, moveMax: 0 }, status: [], stance: 'neutral',
    loaded: false, mounted: false, down: false, routed: false, defense: 0, weapon: null, abilities: [],
    formation: { adjacentPolearms: 0, inHaufen: false, defenseBonus: 0 }, isPlayerControlled: false,
    archetype: 'x', attributes: {} as any, ...over,
  };
}

describe('BUG: combat target card is not refreshed on state update, only on mousemove', () => {
  it('DEFECT: a stale "Enemy" target card survives an update() in which that unit goes down', async () => {
    const ctx = makeCtx();
    const combatListeners: Partial<Record<keyof CombatEvents, ((...a: any[]) => void)[]>> = {};
    const fakeCombat = {
      on: (ev: keyof CombatEvents, cb: (...a: any[]) => void) => { (combatListeners[ev] ??= []).push(cb); return () => undefined; },
      cellToWorld: (cell: { q: number; r: number }) => (cell.q === 0 ? { x: 0, y: -1, z: 0 } : { x: 1000, y: -1, z: 0 }),
      previewAttack: () => null,
      previewMove: () => null,
      submit: () => ({ ok: true }),
    };
    ctx.services.register('combat', fakeCombat as any);

    await register(ctx);
    ctx.state.transition('explore');
    ctx.state.transition('combat');

    const active = unit({ id: 7 as any, name: 'Kuoni', side: 'player', q: 5, r: 0, isPlayerControlled: true, abilities: ['ability.strike'] });
    const enemy = unit({ id: 8 as any, name: 'Reisläufer', side: 'enemy', q: 0, r: 0, hp: 12, hpMax: 12 });
    const activeView: CombatStateView = {
      encounterId: 'e', name: 'Skirmish', phase: 'active', round: 1, order: [7 as any, 8 as any], activeUnit: 7 as any,
      units: [active, enemy], grid: { cols: 1, rows: 1, cellM: 1, origin: { x: 0, z: 0, yaw: 0 } }, cells: [],
      objectives: [], log: [], deployZone: { q: 0, r: 0, cols: 1, rows: 1 },
    };
    for (const cb of combatListeners.state ?? []) cb(activeView); // combatUi.show(view)

    // Hover the enemy: world (0,-1,0)+1.0 == (0,0,0) projects to screen centre (400,300) for this camera/rect.
    ctx.canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: 400, clientY: 300, bubbles: true, cancelable: true }));

    const cardBefore = document.querySelector('.cbt-target-card') as HTMLElement;
    expect(cardBefore.style.display).not.toBe('none');
    expect(cardBefore.textContent).toContain('Reisläufer');
    expect(cardBefore.textContent).toContain('12/12');

    // The enemy goes down (killed) — a new state broadcast (update(), not show()) with no further mouse movement.
    const downEnemy = unit({ ...enemy, hp: 0, down: true });
    const nextView: CombatStateView = { ...activeView, units: [active, downEnemy] };
    for (const cb of combatListeners.state ?? []) cb(nextView); // combatUi.update(view)

    const cardAfter = document.querySelector('.cbt-target-card') as HTMLElement;
    // BUG: the card was never told the unit went down — it still shows the pre-death card.
    expect(cardAfter.style.display).not.toBe('none');
    expect(cardAfter.textContent).toContain('Reisläufer');
  });
});
