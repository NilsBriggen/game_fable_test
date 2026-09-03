/**
 * Critic probes — world module, round 2. Adversarial, written outside src/ by the critic.
 * Builds the REAL 2048x2176 grid the worker ships and asserts against it, plus line-of-sight
 * raymarching and POI siting. Run:
 *   npx vitest run --config tools/critic/probes/world/vitest.config.ts
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { buildHeightGrid, surfaceNameOf, DEFAULT_GRID_W, DEFAULT_GRID_H, type HeightGridResult } from '../../../../src/world/heightmodel';
import { buildWorldGeo } from '../../../../src/world/geodata';
import { MAP_BOUNDS, PLACES, LAKES, ROADS, gameHeightFromAsl } from '@content/gazetteer';
import { polygonSdf, pointInPolygon } from '@core/math';

const SEED = 1291;
let grid: HeightGridResult;
let scaleX = 0, scaleZ = 0;

beforeAll(() => {
  const t0 = Date.now();
  grid = buildHeightGrid(SEED, DEFAULT_GRID_W, DEFAULT_GRID_H);
  scaleX = (MAP_BOUNDS.maxX - MAP_BOUNDS.minX) / (grid.width - 1);
  scaleZ = (MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ) / (grid.height - 1);
  // eslint-disable-next-line no-console
  console.log(`[probe] full grid built in ${Date.now() - t0}ms`);
}, 120_000);

function heightAt(x: number, z: number): number {
  const gx = (x - MAP_BOUNDS.minX) / scaleX, gz = (z - MAP_BOUNDS.minZ) / scaleZ;
  const x0 = Math.max(0, Math.min(grid.width - 2, Math.floor(gx)));
  const z0 = Math.max(0, Math.min(grid.height - 2, Math.floor(gz)));
  const tx = Math.max(0, Math.min(1, gx - x0)), tz = Math.max(0, Math.min(1, gz - z0));
  const r0 = z0 * grid.width, r1 = (z0 + 1) * grid.width;
  const a = grid.heights[r0 + x0] + (grid.heights[r0 + x0 + 1] - grid.heights[r0 + x0]) * tx;
  const b = grid.heights[r1 + x0] + (grid.heights[r1 + x0 + 1] - grid.heights[r1 + x0]) * tx;
  return a + (b - a) * tz;
}
function surfaceAt(x: number, z: number): string {
  const gx = Math.max(0, Math.min(grid.width - 1, Math.round((x - MAP_BOUNDS.minX) / scaleX)));
  const gz = Math.max(0, Math.min(grid.height - 1, Math.round((z - MAP_BOUNDS.minZ) / scaleZ)));
  return surfaceNameOf(grid.surface[gz * grid.width + gx]);
}
function slopeDegAt(x: number, z: number): number {
  const e = 6;
  const dhdx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e);
  const dhdz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
  return (Math.atan(Math.hypot(dhdx, dhdz)) * 180) / Math.PI;
}

// ---------------------------------------------------------------- P1 lake surfaces
describe('P1 lake surfaces are flat and at the gazetteer altitude; shores are continuous', () => {
  it.each(LAKES.map((l) => l.id))('%s interior is flat at its own level', (id) => {
    const lake = LAKES.find((l) => l.id === id)!;
    const level = gameHeightFromAsl(lake.levelAsl);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [px, pz] of lake.poly) { minX = Math.min(minX, px); maxX = Math.max(maxX, px); minZ = Math.min(minZ, pz); maxZ = Math.max(maxZ, pz); }
    let n = 0, above = 0, worst = 0, nonWater = 0;
    for (let x = minX; x <= maxX; x += 20) for (let z = minZ; z <= maxZ; z += 20) {
      if (polygonSdf(x, z, lake.poly) > -25) continue; // 25 m inside the shore
      n++;
      const h = heightAt(x, z);
      if (h > level + 0.5) { above++; worst = Math.max(worst, h - level); }
      if (surfaceAt(x, z) !== 'water') nonWater++;
    }
    // eslint-disable-next-line no-console
    console.log(`[P1] ${id}: level=${level.toFixed(1)} samples=${n} bed-above-level=${above} worst=+${worst.toFixed(1)}m nonWater=${nonWater}`);
    expect(above, `${above}/${n} interior cells poke above the water plane (worst +${worst.toFixed(1)}m)`).toBe(0);
    expect(nonWater, `${nonWater}/${n} interior cells are not classified water`).toBe(0);
  });

  it.each(LAKES.map((l) => l.id))('%s: land just outside the shore is at/above water and rises gradually', (id) => {
    const lake = LAKES.find((l) => l.id === id)!;
    const level = gameHeightFromAsl(lake.levelAsl);
    let cx = 0, cz = 0;
    for (const [px, pz] of lake.poly) { cx += px; cz += pz; }
    cx /= lake.poly.length; cz /= lake.poly.length;
    const rise: number[] = []; let below = 0, worstStep = 0, worstAt = '';
    for (let i = 0; i < lake.poly.length; i++) {
      const [ax, az] = lake.poly[i], [bx, bz] = lake.poly[(i + 1) % lake.poly.length];
      const ex = bx - ax, ez = bz - az, el = Math.hypot(ex, ez) || 1;
      if (el < 60) continue;
      let nx = -ez / el, nz = ex / el;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      if ((mx - cx) * nx + (mz - cz) * nz < 0) { nx = -nx; nz = -nz; }
      let prev = heightAt(mx, mz);
      for (let d = 10; d <= 150; d += 10) {
        const x = mx + nx * d, z = mz + nz * d;
        if (Math.abs(polygonSdf(x, z, lake.poly) - d) > 15) break;
        const h = heightAt(x, z);
        if (d === 30) rise.push(h - level);
        if (h < level - 1) below++;
        const st = Math.abs(h - prev);
        if (st > worstStep) { worstStep = st; worstAt = `(${x.toFixed(0)},${z.toFixed(0)}) d=${d}`; }
        prev = h;
      }
    }
    const mean = rise.reduce((a, b) => a + b, 0) / Math.max(1, rise.length);
    // eslint-disable-next-line no-console
    console.log(`[P1] ${id}: mean rise 30m outside shore = ${mean.toFixed(1)}m, samples-below-water=${below}, worst 10m step ${worstStep.toFixed(1)}m at ${worstAt}`);
    expect(below, `${below} shore-band samples are BELOW the water level (lake would be a raised slab)`).toBe(0);
    expect(worstStep, `worst 10m shore step ${worstStep.toFixed(1)}m at ${worstAt}`).toBeLessThanOrEqual(12);
  });
});

// ---------------------------------------------------------------- P2 peaks/passes vs gazetteer
describe('P2 landmark peaks and passes match the gazetteer', () => {
  it('every landmark/pass is within max(10m, 10%) of its gazetteer height', () => {
    const rows: string[] = []; const bad: string[] = [];
    for (const p of Object.values(PLACES)) {
      if (p.kind !== 'landmark' && p.kind !== 'pass') continue;
      const h = heightAt(p.x, p.z), tol = Math.max(10, Math.abs(p.h) * 0.1);
      rows.push(`${p.id} ${h.toFixed(0)}/${p.h}`);
      if (Math.abs(h - p.h) > tol) bad.push(`${p.id} ${h.toFixed(1)} vs ${p.h}`);
    }
    // eslint-disable-next-line no-console
    console.log(`[P2] ${rows.join('  ')}`);
    expect(bad, bad.join('; ')).toEqual([]);
  });
  it('valley-floor places (village/town/port) are within 5m of the gazetteer', () => {
    const bad: string[] = [];
    for (const p of Object.values(PLACES)) {
      if (!['village', 'town', 'port', 'monastery', 'castle', 'church', 'bridge', 'mill'].includes(p.kind)) continue;
      const h = heightAt(p.x, p.z);
      if (Math.abs(h - p.h) > 5) bad.push(`${p.id} ${h.toFixed(1)} vs ${p.h}`);
    }
    // eslint-disable-next-line no-console
    console.log(`[P2] valley places off by >5m: ${bad.length ? bad.join('; ') : 'none'}`);
    expect(bad).toEqual([]);
  });
  it('the map maximum is plausible for the compressed scale (<= 900 game-m)', () => {
    let max = -Infinity, at = '';
    for (let gz = 0; gz < grid.height; gz += 2) for (let gx = 0; gx < grid.width; gx += 2) {
      const h = grid.heights[gz * grid.width + gx];
      if (h > max) { max = h; at = `(${(MAP_BOUNDS.minX + gx * scaleX).toFixed(0)},${(MAP_BOUNDS.minZ + gz * scaleZ).toFixed(0)})`; }
    }
    // eslint-disable-next-line no-console
    console.log(`[P2] map maximum ${max.toFixed(0)} game-m at ${at} (highest gazetteer landmark = ${Math.max(...Object.values(PLACES).map((p) => p.h))})`);
    expect(max).toBeLessThanOrEqual(900);
  });
});

// ---------------------------------------------------------------- P3 road continuity
describe('P3 road corridors are continuous and walkable', () => {
  function densify(id: string, stepM: number) {
    const c = buildWorldGeo().corridors.find((c) => c.id === id);
    if (!c) return [];
    const out: { x: number; z: number; s: number }[] = [{ x: c.pts[0].x, z: c.pts[0].z, s: c.pts[0].s }];
    for (let i = 1; i < c.pts.length; i++) {
      const a = c.pts[i - 1], b = c.pts[i], L = Math.max(1e-3, b.s - a.s), n = Math.max(1, Math.round(L / stepM));
      for (let j = 1; j <= n; j++) { const t = j / n; out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, s: a.s + L * t }); }
    }
    return out;
  }
  it('every road: max grade, %>30deg length, and road/settlement surface coverage', () => {
    const bad: string[] = [];
    for (const r of ROADS) {
      const pts = densify(r.id, 10);
      let maxG = 0, at = '', over30 = 0, hits = 0, water = 0;
      for (let i = 0; i < pts.length; i++) {
        const s = surfaceAt(pts[i].x, pts[i].z);
        if (s === 'road' || s === 'settlement' || s === 'mud') hits++;
        if (s === 'water') water++;
        if (i === 0) continue;
        const ds = Math.max(0.5, pts[i].s - pts[i - 1].s);
        const dh = Math.abs(heightAt(pts[i].x, pts[i].z) - heightAt(pts[i - 1].x, pts[i - 1].z));
        const g = (Math.atan2(dh, ds) * 180) / Math.PI;
        if (g > maxG) { maxG = g; at = `(${pts[i].x.toFixed(0)},${pts[i].z.toFixed(0)})`; }
        if (g > 30) over30 += ds;
      }
      const pct = (100 * hits) / pts.length;
      // eslint-disable-next-line no-console
      console.log(`[P3] ${r.id.padEnd(20)} len=${pts[pts.length - 1].s.toFixed(0)}m maxGrade=${maxG.toFixed(1)}deg at ${at}  >30deg:${over30.toFixed(0)}m  road/settle:${pct.toFixed(0)}%  water:${water}`);
      if (maxG > 30) bad.push(`${r.id} maxGrade ${maxG.toFixed(1)}deg`);
      if (pct < 90) bad.push(`${r.id} only ${pct.toFixed(0)}% road surface`);
      if (water > 0) bad.push(`${r.id} crosses water on ${water} samples`);
    }
    expect(bad, bad.join('; ')).toEqual([]);
  });
  it('Flüelen->Altdorf->Gotthard is a continuous walkable chain', () => {
    const chain = ['fluelen', 'altdorf', 'attinghausen', 'erstfeld', 'silenen', 'amsteg', 'goeschenen', 'teufelsbruecke', 'andermatt', 'hospental', 'gotthard'];
    const bad: string[] = [];
    for (let i = 1; i < chain.length; i++) {
      const a = PLACES[chain[i - 1]], b = PLACES[chain[i]];
      const L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.ceil(L / 10);
      let maxG = 0, prev = heightAt(a.x, a.z);
      for (let j = 1; j <= n; j++) {
        const t = j / n, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
        const h = heightAt(x, z);
        const g = (Math.atan2(Math.abs(h - prev), L / n) * 180) / Math.PI;
        maxG = Math.max(maxG, g); prev = h;
      }
      // eslint-disable-next-line no-console
      console.log(`[P3] ${chain[i - 1]}->${chain[i]} straight-line ${L.toFixed(0)}m maxGrade ${maxG.toFixed(1)}deg`);
      if (maxG > 40) bad.push(`${chain[i - 1]}->${chain[i]} ${maxG.toFixed(1)}deg`);
    }
    expect(bad, `straight-line segments impassable (>40deg): ${bad.join('; ')}`).toEqual([]);
  });
  it('Schwyz->Sattel->Morgarten is a continuous walkable chain', () => {
    const chain = ['schwyz', 'steinen', 'steinerberg', 'sattel', 'sattel-letzi', 'morgarten'];
    const bad: string[] = [];
    for (let i = 1; i < chain.length; i++) {
      const a = PLACES[chain[i - 1]], b = PLACES[chain[i]];
      const L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.ceil(L / 10);
      let maxG = 0, prev = heightAt(a.x, a.z);
      for (let j = 1; j <= n; j++) {
        const t = j / n, h = heightAt(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
        maxG = Math.max(maxG, (Math.atan2(Math.abs(h - prev), L / n) * 180) / Math.PI); prev = h;
      }
      // eslint-disable-next-line no-console
      console.log(`[P3] ${chain[i - 1]}->${chain[i]} straight-line ${L.toFixed(0)}m maxGrade ${maxG.toFixed(1)}deg`);
      if (maxG > 40) bad.push(`${chain[i - 1]}->${chain[i]} ${maxG.toFixed(1)}deg`);
    }
    expect(bad, bad.join('; ')).toEqual([]);
  });
});

// ---------------------------------------------------------------- P4 POIs dry and flat
describe('P4 every POI is dry, above water, and on <=30deg ground', () => {
  it('all gazetteer places', () => {
    const wet: string[] = [], steep: string[] = [], sunk: string[] = [];
    for (const p of Object.values(PLACES)) {
      if (surfaceAt(p.x, p.z) === 'water') wet.push(p.id);
      const s = slopeDegAt(p.x, p.z);
      if (s > 30) steep.push(`${p.id} ${s.toFixed(0)}deg`);
      for (const l of LAKES) if (pointInPolygon(p.x, p.z, l.poly) && heightAt(p.x, p.z) <= gameHeightFromAsl(l.levelAsl)) sunk.push(`${p.id} in ${l.id}`);
    }
    // eslint-disable-next-line no-console
    console.log(`[P4] n=${Object.keys(PLACES).length} wet=${wet.length ? wet.join(',') : 'none'} steep=${steep.length ? steep.join(',') : 'none'} submerged=${sunk.length ? sunk.join(',') : 'none'}`);
    expect(wet).toEqual([]);
    expect(sunk).toEqual([]);
    expect(steep).toEqual([]);
  });
});

// ---------------------------------------------------------------- P5 line of sight
describe('P5 the view from Seelisberg down the Urnersee is not occluded', () => {
  it('the lake surface is visible along the SSE sight line from the viewpoint', () => {
    const eye = { x: -405, y: 190, z: -247 }; // harness camera
    const terrainAtEye = heightAt(eye.x, eye.z);
    expect(eye.y - terrainAtEye, `camera is ${(eye.y - terrainAtEye).toFixed(1)}m above terrain`).toBeGreaterThan(5);
    // aim at the far end of the Urnersee (Flüelen)
    const tgt = PLACES['fluelen'];
    const L = Math.hypot(tgt.x - eye.x, tgt.z - eye.z);
    let blocked = 0, firstBlock = -1;
    for (let d = 20; d < L; d += 10) {
      const t = d / L, x = eye.x + (tgt.x - eye.x) * t, z = eye.z + (tgt.z - eye.z) * t;
      const rayY = eye.y + (tgt.h + 3 - eye.y) * t;
      if (heightAt(x, z) > rayY + 1) { blocked++; if (firstBlock < 0) firstBlock = d; }
    }
    // eslint-disable-next-line no-console
    console.log(`[P5] Seelisberg->Fluelen ${L.toFixed(0)}m: ${blocked} of ${Math.floor(L / 10)} ray samples occluded (first at ${firstBlock}m)`);
    expect(blocked, `sight line to Flüelen blocked at ${firstBlock}m`).toBeLessThanOrEqual(2);
  });
  it('the Urnersee water surface within 2 km is in view from the viewpoint', () => {
    const eye = { x: -405, y: 190, z: -247 };
    const lake = LAKES.find((l) => l.id === 'urnersee')!;
    const level = gameHeightFromAsl(lake.levelAsl);
    let visible = 0, total = 0;
    for (let z = -800; z <= 1400; z += 50) for (let x = -400; x <= 500; x += 50) {
      if (!pointInPolygon(x, z, lake.poly)) continue;
      total++;
      const L = Math.hypot(x - eye.x, z - eye.z);
      let ok = true;
      for (let d = 20; d < L; d += 12) {
        const t = d / L;
        if (heightAt(eye.x + (x - eye.x) * t, eye.z + (z - eye.z) * t) > eye.y + (level - eye.y) * t + 1) { ok = false; break; }
      }
      if (ok) visible++;
    }
    // eslint-disable-next-line no-console
    console.log(`[P5] Urnersee surface visible from Seelisberg viewpoint: ${visible}/${total} sample points (${((100 * visible) / total).toFixed(0)}%)`);
    expect((100 * visible) / total).toBeGreaterThanOrEqual(60);
  });
});

// ---------------------------------------------------------------- P6 terrain within 3 km
describe('P6 terrain and landmarks within the 3 km streaming radius of every POI', () => {
  it('reports how much of the horizon each POI can actually see (VIEW_RADIUS=3000)', () => {
    const VIEW = 3000;
    const far: string[] = [];
    for (const p of Object.values(PLACES)) {
      // is there any terrain >= 60 game-m above the POI within VIEW? (a "visible destination")
      let seen = false;
      for (let a = 0; a < 360 && !seen; a += 15) {
        const rad = (a * Math.PI) / 180;
        for (let d = 200; d <= VIEW; d += 100) {
          const x = p.x + Math.cos(rad) * d, z = p.z + Math.sin(rad) * d;
          if (x < MAP_BOUNDS.minX || x > MAP_BOUNDS.maxX || z < MAP_BOUNDS.minZ || z > MAP_BOUNDS.maxZ) break;
          if (heightAt(x, z) > p.h + 60) { seen = true; break; }
        }
      }
      if (!seen) far.push(p.id);
    }
    // eslint-disable-next-line no-console
    console.log(`[P6] POIs with NO terrain >=60m above them inside the 3km stream radius: ${far.length ? far.join(', ') : 'none'} (${far.length}/${Object.keys(PLACES).length})`);
    expect(far.length).toBeLessThanOrEqual(6);
  });
  it('reports the map area that lies further than 3 km from the nearest POI', () => {
    const pts = Object.values(PLACES);
    let n = 0, farN = 0;
    for (let x = MAP_BOUNDS.minX; x <= MAP_BOUNDS.maxX; x += 250) for (let z = MAP_BOUNDS.minZ; z <= MAP_BOUNDS.maxZ; z += 250) {
      n++;
      let best = Infinity;
      for (const p of pts) best = Math.min(best, Math.hypot(p.x - x, p.z - z));
      if (best > 3000) farN++;
    }
    // eslint-disable-next-line no-console
    console.log(`[P6] ${((100 * farN) / n).toFixed(1)}% of the map is >3km from any gazetteer place`);
    expect(true).toBe(true);
  });
});

// ---------------------------------------------------------------- P7 surface census + slope budget
describe('P7 surface census and slope distribution', () => {
  it('census', () => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < grid.surface.length; i += 3) {
      const s = surfaceNameOf(grid.surface[i]);
      counts[s] = (counts[s] ?? 0) + 1;
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    // eslint-disable-next-line no-console
    console.log(`[P7] ${Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${((100 * v) / total).toFixed(1)}%`).join('  ')}`);
    expect(counts['road'] ?? 0).toBeGreaterThan(0);
  });
  it('slope distribution over the whole map', () => {
    let n = 0; const buckets = [0, 0, 0, 0, 0]; // <30, 30-45, 45-60, 60-75, >75
    for (let gz = 1; gz < grid.height - 1; gz += 3) for (let gx = 1; gx < grid.width - 1; gx += 3) {
      const row = gz * grid.width;
      const dhdx = (grid.heights[row + gx + 1] - grid.heights[row + gx - 1]) / (2 * scaleX);
      const dhdz = (grid.heights[(gz + 1) * grid.width + gx] - grid.heights[(gz - 1) * grid.width + gx]) / (2 * scaleZ);
      const s = (Math.atan(Math.hypot(dhdx, dhdz)) * 180) / Math.PI;
      n++;
      buckets[s < 30 ? 0 : s < 45 ? 1 : s < 60 ? 2 : s < 75 ? 3 : 4]++;
    }
    // eslint-disable-next-line no-console
    console.log(`[P7] slope: <30 ${((100 * buckets[0]) / n).toFixed(1)}%  30-45 ${((100 * buckets[1]) / n).toFixed(1)}%  45-60 ${((100 * buckets[2]) / n).toFixed(1)}%  60-75 ${((100 * buckets[3]) / n).toFixed(2)}%  >75 ${((100 * buckets[4]) / n).toFixed(2)}%`);
    expect((100 * (buckets[3] + buckets[4])) / n, 'slope >60deg share of the map').toBeLessThanOrEqual(3);
  });
});
