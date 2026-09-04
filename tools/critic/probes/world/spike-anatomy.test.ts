/** Probe: anatomy of the worst valley-floor spikes — base field, corridor profile, and the 3×3 neighbourhood. */
import { describe, it, expect, beforeAll } from 'vitest';
import { buildHeightGrid, surfaceNameOf, DEFAULT_GRID_W, DEFAULT_GRID_H, type HeightGridResult } from '../../../../src/world/heightmodel';
import { buildWorldGeo, valleyProfile, segmentDistT } from '../../../../src/world/geodata';
import { MAP_BOUNDS } from '@content/gazetteer';
let grid: HeightGridResult; let sx = 0, sz = 0;
beforeAll(() => { grid = buildHeightGrid(1291, DEFAULT_GRID_W, DEFAULT_GRID_H); sx = (MAP_BOUNDS.maxX - MAP_BOUNDS.minX) / (grid.width - 1); sz = (MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ) / (grid.height - 1); }, 120_000);
describe('spike anatomy', () => {
  it('prints the neighbourhood and corridor profile at the worst spikes', () => {
    const geo = buildWorldGeo(1291);
    const w = grid.width, H = grid.heights;
    const spots: [number, number][] = [[872, 5044], [965, 4857], [1012, 4153], [-5788, 495], [420, 2350], [370, 2500]];
    for (const [x, z] of spots) {
      const gx = Math.round((x - MAP_BOUNDS.minX) / sx), gz = Math.round((z - MAP_BOUNDS.minZ) / sz);
      const rows: string[] = [];
      for (let dz = -3; dz <= 3; dz++) { const r: string[] = []; for (let dx = -3; dx <= 3; dx++) r.push(H[(gz + dz) * w + gx + dx].toFixed(0).padStart(4)); rows.push(r.join(' ')); }
      let best = { d: Infinity, id: '', prof: 0, floor: 0, half: 0, infl: 0, shape: '' };
      for (const c of geo.corridors) for (let i = 1; i < c.pts.length; i++) {
        const a = c.pts[i - 1], b = c.pts[i]; const { dist, t } = segmentDistT(x, z, a.x, a.z, b.x, b.z);
        if (dist < best.d) { const floor = a.h + (b.h - a.h) * t; best = { d: dist, id: c.id, prof: valleyProfile(dist, floor, b), floor, half: b.halfWidth, infl: b.influence, shape: b.shape }; }
      }
      console.log(`[SA] (${x},${z}) h=${H[gz * w + gx].toFixed(0)} ${surfaceNameOf(grid.surface[gz * w + gx])} | ${best.id} d=${best.d.toFixed(0)} ${best.shape} half=${best.half} infl=${best.infl} floor=${best.floor.toFixed(0)} profile=${best.prof.toFixed(0)}\n${rows.join('\n')}`);
    }
    expect(true).toBe(true);
  });
});
