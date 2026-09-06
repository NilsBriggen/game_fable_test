/** 4.1 combat-feel: hit flash, outcome callouts, damage shake — headless tests with fakes.
 *  CombatRenderer is built via Object.create (constructor needs a real canvas/Graphics/location);
 *  only the feel paths under test touch the faked fields. */
import { describe, it, expect, beforeAll } from 'vitest';
import { Group, Mesh } from 'three';
import { CombatRenderer } from './render';

// makeTextSprite needs a canvas 2d context; stub document before any sprite path runs.
beforeAll(() => {
  if (typeof document === 'undefined') {
    const fakeCtx2d = { font: '', textAlign: '', fillStyle: '', fillText() {}, fillRect() {} };
    (globalThis as Record<string, unknown>).document = {
      createElement: () => ({ width: 0, height: 0, getContext: () => fakeCtx2d }),
    };
  }
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRenderer = any;

function makeRenderer(overrides: {
  settings?: Record<string, unknown>;
  explorationRig?: { shake: (n: number) => void } | undefined;
}): { renderer: CombatRenderer; priv: AnyRenderer; shakeSpy: { calls: number[] } } {
  const shakeSpy = { calls: [] as number[] };
  const rig = overrides.explorationRig ?? { shake: (n: number) => { shakeSpy.calls.push(n); } };
  const fakeCtx = {
    settings: overrides.settings ?? {},
    services: { tryGet: (name: string) => (name === 'exploration' ? { getCameraRig: () => rig } : undefined) },
  };
  const renderer = Object.create(CombatRenderer.prototype) as CombatRenderer;
  const priv: AnyRenderer = renderer as unknown as AnyRenderer;
  priv.ctx = fakeCtx;
  priv.root = new Group();
  priv.unitGroup = new Group();
  priv.highlightGroup = new Group();
  priv.terrainGroup = new Group();
  priv.root.add(priv.unitGroup, priv.highlightGroup, priv.terrainGroup);
  priv.unitMeshes = new Map<number, Group>();
  priv.unitHandles = new Map();
  priv.unitPose = new Map<number, string>();
  priv.moving = new Map();
  priv.damagePops = [];
  priv.flashes = new Map();
  priv.grid = null;
  return { renderer, priv, shakeSpy };
}

function addUnit(priv: AnyRenderer, id: number): Group {
  const mesh = new Group();
  mesh.position.set(id * 2, 0, 0);
  priv.unitGroup.add(mesh);
  priv.unitMeshes.set(id, mesh);
  priv.unitPose.set(id, 'up');
  return mesh;
}

describe('hit flash lifecycle', () => {
  it('flashUnit adds a per-unit overlay shell and tick() decays and disposes it', () => {
    const { renderer, priv } = makeRenderer({});
    const mesh = addUnit(priv, 1);
    renderer.flashUnit(1);
    expect(priv.flashes.size).toBe(1);
    const overlay = mesh.children.find((c) => c instanceof Mesh);
    expect(overlay).toBeDefined();
    // mid-life: opacity decayed but overlay still attached
    renderer.tick(0.1);
    expect(priv.flashes.size).toBe(1);
    expect(mesh.children.includes(overlay as Mesh)).toBe(true);
    // past life: removed from the unit and disposed
    renderer.tick(1.0);
    expect(priv.flashes.size).toBe(0);
    expect(mesh.children.includes(overlay as Mesh)).toBe(false);
  });

  it('re-hitting refreshes the same overlay instead of stacking meshes', () => {
    const { renderer, priv } = makeRenderer({});
    const mesh = addUnit(priv, 1);
    renderer.flashUnit(1);
    renderer.tick(0.1);
    renderer.flashUnit(1);
    const overlays = mesh.children.filter((c) => c instanceof Mesh);
    expect(overlays.length).toBe(1);
    expect(priv.flashes.size).toBe(1);
  });

  it('blocked variant uses the dimmer short flash', () => {
    const { renderer, priv } = makeRenderer({});
    addUnit(priv, 2);
    renderer.flashUnit(2, true);
    const f = priv.flashes.get(2) as { life: number; maxLife: number };
    expect(f.maxLife).toBeLessThan(0.28);
    expect(f.life).toBe(f.maxLife);
  });

  it('reducedMotion disables the flash entirely', () => {
    const { renderer, priv } = makeRenderer({ settings: { reducedMotion: true } });
    addUnit(priv, 1);
    renderer.flashUnit(1);
    expect(priv.flashes.size).toBe(0);
  });

  it('removeUnit path (clearAfterEnd) disposes a live flash', () => {
    const { renderer, priv } = makeRenderer({});
    addUnit(priv, 1);
    addUnit(priv, 2);
    renderer.flashUnit(1);
    expect(priv.flashes.size).toBe(1);
    renderer.clearAfterEnd();
    expect(priv.flashes.size).toBe(0);
    expect(priv.unitMeshes.size).toBe(0);
  });
});

describe('damage shake wiring', () => {
  it('onEvent damage shakes proportionally to amount, capped', () => {
    const { renderer, priv, shakeSpy } = makeRenderer({});
    addUnit(priv, 7);
    renderer.onEvent({ kind: 'damage', unit: 7, text: 'takes 12 cut damage.', data: { amount: 12, target: 7 } });
    expect(shakeSpy.calls.length).toBe(1);
    expect(shakeSpy.calls[0]).toBeCloseTo(Math.min(0.6, 12 * 0.045), 5);
    // a huge hit caps rather than scaling unboundedly
    renderer.onEvent({ kind: 'damage', unit: 7, text: 'takes 99 cut damage.', data: { amount: 99, target: 7 } });
    expect(shakeSpy.calls[1]).toBeCloseTo(0.6, 5);
  });

  it('reducedMotion disables shake; amount<=0 never shakes', () => {
    const { renderer, priv, shakeSpy } = makeRenderer({ settings: { reducedMotion: true } });
    addUnit(priv, 7);
    renderer.onEvent({ kind: 'damage', unit: 7, text: 'takes 5.', data: { amount: 5, target: 7 } });
    expect(shakeSpy.calls.length).toBe(0);
    const full = makeRenderer({});
    addUnit(full.priv, 7);
    full.renderer.onEvent({ kind: 'damage', unit: 7, text: 'heals.', data: { amount: -3, target: 7 } });
    expect(full.shakeSpy.calls.length).toBe(0);
  });

  it('missing rig (no exploration service) does not throw', () => {
    const fakeCtx = { settings: {}, services: { tryGet: () => undefined } };
    const renderer = Object.create(CombatRenderer.prototype) as CombatRenderer;
    const priv: AnyRenderer = renderer as unknown as AnyRenderer;
    priv.ctx = fakeCtx;
    expect(() => renderer.shakeForDamage(5)).not.toThrow();
  });
});

describe('outcome callouts (attack roll only — no engine plumbing)', () => {
  it('miss attack spawns a grey "miss" pop over the defender', () => {
    const { renderer, priv } = makeRenderer({});
    addUnit(priv, 1);
    addUnit(priv, 2);
    renderer.onEvent({
      kind: 'attack', unit: 1, text: 'A attacks B: miss.',
      data: { target: 2, roll: { hit: false, damage: 0 } },
    });
    expect(priv.damagePops.length).toBe(1);
  });

  it('fully-soaked hit spawns "blocked" plus the dim flash', () => {
    const { renderer, priv } = makeRenderer({});
    addUnit(priv, 1);
    addUnit(priv, 2);
    renderer.onEvent({
      kind: 'attack', unit: 1, text: 'A attacks B: hit.',
      data: { target: 2, roll: { hit: true, damage: 0 } },
    });
    expect(priv.damagePops.length).toBe(1);
    expect(priv.flashes.size).toBe(1);
  });

  it('normal damaging hit spawns no callout (damage pop path owns it)', () => {
    const { renderer, priv } = makeRenderer({});
    addUnit(priv, 1);
    addUnit(priv, 2);
    renderer.onEvent({
      kind: 'attack', unit: 1, text: 'A attacks B: hit.',
      data: { target: 2, roll: { hit: true, damage: 6 } },
    });
    expect(priv.damagePops.length).toBe(0);
  });

  it('callout pops decay through the shared damage-pop lifecycle', () => {
    const { renderer, priv } = makeRenderer({});
    addUnit(priv, 2);
    renderer.spawnOutcomeCallout(2, 'miss');
    expect(priv.damagePops.length).toBe(1);
    renderer.tick(0.5);
    expect(priv.damagePops.length).toBe(1);
    renderer.tick(0.5);
    expect(priv.damagePops.length).toBe(0);
  });

  it('spawnDamageNumber lifecycle unchanged (maxLife-scaled fade)', () => {
    const { renderer, priv } = makeRenderer({});
    priv.grid = null;
    renderer.spawnDamageNumber({ q: 0, r: 0 }, 5);
    expect(priv.damagePops.length).toBe(1);
    renderer.tick(1.2);
    expect(priv.damagePops.length).toBe(0);
  });
});
