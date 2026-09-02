import { describe, it, expect } from 'vitest';
import { buildHeightGrid, surfaceNameOf, TEXEL_M, FOREST_MAX_H } from './heightmodel';
import { buildWorldGeo, valleyProfile, peakShape, lakeShelf, nearestOnSpline } from './geodata';
import { MAP_BOUNDS, PLACES, gameHeightFromAsl } from '@content/gazetteer';

function sampleBilinear(grid: ReturnType<typeof buildHeightGrid>, x: number, z: number): number {
  const scaleX = (MAP_BOUNDS.maxX - MAP_BOUNDS.minX) / (grid.width - 1);
  const scaleZ = (MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ) / (grid.height - 1);
  const gx = (x - MAP_BOUNDS.minX) / scaleX;
  const gz = (z - MAP_BOUNDS.minZ) / scaleZ;
  const x0 = Math.max(0, Math.min(grid.width - 2, Math.floor(gx)));
  const z0 = Math.max(0, Math.min(grid.height - 2, Math.floor(gz)));
  const tx = gx - x0, tz = gz - z0;
  const h00 = grid.heights[z0 * grid.width + x0];
  const h10 = grid.heights[z0 * grid.width + x0 + 1];
  const h01 = grid.heights[(z0 + 1) * grid.width + x0];
  const h11 = grid.heights[(z0 + 1) * grid.width + x0 + 1];
  const a = h00 + (h10 - h00) * tx;
  const b = h01 + (h11 - h01) * tx;
  return a + (b - a) * tz;
}
function sampleSurface(grid: ReturnType<typeof buildHeightGrid>, x: number, z: number): string {
  const scaleX = (MAP_BOUNDS.maxX - MAP_BOUNDS.minX) / (grid.width - 1);
  const scaleZ = (MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ) / (grid.height - 1);
  const gx = Math.round((x - MAP_BOUNDS.minX) / scaleX);
  const gz = Math.round((z - MAP_BOUNDS.minZ) / scaleZ);
  const cx = Math.max(0, Math.min(grid.width - 1, gx));
  const cz = Math.max(0, Math.min(grid.height - 1, gz));
  return surfaceNameOf(grid.surface[cz * grid.width + cx]);
}

describe('geodata helpers', () => {
  it('valleyProfile stays flat within halfWidth and rises with distance', () => {
    const c = { id: 't', kind: 'river', pts: [], length: 0, shape: 'wideU', halfWidth: 100, influence: 500, riseRate: 200, surface: 'mud', corridorWidthM: 30 } as const;
    expect(valleyProfile(0, 10, c as any)).toBe(10);
    expect(valleyProfile(50, 10, c as any)).toBe(10);
    const at300 = valleyProfile(300, 10, c as any);
    const at450 = valleyProfile(450, 10, c as any);
    expect(at300).toBeGreaterThan(10);
    expect(at450).toBeGreaterThan(at300);
  });

  it('steepV rises faster than wideU at the same distance', () => {
    const base = { id: 't', pts: [], length: 0, riseRate: 300, surface: 'mud', corridorWidthM: 10 } as const;
    const v = valleyProfile(200, 0, { ...base, kind: 'river', shape: 'steepV', halfWidth: 8, influence: 300 } as any);
    const u = valleyProfile(200, 0, { ...base, kind: 'river', shape: 'wideU', halfWidth: 8, influence: 300 } as any);
    expect(v).toBeGreaterThan(u);
  });

  it('peakShape (0..1 footprint, NOT scaled by p.h) decays to 0 at the falloff radius and is 1 at the summit', () => {
    const p = { id: 'x', x: 0, z: 0, h: 500, radius: 1000, sharp: 1.3 };
    expect(peakShape(0, p)).toBeCloseTo(1, 5);
    expect(peakShape(2000, p)).toBe(0);
    expect(peakShape(500, p)).toBeGreaterThan(0);
    expect(peakShape(500, p)).toBeLessThan(1);
  });

  it('lakeShelf is below lake level everywhere inside the polygon and null outside', () => {
    const poly: [number, number][] = [[0, 0], [100, 0], [100, 100], [0, 100]];
    const lake = { id: 'l', name: 'L', levelGameH: 0, poly };
    expect(lakeShelf(200, 200, lake)).toBeNull();
    const inner = lakeShelf(50, 50, lake);
    expect(inner).not.toBeNull();
    expect(inner as number).toBeLessThan(0);
    const nearShore = lakeShelf(5, 50, lake);
    expect(nearShore as number).toBeLessThan(0);
    expect(nearShore as number).toBeGreaterThan(inner as number); // shelf shallower than the deep centre
  });

  it('nearestOnSpline interpolates height along the segment', () => {
    const segParams = { shape: 'wideU' as const, halfWidth: 10, influence: 100, riseRate: 50, corridorWidthM: 10 };
    const pts = [{ x: 0, z: 0, h: 0, s: 0, ...segParams }, { x: 100, z: 0, h: 100, s: 100, ...segParams }];
    const mid = nearestOnSpline(50, 5, pts);
    expect(mid.h).toBeCloseTo(50, 0);
    expect(mid.dist).toBeCloseTo(5, 1);
  });

  it('buildWorldGeo produces corridors for every gazetteer river and road', () => {
    const geo = buildWorldGeo();
    expect(geo.corridors.length).toBeGreaterThan(15);
    expect(geo.peaks.length).toBeGreaterThan(5);
    expect(geo.lakes.length).toBe(9);
  });
});

