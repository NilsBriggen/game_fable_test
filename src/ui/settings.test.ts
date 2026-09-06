/** 4.4 + 4.2: settings persist to localStorage and reload; panel exposes the four new controls. */
/** 5.5: clamping matrix, detectSettings tiers, ensureAutoSettings, showFps round-trip + UI row. */
import { describe, it, expect } from 'vitest';
import { defaultSettings, loadSettings, saveSettings, detectSettings, ensureAutoSettings, GameContext } from '@core/context';
import { renderSettings } from './menus';

function stubLocalStorage(map: Map<string, string>): () => void {
  const orig = (globalThis as { localStorage?: Storage }).localStorage;
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, String(v)); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  } as Storage;
  return () => { (globalThis as { localStorage?: Storage }).localStorage = orig; };
}

describe('settings persistence (4.4 + 4.2)', () => {
  it('saveSettings → loadSettings round-trips difficulty/fontScale/reducedMotion/highContrast', () => {
    const map = new Map<string, string>();
    const restore = stubLocalStorage(map);
    try {
      const s = {
        ...defaultSettings(),
        difficulty: 'hard' as const,
        fontScale: 1.2,
        reducedMotion: true,
        highContrast: true,
      };
      saveSettings(s);
      expect(map.has('eidgenossen.settings')).toBe(true);
      const reloaded = loadSettings();
      expect(reloaded.difficulty).toBe('hard');
      expect(reloaded.fontScale).toBe(1.2);
      expect(reloaded.reducedMotion).toBe(true);
      expect(reloaded.highContrast).toBe(true);
    } finally {
      restore();
    }
  });
});

describe('renderSettings panel (4.4 + 4.2)', () => {
  it('exposes difficulty select, font slider, and two checkboxes wired to applySettings', () => {
    // Minimal DOM stub (node env has no jsdom): createElement/TextNode/appendChild only.
    type El = {
      tag: string; attrs: Record<string, unknown>; children: unknown[]; textContent: string | null;
      appendChild(c: unknown): unknown; addEventListener(t: string, fn: (e: unknown) => void): void;
      setAttribute(k: string, v: string): void;
    };
    const listeners = new Map<object, Map<string, (e: unknown) => void>>();
    const mkEl = (tag: string): El => {
      const e: El = {
        tag, attrs: {}, children: [], textContent: null,
        appendChild(c: unknown) { e.children.push(c); return c; },
        addEventListener(t: string, fn: (e: unknown) => void) {
          let m = listeners.get(e);
          if (!m) { m = new Map(); listeners.set(e, m); }
          m.set(t, fn);
        },
        setAttribute(k: string, v: string) { e.attrs[k] = v; },
      };
      return e;
    };
    const docStub = {
      createElement: (tag: string) => mkEl(tag),
      createTextNode: (t: string) => ({ text: t }),
    };
    const origDoc = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = docStub;
    try {
      const applied: Record<string, unknown>[] = [];
      const settings = { ...defaultSettings() };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ctx = {
        settings,
        applySettings(patch: Record<string, unknown>) {
          Object.assign(settings, patch);
          applied.push(patch);
        },
      };
      const root = mkEl('div');
      const api = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ctx: ctx as any,
        root: root as never,
        openMenu() {}, closeMenu() {}, closeAll() {},
      };
      renderSettings(api);
      // Walk the stub tree for the four new controls.
      const found: El[] = [];
      const walk = (n: unknown): void => {
        if (!n || typeof n !== 'object') return;
        const e = n as El;
        if (e.tag === 'select' || e.tag === 'input') found.push(e);
        for (const c of e.children ?? []) walk(c);
      };
      walk(root);
      const fire = (e: El, type: string, target: unknown): void => {
        listeners.get(e)?.get(type)?.({ target });
      };
      const selects = found.filter((e) => e.tag === 'select');
      const inputs = found.filter((e) => e.tag === 'input');
      // difficulty select: last select (after quality/shadow/language)
      const diffSelect = selects[selects.length - 1];
      fire(diffSelect, 'change', { value: 'story' });
      expect(applied.some((p) => p.difficulty === 'story')).toBe(true);
      // font slider: a range input with min 0.85
      const font = inputs.find((e) => e.attrs.type === 'range' && (e.attrs as Record<string, unknown>).min === '0.85');
      expect(font).toBeDefined();
      fire(font!, 'change', { value: '1.15' });
      expect(applied.some((p) => p.fontScale === 1.15)).toBe(true);
      // two checkboxes → reducedMotion + highContrast
      const boxes = inputs.filter((e) => e.attrs.type === 'checkbox');
      expect(boxes.length).toBeGreaterThanOrEqual(3); // invertY + 2 new
      fire(boxes[boxes.length - 2], 'change', { checked: true });
      fire(boxes[boxes.length - 1], 'change', { checked: true });
      expect(applied.some((p) => p.reducedMotion === true)).toBe(true);
      expect(applied.some((p) => p.highContrast === true)).toBe(true);
    } finally {
      (globalThis as { document?: unknown }).document = origDoc;
    }
  });
});

