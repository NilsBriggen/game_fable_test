/** CombatRenderer handle lifecycle — headless tests with fakes.
 * Built via Object.create (constructor needs real canvas/Graphics/location);
 * only the handle paths under test touch the faked fields. */
import { describe, it, expect, beforeAll } from 'vitest';
import { Group } from 'three';
import { CombatRenderer, registerCombatModels } from './render';

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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyWorld = any;

function makeRenderer(): { renderer: CombatRenderer; priv: AnyRenderer } {
  const fakeCtx = {
    settings: {},
    services: { tryGet: () => undefined },
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
  return { renderer, priv };
}

function addUnit(priv: AnyRenderer, id: number): Group {
  const mesh = new Group();
  mesh.position.set(id * 2, 0, 0);
  priv.unitGroup.add(mesh);
  priv.unitMeshes.set(id, mesh);
  priv.unitPose.set(id, 'up');
  return mesh;
}

describe('registerCombatModels respects first-register-wins', () => {
  it('skips registration when models already exist, registers 24 ids otherwise', () => {
    let registerCalls = 0;
    const present: AnyWorld = {
      hasModel: () => true,
      registerModel: () => { registerCalls += 1; throw new Error('must not register when present'); },
    };
    registerCombatModels(present);
    expect(registerCalls).toBe(0);

    const ids: string[] = [];
    const absent: AnyWorld = {
      hasModel: () => false,
      registerModel: (id: string) => { ids.push(id); },
    };
    registerCombatModels(absent);
    expect(ids.length).toBe(24);
    expect(ids).toContain('char.habsburg-knight');
    expect(ids).toContain('char.player');
  });
});

describe('unit handle disposal', () => {
  it('removeUnit disposes the rigged handle', () => {
    const { renderer, priv } = makeRenderer();
    addUnit(priv, 5);
    let disposeCalls = 0;
    priv.unitHandles.set(5, { dispose: () => { disposeCalls += 1; } });
    renderer.clearAfterEnd();
    expect(disposeCalls).toBe(1);
    expect(priv.unitHandles.size).toBe(0);
    expect(priv.unitMeshes.size).toBe(0);
  });

  it('clearAfterEnd on empty renderer does not throw and leaves maps empty', () => {
    const { renderer, priv } = makeRenderer();
    expect(() => renderer.clearAfterEnd()).not.toThrow();
    expect(priv.unitHandles.size).toBe(0);
    expect(priv.unitMeshes.size).toBe(0);
    expect(priv.unitPose.size).toBe(0);
    expect(priv.flashes.size).toBe(0);
    expect(priv.damagePops.length).toBe(0);
  });
});
