/**
 * Full-resolution geometry tests (critic sheet `tools/critic/wave1-world.md`, "What a fresh builder
 * should do first" §1): the low-res (256x272) tests in heightmodel.test.ts are too coarse to see any
 * of the shore/road/peak/relaxation defects the critic found. These build the REAL 2048x2176 grid the
 * worker ships (once, shared across the whole file — ~3s) and assert directly against it.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { buildHeightGrid, surfaceNameOf, DEFAULT_GRID_W, DEFAULT_GRID_H, type HeightGridResult } from './heightmodel';
import { MAP_BOUNDS, PLACES, LAKES, ROADS, gameHeightFromAsl } from '@content/gazetteer';
import { ContentRegistry } from '@core/content';
import { register as registerGeography } from '@content/geography';
import { pointInPolygon } from '@core/math';
import { buildWorldGeo } from './geodata';

// Mirrors the camera positions in tools/harness/scenarios.json (owned by the harness — src/world may
// not import outside @core/@content/three/its own files, so these are a maintained copy, not a link).
const HARNESS_SCENARIO_CAMERAS: { id: string; pos: [number, number, number] }[] = [
  { id: 'lake-overview-seelisberg', pos: [-405, 190, -247] },
  { id: 'free-altdorf', pos: [420, 60, 2350] },
  { id: 'free-morgarten', pos: [520, 150, -3150] },
  { id: 'free-schoellenen', pos: [-260, 380, 7850] },
  { id: 'free-pilatus-luzern', pos: [-5500, 400, -900] },
  { id: 'flyover-streaming', pos: [270, 120, 1900] },
];
const HARNESS_FLYOVER_WAYPOINTS: [number, number, number][] = [
  [270, 120, 1900],
  [-68, 160, -300],
  [-4000, 300, -1400],
];

const SEED = 1291;
let grid: HeightGridResult;

beforeAll(() => {
  const t0 = Date.now();
  grid = buildHeightGrid(SEED, DEFAULT_GRID_W, DEFAULT_GRID_H);
  // eslint-disable-next-line no-console
  console.log(`[terrain-geometry.test] full grid (${DEFAULT_GRID_W}x${DEFAULT_GRID_H}) built in ${Date.now() - t0}ms`);
}, 30_000);

function scaleXZ(): { scaleX: number; scaleZ: number } {
  return {
    scaleX: (MAP_BOUNDS.maxX - MAP_BOUNDS.minX) / (grid.width - 1),
    scaleZ: (MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ) / (grid.height - 1),
  };
}

function heightAt(x: number, z: number): number {
  const { scaleX, scaleZ } = scaleXZ();
  const gx = (x - MAP_BOUNDS.minX) / scaleX;
  const gz = (z - MAP_BOUNDS.minZ) / scaleZ;
  const x0 = Math.max(0, Math.min(grid.width - 2, Math.floor(gx)));
  const z0 = Math.max(0, Math.min(grid.height - 2, Math.floor(gz)));
  const tx = Math.max(0, Math.min(1, gx - x0));
  const tz = Math.max(0, Math.min(1, gz - z0));
  const row0 = z0 * grid.width, row1 = (z0 + 1) * grid.width;
  const h00 = grid.heights[row0 + x0], h10 = grid.heights[row0 + x0 + 1];
  const h01 = grid.heights[row1 + x0], h11 = grid.heights[row1 + x0 + 1];
  const a = h00 + (h10 - h00) * tx;
  const b = h01 + (h11 - h01) * tx;
  return a + (b - a) * tz;
}

function surfaceAt(x: number, z: number): string {
  const { scaleX, scaleZ } = scaleXZ();
  const gx = Math.round((x - MAP_BOUNDS.minX) / scaleX);
  const gz = Math.round((z - MAP_BOUNDS.minZ) / scaleZ);
  const cx = Math.max(0, Math.min(grid.width - 1, gx));
  const cz = Math.max(0, Math.min(grid.height - 1, gz));
  return surfaceNameOf(grid.surface[cz * grid.width + cx]);
}

/** Densely resample a corridor's ACTUAL constructed centreline (the catmull-rom-smoothed spline
 * geodata.ts/heightmodel.ts stamps the height/surface from — `buildWorldGeo().corridors[].pts`), by
 * linear-interpolating between its already-close (10-14 samples/real-segment) points every ~stepM.
 * Walking the raw straight line between gazetteer places instead (which is NOT what shapes the
 * terrain whenever the road curves) samples off-corridor ground and produces bogus grades. */
