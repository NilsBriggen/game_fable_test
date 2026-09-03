/**
 * Foliage cut-outs: the alpha-tested cards every tree, bush and grass tuft is built from.
 *
 * Two RGBA sheets are fetched from `public/assets/textures/vegetation/` (packed by
 * `tools/assets/fetch-world.mjs` out of Poly Haven's CC0 twig/leaf/blade photographs, see
 * CREDITS-world.md):
 *
 *   foliage-atlas.png     4x3 cells of 256px — spruce | fir | larch | pine
 *                                              beech  | beech-autumn | alder | bare twig
 *                                              bark   | pale bark    |  -    |  -
 *   groundcover-atlas.png 2x2 cells of 256px — grass | dry grass
 *                                              fern  | herb
 *
 * Both are ONE texture each on purpose: every species, every LOD and the trunks all draw from the
 * same sheet, so the whole forest is a handful of InstancedMesh draw calls sharing one material.
 *
 * Until the PNG decodes (and forever, if it 404s) the same cells are painted procedurally into the
 * canvas the texture is backed by. The canvas is never thrown away, so the swap is a texture upload,
 * not a material change — nothing re-compiles and no frame renders untextured.
 */
import { CanvasTexture, ClampToEdgeWrapping, LinearMipmapLinearFilter, LinearFilter, SRGBColorSpace } from 'three';
import { fbm2D, valueNoise2D } from '../noise';

const ASSET_BASE = 'assets/textures';
export const CELL_PX = 256;

/** Cell grid of foliage-atlas.png. Must match world-manifest.json `foliageAtlasCells`. */
export const FOLIAGE_CELL = {
  spruce: [0, 0], fir: [1, 0], larch: [2, 0], pine: [3, 0],
  beech: [0, 1], beechAutumn: [1, 1], alder: [2, 1], bare: [3, 1],
  bark: [0, 2], barkPale: [1, 2],
} as const;
export type FoliageCell = keyof typeof FOLIAGE_CELL;
const FOLIAGE_COLS = 4, FOLIAGE_ROWS = 3;

/** Cell grid of groundcover-atlas.png. Must match world-manifest.json `groundCoverAtlasCells`. */
export const GROUND_CELL = { grass: [0, 0], grassDry: [1, 0], fern: [0, 1], herb: [1, 1] } as const;
export type GroundCell = keyof typeof GROUND_CELL;
const GROUND_COLS = 2, GROUND_ROWS = 2;

/** UV rect (u0, v0, du, dv) of one cell. v is flipped: canvas y grows down, texture v grows up. */
function cellUv(cx: number, cy: number, cols: number, rows: number): [number, number, number, number] {
  return [cx / cols, 1 - (cy + 1) / rows, 1 / cols, 1 / rows];
}
export function foliageCellUv(cell: FoliageCell): [number, number, number, number] {
  const [cx, cy] = FOLIAGE_CELL[cell];
  return cellUv(cx, cy, FOLIAGE_COLS, FOLIAGE_ROWS);
}
export function groundCellUv(cell: GroundCell): [number, number, number, number] {
  const [cx, cy] = GROUND_CELL[cell];
  return cellUv(cx, cy, GROUND_COLS, GROUND_ROWS);
}

function newCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  return { canvas, ctx: canvas.getContext('2d', { willReadFrequently: true })! };
}

// ---------------------------------------------------------------------------------------------
// Procedural fallback painters (also what the impostor painter falls back to)
// ---------------------------------------------------------------------------------------------

function rnd(seedRef: { s: number }): number {
  seedRef.s = (seedRef.s * 1664525 + 1013904223) >>> 0;
  return seedRef.s / 4294967296;
}

