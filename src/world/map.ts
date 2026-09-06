/**
 * The world map (WorldService.mapImage / worldToMapUv): a period-styled parchment chart of the
 * Waldstätte, drawn once to a 1400x1400 canvas and cached as a data URL. Sepia hillshade and a
 * hypsometric wash under ink work — lake shore hatching, rivers, mule tracks, forest stipple,
 * mountain hachures, settlement marks — with serif region labels and a ruled frame on top.
 */
import { MAP_BOUNDS, PLACES } from '@content/gazetteer';
import type { RegionDef } from '@core/schemas';
import { fbm2D, valueNoise2D } from './noise';
import type { TerrainManager } from './terrain';
import { buildWorldGeo } from './geodata';

const SIZE = 1400;
const SNOW_H = 900;   // game height where the chart starts leaving the paper bare (perpetual snow)

const INK = '#43301c';
const INK_SOFT = 'rgba(67,48,28,0.55)';
const WATER_INK = '#3f5c69';

let cachedUrl: string | null = null;
/** Cache key for the fogged variant: the discovery set + player reveal cell the baked image holds. */
let cachedFogKey: string | null = null;

export function worldToMapUv(x: number, z: number): [number, number] {
  const u = (x - MAP_BOUNDS.minX) / (MAP_BOUNDS.maxX - MAP_BOUNDS.minX);
  const v = (z - MAP_BOUNDS.minZ) / (MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ);
  return [u, v];
}

export interface MapFogSpot { x: number; z: number; r: number }

/**
 * Pure fog predicate (4.6 map/compass fog): true when the world point is still under fog-of-war,
 * i.e. outside every reveal disc (discovered POIs at their discoverRadius + the player disc).
 * Pure so headless tests can assert the mask without a canvas.
 */
export function mapFogAt(x: number, z: number, spots: readonly MapFogSpot[]): boolean {
  for (const s of spots) {
    const dx = x - s.x, dz = z - s.z;
    if (dx * dx + dz * dz <= s.r * s.r) return false;
  }
  return true;
}

/** Key the fogged image is cached under: sorted POI ids + the player reveal cell (coarse, 200 m). */
export function mapFogKey(discoveredIds: readonly string[], player: { x: number; z: number } | null): string {
  const ids = [...discoveredIds].sort().join(',');
  const cell = player ? `${Math.round(player.x / 200)},${Math.round(player.z / 200)}` : 'nop';
  return `${ids}|${cell}`;
}

/** Build reveal discs from discovered POI defs + the player position (4.6 map fog).
 *  Real chart scale: 16000 m over 1400 px, so a reveal radius needs ~1400+ px to open a readable
 *  window — POI discs use 6x discoverRadius (min 900 m), the player disc 1200 m. */
export function mapFogSpots(
  pois: readonly { id: string; x: number; z: number; discoverRadius: number }[],
  discoveredIds: readonly string[],
  player: { x: number; z: number } | null,
): MapFogSpot[] {
  const set = new Set(discoveredIds);
  const spots: MapFogSpot[] = [];
  for (const p of pois) {
    if (!set.has(p.id)) continue;
    spots.push({ x: p.x, z: p.z, r: Math.max(900, p.discoverRadius * 6) });
  }
  if (player) spots.push({ x: player.x, z: player.z, r: 1200 });
  return spots;
}
/**
 * Trace a lake outline as a smooth closed curve instead of the gazetteer's 5–12 straight edges:
 * quadratics through the edge midpoints, with the polygon corners as control points, which is what
 * makes the shoreline read as drawn rather than as a polygon.
 */
function smoothPath(ctx: CanvasRenderingContext2D, poly: [number, number][], shrink = 0): void {
  const n = poly.length;
  let cx = 0, cz = 0;
  for (const [x, z] of poly) { cx += x; cz += z; }
  cx /= n; cz /= n;
  const pts = poly.map(([x, z]) => toPx(cx + (x - cx) * (1 - shrink), cz + (z - cz) * (1 - shrink)));
  const mid = (a: [number, number], b: [number, number]): [number, number] => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  ctx.beginPath();
  let m = mid(pts[n - 1], pts[0]);
  ctx.moveTo(m[0], m[1]);
  for (let i = 0; i < n; i++) {
    const next = mid(pts[i], pts[(i + 1) % n]);
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], next[0], next[1]);
  }
  ctx.closePath();
}

