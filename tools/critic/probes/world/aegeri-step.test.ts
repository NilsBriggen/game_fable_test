/** Probe: the Ägerisee shore step at (-164,-4214): heights and surfaces along the outward normal. */
import { describe, it, expect, beforeAll } from 'vitest';
import { buildHeightGrid, surfaceNameOf, DEFAULT_GRID_W, DEFAULT_GRID_H, type HeightGridResult } from '../../../../src/world/heightmodel';
import { buildWorldGeo } from '../../../../src/world/geodata';
import { polygonSdf } from '@core/math';
import { MAP_BOUNDS } from '@content/gazetteer';
let grid: HeightGridResult; let sx = 0, sz = 0;
beforeAll(() => { grid = buildHeightGrid(1291, DEFAULT_GRID_W, DEFAULT_GRID_H); sx = (MAP_BOUNDS.maxX - MAP_BOUNDS.minX) / (grid.width - 1); sz = (MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ) / (grid.height - 1); }, 120_000);
const cell = (x: number, z: number) => { const gx = Math.round((x - MAP_BOUNDS.minX) / sx), gz = Math.round((z - MAP_BOUNDS.minZ) / sz); const i = gz * grid.width + gx; return { h: grid.heights[i], s: surfaceNameOf(grid.surface[i]) }; };
describe('aegerisee step', () => {
  it('transect', () => {
    const geo = buildWorldGeo(1291); const lake = geo.lakes.find((l) => l.id === 'aegerisee')!;
    const out: string[] = [];
    for (let dx = -60; dx <= 100; dx += 10) for (const dz of [0]) { const x = -164 + dx, z = -4214 + dz; const c = cell(x, z); out.push(`x${x}: ${c.h.toFixed(1)} ${c.s[0]} sdf=${polygonSdf(x, z, lake.poly).toFixed(0)}`); }
    let near = { d: Infinity, id: '' }; for (const c of geo.corridors) for (const p of c.pts) { const d = Math.hypot(p.x + 164, p.z + 4214); if (d < near.d) near = { d, id: c.id }; }
    let pad = ''; for (const p of geo.pads) { const d = Math.hypot(p.x + 164, p.z + 4214); if (d < p.radius * 1.6) pad += `${p.id}@${d.toFixed(0)}(r${p.radius}) `; }
    const road = geo.corridors.find((c) => c.id === 'sattel-road')!; const pts = road.pts.filter((p) => Math.hypot(p.x + 164, p.z + 4214) < 120).map((p) => `(${p.x.toFixed(0)},${p.z.toFixed(0)}) h=${p.h.toFixed(1)} half=${p.halfWidth}`);
    console.log(`[AS] road pts near: ${pts.join(' | ')}`);
    console.log(`[AS] level=${lake.levelGameH.toFixed(1)} nearest corridor ${near.id}@${near.d.toFixed(0)}m pads: ${pad || 'none'}\n${out.join('\n')}`);
    expect(true).toBe(true);
  });
});
