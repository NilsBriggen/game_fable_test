/**
 * Procedural tree geometry: merged single-BufferGeometry-with-vertex-colors per species, so both the
 * model library (spawnModel) and vegetation.ts's InstancedMesh placement share one cheap draw target.
 */
import {
  BufferGeometry, CanvasTexture, Color, ConeGeometry, CylinderGeometry, DoubleSide, Float32BufferAttribute,
  IcosahedronGeometry, Mesh, MeshStandardMaterial,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Rng } from '@core/rng';

export type TreeKind = 'spruce' | 'fir' | 'larch' | 'beech';

/** Normalise to non-indexed (IcosahedronGeometry has no index; Cylinder/Cone do — mergeGeometries
 * requires every part to agree), then bake a flat vertex color. */
function colored(geo: any, color: Color): any {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = color.r; arr[i * 3 + 1] = color.g; arr[i * 3 + 2] = color.b; }
  g.setAttribute('color', new (g.attributes.position.constructor)(arr, 3));
  return g;
}

const TRUNK = new Color(0x4a3323);
const TRUNK_LIGHT = new Color(0x6b4a2c);

function conifer(kind: 'spruce' | 'fir', rng: Rng): any {
  const tiers = kind === 'spruce' ? 5 : 4;
  const baseR = kind === 'spruce' ? 1.7 : 1.5;
  const totalH = kind === 'spruce' ? 11 + rng.next() * 3 : 9 + rng.next() * 2.5;
  const trunkH = totalH * 0.16;
  const foliageColor = kind === 'spruce' ? new Color(0x203a24) : new Color(0x2c4a34);
  const parts: any[] = [];
  const trunk = new CylinderGeometry(0.18, 0.28, trunkH, 6);
  trunk.translate(0, trunkH / 2, 0);
  parts.push(colored(trunk, TRUNK));
  let y = trunkH * 0.55;
  const remaining = totalH - y;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const h = (remaining / tiers) * 1.55;
    const r = baseR * (1 - t * 0.72);
    const cone = new ConeGeometry(r, h, kind === 'spruce' ? 7 : 6, 1);
    cone.translate(0, y + h / 2, 0);
    const c = foliageColor.clone().offsetHSL(0, 0, (rng.next() - 0.5) * 0.03);
    parts.push(colored(cone, c));
    y += (remaining / tiers) * 0.62;
  }
  return mergeGeometries(parts, false);
}

function larch(rng: Rng): any {
  const totalH = 8 + rng.next() * 2.5;
  const trunkH = totalH * 0.22;
  const parts: any[] = [];
  const trunk = new CylinderGeometry(0.16, 0.24, trunkH, 6);
  trunk.translate(0, trunkH / 2, 0);
  parts.push(colored(trunk, TRUNK_LIGHT));
  const tiers = 4;
  let y = trunkH * 0.7;
  const remaining = totalH - y;
  const color = new Color(0x5c7a3a);
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const h = (remaining / tiers) * 1.4;
    const r = 1.25 * (1 - t * 0.6);
    const cone = new ConeGeometry(r, h, 6, 1, true);
    cone.translate(0, y + h / 2, 0);
    parts.push(colored(cone, color.clone().offsetHSL(0, 0, (rng.next() - 0.5) * 0.05)));
    y += (remaining / tiers) * 0.75;
  }
  return mergeGeometries(parts, false);
}

function beech(rng: Rng): any {
  const totalH = 9 + rng.next() * 4;
  const trunkH = totalH * 0.48;
  const parts: any[] = [];
  const trunk = new CylinderGeometry(0.22, 0.34, trunkH, 6);
  trunk.translate(0, trunkH / 2, 0);
  parts.push(colored(trunk, TRUNK_LIGHT));
  const canopyR = totalH * 0.32;
  const blobs = 3;
  const green = new Color(0x4c6a34);
  for (let i = 0; i < blobs; i++) {
    const ico = new IcosahedronGeometry(canopyR * (0.75 + rng.next() * 0.35), 1);
    const ox = (rng.next() - 0.5) * canopyR * 0.7;
    const oz = (rng.next() - 0.5) * canopyR * 0.7;
    const oy = trunkH + canopyR * (0.55 + i * 0.28);
    ico.translate(ox, oy, oz);
    parts.push(colored(ico, green.clone().offsetHSL(0, 0, (rng.next() - 0.5) * 0.06)));
  }
  return mergeGeometries(parts, false);
}

const geoCache = new Map<string, any>();
export function buildTreeGeometry(kind: TreeKind, rng: Rng): any {
  const key = `${kind}:${Math.floor(rng.next() * 6)}`; // a handful of variants per species, reused across instances
  const hit = geoCache.get(key);
  if (hit) return hit;
  let g: any;
  if (kind === 'spruce') g = conifer('spruce', rng);
  else if (kind === 'fir') g = conifer('fir', rng);
  else if (kind === 'larch') g = larch(rng);
  else g = beech(rng);
  geoCache.set(key, g);
  return g;
}

let sharedMaterial: MeshStandardMaterial | null = null;
export function treeMaterial(): MeshStandardMaterial {
  if (sharedMaterial) return sharedMaterial;
  sharedMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, alphaTest: 0.5 });
  return sharedMaterial;
}

/** A simple billboard texture (2 crossed quads' worth of alpha-tested canopy) for far-LOD impostors. */
let impostorTex: CanvasTexture | null = null;
export function treeImpostorTexture(): CanvasTexture {
  if (impostorTex) return impostorTex;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#4a3323';
  ctx.fillRect(size / 2 - 2, size * 0.7, 4, size * 0.3);
  ctx.fillStyle = '#2c4a2e';
  ctx.beginPath();
  ctx.moveTo(size / 2, 2);
  ctx.lineTo(size * 0.15, size * 0.78);
  ctx.lineTo(size * 0.85, size * 0.78);
  ctx.closePath();
  ctx.fill();
  const tex = new CanvasTexture(canvas);
  impostorTex = tex;
  return tex;
}

/** Static cross-quad impostor (two perpendicular alpha-tested planes) — reads reasonably from any
 * horizontal angle without needing per-instance camera-facing shader math. Used beyond the full-mesh LOD. */
let impostorGeo: BufferGeometry | null = null;
let impostorMat: MeshStandardMaterial | null = null;
export function treeImpostor(): { geometry: BufferGeometry; material: MeshStandardMaterial } {
  if (impostorGeo && impostorMat) return { geometry: impostorGeo, material: impostorMat };
  const w = 4.2, h = 9.5;
  const quad = (nx: number, nz: number): number[] => [
    -w / 2 * nz, 0, -w / 2 * nx, w / 2 * nz, 0, w / 2 * nx, w / 2 * nz, h, w / 2 * nx,
    -w / 2 * nz, 0, -w / 2 * nx, w / 2 * nz, h, w / 2 * nx, -w / 2 * nz, h, -w / 2 * nx,
  ];
  const pos = new Float32Array([...quad(1, 0), ...quad(0, 1)]);
  const uv = new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]);
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  const mat = new MeshStandardMaterial({ map: treeImpostorTexture(), alphaTest: 0.4, side: DoubleSide, roughness: 1 });
  impostorGeo = geo; impostorMat = mat;
  return { geometry: geo, material: mat };
}

export function disposeTreeGeometry(): void {
  impostorGeo?.dispose();
  impostorMat?.dispose();
  impostorGeo = null; impostorMat = null;
  for (const g of geoCache.values()) g.dispose();
  geoCache.clear();
  sharedMaterial?.dispose();
  sharedMaterial = null;
  impostorTex?.dispose();
  impostorTex = null;
}

export type { Mesh };