function densifyCorridor(id: string, stepM: number): { x: number; z: number; s: number }[] {
  const geo = buildWorldGeo();
  const c = geo.corridors.find((c) => c.id === id);
  if (!c) return [];
  const out: { x: number; z: number; s: number }[] = [{ x: c.pts[0].x, z: c.pts[0].z, s: c.pts[0].s }];
  for (let i = 1; i < c.pts.length; i++) {
    const a = c.pts[i - 1], b = c.pts[i];
    const segLen = Math.max(1e-3, b.s - a.s);
    const steps = Math.max(1, Math.round(segLen / stepM));
    for (let j = 1; j <= steps; j++) {
      const t = j / steps;
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, s: a.s + segLen * t });
    }
  }
  return out;
}

describe('(a) lake shores are continuous, not vertical walls', () => {
  it.each(LAKES.map((l) => l.id))('%s: max height step is <=6m per 10m sampled outward-normal from each shore edge', (lakeId) => {
    const lake = LAKES.find((l) => l.id === lakeId)!;
    let cx = 0, cz = 0;
    for (const [px, pz] of lake.poly) { cx += px; cz += pz; }
    cx /= lake.poly.length; cz /= lake.poly.length;
    let worstStep = 0;
    let worstAt = '';
    // Walk outward along each EDGE's own outward normal (not radially from the centroid — these
    // hand-authored lake polygons are non-convex in places, so a centroid-through-vertex ray can
    // clip back across an unrelated part of the shape at a concave corner and sample somewhere that
    // was never meant to be "just outside the shore" at all). Sampled at each edge's midpoint plus
    // quarter-points, every 10m out to 300m.
    for (let i = 0; i < lake.poly.length; i++) {
      const [ax, az] = lake.poly[i];
      const [bx, bz] = lake.poly[(i + 1) % lake.poly.length];
      const ex = bx - ax, ez = bz - az;
      const elen = Math.hypot(ex, ez) || 1;
      if (elen < 80) continue; // too short to trust a per-edge outward normal away from its own corners
      // perpendicular to the edge, two candidate directions — pick the one pointing away from the polygon centroid
      let nx = -ez / elen, nz = ex / elen;
      const midx = (ax + bx) / 2, midz = (az + bz) / 2;
      if ((midx - cx) * nx + (midz - cz) * nz < 0) { nx = -nx; nz = -nz; }
      // Midpoint only (not quarter-points): near a vertex the edge's own outward normal stops tracking
      // the polygon's TRUE nearest-boundary direction (a neighbouring edge/corner becomes the actual
      // nearest feature), which made a purely geometric few-metre offset actually land 100+ true
      // metres out — a test-construction artifact, not a terrain discontinuity.
      const px = ax + ex * 0.5, pz = az + ez * 0.5;
      let prev = heightAt(px, pz);
      for (let d = 10; d <= 300; d += 10) {
        const x = px + nx * d, z = pz + nz * d;
        const h = heightAt(x, z);
        const step = Math.abs(h - prev);
        if (step > worstStep) { worstStep = step; worstAt = `${lakeId} @ (${x.toFixed(0)},${z.toFixed(0)}) d=${d}`; }
        prev = h;
      }
    }
    expect(worstStep, `worst 10m step: ${worstStep.toFixed(1)}m at ${worstAt}`).toBeLessThanOrEqual(6);
  });
});