/** One conifer branch sprig: woody stem + needle combs. */
function needleSpray(ctx: CanvasRenderingContext2D, ox: number, oy: number, S: number, base: [number, number, number], droop: number, needleLen: number): void {
  const seed = { s: (base[1] * 7 + Math.round(droop * 100)) >>> 0 || 3 };
  ctx.save();
  ctx.translate(ox, oy);
  ctx.strokeStyle = 'rgba(62,46,30,0.95)';
  ctx.lineWidth = S * 0.014;
  ctx.beginPath(); ctx.moveTo(S * 0.5, S); ctx.lineTo(S * 0.5, S * 0.06); ctx.stroke();
  for (let r = 0; r < 26; r++) {
    const t = r / 26;
    const y = S * (0.95 - t * 0.9);
    const spread = S * 0.46 * (1 - t * 0.8) + S * 0.05;
    for (const dir of [-1, 1]) {
      const twigLen = spread * (0.7 + rnd(seed) * 0.35);
      const x1 = S * 0.5 + dir * twigLen;
      const y1 = y + twigLen * droop;
      ctx.strokeStyle = 'rgba(58,44,28,0.9)';
      ctx.lineWidth = S * 0.006;
      ctx.beginPath(); ctx.moveTo(S * 0.5, y); ctx.lineTo(x1, y1); ctx.stroke();
      const nn = Math.round(10 + rnd(seed) * 6);
      for (let i = 0; i < nn; i++) {
        const u = (i + 0.4) / nn;
        const bx = S * 0.5 + (x1 - S * 0.5) * u;
        const by = y + (y1 - y) * u;
        for (const side of [-1, 1]) {
          const ang = (dir > 0 ? -0.35 : Math.PI + 0.35) + side * (0.75 + rnd(seed) * 0.45);
          const len = S * needleLen * (0.6 + rnd(seed) * 0.7);
          const sh = 0.72 + rnd(seed) * 0.5;
          ctx.strokeStyle = `rgb(${Math.round(base[0] * sh)},${Math.round(base[1] * sh)},${Math.round(base[2] * sh)})`;
          ctx.lineWidth = S * 0.0065;
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.lineTo(bx + Math.cos(ang) * len, by + Math.sin(ang) * len);
          ctx.stroke();
        }
      }
    }
  }
  ctx.restore();
}

