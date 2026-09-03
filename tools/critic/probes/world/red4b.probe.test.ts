import { it } from 'vitest';
import { buildHeightGrid, DEFAULT_GRID_W, DEFAULT_GRID_H, surfaceNameOf } from '../../../../src/world/heightmodel';
import { buildWorldGeo } from '../../../../src/world/geodata';
import { MAP_BOUNDS, PLACES } from '../../../../src/content/gazetteer';
import { polygonSdf } from '../../../../src/core/math';
import { ContentRegistry } from '../../../../src/core/content';
import { register as registerGeography } from '../../../../src/content/geography';
import { register as registerPois } from '../../../../src/content/pois';

it('zug + lorze mouth', () => {
  const grid = buildHeightGrid(1291, DEFAULT_GRID_W, DEFAULT_GRID_H);
  const sx = (MAP_BOUNDS.maxX - MAP_BOUNDS.minX) / (grid.width - 1), sz = (MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ) / (grid.height - 1);
  const h = (x: number, z: number) => { const gx = Math.round((x - MAP_BOUNDS.minX) / sx), gz = Math.round((z - MAP_BOUNDS.minZ) / sz); return grid.heights[gz * grid.width + gx]; };
  const s = (x: number, z: number) => { const gx = Math.round((x - MAP_BOUNDS.minX) / sx), gz = Math.round((z - MAP_BOUNDS.minZ) / sz); return surfaceNameOf(grid.surface[gz * grid.width + gx]); };
  const geo = buildWorldGeo();
  const zl = geo.lakes.find((l) => l.id === 'zugersee')!;
  // grid around the lorze-mouth point
  const X = -1048, Z = -5128;
  for (let dz = -60; dz <= 60; dz += 15) {
    const row: string[] = [];
    for (let dx = -60; dx <= 60; dx += 15) row.push(`${h(X + dx, Z + dz).toFixed(0).padStart(4)}${s(X + dx, Z + dz)[0]}${polygonSdf(X + dx, Z + dz, zl.poly) < 0 ? '~' : ' '}`);
    console.log('z' + String(dz).padStart(4), row.join(''));
  }
  const lorze = geo.corridors.find((c) => c.id === 'lorze')!;
  console.log('lorze pts near:', lorze.pts.filter((p) => Math.hypot(p.x - X, p.z - Z) < 200).map((p) => `(${p.x.toFixed(0)},${p.z.toFixed(0)}) h=${p.h.toFixed(0)} sdf=${polygonSdf(p.x, p.z, zl.poly).toFixed(0)} hw=${p.halfWidth} inf=${p.influence}`).join(' | '));
  const cr = new ContentRegistry(); registerGeography(cr); registerPois(cr);
  const zug = cr.pois.get('poi.zug')!; const pz = PLACES['zug'];
  console.log('poi.zug', zug.x, zug.z, 'place zug', pz.x, pz.z, pz.h, pz.kind, 'poiH', h(zug.x, zug.z).toFixed(1), 'placeH', h(pz.x, pz.z).toFixed(1), 'dist', Math.hypot(zug.x - pz.x, zug.z - pz.z).toFixed(0), 'sdf', polygonSdf(zug.x, zug.z, zl.poly).toFixed(0));
  for (const [dx, dz] of [[-10, 0], [10, 0], [0, -10], [0, 10]]) console.log('  zug nb', dx, dz, h(zug.x + dx, zug.z + dz).toFixed(1), s(zug.x + dx, zug.z + dz));
});

it('bilinear vs nearest along the arth-road end', () => {
  const grid = buildHeightGrid(1291, DEFAULT_GRID_W, DEFAULT_GRID_H);
  const sx = (MAP_BOUNDS.maxX - MAP_BOUNDS.minX) / (grid.width - 1), sz = (MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ) / (grid.height - 1);
  const near = (x: number, z: number) => { const gx = Math.round((x - MAP_BOUNDS.minX) / sx), gz = Math.round((z - MAP_BOUNDS.minZ) / sz); return grid.heights[gz * grid.width + gx]; };
  const bil = (x: number, z: number) => { const gx = (x - MAP_BOUNDS.minX) / sx, gz = (z - MAP_BOUNDS.minZ) / sz; const x0 = Math.floor(gx), z0 = Math.floor(gz), tx = gx - x0, tz = gz - z0; const H = grid.heights, w = grid.width; const a = H[z0 * w + x0] + (H[z0 * w + x0 + 1] - H[z0 * w + x0]) * tx; const b = H[(z0 + 1) * w + x0] + (H[(z0 + 1) * w + x0 + 1] - H[(z0 + 1) * w + x0]) * tx; return a + (b - a) * tz; };
  const geo = buildWorldGeo();
  const road = geo.corridors.find((c) => c.id === 'arth-road')!;
  const pts = road.pts.slice(-5);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1]; const L = Math.hypot(b.x - a.x, b.z - a.z);
    const row: string[] = [];
    for (let t = 0; t <= 1.0001; t += 10 / L) { const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t; row.push(`${near(x, z).toFixed(0)}/${bil(x, z).toFixed(0)}`); }
    console.log(`seg ${i} (${a.x.toFixed(0)},${a.z.toFixed(0)})->(${b.x.toFixed(0)},${b.z.toFixed(0)}) L=${L.toFixed(0)}:`, row.join(' '));
  }
});
