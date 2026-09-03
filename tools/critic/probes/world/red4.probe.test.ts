import { it } from 'vitest';
import { buildHeightGrid, DEFAULT_GRID_W, DEFAULT_GRID_H, surfaceNameOf } from '../../../../src/world/heightmodel';
import { buildWorldGeo } from '../../../../src/world/geodata';
import { MAP_BOUNDS, LAKES } from '../../../../src/content/gazetteer';
import { polygonSdf } from '../../../../src/core/math';

it('profiles the four red spots', () => {
  const grid = buildHeightGrid(1291, DEFAULT_GRID_W, DEFAULT_GRID_H);
  const sx = (MAP_BOUNDS.maxX - MAP_BOUNDS.minX) / (grid.width - 1), sz = (MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ) / (grid.height - 1);
  const h = (x: number, z: number) => { const gx = Math.round((x - MAP_BOUNDS.minX) / sx), gz = Math.round((z - MAP_BOUNDS.minZ) / sz); return grid.heights[gz * grid.width + gx]; };
  const s = (x: number, z: number) => { const gx = Math.round((x - MAP_BOUNDS.minX) / sx), gz = Math.round((z - MAP_BOUNDS.minZ) / sz); return surfaceNameOf(grid.surface[gz * grid.width + gx]); };
  const geo = buildWorldGeo();
  const road = geo.corridors.find((c) => c.id === (process.env.ROAD ?? 'sattel-road'))!;
  const PX = Number(process.env.PX ?? -82), PZ = Number(process.env.PZ ?? -2080);
  let bi = 0, bd = Infinity; road.pts.forEach((p, i) => { const d = Math.hypot(p.x - PX, p.z - PZ); if (d < bd) { bd = d; bi = i; } });
  console.log('sattel-road pts', road.pts.length, 'nearest idx', bi, 'd', bd.toFixed(1));
  for (let i = Math.max(0, bi - 8); i <= Math.min(road.pts.length - 1, bi + 8); i++) {
    const p = road.pts[i];
    const lakeD = Math.min(...geo.lakes.map((l) => polygonSdf(p.x, p.z, l.poly)));
    console.log(i, p.x.toFixed(0), p.z.toFixed(0), 's', p.s.toFixed(0), 'authH', p.h.toFixed(1), 'gridH', h(p.x, p.z).toFixed(1), s(p.x, p.z), 'lakeD', lakeD.toFixed(0));
  }
  for (const [name, x, z] of [['zugersee', -1286, -5575], ['zugersee', -2021, -4713]] as const) {
    const lake = geo.lakes.find((l) => l.id === name)!;
    // outward normal by sdf gradient
    const e = 2; const d0 = polygonSdf(x, z, lake.poly);
    let nx = (polygonSdf(x + e, z, lake.poly) - polygonSdf(x - e, z, lake.poly)) / (2 * e), nz = (polygonSdf(x, z + e, lake.poly) - polygonSdf(x, z - e, lake.poly)) / (2 * e);
    const nl = Math.hypot(nx, nz); nx /= nl; nz /= nl;
    const line: string[] = [];
    for (let d = -30; d <= 160; d += 10) line.push(`${d}:${h(x + nx * d, z + nz * d).toFixed(0)}${s(x + nx * d, z + nz * d)[0]}`);
    console.log(name, 'level', lake.levelGameH.toFixed(0), 'sdf@pt', d0.toFixed(0), line.join(' '));
  }
});

it('names pads/corridors near the red shore points', () => {
  const geo = buildWorldGeo();
  for (const [name, x, z] of [['zugersee', -1048, -5128], ['lauerzersee', -573, -1775], ['urnersee', 316, -74], ['sattel-start', -50, -2078]] as const) {
    const pads = geo.pads.filter((p) => Math.hypot(p.x - x, p.z - z) < p.radius * 1.6 + 120).map((p) => `${(p as any).id ?? '?'}@(${p.x.toFixed(0)},${p.z.toFixed(0)}) h=${p.h.toFixed(0)} r=${p.radius.toFixed(0)} d=${Math.hypot(p.x - x, p.z - z).toFixed(0)}`);
    const cors: string[] = [];
    for (const c of geo.corridors) { let bd = Infinity, bp: any = null; for (const p of c.pts) { const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; bp = p; } } if (bd < 150) cors.push(`${c.id}(${c.kind}) d=${bd.toFixed(0)} h=${bp.h.toFixed(0)}`); }
    console.log(name, 'pads:', pads.join(' | ') || 'none', '|| corridors:', cors.join(' | ') || 'none');
  }
  console.log('pad keys', Object.keys(geo.pads[0] ?? {}).join(','));
});
