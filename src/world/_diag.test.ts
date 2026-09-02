import { describe, it } from 'vitest';
import { buildHeightGrid, DEFAULT_GRID_W, DEFAULT_GRID_H } from './heightmodel';
import { MAP_BOUNDS, LAKES } from '@content/gazetteer';
import { polygonSdf } from '@core/math';
import { buildWorldGeo, segmentDistT } from './geodata';

describe('diag', () => {
  it('dump', () => {
    const grid = buildHeightGrid(1291, DEFAULT_GRID_W, DEFAULT_GRID_H);
    const scaleX = (MAP_BOUNDS.maxX - MAP_BOUNDS.minX) / (grid.width - 1);
    const scaleZ = (MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ) / (grid.height - 1);
    function h(x: number, z: number) {
      const gx = Math.round((x - MAP_BOUNDS.minX) / scaleX);
      const gz = Math.round((z - MAP_BOUNDS.minZ) / scaleZ);
      return grid.heights[gz * grid.width + gx];
    }
    function findEdge(lakeId: string, tx: number, tz: number, td: number) {
      const lake = LAKES.find((l) => l.id === lakeId)!;
      let cx = 0, cz = 0;
      for (const [px, pz] of lake.poly) { cx += px; cz += pz; }
      cx /= lake.poly.length; cz /= lake.poly.length;
      for (let i = 0; i < lake.poly.length; i++) {
        const [ax, az] = lake.poly[i];
        const [bx, bz] = lake.poly[(i + 1) % lake.poly.length];
        const ex = bx - ax, ez = bz - az;
        const elen = Math.hypot(ex, ez) || 1;
        if (elen < 80) continue;
        let nx = -ez / elen, nz = ex / elen;
        const midx = (ax + bx) / 2, midz = (az + bz) / 2;
        if ((midx - cx) * nx + (midz - cz) * nz < 0) { nx = -nx; nz = -nz; }
        const px = ax + ex * 0.5, pz = az + ez * 0.5;
        const xT = px + nx * td, zT = pz + nz * td;
        if (Math.abs(xT - tx) < 3 && Math.abs(zT - tz) < 3) {
          console.log(lakeId, 'edge', i, 'mid=', px.toFixed(1), pz.toFixed(1), 'n=', nx.toFixed(3), nz.toFixed(3));
          for (let d = -10; d <= 80; d += 5) {
            const x = px + nx * d, z = pz + nz * d;
            console.log('  d=', d, 'sdf=', polygonSdf(x, z, lake.poly).toFixed(1), 'h=', h(x, z).toFixed(1));
          }
          const geo = buildWorldGeo();
          let best = Infinity, bestC = '';
          for (const c of geo.corridors) {
            for (let j = 1; j < c.pts.length; j++) {
              const a = c.pts[j-1], b = c.pts[j];
              const { dist } = segmentDistT(px+nx*td, pz+nz*td, a.x, a.z, b.x, b.z);
              if (dist < best) { best = dist; bestC = c.id + ':' + c.kind; }
            }
          }
          console.log('nearest corridor:', bestC, 'dist=', best.toFixed(1));
        }
      }
    }
    findEdge('zugersee', -1058, -5128, 40);
  }, 30000);
});
