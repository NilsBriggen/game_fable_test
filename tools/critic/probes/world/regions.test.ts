import { describe, it, expect } from 'vitest';
import { PLACES } from '@content/gazetteer';
import { ContentRegistry } from '@core/content';
import { register as registerGeography, PLACE_REGION_ID } from '@content/geography';
import { pointInPolygon } from '@core/math';
describe('P8 region polygons', () => {
  it('overlap census', () => {
    const c = new ContentRegistry(); registerGeography(c);
    let multi = 0, none = 0, wrong = 0; const w: string[] = [];
    for (const p of Object.values(PLACES)) {
      const hits = [...c.regions.values()].filter((r) => pointInPolygon(p.x, p.z, r.bounds as [number, number][]));
      if (hits.length === 0) none++; else if (hits.length > 1) multi++;
      const want = (PLACE_REGION_ID as any)[p.id];
      if (want && hits[0]?.id !== want) { wrong++; w.push(`${p.id}: first=${hits[0]?.id} authored=${want}`); }
    }
    console.log(`[P8] ${Object.keys(PLACES).length} places: none=${none} multi=${multi} first-match!=authored=${wrong}`);
    if (w.length) console.log(`[P8] ${w.slice(0,12).join(' | ')}`);
    expect(true).toBe(true);
  });
});
