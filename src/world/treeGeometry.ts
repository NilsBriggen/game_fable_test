/**
 * Procedural trees: bark-textured trunk + branch whorls of alpha-tested needle/leaf cards, all UV'd
 * into one shared atlas so every species and every LOD draws with a single material.
 * LOD 0 full, LOD 1 reduced, LOD 2 a cross-quad billboard from the impostor atlas.
 */
import { BufferGeometry, DoubleSide, Float32BufferAttribute, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import type { Rng } from '@core/rng';
import { treeAtlasTexture, treeCellUv, treeImpostorAtlas, impostorCellUv, grassTuftTexture, type TreeCell } from './textures';
import { applyAerialFog } from './terrainMaterial';
import { registerCsmMaterial } from './shadowCsm';

export type TreeKind = 'spruce' | 'fir' | 'larch' | 'beech' | 'pine';

interface Species {
  height: [number, number];
  crown: number;      // crown radius / height
  whorls: number;
  cardsPerWhorl: number;
  droop: number;      // radians the cards tilt down from horizontal
  foliage: TreeCell;
  bark: TreeCell;
  crownStart: number; // fraction of height where foliage begins
  taper: number;
}

const SPECIES: Record<TreeKind, Species> = {
  spruce: { height: [11, 16], crown: 0.21, whorls: 9, cardsPerWhorl: 7, droop: 0.42, foliage: 'spruce', bark: 'bark', crownStart: 0.14, taper: 1.35 },
  fir:    { height: [10, 14], crown: 0.23, whorls: 8, cardsPerWhorl: 7, droop: 0.18, foliage: 'fir', bark: 'bark', crownStart: 0.2, taper: 1.1 },
  larch:  { height: [9, 13],  crown: 0.17, whorls: 8, cardsPerWhorl: 5, droop: 0.3, foliage: 'larch', bark: 'barkPale', crownStart: 0.24, taper: 1.2 },
  beech:  { height: [10, 15], crown: 0.34, whorls: 4, cardsPerWhorl: 9, droop: 0.05, foliage: 'beech', bark: 'barkPale', crownStart: 0.45, taper: 0.6 },
  pine:   { height: [3, 5],   crown: 0.55, whorls: 4, cardsPerWhorl: 7, droop: 0.55, foliage: 'pine', bark: 'bark', crownStart: 0.1, taper: 0.9 },
};

class MeshBuilder {
  pos: number[] = []; nrm: number[] = []; uv: number[] = []; idx: number[] = [];
  quad(o: Vector3, right: Vector3, up: Vector3, n: Vector3, uvRect: [number, number, number, number]): void {
    const b = this.pos.length / 3;
    const [u0, v0, du, dv] = uvRect;
    const corners = [
      [-1, 0, u0, v0], [1, 0, u0 + du, v0], [1, 1, u0 + du, v0 + dv], [-1, 1, u0, v0 + dv],
    ];
    for (const [rx, uy, uu, vv] of corners) {
      this.pos.push(o.x + right.x * rx + up.x * uy, o.y + right.y * rx + up.y * uy, o.z + right.z * rx + up.z * uy);
      this.nrm.push(n.x, n.y, n.z);
      this.uv.push(uu, vv);
    }
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  /** Tapered trunk; UV wraps the bark cell once around and twice up. */
  trunk(h: number, r0: number, r1: number, sides: number, uvRect: [number, number, number, number], lean: number): void {
    const [u0, v0, du, dv] = uvRect;
    const rings = 3;
    const base = this.pos.length / 3;
    for (let ring = 0; ring <= rings; ring++) {
      const t = ring / rings;
      const y = h * t;
      const r = r0 + (r1 - r0) * Math.pow(t, 0.7);
      const off = lean * t * t * h * 0.06;
      for (let s = 0; s <= sides; s++) {
        const a = (s / sides) * Math.PI * 2;
        this.pos.push(Math.cos(a) * r + off, y, Math.sin(a) * r);
        this.nrm.push(Math.cos(a), 0.15, Math.sin(a));
        this.uv.push(u0 + (s / sides) * du, v0 + t * dv);
      }
    }
    const stride = sides + 1;
    for (let ring = 0; ring < rings; ring++) {
      for (let s = 0; s < sides; s++) {
        const a = base + ring * stride + s, b = a + 1, c = a + stride, d = c + 1;
        this.idx.push(a, c, b, b, c, d);
      }
    }
  }
  geometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

function buildTree(kind: TreeKind, rng: Rng, lod: 0 | 1): BufferGeometry {
  const sp = SPECIES[kind];
  const H = sp.height[0] + rng.next() * (sp.height[1] - sp.height[0]);
  const mb = new MeshBuilder();
  const barkUv = treeCellUv(sp.bark);
  const folUv = treeCellUv(sp.foliage);
  const sides = lod === 0 ? 7 : 5;
  const lean = (rng.next() - 0.5) * 2;
  mb.trunk(H * (kind === 'beech' ? 0.62 : 0.99), 0.055 * H * 0.4 + 0.12, 0.03, sides, barkUv, lean);

  const whorls = lod === 0 ? sp.whorls : Math.max(3, Math.round(sp.whorls * 0.55));
  const perWhorl = lod === 0 ? sp.cardsPerWhorl : Math.max(4, Math.round(sp.cardsPerWhorl * 0.6));
  const Rmax = H * sp.crown;
  const centre = new Vector3();
  const right = new Vector3(), up = new Vector3(), nrm = new Vector3();

  if (kind === 'beech') {
    // dome of leaf cards on a squashed sphere shell
    const cy = H * 0.78, R = H * sp.crown;
    const count = whorls * perWhorl;
    for (let i = 0; i < count; i++) {
      const a = rng.next() * Math.PI * 2;
      const v = Math.acos(1 - 1.35 * rng.next());
      const rr = R * (0.72 + rng.next() * 0.32);
      const dx = Math.sin(v) * Math.cos(a), dy = Math.cos(v) * 0.78, dz = Math.sin(v) * Math.sin(a);
      centre.set(dx * rr, cy + dy * rr - R * 0.15, dz * rr);
      nrm.set(dx, dy + 0.35, dz).normalize();
      const s = R * (0.34 + rng.next() * 0.24);
      const roll = rng.next() * Math.PI;
      right.set(Math.cos(roll), 0, Math.sin(roll)).multiplyScalar(s);
      up.copy(nrm).cross(right).normalize().multiplyScalar(s * 1.5);
      mb.quad(centre, right, up, nrm, folUv);
    }
    // three lifting branches so the crown is not a floating ball
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + rng.next();
      const dir = new Vector3(Math.cos(a), 1.55, Math.sin(a)).normalize();
      const len = H * 0.3;
      centre.set(dir.x * len * 0.5, H * 0.62 + dir.y * len * 0.5, dir.z * len * 0.5);
      right.set(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(0.075 * H * 0.4);
      up.copy(dir).multiplyScalar(len * 0.5);
      nrm.set(Math.cos(a), 0.2, Math.sin(a)).normalize();
      mb.quad(centre, right, up, nrm, barkUv);
    }
  } else {
    for (let w = 0; w < whorls; w++) {
      const t = sp.crownStart + (1 - sp.crownStart) * (w / whorls);
      const y = H * t;
      const shrink = Math.pow(1 - (t - sp.crownStart) / (1 - sp.crownStart), sp.taper);
      const R = Rmax * (0.25 + 0.75 * shrink);
      const jitter = rng.next() * Math.PI * 2;
      const n = Math.max(3, Math.round(perWhorl * (0.6 + 0.4 * shrink)));
      for (let c = 0; c < n; c++) {
        const a = jitter + (c / n) * Math.PI * 2 + (rng.next() - 0.5) * 0.4;
        const len = R * (0.85 + rng.next() * 0.35);
        const dy = -Math.sin(sp.droop) * len;
        const dx = Math.cos(a) * len, dz = Math.sin(a) * len;
        centre.set(dx * 0.55, y + dy * 0.55, dz * 0.55);
        // card lies along the branch; "up" runs outward+down, "right" is horizontal across it
        up.set(dx, dy, dz).multiplyScalar(0.55);
        right.set(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(len * 0.5);
        nrm.set(Math.cos(a) * 0.45, 0.9, Math.sin(a) * 0.45).normalize();
        mb.quad(centre, right, up, nrm, folUv);
        if (lod === 0 && rng.next() < 0.32) {
          // second card rolled about the branch axis so the whorl has volume, not a flat disc
          centre.set(dx * 0.5, y + dy * 0.5 + len * 0.12, dz * 0.5);
          right.set(-Math.sin(a), 0.85, Math.cos(a)).normalize().multiplyScalar(len * 0.42);
          mb.quad(centre, right, up, nrm, folUv);
        }
      }
    }
    // leader: two crossed cards at the apex
    const tipH = H * 0.16;
    for (const roll of [0, Math.PI / 2]) {
      centre.set(0, H - tipH * 0.5, 0);
      right.set(Math.cos(roll), 0, Math.sin(roll)).multiplyScalar(Rmax * 0.3);
      up.set(0, tipH * 0.5, 0);
      nrm.set(Math.cos(roll + Math.PI / 2), 0.3, Math.sin(roll + Math.PI / 2)).normalize();
      mb.quad(centre, right, up, nrm, folUv);
    }
  }
  return mb.geometry();
}

const geoCache = new Map<string, BufferGeometry>();

/** `lod` 0 = full, 1 = reduced. A handful of variants per species are reused across all instances. */
export function buildTreeGeometry(kind: TreeKind, rng: Rng, lod: 0 | 1 = 0): BufferGeometry {
  const variant = Math.floor(rng.next() * 5);
  const key = `${kind}:${lod}:${variant}`;
  const hit = geoCache.get(key);
  if (hit) return hit;
  const g = buildTree(kind, rng, lod);
  geoCache.set(key, g);
  return g;
}

let sharedMaterial: MeshStandardMaterial | null = null;
export function treeMaterial(): MeshStandardMaterial {
  if (sharedMaterial) return sharedMaterial;
  sharedMaterial = new MeshStandardMaterial({
    map: treeAtlasTexture(), alphaTest: 0.45, side: DoubleSide, roughness: 0.92, metalness: 0,
  });
  sharedMaterial.fog = false;
  sharedMaterial.onBeforeCompile = (shader) => applyAerialFog(shader as any);
  registerCsmMaterial(sharedMaterial);
  return sharedMaterial;
}

let impostorMat: MeshStandardMaterial | null = null;
function impostorMaterial(): MeshStandardMaterial {
  if (impostorMat) return impostorMat;
  impostorMat = new MeshStandardMaterial({
    map: treeImpostorAtlas(), alphaTest: 0.4, side: DoubleSide, roughness: 1, metalness: 0,
  });
  impostorMat.fog = false;
  impostorMat.onBeforeCompile = (shader) => applyAerialFog(shader as any);
  registerCsmMaterial(impostorMat);
  return impostorMat;
}

const impostorGeos = new Map<string, BufferGeometry>();

/** Cross-quad billboard for distant trees: reads from any horizontal angle without per-instance math. */
export function treeImpostor(kind: TreeKind): { geometry: BufferGeometry; material: MeshStandardMaterial } {
  const cell = kind === 'pine' ? 'fir' : kind;
  const hit = impostorGeos.get(cell);
  if (hit) return { geometry: hit, material: impostorMaterial() };
  const h = kind === 'pine' ? 4.5 : 13;
  const w = h * 0.42;
  const uvRect = impostorCellUv(cell);
  const mb = new MeshBuilder();
  for (const roll of [0, Math.PI / 2]) {
    mb.quad(
      new Vector3(0, h / 2, 0),
      new Vector3(Math.cos(roll) * w / 2, 0, Math.sin(roll) * w / 2),
      new Vector3(0, h / 2, 0),
      new Vector3(Math.cos(roll + Math.PI / 2), 0.35, Math.sin(roll + Math.PI / 2)).normalize(),
      uvRect,
    );
  }
  const g = mb.geometry();
  impostorGeos.set(cell, g);
  return { geometry: g, material: impostorMaterial() };
}

let grassGeo: BufferGeometry | null = null;
let grassMat: MeshStandardMaterial | null = null;

/** Three crossed alpha-tested blades; instanced within 80 m of the camera on grass/meadow. */
export function grassTuft(): { geometry: BufferGeometry; material: MeshStandardMaterial } {
  if (grassGeo && grassMat) return { geometry: grassGeo, material: grassMat };
  const mb = new MeshBuilder();
  const h = 0.55, w = 0.62;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI;
    mb.quad(
      new Vector3(0, h / 2, 0),
      new Vector3(Math.cos(a) * w / 2, 0, Math.sin(a) * w / 2),
      new Vector3(0, h / 2, 0),
      new Vector3(0, 1, 0),
      [0, 0, 1, 1],
    );
  }
  grassGeo = mb.geometry();
  grassMat = new MeshStandardMaterial({ map: grassTuftTexture(), alphaTest: 0.35, side: DoubleSide, roughness: 1 });
  grassMat.fog = false;
  grassMat.onBeforeCompile = (shader) => applyAerialFog(shader as any);
  return { geometry: grassGeo, material: grassMat };
}

export function disposeTreeGeometry(): void {
  for (const g of geoCache.values()) g.dispose();
  geoCache.clear();
  for (const g of impostorGeos.values()) g.dispose();
  impostorGeos.clear();
  sharedMaterial?.dispose(); sharedMaterial = null;
  impostorMat?.dispose(); impostorMat = null;
  grassGeo?.dispose(); grassGeo = null;
  grassMat?.dispose(); grassMat = null;
}

export type { Mesh };