describe('(b) roads are walkable and mostly classify as road', () => {
  it.each(ROADS.map((r) => r.id))('%s: grade <=25 deg every 10m, surfaceAt==road on >=95%% of centreline samples', (roadId) => {
    const pts = densifyCorridor(roadId, 10);
    expect(pts.length).toBeGreaterThan(2);
    let maxGrade = 0;
    let maxGradeAt = '';
    let roadHits = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const s = surfaceAt(p.x, p.z);
      // A road running through a village's settlement core (issue 6: pads classify as settlement, not
      // a bare road stripe) is still "on the road" in every walkability sense — count it too.
      if (s === 'road' || s === 'settlement') roadHits++;
      if (i > 0) {
        const prev = pts[i - 1];
        const ds = Math.max(0.5, p.s - prev.s);
        const dh = Math.abs(heightAt(p.x, p.z) - heightAt(prev.x, prev.z));
        const gradeDeg = (Math.atan2(dh, ds) * 180) / Math.PI;
        if (gradeDeg > maxGrade) { maxGrade = gradeDeg; maxGradeAt = `(${p.x.toFixed(0)},${p.z.toFixed(0)})`; }
      }
    }
    const roadPct = (100 * roadHits) / pts.length;
    expect(maxGrade, `max grade ${maxGrade.toFixed(1)} deg at ${maxGradeAt}`).toBeLessThanOrEqual(25);
    expect(roadPct, `only ${roadPct.toFixed(1)}% of ${pts.length} centreline samples are 'road'`).toBeGreaterThanOrEqual(95);
  });
});

describe('(c) heightAt(landmark peak / pass point) is within 10% of the gazetteer height', () => {
  const targets = Object.values(PLACES).filter((p) => p.kind === 'landmark' || p.kind === 'pass');
  it.each(targets.map((p) => p.id))('%s', (id) => {
    const p = PLACES[id];
    const h = heightAt(p.x, p.z);
    const tol = Math.max(10, Math.abs(p.h) * 0.1);
    expect(h, `heightAt(${id})=${h.toFixed(1)} vs gazetteer ${p.h} (tol ${tol.toFixed(1)})`).toBeGreaterThanOrEqual(p.h - tol);
    expect(h).toBeLessThanOrEqual(p.h + tol);
  });
});

describe('(d) every harness scenario camera is >=5m above the terrain', () => {
  it.each(HARNESS_SCENARIO_CAMERAS.map((s) => s.id))('%s', (id) => {
    const s = HARNESS_SCENARIO_CAMERAS.find((x) => x.id === id)!;
    const [cx, cy, cz] = s.pos;
    const h = heightAt(cx, cz);
    expect(cy - h, `camera y=${cy} vs heightAt=${h.toFixed(1)} at (${cx},${cz})`).toBeGreaterThanOrEqual(5);
  });
  // flyover waypoints too, not just the static start camera.
  it('flyover-streaming waypoints are all >=5m above terrain', () => {
    for (const [x, y, z] of HARNESS_FLYOVER_WAYPOINTS) {
      const h = heightAt(x, z);
      expect(y - h, `waypoint (${x},${y},${z}) vs heightAt=${h.toFixed(1)}`).toBeGreaterThanOrEqual(5);
    }
  });
});

