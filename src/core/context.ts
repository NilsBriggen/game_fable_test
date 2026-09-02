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

const SETTINGS_KEY = 'eidgenossen.settings';
export function loadSettings(): Settings {
  const base = defaultSettings();
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(SETTINGS_KEY) : null;
    return raw ? { ...base, ...(JSON.parse(raw) as Partial<Settings>) } : base;
  } catch { return base; }
}
export function saveSettings(s: Settings): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* private mode */ }
}

export class GameContext {
  world = new World();
  scheduler = new Scheduler();
  events = new EventBus<GameEvents>();
  clock = new GameClock();
  rng: RngStreams;
  services = new ServiceRegistry();
  state = new GameStateMachine();
  content = new ContentRegistry();
  settings: Settings = loadSettings();
  private settingsListeners: ((s: Settings) => void)[] = [];
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

  /** Apply + persist settings; modules subscribe to react (render scale is applied here by core). */
  applySettings(patch: Partial<Settings>): void {
    Object.assign(this.settings, patch);
    saveSettings(this.settings);
    this.gfx.renderScale = this.settings.renderScale;
    this.gfx.resize();
    for (const l of this.settingsListeners) l(this.settings);
  }
  onSettings(cb: (s: Settings) => void): () => void {
    this.settingsListeners.push(cb);
    return () => { this.settingsListeners = this.settingsListeners.filter((x) => x !== cb); };
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
