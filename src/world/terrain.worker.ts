/// <reference lib="webworker" />
/**
 * Terrain worker: generates the heightmap (once) and builds chunk geometry (on demand) off the main
 * thread. Vite bundles this via `new Worker(new URL('./terrain.worker.ts', import.meta.url), {type:'module'})`.
 */
import { buildHeightGrid, DEFAULT_GRID_W, DEFAULT_GRID_H } from './heightmodel';
import { buildChunkGeometry } from './chunkmesh';
import { MAP_BOUNDS } from '@content/gazetteer';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let heights: Float32Array | null = null;
let surface: Uint8Array | null = null;
let gridW = DEFAULT_GRID_W;
let gridH = DEFAULT_GRID_H;
let scaleX = 0;
let scaleZ = 0;

function setGrid(w: number, h: number, hs: Float32Array, sf: Uint8Array): void {
  gridW = w; gridH = h; heights = hs; surface = sf;
  scaleX = (MAP_BOUNDS.maxX - MAP_BOUNDS.minX) / (gridW - 1);
  scaleZ = (MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ) / (gridH - 1);
}

type InMsg =
  | { type: 'generate'; seed: number; width?: number; height?: number }
  | { type: 'init'; width: number; height: number; heights: Float32Array; surface: Uint8Array }
  | { type: 'chunk'; requestId: number; cx: number; cz: number; lod: number; originX: number; originZ: number };

ctx.onmessage = (e: MessageEvent<InMsg>) => {
  const msg = e.data;
  if (msg.type === 'generate') {
    const grid = buildHeightGrid(msg.seed, msg.width ?? DEFAULT_GRID_W, msg.height ?? DEFAULT_GRID_H);
    setGrid(grid.width, grid.height, grid.heights, grid.surface);
    // clone before sending: the worker keeps its own working copy for chunk builds.
    const hOut = heights!.slice();
    const sOut = surface!.slice();
    ctx.postMessage({ type: 'generated', width: gridW, height: gridH, heights: hOut, surface: sOut }, [hOut.buffer, sOut.buffer]);
  } else if (msg.type === 'init') {
    setGrid(msg.width, msg.height, msg.heights, msg.surface);
    ctx.postMessage({ type: 'ready' });
  } else if (msg.type === 'chunk') {
    if (!heights || !surface) return; // not initialised yet; main thread will retry
    const geo = buildChunkGeometry(heights, surface, gridW, gridH, scaleX, scaleZ, msg.originX, msg.originZ, msg.lod);
    ctx.postMessage(
      {
        type: 'chunkDone', requestId: msg.requestId, cx: msg.cx, cz: msg.cz, lod: msg.lod,
        positions: geo.positions, normals: geo.normals, uvs: geo.uvs, surfaceId: geo.surfaceId, indices: geo.indices,
        allWater: geo.allWater, minY: geo.minY, maxY: geo.maxY,
      },
      [geo.positions.buffer, geo.normals.buffer, geo.uvs.buffer, geo.surfaceId.buffer, geo.indices.buffer],
    );
  }
};
