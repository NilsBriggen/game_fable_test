/** Critic probes — world round 2: transects through the four known-red test locations. */
import { describe, it, expect, beforeAll } from 'vitest';
import { buildHeightGrid, surfaceNameOf, DEFAULT_GRID_W, DEFAULT_GRID_H, type HeightGridResult } from '../../../../src/world/heightmodel';
import { MAP_BOUNDS } from '@content/gazetteer';

let grid: HeightGridResult; let scaleX = 0, scaleZ = 0;
beforeAll(() => {
  grid = buildHeightGrid(1291, DEFAULT_GRID_W, DEFAULT_GRID_H);
  scaleX = (MAP_BOUNDS.maxX - MAP_BOUNDS.minX) / (grid.width - 1);
  scaleZ = (MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ) / (grid.height - 1);
}, 120_000);
function heightAt(x: number, z: number): number {
  const gx = (x - MAP_BOUNDS.minX) / scaleX, gz = (z - MAP_BOUNDS.minZ) / scaleZ;
  const x0 = Math.max(0, Math.min(grid.width - 2, Math.floor(gx))), z0 = Math.max(0, Math.min(grid.height - 2, Math.floor(gz)));
  const tx = gx - x0, tz = gz - z0, r0 = z0 * grid.width, r1 = (z0 + 1) * grid.width;
  const a = grid.heights[r0 + x0] + (grid.heights[r0 + x0 + 1] - grid.heights[r0 + x0]) * tx;
  const b = grid.heights[r1 + x0] + (grid.heights[r1 + x0 + 1] - grid.heights[r1 + x0]) * tx;
  return a + (b - a) * tz;
}
function surfaceAt(x: number, z: number): string {
  const gx = Math.max(0, Math.min(grid.width - 1, Math.round((x - MAP_BOUNDS.minX) / scaleX)));
  const gz = Math.max(0, Math.min(grid.height - 1, Math.round((z - MAP_BOUNDS.minZ) / scaleZ)));
  return surfaceNameOf(grid.surface[gz * grid.width + gx]);
}

describe('P9 transects at the four red-test locations', () => {
  const cases: { name: string; x: number; z: number; dx: number; dz: number }[] = [
    { name: 'zugersee NE shore (-1048,-5128)', x: -1048, z: -5128, dx: 1, dz: 0 },
    { name: 'lauerzersee S shore (-573,-1775)', x: -573, z: -1775, dx: 0, dz: 1 },
    { name: 'urnersee E shore / Axen (316,-74)', x: 316, z: -74, dx: 1, dz: 0 },
    { name: 'sattel-road max grade (-82,-2080)', x: -82, z: -2080, dx: 0, dz: 1 },
    { name: 'ruetli meadow (-186,-74)', x: -186, z: -74, dx: 1, dz: 0 },
    { name: 'buergenstock ridge (-3631,-815)', x: -3631, z: -815, dx: 0, dz: 1 },
  ];
  it.each(cases.map((c) => c.name))('%s', (name) => {
    const c = cases.find((x) => x.name === name)!;
    const out: string[] = [];
    for (let d = -120; d <= 120; d += 20) out.push(`${d}:${heightAt(c.x + c.dx * d, c.z + c.dz * d).toFixed(0)}/${surfaceAt(c.x + c.dx * d, c.z + c.dz * d).slice(0, 4)}`);
    // eslint-disable-next-line no-console
    console.log(`[P9] ${name}  ${out.join(' ')}`);
    expect(true).toBe(true);
  });
});
