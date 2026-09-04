/** Probe: flattest spots along the rerouted Axen shore path (for siting the wayside cross). */
import { describe, it, expect, beforeAll } from 'vitest';
import { buildHeightGrid, DEFAULT_GRID_W, DEFAULT_GRID_H, type HeightGridResult } from '../../../../src/world/heightmodel';
import { MAP_BOUNDS } from '@content/gazetteer';
let grid: HeightGridResult; let sx = 0, sz = 0;
beforeAll(() => { grid = buildHeightGrid(1291, DEFAULT_GRID_W, DEFAULT_GRID_H); sx = (MAP_BOUNDS.maxX - MAP_BOUNDS.minX) / (grid.width - 1); sz = (MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ) / (grid.height - 1); }, 120_000);
const h = (x: number, z: number) => { const gx = Math.round((x - MAP_BOUNDS.minX) / sx), gz = Math.round((z - MAP_BOUNDS.minZ) / sz); return grid.heights[gz * grid.width + gx]; };
const slope = (x: number, z: number) => { const d = 8; const gx = (h(x + d, z) - h(x - d, z)) / (2 * d), gz = (h(x, z + d) - h(x, z - d)) / (2 * d); return Math.atan(Math.hypot(gx, gz)) * 180 / Math.PI; };
describe('Axen path flat spots', () => {
  it('slope along the corridor and 20 m either side', () => {
    const pts: [number, number][] = [[169, 395], [330, 160], [270, -220], [190, -560], [60, -700]];
    const out: string[] = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1]; const L = Math.hypot(bx - ax, bz - az);
      for (let d = 20; d < L; d += 25) { const t = d / L, x = ax + (bx - ax) * t, z = az + (bz - az) * t; const s = slope(x, z);
        const nx = -(bz - az) / L, nz = (bx - ax) / L; const s1 = slope(x + nx * 15, z + nz * 15), s2 = slope(x - nx * 15, z - nz * 15);
        if (Math.min(s, s1, s2) < 8) out.push(`(${x.toFixed(0)},${z.toFixed(0)}) road ${s.toFixed(0)}° | +15m ${s1.toFixed(0)}° (${(x + nx * 15).toFixed(0)},${(z + nz * 15).toFixed(0)}) | -15m ${s2.toFixed(0)}° h=${h(x, z).toFixed(1)}`); }
    }
    console.log(`[AF] ${out.length} flat spots:\n${out.slice(0, 30).join('\n')}`);
    expect(true).toBe(true);
  });
});
