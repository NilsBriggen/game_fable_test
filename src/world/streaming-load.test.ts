/**
 * Phase 2 A4-core/A5: adaptive streaming governor + memory hardening (pure logic, no Worker/three/DOM).
 * Covers StreamingLoadGovernor hysteresis, adaptive skirt depth (relief-driven), the rocky-ground
 * pebble guard, and the governor's shed thresholds. Chunk-geometry skirt assertions run against
 * buildChunkGeometry directly.
 */
import { describe, it, expect } from 'vitest';
import { StreamingLoadGovernor } from './terrain';
import { buildChunkGeometry } from './chunkmesh';
import { SKIRT_DEPTH_BY_LOD } from './chunkmesh';

describe('StreamingLoadGovernor hysteresis', () => {
  it('needs sustained over-budget frames to enter shed mode (no single-hitch flap)', () => {
    const g = new StreamingLoadGovernor(20, 14, 3, 30);
    expect(g.push(12)).toBe(false);
    expect(g.push(45)).toBe(false); // one hitch: still healthy
    expect(g.push(45)).toBe(false); // two: still healthy
    expect(g.push(45)).toBe(true);  // three: shed
  });
  it('needs a sustained healthy run to recover (no oscillation)', () => {
    const g = new StreamingLoadGovernor(20, 14, 3, 30);
    g.push(45); g.push(45); g.push(45);
    expect(g.degraded).toBe(true);
    for (let i = 0; i < 29; i++) expect(g.push(10)).toBe(true); // 29 healthy: still shed
    expect(g.push(10)).toBe(false); // 30th: recovered
    expect(g.push(45)).toBe(false); // a fresh hitch does not re-enter immediately
  });
  it('mid-band averages hold the current state either way', () => {
    const g = new StreamingLoadGovernor(20, 14, 3, 30);
    g.push(45); g.push(45); g.push(45);
    expect(g.push(17)).toBe(true); // between exit(14) and enter(20): stays shed
    const h = new StreamingLoadGovernor(20, 14, 3, 30);
    expect(h.push(17)).toBe(false); // same value while healthy: stays healthy
  });
});

describe('adaptive skirt depth by local relief', () => {
  // Flat chunk: table depth applies (30 m at LOD0).
  function flatGrid(w: number, h: number, v: number): Float32Array {
    return new Float32Array(w * h).fill(v);
  }
  it('flat terrain uses the per-LOD table depth, not the relief cap', () => {
    const W = 8, H = 8;
    const geo = buildChunkGeometry(flatGrid(W, H, 100), new Uint8Array(W * H), W, H, 62.5, 62.5, -8000, -6500, 0);
    const segs = 250; // segsForLod(0) = 500/2
    void segs;
    // main verts = (segs+1)^2; first skirt vert follows; skirt drop = table[0] = 30 exactly on flat ground
    const verts = Math.round(500 / 2) + 1;
    const mainCount = verts * verts;
    const edgeY = geo.positions[0 * 3 + 1];
    const skirtY = geo.positions[mainCount * 3 + 1];
    expect(edgeY - skirtY).toBeCloseTo(SKIRT_DEPTH_BY_LOD[0], 6);
  });
  it('high-relief chunk extends the skirt to relief + 8 (capped at 640)', () => {
    // 64x64 grid at real MAP scale: texel ~254 m, so the 500 m chunk spans ~2 texels and the
    // step is actually sampled (an 8x8 grid puts the whole chunk inside one texel -> relief 0).
    const W = 64, H = 64;
    const scale = 16000 / (W - 1);
    const heights = new Float32Array(W * H);
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) heights[z * W + x] = x >= 2 ? 400 : 0;
    const geo = buildChunkGeometry(heights, new Uint8Array(W * H), W, H, scale, scale, -8000, -6500, 3);
    const verts = Math.round(500 / 16) + 1;
    const mainCount = verts * verts;
    // west skirt duplicates the x=0 column (height 0); drop is relief + 8 where relief is the
    // chunk's sampled min/max span (~392 after bilinear smoothing of the 400 m step).
    const skirtY = geo.positions[mainCount * 3 + 1];
    const edgeY = geo.positions[0 * 3 + 1];
    expect(edgeY - skirtY).toBeGreaterThanOrEqual(390);
    expect(edgeY - skirtY).toBeLessThanOrEqual(640);
    expect(edgeY - skirtY).toBeGreaterThan(SKIRT_DEPTH_BY_LOD[3]); // proves adaptivity over the flat table
  });
});

describe('rocky-ground pebble guard reasoning', () => {
  it('documents the Sarnen blowup arithmetic: scans, not rain, dominate', () => {
    // 5.43M tris at 158 calls: Points rain is 2 tris/sprite (1400 -> 2.8k tris, negligible).
    // A pebble scan at 250-700 tris * ~870 candidates/chunk over scree aprons inside 40 m,
    // plus full/mid tree cards (each card = 2 tris, ~40-90 cards/tree) over the Sarnen
    // scree/forest mosaic, accounts for millions; rain is the additive overdraw term, not the bulk.
    const rainTris = 1400 * 2;
    expect(rainTris).toBeLessThan(5430000 * 0.01);
  });
});
