/**
 * Texture supply. Terrain: three CC0 PBR DataArrayTextures (albedo / normal / AO+roughness), 8 layers,
 * decoded from one packed 512x4096 JPEG each (tools/assets/fetch-world.mjs, CREDITS-world.md).
 * Vegetation: CC0 bark + canvas alpha cut-outs. Props: the original procedural canvas textures.
 */
import {
  CanvasTexture, ClampToEdgeWrapping, DataArrayTexture, DataTexture, LinearFilter, LinearMipmapLinearFilter,
  LinearSRGBColorSpace, NoColorSpace, RGBAFormat, RepeatWrapping, SRGBColorSpace, Texture, TextureLoader,
  UnsignedByteType,
} from 'three';
import { valueNoise2D, fbm2D } from './noise';

const ASSET_BASE = 'assets/textures';

/** Layer order must match world-manifest.json terrainLayers. */
export const TERRAIN_LAYER = {
  grass: 0, meadow: 1, forest: 2, rock: 3, scree: 4, snow: 5, mud: 6, road: 7,
} as const;
export const TERRAIN_LAYER_COUNT = 8;
const LAYER_PX = 512;

function newCanvas(size: number, h = size): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  return { canvas, ctx };
}

// ---------------------------------------------------------------------------------------------
// Terrain PBR arrays
// ---------------------------------------------------------------------------------------------

export interface TerrainArrays {
  albedo: DataArrayTexture;
  normal: DataArrayTexture;
  orm: DataArrayTexture;
  /** resolves once all three real arrays have replaced their 1×1 placeholders */
  ready: Promise<void>;
  loaded: boolean;
}

let terrainArrays: TerrainArrays | null = null;

/**
 * Full-size flat placeholder so the material can shade before the JPEGs arrive.
 *
 * It must be allocated at the FINAL 512x512x8 size: three uploads array textures into immutable
 * storage, so a 1x1x8 placeholder can never be resized to the real data later — the upload is
 * rejected and every terrain sample reads back black, which is exactly how the whole landscape
 * ended up unlit while the (non-array) trees and water shaded correctly.
 */
function placeholderArray(r: number, g: number, b: number): DataArrayTexture {
  const px = LAYER_PX * LAYER_PX * TERRAIN_LAYER_COUNT;
  const data = new Uint8Array(new ArrayBuffer(px * 4));
  for (let i = 0; i < px; i++) {
    data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = 255;
  }
  const t = new DataArrayTexture(data, LAYER_PX, LAYER_PX, TERRAIN_LAYER_COUNT);
  t.format = RGBAFormat; t.type = UnsignedByteType;
  t.colorSpace = NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Decode one packed 512×(512·8) JPEG into the pixel block a DataArrayTexture wants (layer-major). */
async function decodeLayerStack(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`terrain texture ${url}: HTTP ${res.status}`);
  const blob = await res.blob();
  const bmp = await createImageBitmap(blob);
  const { ctx } = newCanvas(LAYER_PX, LAYER_PX * TERRAIN_LAYER_COUNT);
  ctx.drawImage(bmp, 0, 0, LAYER_PX, LAYER_PX * TERRAIN_LAYER_COUNT);
  bmp.close();
  const img = ctx.getImageData(0, 0, LAYER_PX, LAYER_PX * TERRAIN_LAYER_COUNT);
  return new Uint8Array(img.data.buffer.slice(0) as ArrayBuffer);
}

/** Overwrite the placeholder's pixels in place — same dimensions, so the upload is a plain respecify. */
function fillArray(tex: DataArrayTexture, data: Uint8Array): void {
  (tex.image.data as Uint8Array).set(data);
  tex.needsUpdate = true;
}

