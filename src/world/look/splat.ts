/**
 * The terrain splat mask: two RGBA textures over the whole map that tell the terrain shader what
 * kind of ground each point is. Baked once, on the main thread, from the CPU surface grid plus the
 * authored geography (roads and settlement pads), and then sampled bilinearly by the material.
 *
 * Layout (this is the contract with terrainMaterial.ts):
 *
 *   A.r meadow   A.g forest   A.b rock    A.a scree
 *   B.r mud      B.g yard     B.b road    B.a shoreWet
 *
 *   grass = 1 − (meadow + forest + rock + scree + mud + yard)      ← derived, not stored
 *
 * Two of the eight channels are deliberately NOT surface weights:
 *
 *  * **B.b is a distance field, not a road weight.** The mask has one texel per 7.8 m; a cart track
 *    is 3–4 m wide, so a track *painted* into the mask can only ever be a chain of 7.8 m blocks —
 *    which is exactly why the roads through the villages read as a smear rather than a track. Storing
 *    "distance to the nearest road centreline", encoded 1 at the centreline → 0 at ROAD_RANGE, lets
 *    the bilinear filter reconstruct a smooth sub-texel distance, and the shader threshold it into a
 *    crisp track of any width it likes, wobbled by per-pixel noise. The same trick gives the verges
 *    (grass at 4 m, worn earth at 2 m) for free.
 *  * **B.g is a smooth pad falloff, not a classification.** heightmodel classifies a hard disc of
 *    `settlement` at 0.35·radius and nothing beyond it; baked one-hot that is a 7.8 m staircase at
 *    the village edge. Here the pad geometry is evaluated exactly and continuously, and the ragged
 *    "grass creeping back into the yard" edge is added per pixel in the shader instead.
 *
 * Deriving grass rather than storing it is what buys the room for those two: seven surfaces plus
 * two hint channels plus wetness does not fit in eight, but the weights sum to one, so one of them
 * never has to be written down.
 */
import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RGBAFormat, UnsignedByteType } from 'three';
import { MAP_BOUNDS } from '@content/gazetteer';
import { lakeLevelAt } from '../lakes';
import { buildWorldGeo } from '../geodata';
import { releaseAfterUpload } from '../textures';

/** Metres of height above the lake surface over which the shore stays visibly wet. */
export const SHORE_WET_M = 9;
/** Metres from a road centreline that B.b still resolves. Beyond this the channel reads 0. */
export const ROAD_RANGE = 40;

/** heightmodel SURFACE_IDS index -> [mask texture 0|1, channel 0..3], or -1 for "derived grass". */
const SURFACE_SLOT: Record<number, [0 | 1, number] | null> = {
  0: null,      // grass    -> derived
  8: [0, 0],    // meadow
  2: [0, 1],    // forest
  1: [0, 2],    // rock
  3: [0, 3],    // scree
  5: [1, 0],    // mud
  4: [1, 0],    // water    -> wet shore under the lake surface
  6: null,      // road     -> the distance field draws the track; the verge stays grass
  7: null,      // settlement -> the pad falloff in B.g draws the yard
  9: null,      // snow     -> never baked; the shader adds it live from the snow line
};

export interface SplatMasks {
  a: DataTexture;
  b: DataTexture;
  width: number;
  height: number;
}

function mkTexture(data: Uint8Array<ArrayBuffer>, w: number, h: number): DataTexture {
  const t = new DataTexture(data, w, h, RGBAFormat, UnsignedByteType);
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  t.onUpdate = () => releaseAfterUpload(t);   // 17.8 MB per mask; the GPU copy is the only one needed
  return t;
}

/**
 * Coarse "what height is the nearest lake surface here" field. NaN means no shoreline within range,
 * so those texels get no wet band at all. The nine lakes sit at five different levels — the Ägerisee
 * is 97 game-metres above the Vierwaldstättersee — which a single uLakeLevel scalar cannot express.
 */
