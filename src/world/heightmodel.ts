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
import { clamp, pointInPolygon, polygonSdf, smoothstep } from '@core/math';
import { fbm2D, ridge2D } from './noise';
import {
  buildWorldGeo, nearestOnSpline, valleyProfile, peakShape, lakeShelf, segmentDistT, limitGrade, shoreProfile,
  type WorldGeo, type Corridor,
} from './geodata';

export const MAP_W = MAP_BOUNDS.maxX - MAP_BOUNDS.minX;
export const MAP_D = MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ;
export const DEFAULT_GRID_W = 2048;
export const DEFAULT_GRID_H = 2176;
export const TEXEL_M = MAP_W / DEFAULT_GRID_W; // ~7.8125, same on both axes for the default grid

// NOTE: 'snow' is appended at the END, not inserted alphabetically/logically — chunkmesh.ts hardcodes
// `sid === 4 /* water */`, so every existing index must stay put. 'snow' is never baked into this
// array (the bake is season-independent); it exists so SurfaceName/surfaceIdOf can round-trip the
// *live* snow-line override WorldService.surfaceAt() applies on top of the baked classification.
export const SURFACE_IDS = ['grass', 'rock', 'forest', 'scree', 'water', 'mud', 'road', 'settlement', 'meadow', 'snow'] as const;
export type SurfaceName = (typeof SURFACE_IDS)[number];
const SURFACE_INDEX: Record<SurfaceName, number> = Object.fromEntries(SURFACE_IDS.map((s, i) => [s, i])) as any;

export function surfaceIdOf(name: SurfaceName): number { return SURFACE_INDEX[name]; }
export function surfaceNameOf(id: number): SurfaceName { return SURFACE_IDS[id] ?? 'grass'; }

/** surfaceId -> shader blend group (grass=0, forest=1, rock/scree=2, path[mud/road/settlement/water]=3).
 * Used by chunkmesh.ts (baked per-vertex, worker-safe) and terrainMaterial.ts (the shader's grouping).
 * snow (index 9) is never baked, but needs a slot; group it with rock (2) as a harmless default. */
export const BLEND_GROUP = [0, 2, 1, 2, 3, 3, 3, 3, 0, 2] as const;

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

/** How strongly a peak may raise the terrain here, damped only within ~150m of an actual shoreline
 * (not the old global 380m damp that flattened every peak footprint anywhere near a lake). Real
 * shores like the Bürgenstock ARE lakeside cliffs — the peak should reach full strength quickly away
 * from the water; the lake-shore blend pass (buildHeightGrid step 6) is what actually shapes the
 * continuous shore-to-mountain transition now, this just keeps a peak's target from fighting that
 * pass in the narrow band right at the waterline. */