// ==================== 5.5 ====================

function loadWithRaw(raw: unknown): ReturnType<typeof loadSettings> {
  const map = new Map<string, string>([['eidgenossen.settings', JSON.stringify(raw)]]);
  const restore = stubLocalStorage(map);
  try {
    return loadSettings();
  } finally {
    restore();
  }
}

describe('5.5 loadSettings clamp matrix', () => {
  it("drops quality 'ultra' → default", () => {
    expect(loadWithRaw({ quality: 'ultra' }).quality).toBe(defaultSettings().quality);
  });
  it('drops shadowRes 999 → default', () => {
    expect(loadWithRaw({ shadowRes: 999 }).shadowRes).toBe(defaultSettings().shadowRes);
  });
  it('drops renderScale NaN → default', () => {
    // JSON.stringify(NaN) → null, so inject via a raw string to preserve NaN marker.
    const map = new Map<string, string>([['eidgenossen.settings', '{"renderScale":NaN}']]);
    // Invalid JSON falls back to base — also acceptable clamping; test the parsed-null path too.
    const restore = stubLocalStorage(map);
    try {
      expect(loadSettings().renderScale).toBe(defaultSettings().renderScale);
    } finally {
      restore();
    }
    expect(loadWithRaw({ renderScale: 'big' }).renderScale).toBe(defaultSettings().renderScale);
  });
  it('drops viewDistance -1 → default', () => {
    expect(loadWithRaw({ viewDistance: -1 }).viewDistance).toBe(defaultSettings().viewDistance);
  });
  it('drops string booleans / out-of-range volume → defaults', () => {
    const s = loadWithRaw({ invertY: 'yes', showFps: '1', masterVolume: 2 });
    const d = defaultSettings();
    expect(s.invertY).toBe(d.invertY);
    expect(s.showFps).toBe(d.showFps);
    expect(s.masterVolume).toBe(d.masterVolume);
  });
  it('applySettings clamps programmatic ultra/999/NaN patches', () => {
    const map = new Map<string, string>();
    const restore = stubLocalStorage(map);
    try {
      const fake = {
        settings: { ...defaultSettings() },
        gfx: { renderScale: 1, resize() {} },
        settingsListeners: [] as ((s: unknown) => void)[],
      };
      GameContext.prototype.applySettings.call(
        fake as never,
        { quality: 'ultra', shadowRes: 999, renderScale: NaN, viewDistance: -1, masterVolume: 5 } as never,
      );
      const d = defaultSettings();
      expect(fake.settings.quality).toBe(d.quality);
      expect(fake.settings.shadowRes).toBe(d.shadowRes);
      expect(fake.settings.renderScale).toBe(d.renderScale);
      expect(fake.settings.viewDistance).toBe(d.viewDistance);
      expect(fake.settings.masterVolume).toBe(d.masterVolume);
    } finally {
      restore();
    }
  });
});

describe('5.5 detectSettings tiers', () => {
  it('software renderer → low tier', () => {
    expect(detectSettings({ renderer: 'SwiftShader GL', cores: 16, dpr: 1 })).toEqual({
      quality: 'low', shadowRes: 1024, renderScale: 0.75, viewDistance: 2000,
    });
  });
  it('few cores → low tier', () => {
    expect(detectSettings({ cores: 2, dpr: 1 }).quality).toBe('low');
  });
  it('touch-small hidpi → low tier', () => {
    expect(detectSettings({ cores: 6, dpr: 3, touch: true, smallScreen: true }).quality).toBe('low');
  });
  it('8+ cores desktop → high tier', () => {
    expect(detectSettings({ cores: 8, dpr: 1.5, smallScreen: false })).toEqual({
      quality: 'high', shadowRes: 2048, renderScale: 1, viewDistance: 4000,
    });
  });
  it('everything else → medium tier', () => {
    expect(detectSettings({ cores: 6, dpr: 1 })).toEqual({
      quality: 'medium', shadowRes: 1024, renderScale: 0.85, viewDistance: 3000,
    });
  });
});

