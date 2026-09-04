/** Probe: which road corridor crosses the Urnersee in front of the Rütli? Transects east from the meadow. */
import { describe, it, expect, beforeAll } from 'vitest';
import { buildHeightGrid, surfaceNameOf, DEFAULT_GRID_W, DEFAULT_GRID_H, type HeightGridResult } from '../../../../src/world/heightmodel';
import { MAP_BOUNDS } from '@content/gazetteer';

let grid: HeightGridResult; let sx = 0, sz = 0;
beforeAll(() => { grid = buildHeightGrid(1291, DEFAULT_GRID_W, DEFAULT_GRID_H); sx = (MAP_BOUNDS.maxX - MAP_BOUNDS.minX) / (grid.width - 1); sz = (MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ) / (grid.height - 1); }, 120_000);
const cell = (x: number, z: number) => { const gx = Math.round((x - MAP_BOUNDS.minX) / sx), gz = Math.round((z - MAP_BOUNDS.minZ) / sz); const i = gz * grid.width + gx; return { h: grid.heights[i], s: surfaceNameOf(grid.surface[i]) }; };
describe('road cells on the Urnersee near the Rütli', () => {
  it('lists road/settlement cells at or below lake level within 600 m of the Rütli', () => {
    const hits: string[] = [];
    for (let z = -700; z <= 500; z += 8) for (let x = -400; x <= 500; x += 8) {
      const c = cell(x, z);
      if ((c.s === 'road' || c.s === 'settlement') && c.h <= 1.0) hits.push(`${x},${z}:${c.s}@${c.h.toFixed(1)}`);
    }
    console.log(`[RR] ${hits.length} road/settlement cells at <=1 m around the Rütli/Treib: ${hits.slice(0, 40).join(' ')}`);
    for (const z of [-74, -100, -124, -160, -200]) {
      const row: string[] = [];
      for (let x = -200; x <= 300; x += 20) { const c = cell(x, z); row.push(`${c.s[0]}${c.h.toFixed(0)}`); }
      console.log(`[RR] z=${z}: ${row.join(' ')}`);
    }
    expect(true).toBe(true);
  });
});
