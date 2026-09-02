import { describe, it, expect } from 'vitest';
import { ContentRegistry } from '@core/content';
import { register as registerGeography } from '@content/geography';
import { pointInPolygon } from '@core/math';
import { PLACES } from '@content/gazetteer';
import type { RegionDef } from '@core/schemas';

/** Mirrors WorldService.regionAt: first region (insertion order) whose polygon contains the point. */
function regionAt(regions: Map<string, RegionDef>, x: number, z: number): RegionDef | null {
  for (const r of regions.values()) if (pointInPolygon(x, z, r.bounds as [number, number][])) return r;
  return null;
}

describe('regions (content/geography.ts) + pointInPolygon', () => {
  const c = new ContentRegistry();
  registerGeography(c);

  it('registers every LORE.md §3 region with historical + note', () => {
    expect(c.regions.size).toBe(14);
    for (const r of c.regions.values()) {
      expect(r.historical).toBeTruthy();
      expect(r.note.length).toBeGreaterThan(0);
      expect(r.bounds.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('the Rütli falls inside uri-urnersee', () => {
    const p = PLACES['ruetli'];
    const r = regionAt(c.regions, p.x, p.z);
    expect(r?.id).toBe('uri-urnersee');
  });

  it('Morgarten falls inside schwyz-arth-morgarten', () => {
    const p = PLACES['morgarten'];
    const r = regionAt(c.regions, p.x, p.z);
    expect(r?.id).toBe('schwyz-arth-morgarten');
  });

  it('Luzern falls inside luzern-basin', () => {
    const p = PLACES['luzern'];
    const r = regionAt(c.regions, p.x, p.z);
    expect(r?.id).toBe('luzern-basin');
  });

  it('every gazetteer place resolves to some region or is explicitly outside all of them (no crash)', () => {
    let resolved = 0;
    for (const p of Object.values(PLACES)) if (regionAt(c.regions, p.x, p.z)) resolved++;
    expect(resolved).toBeGreaterThan(Object.keys(PLACES).length * 0.7);
  });

  it('a point far outside the whole map resolves to no region', () => {
    expect(regionAt(c.regions, 50000, 50000)).toBeNull();
  });
});
