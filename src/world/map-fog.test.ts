/** 4.6 map fog: pure mask helpers (headless). Compass `?`-only checks live in hud-fog.test.ts
 *  (exploration-owned, so the import gate's same-module rule holds for both files). */
import { describe, it, expect } from 'vitest';
import { mapFogAt, mapFogKey, mapFogSpots } from './map';

describe('mapFogAt — pure fog predicate', () => {
  const spots = [{ x: 0, z: 0, r: 900 }];
  it('reveals inside a disc, fogs outside', () => {
    expect(mapFogAt(0, 0, spots)).toBe(false);
    expect(mapFogAt(500, 0, spots)).toBe(false);
    expect(mapFogAt(2000, 0, spots)).toBe(true);
  });
  it('empty spots = everything fogged', () => {
    expect(mapFogAt(0, 0, [])).toBe(true);
  });
  it('multiple discs union', () => {
    const two = [...spots, { x: 5000, z: 0, r: 900 }];
    expect(mapFogAt(5000, 0, two)).toBe(false);
    expect(mapFogAt(2500, 0, two)).toBe(true);
  });
});

describe('mapFogSpots / mapFogKey — reveal discs + cache key', () => {
  const defs = [
    { id: 'poi.a', x: 0, z: 0, discoverRadius: 90 },
    { id: 'poi.b', x: 5000, z: 0, discoverRadius: 50 },
  ];
  it('builds one disc per discovered POI at 6x radius (min 900 m) + a 1200 m player disc', () => {
    const spots = mapFogSpots(defs, ['poi.a'], { x: 1000, z: 1000 });
    expect(spots).toHaveLength(2);
    expect(spots[0]).toEqual({ x: 0, z: 0, r: 900 }); // max(900, 90*6=540)
    expect(spots[1]).toEqual({ x: 1000, z: 1000, r: 1200 });
  });
  it('large discover radii scale: a town (220 m) opens a 1320 m window', () => {
    const spots = mapFogSpots([{ id: 'poi.t', x: 0, z: 0, discoverRadius: 220 }], ['poi.t'], null);
    expect(spots[0]!.r).toBe(1320);
  });
  it('no discoveries and no player = no discs', () => {
    expect(mapFogSpots(defs, [], null)).toEqual([]);
  });
  it('key changes on discovery and on 200 m player-cell moves, not within a cell', () => {
    const k0 = mapFogKey(['poi.a'], { x: 0, z: 0 });
    expect(mapFogKey(['poi.a', 'poi.b'], { x: 0, z: 0 })).not.toBe(k0);
    expect(mapFogKey(['poi.a'], { x: 50, z: 50 })).toBe(k0); // same cell
    expect(mapFogKey(['poi.a'], { x: 500, z: 0 })).not.toBe(k0); // new cell
    expect(mapFogKey([], null)).toContain('nop');
  });
});
