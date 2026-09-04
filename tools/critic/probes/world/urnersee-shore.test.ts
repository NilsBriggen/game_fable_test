/** Probe: the Urnersee's eastern shoreline between Sisikon and Brunnen (for routing the Axen path on land). */
import { describe, it, expect, beforeAll } from 'vitest';
import { buildHeightGrid, surfaceNameOf, DEFAULT_GRID_W, DEFAULT_GRID_H, type HeightGridResult } from '../../../../src/world/heightmodel';
import { MAP_BOUNDS } from '@content/gazetteer';
let grid: HeightGridResult; let sx = 0, sz = 0;
beforeAll(() => { grid = buildHeightGrid(1291, DEFAULT_GRID_W, DEFAULT_GRID_H); sx = (MAP_BOUNDS.maxX - MAP_BOUNDS.minX) / (grid.width - 1); sz = (MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ) / (grid.height - 1); }, 120_000);
const cell = (x: number, z: number) => { const gx = Math.round((x - MAP_BOUNDS.minX) / sx), gz = Math.round((z - MAP_BOUNDS.minZ) / sz); const i = gz * grid.width + gx; return { h: grid.heights[i], s: surfaceNameOf(grid.surface[i]) }; };
describe('Urnersee east shore', () => {
  it('eastmost water x per z, Sisikon → Brunnen', () => {
    for (let z = 400; z >= -760; z -= 60) {
      let shore = null as number | null;
      for (let x = 600; x >= -300; x -= 4) { const c = cell(x, z); if (c.s === 'water') { shore = x; break; } }
      const inland = shore == null ? null : cell(shore + 60, z);
      console.log(`[US] z=${z}: east shore x=${shore} ; +60 m inland h=${inland?.h.toFixed(0)} ${inland?.s}`);
    }
    expect(true).toBe(true);
  });
});