export function getTerrainArrays(): TerrainArrays {
  if (terrainArrays) return terrainArrays;
  const mk = (r: number, g: number, b: number): DataArrayTexture => {
    const t = placeholderArray(r, g, b);
    t.wrapS = t.wrapT = RepeatWrapping;
    t.magFilter = LinearFilter;
    t.minFilter = LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 4;
    return t;
  };
  const albedo = mk(126, 134, 104);
  const normal = mk(128, 128, 255);
  const orm = mk(255, 210, 0);   // AO=1, roughness=0.82, metalness=0
  const arrays: TerrainArrays = {
    albedo, normal, orm, loaded: false,
    ready: Promise.resolve(),
  };
  arrays.ready = (async () => {
    try {
      const [a, n, o] = await Promise.all([
        decodeLayerStack(`${ASSET_BASE}/terrain/albedo-array.jpg`),
        decodeLayerStack(`${ASSET_BASE}/terrain/normal-array.jpg`),
        decodeLayerStack(`${ASSET_BASE}/terrain/orm-array.jpg`),
      ]);
      fillArray(albedo, a);
      fillArray(normal, n);
      fillArray(orm, o);
      arrays.loaded = true;
    } catch (err) {
      // keep the flat placeholders; the terrain stays lit, just untextured
      console.warn('[world] terrain texture arrays unavailable, using flat placeholders:', err);
    }
  })();
  terrainArrays = arrays;
  return arrays;
}

// Macro variation: low-frequency field that breaks tile repetition at distance. R/G/B = 3 decorrelated octave sets.

let macroTex: DataTexture | null = null;
export function macroVariationTexture(size = 256): DataTexture {
  if (macroTex) return macroTex;
  const data = new Uint8Array(new ArrayBuffer(size * size * 4));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const a = fbm2D(x, y, { octaves: 4, frequency: 0.021, seed: 31 }) * 0.5 + 0.5;
      const b = fbm2D(x, y, { octaves: 3, frequency: 0.052, seed: 977 }) * 0.5 + 0.5;
      const c = fbm2D(x, y, { octaves: 5, frequency: 0.011, seed: 4111 }) * 0.5 + 0.5;
      data[i] = Math.round(a * 255); data[i + 1] = Math.round(b * 255); data[i + 2] = Math.round(c * 255); data[i + 3] = 255;
    }
  }
  const t = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = NoColorSpace;
  t.needsUpdate = true;
  macroTex = t;
  return t;
}

// ---------------------------------------------------------------------------------------------
// Vegetation cut-outs (canvas, alpha-tested)
// ---------------------------------------------------------------------------------------------

const canvasCache = new Map<string, CanvasTexture>();

function cached(key: string, make: () => CanvasTexture): CanvasTexture {
  const hit = canvasCache.get(key);
  if (hit) return hit;
  const t = make();
  canvasCache.set(key, t);
  return t;
}

