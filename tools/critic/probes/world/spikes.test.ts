/** Probe: free-standing spikes on valley floors — where are they, and how far from the nearest corridor? */
import { describe, it, expect, beforeAll } from 'vitest';
import { buildHeightGrid, surfaceNameOf, DEFAULT_GRID_W, DEFAULT_GRID_H, type HeightGridResult } from '../../../../src/world/heightmodel';
import { buildWorldGeo } from '../../../../src/world/geodata';
import { MAP_BOUNDS } from '@content/gazetteer';
let grid: HeightGridResult; let sx = 0, sz = 0;
beforeAll(() => { grid = buildHeightGrid(1291, DEFAULT_GRID_W, DEFAULT_GRID_H); sx = (MAP_BOUNDS.maxX - MAP_BOUNDS.minX) / (grid.width - 1); sz = (MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ) / (grid.height - 1); }, 120_000);
describe('valley-floor spikes', () => {
  it('lists the worst spikes with surface and corridor distance', () => {
    const geo = buildWorldGeo(1291);
    const w = grid.width, h = grid.height, H = grid.heights;
    const R = Math.round(100 / sx);
    const out: { x: number; z: number; hh: number; med: number; s: string; cd: number; cid: string }[] = [];
    for (let gz = R; gz < h - R; gz += 6) for (let gx = R; gx < w - R; gx += 6) {
      const hh = H[gz * w + gx]; if (hh < 40) continue;
      const ring: number[] = [];
      for (let a = 0; a < 16; a++) { const ang = a / 16 * Math.PI * 2; ring.push(H[Math.round(gz + Math.sin(ang) * R) * w + Math.round(gx + Math.cos(ang) * R)]); }
      ring.sort((a, b) => a - b); const med = ring[8];
      if (med < 60 && hh - med > 40) {
        const x = MAP_BOUNDS.minX + gx * sx, z = MAP_BOUNDS.minZ + gz * sz;
        let cd = Infinity, cid = '';
        for (const c of geo.corridors) for (const p of c.pts) { const d = Math.hypot(p.x - x, p.z - z); if (d < cd) { cd = d; cid = c.id; } }
        out.push({ x, z, hh, med, s: surfaceNameOf(grid.surface[gz * w + gx]), cd, cid });
      }
    }
    out.sort((a, b) => (b.hh - b.med) - (a.hh - a.med));
    console.log(`[SP] ${out.length} spikes; worst 25:\n` + out.slice(0, 25).map((o) => `(${o.x.toFixed(0)},${o.z.toFixed(0)}) h=${o.hh.toFixed(0)} med=${o.med.toFixed(0)} ${o.s} corridor ${o.cid}@${o.cd.toFixed(0)}m`).join('\n'));
    expect(true).toBe(true);
  });
});
