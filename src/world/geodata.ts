/**
 * Static geography model derived from the gazetteer: smoothed river/road splines, lake polygons,
 * peak bumps and settlement pads. Pure data, no three.js — importable from the main thread, the
 * terrain worker, and unit tests alike.
 */
import { LAKES, PLACES, RIVERS, ROADS, gameHeightFromAsl, type GazetteerPlace } from '@content/gazetteer';
import { polygonSdf, pointInPolygon, clamp } from '@core/math';

export type ValleyShape = 'wideU' | 'steepV' | 'cliff';

/** Per-point valley-profile parameters. These vary along a single river (e.g. the Reuss is wide near
 * Altdorf but a steep gorge at the Schöllenen), so they live on the sample point, not the corridor. */
export interface SegParams { shape: ValleyShape; halfWidth: number; influence: number; riseRate: number; corridorWidthM: number }
export interface SplinePoint extends SegParams { x: number; z: number; h: number; s: number /* cumulative arc length */ }

export interface Corridor {
  id: string;
  kind: 'river' | 'road';
  pts: SplinePoint[];
  length: number;
  surface: 'mud' | 'road' | 'grass';
}

export interface Peak {
  id: string;
  x: number;
  z: number;
  h: number;
  radius: number;
  sharp: number; // exponent; higher = pointier
}

export interface LakePoly {
  id: string;
  name: string;
  levelGameH: number;
  poly: [number, number][];
}

export interface SettlementPad {
  id: string;
  x: number;
  z: number;
  h: number;
  radius: number;
  kind: string;
}

/** Centripetal Catmull-Rom (alpha=0.5) through 4 points (p0..p3), u in [0,1] between p1 and p2.
 * NOT the simpler *uniform* Catmull-Rom formula (t,t2,t3 blended with fixed weights) that used to be
 * here: uniform parameterisation loops and self-intersects whenever consecutive control points are
 * very unevenly spaced with a sharp turn between them — exactly the shape of Uri's mountain road
 * chains (e.g. Silenen -> Amsteg -> Göschenen bends hard west over a short stretch). That produced a
 * road "centreline" that briefly crossed back over its own later/earlier arc-length, so the nearest-
 * segment corridor pass (heightmodel.ts step 3) sometimes stamped a far-away segment's floor height
 * onto a point that geometrically sits right next to a completely different part of the same road —
 * a real, sharp, undocumented cliff in the middle of a "flat" valley floor. Centripetal
 * parameterisation is the standard, well-known fix: it does not loop or self-intersect for any point
 * configuration. See e.g. Yuksel et al. 2011 "On the Parameterization of Catmull-Rom Curves". */
function centripetalCatmullRom(
  p0: [number, number], p1: [number, number], p2: [number, number], p3: [number, number], u: number,
): [number, number] {
  const alpha = 0.5;
  const dt = (a: [number, number], b: [number, number]) => Math.max(1e-3, Math.hypot(b[0] - a[0], b[1] - a[1]) ** alpha);
  const t0 = 0;
  const t1 = t0 + dt(p0, p1);
  const t2 = t1 + dt(p1, p2);
  const t3 = t2 + dt(p2, p3);
  const t = t1 + (t2 - t1) * u;
  const lerp2 = (a: [number, number], b: [number, number], ta: number, tb: number, tt: number): [number, number] => {
    const w = (tt - ta) / (tb - ta);
    return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w];
  };
  const A1 = lerp2(p0, p1, t0, t1, t);
  const A2 = lerp2(p1, p2, t1, t2, t);
  const A3 = lerp2(p2, p3, t2, t3, t);
  const B1 = lerp2(A1, A2, t0, t2, t);
  const B2 = lerp2(A2, A3, t1, t3, t);
  return lerp2(B1, B2, t1, t2, t);
}

/** Build a smooth, densely-sampled spline through a chain of gazetteer place ids. Each sample carries
 * the valley-profile params of the (possibly per-segment-varying) shape function. */