/** One conifer branch sprig, flat: woody stem + needle combs. Alpha cut-out for foliage cards. */
function needleSprayCanvas(kind: 'spruce' | 'fir' | 'larch' | 'pine' = 'spruce'): HTMLCanvasElement {
  {
    const S = 256;
    const { canvas, ctx } = newCanvas(S);
    ctx.clearRect(0, 0, S, S);
    const base = kind === 'spruce' ? [30, 62, 38] : kind === 'fir' ? [40, 78, 52] : kind === 'larch' ? [96, 128, 56] : [46, 82, 48];
    const needleLen = kind === 'larch' ? 0.055 : 0.085;
    const rows = kind === 'larch' ? 34 : 26;
    // woody stem down the middle of the card
    ctx.strokeStyle = 'rgba(62,46,30,0.95)';
    ctx.lineWidth = 3.5;
    ctx.beginPath(); ctx.moveTo(S * 0.5, S); ctx.lineTo(S * 0.5, S * 0.06); ctx.stroke();
    let seed = kind.length * 7 + 3;
    const rnd = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let r = 0; r < rows; r++) {
      const t = r / rows;
      const y = S * (0.95 - t * 0.9);
      const spread = S * 0.46 * (1 - t * 0.8) + S * 0.05;
      // side twigs: 2 per row, each carrying a comb of needles
      for (const dir of [-1, 1]) {
        const twigLen = spread * (0.7 + rnd() * 0.35);
        const droop = kind === 'spruce' ? 0.28 : 0.12;
        const x1 = S * 0.5 + dir * twigLen;
        const y1 = y + twigLen * droop;
        ctx.strokeStyle = 'rgba(58,44,28,0.9)';
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(S * 0.5, y); ctx.lineTo(x1, y1); ctx.stroke();
        const n = Math.round(10 + rnd() * 6);
        for (let i = 0; i < n; i++) {
          const u = (i + 0.4) / n;
          const bx = S * 0.5 + (x1 - S * 0.5) * u;
          const by = y + (y1 - y) * u;
          for (const side of [-1, 1]) {
            const ang = (dir > 0 ? -0.35 : Math.PI + 0.35) + side * (0.75 + rnd() * 0.45);
            const len = S * needleLen * (0.6 + rnd() * 0.7);
            const shade = 0.72 + rnd() * 0.5;
            ctx.strokeStyle = `rgba(${Math.round(base[0] * shade)},${Math.round(base[1] * shade)},${Math.round(base[2] * shade)},1)`;
            ctx.lineWidth = kind === 'larch' ? 1.1 : 1.7;
            ctx.beginPath();
            ctx.moveTo(bx, by);
            ctx.lineTo(bx + Math.cos(ang) * len, by + Math.sin(ang) * len);
            ctx.stroke();
          }
        }
      }
    }
    return canvas;
  }
}

/** Beech/maple leaf cluster card: overlapping ovate leaves with gaps and midribs. */
function broadleafCanvas(season: 'summer' | 'autumn' = 'summer'): HTMLCanvasElement {
  {
    const S = 256;
    const { canvas, ctx } = newCanvas(S);
    ctx.clearRect(0, 0, S, S);
    let seed = season === 'autumn' ? 991 : 17;
    const rnd = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    ctx.strokeStyle = 'rgba(64,48,30,0.9)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(S * 0.5, S); ctx.lineTo(S * 0.5, S * 0.2); ctx.stroke();
    for (let i = 0; i < 46; i++) {
      const t = rnd();
      const cx = S * 0.5 + (rnd() - 0.5) * S * 0.84;
      const cy = S * (0.92 - t * 0.86) + (rnd() - 0.5) * 18;
      const rx = S * (0.055 + rnd() * 0.045);
      const ry = rx * (1.5 + rnd() * 0.5);
      const rot = (rnd() - 0.5) * 2.4;
      const shade = 0.7 + rnd() * 0.55;
      const col = season === 'autumn' ? [172, 116, 42] : [74, 106, 46];
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      ctx.fillStyle = `rgb(${Math.round(col[0] * shade)},${Math.round(col[1] * shade)},${Math.round(col[2] * shade)})`;
      ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = `rgba(${Math.round(col[0] * shade * 0.6)},${Math.round(col[1] * shade * 0.6)},${Math.round(col[2] * shade * 0.6)},0.85)`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, -ry); ctx.lineTo(0, ry); ctx.stroke();
      ctx.restore();
    }
    return canvas;
  }
}

