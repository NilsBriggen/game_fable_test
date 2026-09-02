import { describe, it, expect } from 'vitest';
import { buildColliders, resolveCollisions } from './colliders';
import type { PlacedModel } from '@core/schemas';

describe('buildColliders', () => {
  it('produces one collider per solid model, skipping walk-through props', () => {
    const layout: PlacedModel[] = [
      { modelId: 'house.blockbau', x: 10, z: 0 },
      { modelId: 'cross', x: 0, z: 0 },
      { modelId: 'well', x: 5, z: 5 },
      { modelId: 'castle.keep', x: -10, z: 0 },
    ];
    const colliders = buildColliders(layout);
    expect(colliders).toHaveLength(2);
    expect(colliders.find((c) => c.x === 10)?.radius).toBeGreaterThan(0);
  });
});

describe('resolveCollisions', () => {
  it('pushes the player out of an overlapping collider', () => {
    const pos = { x: 1, z: 0 };
    resolveCollisions(pos, [{ x: 0, z: 0, radius: 4 }], 0.4);
    const d = Math.hypot(pos.x, pos.z);
    expect(d).toBeCloseTo(4.4, 5);
  });

  it('leaves position untouched when not overlapping anything', () => {
    const pos = { x: 100, z: 100 };
    resolveCollisions(pos, [{ x: 0, z: 0, radius: 4 }], 0.4);
    expect(pos).toEqual({ x: 100, z: 100 });
  });
});