function shoreDampNear(x: number, z: number, geo: WorldGeo, centroids: Float64Array): number {
  let nearest = -1;
  let bestD2 = Infinity;
  for (let i = 0; i < geo.lakes.length; i++) {
    const dx = x - centroids[i * 2], dz = z - centroids[i * 2 + 1];
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2) { bestD2 = d2; nearest = i; }
  }
  if (nearest < 0 || bestD2 > 1200 * 1200) return 1;
  const d = polygonSdf(x, z, geo.lakes[nearest].poly); // negative inside the lake
  return smoothstep(-40, 150, d);
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

  // 2. corridors, PASS 1 (geometry only — distance/floor-height/blend-weight per cell): computed
  // *before* peaks so peak shaping (step 3) can damp itself out near a road/river (see below). This
  // pass alone doesn't touch `heights[]` yet; step 4 applies the actual blend after peaks are folded
  // in. Nearest-wins distance-TO-SEGMENT (continuous along the whole spline — no gaps between
  // samples), height profile pre-clamped to a walkable max grade.
  const bestDist = new Float32Array(n).fill(Infinity);
  const bestValleyH = new Float32Array(n);
  const bestWeight = new Float32Array(n);
  const MAX_GRADE_TAN = Math.tan((22 * Math.PI) / 180);
  for (const c of geo.corridors) {
    const limitedH = limitGrade(c.pts, MAX_GRADE_TAN);
    for (let pi = 1; pi < c.pts.length; pi++) {
      const a = c.pts[pi - 1], b = c.pts[pi];
      const ha = limitedH[pi - 1], hb = limitedH[pi];
      const influence = Math.max(a.influence, b.influence);
      const halfWidth = Math.max(a.halfWidth, b.halfWidth);
      const minX = Math.min(a.x, b.x) - influence, maxX = Math.max(a.x, b.x) + influence;
      const minZ = Math.min(a.z, b.z) - influence, maxZ = Math.max(a.z, b.z) + influence;
      const gx0 = Math.max(0, Math.floor((minX - MAP_BOUNDS.minX) / scaleX));
      const gx1 = Math.min(width - 1, Math.ceil((maxX - MAP_BOUNDS.minX) / scaleX));
      const gz0 = Math.max(0, Math.floor((minZ - MAP_BOUNDS.minZ) / scaleZ));
      const gz1 = Math.min(height - 1, Math.ceil((maxZ - MAP_BOUNDS.minZ) / scaleZ));
      for (let gzz = gz0; gzz <= gz1; gzz++) {
        const z = toZ(gzz);
        const row = gzz * width;
        for (let gxx = gx0; gxx <= gx1; gxx++) {
          const x = toX(gxx);
          const { dist: d, t } = segmentDistT(x, z, a.x, a.z, b.x, b.z);
          if (d >= influence) continue;
          const idx = row + gxx;
          if (d < bestDist[idx]) {
            bestDist[idx] = d;
            const floorH = ha + (hb - ha) * t;
            bestValleyH[idx] = valleyProfile(d, floorH, b);
            bestWeight[idx] = 1 - smoothstep(halfWidth, influence, d);
          }
          // surface band (road bed / river mud strip), stamped from the same segment pass so it is
          // continuous too — this is what gets 'road' onto ≥95% of centreline samples instead of the
          // old 100-300m-apart sample discs.
          const half = Math.max(a.corridorWidthM, b.corridorWidthM) * 0.65;
          if (d <= half) {
            if (c.surface === 'road') roadMask[idx] = 1;
            else if (c.surface === 'mud') mudMask[idx] = 1;
          }
        }
      }
    }
  }
  // 3. peaks: max-blended ABSOLUTE TARGET heights (never additive — a peak's target already includes
  // the base ridge under its own summit, so heights[idx] = max(heights[idx], target) is exactly right
  // regardless of what order overlapping massifs are visited in, and heightAt(summit) === p.h exactly).
  // Damped near any river/road corridor (bestDist from pass 1, above): without this, a peak whose
  // footprint reaches close to a valley floor (e.g. Bristen, ~600m from the Gotthard road near
  // Amsteg) slams a steep flank right up against cells just outside the corridor's few-metres-wide
  // flat band — invisible in the analytic centreline height, but very visible once the baked grid is
  // *bilinearly* sampled (the same sampling heightAt()/the renderer actually use), because a corridor
  // half-width of only ~6m is barely one grid texel (~7.8m) wide, so off-centre grid nodes just past
  // the flat band would otherwise pick up nearly the full peak target.
  for (const p of geo.peaks) {
    const baseAtSummit = baseRidge(p.x, p.z, seed, centroids);
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
        const shape = peakShape(Math.hypot(x - p.x, z - p.z), p);
        if (shape <= 0) continue;
        const idx = row + gx;
        const baseHere = baseRidge(x, z, seed, centroids);
        let target = baseHere + (p.h - baseAtSummit) * shape;
        const shoreD = shoreDampNear(x, z, geo, centroids);
        const roadD = smoothstep(20, 150, bestDist[idx]); // 0 right at a corridor, full strength by 150m out
        target = baseHere + (target - baseHere) * shoreD * roadD;
        if (target > heights[idx]) heights[idx] = target;
      }
    }
  }

  // 4. corridors, PASS 2: apply the blend computed in pass 1, now that peaks are folded in — exactly
  // on a corridor's centreline (weight=1 within halfWidth) this unconditionally overwrites whatever a
  // peak put there, guaranteeing the pass points and the road/river bed keep their authored height.
  for (let i = 0; i < n; i++) heights[i] = heights[i] + (bestValleyH[i] - heights[i]) * bestWeight[i];

  // 4. detail noise, amplitude scaled by local pre-noise slope; the "jag" ridged term is now small
  // (≤3m) and gated on steep (rock/scree-classifying) ground only, not blended everywhere a raw
  // slope>0 — it used to read as a row of conical sawtooth spikes on any moderately sloped hillside.
  const slopePre = computeSlope(heights, width, height, scaleX, scaleZ);
  for (let gz = 0; gz < height; gz++) {
    const z = toZ(gz);
    const row = gz * width;
    for (let gx = 0; gx < width; gx++) {
      const idx = row + gx;
      const x = toX(gx);
      const slope01 = clamp(slopePre[idx] / 1.1, 0, 1);
      const fine = fbm2D(x, z, { octaves: 3, frequency: 1 / 46, seed: seed + 900 }) * (2 + slope01 * 9);
      const rockGate = smoothstep(0.45, 0.72, slope01); // ~scree/rock threshold, see classification below
      const jag = ridge2D(x, z, { octaves: 2, frequency: 1 / 130, seed: seed + 1900 }) * rockGate * 3;
      heights[idx] += fine + jag;
    }
  }

  // 5. slope-limited relaxation (thermal-erosion-like diffusion), so cliffs/valley walls read as
  // terrain rather than raw noise. Run generously (12 passes) before the shore pass so the walls the
  // shore blend has to match against are already talus-relaxed, then a shorter top-up pass afterward
  // to smooth the new shore transition into its neighbours.
  const RELAX_TAN = Math.tan((38 * Math.PI) / 180);
  thermalSmooth(heights, width, height, scaleX, scaleZ, 12, RELAX_TAN);

  // 6. lake-shore blend pass (issue 1): treats each lake polygon boundary as a corridor whose floor
  // is the water level, blending the OUTSIDE terrain down to lake height near the shore and back up
  // to whatever the mountain/valley field already produced by D metres out — a continuous shore, not
  // a vertical-walled trench. Also fixes basins whose surrounding terrain sat below or far above the
  // lake (Ägerisee: -26m outside the polygon; Vierwaldstättersee shores: +80-93m).
  const MAJOR_LAKES = new Set(['urnersee', 'gersau-basin', 'luzern-basin', 'kuessnachtersee', 'alpnachersee']);
  for (const lake of geo.lakes) {
    const D = MAJOR_LAKES.has(lake.id) ? 600 : 300;
    let cx = 0, cz = 0;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [px, pz] of lake.poly) {
      cx += px; cz += pz;
      if (px < minX) minX = px; if (px > maxX) maxX = px; if (pz < minZ) minZ = pz; if (pz > maxZ) maxZ = pz;
    }
    cx /= lake.poly.length; cz /= lake.poly.length;
    const gx0 = Math.max(0, Math.floor((minX - D - MAP_BOUNDS.minX) / scaleX));
    const gx1 = Math.min(width - 1, Math.ceil((maxX + D - MAP_BOUNDS.minX) / scaleX));
    const gz0 = Math.max(0, Math.floor((minZ - D - MAP_BOUNDS.minZ) / scaleZ));
    const gz1 = Math.min(height - 1, Math.ceil((maxZ + D - MAP_BOUNDS.minZ) / scaleZ));
    for (let gz = gz0; gz <= gz1; gz++) {
      const z = toZ(gz);
      const row = gz * width;
      for (let gx = gx0; gx <= gx1; gx++) {
        const x = toX(gx);
        const d = polygonSdf(x, z, lake.poly); // negative inside
        if (d <= 0 || d > D) continue;
        // real Axen cliff: the Urnersee's east shore rises faster, but still continuously — restricted
        // to the actual Axen stretch (roughly Sisikon/Tellsplatte, z<1000) so the flat Flüelen/Reuss
        // delta at the lake's south end (z>1000, same x>cx side) doesn't also get force-steepened.
        const steep = lake.id === 'urnersee' && x > cx && z < 1000;
        const target = shoreProfile(d, lake.levelGameH, D, steep);
        const idx = row + gx;
        const w = smoothstep(0, D, d); // 0 at the shoreline (full target), 1 at D (fully back to existing terrain)
        heights[idx] = target + (heights[idx] - target) * w;
      }
    }
  }

  // 5b. short relaxation top-up so the new shore transition blends into its neighbours too.
  thermalSmooth(heights, width, height, scaleX, scaleZ, 6, RELAX_TAN);

  // 7. lake interior: drop to a real bed below the surface (not a flat plate at lake height).
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

  // 8. settlement pads: widened blend (issue 6) so the pad melts into the surrounding terrain height
  // over a much larger radius than the pad itself, and only a small core classifies as 'settlement' —
  // the rest falls through to ordinary grass/meadow classification below instead of a bare sand disc.
  const padMask = new Uint8Array(n);
  for (const pad of geo.pads) {
    const padCore = pad.radius * 0.35;
    const padOuter = pad.radius * 1.6;
    const rx = padOuter / scaleX, rz = padOuter / scaleZ;
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
        if (d >= padOuter) continue;
        const idx = row + gx;
        const w = 1 - smoothstep(padCore, padOuter, d);
        heights[idx] = heights[idx] + (pad.h - heights[idx]) * w;
        if (d < padCore) padMask[idx] = 1;
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

/** Slope-limited diffusion ("thermal erosion"): iterates until neighbour-to-neighbour slope is close
 * to `maxTan` (tan of the limit angle) almost everywhere — cells already shallower than that barely
 * move (so flat valley floors/road beds/pads are not eroded away), cells steeper relax hard toward
 * their neighbour average (material "slides" until the pile angle is reached).
 * `protect` (optional, 0..1 per cell, e.g. a corridor's bestWeight) scales the relax amount down to
 * ~0 for cells at 1 — without this, a road/river's authored floor height (stamped narrower than a
 * grid texel in many mountain stretches) gets diffused into its steep neighbours over enough passes,
 * silently re-introducing exactly the impassable grades the corridor pass was meant to prevent. */
function thermalSmooth(heights: Float32Array, width: number, height: number, scaleX: number, scaleZ: number, iterations: number, maxTan: number, protect?: Float32Array): void {
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
        const grad = Math.max(Math.abs(hR - hL), Math.abs(hD - hU)) / (2 * avgScale);
        // 0 below the limit angle (leave it alone), ramping to a strong relax well above it.
        const over = clamp((grad - maxTan) / maxTan, 0, 1.5);
        const amt = clamp(over, 0, 1) * 0.6;
        tmp[idx] = heights[idx] + (avg - heights[idx]) * amt;
      }
    }
    heights.set(tmp);
  }
}

export { nearestOnSpline };
export type { WorldGeo, Corridor };