/** A tuft of grass blades (alpha) for the near-camera instanced ground cover. */
export function grassTuftTexture(): CanvasTexture {
  return cached('grassTuft', () => {
    const S = 128;
    const { canvas, ctx } = newCanvas(S);
    ctx.clearRect(0, 0, S, S);
    let seed = 4242;
    const rnd = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < 22; i++) {
      const x0 = S * (0.12 + rnd() * 0.76);
      const h = S * (0.45 + rnd() * 0.5);
      const bend = (rnd() - 0.5) * S * 0.42;
      const w = 2 + rnd() * 2.4;
      const shade = 0.55 + rnd() * 0.6;
      const grad = ctx.createLinearGradient(0, S, 0, S - h);
      grad.addColorStop(0, `rgb(${Math.round(54 * shade)},${Math.round(76 * shade)},${Math.round(34 * shade)})`);
      grad.addColorStop(1, `rgb(${Math.round(118 * shade)},${Math.round(150 * shade)},${Math.round(66 * shade)})`);
      ctx.strokeStyle = grad;
      ctx.lineWidth = w;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x0, S);
      ctx.quadraticCurveTo(x0 + bend * 0.35, S - h * 0.55, x0 + bend, S - h);
      ctx.stroke();
    }
    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    tex.wrapS = tex.wrapT = ClampToEdgeWrapping;
    return tex;
  });
}

/**
 * One 1024x512 atlas for every tree: 4x2 cells of 256px.
 * row0: spruce needles | fir needles | larch needles | beech leaves
 * row1: conifer bark   | pale bark   | pine needles  | autumn leaves
 * Bark cells start procedural and are repainted from the CC0 Bark012 JPEG when it decodes.
 */
export const TREE_CELL = {
  spruce: [0, 0], fir: [1, 0], larch: [2, 0], beech: [3, 0],
  bark: [0, 1], barkPale: [1, 1], pine: [2, 1], beechAutumn: [3, 1],
} as const;
export type TreeCell = keyof typeof TREE_CELL;

let treeAtlas: CanvasTexture | null = null;
export function treeAtlasTexture(): CanvasTexture {
  if (treeAtlas) return treeAtlas;
  const C = 256;
  const { canvas, ctx } = newCanvas(C * 4, C * 2);
  ctx.clearRect(0, 0, C * 4, C * 2);
  const put = (cell: TreeCell, src: HTMLCanvasElement) => {
    const [cx, cy] = TREE_CELL[cell];
    ctx.clearRect(cx * C, cy * C, C, C);
    ctx.drawImage(src, cx * C, cy * C);
  };
  put('spruce', needleSprayCanvas('spruce'));
  put('fir', needleSprayCanvas('fir'));
  put('larch', needleSprayCanvas('larch'));
  put('pine', needleSprayCanvas('pine'));
  put('beech', broadleafCanvas('summer'));
  put('beechAutumn', broadleafCanvas('autumn'));
  put('bark', proceduralBarkCanvas(0.0));
  put('barkPale', proceduralBarkCanvas(0.45));
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = ClampToEdgeWrapping;
  tex.anisotropy = 4;
  treeAtlas = tex;
  // upgrade the two bark cells to the real CC0 photo when it arrives (2x2 repeats per cell)
  const img = new Image();
  img.onload = () => {
    for (const cell of ['bark', 'barkPale'] as TreeCell[]) {
      const [cx, cy] = TREE_CELL[cell];
      ctx.save();
      ctx.globalAlpha = 1;
      for (let ry = 0; ry < 2; ry++) for (let rx = 0; rx < 2; rx++) ctx.drawImage(img, cx * C + rx * C / 2, cy * C + ry * C / 2, C / 2, C / 2);
      if (cell === 'barkPale') { ctx.globalCompositeOperation = 'lighten'; ctx.fillStyle = 'rgba(190,180,160,0.45)'; ctx.fillRect(cx * C, cy * C, C, C); }
      ctx.restore();
    }
    tex.needsUpdate = true;
  };
  img.onerror = () => { /* keep the procedural bark */ };
  img.src = `${ASSET_BASE}/vegetation/bark-conifer.jpg`;
  return tex;
}

/** UV rect (u0, v0, du, dv) of one atlas cell; v is flipped because canvas y grows downward. */
export function treeCellUv(cell: TreeCell): [number, number, number, number] {
  const [cx, cy] = TREE_CELL[cell];
  return [cx * 0.25, 1 - (cy + 1) * 0.5, 0.25, 0.5];
}

