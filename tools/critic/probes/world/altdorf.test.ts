/** Critic probe — world round 2: is the grey mass filling free-altdorf.png terrain or a prop?
 * Camera is (420, 60, 2350) looking at Altdorf. Sample the real grid around it. */
import { describe, it, expect, beforeAll } from 'vitest';
import { buildHeightGrid, surfaceNameOf, DEFAULT_GRID_W, DEFAULT_GRID_H, type HeightGridResult } from '../../../../src/world/heightmodel';
import { MAP_BOUNDS, PLACES } from '@content/gazetteer';

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

describe('P11 free-altdorf camera surroundings', () => {
  const CAM = { x: 420, y: 60, z: 2350 };
  it('height field around the camera', () => {
    // eslint-disable-next-line no-console
    console.log(`[P11] camera (${CAM.x},${CAM.y},${CAM.z}) terrain=${heightAt(CAM.x, CAM.z).toFixed(1)} clearance=${(CAM.y - heightAt(CAM.x, CAM.z)).toFixed(1)}m surface=${surfaceAt(CAM.x, CAM.z)}`);
    const alt = PLACES['altdorf'];
    // eslint-disable-next-line no-console
    console.log(`[P11] altdorf at (${alt.x},${alt.z}) h=${alt.h} terrain=${heightAt(alt.x, alt.z).toFixed(1)}; camera is ${Math.hypot(alt.x - CAM.x, alt.z - CAM.z).toFixed(0)}m from it`);
    for (let dz = -150; dz <= 150; dz += 50) {
      const row: string[] = [];
      for (let dx = -150; dx <= 150; dx += 50) row.push(heightAt(CAM.x + dx, CAM.z + dz).toFixed(0).padStart(4));
      // eslint-disable-next-line no-console
      console.log(`[P11] dz=${String(dz).padStart(4)}  ${row.join(' ')}`);
    }
    // Anything within 120 m that rises above the camera would fill the frame.
    let maxH = -Infinity, at = '';
    for (let dx = -120; dx <= 120; dx += 10) for (let dz = -120; dz <= 120; dz += 10) {
      const h = heightAt(CAM.x + dx, CAM.z + dz);
      if (h > maxH) { maxH = h; at = `(${CAM.x + dx},${CAM.z + dz})`; }
    }
    // eslint-disable-next-line no-console
    console.log(`[P11] tallest terrain within 120m of the camera: ${maxH.toFixed(1)}m at ${at} (camera y=${CAM.y}) -> ${maxH > CAM.y ? 'BLOCKS THE VIEW' : 'below the camera'}`);
    expect(true).toBe(true);
  });
  it('sight line from the camera to Altdorf village', () => {
    const alt = PLACES['altdorf'];
    const L = Math.hypot(alt.x - CAM.x, alt.z - CAM.z);
    let blocked = 0, first = -1;
    for (let d = 5; d < L; d += 5) {
      const t = d / L, x = CAM.x + (alt.x - CAM.x) * t, z = CAM.z + (alt.z - CAM.z) * t;
      const rayY = CAM.y + (alt.h + 2 - CAM.y) * t;
      if (heightAt(x, z) > rayY + 1) { blocked++; if (first < 0) first = d; }
    }
    // eslint-disable-next-line no-console
    console.log(`[P11] camera->altdorf ${L.toFixed(0)}m: ${blocked}/${Math.floor(L / 5)} samples occluded (first at ${first}m)`);
    expect(true).toBe(true);
  });
});

describe('P12 isolated spike census (local relief)', () => {
  it('cells rising >40 m above the median of their ~100 m neighbourhood', () => {
    const R = 13; // ~100 m at 7.8 m/texel
    let spikes = 0, total = 0, worst = 0, worstAt = '';
    const inValley: string[] = [];
    for (let gz = R; gz < grid.height - R; gz += 4) {
      for (let gx = R; gx < grid.width - R; gx += 4) {
        const h = grid.heights[gz * grid.width + gx];
        const ring: number[] = [];
        for (let a = 0; a < 8; a++) {
          const ang = (a / 8) * Math.PI * 2;
          const sx = Math.round(gx + Math.cos(ang) * R), sz = Math.round(gz + Math.sin(ang) * R);
          ring.push(grid.heights[sz * grid.width + sx]);
        }
        ring.sort((p, q) => p - q);
        const med = (ring[3] + ring[4]) / 2;
        total++;
        const rel = h - med;
        if (rel > 40) {
          spikes++;
          const x = MAP_BOUNDS.minX + gx * scaleX, z = MAP_BOUNDS.minZ + gz * scaleZ;
          if (rel > worst) { worst = rel; worstAt = `(${x.toFixed(0)},${z.toFixed(0)})`; }
          if (med < 60 && inValley.length < 12) inValley.push(`(${x.toFixed(0)},${z.toFixed(0)}) +${rel.toFixed(0)}m over floor ${med.toFixed(0)}m`);
        }
      }
    }
    console.log(`[P12] ${spikes}/${total} sampled cells rise >40 m above their 100 m neighbourhood median (${((100 * spikes) / total).toFixed(2)}%); worst +${worst.toFixed(0)}m at ${worstAt}`);
    console.log(`[P12] examples on valley floors (<60 m):\n  ${inValley.join('\n  ')}`);
    expect(true).toBe(true);
  });
});