function toPx(x: number, z: number): [number, number] {
  const [u, v] = worldToMapUv(x, z);
  return [u * SIZE, v * SIZE];
}

/** Hypsometric wash: pasture green-grey in the valleys, ochre on the alps, bare paper on the snow. */
function landTint(h: number, surface: string): [number, number, number] {
  if (surface === 'settlement' || surface === 'road') return [206, 180, 138];
  const t = Math.max(0, Math.min(1, h / SNOW_H));
  const keys: [number, [number, number, number]][] = [
    [0.00, [158, 176, 116]],   // valley pasture
    [0.14, [172, 180, 118]],
    [0.34, [196, 180, 122]],   // upper alp
    [0.56, [184, 164, 130]],   // rock and scree
    [0.76, [190, 180, 168]],
    [0.90, [208, 206, 202]],   // the paper starts showing through
    [1.00, [224, 223, 220]],
  ];
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1][0]) i++;
  const [ta, ca] = keys[i], [tb, cb] = keys[i + 1];
  const f = (t - ta) / (tb - ta);
  return [ca[0] + (cb[0] - ca[0]) * f, ca[1] + (cb[1] - ca[1]) * f, ca[2] + (cb[2] - ca[2]) * f];
}

export async function renderMapImage(
  terrain: TerrainManager,
  regions: RegionDef[],
  fog?: { spots: MapFogSpot[]; key: string },
): Promise<string> {
  // The unforged base chart is cached on its own; a fogged variant is cached under its fog key so
  // discovery (or a 200 m player-cell move) re-bakes once, not per frame.
  if (!fog && cachedUrl) return cachedUrl;
  if (fog && fog.key === cachedFogKey && cachedUrl) return cachedUrl;
  await terrain.ready;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE; canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  const geo = buildWorldGeo();

  // ---- 1. relief + hypsometric wash on paper -------------------------------------------------
  // The relief is drawn at half scale and stretched back up. That is 4x cheaper, and the smooth
  // upscale is also what turns the surface grid's 100 m classification blocks into a wash.
  const R = SIZE >> 1;
  const img = ctx.createImageData(R, R);
  const L = normalize3(-0.55, 0.72, -0.42); // light from the north-west, the cartographic convention
  const spanX = MAP_BOUNDS.maxX - MAP_BOUNDS.minX, spanZ = MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ;
  const forestMask = new Uint8Array(R * R);
  for (let py = 0; py < R; py++) {
    const z = MAP_BOUNDS.minZ + (py / (R - 1)) * spanZ;
    for (let px = 0; px < R; px++) {
      const x = MAP_BOUNDS.minX + (px / (R - 1)) * spanX;
      const surf = terrain.surfaceAt(x, z);
      const i = (py * R + px) * 4;
      if (surf === 'forest') forestMask[py * R + px] = 1;
      if (surf === 'water') { img.data[i + 3] = 0; continue; } // lakes are painted as polygons below
      const h = terrain.heightAt(x, z);
      const [r, g, b] = landTint(h, surf);
      const n = terrain.normalAt(x, z);
      const dot = n.x * L[0] + n.y * L[1] + n.z * L[2];
      const slope = Math.hypot(n.x, n.z);
      // hillshade with a slight S-curve, so ridges and their shadowed flanks actually read
      let shade = 0.46 + Math.pow(Math.max(0, dot), 0.8) * 0.86 - slope * 0.10;
      shade += (shade - 0.95) * 0.35;
      const grain = (valueNoise2D(px * 0.17, py * 0.17, 17) - 0.5) * 0.08;
      shade = Math.max(0.30, Math.min(1.30, shade + grain));
      img.data[i] = clamp255(r * shade);
      img.data[i + 1] = clamp255(g * shade * 0.985);
      img.data[i + 2] = clamp255(b * shade * 0.93);            // pull everything a touch toward sepia
      img.data[i + 3] = 255;
    }
  }
  // paper first, then the relief over it (lake pixels are transparent and stay paper)
  paintParchment(ctx);
  const relief = document.createElement('canvas');
  relief.width = R; relief.height = R;
  relief.getContext('2d')!.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.globalAlpha = 0.9;
  ctx.drawImage(relief, 0, 0, SIZE, SIZE);
  ctx.globalAlpha = 1;

  // ---- 2. lakes ------------------------------------------------------------------------------
  for (const lake of geo.lakes) {
    smoothPath(ctx, lake.poly);
    ctx.fillStyle = 'rgba(132,168,184,0.80)';
    ctx.fill();
    // shore hatching: shrinking outlines inside the shore, as engraved charts drew still water
    ctx.save();
    smoothPath(ctx, lake.poly);
    ctx.clip();
    ctx.strokeStyle = 'rgba(63,92,105,0.32)';
    ctx.lineWidth = 1.0;
    for (let k = 1; k <= 3; k++) { smoothPath(ctx, lake.poly, k * 0.028); ctx.stroke(); }
    ctx.restore();
    smoothPath(ctx, lake.poly);
    ctx.strokeStyle = WATER_INK;
    ctx.lineWidth = 1.7;
    ctx.stroke();
  }

  // ---- 3. forest stipple ---------------------------------------------------------------------
  ctx.fillStyle = 'rgba(58,74,44,0.85)';
  ctx.strokeStyle = 'rgba(48,62,36,0.9)';
  ctx.lineWidth = 0.9;
  const STEP = 15;
  for (let py = 6; py < SIZE; py += STEP) {
    for (let px = 6; px < SIZE; px += STEP) {
      const jx = Math.round(px + (valueNoise2D(px * 0.7, py * 0.7, 5) * 2 - 1) * STEP * 0.4);
      const jy = Math.round(py + (valueNoise2D(px * 0.7, py * 0.7, 91) * 2 - 1) * STEP * 0.4);
      if (jx < 2 || jy < 2 || jx >= SIZE - 2 || jy >= SIZE - 2) continue;
      // require a solid stand, not one stray forest texel, then thin it further
      const hx = jx >> 1, hy = jy >> 1;
      let dense = 0;
      for (const [ox, oy] of [[0, 0], [2, 0], [-2, 0], [0, 2], [0, -2]]) {
        const qx = hx + ox, qy = hy + oy;
        if (qx >= 0 && qy >= 0 && qx < (SIZE >> 1) && qy < (SIZE >> 1) && forestMask[qy * (SIZE >> 1) + qx]) dense++;
      }
      if (dense < 4) continue;
      if (valueNoise2D(jx * 0.31, jy * 0.31, 44) < 0.42) continue;
      // a 4 px conifer: stem plus a filled triangle
      ctx.beginPath(); ctx.moveTo(jx, jy + 1); ctx.lineTo(jx, jy + 3.6); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(jx, jy - 4); ctx.lineTo(jx + 2.1, jy + 1.2); ctx.lineTo(jx - 2.1, jy + 1.2); ctx.closePath(); ctx.fill();
    }
  }

  // ---- 4. mountain hachures ------------------------------------------------------------------
  ctx.strokeStyle = 'rgba(74,54,32,0.85)';
  for (const peak of geo.peaks) {
    if (peak.h < 260) continue;
    const [px, py] = toPx(peak.x, peak.z);
    const w = Math.max(5, Math.min(15, peak.h / 42));
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(px - w, py + w * 0.5);
    ctx.lineTo(px, py - w * 0.85);
    ctx.lineTo(px + w, py + w * 0.5);
    ctx.stroke();
    ctx.lineWidth = 0.8;
    for (let k = -2; k <= 2; k++) {                       // shading strokes down the eastern flank
      if (k === 0) continue;
      const t = k / 3;
      ctx.beginPath();
      ctx.moveTo(px + t * w * 0.85, py - w * 0.85 + Math.abs(t) * w * 1.2);
      ctx.lineTo(px + t * w * 0.85, py + w * 0.5);
      ctx.stroke();
    }
  }

  // ---- 5. rivers and mule tracks -------------------------------------------------------------
  for (const c of geo.corridors) {
    if (c.kind !== 'river') continue;
    ctx.strokeStyle = 'rgba(63,92,105,0.85)';
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    c.pts.forEach((p, i) => { const [a, b] = toPx(p.x, p.z); i === 0 ? ctx.moveTo(a, b) : ctx.lineTo(a, b); });
    ctx.stroke();
  }
  // ---- 5b. roads under fog (4.6): skip road segments whose midpoint is still fogged, so the
  //  wash does not carry a free road atlas. Rivers stay (water is geography, not knowledge).
  for (const c of geo.corridors) {
    if (c.kind !== 'road') continue;
    if (fog && c.pts.length > 1) {
      const mid = c.pts[Math.floor(c.pts.length / 2)]!;
      if (mapFogAt(mid.x, mid.z, fog.spots)) continue;
    }
    ctx.strokeStyle = INK_SOFT;
    ctx.lineWidth = 2.6;
    ctx.setLineDash([]);
    ctx.beginPath();
    c.pts.forEach((p, i) => { const [a, b] = toPx(p.x, p.z); i === 0 ? ctx.moveTo(a, b) : ctx.lineTo(a, b); });
    ctx.stroke();
    ctx.strokeStyle = '#f0e6ce';           // the pale core makes it read as a double-ruled track
    ctx.lineWidth = 1.1;
    ctx.setLineDash([7, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ---- 6. settlement marks --------------------------------------------------------------------
  // 4.6 fog: marks for still-fogged places are skipped — the wash would otherwise leave them
  // faintly legible as free geography. Revealed places keep their marks.
  for (const p of Object.values(PLACES)) {
    if (fog && mapFogAt(p.x, p.z, fog.spots)) continue;
    const [px, py] = toPx(p.x, p.z);
    ctx.fillStyle = INK;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1;
    if (p.kind === 'town') {
      ctx.beginPath(); ctx.arc(px, py, 3.4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(px, py, 5.6, 0, Math.PI * 2); ctx.stroke();
    } else if (p.kind === 'village' || p.kind === 'port') {
      ctx.fillRect(px - 2, py - 2, 4, 4);
    } else if (p.kind === 'castle') {
      ctx.fillRect(px - 2.6, py - 1.6, 5.2, 3.8);
      for (const dx of [-2.6, -0.7, 1.2]) ctx.fillRect(px + dx, py - 3.6, 1.4, 2);
    } else if (p.kind === 'church' || p.kind === 'monastery' || p.kind === 'chapel') {
      ctx.beginPath(); ctx.moveTo(px, py - 4.5); ctx.lineTo(px, py + 1.5); ctx.moveTo(px - 1.8, py - 2.6); ctx.lineTo(px + 1.8, py - 2.6); ctx.stroke();
    }
  }

  // ---- 6b. fog-of-war (4.6): undiscovered terrain is dimmed under a dark umber wash with soft
  //  radial reveals around discovered POIs + the player. Direct pixel blend, no composite modes
  //  (destination-out punches through the chart to transparency; the ageing pass then refills those
  //  holes to white). Pass 1 dims the whole chart; pass 2 un-dims inside each reveal disc
  //  (bbox-clipped, smooth 0.55→1.0 edge). Undiscovered settlement marks / region labels / roads
  //  are skipped at draw time (below/above), so fog hides knowledge, not just light. One-off bake.
  function paintFog(): void {
    const spanX = MAP_BOUNDS.maxX - MAP_BOUNDS.minX, spanZ = MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ;
    const A = 0.82, keep = 1 - A, FR = 38, FG = 30, FB = 20;
    const img = ctx.getImageData(0, 0, SIZE, SIZE);
    const d = img.data;
    const orig = new Uint8ClampedArray(d); // pre-fog chart, to blend back inside reveals
    for (let i = 0; i < d.length; i += 4) {
      d[i] = d[i] * keep + FR * A;
      d[i + 1] = d[i + 1] * keep + FG * A;
      d[i + 2] = d[i + 2] * keep + FB * A;
    }
    for (const s of (fog as { spots: MapFogSpot[] }).spots) {
      const [su, sv] = worldToMapUv(s.x, s.z);
      const cx = su * SIZE, cy = sv * SIZE;
      const rp = Math.max((s.r / spanX) * SIZE, (s.r / spanZ) * SIZE);
      const x0 = Math.max(0, Math.floor(cx - rp)), x1 = Math.min(SIZE - 1, Math.ceil(cx + rp));
      const y0 = Math.max(0, Math.floor(cy - rp)), y1 = Math.min(SIZE - 1, Math.ceil(cy + rp));
      for (let py = y0; py <= y1; py++) {
        const wz = MAP_BOUNDS.minZ + ((py + 0.5) / SIZE) * spanZ;
        for (let px = x0; px <= x1; px++) {
          const wx = MAP_BOUNDS.minX + ((px + 0.5) / SIZE) * spanX;
          const dd = Math.hypot(wx - s.x, wz - s.z) / s.r;
          if (dd >= 1) continue;
          let c = 1;
          if (dd > 0.55) { const t = (dd - 0.55) / 0.45; c = 1 - t * t * (3 - 2 * t); }
          const i = (py * SIZE + px) * 4;
          d[i] += (orig[i] - d[i]) * c;
          d[i + 1] += (orig[i + 1] - d[i + 1]) * c;
          d[i + 2] += (orig[i + 2] - d[i + 2]) * c;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    // lakes faintly back: water is geography, not knowledge
    ctx.save();
    ctx.strokeStyle = 'rgba(63,92,105,0.55)';
    ctx.lineWidth = 1.2;
    for (const lake of geo.lakes) { smoothPath(ctx, lake.poly); ctx.stroke(); }
    ctx.restore();
  }

  // ---- 7. serif region labels -------------------------------------------------------------------
  // 4.6 fog: labels whose centroid is still fogged are skipped — the wash would otherwise leave
  // them legible (the earlier revision painted fog over the labels, which punched white holes).
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const r of regions) {
    const [cx, cy] = centroidPx(r.bounds as [number, number][]);
    if (cx < 40 || cy < 40 || cx > SIZE - 40 || cy > SIZE - 40) continue;
    if (fog) {
      const spanX = MAP_BOUNDS.maxX - MAP_BOUNDS.minX, spanZ = MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ;
      const wx = MAP_BOUNDS.minX + (cx / SIZE) * spanX, wz = MAP_BOUNDS.minZ + (cy / SIZE) * spanZ;
      if (mapFogAt(wx, wz, fog.spots)) continue;
    }
    const label = spaced(r.name.toUpperCase());
    ctx.font = 'italic 600 21px Georgia, "Times New Roman", serif';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(228,214,182,0.7)';    // faint paper halo so the name reads over the hachures
    ctx.strokeText(label, cx, cy);
    ctx.fillStyle = 'rgba(62,42,22,0.95)';
    ctx.fillText(label, cx, cy);
  }

  // ---- 8. ageing, frame, compass -----------------------------------------------------------------
  if (fog) paintFog(); // over the whole chart: undiscovered labels/marks/roads were skipped above,
  // so the wash only needs to dim relief/stipple/hachures; reveals restore the chart underneath
  ageParchment(ctx);
  drawFrame(ctx);
  drawCompass(ctx, SIZE - 132, 132);
  drawTitle(ctx);

  cachedUrl = canvas.toDataURL('image/png');
  if (fog) cachedFogKey = fog.key;
  return cachedUrl;
}

/**
 * Warm laid paper. Painted at 1/4 scale and stretched: the mottling is all low-frequency, and a
 * full-resolution fbm here costs several seconds of the map's one-off generation budget.
 */
function paintParchment(ctx: CanvasRenderingContext2D): void {
  const P = SIZE >> 2;
  const small = document.createElement('canvas');
  small.width = P; small.height = P;
  const sctx = small.getContext('2d')!;
  const img = sctx.createImageData(P, P);
  for (let y = 0; y < P; y++) {
    for (let x = 0; x < P; x++) {
      const i = (y * P + x) * 4;
      const f = fbm2D(x, y, { octaves: 4, frequency: 0.016, seed: 907 }) * 0.5 + 0.5;
      const fibre = Math.sin(y * 3.6 + fbm2D(x, y, { octaves: 2, frequency: 0.08, seed: 51 }) * 6) * 0.014;
      const k = 0.88 + f * 0.22 + fibre;
      img.data[i] = clamp255(232 * k);
      img.data[i + 1] = clamp255(216 * k);
      img.data[i + 2] = clamp255(182 * k);
      img.data[i + 3] = 255;
    }
  }
  sctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(small, 0, 0, SIZE, SIZE);
}

/** Edge burn, foxing and a vignette, painted over the finished chart. */
function ageParchment(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  const v = ctx.createRadialGradient(SIZE * 0.5, SIZE * 0.46, SIZE * 0.28, SIZE * 0.5, SIZE * 0.5, SIZE * 0.78);
  v.addColorStop(0, 'rgba(255,255,255,1)');
  v.addColorStop(0.72, 'rgba(226,206,170,1)');
  v.addColorStop(1, 'rgba(178,150,110,1)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, SIZE, SIZE);
  for (const [cx, cy, r, a] of [[0.18, 0.78, 0.17, 0.16], [0.83, 0.28, 0.12, 0.13], [0.62, 0.88, 0.1, 0.1]]) {
    const g = ctx.createRadialGradient(SIZE * cx, SIZE * cy, 0, SIZE * cx, SIZE * cy, SIZE * r);
    g.addColorStop(0, `rgba(176,143,96,${a})`);
    g.addColorStop(1, 'rgba(176,143,96,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, SIZE, SIZE);
  }
  ctx.restore();
}

function drawFrame(ctx: CanvasRenderingContext2D): void {
  const m = 26;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 5;
  ctx.strokeRect(m, m, SIZE - 2 * m, SIZE - 2 * m);
  ctx.lineWidth = 1.6;
  ctx.strokeRect(m + 10, m + 10, SIZE - 2 * m - 20, SIZE - 2 * m - 20);
  // tick marks along the inner rule, one per 2 000 game metres
  ctx.lineWidth = 1.4;
  const inner = m + 10, span = SIZE - 2 * inner;
  for (let k = 0; k <= 8; k++) {
    const t = inner + (span * k) / 8;
    ctx.beginPath(); ctx.moveTo(t, inner); ctx.lineTo(t, inner + 9); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(t, SIZE - inner); ctx.lineTo(t, SIZE - inner - 9); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(inner, t); ctx.lineTo(inner + 9, t); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(SIZE - inner, t); ctx.lineTo(SIZE - inner - 9, t); ctx.stroke();
  }
}

function drawCompass(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  const R = 46;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = 1.3;
  ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, R * 0.78, 0, Math.PI * 2); ctx.stroke();
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const long = k % 2 === 0;
    const r0 = long ? R * 0.14 : R * 0.3, r1 = long ? R * 0.74 : R * 0.55;
    ctx.beginPath();
    ctx.moveTo(Math.sin(a) * r0, -Math.cos(a) * r0);
    ctx.lineTo(Math.sin(a + 0.16) * r1 * 0.42, -Math.cos(a + 0.16) * r1 * 0.42);
    ctx.lineTo(Math.sin(a) * r1, -Math.cos(a) * r1);
    ctx.lineTo(Math.sin(a - 0.16) * r1 * 0.42, -Math.cos(a - 0.16) * r1 * 0.42);
    ctx.closePath();
    ctx.globalAlpha = long ? 0.92 : 0.55;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.font = 'italic 600 17px Georgia, "Times New Roman", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('S', 0, -R - 13);   // world north is -Z, which is the bottom of the chart
  ctx.fillText('N', 0, R + 13);
  ctx.fillText('W', -R - 13, 0);
  ctx.fillText('O', R + 13, 0);
  ctx.restore();
}

function drawTitle(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(62,42,24,0.94)';
  ctx.font = 'italic 600 38px Georgia, "Times New Roman", serif';
  ctx.fillText(spaced('DIE WALDSTÄTTE'), 62, 104);
  ctx.font = 'italic 20px Georgia, "Times New Roman", serif';
  ctx.fillStyle = 'rgba(74,52,30,0.85)';
  ctx.fillText('Uri · Schwyz · Unterwalden und der Vierwaldstättersee', 64, 134);
  ctx.restore();
}

function spaced(s: string): string {
  return s.split('').join(' ');
}

function centroidPx(poly: [number, number][]): [number, number] {
  let sx = 0, sz = 0;
  for (const [x, z] of poly) { sx += x; sz += z; }
  return toPx(sx / poly.length, sz / poly.length);
}
function normalize3(x: number, y: number, z: number): [number, number, number] {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}
function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

export function invalidateMapCache(): void {
  cachedUrl = null;
  cachedFogKey = null;
}
