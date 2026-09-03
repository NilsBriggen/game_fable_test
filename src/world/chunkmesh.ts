/**
 * Pure chunk-geometry builder: turns a slice of the CPU heightmap into typed arrays for a
 * BufferGeometry. Runs inside terrain.worker.ts (and is safe to unit-test directly — no three.js import).
 */
import { MAP_BOUNDS } from '@content/gazetteer';
import { BLEND_GROUP } from './heightmodel';

export const CHUNK_SIZE = 500;
export const LOD_SPACING = [2, 4, 8, 16] as const;
export const SKIRT_DEPTH = 24;
/** skirt depth per LOD: a coarse far chunk beside a gorge wall can step 250 m+ against its neighbour */
export const SKIRT_DEPTH_BY_LOD = [30, 60, 130, 320];

export function segsForLod(lod: number): number {
  return Math.max(1, Math.round(CHUNK_SIZE / LOD_SPACING[Math.max(0, Math.min(3, lod))]));
}

export function bilinearHeight(heights: Float32Array, gridW: number, gridH: number, scaleX: number, scaleZ: number, x: number, z: number): number {
  const gx = (x - MAP_BOUNDS.minX) / scaleX;
  const gz = (z - MAP_BOUNDS.minZ) / scaleZ;
  const x0 = Math.max(0, Math.min(gridW - 2, Math.floor(gx)));
  const z0 = Math.max(0, Math.min(gridH - 2, Math.floor(gz)));
  const tx = Math.max(0, Math.min(1, gx - x0));
  const tz = Math.max(0, Math.min(1, gz - z0));
  const row0 = z0 * gridW, row1 = (z0 + 1) * gridW;
  const h00 = heights[row0 + x0], h10 = heights[row0 + x0 + 1];
  const h01 = heights[row1 + x0], h11 = heights[row1 + x0 + 1];
  const a = h00 + (h10 - h00) * tx;
  const b = h01 + (h11 - h01) * tx;
  return a + (b - a) * tz;
}

export function nearestSurface(surface: Uint8Array, gridW: number, gridH: number, scaleX: number, scaleZ: number, x: number, z: number): number {
  const gx = Math.round((x - MAP_BOUNDS.minX) / scaleX);
  const gz = Math.round((z - MAP_BOUNDS.minZ) / scaleZ);
  const cx = Math.max(0, Math.min(gridW - 1, gx));
  const cz = Math.max(0, Math.min(gridH - 1, gz));
  return surface[cz * gridW + cx];
}

export interface ChunkGeometryData {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  surfaceId: Float32Array;
  indices: Uint32Array;
  vertCount: number;
  /** true if every vertex sampled water (skip building this chunk's terrain mesh, water module covers it) */
  allWater: boolean;
  minY: number;
  maxY: number;
}

export function buildChunkGeometry(
  heights: Float32Array, surface: Uint8Array, gridW: number, gridH: number, scaleX: number, scaleZ: number,
  originX: number, originZ: number, lod: number,
): ChunkGeometryData {
  const segs = segsForLod(lod);
  const spacing = CHUNK_SIZE / segs;
  const verts = segs + 1;
  const mainCount = verts * verts;
  const total = mainCount + 4 * verts;
  const positions = new Float32Array(total * 3);
  const uvs = new Float32Array(total * 2);
  const surfaceId = new Float32Array(total);
  const idx = (x: number, z: number) => z * verts + x;

  let minY = Infinity, maxY = -Infinity;
  let waterCount = 0;
  const eps = Math.max(1, spacing * 0.5);
  const normals = new Float32Array(total * 3);
  for (let z = 0; z < verts; z++) {
    for (let x = 0; x < verts; x++) {
      const wx = originX + x * spacing;
      const wz = originZ + z * spacing;
      const h = bilinearHeight(heights, gridW, gridH, scaleX, scaleZ, wx, wz);
      const i = idx(x, z);
      positions[i * 3] = wx; positions[i * 3 + 1] = h; positions[i * 3 + 2] = wz;
      uvs[i * 2] = wx / 40; uvs[i * 2 + 1] = wz / 40;
      const sid = nearestSurface(surface, gridW, gridH, scaleX, scaleZ, wx, wz);
      surfaceId[i] = BLEND_GROUP[sid] ?? 0;
      if (sid === 4 /* water */) waterCount++;
      if (h < minY) minY = h;
      if (h > maxY) maxY = h;

      const hL = bilinearHeight(heights, gridW, gridH, scaleX, scaleZ, wx - eps, wz);
      const hR = bilinearHeight(heights, gridW, gridH, scaleX, scaleZ, wx + eps, wz);
      const hN = bilinearHeight(heights, gridW, gridH, scaleX, scaleZ, wx, wz - eps);
      const hS = bilinearHeight(heights, gridW, gridH, scaleX, scaleZ, wx, wz + eps);
      const dhdx = (hR - hL) / (2 * eps);
      const dhdz = (hS - hN) / (2 * eps);
      let nx = -dhdx, ny = 1, nz = -dhdz;
      const len = Math.hypot(nx, ny, nz) || 1;
      normals[i * 3] = nx / len; normals[i * 3 + 1] = ny / len; normals[i * 3 + 2] = nz / len;
    }
  }

  const indices: number[] = [];
  for (let z = 0; z < segs; z++) {
    for (let x = 0; x < segs; x++) {
      const a = idx(x, z), b = idx(x + 1, z), c = idx(x, z + 1), d = idx(x + 1, z + 1);
      indices.push(a, c, b, b, c, d);
    }
  }

  // skirts: duplicate each border row/col, pushed down, to hide LOD seams between neighbouring chunks
  const west = mainCount, east = mainCount + verts, north = mainCount + 2 * verts, south = mainCount + 3 * verts;
  function writeSkirt(base: number, edgeAt: (i: number) => number): void {
    for (let i = 0; i < verts; i++) {
      const mi = edgeAt(i);
      const si = base + i;
      positions[si * 3] = positions[mi * 3];
      positions[si * 3 + 1] = positions[mi * 3 + 1] - (SKIRT_DEPTH_BY_LOD[lod] ?? SKIRT_DEPTH);
      positions[si * 3 + 2] = positions[mi * 3 + 2];
      uvs[si * 2] = uvs[mi * 2]; uvs[si * 2 + 1] = uvs[mi * 2 + 1];
      surfaceId[si] = surfaceId[mi];
      normals[si * 3] = normals[mi * 3]; normals[si * 3 + 1] = normals[mi * 3 + 1]; normals[si * 3 + 2] = normals[mi * 3 + 2];
    }
    for (let i = 0; i < segs; i++) {
      const m0 = edgeAt(i), m1 = edgeAt(i + 1), s0 = base + i, s1 = base + i + 1;
      indices.push(m0, m1, s1, m0, s1, s0);
    }
  }
  writeSkirt(west, (i) => idx(0, i));
  writeSkirt(east, (i) => idx(segs, i));
  writeSkirt(north, (i) => idx(i, 0));
  writeSkirt(south, (i) => idx(i, segs));

  return {
    positions, normals, uvs, surfaceId,
    indices: Uint32Array.from(indices),
    vertCount: total,
    allWater: waterCount === mainCount,
    minY, maxY,
  };
}
