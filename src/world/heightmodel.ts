/**
 * The terrain height + surface model. Pure functions over typed arrays so this file runs unmodified
 * on the main thread, inside terrain.worker.ts, and inside vitest (no three.js, no DOM).
 *
 * Pipeline (matches ARCHITECTURE.md §5.1 / BUILDER task §1):
 *  1. base regional "ridge" field (broad low-frequency undulation, higher away from the lake)
 *  2. peak bumps (massifs / summits), max-blended so overlapping peaks don't stack additively
 *  3. river + road corridors carve valley floors and saddle passes, blended in by distance
 *  4. multi-octave detail noise, amplitude scaled by local slope (more texture on steep ground)
 *  5. thermal-erosion-like smoothing so it reads as terrain, not noise
 *  6. lakes flattened to their level with a shelf + drop
 *  7. settlement pads flattened
 * A final classification pass produces the (season-independent) surface mask.
 */
import { MAP_BOUNDS } from '@content/gazetteer';
import { clamp, pointInPolygon, smoothstep } from '@core/math';
import { fbm2D, ridge2D } from './noise';
import { buildWorldGeo, nearestOnSpline, valleyProfile, peakBump, lakeShelf, type WorldGeo, type Corridor } from './geodata';

export const MAP_W = MAP_BOUNDS.maxX - MAP_BOUNDS.minX;
export const MAP_D = MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ;
export const DEFAULT_GRID_W = 2048;
export const DEFAULT_GRID_H = 2176;
export const TEXEL_M = MAP_W / DEFAULT_GRID_W; // ~7.8125, same on both axes for the default grid

export const SURFACE_IDS = ['grass', 'rock', 'forest', 'scree', 'water', 'mud', 'road', 'settlement', 'meadow'] as const;
export type SurfaceName = (typeof SURFACE_IDS)[number];
const SURFACE_INDEX: Record<SurfaceName, number> = Object.fromEntries(SURFACE_IDS.map((s, i) => [s, i])) as any;

export function surfaceIdOf(name: SurfaceName): number { return SURFACE_INDEX[name]; }
export function surfaceNameOf(id: number): SurfaceName { return SURFACE_IDS[id] ?? 'grass'; }

/** surfaceId -> shader blend group (grass=0, forest=1, rock/scree=2, path[mud/road/settlement/water]=3).
 * Used by chunkmesh.ts (baked per-vertex, worker-safe) and terrainMaterial.ts (the shader's grouping). */
export const BLEND_GROUP = [0, 2, 1, 2, 3, 3, 3, 3, 0] as const;

export interface HeightGridResult {
  width: number;
  height: number;
  bounds: typeof MAP_BOUNDS;
  heights: Float32Array;
  surface: Uint8Array;
}

let lakeCentroidsCache: Float64Array | null = null;
function lakeCentroids(geo: WorldGeo): Float64Array {
  if (lakeCentroidsCache) return lakeCentroidsCache;
  const arr = new Float64Array(geo.lakes.length * 2);
  geo.lakes.forEach((l, i) => {
    let cx = 0, cz = 0;
    for (const [px, pz] of l.poly) { cx += px; cz += pz; }
    arr[i * 2] = cx / l.poly.length;
    arr[i * 2 + 1] = cz / l.poly.length;
  });
  lakeCentroidsCache = arr;
  return arr;
}

function edgeFactor(x: number, z: number, centroids: Float64Array): number {
  // gentle rise the further a point is from the nearest lake centroid; keeps the lake basin low
  // and pushes the map edges (real mountain country) higher on average.
  let best = Infinity;
  for (let i = 0; i < centroids.length; i += 2) {
    const dx = x - centroids[i], dz = z - centroids[i + 1];
    const d2 = dx * dx + dz * dz;
    if (d2 < best) best = d2;
  }
  return clamp(Math.sqrt(best) / 6500, 0, 1);
}

function baseRidge(x: number, z: number, seed: number, centroids: Float64Array): number {
  const n = fbm2D(x, z, { octaves: 2, frequency: 1 / 2600, seed });
  const edge = edgeFactor(x, z, centroids);
  return 60 + edge * 260 + n * 90 * (0.4 + edge);
}

