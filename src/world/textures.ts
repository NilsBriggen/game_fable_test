/**
 * Texture supply. Terrain: three CC0 PBR DataArrayTextures (albedo / normal / AO+roughness), NINE
 * layers, decoded from one packed 512x4608 JPEG each (tools/assets/fetch-world.mjs, CREDITS-world.md).
 * Vegetation cut-outs live in src/world/look/foliage.ts; props keep the procedural canvas tiles below.
 */
import {
  CanvasTexture, DataArrayTexture, DataTexture, LinearFilter, LinearMipmapLinearFilter,
  NoColorSpace, RGBAFormat, RepeatWrapping, SRGBColorSpace, Texture,
  UnsignedByteType,
} from 'three';
import { valueNoise2D, fbm2D } from './noise';

const ASSET_BASE = 'assets/textures';

/**
 * Layer order must match world-manifest.json terrainLayers.
 *
 * `yard` and `track` are two layers, not one: a village square is dry beaten earth with stones
 * trodden into it, a cart road is dark rutted mud, and blending between them along the road's own
 * distance field is what makes the lane entering a village read as a lane.
 */
export const TERRAIN_LAYER = {
  grass: 0, meadow: 1, forest: 2, rock: 3, scree: 4, snow: 5, mud: 6, yard: 7, track: 8,
} as const;
export const TERRAIN_LAYER_COUNT = 9;
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
  ctx.canvas.width = ctx.canvas.height = 0;   // release the 9 MB canvas backing store now, not at GC
  return new Uint8Array(img.data.buffer as ArrayBuffer);   // a view, not a copy
}

/** Hand the decoded pixels to the placeholder texture — same dimensions, so the upload is a plain respecify. */
function fillArray(tex: DataArrayTexture, data: Uint8Array): void {
  (tex.image as { data: Uint8Array | null }).data = data;
  tex.needsUpdate = true;
}

/**
 * three keeps `image.data` referenced for the life of a texture, so every DataArrayTexture /
 * DataTexture in the world held a CPU copy of its pixels forever — 28 MB for the three terrain
 * arrays alone. The GPU has its own copy after the first upload; drop ours in the upload callback.
 * (A later `needsUpdate` would need the data back; nothing in the world module sets one.)
 */
export function releaseAfterUpload(tex: { image: unknown }): void {
  const img = tex.image as { data?: unknown } | null;
  if (img && 'data' in img) img.data = null;
}

export function getTerrainArrays(): TerrainArrays {
  if (terrainArrays) return terrainArrays;
  const mk = (r: number, g: number, b: number): DataArrayTexture => {
    const t = placeholderArray(r, g, b);
    t.wrapS = t.wrapT = RepeatWrapping;
    t.magFilter = LinearFilter;
    t.minFilter = LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 8;    // grazing-angle slopes are the whole game; 16 streaked along the view ray
    t.onUpdate = () => releaseAfterUpload(t);
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
  t.onUpdate = () => releaseAfterUpload(t);
  macroTex = t;
  return t;
}

// Vegetation cut-outs, the tree atlas and the billboard impostors moved to src/world/look/foliage.ts
// and src/world/look/impostor.ts when they stopped being canvas drawings and became re-composed
// photographs; this file keeps the terrain arrays, the macro-variation field and the prop tiles.

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
  macroTex?.dispose(); macroTex = null;
  if (terrainArrays) {
    terrainArrays.albedo.dispose(); terrainArrays.normal.dispose(); terrainArrays.orm.dispose();
    terrainArrays = null;
  }
}

export type { Texture };