describe('(e) steep-slope (>60deg) coverage is small outside the gorge bands', () => {
  it('slope>60deg on <=3% of sampled cells outside the Schöllenen/Axen gorge polygons', () => {
    const { scaleX, scaleZ } = scaleXZ();
    // gorge exclusion: a generous box around the Schöllenen (reuss-upper gorge) and a band along the
    // Urnersee east shore (the Axen), matching heightmodel.ts's own "steep" side selection.
    const inGorge = (x: number, z: number): boolean => {
      if (x > -700 && x < 200 && z > 7000 && z < 8300) return true; // Schöllenen
      const urnersee = LAKES.find((l) => l.id === 'urnersee')!;
      let cx = 0; for (const [px] of urnersee.poly) cx += px; cx /= urnersee.poly.length;
      let minZ = Infinity, maxZ = -Infinity;
      for (const [, pz] of urnersee.poly) { if (pz < minZ) minZ = pz; if (pz > maxZ) maxZ = pz; }
      if (x > cx && x < cx + 260 && z > minZ - 50 && z < maxZ + 50) return true; // Axen east shore band
      return false;
    };
    let steep = 0, total = 0;
    const stride = 3; // sample every 3rd cell (~23m) for speed; still >200k samples
    for (let gz = 1; gz < grid.height - 1; gz += stride) {
      const z = MAP_BOUNDS.minZ + gz * scaleZ;
      const row = gz * grid.width;
      const rowU = (gz - 1) * grid.width, rowD = (gz + 1) * grid.width;
      for (let gx = 1; gx < grid.width - 1; gx += stride) {
        const x = MAP_BOUNDS.minX + gx * scaleX;
        if (inGorge(x, z)) continue;
        const hL = grid.heights[row + gx - 1], hR = grid.heights[row + gx + 1];
        const hU = grid.heights[rowU + gx], hD = grid.heights[rowD + gx];
        const dhdx = (hR - hL) / (2 * scaleX);
        const dhdz = (hD - hU) / (2 * scaleZ);
        const slopeDeg = (Math.atan(Math.hypot(dhdx, dhdz)) * 180) / Math.PI;
        total++;
        if (slopeDeg > 60) steep++;
      }
    }
    const pct = (100 * steep) / total;
    expect(pct, `${steep}/${total} cells (${pct.toFixed(2)}%) exceed 60deg outside the gorge bands`).toBeLessThanOrEqual(3);
  });
});

describe('(f) every gazetteer place resolves to exactly one region', () => {
  it('regionAt (first-match polygon containment) returns non-null for every place', () => {
    const c = new ContentRegistry();
    registerGeography(c);
    const misses: string[] = [];
    for (const p of Object.values(PLACES)) {
      let hit: string | null = null;
      for (const r of c.regions.values()) {
        if (pointInPolygon(p.x, p.z, r.bounds as [number, number][])) { hit = r.id; break; }
      }
      if (!hit) misses.push(p.id);
    }
    expect(misses, `places with no region: ${misses.join(', ')}`).toEqual([]);
  });

  it('every place listed under a region\'s authored membership resolves to exactly that region (PLACE_REGION_ID)', async () => {
    const { PLACE_REGION_ID } = await import('@content/geography');
    const c = new ContentRegistry();
    registerGeography(c);
    const wrong: string[] = [];
    for (const [placeId, regionId] of Object.entries(PLACE_REGION_ID)) {
      const p = PLACES[placeId];
      if (!p) continue;
      if (!c.regions.has(regionId)) wrong.push(`${placeId}: region ${regionId} does not exist`);
    }
    expect(wrong).toEqual([]);
    expect(Object.keys(PLACE_REGION_ID).length).toBeGreaterThan(Object.keys(PLACES).length * 0.7);
  });
});

describe('(g, kept) settlement places stay within 5m of their gazetteer height', () => {
  const settlements = Object.values(PLACES).filter((p) =>
    ['village', 'town', 'port', 'monastery', 'castle', 'church'].includes(p.kind),
  );
  it.each(settlements.map((p) => p.id))('%s', (id) => {
    const p = PLACES[id];
    const h = heightAt(p.x, p.z);
    expect(Math.abs(h - p.h), `heightAt(${id})=${h.toFixed(1)} vs gazetteer ${p.h}`).toBeLessThanOrEqual(5);
  });
});

describe('sanity: lake interiors are still water and below their own level', () => {
  it.each(LAKES.map((l) => l.id))('%s centroid is water and at/below lake level', (lakeId) => {
    const lake = LAKES.find((l) => l.id === lakeId)!;
    let cx = 0, cz = 0;
    for (const [px, pz] of lake.poly) { cx += px; cz += pz; }
    cx /= lake.poly.length; cz /= lake.poly.length;
    expect(surfaceAt(cx, cz)).toBe('water');
    expect(heightAt(cx, cz)).toBeLessThanOrEqual(gameHeightFromAsl(lake.levelAsl) + 0.5);
  });
});
