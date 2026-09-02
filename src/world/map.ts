/**
 * Top-down shaded-relief map image (WorldService.mapImage / worldToMapUv). Rendered once to a
 * 1024x1024 canvas and cached as a data URL.
 */
import { MAP_BOUNDS } from '@content/gazetteer';
import type { RegionDef } from '@core/schemas';
import type { TerrainManager } from './terrain';
import { buildWorldGeo } from './geodata';

const SIZE = 1024;

const SURFACE_COLOR: Record<string, [number, number, number]> = {
  grass: [107, 138, 68], meadow: [140, 158, 92], forest: [58, 76, 46], rock: [120, 114, 104],
  scree: [142, 134, 118], snow: [238, 240, 245], water: [61, 104, 128], mud: [96, 76, 54],
  road: [138, 118, 88], settlement: [162, 140, 104],
};

const OWNER_TINT: Record<string, [number, number, number]> = {
  uri: [70, 110, 70], schwyz: [150, 40, 40], unterwalden: [60, 80, 130], habsburg: [40, 40, 40],
  luzern: [50, 70, 140], einsiedeln: [110, 60, 130], zuerich: [90, 90, 90], bern: [90, 90, 90],
  zug: [40, 40, 40], none: [90, 90, 90],
};

let cachedUrl: string | null = null;

export function worldToMapUv(x: number, z: number): [number, number] {
  const u = (x - MAP_BOUNDS.minX) / (MAP_BOUNDS.maxX - MAP_BOUNDS.minX);
  const v = (z - MAP_BOUNDS.minZ) / (MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ);
  return [u, v];
}

export async function renderMapImage(terrain: TerrainManager, regions: RegionDef[]): Promise<string> {
  if (cachedUrl) return cachedUrl;
  await terrain.ready;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE; canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(SIZE, SIZE);
  const lightDir = normalize3(-0.5, 0.8, -0.35);

  for (let py = 0; py < SIZE; py++) {
    const z = MAP_BOUNDS.minZ + (py / (SIZE - 1)) * (MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ);
    for (let px = 0; px < SIZE; px++) {
      const x = MAP_BOUNDS.minX + (px / (SIZE - 1)) * (MAP_BOUNDS.maxX - MAP_BOUNDS.minX);
      const surf = terrain.surfaceAt(x, z);
      const base = SURFACE_COLOR[surf] ?? SURFACE_COLOR.grass;
      let shade = 1;
      if (surf !== 'water') {
        const n = terrain.normalAt(x, z);
        const dot = n.x * lightDir[0] + n.y * lightDir[1] + n.z * lightDir[2];
        shade = 0.55 + Math.max(0, dot) * 0.65;
      } else {
        shade = 0.9;
      }
      const i = (py * SIZE + px) * 4;
      img.data[i] = clamp255(base[0] * shade);
      img.data[i + 1] = clamp255(base[1] * shade);
      img.data[i + 2] = clamp255(base[2] * shade);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // region tints (translucent fills, so the relief still reads through)
  ctx.globalAlpha = 0.14;
  for (const r of regions) {
    const tint = OWNER_TINT[r.owner] ?? OWNER_TINT.none;
    ctx.fillStyle = `rgb(${tint[0]},${tint[1]},${tint[2]})`;
    ctx.beginPath();
    r.bounds.forEach(([x, z], i) => {
      const [u, v] = worldToMapUv(x, z);
      const px = u * SIZE, py = v * SIZE;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // roads (too thin to reliably survive per-pixel surface sampling at this resolution)
  const geo = buildWorldGeo();
  ctx.strokeStyle = 'rgba(90,72,48,0.85)';
  ctx.lineWidth = 1.4;
  for (const c of geo.corridors) {
    if (c.kind !== 'road') continue;
    ctx.beginPath();
    c.pts.forEach((p, i) => {
      const [u, v] = worldToMapUv(p.x, p.z);
      const px = u * SIZE, py = v * SIZE;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.stroke();
  }

  cachedUrl = canvas.toDataURL('image/png');
  return cachedUrl;
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
