/** Critic probe — world round 2: does the decimated far mesh (terrain.ts buildFarMesh, step 8)
 * put non-water surface / above-water height inside the lake polygons? That is what a tan ribbon
 * across open water in lake-overview-seelisberg.png would be. */
import { describe, it, expect, beforeAll } from 'vitest';
import { buildHeightGrid, surfaceNameOf, DEFAULT_GRID_W, DEFAULT_GRID_H, type HeightGridResult } from '../../../../src/world/heightmodel';
import { MAP_BOUNDS, LAKES, gameHeightFromAsl } from '@content/gazetteer';
import { pointInPolygon } from '@core/math';

let grid: HeightGridResult; let scaleX = 0, scaleZ = 0;
beforeAll(() => {
  grid = buildHeightGrid(1291, DEFAULT_GRID_W, DEFAULT_GRID_H);
  scaleX = (MAP_BOUNDS.maxX - MAP_BOUNDS.minX) / (grid.width - 1);
  scaleZ = (MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ) / (grid.height - 1);
}, 120_000);

describe('P10 far-mesh decimation over water', () => {
  it('step-8 sampled cells inside each lake polygon: surface and height vs the water plane', () => {
    const STEP = 8; // terrain.ts buildFarMesh default
    for (const lake of LAKES) {
      const level = gameHeightFromAsl(lake.levelAsl);
      const counts: Record<string, number> = {};
      let n = 0, above = 0, worstAbove = 0, worstAt = '';
      for (let gz = 0; gz < grid.height; gz += STEP) {
        const z = MAP_BOUNDS.minZ + gz * scaleZ;
        for (let gx = 0; gx < grid.width; gx += STEP) {
          const x = MAP_BOUNDS.minX + gx * scaleX;
          if (!pointInPolygon(x, z, lake.poly)) continue;
          const i = gz * grid.width + gx;
          const s = surfaceNameOf(grid.surface[i]);
          counts[s] = (counts[s] ?? 0) + 1;
          n++;
          // the far mesh sits 1.5 m below the true surface (terrain.ts:229)
          const y = grid.heights[i] - 1.5;
          if (y > level) { above++; if (y - level > worstAbove) { worstAbove = y - level; worstAt = `(${x.toFixed(0)},${z.toFixed(0)})`; } }
        }
      }
      const nonWater = Object.entries(counts).filter(([k]) => k !== 'water');
      // eslint-disable-next-line no-console
      console.log(`[P10] ${lake.id.padEnd(16)} far-mesh cells=${n} nonWater=[${nonWater.map(([k, v]) => `${k}:${v}`).join(' ') || 'none'}] aboveWaterPlane=${above}${above ? ` worst +${worstAbove.toFixed(1)}m at ${worstAt}` : ''}`);
    }
    expect(true).toBe(true);
  });
});