function buildSpline(via: string[], samplesPerSeg: number, paramsFor: (aId: string, bId: string) => SegParams): SplinePoint[] {
  const ids = via.filter((id) => PLACES[id]);
  const places = ids.map((id) => PLACES[id]);
  if (places.length < 2) return places.map((p) => ({ x: p.x, z: p.z, h: p.h, s: 0, ...paramsFor(p.id, p.id) }));
  const pts: SplinePoint[] = [];
  let s = 0;
  let prevX = places[0].x;
  let prevZ = places[0].z;
  for (let i = 0; i < places.length - 1; i++) {
    const p0 = places[Math.max(0, i - 1)];
    const p1 = places[i];
    const p2 = places[i + 1];
    const p3 = places[Math.min(places.length - 1, i + 2)];
    const seg = paramsFor(ids[i], ids[i + 1]);
    // Buffer this real segment's samples first (x, z, s) so height can be interpolated by ARC-LENGTH
    // fraction, not raw t. Catmull-Rom curves don't move at constant speed in t (they slow down near
    // control points) — linear-in-t height with an arc-length-based grade check produced a false
    // steep spike right at a segment's tail (t=0.9->1.0 covering only ~35m of actual arc despite being
    // 10% of t), which then had the *pass point itself* wrongly clamped by the max-grade filter below.
    const segStartS = s;
    const seg_x: number[] = [], seg_z: number[] = [], seg_s: number[] = [];
    for (let j = 0; j <= samplesPerSeg; j++) {
      if (i > 0 && j === 0) continue; // avoid duplicate join point
      const t = j / samplesPerSeg;
      const [x, z] = centripetalCatmullRom([p0.x, p0.z], [p1.x, p1.z], [p2.x, p2.z], [p3.x, p3.z], t);
      s += Math.hypot(x - prevX, z - prevZ);
      seg_x.push(x); seg_z.push(z); seg_s.push(s);
      prevX = x; prevZ = z;
    }
    const segEndS = s;
    const segLenS = Math.max(1e-3, segEndS - segStartS);
    for (let k = 0; k < seg_x.length; k++) {
      const frac = (seg_s[k] - segStartS) / segLenS;
      const h = p1.h + (p2.h - p1.h) * frac;
      pts.push({ x: seg_x[k], z: seg_z[k], h, s: seg_s[k], ...seg });
    }
  }
  return pts;
}

/** Segments of a river chain that carve a narrow steep gorge instead of the default wide profile. */
const GORGE_SEGMENTS: Record<string, [string, string][]> = {
  'reuss-upper': [
    ['goeschenen', 'teufelsbruecke'],
    ['teufelsbruecke', 'andermatt'],
  ],
};
// NOTE: an earlier version also gave the Axen shore road (axen-path) a steep "cliff" profile, tied to
// the *road* corridor. That produced a continuous, unrealistically sheer wall running the whole length
// of the trail (every metre of trail, not just the real cliff stretch) — a bad bug, not a feature.
// Cliffs are now only carved by the river/gorge profile below (Schöllenen), which is geologically the
// right mechanism: a gorge is steep along the *river*, not along whichever path happens to hug the shore.

const WIDE_U: SegParams = { shape: 'wideU', halfWidth: 140, influence: 550, riseRate: 260, corridorWidthM: 30 };
const WIDE_U_MAJOR: SegParams = { ...WIDE_U, halfWidth: 220, influence: 750 };
const STEEP_V: SegParams = { shape: 'steepV', halfWidth: 10, influence: 200, riseRate: 250, corridorWidthM: 14 };
// Roads mostly run *along* a valley floor a river already shapes (e.g. the Gotthard mule track follows
// the Reuss). A road's own rise-off-centreline profile only needs to matter for the ~6m bed itself —
// give it real reach and it starts competing with (and beating, via "nearest wins") the river's proper
// wide flat floor for any query point that happens to sit a little closer to a road sample point than
// to the river's, producing a fake ~90m hillside a stone's throw from a genuinely flat valley (a real
// bug here — the free-altdorf camera ended up standing on one, seeing pure black self-shadowed rock).
// halfWidth widened from a literal 6m mule-track tread to 14m (the cut/flattened bed, not the tread
// itself): at the grid's ~7.8m texel size, a flat band much narrower than ~2 texels cannot reliably
// survive *bilinear* sampling (heightAt() everywhere, including the renderer) once the surrounding
// ground is steep — individual lattice nodes a texel or so off the true centreline fall outside a
// too-narrow band and pick up significant neighbouring-terrain height, reappearing as bumps/cliffs
// exactly on the "flat" road despite the analytic corridor shaping being centreline-correct.
const ROAD_NORMAL: SegParams = { shape: 'wideU', halfWidth: 14, influence: 90, riseRate: 35, corridorWidthM: 6 };

function riverSegParams(riverId: string, aId: string, bId: string): SegParams {
  const gorges = GORGE_SEGMENTS[riverId];
  if (gorges && gorges.some(([a, b]) => (a === aId && b === bId) || (a === bId && b === aId))) return STEEP_V;
  return riverId === 'reuss-upper' ? WIDE_U_MAJOR : WIDE_U;
}
function roadSegParams(_roadId: string): SegParams {
  return ROAD_NORMAL;
}

export interface WorldGeo {
  corridors: Corridor[];
  peaks: Peak[];
  lakes: LakePoly[];
  pads: SettlementPad[];
}

let cached: WorldGeo | null = null;