/** Overlapping ovate leaves with gaps and midribs. */
function leafCluster(ctx: CanvasRenderingContext2D, ox: number, oy: number, S: number, col: [number, number, number], seed0: number): void {
  const seed = { s: seed0 >>> 0 || 17 };
  ctx.save();
  ctx.translate(ox, oy);
  ctx.strokeStyle = 'rgba(64,48,30,0.9)';
  ctx.lineWidth = S * 0.012;
  ctx.beginPath(); ctx.moveTo(S * 0.5, S); ctx.lineTo(S * 0.5, S * 0.2); ctx.stroke();
  for (let i = 0; i < 46; i++) {
    const t = rnd(seed);
    const cx = S * 0.5 + (rnd(seed) - 0.5) * S * 0.84;
    const cy = S * (0.92 - t * 0.86) + (rnd(seed) - 0.5) * S * 0.07;
    const rx = S * (0.055 + rnd(seed) * 0.045);
    const ry = rx * (1.5 + rnd(seed) * 0.5);
    const sh = 0.7 + rnd(seed) * 0.55;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((rnd(seed) - 0.5) * 2.4);
    ctx.fillStyle = `rgb(${Math.round(col[0] * sh)},${Math.round(col[1] * sh)},${Math.round(col[2] * sh)})`;
    ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

function proceduralBark(ctx: CanvasRenderingContext2D, ox: number, oy: number, S: number, pale: number): void {
  const base = [78 + pale * 90, 60 + pale * 84, 44 + pale * 76];
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const groove = Math.abs(Math.sin(x * 0.13 + valueNoise2D(x * 0.02, y * 0.08, 12) * 3.4));
      const nz = 0.5 + 0.5 * fbm2D(x, y, { octaves: 3, frequency: 0.16, seed: 71 });
      const k = 0.45 + 0.55 * groove * nz;
      const i = (y * S + x) * 4;
      img.data[i] = base[0] * k; img.data[i + 1] = base[1] * k; img.data[i + 2] = base[2] * k; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, ox, oy);
}

function grassBlades(ctx: CanvasRenderingContext2D, ox: number, oy: number, S: number, lo: [number, number, number], hi: [number, number, number], seed0: number): void {
  const seed = { s: seed0 >>> 0 || 41 };
  ctx.save();
  ctx.translate(ox, oy);
  for (let i = 0; i < 24; i++) {
    const x0 = S * (0.12 + rnd(seed) * 0.76);
    const h = S * (0.45 + rnd(seed) * 0.5);
    const bend = (rnd(seed) - 0.5) * S * 0.42;
    const sh = 0.55 + rnd(seed) * 0.6;
    const grad = ctx.createLinearGradient(0, S, 0, S - h);
    grad.addColorStop(0, `rgb(${Math.round(lo[0] * sh)},${Math.round(lo[1] * sh)},${Math.round(lo[2] * sh)})`);
    grad.addColorStop(1, `rgb(${Math.round(hi[0] * sh)},${Math.round(hi[1] * sh)},${Math.round(hi[2] * sh)})`);
    ctx.strokeStyle = grad;
    ctx.lineWidth = S * (0.012 + rnd(seed) * 0.014);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x0, S);
    ctx.quadraticCurveTo(x0 + bend * 0.35, S - h * 0.55, x0 + bend, S - h);
    ctx.stroke();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------------------------

interface Sheet {
  texture: CanvasTexture;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  loaded: boolean;
}

let foliage: Sheet | null = null;
let ground: Sheet | null = null;
const readyCbs: (() => void)[] = [];

function makeSheet(cols: number, rows: number, paintFallback: (ctx: CanvasRenderingContext2D) => void, url: string, onLoad?: () => void): Sheet {
  const { canvas, ctx } = newCanvas(cols * CELL_PX, rows * CELL_PX);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  paintFallback(ctx);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = ClampToEdgeWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  const sheet: Sheet = { texture, canvas, ctx, loaded: false };
  const img = new Image();
  img.onload = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    texture.needsUpdate = true;
    sheet.loaded = true;
    onLoad?.();
    for (const cb of readyCbs) cb();
  };
  img.onerror = () => { /* keep the procedural cells; nothing to log, this is a designed fallback */ };
  img.src = url;
  return sheet;
}

function paintFoliageFallback(ctx: CanvasRenderingContext2D): void {
  const S = CELL_PX;
  const at = (c: FoliageCell): [number, number] => [FOLIAGE_CELL[c][0] * S, FOLIAGE_CELL[c][1] * S];
  needleSpray(ctx, ...at('spruce'), S, [30, 62, 38], 0.28, 0.085);
  needleSpray(ctx, ...at('fir'), S, [40, 78, 52], 0.12, 0.085);
  needleSpray(ctx, ...at('larch'), S, [96, 128, 56], 0.2, 0.055);
  needleSpray(ctx, ...at('pine'), S, [46, 82, 48], 0.3, 0.08);
  leafCluster(ctx, ...at('beech'), S, [74, 106, 46], 17);
  leafCluster(ctx, ...at('beechAutumn'), S, [172, 116, 42], 991);
  leafCluster(ctx, ...at('alder'), S, [62, 96, 44], 313);
  needleSpray(ctx, ...at('bare'), S, [96, 74, 50], 0.2, 0.03);
  proceduralBark(ctx, ...at('bark'), S, 0);
  proceduralBark(ctx, ...at('barkPale'), S, 0.45);
}

function paintGroundFallback(ctx: CanvasRenderingContext2D): void {
  const S = CELL_PX;
  const at = (c: GroundCell): [number, number] => [GROUND_CELL[c][0] * S, GROUND_CELL[c][1] * S];
  grassBlades(ctx, ...at('grass'), S, [54, 76, 34], [118, 150, 66], 4242);
  grassBlades(ctx, ...at('grassDry'), S, [104, 96, 48], [176, 164, 96], 777);
  grassBlades(ctx, ...at('fern'), S, [34, 70, 30], [78, 118, 48], 1313);
  grassBlades(ctx, ...at('herb'), S, [62, 88, 40], [128, 150, 72], 5151);
}

export function foliageAtlasTexture(): CanvasTexture {
  if (!foliage) foliage = makeSheet(FOLIAGE_COLS, FOLIAGE_ROWS, paintFoliageFallback, `${ASSET_BASE}/vegetation/foliage-atlas.png`);
  return foliage.texture;
}

export function groundCoverAtlasTexture(): CanvasTexture {
  if (!ground) ground = makeSheet(GROUND_COLS, GROUND_ROWS, paintGroundFallback, `${ASSET_BASE}/vegetation/groundcover-atlas.png`);
  return ground.texture;
}

/** The canvas behind the foliage sheet, for the impostor painter to sample cells out of. */
export function foliageCanvas(): HTMLCanvasElement {
  foliageAtlasTexture();
  return foliage!.canvas;
}

/** Run `cb` whenever a real sheet finishes decoding (so impostors can be repainted from it). */
export function onFoliageReady(cb: () => void): void {
  readyCbs.push(cb);
  if (foliage?.loaded) cb();
}

export function disposeFoliage(): void {
  foliage?.texture.dispose(); foliage = null;
  ground?.texture.dispose(); ground = null;
  readyCbs.length = 0;
}
