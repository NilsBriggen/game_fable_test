/**
 * Procedural canvas textures: tiling diffuse + normal maps for terrain splatting and for prop
 * materials (wood grain, stone, shingle, plaster). No external assets — BUILDER_RULES.md forbids them.
 */
import { CanvasTexture, RepeatWrapping, SRGBColorSpace, NoColorSpace, Texture } from 'three';
import { valueNoise2D, fbm2D } from './noise';

function newCanvas(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  return { canvas, ctx };
}

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

export function getTerrainTexture(kind: TerrainSurfaceTex, size = 256): TexturePair {
  const key = `terrain:${kind}:${size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const seed = 1000 + kind.length * 97 + kind.charCodeAt(0);
  let map: CanvasTexture;
  let bumpFreq = 0.06, bumpStrength = 1.6;
  switch (kind) {
    case 'grass':
      map = makeDiffuse(size, seed, 0.05, [58, 82, 38], [96, 128, 58]);
      bumpStrength = 0.8;
      break;
    case 'meadow':
      map = makeDiffuse(size, seed, 0.045, [86, 112, 56], [138, 158, 84], 0.03);
      bumpStrength = 0.6;
      break;
    case 'forest':
      // Darkened (critic issue 5): forested slopes must read as forest from a distance even where the
      // instanced trees themselves haven't populated yet (e.g. a chunk just streamed in).
      map = makeDiffuse(size, seed, 0.08, [26, 32, 18], [54, 54, 32]);
      bumpStrength = 1.2;
      break;
    case 'rock':
      map = makeDiffuse(size, seed, 0.09, [72, 68, 62], [128, 122, 112]);
      bumpFreq = 0.12; bumpStrength = 2.6;
      break;
    case 'scree':
      map = makeDiffuse(size, seed, 0.14, [96, 90, 80], [150, 142, 128], 0.08);
      bumpFreq = 0.18; bumpStrength = 2.2;
      break;
    case 'snow':
      map = makeDiffuse(size, seed, 0.05, [214, 220, 230], [250, 250, 255]);
      bumpStrength = 0.5;
      break;
    case 'mud':
      map = makeDiffuse(size, seed, 0.07, [58, 46, 34], [92, 72, 50]);
      bumpStrength = 1.0;
      break;
    case 'road':
      map = makeDiffuse(size, seed, 0.1, [96, 84, 66], [138, 122, 96], 0.05);
      bumpFreq = 0.1; bumpStrength = 1.4;
      break;
    case 'settlement':
    default:
      map = makeDiffuse(size, seed, 0.06, [110, 96, 74], [150, 134, 106]);
      bumpStrength = 0.7;
      break;
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

/** Tileable ripple normal map for lake water (animated via texture.offset in water.ts). */
export function waterNormalTexture(size = 128): CanvasTexture {
  const key = `waterN:${size}`;
  const hitPair = cache.get(key);
  if (hitPair) return hitPair.normalMap;
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const a = Math.sin((x / size) * Math.PI * 2 * 6) * 0.5;
      const b = Math.sin(((x + y) / size) * Math.PI * 2 * 9 + 1.3) * 0.3;
      const c = fbm2D(x, y, { octaves: 3, frequency: 0.08, seed: 900 }) * 0.4;
      height[y * size + x] = a + b + c;
    }
  }
  const normalMap = normalMapFromHeight(size, height, 0.9);
  cache.set(key, { map: normalMap, normalMap });
  return normalMap;
}

export function disposeAllTextures(): void {
  for (const p of cache.values()) { p.map.dispose(); p.normalMap.dispose(); }
  cache.clear();
}

export type { Texture };
