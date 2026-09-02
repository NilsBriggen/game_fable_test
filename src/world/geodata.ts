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

/** Catmull-Rom through 4 points (p0..p3), t in [0,1] between p1 and p2. */
function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
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
    for (let j = 0; j <= samplesPerSeg; j++) {
      if (i > 0 && j === 0) continue; // avoid duplicate join point
      const t = j / samplesPerSeg;
      const x = catmullRom(p0.x, p1.x, p2.x, p3.x, t);
      const z = catmullRom(p0.z, p1.z, p2.z, p3.z, t);
      const h = p1.h + (p2.h - p1.h) * t; // linear height along the segment (monotone, no overshoot)
      s += Math.hypot(x - prevX, z - prevZ);
      pts.push({ x, z, h, s, ...seg });
      prevX = x;
      prevZ = z;
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
const ROAD_NORMAL: SegParams = { shape: 'wideU', halfWidth: 6, influence: 280, riseRate: 200, corridorWidthM: 6 };

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
  // than a literal 1:4.5 real-footprint conversion would suggest; shoreDamp() and the smoothstep shape
  // in peakBump() do the rest of the "reads as a mountain, not a cliff" work.
  const peakRadius: Record<string, number> = {
    pilatus: 1500, 'rigi-kulm': 1550, rigi: 1550, buergenstock: 700, stanserhorn: 900,
    fronalpstock: 620, urirotstock: 1250, 'grosser-mythen': 480, rossberg: 950, bristen: 1300,
  };
  // sharp > 1 only for the genuinely spire-like summits (the Mythen); everything else stays close to
  // 1 (the smoothstep base shape in peakBump() already gives a natural broad-massif silhouette).
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

export function peakBump(dist: number, p: Peak): number {
  const r = p.radius * 1.6;
  if (dist >= r) return 0;
  const t = clamp(1 - dist / r, 0, 1);
  // Smoothstep first (a real massif's footprint is broad — most of the height is already there well
  // before the summit, tapering smoothly at both the outer skirt and the very top), then `sharp`
  // pulls individual peaks pointier on top of that. A raw t^sharp (no smoothstep) concentrates almost
  // all of the relief into the last ~15% of the radius, which reads as a sheer wall, not a mountain —
  // that was a real bug here (Fronalpstock rendered as a cliff blocking the Seelisberg lake view).
  const s = t * t * (3 - 2 * t);
  return p.h * Math.pow(s, p.sharp);
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