export function buildWorldGeo(): WorldGeo {
  if (cached) return cached;
  const corridors: Corridor[] = [];

  for (const r of RIVERS) {
    const pts = buildSpline(r.via, 14, (a, b) => riverSegParams(r.id, a, b));
    if (pts.length < 2) continue;
    corridors.push({ id: r.id, kind: 'river', pts, length: pts[pts.length - 1].s, surface: 'mud' });
  }

  for (const r of ROADS) {
    const pts = buildSpline(r.via, 10, () => roadSegParams(r.id));
    if (pts.length < 2) continue;
    corridors.push({ id: r.id, kind: 'road', pts, length: pts[pts.length - 1].s, surface: 'road' });
  }

  // Peaks: landmark-kind gazetteer places with real elevation. Radius must stay modest — several of
  // these summits sit only ~700-1500m (game units) from a lake shore or a scenario camera, and a
  // radius bigger than that reaches the *viewer*, not just the mountain (an earlier, larger radius set
  // put the Seelisberg camera directly inside Fronalpstock's own flank). Kept deliberately smaller
  // than a literal 1:4.5 real-footprint conversion would suggest; shoreDampNear() and the smoothstep shape
  // in peakShape() do the rest of the "reads as a mountain, not a cliff" work.
  const peakRadius: Record<string, number> = {
    pilatus: 1500, 'rigi-kulm': 1550, rigi: 1550, buergenstock: 700, stanserhorn: 900,
    fronalpstock: 620, urirotstock: 1250, 'grosser-mythen': 480, rossberg: 950, bristen: 1300,
  };
  // sharp > 1 only for the genuinely spire-like summits (the Mythen); everything else stays close to
  // 1 (the smoothstep base shape in peakShape() already gives a natural broad-massif silhouette).
  const peakSharp: Record<string, number> = { 'grosser-mythen': 1.4 };
  const peaks: Peak[] = [];
  const seenPeak = new Set<string>();
  for (const p of Object.values(PLACES)) {
    if (p.kind !== 'landmark' || p.h < 150) continue;
    if (seenPeak.has(`${p.x}|${p.z}`)) continue; // rigi & rigi-kulm share coords
    seenPeak.add(`${p.x}|${p.z}`);
    peaks.push({ id: p.id, x: p.x, z: p.z, h: p.h, radius: peakRadius[p.id] ?? 800, sharp: peakSharp[p.id] ?? 1.0 });
  }
  // Kleiner Mythen: a smaller unnamed twin beside the Grosser Mythen (visual silhouette only, no gazetteer entry needed).
  const gm = PLACES['grosser-mythen'];
  if (gm) peaks.push({ id: 'kleiner-mythen', x: gm.x + 260, z: gm.z + 120, h: gm.h - 80, radius: 500, sharp: 1.3 });

  const lakes: LakePoly[] = LAKES.map((l) => ({ id: l.id, name: l.name, levelGameH: gameHeightFromAsl(l.levelAsl), poly: l.poly }));

  const padRadius: Record<string, number> = {
    village: 90, town: 120, port: 70, monastery: 100, castle: 25, church: 40, alp: 40, hut: 25,
  };
  const pads: SettlementPad[] = Object.values(PLACES)
    .filter((p) => padRadius[p.kind] !== undefined)
    .map((p) => ({ id: p.id, x: p.x, z: p.z, h: p.h, radius: padRadius[p.kind], kind: p.kind }));

  cached = { corridors, peaks, lakes, pads };
  return cached;
}

/** Nearest point on a distance-sorted spline (linear scan; splines are short so this is cheap when called sparingly). */
export function nearestOnSpline(x: number, z: number, pts: SplinePoint[]): { dist: number; h: number; s: number } {
  let best = Infinity, bestH = pts[0]?.h ?? 0, bestS = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const abx = b.x - a.x, abz = b.z - a.z;
    const l2 = abx * abx + abz * abz;
    let t = l2 === 0 ? 0 : ((x - a.x) * abx + (z - a.z) * abz) / l2;
    t = clamp(t, 0, 1);
    const px = a.x + abx * t, pz = a.z + abz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best) { best = d; bestH = a.h + (b.h - a.h) * t; bestS = a.s + (b.s - a.s) * t; }
  }
  return { dist: best, h: bestH, s: bestS };
}

export function valleyProfile(dist: number, floorH: number, p: SegParams): number {
  if (dist <= p.halfWidth) return floorH;
  const d = dist - p.halfWidth;
  let t: number;
  if (p.shape === 'cliff') t = 1 - Math.exp(-d / 90);
  else if (p.shape === 'steepV') t = Math.pow(Math.min(d / 260, 3), 0.9);
  else t = Math.pow(Math.min(d / 520, 3), 0.55);
  return floorH + p.riseRate * t;
}

