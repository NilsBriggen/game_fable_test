/**
 * Deterministic, allocation-free 2D value noise + fBm. Used by the terrain height model and by
 * procedural texture generation. Seeded so world generation is reproducible from ctx.seed.
 */

function hash2(ix: number, iz: number, seed: number): number {
  // integer hash (no Math.random) -> [0,1)
  let h = (ix * 374761393 + iz * 668265263 + seed * 2147483647) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Bilinear value noise on the unit lattice, range approx [-1, 1]. */
export function valueNoise2D(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const x1 = x0 + 1;
  const z1 = z0 + 1;
  const tx = fade(x - x0);
  const tz = fade(z - z0);
  const v00 = hash2(x0, z0, seed);
  const v10 = hash2(x1, z0, seed);
  const v01 = hash2(x0, z1, seed);
  const v11 = hash2(x1, z1, seed);
  const a = v00 + (v10 - v00) * tx;
  const b = v01 + (v11 - v01) * tx;
  return (a + (b - a) * tz) * 2 - 1;
}

export interface FbmOpts {
  octaves: number;
  lacunarity?: number;
  gain?: number;
  frequency: number;
  seed: number;
}

/** Fractal Brownian motion built from valueNoise2D. Returns roughly [-1, 1]. */
export function fbm2D(x: number, z: number, opts: FbmOpts): number {
  const lac = opts.lacunarity ?? 2.0;
  const gain = opts.gain ?? 0.5;
  let freq = opts.frequency;
  let amp = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < opts.octaves; o++) {
    sum += valueNoise2D(x * freq, z * freq, opts.seed + o * 101) * amp;
    norm += amp;
    freq *= lac;
    amp *= gain;
  }
  return norm > 0 ? sum / norm : 0;
}

/** Ridged noise (good for rocky detail): 1 - |noise|, squared for sharper ridges. */
export function ridge2D(x: number, z: number, opts: FbmOpts): number {
  const lac = opts.lacunarity ?? 2.0;
  const gain = opts.gain ?? 0.5;
  let freq = opts.frequency;
  let amp = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < opts.octaves; o++) {
    const n = 1 - Math.abs(valueNoise2D(x * freq, z * freq, opts.seed + 7 + o * 131));
    sum += n * n * amp;
    norm += amp;
    freq *= lac;
    amp *= gain;
  }
  return norm > 0 ? (sum / norm) * 2 - 1 : 0;
}
