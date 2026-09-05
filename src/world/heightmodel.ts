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
import { MAP_BOUNDS, PLACES } from '@content/gazetteer';
import { clamp, pointInPolygon, polygonSdf, smoothstep } from '@core/math';
import { fbm2D, ridge2D } from './noise';
import {
  buildWorldGeo, nearestOnSpline, valleyProfile, peakShape, lakeShelf, segmentDistT, limitGrade, shoreProfile, insideAnyLake,
  type WorldGeo, type Corridor, type LakePoly,
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
  // Road-only nearest-wins tracking (separate from bestDist/bestWeight above, which also include
  // rivers): used ONLY to protect a shore-hugging ROAD from the lake-shore blend pass. Rivers must
  // NOT protect that pass — a river meeting the lake is naturally at lake level already, and a wide
  // river corridor (halfWidth up to 220m) "protecting" cells near its mouth from being pulled to lake
  // level was itself producing an 80m+ step right at the water's edge (the Reuss/Flüelen delta).
  const bestRoadDist = new Float32Array(n).fill(Infinity);
  const inFloor = new Uint8Array(n); // cell lies on the flat corridor bed (within halfWidth)
  const bestScore = new Float32Array(n).fill(Infinity); // blended height the winning corridor would give
  const bestBedDist = new Float32Array(n).fill(Infinity); // nearest bed among competing beds
  // Authored a little under the 25° test/design ceiling (not right at it) so the small amount of
  // detail noise + relaxation applied afterward doesn't push a couple of samples back over the line.
  const MAX_GRADE_TAN = Math.tan((14 * Math.PI) / 180);
  for (const c of geo.corridors) {
    // A corridor hugging a lake is authored at the lake: gazetteer-interpolated heights put the Lorze
    // mouth 49 m above the Zugersee and the Arth road 40 m above the Lauerzersee within a texel or two
    // of the water, which the shore pass then had to protect as a wall. Clamp every point within
    // reach of a shore to lake level plus a ≤24° rise from the waterline (rivers: ≤11°, they meet the
    // lake at its level), then grade-limit as before so the along-corridor profile stays walkable.
    const riseTan = c.kind === 'river' ? 0.05 : 0.12; // a shore road is an embankment otherwise (Zug's quay road stood 20 m over the water)
    for (const pt of c.pts) {
      // inside a settlement the road follows the pad's gazetteer height (Meggen sits 12 m up its bank)
      if (geo.pads.some((pd) => Math.hypot(pd.x - pt.x, pd.z - pt.z) < pd.radius * 1.2)) continue;
      for (const lake of geo.lakes) {
        const d = polygonSdf(pt.x, pt.z, lake.poly);
        if (d > 160) continue;
        // a road already 60 m+ above a lake it merely passes near in plan (Steinerberg over the
        // Lauerzersee, Seelisberg over the Urnersee) is a mountain road, not a shore road: leave it
        if (pt.h - lake.levelGameH > 60) continue;
        pt.h = Math.min(pt.h, lake.levelGameH + 2 + riseTan * Math.max(0, d));
        // and never UNDER the water it runs beside: the Ägeri road interpolated 30 m below the Ägerisee
        // 40 m from its shore, which the shore pass then had to climb as a wall
        if (c.kind === 'road' && d > 0 && d < 100) pt.h = Math.max(pt.h, lake.levelGameH + 1.5);
      }
    }
    const limitedH = limitGrade(c.pts, c.maxGradeTan ?? MAX_GRADE_TAN);
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
          if (d < bestDist[idx]) bestDist[idx] = d;   // true nearest distance: noise gating, relaxation guard, peak damping
          // Which corridor shapes this cell: a bed (within halfWidth) always beats a flank, nearest bed
          // wins among beds, and among flanks the corridor that carves LOWEST wins. Nearest-wins let the
          // Gotthard mule track's 90 m flank profile beat the Reuss's 220 m flat floor wherever the two
          // splines drift apart, standing 300 m hillsides beside a flat valley (critic round 2, P11/P12).
          const floorH = ha + (hb - ha) * t;
          const cand = valleyProfile(d, floorH, b);
          const cw = 1 - smoothstep(halfWidth, influence, d);
          const cIn = d <= halfWidth ? 1 : 0;
          const base = heights[idx];
          const score = cIn ? cand : base + (Math.min(cand, base) - base) * cw;
          const better = bestScore[idx] === Infinity
            || (cIn && !inFloor[idx])
            || (cIn === inFloor[idx] && (cIn ? d < bestBedDist[idx] : score < bestScore[idx]));
          if (better) {
            bestScore[idx] = score;
            bestValleyH[idx] = cand;
            bestWeight[idx] = cw;
            inFloor[idx] = cIn;
            if (cIn) bestBedDist[idx] = d;
          }
          if (c.kind === 'road' && d < bestRoadDist[idx]) {
            bestRoadDist[idx] = d;
          }
          // surface band (road bed / river mud strip), stamped from the same segment pass so it is
          // continuous too — this is what gets 'road' onto ≥95% of centreline samples instead of the
          // old 100-300m-apart sample discs.
          // Classification stamp is deliberately wider than the height-shaping half-width above: the
          // grid texel (~7.8m) is comparable to a road's physical width (halfWidth 6m), so a stamp
          // sized to the exact physical width aliases badly against the lattice and undercounts
          // 'road' on the nearest-grid-cell sampling exploration/the harness/this test all use. A
          // ~9-10m stamped half-width for roads reliably covers at least the one grid cell the
          // centreline actually falls in, without materially changing how the corridor looks.
          const half = Math.max(a.corridorWidthM, b.corridorWidthM) * 1.6;
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
  // peakProtect: how strongly each cell is "on a summit", 0..1 — used below to shield the actual
  // summit point from the slope-limited relaxation pass. A summit is, by construction, a local
  // maximum surrounded by lower ground on every side; thermal-erosion-style relaxation (which pulls
  // every cell toward its 4-neighbour average) rounds off exactly that apex first and hardest,
  // otherwise silently eating 30-140m off heightAt(summit) despite the peak stage having targeted the
  // gazetteer height exactly.
  const peakProtect = new Float32Array(n);
  // Full named-massif footprint, separate from the tiny summit-only protection above.  The
  // de-spike pass uses this to distinguish a real authored mountain from an accidental needle on a
  // valley floor; only protecting the last two summit texels would make the cleanup shave genuine
  // shoulders off the Mythen, Pilatus, etc.
  const peakFootprint = new Float32Array(n);
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
        const dist = Math.hypot(x - p.x, z - p.z);
        const shape = peakShape(dist, p);
        if (shape <= 0) continue;
        const idx = row + gx;
        if (shape > peakFootprint[idx]) peakFootprint[idx] = shape;
        const baseHere = baseRidge(x, z, seed, centroids);
        let target = baseHere + (p.h - baseAtSummit) * shape;
        const shoreD = shoreDampNear(x, z, geo, centroids);
        const roadD = smoothstep(20, 110, bestDist[idx]); // 0 right at a corridor, full strength by 110m out
        // Damping (shore/road proximity) must fade OUT near the true summit (shape->1), not apply at
        // uniform strength regardless of how close to the apex we are: a peak can sit geographically
        // close, in map (x,z), to a road or lake shore while still being 300-500m higher in elevation
        // at its actual summit — that summit must reach the gazetteer height exactly regardless of
        // what's nearby in the flat projection. Only the peak's outer skirt (shape->0, already close
        // to base-ridge height) is what actually needs shore/road damping.
        const damp = shoreD * roadD + (1 - shoreD * roadD) * shape;
        target = baseHere + (target - baseHere) * damp;
        if (target > heights[idx]) heights[idx] = target;
        // Protect only right at the true summit (inside ~2 texels), not the whole broad shoulder —
        // the flanks legitimately need relaxation to read as a mountainside, not a smooth dome.
        if (dist < scaleX * 2.5) {
          const p2 = smoothstep(0.7, 1.0, shape);
          if (p2 > peakProtect[idx]) peakProtect[idx] = p2;
        }
      }
    }
  }

  // 4. corridors, PASS 2: apply the blend computed in pass 1, now that peaks are folded in — exactly
  // on a corridor's centreline (weight=1 within halfWidth) this unconditionally overwrites whatever a
  // peak put there, guaranteeing the pass points and the road/river bed keep their authored height.
  // EXCEPT a true peak summit (peakProtect, computed above): a wide river's halfWidth/influence
  // (up to 220/750m — much larger than a road's) can otherwise reach a summit that merely sits
  // close in map (x,z) terms without being anywhere near that river in reality, silently overriding
  // a correctly-targeted heightAt(summit) with the river's much lower floor height. Scaling the
  // corridor weight down right at a summit (not anywhere else on its slopes) keeps rivers carving
  // real valleys everywhere else while never drowning an actual mountaintop.
  // The profile CARVES: outside the flat bed it may only lower the field, never raise it. Raising to
  // the profile wall turned every low base cell along a gorge or a plain into a ridge that fell back to
  // the base beyond the corridor's influence — free-standing 100–350 m needles beside the Reuss and the
  // Obwalden road (critic round 2, P12). The bed itself is still set exactly (a road can be embanked).
  for (let i = 0; i < n; i++) {
    const w = bestWeight[i] * (1 - peakProtect[i]);
    const target = inFloor[i] ? bestValleyH[i] : Math.min(bestValleyH[i], heights[i]);
    heights[i] = heights[i] + (target - heights[i]) * w;
  }

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
      // a road/river bed keeps its authored profile: a bed cell beside a steep bank has a huge
      // pre-noise slope and would otherwise get the full 11 m amplitude stamped onto the road surface
      const bed = 1 - smoothstep(8, 30, bestDist[idx]);
      heights[idx] += (fine + jag) * (1 - bed);
    }
  }

  // A dedicated, WIDER relaxation-protection mask: bestWeight itself (used for the corridor blend)
  // decays back to 0 by each corridor's own `influence` radius, which for a road (~90m) is still only
  // a handful of grid texels — a partially-protected cell there (say 15% unprotected) still drifts
  // measurably toward a much steeper/taller neighbour over 12 compounding relaxation passes. This
  // second mask ramps out over a fixed, more generous 220m regardless of the corridor's own influence,
  // so the authored road/river height near (not just exactly on) a corridor survives relaxation intact.
  const relaxProtect = new Float32Array(n);
  // The distance term protects the bed and its shoulder (25→60 m), not a 70 m band: with the whole band
  // exempt from relaxation the raw ridge field stood as an unrelaxed 60° wall right beside every road
  // that had no river floor competing (critic round 2, Obwalden/Nidwalden road flanks).
  for (let i = 0; i < n; i++) relaxProtect[i] = Math.max(bestWeight[i] * (inFloor[i] ? 1 : 0.6), 1 - smoothstep(25, 60, bestDist[i]), peakProtect[i]);

  // 5. slope-limited relaxation (thermal-erosion-like diffusion), so cliffs/valley walls read as
  // terrain rather than raw noise. Run generously (12 passes) before the shore pass so the walls the
  // shore blend has to match against are already talus-relaxed, then a shorter top-up pass afterward
  // to smooth the new shore transition into its neighbours.
  const RELAX_TAN = Math.tan((38 * Math.PI) / 180);
  thermalSmooth(heights, width, height, scaleX, scaleZ, 18, RELAX_TAN, relaxProtect);

  // Corridors, overlapping falloffs and the protected relaxation band can still leave a narrow
  // column tens or hundreds of metres above an otherwise low valley.  Those are the unmistakable
  // free-standing needles seen from Altdorf, not useful Alpine relief.  Clamp only cells surrounded
  // on at least six of eight sides by substantially lower ground, only below the high-mountain band,
  // and never inside a named massif.  Two passes catch a 2-3 texel cluster without flattening long
  // ridges or cliffs (which have high neighbours along their ridge direction).
  despikeIsolatedRelief(heights, width, height, scaleX, peakFootprint, bestDist, 2);

  // 6. lake-shore blend pass (issue 1): treats each lake polygon boundary as a corridor whose floor
  // is the water level, blending the OUTSIDE terrain down to lake height near the shore and back up
  // to whatever the mountain/valley field already produced by D metres out — a continuous shore, not
  // a vertical-walled trench. Also fixes basins whose surrounding terrain sat below or far above the
  // lake (Ägerisee: -26m outside the polygon; Vierwaldstättersee shores: +80-93m).
  const MAJOR_LAKES = new Set(['urnersee', 'gersau-basin', 'luzern-basin', 'kuessnachtersee', 'alpnachersee']);
  // NEAREST-WINS across lakes: two basins' D-bands can overlap (e.g. a point near the Urnersee's
  // southern tip can also sit within the Gersau basin's 600m band), and applying each lake's blend
  // in turn used to let a FARTHER lake's pass (small w, so mostly "target") overwrite a nearer lake's
  // already-correct near-shore-level result — an 18m+ step appearing right at the true shoreline.
  // Track the winning (nearest, i.e. smallest d) lake's target/weight per cell and apply it once.
  const shoreDist = new Float32Array(n).fill(Infinity);
  const shoreTarget = new Float32Array(n);
  const shoreW = new Float32Array(n);
  const shoreTouched = new Uint8Array(n);
  for (const lake of geo.lakes) {
    const D = MAJOR_LAKES.has(lake.id) ? 600 : 300;
    // The blend hands back to the existing terrain over D; where that terrain is a mountain flank
    // 300 m above the water (Rigi Hochflue over the Lauerzersee, Rossberg over the Zugersee) a 300 m
    // hand-off is a 12 m-per-10 m ramp at its mid-point. Per cell, widen the hand-off so the blend's
    // steepest point (1.5·Δh/D) stays under tan 29°, capped at D_MAX so summits are still reached.
    // The hand-off widening must not run away: D_MAX used to be 1000, but once the massif shoulders
    // are protected (massifProtect below) the peaks no longer need a kilometre-long ramp to survive
    // the shore blend — and that long ramp is exactly what left the probe's d=110..150 ten-metre
    // steps at 20-35m on every steep shore (the massif's own natural grade, sampled past the point
    // where the blend has already handed back). Cap at 420m so the handoff completes inside the
    // probe's 150m band wherever the far terrain is a real cliff, while still keeping the blend's
    // own steepest point under ~tan 30° for the height deltas that actually occur here.
    const D_MAX = 420;
    const dLocal = (existing: number, target: number) => clamp((1.5 * Math.abs(existing - target)) / 0.33, D, D_MAX);
    let cx = 0, cz = 0;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [px, pz] of lake.poly) {
      cx += px; cz += pz;
      if (px < minX) minX = px; if (px > maxX) maxX = px; if (pz < minZ) minZ = pz; if (pz > maxZ) maxZ = pz;
    }
    cx /= lake.poly.length; cz /= lake.poly.length;
    const gx0 = Math.max(0, Math.floor((minX - D_MAX - MAP_BOUNDS.minX) / scaleX));
    const gx1 = Math.min(width - 1, Math.ceil((maxX + D_MAX - MAP_BOUNDS.minX) / scaleX));
    const gz0 = Math.max(0, Math.floor((minZ - D_MAX - MAP_BOUNDS.minZ) / scaleZ));
    const gz1 = Math.min(height - 1, Math.ceil((maxZ + D_MAX - MAP_BOUNDS.minZ) / scaleZ));
    for (let gz = gz0; gz <= gz1; gz++) {
      const z = toZ(gz);
      const row = gz * width;
      for (let gx = gx0; gx <= gx1; gx++) {
        const x = toX(gx);
        const d = polygonSdf(x, z, lake.poly); // negative inside
        // NOTE: deliberately no `d <= 0` exclusion here (only the `d > D` outer bound) — a boundary
        // point (d≈0) needs this pass too, or it falls into a gap between this pass (used to require
        // d>0 strictly) and the lake-interior drop below (which requires d<-0.01 strictly), leaving
        // whatever raw pre-shore terrain height was there right at the waterline. Any cell with d<0
        // this pass touches gets overwritten again by the interior drop (step 7, runs after), so
        // covering a bit of the interior here too is harmless.
        if (d > D_MAX) continue;
        const idx = row + gx;
        const ad = Math.abs(d);
        if (ad >= shoreDist[idx]) continue; // a nearer lake already claimed this cell
        const steepPre = lake.id === 'urnersee' && x > cx && z < 1000;
        const Dl = dLocal(heights[idx], shoreProfile(d, lake.levelGameH, D, steepPre));
        if (d > Dl) continue;
        shoreDist[idx] = ad;
        shoreTouched[idx] = 1;
        // real Axen cliff: the Urnersee's east shore rises faster, but still continuously — restricted
        // to the actual Axen stretch (roughly Sisikon/Tellsplatte, z<1000) so the flat Flüelen/Reuss
        // delta at the lake's south end (z>1000, same x>cx side) doesn't also get force-steepened.
        const steep = lake.id === 'urnersee' && x > cx && z < 1000;
        // Pull DOWN only: the profile removes walls above the water, it must not raise a flat river
        // valley meeting the lake (the Lorze at Zug, the Reuss delta at Flüelen) into a berm along the
        // shore. Terrain already under the profile keeps its height, lifted to just above the waterline
        // where it had sunk below it.
        const profileH = shoreProfile(d, lake.levelGameH, D, steep);
        shoreTarget[idx] = Math.min(profileH, Math.max(heights[idx], lake.levelGameH + 0.3));
        // The blend weight uses the SHELF's own reach (D), not the per-cell widened Dl: Dl exists
        // so the blend still *reaches* far enough on high mountainsides, but weighting by it keeps
        // the shelf at ~10% existing-height 80m out (a 14m step at d=70..80 on the Axen). Weighting
        // by D keeps the shelf flat through the whole d<=80 test band and lets the widened Dl hand
        // off past it. Dl still bounds the loop (cells past Dl are untouched).
        shoreW[idx] = smoothstep(0, D, d); // 0 at the shoreline (full target), 1 at D (fully back to existing terrain)
      }
    }
  }
  for (let idx = 0; idx < n; idx++) {
    if (!shoreTouched[idx]) continue;
    // Protect (a) a true peak summit that merely happens to sit within D of some lake in map (x,z)
    // terms (e.g. Fronalpstock) — it must not get pulled toward lake level just because it is
    // geographically "close" to the shore while being hundreds of metres higher in elevation; and
    // (b) a shore-hugging ROAD's own authored bed (roads only, NOT rivers — a river meeting the lake
    // is already naturally at lake level, so protecting cells near a wide river's mouth from this
    // pass reintroduced an 80m+ step right at the water). Deliberately a NARROW protection (the
    // road's own ~14m bed plus a small margin, not its full ~90m influence ramp): every shore-hugging
    // road in this geography is already authored within a few metres of lake level, so letting the
    // shore blend also apply through most of the road's influence ramp is correct, not a conflict —
    // a wider protection there just let leftover pre-shore roughness (relaxation/base-ridge noise the
    // road's own gentle rise ramp had not fully absorbed) leak through right next to the water.
    // Only protect if the road's own corridor floor here is actually close to THIS lake's shore
    // level — e.g. sattel-road passes within ~20m (map-projected) of the Zugersee shore while running
    // ~250m higher in real elevation (it is climbing toward Sattel/Ägeri, not following the lake);
    // protecting a road segment that is legitimately not at lake level just relocates the shore's
    // vertical-wall defect onto the road instead of fixing it. Gate on the road's own floor height
    // (bestValleyH, from pass 1) being within 60m of the winning lake's near-shore target.
    const roadHeightMatches = Math.abs(bestValleyH[idx] - shoreTarget[idx]) < 300;
    const roadProtect = roadHeightMatches ? 1 - smoothstep(14, 22, bestRoadDist[idx]) : 0;
    // Preserve the shoulders of an authored massif once it is safely inland. Previously only the
    // final two summit texels were protected, so the shore blend reduced Fronalpstock from 494m to
    // 174m in a single 50m step: mathematically a valid summit, visually a freestanding needle.
    // The footprint term must be strong: at the Fronalpstock's 250m shoreline distance even a 0.86
    // footprint would otherwise leave most of the blend applied, and massifProtect below ~0.97
    // shows up as a visible step. Protection fades in from d=90 to d=200 on the big cliff lakes
    // (their 90m shelf keeps the in-repo d<=80 test band continuous); on small lakes the 25m shelf
    // hands off inside D=300 and the hillside behind legitimately exceeds 6m/10m (mountainside,
    // not a seam — see geodata.ts shoreProfile).
    // Gated on the pre-blend terrain actually being HIGH: the Rütli shore sits on a 0.41
    // Fronalpstock footprint while being near-flat meadow at ~2m, and protecting that would freeze
    // the shelf instead of pulling it to the water. Below ~14m the shore blend always wins; above
    // ~45m the massif wins.
    const massifProtect = Math.min(0.97, peakFootprint[idx] * 1.18) * smoothstep(90, 200, shoreDist[idx])
      * smoothstep(14, 45, heights[idx]);
    // Small lakes promise only a 25 m shelf, but the in-repo shore test samples each edge's outward
    // normal out to 80 m: past the shelf the ray runs over genuine Rossberg/Rigi-side farmland
    // hillside. The correct fix is the small-lake rise cap below (on the blend target), not a post
    // clamp here — clamping the result would fight the mountainside the blend correctly hands off to.
    const w = Math.max(shoreW[idx], peakProtect[idx], massifProtect, roadProtect);
    heights[idx] = shoreTarget[idx] + (heights[idx] - shoreTarget[idx]) * w;
    // nothing outside a lake sits under its water: a road's protected shoulder kept a 30 m pit of base
    // field beside the Ägerisee (the target is the waterline + 0.3 exactly when the cell was below it)
    if (heights[idx] < shoreTarget[idx]) heights[idx] = shoreTarget[idx];
  }

  // 5b. short relaxation top-up so the new shore transition blends into its neighbours too (still
  // corridor-protected — a road hugging a shore, e.g. the Axen path, must not get eroded here either).
  thermalSmooth(heights, width, height, scaleX, scaleZ, 10, RELAX_TAN, relaxProtect);

  // 8. settlement pads: widened blend (issue 6) so the pad melts into the surrounding terrain height
  // over a much larger radius than the pad itself, and only a small core classifies as 'settlement' —
  // the rest falls through to ordinary grass/meadow classification below instead of a bare sand disc.
  // Runs BEFORE the lake-interior drop (step 7 is below) so the lake bed always wins inside the
  // polygon: a shore village's pad must never lift the lake bed up to village height (that made the
  // Rütli a disc island in the Urnersee), it only shapes the dry land around the water.
  const padMask = new Uint8Array(n);
  for (const pad of geo.pads) {
    const padCore = pad.radius * 0.35;
    const padOuterMin = pad.radius * 1.6;
    // The ramp widens with the height it has to bridge: a fixed 1.6·radius ramp next to a mountain
    // flank (Lauerz under the Rigi, Zug) pulled the ring down to village height and left a wall right
    // behind it. A smoothstep's steepest point is 1.5·Δh/(outer−core); keep it under tan 22° (0.40).
    const PAD_RAMP_TAN = 0.4;
    let padOuter = padOuterMin;
    {
      const rr = padOuterMin / Math.min(scaleX, scaleZ) + 1;
      const gcx = Math.round((pad.x - MAP_BOUNDS.minX) / scaleX), gcz = Math.round((pad.z - MAP_BOUNDS.minZ) / scaleZ);
      let maxDh = 0;
      for (let gz = Math.max(0, gcz - rr); gz <= Math.min(height - 1, gcz + rr); gz++) {
        for (let gx = Math.max(0, gcx - rr); gx <= Math.min(width - 1, gcx + rr); gx++) {
          const d = Math.hypot(toX(gx) - pad.x, toZ(gz) - pad.z);
          if (d > padOuterMin || d < padCore) continue;
          const dh = Math.abs(heights[gz * width + gx] - pad.h);
          if (dh > maxDh) maxDh = dh;
        }
      }
      padOuter = Math.max(padOuterMin, padCore + (1.5 * maxDh) / PAD_RAMP_TAN);
    }
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
        // A shore village's pad stops at the waterline: flattening the lake bed up to village height
        // made the Rütli a disc island in the Urnersee. Pads run BEFORE the lake-interior drop below,
        // so this guard only protects the dry-land blend; the bed itself always wins inside the polygon.
        // A port's quay core stays flat even where the coarse polygon reads water — but only a tight
        // 12m quay, not the whole 0.35·radius core: the old full-core rule stood Treib 2m proud of the
        // water as a dry `settlement` bar reaching 40m into the lake (interior-probe bumps + the
        // far-backdrop causeway).
        if (insideAnyLake(x, z, geo)) {
          if (!(pad.kind === 'port' && d < Math.min(12, padCore))) continue;
        }
        // 'rigi' (alp, h=389) and 'rigi-kulm' (landmark peak, h=455) share the exact same gazetteer
        // (x,z) — flattening this alp's pad would otherwise overwrite the mountain's actual summit
        // target with the alp's lower height. Fade the pad blend out wherever a true peak summit
        // (peakProtect) already owns this cell, same principle as the shore/relaxation protections.
        // A road bed keeps its own grade-limited profile through the village: the pad used to hold the
        // road flat at pad.h to the pad edge, after which the road had to catch up at ~29° (Steinen →
        // Sattel). The authored road passes through the village centre at the same gazetteer height
        // as the pad, so there is no seam where the two meet.
        // …but only where the road's own profile actually disagrees with the pad (Steinen's road climbs
        // 22 m by the pad edge); a road within a few metres of the pad height lets the pad win, so the
        // village centre still sits at its gazetteer height (Steinerberg) and the road crosses on a ≤8° bump.
        const roadBed = (1 - smoothstep(8, 20, bestRoadDist[idx])) * smoothstep(3, 30, Math.abs(bestValleyH[idx] - pad.h));
        const w = (1 - smoothstep(padCore, padOuter, d)) * (1 - peakProtect[idx]) * (1 - roadBed);
        heights[idx] = heights[idx] + (pad.h - heights[idx]) * w;
        if (d < padCore && peakProtect[idx] < 0.5) {
          // A pad only stamps `settlement` where the cell is actually near the pad's own height:
          // Zugs's town pad (radius 120, core 42) reaches ~40 m past the lake polygon edge over
          // water whose bed sits 3-4 m under the surface. Stamping those cells `settlement` paints
          // a dry settlement bar across the shallows in the far-backdrop capture. Cells 2 m+ below
          // the pad height keep their shore/water classification instead.
          if (Math.abs(heights[idx] - pad.h) < 2) padMask[idx] = 1;
        }
      }
    }
  }

  // 7. lake interior: drop to a real bed below the surface (not a flat plate at lake height).
  // Runs AFTER the pads above so the bed always wins inside the polygon. Interior ROAD cells are
  // capped at a shallow bench instead of the bed: a shore-hugging road runs along the polygon edge and its `roadMask`
  // stamp can read "inside" up to ~40m past the waterline (Urnersee/Axen). Those kept their authored
  // corridor floor (+2m above the water) while the lake bed around them dropped, poking up as dry
  // road ribs across the shallows. The bench keeps the Axen-path gameplay allowance (dry, walkable,
  // still `road`) while reading as a lakeside bench, not a causeway. The far backdrop (terrain.ts
  // sampleFarMeshVertex) applies the stricter exact-lake clamp so this allowance cannot appear as a
  // distant causeway.
  const ROAD_BENCH_ABOVE = 1.0;
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
        const idx = row + gx;
        // A shore-hugging road's `roadMask` stamp can read "inside" up to ~40m past the waterline
        // (Urnersee/Axen). Those cells keep a dry walkable bench (the Axen-path gameplay allowance)
        // instead of being drowned into the lake bed — but a bench must never stand PROUD of the
        // shallow bed around it: where the natural shelf is higher, the road cell takes the shelf
        // so it cannot poke above the water plane as a dry rib across the shallows.
        if (roadMask[idx]) {
          const h = lakeShelf(x, z, lake);
          if (h === null) continue;
          if (padMask[idx]) continue;
          heights[idx] = Math.min(heights[idx], Math.max(h, lake.levelGameH + ROAD_BENCH_ABOVE));
          continue;
        }
        const h = lakeShelf(x, z, lake);
        if (h !== null) heights[idx] = h;
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
        const idx = row + gx;
        if (roadMask[idx]) continue; // shore road stays road even if the boundary test reads "inside" (Axen path)
        if (pointInPolygon(x, z, lake.poly)) surface[idx] = surfaceIdOf('water');
      }
    }
  }

  return { width, height, bounds: MAP_BOUNDS, heights, surface };
}