/** Snow line (game metres above lake) for a season; used by the live surfaceAt() override, not baked. */
export function snowLineFor(season: 'winter' | 'spring' | 'summer' | 'autumn'): number {
  switch (season) {
    case 'winter': return 250;
    case 'spring': return 550;
    case 'autumn': return 700;
    default: return 900;
  }
}
export const FOREST_MAX_H = (1500 - 434) / 3; // real 1500 m a.s.l. tree line -> game height above lake

export function buildHeightGrid(seed: number, width = DEFAULT_GRID_W, height = DEFAULT_GRID_H): HeightGridResult {
  const geo = buildWorldGeo();
  const scaleX = MAP_W / (width - 1);
  const scaleZ = MAP_D / (height - 1);
  const toX = (gx: number) => MAP_BOUNDS.minX + gx * scaleX;
  const toZ = (gz: number) => MAP_BOUNDS.minZ + gz * scaleZ;
  const n = width * height;

  const heights = new Float32Array(n);
  const roadMask = new Uint8Array(n);
  const mudMask = new Uint8Array(n);

  // 1. base ridge field
  const centroids = lakeCentroids(geo);
  for (let gz = 0; gz < height; gz++) {
    const z = toZ(gz);
    const row = gz * width;
    for (let gx = 0; gx < width; gx++) {
      heights[row + gx] = baseRidge(toX(gx), z, seed, centroids);
    }
  }

  // 2. peaks: max-blended additive bumps (a separate buffer avoids double-counting where massifs overlap)
  const peakAdd = new Float32Array(n);
  for (const p of geo.peaks) {
    const rx = (p.radius * 1.6) / scaleX;
    const rz = (p.radius * 1.6) / scaleZ;
    const gx0 = Math.max(0, Math.floor((p.x - MAP_BOUNDS.minX) / scaleX - rx));
    const gx1 = Math.min(width - 1, Math.ceil((p.x - MAP_BOUNDS.minX) / scaleX + rx));
    const gz0 = Math.max(0, Math.floor((p.z - MAP_BOUNDS.minZ) / scaleZ - rz));
    const gz1 = Math.min(height - 1, Math.ceil((p.z - MAP_BOUNDS.minZ) / scaleZ + rz));
    for (let gz = gz0; gz <= gz1; gz++) {
      const z = toZ(gz);
      const row = gz * width;
      for (let gx = gx0; gx <= gx1; gx++) {
        const x = toX(gx);
        const bump = peakBump(Math.hypot(x - p.x, z - p.z), p);
        if (bump > 0) { const idx = row + gx; if (bump > peakAdd[idx]) peakAdd[idx] = bump; }
      }
    }
  }
  for (let i = 0; i < n; i++) heights[i] += peakAdd[i];

  // 3. corridors (rivers + roads): nearest-wins distance/valley-height/weight splat
  const bestDist = new Float32Array(n).fill(Infinity);
  const bestValleyH = new Float32Array(n);
  const bestWeight = new Float32Array(n);
  for (const c of geo.corridors) {
    for (let pi = 0; pi < c.pts.length; pi += 1) {
      const sp = c.pts[pi];
      const rx = sp.influence / scaleX;
      const rz = sp.influence / scaleZ;
      const gx = (sp.x - MAP_BOUNDS.minX) / scaleX;
      const gz = (sp.z - MAP_BOUNDS.minZ) / scaleZ;
      const gx0 = Math.max(0, Math.floor(gx - rx));
      const gx1 = Math.min(width - 1, Math.ceil(gx + rx));
      const gz0 = Math.max(0, Math.floor(gz - rz));
      const gz1 = Math.min(height - 1, Math.ceil(gz + rz));
      for (let gzz = gz0; gzz <= gz1; gzz++) {
        const z = toZ(gzz);
        const row = gzz * width;
        const dz = z - sp.z;
        for (let gxx = gx0; gxx <= gx1; gxx++) {
          const x = toX(gxx);
          const dx = x - sp.x;
          const d = Math.sqrt(dx * dx + dz * dz);
          if (d >= sp.influence) continue;
          const idx = row + gxx;
          if (d < bestDist[idx]) {
            bestDist[idx] = d;
            bestValleyH[idx] = valleyProfile(d, sp.h, sp);
            const w = 1 - smoothstep(sp.halfWidth, sp.influence, d);
            bestWeight[idx] = w;
          }
        }
      }
    }
    // stamp the narrow surface band (road bed / river mud strip)
    for (const sp of c.pts) {
      const half = sp.corridorWidthM * 0.65;
      const rx2 = half / scaleX + 1, rz2 = half / scaleZ + 1;
      const gx = (sp.x - MAP_BOUNDS.minX) / scaleX;
      const gz = (sp.z - MAP_BOUNDS.minZ) / scaleZ;
      const gx0 = Math.max(0, Math.floor(gx - rx2));
      const gx1 = Math.min(width - 1, Math.ceil(gx + rx2));
      const gz0 = Math.max(0, Math.floor(gz - rz2));
      const gz1 = Math.min(height - 1, Math.ceil(gz + rz2));
      for (let gzz = gz0; gzz <= gz1; gzz++) {
        const z = toZ(gzz);
        const row = gzz * width;
        for (let gxx = gx0; gxx <= gx1; gxx++) {
          const x = toX(gxx);
          if (Math.hypot(x - sp.x, z - sp.z) > half) continue;
          const idx = row + gxx;
          if (c.surface === 'road') roadMask[idx] = 1;
          else if (c.surface === 'mud') mudMask[idx] = 1;
        }
      }
    }
  }
  for (let i = 0; i < n; i++) heights[i] = heights[i] + (bestValleyH[i] - heights[i]) * bestWeight[i];

  // 4. detail noise, amplitude scaled by local pre-noise slope
  const slopePre = computeSlope(heights, width, height, scaleX, scaleZ);
  for (let gz = 0; gz < height; gz++) {
    const z = toZ(gz);
    const row = gz * width;
    for (let gx = 0; gx < width; gx++) {
      const idx = row + gx;
      const x = toX(gx);
      const slope01 = clamp(slopePre[idx] / 1.1, 0, 1);
      const fine = fbm2D(x, z, { octaves: 3, frequency: 1 / 46, seed: seed + 900 }) * (2 + slope01 * 9);
      const jag = ridge2D(x, z, { octaves: 2, frequency: 1 / 130, seed: seed + 1900 }) * slope01 * 7;
      heights[idx] += fine + jag;
    }
  }

  // 5. thermal-erosion-like smoothing (slope-limited diffusion)
  thermalSmooth(heights, width, height, scaleX, scaleZ, 2);

  // 6. lakes
  for (const lake of geo.lakes) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [px, pz] of lake.poly) { if (px < minX) minX = px; if (px > maxX) maxX = px; if (pz < minZ) minZ = pz; if (pz > maxZ) maxZ = pz; }
    const gx0 = Math.max(0, Math.floor((minX - 60 - MAP_BOUNDS.minX) / scaleX));
    const gx1 = Math.min(width - 1, Math.ceil((maxX + 60 - MAP_BOUNDS.minX) / scaleX));
    const gz0 = Math.max(0, Math.floor((minZ - 60 - MAP_BOUNDS.minZ) / scaleZ));
    const gz1 = Math.min(height - 1, Math.ceil((maxZ + 60 - MAP_BOUNDS.minZ) / scaleZ));
    for (let gz = gz0; gz <= gz1; gz++) {
      const z = toZ(gz);
      const row = gz * width;
      for (let gx = gx0; gx <= gx1; gx++) {
        const x = toX(gx);
        const h = lakeShelf(x, z, lake);
        if (h !== null) heights[row + gx] = h;
      }
    }
  }

  // 7. settlement pads
  const padMask = new Uint8Array(n);
  for (const pad of geo.pads) {
    const rx = pad.radius / scaleX, rz = pad.radius / scaleZ;
    const gx0 = Math.max(0, Math.floor((pad.x - MAP_BOUNDS.minX) / scaleX - rx));
    const gx1 = Math.min(width - 1, Math.ceil((pad.x - MAP_BOUNDS.minX) / scaleX + rx));
    const gz0 = Math.max(0, Math.floor((pad.z - MAP_BOUNDS.minZ) / scaleZ - rz));
    const gz1 = Math.min(height - 1, Math.ceil((pad.z - MAP_BOUNDS.minZ) / scaleZ + rz));
    for (let gz = gz0; gz <= gz1; gz++) {
      const z = toZ(gz);
      const row = gz * width;
      for (let gx = gx0; gx <= gx1; gx++) {
        const x = toX(gx);
        const d = Math.hypot(x - pad.x, z - pad.z);
        if (d >= pad.radius) continue;
        const idx = row + gx;
        const w = 1 - smoothstep(pad.radius * 0.7, pad.radius, d);
        heights[idx] = heights[idx] + (pad.h - heights[idx]) * w;
        if (d < pad.radius * 0.85) padMask[idx] = 1;
      }
    }
  }

  // classification
  const slope = computeSlope(heights, width, height, scaleX, scaleZ);
  const surface = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const h = heights[i];
    const s = slope[i];
    let name: SurfaceName;
    if (padMask[i]) name = 'settlement';
    else if (roadMask[i]) name = 'road';
    else if (mudMask[i] && s < 0.35) name = 'mud';
    else if (s > 0.85) name = 'rock';
    else if (s > 0.5) name = 'scree';
    else if (h < FOREST_MAX_H && s > 0.06) name = 'forest';
    else if (h < FOREST_MAX_H * 0.6) name = 'meadow';
    else name = 'grass';
    surface[i] = surfaceIdOf(name);
  }

  // water mask last, drawn from the polygon test directly (cheap: only near-shore band matters visually,
  // but for correctness of isWater()/surfaceAt() we classify the whole lake interior).
  for (const lake of geo.lakes) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [px, pz] of lake.poly) { if (px < minX) minX = px; if (px > maxX) maxX = px; if (pz < minZ) minZ = pz; if (pz > maxZ) maxZ = pz; }
    const gx0 = Math.max(0, Math.floor((minX - MAP_BOUNDS.minX) / scaleX));
    const gx1 = Math.min(width - 1, Math.ceil((maxX - MAP_BOUNDS.minX) / scaleX));
    const gz0 = Math.max(0, Math.floor((minZ - MAP_BOUNDS.minZ) / scaleZ));
    const gz1 = Math.min(height - 1, Math.ceil((maxZ - MAP_BOUNDS.minZ) / scaleZ));
    for (let gz = gz0; gz <= gz1; gz++) {
      const z = toZ(gz);
      const row = gz * width;
      for (let gx = gx0; gx <= gx1; gx++) {
        const x = toX(gx);
        if (pointInPolygon(x, z, lake.poly)) surface[row + gx] = surfaceIdOf('water');
      }
    }
  }

  return { width, height, bounds: MAP_BOUNDS, heights, surface };
}

