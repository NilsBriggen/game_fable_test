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
const SNOW_H = 620;   // game height where the chart starts leaving the paper bare (perpetual snow)

const INK = '#43301c';
const INK_SOFT = 'rgba(67,48,28,0.55)';
const WATER_INK = '#3f5c69';

let cachedUrl: string | null = null;

export function worldToMapUv(x: number, z: number): [number, number] {
  const u = (x - MAP_BOUNDS.minX) / (MAP_BOUNDS.maxX - MAP_BOUNDS.minX);
  const v = (z - MAP_BOUNDS.minZ) / (MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ);
  return [u, v];
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
    [0.00, [190, 190, 138]],
    [0.16, [176, 178, 124]],
    [0.38, [196, 174, 122]],
    [0.62, [198, 166, 120]],
    [0.82, [214, 196, 168]],
    [1.00, [238, 232, 220]],
  ];
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1][0]) i++;
  const [ta, ca] = keys[i], [tb, cb] = keys[i + 1];
  const f = (t - ta) / (tb - ta);
  return [ca[0] + (cb[0] - ca[0]) * f, ca[1] + (cb[1] - ca[1]) * f, ca[2] + (cb[2] - ca[2]) * f];
}

export async function renderMapImage(terrain: TerrainManager, regions: RegionDef[]): Promise<string> {
  if (cachedUrl) return cachedUrl;
  await terrain.ready;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE; canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  const geo = buildWorldGeo();

  // ---- 1. relief + hypsometric wash on paper -------------------------------------------------
  const img = ctx.createImageData(SIZE, SIZE);
  const L = normalize3(-0.55, 0.72, -0.42); // light from the north-west, the cartographic convention
  const spanX = MAP_BOUNDS.maxX - MAP_BOUNDS.minX, spanZ = MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ;
  const forestMask = new Uint8Array(SIZE * SIZE);
  for (let py = 0; py < SIZE; py++) {
    const z = MAP_BOUNDS.minZ + (py / (SIZE - 1)) * spanZ;
    for (let px = 0; px < SIZE; px++) {
      const x = MAP_BOUNDS.minX + (px / (SIZE - 1)) * spanX;
      const surf = terrain.surfaceAt(x, z);
      const i = (py * SIZE + px) * 4;
      if (surf === 'forest') forestMask[py * SIZE + px] = 1;
      if (surf === 'water') { img.data[i] = 0; img.data[i + 3] = 0; continue; } // lakes are painted as polygons below
      const h = terrain.heightAt(x, z);
      const [r, g, b] = landTint(h, surf);
      const n = terrain.normalAt(x, z);
      const dot = n.x * L[0] + n.y * L[1] + n.z * L[2];
      // slope shading: a soft sepia wash, deliberately gentler than a satellite hillshade
      let shade = 0.66 + Math.max(0, dot) * 0.52;
      const slope = Math.hypot(n.x, n.z);
      shade -= slope * 0.22;                                   // steep ground reads darker
      const grain = fbm2D(px * 1.4, py * 1.4, { octaves: 3, frequency: 0.06, seed: 17 }) * 0.06;
      shade = Math.max(0.32, Math.min(1.25, shade + grain));
      img.data[i] = clamp255(r * shade);
      img.data[i + 1] = clamp255(g * shade * 0.985);
      img.data[i + 2] = clamp255(b * shade * 0.93);            // pull everything a touch toward sepia
      img.data[i + 3] = 255;
    }
  }
  // paper first, then the relief over it (lake pixels are transparent and stay paper)
  paintParchment(ctx);
  const relief = document.createElement('canvas');
  relief.width = SIZE; relief.height = SIZE;
  relief.getContext('2d')!.putImageData(img, 0, 0);
  ctx.globalAlpha = 0.88;
  ctx.drawImage(relief, 0, 0);
  ctx.globalAlpha = 1;

  // ---- 2. lakes ------------------------------------------------------------------------------
  for (const lake of geo.lakes) {
    ctx.beginPath();
    lake.poly.forEach(([x, z], i) => { const [a, b] = toPx(x, z); i === 0 ? ctx.moveTo(a, b) : ctx.lineTo(a, b); });
    ctx.closePath();
    ctx.fillStyle = 'rgba(148,176,188,0.78)';
    ctx.fill();
    // shore hatching: three shrinking outlines, as engraved charts drew still water
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = 'rgba(63,92,105,0.5)';
    for (let k = 1; k <= 3; k++) {
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      lake.poly.forEach(([x, z], i) => {
        const [a, b] = toPx(x, z);
        const [cx, cy] = lakeCentroidPx(lake.poly);
        const s = 1 - k * 0.022;
        const ax = cx + (a - cx) * s, ay = cy + (b - cy) * s;
        i === 0 ? ctx.moveTo(ax, ay) : ctx.lineTo(ax, ay);
      });
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = WATER_INK;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    lake.poly.forEach(([x, z], i) => { const [a, b] = toPx(x, z); i === 0 ? ctx.moveTo(a, b) : ctx.lineTo(a, b); });
    ctx.closePath();
    ctx.stroke();
  }

  // ---- 3. forest stipple ---------------------------------------------------------------------
  ctx.fillStyle = 'rgba(58,74,44,0.85)';
  ctx.strokeStyle = 'rgba(48,62,36,0.9)';
  ctx.lineWidth = 0.9;
  const STEP = 9;
  for (let py = 4; py < SIZE; py += STEP) {
    for (let px = 4; px < SIZE; px += STEP) {
      const jx = Math.round(px + (valueNoise2D(px * 0.7, py * 0.7, 5) * 2 - 1) * STEP * 0.45);
      const jy = Math.round(py + (valueNoise2D(px * 0.7, py * 0.7, 91) * 2 - 1) * STEP * 0.45);
      if (jx < 0 || jy < 0 || jx >= SIZE || jy >= SIZE) continue;
      if (!forestMask[jy * SIZE + jx]) continue;
      if (valueNoise2D(jx * 0.31, jy * 0.31, 44) < 0.30) continue; // thin the stand out
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
  for (const c of geo.corridors) {
    if (c.kind !== 'road') continue;
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
  for (const p of Object.values(PLACES)) {
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

  // ---- 7. serif region labels -------------------------------------------------------------------
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const r of regions) {
    const [cx, cy] = centroidPx(r.bounds as [number, number][]);
    if (cx < 40 || cy < 40 || cx > SIZE - 40 || cy > SIZE - 40) continue;
    const label = spaced(r.name.toUpperCase());
    ctx.font = 'italic 600 21px Georgia, "Times New Roman", serif';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(238,228,203,0.85)';   // paper halo so the name reads over the hachures
    ctx.strokeText(label, cx, cy);
    ctx.fillStyle = 'rgba(74,52,30,0.92)';
    ctx.fillText(label, cx, cy);
  }

  // ---- 8. ageing, frame, compass -----------------------------------------------------------------
  ageParchment(ctx);
  drawFrame(ctx);
  drawCompass(ctx, SIZE - 132, 132);
  drawTitle(ctx);

  cachedUrl = canvas.toDataURL('image/png');
  return cachedUrl;
}

/** Warm laid paper: fibre noise, a faint wove grid and a couple of old damp stains. */
function paintParchment(ctx: CanvasRenderingContext2D): void {
  const img = ctx.createImageData(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      const f = fbm2D(x, y, { octaves: 5, frequency: 0.004, seed: 907 }) * 0.5 + 0.5;
      const fibre = Math.sin(y * 0.9 + fbm2D(x, y, { octaves: 2, frequency: 0.02, seed: 51 }) * 6) * 0.012;
      const k = 0.88 + f * 0.22 + fibre;
      img.data[i] = clamp255(232 * k);
      img.data[i + 1] = clamp255(216 * k);
      img.data[i + 2] = clamp255(182 * k);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
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
function lakeCentroidPx(poly: [number, number][]): [number, number] {
  return centroidPx(poly);
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
}