/** Remove narrow, non-authored columns while preserving ridges, cliffs and named mountain masses. */
function despikeIsolatedRelief(
  heights: Float32Array,
  width: number,
  height: number,
  scaleX: number,
  peakFootprint: Float32Array,
  corridorDistance: Float32Array,
  passes: number,
): void {
  const radius = Math.max(4, Math.round(100 / scaleX));
  const next = new Float32Array(heights.length);
  const ring = new Float32Array(8);
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]] as const;
  for (let pass = 0; pass < passes; pass++) {
    next.set(heights);
    for (let gz = radius; gz < height - radius; gz++) {
      for (let gx = radius; gx < width - radius; gx++) {
        const idx = gz * width + gx;
        if (peakFootprint[idx] > 0.035) continue;
        if (corridorDistance[idx] < 22) continue;
        const h = heights[idx];
        for (let i = 0; i < dirs.length; i++) {
          const [dx, dz] = dirs[i];
          ring[i] = heights[(gz + dz * radius) * width + gx + dx * radius];
        }
        ring.sort();
        const median = (ring[3] + ring[4]) * 0.5;
        // A low ring median is the valley-floor signal.  Requiring six individually-low samples let
        // 2-3 texel spike clusters protect one another, which is exactly the failure mode this pass
        // exists to remove.  Named massif coverage and the corridor-bed guard above are the safety
        // rails; within an otherwise sub-80 m neighbourhood, a >38 m isolated rise is not useful
        // geography.
        if (median >= 80 || h - median <= 38) continue;
        next[idx] = median + 30;
      }
    }
    heights.set(next);
  }
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
        let amt = clamp(over, 0, 1) * 0.6;
        if (protect) amt *= 1 - protect[idx];
        tmp[idx] = heights[idx] + (avg - heights[idx]) * amt;
      }
    }
    heights.set(tmp);
  }
}

export { nearestOnSpline };
export type { WorldGeo, Corridor };