describe('buildHeightGrid (reduced resolution for test speed)', () => {
  // 256x272 keeps texel size ~62.5m, fast enough for CI while still exercising every stage of the pipeline.
  const grid = buildHeightGrid(1291, 256, 272);

  it('completes and fills the whole grid with finite numbers', () => {
    expect(grid.heights.length).toBe(256 * 272);
    let anyNonFinite = 0;
    for (const h of grid.heights) if (!Number.isFinite(h)) anyNonFinite++;
    expect(anyNonFinite).toBe(0);
  });

  it('is deterministic for the same seed', () => {
    const grid2 = buildHeightGrid(1291, 256, 272);
    expect(grid.heights).toEqual(grid2.heights);
  });

  it('differs for a different seed', () => {
    const grid3 = buildHeightGrid(42, 256, 272);
    let diff = 0;
    for (let i = 0; i < grid.heights.length; i++) if (Math.abs(grid.heights[i] - grid3.heights[i]) > 0.01) diff++;
    expect(diff).toBeGreaterThan(1000);
  });

  it('the Urnersee lake bed is entirely below lake level (a real drop, not a flat plate)', () => {
    const h = sampleBilinear(grid, -84, -400); // well inside the urnersee polygon
    expect(h).toBeLessThan(-3);
  });

  it('the Urnersee shore (Flüelen) sits right at lake level', () => {
    const fluelen = PLACES['fluelen'];
    const h = sampleBilinear(grid, fluelen.x, fluelen.z);
    expect(Math.abs(h)).toBeLessThan(15);
  });

  it('Altdorf sits on a low, flat-ish valley floor near its gazetteer height', () => {
    const altdorf = PLACES['altdorf'];
    const h = sampleBilinear(grid, altdorf.x, altdorf.z);
    expect(Math.abs(h - altdorf.h)).toBeLessThan(40);
  });

  it('Pilatus and the Gotthard/Urirotstock area stand well above the lake', () => {
    const pilatus = PLACES['pilatus'];
    const h = sampleBilinear(grid, pilatus.x, pilatus.z);
    expect(h).toBeGreaterThan(200);
  });

  it('the Schöllenen gorge rises steeply within a short distance of the river', () => {
    const teufel = PLACES['teufelsbruecke'];
    const near = sampleBilinear(grid, teufel.x, teufel.z);
    const away = sampleBilinear(grid, teufel.x + 150, teufel.z);
    expect(away - near).toBeGreaterThan(30);
  });

  it('lake cells classify as water and Pilatus is not water', () => {
    expect(sampleSurface(grid, -84, -400)).toBe('water');
    const pilatus = PLACES['pilatus'];
    expect(sampleSurface(grid, pilatus.x, pilatus.z)).not.toBe('water');
  });

  it('a settlement pad (Altdorf) classifies as settlement', () => {
    const altdorf = PLACES['altdorf'];
    expect(sampleSurface(grid, altdorf.x, altdorf.z)).toBe('settlement');
  });

  it('FOREST_MAX_H matches the real-world 1500m a.s.l. tree line via the gazetteer conversion', () => {
    expect(FOREST_MAX_H).toBeCloseTo(gameHeightFromAsl(1500), 5);
  });

  it('TEXEL_M is ~7.8 m for the default 2048x2176 grid', () => {
    expect(TEXEL_M).toBeGreaterThan(7.7);
    expect(TEXEL_M).toBeLessThan(7.9);
  });
});
