/** GameContext passed to every module. ARCHITECTURE.md §4. */
import { World, Scheduler } from './ecs';
import { EventBus, type GameEvents } from './events';
import { GameClock } from './clock';
import { RngStreams } from './rng';
import { ServiceRegistry } from './services';
import { GameStateMachine } from './state';
import { ContentRegistry } from './content';
import { Graphics } from './graphics';
import type { LocaleId } from './i18n';
import { isLocaleId } from './i18n';

export type Difficulty = 'story' | 'normal' | 'hard';

/** Tolerant guard: unknown values (old saves, hand-edited storage) fall back to a default, never crash. */
export function isDifficulty(v: unknown): v is Difficulty {
  return v === 'story' || v === 'normal' || v === 'hard';
}

export interface Settings {
  quality: 'low' | 'medium' | 'high';
  shadowRes: 1024 | 2048 | 4096;
  renderScale: number;
  viewDistance: number;
  showFps: boolean;
  invertY: boolean;
  masterVolume: number;
  language: LocaleId;
  /** 4.4 difficulty mode. Combat reads it live per encounter; saves record it in metadata. */
  difficulty: Difficulty;
  /** 4.2 groundwork (exposed only — no UI application yet; another agent owns ui.css). */
  fontScale: number;
  /** 4.2 groundwork (exposed only; combat feel already reads this tolerantly via optional access). */
  reducedMotion: boolean;
  /** 4.2 groundwork (exposed only — no UI application yet). */
  highContrast: boolean;
  /** Voice-line playback (§1.7): pre-generated dialogue/cutscene audio. Disabled = silent, text remains. */
  voicesEnabled: boolean;
}

export const defaultSettings = (): Settings => ({
  quality: 'high', shadowRes: 2048, renderScale: 1, viewDistance: 4000, showFps: false, invertY: false, masterVolume: 0.8, language: 'en',
  difficulty: 'normal', fontScale: 1, reducedMotion: false, highContrast: false, voicesEnabled: true,
});

const SETTINGS_KEY = 'eidgenossen.settings';

/** Clamp/normalize a parsed fragment: delete invalid fields so defaults fill in. */
function sanitizeSettingsFragment(parsed: Partial<Settings>): void {
  if (parsed.quality !== 'low' && parsed.quality !== 'medium' && parsed.quality !== 'high') delete parsed.quality;
  if (parsed.shadowRes !== 1024 && parsed.shadowRes !== 2048 && parsed.shadowRes !== 4096) delete parsed.shadowRes;
  if (typeof parsed.renderScale !== 'number' || !Number.isFinite(parsed.renderScale) || parsed.renderScale < 0.5 || parsed.renderScale > 2) delete parsed.renderScale;
  if (typeof parsed.viewDistance !== 'number' || !Number.isFinite(parsed.viewDistance) || parsed.viewDistance < 500 || parsed.viewDistance > 8000) delete parsed.viewDistance;
  if (typeof parsed.showFps !== 'boolean') delete parsed.showFps;
  if (typeof parsed.invertY !== 'boolean') delete parsed.invertY;
  if (typeof parsed.masterVolume !== 'number' || !Number.isFinite(parsed.masterVolume) || parsed.masterVolume < 0 || parsed.masterVolume > 1) delete parsed.masterVolume;
  if (!isLocaleId(parsed.language)) delete parsed.language;
  if (!isDifficulty(parsed.difficulty)) delete parsed.difficulty;
  if (typeof parsed.fontScale !== 'number' || !Number.isFinite(parsed.fontScale) || parsed.fontScale <= 0) delete parsed.fontScale;
  if (typeof parsed.reducedMotion !== 'boolean') delete parsed.reducedMotion;
  if (typeof parsed.highContrast !== 'boolean') delete parsed.highContrast;
  if (typeof parsed.voicesEnabled !== 'boolean') delete parsed.voicesEnabled;
}