/** 2x2 atlas of tree silhouettes (256px cells) for the far-LOD billboard impostors. */
export const IMPOSTOR_CELL = { spruce: [0, 0], fir: [1, 0], larch: [0, 1], beech: [1, 1] } as const;
export type ImpostorCell = keyof typeof IMPOSTOR_CELL;

let impostorAtlas: CanvasTexture | null = null;
export function treeImpostorAtlas(): CanvasTexture {
  if (impostorAtlas) return impostorAtlas;
  const C = 256;
  const { canvas, ctx } = newCanvas(C * 2);
  ctx.clearRect(0, 0, C * 2, C * 2);
  const draw = (cell: ImpostorCell) => {
    const [gx, gy] = IMPOSTOR_CELL[cell];
    ctx.save();
    ctx.translate(gx * C, gy * C);
    let seed = cell.length * 131 + 7;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const trunk = cell === 'beech' ? 0.42 : 0.94;
    ctx.fillStyle = '#3a2a1c';
    ctx.fillRect(C * 0.5 - C * 0.016, C * trunk, C * 0.032, C * (1 - trunk));
    if (cell === 'beech') {
      for (let i = 0; i < 90; i++) {
        const a = rnd() * Math.PI * 2, r = Math.pow(rnd(), 0.55) * C * 0.34;
        const x = C * 0.5 + Math.cos(a) * r, y = C * 0.42 + Math.sin(a) * r * 0.82;
        const sh = 0.55 + rnd() * 0.5 + (1 - y / C) * 0.15;
        ctx.fillStyle = `rgb(${Math.round(58 * sh)},${Math.round(92 * sh)},${Math.round(40 * sh)})`;
        ctx.beginPath(); ctx.arc(x, y, C * (0.035 + rnd() * 0.035), 0, Math.PI * 2); ctx.fill();
      }
    } else {
      const tiers = cell === 'larch' ? 7 : 8;
      const wide = cell === 'fir' ? 0.36 : cell === 'larch' ? 0.26 : 0.40;
      for (let i = 0; i < tiers; i++) {
        const t = i / (tiers - 1);
        const yT = C * (0.04 + t * 0.74), yB = yT + C * 0.19;
        const hw = C * wide * (0.22 + t * 0.78);
        const sh = 0.5 + t * 0.32;
        const base = cell === 'larch' ? [86, 116, 52] : cell === 'fir' ? [36, 74, 46] : [26, 60, 34];
        ctx.fillStyle = `rgb(${Math.round(base[0] * sh)},${Math.round(base[1] * sh)},${Math.round(base[2] * sh)})`;
        ctx.beginPath();
        ctx.moveTo(C * 0.5, yT);
        for (let k = -6; k <= 6; k++) {
          const u = k / 6;
          ctx.lineTo(C * 0.5 + u * hw * (0.86 + rnd() * 0.3), yB - Math.abs(u) * C * 0.03);
        }
        ctx.closePath(); ctx.fill();
      }
    }
    ctx.restore();
  };
  (Object.keys(IMPOSTOR_CELL) as ImpostorCell[]).forEach(draw);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = ClampToEdgeWrapping;
  impostorAtlas = tex;
  return tex;
}

/** UV rect (u0, v0, du, dv) of one impostor cell. */
export function impostorCellUv(cell: ImpostorCell): [number, number, number, number] {
  const [cx, cy] = IMPOSTOR_CELL[cell];
  return [cx * 0.5, 1 - (cy + 1) * 0.5, 0.5, 0.5];
}