describe('5.5 ensureAutoSettings', () => {
  it('absent storage → applies detect + returns true', () => {
    const map = new Map<string, string>();
    const restore = stubLocalStorage(map);
    try {
      const settings = { ...defaultSettings() };
      const patches: unknown[] = [];
      const target = { settings, applySettings(p: Partial<typeof settings>) { Object.assign(settings, p); patches.push(p); } };
      expect(ensureAutoSettings(target)).toBe(true);
      expect(patches.length).toBe(1);
      expect(['low', 'medium', 'high']).toContain(settings.quality); // host cores may vary; tier asserted in detectSettings tests
    } finally {
      restore();
    }
  });
  it('present storage → returns false without applying', () => {
    const map = new Map<string, string>([['eidgenossen.settings', JSON.stringify(defaultSettings())]]);
    const restore = stubLocalStorage(map);
    try {
      let calls = 0;
      const target = { settings: { ...defaultSettings() }, applySettings() { calls++; } };
      expect(ensureAutoSettings(target)).toBe(false);
      expect(calls).toBe(0);
    } finally {
      restore();
    }
  });
  it('storage throw → still detects + returns true', () => {
    const orig = (globalThis as { localStorage?: Storage }).localStorage;
    (globalThis as { localStorage?: Storage }).localStorage = {
      getItem() { throw new Error('denied'); },
      setItem() { throw new Error('denied'); },
      removeItem() {}, clear() {}, key: () => null, length: 0,
    } as unknown as Storage;
    try {
      let calls = 0;
      const target = { settings: { ...defaultSettings() }, applySettings() { calls++; } };
      expect(ensureAutoSettings(target)).toBe(true);
      expect(calls).toBe(1);
    } finally {
      (globalThis as { localStorage?: Storage }).localStorage = orig;
    }
  });
});

describe('5.5 showFps', () => {
  it('save/load round-trips showFps', () => {
    const map = new Map<string, string>();
    const restore = stubLocalStorage(map);
    try {
      saveSettings({ ...defaultSettings(), showFps: true });
      expect(loadSettings().showFps).toBe(true);
    } finally {
      restore();
    }
  });
  it('settings panel has a Show FPS checkbox wired to applySettings + Auto-detect button', () => {
    type El = {
      tag: string; attrs: Record<string, unknown>; children: unknown[]; textContent: string | null;
      appendChild(c: unknown): unknown; addEventListener(t: string, fn: (e: unknown) => void): void;
      setAttribute(k: string, v: string): void;
    };
    const listeners = new Map<object, Map<string, (e: unknown) => void>>();
    const mkEl = (tag: string): El => {
      const e = {
        tag, attrs: {} as Record<string, unknown>, children: [] as unknown[], textContent: null as string | null,
        appendChild(c: unknown) { (e.children as unknown[]).push(c); return c; },
        addEventListener(t: string, fn: (e: unknown) => void) {
          let m = listeners.get(e);
          if (!m) { m = new Map(); listeners.set(e, m); }
          m.set(t, fn);
        },
        setAttribute(k: string, v: string) { e.attrs[k] = v; },
      };
      return e;
    };
    const docStub = { createElement: (tag: string) => mkEl(tag), createTextNode: (t: string) => ({ text: t }) };
    const origDoc = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = docStub;
    const map = new Map<string, string>(); // absent → Auto button applies detect
    const restoreStore = stubLocalStorage(map);
    try {
      const applied: Record<string, unknown>[] = [];
      const settings = { ...defaultSettings(), showFps: false };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ctx = { settings, applySettings(patch: Record<string, unknown>) { Object.assign(settings, patch); applied.push(patch); } };
      const root = mkEl('div');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const api = { ctx: ctx as any, root: root as never, openMenu() {}, closeMenu() {}, closeAll() {} };
      renderSettings(api);
      const els: El[] = [];
      const texts: string[] = [];
      const walk = (n: unknown): void => {
        if (!n || typeof n !== 'object') return;
        if ('text' in (n as Record<string, unknown>)) { texts.push(String((n as { text: unknown }).text)); return; }
        const e = n as El;
        els.push(e);
        for (const c of e.children ?? []) walk(c);
      };
      walk(root);
      expect(texts.some((t) => t.includes('Show FPS'))).toBe(true);
      const fire = (e: El, type: string, target: unknown): void => {
        listeners.get(e)?.get(type)?.({ target });
      };
      const boxes = els.filter((e) => e.tag === 'input' && e.attrs.type === 'checkbox');
      expect(boxes.length).toBeGreaterThanOrEqual(4); // invertY + showFps + reducedMotion + highContrast
      for (const b of boxes) fire(b, 'change', { checked: true });
      expect(applied.some((p) => p.showFps === true)).toBe(true);
      const btns = els.filter((e) => e.tag === 'button');
      const auto = btns.find((b) => (b.children as unknown[]).some((c) => (c as { text?: unknown }).text === 'Auto-detect'));
      expect(auto).toBeDefined();
      const before = applied.length;
      fire(auto!, 'click', {});
      expect(applied.length).toBeGreaterThan(before);
    } finally {
      (globalThis as { document?: unknown }).document = origDoc;
      restoreStore();
    }
  });
});
