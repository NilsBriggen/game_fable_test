/** GameContext passed to every module. ARCHITECTURE.md §4. */
import { World, Scheduler } from './ecs';
import { EventBus, type GameEvents } from './events';
import { GameClock } from './clock';
import { RngStreams } from './rng';
import { ServiceRegistry } from './services';
import { GameStateMachine } from './state';
import { ContentRegistry } from './content';
import { Graphics } from './graphics';

export interface Settings {
  quality: 'low' | 'medium' | 'high';
  shadowRes: 1024 | 2048 | 4096;
  renderScale: number;
  viewDistance: number;
  showFps: boolean;
  invertY: boolean;
  masterVolume: number;
  language: 'en';
}

export const defaultSettings = (): Settings => ({
  quality: 'high', shadowRes: 2048, renderScale: 1, viewDistance: 4000, showFps: false, invertY: false, masterVolume: 0.8, language: 'en',
});

export class GameContext {
  world = new World();
  scheduler = new Scheduler();
  events = new EventBus<GameEvents>();
  clock = new GameClock();
  rng: RngStreams;
  services = new ServiceRegistry();
  state = new GameStateMachine();
  content = new ContentRegistry();
  settings: Settings = defaultSettings();
  /** true when running under the harness (?harness=1) */
  harness = false;
  /** canvas element */
  canvas: HTMLCanvasElement;
  /** DOM root for UI */
  uiRoot: HTMLElement;
  /** real-time seconds since boot */
  elapsed = 0;
  /** play time in seconds (excludes menus) */
  playtimeSec = 0;
  /** seed for this playthrough */
  seed: number;
  /** renderer/scene/camera, created by core */
  gfx: Graphics;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement, seed = 1291) {
    this.canvas = canvas;
    this.uiRoot = uiRoot;
    this.seed = seed;
    this.rng = new RngStreams(seed);
    this.gfx = new Graphics(canvas);
  }

  reseed(seed: number): void {
    this.seed = seed;
    this.rng = new RngStreams(seed);
  }

  /** Reset per-playthrough state (new game / load). Keeps services and content. */
  resetWorld(): void {
    this.world.clear();
    this.playtimeSec = 0;
  }
}
