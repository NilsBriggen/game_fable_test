/**
 * Minimal structural view of `GameContext` used by the save module.
 * Tests build a plain object satisfying this interface instead of constructing a real
 * `GameContext` (which owns a WebGLRenderer and cannot run headless in Node/vitest).
 * `GameContext` satisfies this interface structurally — no adapter code is needed at the call site.
 */
import type { World } from '@core/ecs';
import type { RngStreams } from '@core/rng';
import type { GameClock } from '@core/clock';
import type { EventBus, GameEvents } from '@core/events';
import type { ServiceRegistry } from '@core/services';

/** Just enough of `Graphics` to grab a thumbnail; keeps this module decoupled from three.js. */
export interface GfxLike {
  renderer: { domElement: HTMLCanvasElement };
}

export interface SaveHost {
  world: World;
  rng: RngStreams;
  clock: GameClock;
  events: EventBus<GameEvents>;
  services: ServiceRegistry;
  /** current game-state machine state, e.g. 'explore' | 'combat' | ... */
  state: { readonly state: string };
  seed: number;
  playtimeSec: number;
  reseed(seed: number): void;
  resetWorld(): void;
  /** absent in headless/test hosts; thumbnail capture is skipped when missing */
  gfx?: GfxLike;
}