/** Clamp a fully-merged Settings object in place, falling back to defaults per field. */
function clampMergedSettings(s: Settings, base: Settings = defaultSettings()): void {
  if (s.quality !== 'low' && s.quality !== 'medium' && s.quality !== 'high') s.quality = base.quality;
  if (s.shadowRes !== 1024 && s.shadowRes !== 2048 && s.shadowRes !== 4096) s.shadowRes = base.shadowRes;
  if (typeof s.renderScale !== 'number' || !Number.isFinite(s.renderScale) || s.renderScale < 0.5 || s.renderScale > 2) s.renderScale = base.renderScale;
  if (typeof s.viewDistance !== 'number' || !Number.isFinite(s.viewDistance) || s.viewDistance < 500 || s.viewDistance > 8000) s.viewDistance = base.viewDistance;
  if (typeof s.showFps !== 'boolean') s.showFps = base.showFps;
  if (typeof s.invertY !== 'boolean') s.invertY = base.invertY;
  if (typeof s.masterVolume !== 'number' || !Number.isFinite(s.masterVolume) || s.masterVolume < 0 || s.masterVolume > 1) s.masterVolume = base.masterVolume;
  if (!isLocaleId(s.language)) s.language = base.language;
  if (!isDifficulty(s.difficulty)) s.difficulty = base.difficulty;
  if (typeof s.fontScale !== 'number' || !Number.isFinite(s.fontScale) || s.fontScale <= 0) s.fontScale = base.fontScale;
  if (typeof s.reducedMotion !== 'boolean') s.reducedMotion = base.reducedMotion;
  if (typeof s.highContrast !== 'boolean') s.highContrast = base.highContrast;
  if (typeof s.voicesEnabled !== 'boolean') s.voicesEnabled = base.voicesEnabled;
}

export interface DetectSettingsOpts {
  renderer?: string;
  cores?: number;
  dpr?: number;
  touch?: boolean;
  smallScreen?: boolean;
}

/**
 * 5.5: pure auto-detect. No DOM access; defaults read navigator/window when
 * available (guarded by typeof checks so Node tests can inject everything).
 */
export function detectSettings(opts: DetectSettingsOpts = {}): Partial<Settings> {
  let { renderer, cores, dpr, touch, smallScreen } = opts;
  if (typeof navigator !== 'undefined') {
    const nav = navigator as Navigator & { hardwareConcurrency?: unknown; maxTouchPoints?: unknown };
    if (cores === undefined && typeof nav.hardwareConcurrency === 'number') cores = nav.hardwareConcurrency;
    if (touch === undefined && typeof nav.maxTouchPoints === 'number') touch = nav.maxTouchPoints > 0;
  }
  if (typeof window !== 'undefined') {
    const w = window as Window & { devicePixelRatio?: unknown; innerWidth?: unknown };
    if (dpr === undefined && typeof w.devicePixelRatio === 'number') dpr = w.devicePixelRatio;
    if (smallScreen === undefined && typeof w.innerWidth === 'number') smallScreen = (w.innerWidth as number) < 768;
  }
  if (touch === undefined) touch = false;
  if (smallScreen === undefined) smallScreen = false;

  const lowRenderer = typeof renderer === 'string' && /swiftshader|llvmpipe|software|basic/i.test(renderer);
  const lowCores = typeof cores === 'number' && cores <= 4;
  const lowDpr = touch === true && smallScreen === true && typeof dpr === 'number' && dpr > 2.5;
  if (lowRenderer || lowCores || lowDpr) {
    return { quality: 'low', shadowRes: 1024, renderScale: 0.75, viewDistance: 2000 };
  }
  if (typeof cores === 'number' && cores >= 8 && typeof dpr === 'number' && dpr <= 2 && !smallScreen) {
    return { quality: 'high', shadowRes: 2048, renderScale: 1, viewDistance: 4000 };
  }
  return { quality: 'medium', shadowRes: 1024, renderScale: 0.85, viewDistance: 3000 };
}

/** Minimal structural interface to avoid importing GameContext (prevent cycles). */
export interface AutoSettingsTarget {
  settings: Settings;
  applySettings(p: Partial<Settings>): void;
}

/**
 * 5.5: apply detectSettings() only when no persisted settings exist.
 * Absent (getItem → null) → apply + return true; present → return false;
 * storage throw / no localStorage → still detect + apply, return true.
 */
export function ensureAutoSettings(target: AutoSettingsTarget): boolean {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(SETTINGS_KEY) : null;
    if (raw !== null) return false;
  } catch {
    target.applySettings(detectSettings());
    return true;
  }
  target.applySettings(detectSettings());
  return true;
}
export function loadSettings(): Settings {
  const base = defaultSettings();
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(SETTINGS_KEY) : null;
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    sanitizeSettingsFragment(parsed);
    return { ...base, ...parsed };
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
    clampMergedSettings(this.settings);
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
