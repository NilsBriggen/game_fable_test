/**
 * Bug-hunt probe (jsdom): does the Escape key stack the Pause menu on top of the game-over screen?
 *
 * `src/ui/index.ts`'s window keydown handler treats 'gameover' the same as 'explore'/'combat' — pressing
 * Escape while `currentMenu` is null calls `openMenu('pause')` regardless of state (index.ts:139).
 * `openMenu()` only *requests* the `paused` state transition when `ctx.state.can('paused')` is true
 * (index.ts:49); from `gameover` that's false (state.ts: `gameover: ['title', 'loading']`), so the state
 * stays 'gameover' — but `renderMenu(menuApi, menu, data)` on the next line runs unconditionally, so the
 * Pause modal (`.eid-modal-wrap`, z-index 100) is drawn anyway, on top of the still-visible `.gameover-root`
 * panel (z-index 90, never hidden by `openMenu`). Two full-screen "you lost" surfaces end up stacked.
 *
 * This constructs `register()`'s real dependencies (GameStateMachine, EventBus, ServiceRegistry,
 * ContentRegistry) but stubs the WebGL-requiring pieces (`ctx.gfx`, `ctx.canvas`) since nothing here
 * renders a frame — only DOM wiring is exercised. Uses `@vitest-environment jsdom` (not the project's
 * default 'node' probe environment) because this specific defect is only observable in the DOM tree.
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { PerspectiveCamera } from 'three';
import { register } from '../../../../src/ui/index';
import { GameStateMachine } from '../../../../src/core/state';
import { EventBus } from '../../../../src/core/events';
import { ServiceRegistry } from '../../../../src/core/services';
import { ContentRegistry } from '../../../../src/core/content';
import type { GameContext } from '../../../../src/core/context';

function makeCtx(): GameContext {
  const canvas = document.createElement('canvas');
  const uiRoot = document.createElement('div');
  document.body.appendChild(uiRoot);
  const ctx = {
    world: { get: () => undefined },
    events: new EventBus<any>(),
    services: new ServiceRegistry(),
    state: new GameStateMachine(),
    content: new ContentRegistry(),
    settings: { quality: 'high', shadowRes: 2048, renderScale: 1, viewDistance: 4000, showFps: false, invertY: false, masterVolume: 0.8, language: 'en' },
    applySettings: () => {},
    canvas,
    uiRoot,
    gfx: { camera: new PerspectiveCamera() },
  } as unknown as GameContext;
  return ctx;
}

describe('BUG: Escape opens Pause over the game-over screen', () => {
  let ctx: GameContext;

  beforeEach(async () => {
    ctx = makeCtx();
    await register(ctx);
    // boot -> explore -> gameover (both legal single hops per state.ts)
    ctx.state.transition('explore');
    ctx.state.transition('gameover');
  });

  it('game-over screen is up and Pause is not', () => {
    const gameoverRoot = document.querySelector('.gameover-root') as HTMLElement;
    expect(gameoverRoot).toBeTruthy();
    expect(gameoverRoot.style.display).not.toBe('none');
    expect(document.querySelector('.eid-modal-wrap')).toBeNull();
  });

  it('DEFECT: pressing Escape draws the Pause modal on top of the still-visible game-over screen', () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

    const gameoverRoot = document.querySelector('.gameover-root') as HTMLElement;
    const pauseWrap = document.querySelector('.eid-modal-wrap');
    // both are simultaneously in the visible DOM tree — the actual bug
    expect(gameoverRoot).toBeTruthy();
    expect(gameoverRoot.style.display).not.toBe('none');
    expect(pauseWrap).toBeTruthy();
    expect(pauseWrap?.textContent).toContain('Paused');
    // state itself never left gameover (the transition request was correctly rejected) —
    // it's only the *render* that ignored the rejection
    expect(ctx.state.state).toBe('gameover');
  });
});