function proceduralBarkCanvas(pale: number): HTMLCanvasElement {
  const S = 256;
  const { canvas, ctx } = newCanvas(S);
  const base = [78 + pale * 90, 60 + pale * 84, 44 + pale * 76];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const groove = Math.abs(Math.sin(x * 0.13 + valueNoise2D(x * 0.02, y * 0.08, 12) * 3.4));
      const n = 0.5 + 0.5 * fbm2D(x, y, { octaves: 3, frequency: 0.16, seed: 71 });
      const k = 0.45 + 0.55 * groove * n;
      ctx.fillStyle = `rgb(${Math.round(base[0] * k)},${Math.round(base[1] * k)},${Math.round(base[2] * k)})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return canvas;
}

// ---------------------------------------------------------------------------------------------
// Bark (CC0 Bark012, packed to 256² by tools/assets/fetch-world.mjs)
// ---------------------------------------------------------------------------------------------

let barkPair: { map: Texture; normalMap: Texture } | null = null;
export function barkTextures(): { map: Texture; normalMap: Texture } {
  if (barkPair) return barkPair;
  const loader = new TextureLoader();
  const map = loader.load(`${ASSET_BASE}/vegetation/bark-conifer.jpg`);
  map.colorSpace = SRGBColorSpace;
  map.wrapS = map.wrapT = RepeatWrapping;
  const normalMap = loader.load(`${ASSET_BASE}/vegetation/bark-conifer-n.jpg`);
  normalMap.colorSpace = LinearSRGBColorSpace;
  normalMap.wrapS = normalMap.wrapT = RepeatWrapping;
  barkPair = { map, normalMap };
  return barkPair;
}

// ---------------------------------------------------------------------------------------------
// Legacy procedural canvas textures (props — models.ts, owned by the asset builder — and the map)
// ---------------------------------------------------------------------------------------------

function grayNoiseField(size: number, freq: number, seed: number, octaves = 4): Float32Array {
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      out[y * size + x] = fbm2D(x, y, { octaves, frequency: freq, seed });
    }
  }
  return out;
}

/** Height field (wrapped, tileable) -> tangent-space normal map via a central-difference Sobel-ish pass. */
function normalMapFromHeight(size: number, height: Float32Array, strength: number): CanvasTexture {
  const { canvas, ctx } = newCanvas(size);
  const img = ctx.createImageData(size, size);
  const at = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const hL = at(x - 1, y), hR = at(x + 1, y), hU = at(x, y - 1), hD = at(x, y + 1);
      let nx = -(hR - hL) * strength;
      let ny = -(hD - hU) * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      const i = (y * size + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = NoColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  return tex;
}

function mix(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export interface TexturePair { map: CanvasTexture; normalMap: CanvasTexture }

function makeDiffuse(size: number, seed: number, freq: number, dark: [number, number, number], light: [number, number, number], speckle = 0): CanvasTexture {
  const { canvas, ctx } = newCanvas(size);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let n = fbm2D(x, y, { octaves: 4, frequency: freq, seed }) * 0.5 + 0.5;
      if (speckle > 0) {
        const s = valueNoise2D(x * 0.6, y * 0.6, seed + 555);
        if (s > 1 - speckle) n = Math.min(1, n + 0.35);
      }
      const [r, g, b] = mix(dark, light, n);
      const i = (y * size + x) * 4;
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  return tex;
}

const cache = new Map<string, TexturePair>();

export type TerrainSurfaceTex = 'grass' | 'rock' | 'scree' | 'snow' | 'forest' | 'mud' | 'road' | 'settlement' | 'meadow';

/** Flat tinted tile for props/map. The terrain itself splats the CC0 arrays above. */
export function getTerrainTexture(kind: TerrainSurfaceTex, size = 256): TexturePair {
  const key = `terrain:${kind}:${size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const seed = 1000 + kind.length * 97 + kind.charCodeAt(0);
  let map: CanvasTexture;
  let bumpFreq = 0.06, bumpStrength = 1.6;
  switch (kind) {
    case 'grass': map = makeDiffuse(size, seed, 0.05, [58, 82, 38], [96, 128, 58]); bumpStrength = 0.8; break;
    case 'meadow': map = makeDiffuse(size, seed, 0.045, [86, 112, 56], [138, 158, 84], 0.03); bumpStrength = 0.6; break;
    case 'forest': map = makeDiffuse(size, seed, 0.08, [26, 32, 18], [54, 54, 32]); bumpStrength = 1.2; break;
    case 'rock': map = makeDiffuse(size, seed, 0.09, [72, 68, 62], [128, 122, 112]); bumpFreq = 0.12; bumpStrength = 2.6; break;
    case 'scree': map = makeDiffuse(size, seed, 0.14, [96, 90, 80], [150, 142, 128], 0.08); bumpFreq = 0.18; bumpStrength = 2.2; break;
    case 'snow': map = makeDiffuse(size, seed, 0.05, [214, 220, 230], [250, 250, 255]); bumpStrength = 0.5; break;
    case 'mud': map = makeDiffuse(size, seed, 0.07, [58, 46, 34], [92, 72, 50]); bumpStrength = 1.0; break;
    case 'road': map = makeDiffuse(size, seed, 0.1, [96, 84, 66], [138, 122, 96], 0.05); bumpFreq = 0.1; bumpStrength = 1.4; break;
    case 'settlement':
    default: map = makeDiffuse(size, seed, 0.06, [110, 96, 74], [150, 134, 106]); bumpStrength = 0.7; break;
  }
  const height = grayNoiseField(size, bumpFreq, seed + 3000);
  const normalMap = normalMapFromHeight(size, height, bumpStrength);
  const pair = { map, normalMap };
  cache.set(key, pair);
  return pair;
}

/** Wood plank/log grain (Blockbau walls, doors, carts). */
export function woodTexture(size = 256, tone: 'light' | 'dark' = 'light'): TexturePair {
  const key = `wood:${tone}:${size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const { canvas, ctx } = newCanvas(size);
  const img = ctx.createImageData(size, size);
  const base: [number, number, number] = tone === 'light' ? [150, 108, 62] : [92, 62, 38];
  const light: [number, number, number] = tone === 'light' ? [188, 142, 90] : [124, 88, 54];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const grain = valueNoise2D(x * 0.02, y * 0.35, 41) * 0.5 + 0.5;
      const rings = Math.sin(x * 0.25 + valueNoise2D(x * 0.05, y * 0.05, 88) * 3) * 0.5 + 0.5;
      const n = grain * 0.6 + rings * 0.4;
      const [r, g, b] = mix(base, light, n);
      const i = (y * size + x) * 4;
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace; map.wrapS = map.wrapT = RepeatWrapping;
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) height[y * size + x] = Math.sin(x * 0.25) * 0.5 + valueNoise2D(x * 0.05, y * 0.3, 41) * 0.5;
  const normalMap = normalMapFromHeight(size, height, 1.2);
  const pair = { map, normalMap };
  cache.set(key, pair);
  return pair;
}

/** Cut/rubble stone (church, castle, town-house base). */
export function stoneTexture(size = 256): TexturePair {
  const key = `stone:${size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const { canvas, ctx } = newCanvas(size);
  const img = ctx.createImageData(size, size);
  const blockW = size / 8, blockH = size / 5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const row = Math.floor(y / blockH);
      const offset = (row % 2) * (blockW / 2);
      const bx = ((x + offset) % blockW) / blockW;
      const by = (y % blockH) / blockH;
      const mortar = bx < 0.06 || by < 0.06 ? 1 : 0;
      const n = fbm2D(x, y, { octaves: 3, frequency: 0.08, seed: 500 }) * 0.5 + 0.5;
      const base: [number, number, number] = [118, 112, 102];
      const light: [number, number, number] = [156, 150, 138];
      let [r, g, b] = mix(base, light, n);
      if (mortar) { r *= 0.55; g *= 0.55; b *= 0.58; }
      const i = (y * size + x) * 4;
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace; map.wrapS = map.wrapT = RepeatWrapping;
  const height = grayNoiseField(size, 0.1, 501);
  const normalMap = normalMapFromHeight(size, height, 2.0);
  const pair = { map, normalMap };
  cache.set(key, pair);
  return pair;
}

/** Wooden shingle roof. */
export function shingleTexture(size = 256): TexturePair {
  const key = `shingle:${size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const { canvas, ctx } = newCanvas(size);
  const img = ctx.createImageData(size, size);
  const rowH = size / 12, colW = size / 10;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const row = Math.floor(y / rowH);
      const offset = (row % 2) * (colW / 2);
      const cx = ((x + offset) % colW) / colW;
      const cy = (y % rowH) / rowH;
      const edge = cx < 0.08 || cy < 0.1 ? 0.5 : 1;
      const n = fbm2D(x, y, { octaves: 3, frequency: 0.1, seed: 600 }) * 0.5 + 0.5;
      const base: [number, number, number] = [90, 62, 40];
      const light: [number, number, number] = [124, 92, 58];
      let [r, g, b] = mix(base, light, n);
      r *= edge; g *= edge; b *= edge;
      const i = (y * size + x) * 4;
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace; map.wrapS = map.wrapT = RepeatWrapping;
  const height = grayNoiseField(size, 0.1, 601);
  const normalMap = normalMapFromHeight(size, height, 1.8);
  const pair = { map, normalMap };
  cache.set(key, pair);
  return pair;
}

/** Lime-washed plaster (Luzern/Zug town houses). */
export function plasterTexture(size = 256, tint: [number, number, number] = [214, 202, 178]): TexturePair {
  const key = `plaster:${size}:${tint.join(',')}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const map = makeDiffuse(size, 700, 0.03, [tint[0] * 0.82, tint[1] * 0.82, tint[2] * 0.82], tint, 0.01);
  const height = grayNoiseField(size, 0.04, 701);
  const normalMap = normalMapFromHeight(size, height, 0.5);
  const pair = { map, normalMap };
  cache.set(key, pair);
  return pair;
}

/** Two decorrelated tileable ripple normal maps; water.ts scrolls them against each other. */
export function waterNormalTexture(variant: 0 | 1 = 0, size = 256): CanvasTexture {
  const key = `waterN:${variant}:${size}`;
  const hit = cache.get(key);
  if (hit) return hit.normalMap;
  const height = new Float32Array(size * size);
  const seed = variant === 0 ? 900 : 1731;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // sum of a few wrapped sine trains at incommensurate directions + fbm chop
      const u = x / size, v = y / size;
      let h = 0;
      const trains: [number, number, number][] = variant === 0
        ? [[3, 1, 0.5], [1, 4, 0.32], [5, 3, 0.2]]
        : [[2, 5, 0.42], [4, 1, 0.3], [1, 2, 0.26]];
      for (const [kx, ky, amp] of trains) h += Math.sin((u * kx + v * ky) * Math.PI * 2 + kx * 1.7) * amp;
      h += fbm2D(x, y, { octaves: 3, frequency: 0.09, seed }) * 0.35;
      height[y * size + x] = h;
    }
  }
  const normalMap = normalMapFromHeight(size, height, variant === 0 ? 0.8 : 0.55);
  cache.set(key, { map: normalMap, normalMap });
  return normalMap;
}

export function disposeAllTextures(): void {
  for (const p of cache.values()) { p.map.dispose(); p.normalMap.dispose(); }
  cache.clear();
  for (const t of canvasCache.values()) t.dispose();
  canvasCache.clear();
  macroTex?.dispose(); macroTex = null;
  if (terrainArrays) {
    terrainArrays.albedo.dispose(); terrainArrays.normal.dispose(); terrainArrays.orm.dispose();
    terrainArrays = null;
  }
  if (barkPair) { barkPair.map.dispose(); barkPair.normalMap.dispose(); barkPair = null; }
  treeAtlas?.dispose(); treeAtlas = null;
  impostorAtlas?.dispose(); impostorAtlas = null;
}

export type { Texture };
