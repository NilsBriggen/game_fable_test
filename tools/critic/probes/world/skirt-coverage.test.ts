/**
 * Critic probe — world runtime. chunkmesh.ts's skirts (SKIRT_DEPTH=24m, terrain.ts §5.1 "4 LOD levels
 * ... with skirts") are meant to hide the T-junction crack between two chunks built at different LODs
 * by dropping each border vertex straight down. That only actually hides the crack if the true height
 * difference across one coarse-LOD edge segment never exceeds the skirt depth. LOD3 (16 m/vertex,
 * terrain.ts LOD_DIST switches to it beyond 900 m) is exactly where the Axen/Schöllenen cliffs are
 * likely to be seen from a distance. This probe measures the worst real height step over a 16 m run
 * across the full shipped heightmap.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { buildHeightGrid, DEFAULT_GRID_W, DEFAULT_GRID_H, type HeightGridResult } from '../../../../src/world/heightmodel';
import { bilinearHeight, LOD_SPACING, SKIRT_DEPTH } from '../../../../src/world/chunkmesh';
import { MAP_BOUNDS } from '@content/gazetteer';

const SEED = 1291;
let grid: HeightGridResult;
let scaleX = 0, scaleZ = 0;

beforeAll(() => {
  grid = buildHeightGrid(SEED, DEFAULT_GRID_W, DEFAULT_GRID_H);
  scaleX = (MAP_BOUNDS.maxX - MAP_BOUNDS.minX) / (grid.width - 1);
  scaleZ = (MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ) / (grid.height - 1);
}, 60_000);

describe('LOD3 skirt depth vs. real terrain steps (chunkmesh.ts)', () => {
  it('SKIRT_DEPTH (24m) should exceed the worst 16m-spacing (LOD3) height step anywhere on the map', () => {
    const spacing = LOD_SPACING[3]; // 16 m — coarsest LOD, used past 900 m (terrain.ts LOD_DIST)
    let worst = 0, worstX = 0, worstZ = 0;
    // Sample every 3rd grid texel (~23m) in both x and z; a real LOD3 chunk edge falls on some
    // multiple of 16m, so this is a slightly coarse but representative sweep of the whole map.
    for (let gz = 0; gz < grid.height; gz += 3) {
      const z = MAP_BOUNDS.minZ + gz * scaleZ;
      if (z + spacing > MAP_BOUNDS.maxZ) continue;
      for (let gx = 0; gx < grid.width; gx += 3) {
        const x = MAP_BOUNDS.minX + gx * scaleX;
        if (x + spacing > MAP_BOUNDS.maxX) continue;
        const h0 = bilinearHeight(grid.heights, grid.width, grid.height, scaleX, scaleZ, x, z);
        const h1x = bilinearHeight(grid.heights, grid.width, grid.height, scaleX, scaleZ, x + spacing, z);
        const h1z = bilinearHeight(grid.heights, grid.width, grid.height, scaleX, scaleZ, x, z + spacing);
        const d = Math.max(Math.abs(h1x - h0), Math.abs(h1z - h0));
        if (d > worst) { worst = d; worstX = x; worstZ = z; }
      }
    }
    // eslint-disable-next-line no-console
    console.log(`[probe] worst LOD3 (${spacing}m) height step = ${worst.toFixed(1)}m at (${worstX.toFixed(0)},${worstZ.toFixed(0)}); SKIRT_DEPTH=${SKIRT_DEPTH}m`);
    expect(worst).toBeLessThan(SKIRT_DEPTH);
  });
});
