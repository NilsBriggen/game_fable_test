/**
 * Procedural trees: a bark-textured trunk plus branch whorls of alpha-tested needle/leaf cards, all
 * UV'd into the one shared foliage atlas so every species, every LOD and every trunk draws with a
 * single material (`look/foliage.ts`). LOD 0 full, LOD 1 reduced, LOD 2 a cross-quad billboard
 * painted from the same cells (`look/impostor.ts`).
 *
 * The geometry is generated rather than downloaded because the only CC0 conifer meshes that exist
 * are film-resolution — Poly Haven's `fir_tree_01` is 7.0 M triangles for ONE tree, more than twice
 * the entire frame budget. What is downloaded is the thing a card tree actually needs: photographic
 * needle and leaf cut-outs.
 *
 * Every card carries a vertex colour that darkens toward the trunk and toward the ground. That one
 * attribute is what stops a card tree reading as a flat green cone: real crowns are self-shadowed,
 * and no amount of directional light gives you that on two-sided alpha cards.
 */
import { BufferGeometry, DoubleSide, Float32BufferAttribute, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import type { Rng } from '@core/rng';
import { foliageAtlasTexture, foliageCellUv, groundCoverAtlasTexture, groundCellUv, type FoliageCell, type GroundCell } from './look/foliage';
import { treeImpostorAtlas, impostorCellUv, type ImpostorCell } from './look/impostor';
import { applyAerialFog } from './terrainMaterial';
import { registerCsmMaterial } from './shadowCsm';

export type TreeKind = 'spruce' | 'fir' | 'larch' | 'beech' | 'pine';

interface Species {
  height: [number, number];
  crown: number;      // crown radius / height
  whorls: number;
  cardsPerWhorl: number;
  droop: number;      // radians the cards tilt down from horizontal
  foliage: FoliageCell;
  bark: FoliageCell;
  crownStart: number; // fraction of height where foliage begins
  taper: number;
  trunkR: number;     // trunk radius at the base, as a fraction of height
}

const SPECIES: Record<TreeKind, Species> = {
  // A Swiss valley spruce is tall, narrow and starts its crown low; the fir is blunter and denser;
  // the larch is the airy one; the beech is the only broad crown below the tree line; the mountain
  // pine (Bergföhre) in the last belt under it is barely more than a shrub.
  spruce: { height: [13, 19], crown: 0.23, whorls: 8, cardsPerWhorl: 5, droop: 0.46, foliage: 'spruce', bark: 'bark', crownStart: 0.13, taper: 1.4, trunkR: 0.017 },
  fir: { height: [12, 17], crown: 0.25, whorls: 7, cardsPerWhorl: 5, droop: 0.16, foliage: 'fir', bark: 'bark', crownStart: 0.20, taper: 1.05, trunkR: 0.019 },
  larch: { height: [11, 15], crown: 0.19, whorls: 7, cardsPerWhorl: 4, droop: 0.30, foliage: 'larch', bark: 'barkPale', crownStart: 0.26, taper: 1.2, trunkR: 0.015 },
  beech: { height: [11, 17], crown: 0.36, whorls: 4, cardsPerWhorl: 7, droop: 0.05, foliage: 'beech', bark: 'barkPale', crownStart: 0.44, taper: 0.6, trunkR: 0.024 },
  pine: { height: [3, 5.5], crown: 0.55, whorls: 4, cardsPerWhorl: 5, droop: 0.55, foliage: 'pine', bark: 'bark', crownStart: 0.12, taper: 0.9, trunkR: 0.03 },
};

class MeshBuilder {
  pos: number[] = []; nrm: number[] = []; uv: number[] = []; col: number[] = []; idx: number[] = [];
  /** shade 0..1 multiplies the vertex colour; the top corners get `shadeTop`, the base `shade`. */
  quad(o: Vector3, right: Vector3, up: Vector3, n: Vector3, uvRect: [number, number, number, number], shade = 1, shadeTop = shade): void {
    const b = this.pos.length / 3;
    const [u0, v0, du, dv] = uvRect;
    const corners: [number, number, number, number, number][] = [
      [-1, 0, u0, v0, shade], [1, 0, u0 + du, v0, shade], [1, 1, u0 + du, v0 + dv, shadeTop], [-1, 1, u0, v0 + dv, shadeTop],
    ];
    for (const [rx, uy, uu, vv, sh] of corners) {
      this.pos.push(o.x + right.x * rx + up.x * uy, o.y + right.y * rx + up.y * uy, o.z + right.z * rx + up.z * uy);
      this.nrm.push(n.x, n.y, n.z);
      this.uv.push(uu, vv);
      this.col.push(sh, sh, sh);
    }
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  /** Tapered trunk; UV wraps the bark cell once around and once up (the cell holds 3 bark repeats). */
  trunk(h: number, r0: number, r1: number, sides: number, uvRect: [number, number, number, number], lean: number, rings = 3): void {
    const [u0, v0, du, dv] = uvRect;
    const base = this.pos.length / 3;
    for (let ring = 0; ring <= rings; ring++) {
      const t = ring / rings;
      const y = h * t;
      // root flare: the bottom eighth swells out, which is what makes a trunk sit in the ground
      const flare = 1 + 0.9 * Math.max(0, 1 - t * 8);
      const r = (r0 + (r1 - r0) * Math.pow(t, 0.7)) * flare;
      const off = lean * t * t * h * 0.06;
      const sh = 0.5 + 0.5 * Math.min(1, t * 2.2);
      for (let s = 0; s <= sides; s++) {
        const a = (s / sides) * Math.PI * 2;
        this.pos.push(Math.cos(a) * r + off, y, Math.sin(a) * r);
        this.nrm.push(Math.cos(a), 0.15, Math.sin(a));
        this.uv.push(u0 + (s / sides) * du, v0 + t * dv);
        this.col.push(sh, sh, sh);
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
    g.setAttribute('color', new Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

function buildTree(kind: TreeKind, rng: Rng, lod: 0 | 1): BufferGeometry {
  const sp = SPECIES[kind];
  const H = sp.height[0] + rng.next() * (sp.height[1] - sp.height[0]);
  const mb = new MeshBuilder();
  const barkUv = foliageCellUv(sp.bark);
  const folUv = foliageCellUv(sp.foliage);
  const sides = lod === 0 ? 6 : 4;
  const lean = (rng.next() - 0.5) * 2;
  mb.trunk(H * (kind === 'beech' ? 0.66 : 0.98), sp.trunkR * H, sp.trunkR * H * 0.22, sides, barkUv, lean, lod === 0 ? 3 : 2);

  // LOD1 is used from 70 to 250 m — close enough that a crown of four cards reads as a bare pole
  // with a bush on it, which is exactly how the Seelisberg middle distance looked at 0.55/0.62.
  const whorls = lod === 0 ? sp.whorls : Math.max(4, Math.round(sp.whorls * 0.75));
  const perWhorl = lod === 0 ? sp.cardsPerWhorl : Math.max(4, Math.round(sp.cardsPerWhorl * 0.8));
  const Rmax = H * sp.crown;
  const centre = new Vector3();
  const right = new Vector3(), up = new Vector3(), nrm = new Vector3();

  if (kind === 'beech') {
    // A beech crown is a shell, not a ball: cards on the outside of a squashed sphere, with the
    // interior left empty so light and background show through between the leaf masses.
    const cy = H * 0.80, R = H * sp.crown;
    const count = whorls * perWhorl;
    for (let i = 0; i < count; i++) {
      const a = rng.next() * Math.PI * 2;
      const v = Math.acos(1 - 1.4 * rng.next());
      const rr = R * (0.78 + rng.next() * 0.28);
      const dx = Math.sin(v) * Math.cos(a), dy = Math.cos(v) * 0.76, dz = Math.sin(v) * Math.sin(a);
      centre.set(dx * rr, cy + dy * rr - R * 0.18, dz * rr);
      nrm.set(dx, dy + 0.35, dz).normalize();
      const s = R * (0.40 + rng.next() * 0.26);
      const roll = rng.next() * Math.PI;
      right.set(Math.cos(roll), 0, Math.sin(roll)).multiplyScalar(s);
      up.copy(nrm).cross(right).normalize().multiplyScalar(s * 1.55);
      // shade by height in the crown: the underside of a beech is very dark
      const shade = 0.36 + 0.64 * Math.min(1, (dy * 0.5 + 0.6));
      mb.quad(centre, right, up, nrm, folUv, shade * 0.8, shade);
    }
    // three lifting limbs so the crown is not a floating ball
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + rng.next();
      const dir = new Vector3(Math.cos(a), 1.5, Math.sin(a)).normalize();
      const len = H * 0.32;
      centre.set(dir.x * len * 0.5, H * 0.64 + dir.y * len * 0.5, dir.z * len * 0.5);
      right.set(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(sp.trunkR * H * 0.5);
      up.copy(dir).multiplyScalar(len * 0.5);
      nrm.set(Math.cos(a), 0.2, Math.sin(a)).normalize();
      mb.quad(centre, right, up, nrm, barkUv, 0.7, 0.85);
    }
  } else {
    for (let w = 0; w < whorls; w++) {
      const t = sp.crownStart + (1 - sp.crownStart) * (w / whorls);
      const y = H * t;
      const shrink = Math.pow(1 - (t - sp.crownStart) / (1 - sp.crownStart), sp.taper);
      const R = Rmax * (0.22 + 0.78 * shrink);
      const jitter = rng.next() * Math.PI * 2;
      const n = Math.max(3, Math.round(perWhorl * (0.62 + 0.38 * shrink)));
      // a whorl deep inside the crown sees almost no sky
      const depthShade = 0.42 + 0.58 * ((t - sp.crownStart) / (1 - sp.crownStart));
      for (let c = 0; c < n; c++) {
        const a = jitter + (c / n) * Math.PI * 2 + (rng.next() - 0.5) * 0.5;
        const len = R * (0.95 + rng.next() * 0.4);
        const dy = -Math.sin(sp.droop) * len;
        const dx = Math.cos(a) * len, dz = Math.sin(a) * len;
        centre.set(dx * 0.5, y + dy * 0.5, dz * 0.5);
        // card lies along the branch; "up" runs outward+down, "right" is horizontal across it
        up.set(dx, dy, dz).multiplyScalar(0.55);
        right.set(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(len * 0.52);
        nrm.set(Math.cos(a) * 0.45, 0.9, Math.sin(a) * 0.45).normalize();
        mb.quad(centre, right, up, nrm, folUv, depthShade * 0.72, Math.min(1, depthShade * 1.12));
        if (lod === 0 && rng.next() < 0.4) {
          // second card rolled about the branch axis so the whorl has volume, not a flat disc
          centre.set(dx * 0.46, y + dy * 0.46 + len * 0.14, dz * 0.46);
          right.set(-Math.sin(a), 0.85, Math.cos(a)).normalize().multiplyScalar(len * 0.44);
          mb.quad(centre, right, up, nrm, folUv, depthShade * 0.62, depthShade);
        }
      }
    }
    // leader: two crossed cards at the apex
    const tipH = H * 0.17;
    for (const roll of [0, Math.PI / 2]) {
      centre.set(0, H - tipH * 0.5, 0);
      right.set(Math.cos(roll), 0, Math.sin(roll)).multiplyScalar(Rmax * 0.3);
      up.set(0, tipH * 0.55, 0);
      nrm.set(Math.cos(roll + Math.PI / 2), 0.3, Math.sin(roll + Math.PI / 2)).normalize();
      mb.quad(centre, right, up, nrm, folUv, 0.9, 1);
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
    map: foliageAtlasTexture(), alphaTest: 0.42, side: DoubleSide, roughness: 0.92, metalness: 0, vertexColors: true,
  });
  sharedMaterial.fog = false;
  sharedMaterial.onBeforeCompile = (shader) => { applyAerialFog(shader as any); applyWindSway(shader as any, 1.0); };
  registerCsmMaterial(sharedMaterial);
  return sharedMaterial;
}

/** Shared wind clock (seconds). Advanced by vegetation.update via setWindTime. */
const windUniform: { value: number } = { value: 0 };
export function setWindTime(t: number): void { windUniform.value = t; }

/**
 * Phase 6 wind sway: displaces full/mid-tier foliage by height fraction, instancing-aware.
 * Amplitude scales with local height (top sways, trunk stays) and is small enough to never
 * move a trunk off its collider. Reduced-motion disables via uWindAmp = 0 (see vegetation.ts).
 */
const windAmpUniform: { value: number } = { value: 1 };
export function setWindAmp(a: number): void { windAmpUniform.value = a; }
function applyWindSway(shader: { vertexShader: string; uniforms: Record<string, { value: unknown }> }, strength: number): void {
  shader.uniforms.uWindTime = windUniform as { value: unknown };
  shader.uniforms.uWindAmp = windAmpUniform as { value: unknown };
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', 'uniform float uWindTime;\nuniform float uWindAmp;\n#include <common>')
    .replace('#include <begin_vertex>', /* glsl */ `
      #include <begin_vertex>
      {
        // height fraction within this instance: position.y is local pre-instance metres
        float hf = clamp(position.y / 9.0, 0.0, 1.0);
        float ph = 0.0;
        #ifdef USE_INSTANCING
          ph = float(gl_InstanceID) * 1.61803398875;
        #endif
        float sway = (sin(uWindTime * 1.7 + ph + position.x * 0.35) * 0.6 + sin(uWindTime * 3.1 + ph * 1.3) * 0.4);
        vec2 wdir = vec2(0.62, 0.78);
        transformed.xz += wdir * (sway * hf * hf * ${strength.toFixed(2)} * 0.22 * uWindAmp);
      }
    `);
}

let impostorMat: MeshStandardMaterial | null = null;
function impostorMaterial(): MeshStandardMaterial {
  if (impostorMat) return impostorMat;
  impostorMat = new MeshStandardMaterial({
    map: treeImpostorAtlas(), alphaTest: 0.35, side: DoubleSide, roughness: 1, metalness: 0,
  });
  impostorMat.fog = false;
  impostorMat.onBeforeCompile = (shader) => { applyAerialFog(shader as any); applyWindSway(shader as any, 0.3); };
  registerCsmMaterial(impostorMat);
  return impostorMat;
}

const impostorGeos = new Map<string, BufferGeometry>();

/** Cross-quad billboard for distant trees: reads from any horizontal angle without per-instance math. */
export function treeImpostor(kind: TreeKind): { geometry: BufferGeometry; material: MeshStandardMaterial } {
  const cell = kind as ImpostorCell;
  const hit = impostorGeos.get(cell);
  if (hit) return { geometry: hit, material: impostorMaterial() };
  const sp = SPECIES[kind];
  // the painted tree fills 94% of a square cell, so the quad is square too and the world height
  // matches the mesh tier's mid-range height
  const h = (sp.height[0] + sp.height[1]) * 0.5 / 0.94;
  const uvRect = impostorCellUv(cell);
  const mb = new MeshBuilder();
  for (const roll of [0, Math.PI / 2]) {
    mb.quad(
      new Vector3(0, h / 2, 0),
      new Vector3(Math.cos(roll) * h / 2, 0, Math.sin(roll) * h / 2),
      new Vector3(0, h / 2, 0),
      new Vector3(Math.cos(roll + Math.PI / 2), 0.35, Math.sin(roll + Math.PI / 2)).normalize(),
      uvRect,
    );
  }
  const g = mb.geometry();
  impostorGeos.set(cell, g);
  return { geometry: g, material: impostorMaterial() };
}

// ---------------------------------------------------------------------------------------------
// Ground cover: tufts, ferns and herbs from the second atlas
// ---------------------------------------------------------------------------------------------

let groundMat: MeshStandardMaterial | null = null;
function groundCoverMaterial(): MeshStandardMaterial {
  if (groundMat) return groundMat;
  groundMat = new MeshStandardMaterial({
    map: groundCoverAtlasTexture(), alphaTest: 0.34, side: DoubleSide, roughness: 1, metalness: 0, vertexColors: true,
  });
  groundMat.fog = false;
  groundMat.onBeforeCompile = (shader) => { applyAerialFog(shader as any); applyWindSway(shader as any, 0.6); };
  return groundMat;
}

const clutterGeos = new Map<string, BufferGeometry>();

/**
 * Crossed alpha cards for one ground-cover clump. `blades` crossed quads of size `w` x `h`,
 * darkened at the base so a tuft does not look like a decal lying on the ground.
 */
export function groundCover(cell: GroundCell, blades = 3, w = 0.62, h = 0.55): { geometry: BufferGeometry; material: MeshStandardMaterial } {
  const key = `${cell}:${blades}:${w}:${h}`;
  const hit = clutterGeos.get(key);
  if (hit) return { geometry: hit, material: groundCoverMaterial() };
  const mb = new MeshBuilder();
  const uv = groundCellUv(cell);
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI;
    mb.quad(
      new Vector3(0, 0, 0),
      new Vector3(Math.cos(a) * w / 2, 0, Math.sin(a) * w / 2),
      new Vector3(0, h, 0),
      new Vector3(0, 1, 0),
      uv, 0.55, 1.0,
    );
  }
  const g = mb.geometry();
  clutterGeos.set(key, g);
  return { geometry: g, material: groundCoverMaterial() };
}

/** Back-compat name used by vegetation.ts for the plain grass tuft. */
export function grassTuft(): { geometry: BufferGeometry; material: MeshStandardMaterial } {
  return groundCover('grass', 3, 0.66, 0.6);
}

export function disposeTreeGeometry(): void {
  for (const g of geoCache.values()) g.dispose();
  geoCache.clear();
  for (const g of impostorGeos.values()) g.dispose();
  impostorGeos.clear();
  for (const g of clutterGeos.values()) g.dispose();
  clutterGeos.clear();
  sharedMaterial?.dispose(); sharedMaterial = null;
  impostorMat?.dispose(); impostorMat = null;
  groundMat?.dispose(); groundMat = null;
}

export type { Mesh };