function nearestLakeLevelGrid(cw: number, ch: number): Float32Array {
  const out = new Float32Array(cw * ch);
  const sx = (MAP_BOUNDS.maxX - MAP_BOUNDS.minX) / (cw - 1);
  const sz = (MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ) / (ch - 1);
  for (let gz = 0; gz < ch; gz++) {
    const wz = MAP_BOUNDS.minZ + gz * sz;
    for (let gx = 0; gx < cw; gx++) {
      const lvl = lakeLevelAt(MAP_BOUNDS.minX + gx * sx, wz, 260);
      out[gz * cw + gx] = lvl === null ? NaN : lvl;
    }
  }
  return out;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0 || 1e-6)));
  return t * t * (3 - 2 * t);
}

/**
 * Distance from (px,pz) to segment a-b, squared. Inlined by hand rather than reusing geodata's
 * segmentDistT because this runs a few hundred thousand times during the bake and the object that
 * function returns would be a few hundred thousand allocations.
 */
function segDist2(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const abx = bx - ax, abz = bz - az;
  const l2 = abx * abx + abz * abz;
  let t = l2 === 0 ? 0 : ((px - ax) * abx + (pz - az) * abz) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = px - (ax + abx * t), dz = pz - (az + abz * t);
  return dx * dx + dz * dz;
}

/**
 * Bake the two mask textures.
 *
 * @param surfaceIdAt heightmodel surface id at a world position
 * @param gridW/gridH mask resolution (matches the CPU height grid: 2048 x 2176, 7.8 m/texel)
 * @param heightAt terrain height, for the shore wet band; omit to skip it
 */
