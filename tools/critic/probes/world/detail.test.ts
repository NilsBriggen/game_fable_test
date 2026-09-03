/** Critic probes — world round 2, detail follow-ups on P1/P4/P6. */
import { describe, it, expect, beforeAll } from 'vitest';
import { buildHeightGrid, surfaceNameOf, DEFAULT_GRID_W, DEFAULT_GRID_H, type HeightGridResult } from '../../../../src/world/heightmodel';
import { MAP_BOUNDS, PLACES, LAKES, gameHeightFromAsl } from '@content/gazetteer';
import { polygonSdf } from '@core/math';

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

describe('P1b where do lake beds poke through the water plane?', () => {
  it('lists the worst interior bumps per lake with their distance inside the shore', () => {
    for (const lake of LAKES) {
      const level = gameHeightFromAsl(lake.levelAsl);
      let worst = 0, at = '', dIn = 0, deepBumps = 0, n = 0;
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const [px, pz] of lake.poly) { minX = Math.min(minX, px); maxX = Math.max(maxX, px); minZ = Math.min(minZ, pz); maxZ = Math.max(maxZ, pz); }
      for (let x = minX; x <= maxX; x += 10) for (let z = minZ; z <= maxZ; z += 10) {
        const sd = polygonSdf(x, z, lake.poly);
        if (sd > -25) continue;
        n++;
        const d = heightAt(x, z) - level;
        if (d > 0.5 && sd < -80) deepBumps++;
        if (d > worst) { worst = d; at = `(${x.toFixed(0)},${z.toFixed(0)})`; dIn = -sd; }
      }
      // eslint-disable-next-line no-console
      console.log(`[P1b] ${lake.id.padEnd(16)} worst bump +${worst.toFixed(1)}m at ${at} ${dIn.toFixed(0)}m inside shore; bumps >80m inside shore: ${deepBumps}/${n}`);
    }
    expect(true).toBe(true);
  });
});

describe('P4b Treib and other waterline POIs', () => {
  it('reports height/surface at the waterline ports', () => {
    for (const id of ['treib', 'brunnen', 'fluelen', 'gersau', 'buochs', 'beckenried', 'stansstad', 'alpnachstad', 'luzern', 'ruetli']) {
      const p = PLACES[id]; if (!p) continue;
      // eslint-disable-next-line no-console
      console.log(`[P4b] ${id.padEnd(14)} gaz h=${p.h} terrain=${heightAt(p.x, p.z).toFixed(1)} surface=${surfaceAt(p.x, p.z)}`);
    }
    expect(true).toBe(true);
  });
});

describe('P6b what a camera sees beyond 3 km (far-mesh backdrop, requests/worldlook-2)', () => {
  it('landmark distance from each vista camera', () => {
    const cams: Record<string, [number, number]> = {
      'lake-overview-seelisberg': [-405, -247], 'free-altdorf': [420, 2350],
      'free-pilatus-luzern': [-5300, -1050], 'free-morgarten': [520, -3150],
    };
    for (const [cam, [cx, cz]] of Object.entries(cams)) {
      const rows = Object.values(PLACES).filter((p) => p.kind === 'landmark')
        .map((p) => ({ id: p.id, d: Math.hypot(p.x - cx, p.z - cz) })).sort((a, b) => a.d - b.d).slice(0, 4);
      // eslint-disable-next-line no-console
      console.log(`[P6b] ${cam.padEnd(26)} nearest landmarks: ${rows.map((r) => `${r.id} ${(r.d / 1000).toFixed(1)}km`).join(', ')}`);
    }
    expect(true).toBe(true);
  });
});

describe('P2b heightAt vs gazetteer for EVERY place, by kind', () => {
  it('lists every place off by more than 5 m', () => {
    const rows: string[] = [];
    for (const p of Object.values(PLACES)) {
      const h = heightAt(p.x, p.z), d = h - p.h;
      if (Math.abs(d) > 5) rows.push(`${p.id}(${p.kind}) ${h.toFixed(1)} vs ${p.h} = ${d > 0 ? '+' : ''}${d.toFixed(1)} [${surfaceAt(p.x, p.z)}]`);
    }
    // eslint-disable-next-line no-console
    console.log(`[P2b] ${rows.length}/${Object.keys(PLACES).length} places off by >5m:\n  ${rows.join('\n  ')}`);
    expect(rows).toEqual([]);
  });
});