function computeSlope(heights: Float32Array, width: number, height: number, scaleX: number, scaleZ: number): Float32Array {
  const slope = new Float32Array(width * height);
  for (let gz = 0; gz < height; gz++) {
    const row = gz * width;
    const zUp = Math.max(0, gz - 1) * width;
    const zDn = Math.min(height - 1, gz + 1) * width;
    for (let gx = 0; gx < width; gx++) {
      const xL = Math.max(0, gx - 1);
      const xR = Math.min(width - 1, gx + 1);
      const dhdx = (heights[row + xR] - heights[row + xL]) / (2 * scaleX);
      const dhdz = (heights[zDn + gx] - heights[zUp + gx]) / (2 * scaleZ);
      slope[row + gx] = Math.atan(Math.hypot(dhdx, dhdz));
    }
  }
  return slope;
}

function thermalSmooth(heights: Float32Array, width: number, height: number, scaleX: number, scaleZ: number, iterations: number): void {
  const tmp = new Float32Array(heights.length);
  const avgScale = (scaleX + scaleZ) * 0.5;
  for (let it = 0; it < iterations; it++) {
    for (let gz = 0; gz < height; gz++) {
      const row = gz * width;
      const zUp = Math.max(0, gz - 1) * width;
      const zDn = Math.min(height - 1, gz + 1) * width;
      for (let gx = 0; gx < width; gx++) {
        const xL = Math.max(0, gx - 1);
        const xR = Math.min(width - 1, gx + 1);
        const idx = row + gx;
        const hL = heights[row + xL], hR = heights[row + xR], hU = heights[zUp + gx], hD = heights[zDn + gx];
        const avg = (hL + hR + hU + hD) * 0.25;
        // steeper slopes relax more toward the neighbour average (material "slides"); a raw gradient
        // magnitude (no atan) is enough here since it's only used as a relative 0..1 blend weight.
        const grad = Math.max(Math.abs(hR - hL), Math.abs(hD - hU)) / avgScale;
        const amt = clamp(grad / 0.9, 0, 1) * 0.55;
        tmp[idx] = heights[idx] + (avg - heights[idx]) * amt;
      }
    }
    heights.set(tmp);
  }
}

export { nearestOnSpline };
export type { WorldGeo, Corridor };