export function bakeSplatMasks(
  surfaceIdAt: (x: number, z: number) => number,
  gridW: number,
  gridH: number,
  heightAt?: (x: number, z: number) => number,
): SplatMasks {
  const n = gridW * gridH;
  const a = new Uint8Array(new ArrayBuffer(n * 4));
  const b = new Uint8Array(new ArrayBuffer(n * 4));
  const sx = (MAP_BOUNDS.maxX - MAP_BOUNDS.minX) / (gridW - 1);
  const sz = (MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ) / (gridH - 1);
  const toX = (gx: number): number => MAP_BOUNDS.minX + gx * sx;
  const toZ = (gz: number): number => MAP_BOUNDS.minZ + gz * sz;

  // ---- 1. base surfaces + shore wetness -------------------------------------------------------
  const CW = 128, CH = 136;
  const lakeLvl = heightAt ? nearestLakeLevelGrid(CW, CH) : null;
  const water = new Uint8Array(n);
  for (let gz = 0; gz < gridH; gz++) {
    const wz = toZ(gz);
    const cz = Math.min(CH - 1, Math.round((gz / (gridH - 1)) * (CH - 1)));
    for (let gx = 0; gx < gridW; gx++) {
      const i = gz * gridW + gx;
      const wx = toX(gx);
      const id = surfaceIdAt(wx, wz);
      if (id === 4) water[i] = 1;
      const slot = SURFACE_SLOT[id];
      if (slot) (slot[0] === 0 ? a : b)[i * 4 + slot[1]] = 255;
      if (lakeLvl && heightAt) {
        const lvl = lakeLvl[cz * CW + Math.min(CW - 1, Math.round((gx / (gridW - 1)) * (CW - 1)))];
        if (lvl === lvl) {   // NaN = nothing to be wet next to
          const above = heightAt(wx, wz) - lvl;
          const wet = above < -2 ? 1 : 1 - Math.min(1, Math.max(0, above / SHORE_WET_M));
          b[i * 4 + 3] = Math.round(wet * 255);
        }
      }
    }
  }

  const geo = buildWorldGeo();

  // ---- 2. village yards: continuous pad falloff into B.g ---------------------------------------
  // Only the kinds that actually have trodden ground around them. A castle keep or a lone chapel
  // gets a small yard; an alp hut gets almost none (its ground is pasture, cropped short).
  const YARD_SCALE: Record<string, number> = {
    town: 1.05, village: 1.0, port: 1.0, monastery: 0.9, church: 0.8, castle: 0.9, hut: 0.55, alp: 0.5,
  };
  for (const pad of geo.pads) {
    const scale = YARD_SCALE[pad.kind] ?? 0.8;
    const outer = pad.radius * 1.15 * scale;
    const inner = pad.radius * 0.5 * scale;
    const rx = Math.ceil(outer / sx), rz = Math.ceil(outer / sz);
    const gcx = Math.round((pad.x - MAP_BOUNDS.minX) / sx), gcz = Math.round((pad.z - MAP_BOUNDS.minZ) / sz);
    for (let gz = Math.max(0, gcz - rz); gz <= Math.min(gridH - 1, gcz + rz); gz++) {
      const wz = toZ(gz);
      for (let gx = Math.max(0, gcx - rx); gx <= Math.min(gridW - 1, gcx + rx); gx++) {
        const i = gz * gridW + gx;
        if (water[i]) continue;                       // a quay stops at the waterline
        const d = Math.hypot(toX(gx) - pad.x, wz - pad.z);
        if (d >= outer) continue;
        const w = 1 - smoothstep(inner, outer, d);
        const cur = b[i * 4 + 1];
        if (w * 255 > cur) b[i * 4 + 1] = Math.round(w * 255);
      }
    }
  }

  // ---- 3. roads: a distance field, so the shader can draw a track narrower than one texel -------
  const roadNear = new Float32Array(n).fill(ROAD_RANGE);
  for (const c of geo.corridors) {
    if (c.kind !== 'road') continue;
    for (let k = 1; k < c.pts.length; k++) {
      const p0 = c.pts[k - 1], p1 = c.pts[k];
      const x0 = Math.min(p0.x, p1.x) - ROAD_RANGE, x1 = Math.max(p0.x, p1.x) + ROAD_RANGE;
      const z0 = Math.min(p0.z, p1.z) - ROAD_RANGE, z1 = Math.max(p0.z, p1.z) + ROAD_RANGE;
      const gx0 = Math.max(0, Math.floor((x0 - MAP_BOUNDS.minX) / sx));
      const gx1 = Math.min(gridW - 1, Math.ceil((x1 - MAP_BOUNDS.minX) / sx));
      const gz0 = Math.max(0, Math.floor((z0 - MAP_BOUNDS.minZ) / sz));
      const gz1 = Math.min(gridH - 1, Math.ceil((z1 - MAP_BOUNDS.minZ) / sz));
      for (let gz = gz0; gz <= gz1; gz++) {
        const wz = toZ(gz);
        const row = gz * gridW;
        for (let gx = gx0; gx <= gx1; gx++) {
          const d2 = segDist2(toX(gx), wz, p0.x, p0.z, p1.x, p1.z);
          if (d2 >= ROAD_RANGE * ROAD_RANGE) continue;
          const d = Math.sqrt(d2);
          if (d < roadNear[row + gx]) roadNear[row + gx] = d;
        }
      }
    }
  }
  for (let i = 0; i < n; i++) {
    if (water[i]) continue;                     // no track over a lake (the Axen path hugs the shore)
    const d = roadNear[i];
    if (d >= ROAD_RANGE) continue;
    b[i * 4 + 2] = Math.round((1 - d / ROAD_RANGE) * 255);
  }

  // ---- 4. normalise: the six partition channels may not sum past 1 -----------------------------
  // (a village yard laid over classified forest, a road verge over meadow). grass = 1 − sum, so an
  // over-full texel would otherwise produce negative grass and a black hole in the blend.
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const sum = a[o] + a[o + 1] + a[o + 2] + a[o + 3] + b[o] + b[o + 1];
    if (sum <= 255) continue;
    const k = 255 / sum;
    a[o] = a[o] * k; a[o + 1] = a[o + 1] * k; a[o + 2] = a[o + 2] * k; a[o + 3] = a[o + 3] * k;
    b[o] = b[o] * k; b[o + 1] = b[o + 1] * k;
  }

  return { a: mkTexture(a, gridW, gridH), b: mkTexture(b, gridW, gridH), width: gridW, height: gridH };
}