/** Normalised (0..1) footprint shape of a peak at `dist` from its summit: 1 at the summit, 0 at the
 * falloff radius. Callers turn this into an absolute *target* height themselves (`heightmodel.ts`):
 * `target = baseHere + (p.h - baseAtSummit) * peakShape(dist, p)`, then `max()`-blend that target
 * into the running heightfield. peakShape never knows about (and must never be multiplied by) `p.h`
 * itself — that used to be added *on top of* the base ridge field, double-counting the base and
 * overshooting every gazetteer summit height (Pilatus rendered 691m against a gazetteer 565m). */
export function peakShape(dist: number, p: Peak): number {
  const r = p.radius * 1.6;
  if (dist >= r) return 0;
  const t = clamp(1 - dist / r, 0, 1);
  // Smoothstep first (a real massif's footprint is broad — most of the height is already there well
  // before the summit, tapering smoothly at both the outer skirt and the very top), then `sharp`
  // pulls individual peaks pointier on top of that. A raw t^sharp (no smoothstep) concentrates almost
  // all of the relief into the last ~15% of the radius, which reads as a sheer wall, not a mountain —
  // that was a real bug here (Fronalpstock rendered as a cliff blocking the Seelisberg lake view).
  const s = t * t * (3 - 2 * t);
  return Math.pow(s, p.sharp);
}

/** Distance from a point to a line segment, plus the interpolation parameter t (0 at a, 1 at b),
 * clamped to the segment. Local to geodata.ts (not `@core/math`, which this module may not edit) so
 * `buildHeightGrid`'s corridor pass can rasterise distance-to-*segment* (continuous along the whole
 * spline) instead of distance-to-nearest-*sample-point* (which left 100-300m gaps between samples
 * that the old code filled with whatever the peak/base field put there — 85° "roads"). */
export function segmentDistT(px: number, pz: number, ax: number, az: number, bx: number, bz: number): { dist: number; t: number } {
  const abx = bx - ax, abz = bz - az;
  const l2 = abx * abx + abz * abz;
  let t = l2 === 0 ? 0 : ((px - ax) * abx + (pz - az) * abz) / l2;
  t = clamp(t, 0, 1);
  const dx = px - (ax + abx * t), dz = pz - (az + abz * t);
  return { dist: Math.hypot(dx, dz), t };
}

/** Forward+backward max-grade clamp over a corridor's arc-length height profile (`pts[].s`, `.h`),
 * so no two consecutive samples imply a slope steeper than `maxTan` (tan of the limit angle). The
 * gazetteer's real place-to-place grades are already gentle (checked: worst chain segment ~12°), so
 * this is mostly a safety net against any future data changes — but it is what actually guarantees
 * "the pass points keep their gazetteer height and the road between them never exceeds this grade". */
export function limitGrade(pts: SplinePoint[], maxTan: number): number[] {
  const n = pts.length;
  const h = pts.map((p) => p.h);
  if (n < 2) return h;
  const fwd = h.slice();
  for (let i = 1; i < n; i++) {
    const ds = Math.max(1e-3, pts[i].s - pts[i - 1].s);
    const maxDelta = ds * maxTan;
    fwd[i] = clamp(h[i], fwd[i - 1] - maxDelta, fwd[i - 1] + maxDelta);
  }
  const out = fwd.slice();
  for (let i = n - 2; i >= 0; i--) {
    const ds = Math.max(1e-3, pts[i + 1].s - pts[i].s);
    const maxDelta = ds * maxTan;
    out[i] = clamp(fwd[i], out[i + 1] - maxDelta, out[i + 1] + maxDelta);
  }
  return out;
}

/** Shore-blend profile: treats a lake polygon's boundary as a corridor whose floor is the water
 * level, blending the terrain outside the polygon down to lake height near the shore and back up to
 * whatever the mountain/valley field already put there by `D` metres out (issue 1 in the critic sheet:
 * shores must never be vertical-walled trenches). `steep` gives the real Axen cliff (Urnersee east
 * shore) a faster rise while staying continuous — never a step. */
export function shoreProfile(dist: number, levelH: number, D: number, steep: boolean): number {
  const params: SegParams = { shape: 'wideU', halfWidth: 25, influence: D, riseRate: steep ? 250 : 120, corridorWidthM: 0 };
  return valleyProfile(dist, levelH, params);
}

export function lakeShelf(x: number, z: number, lake: LakePoly): number | null {
  const d = polygonSdf(x, z, lake.poly); // negative inside
  if (d >= -0.01) return null;
  const shelf = -3 * Math.min(1, -d / 40);
  const drop = -25 * Math.min(1, Math.max(0, -d - 40) / 160);
  return lake.levelGameH + shelf + drop;
}

export function insideAnyLake(x: number, z: number, geo: WorldGeo): LakePoly | null {
  for (const l of geo.lakes) if (pointInPolygon(x, z, l.poly)) return l;
  return null;
}
