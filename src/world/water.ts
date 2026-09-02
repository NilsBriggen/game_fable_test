/**
 * Lake surfaces. One mesh per lake polygon sharing a single material (≤ 10 draw calls, usually 1–3
 * after frustum culling). Ear-clipped triangulation (the Vierwaldstättersee arms are strongly
 * concave, so a centroid fan would spill water over the land between them), a baked shore-distance
 * atlas that drives the deep→shallow colour ramp and the foam band, two counter-scrolling ripple
 * normal maps, Fresnel sky reflection and sun glitter. ARCHITECTURE.md §5.1.
 */
import {
  BufferAttribute, BufferGeometry, Color, DataTexture, FrontSide, Group, LinearFilter, Mesh,
  MeshStandardMaterial, RGBAFormat, RepeatWrapping, UnsignedByteType, Vector2, Vector3,
} from 'three';
import { polygonSdf } from '@core/math';
import { buildWorldGeo, type LakePoly } from './geodata';
import { waterNormalTexture } from './textures';
import { registerCsmMaterial } from './shadowCsm';
import { applyAerialFog, ATMOSPHERE, FOG_UNIFORMS } from './terrainMaterial';

const TILE = 256;        // shore-atlas texels per lake
const ATLAS_COLS = 4;    // 4x4 tiles = 16 slots for 9 lakes
const ATLAS_PX = TILE * ATLAS_COLS;
const SHORE_RANGE = 130; // metres of shore distance mapped into 0..1

// ---------------------------------------------------------------------------------------------
// Triangulation
// ---------------------------------------------------------------------------------------------

function signedArea(poly: [number, number][]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  return a / 2;
}

function pointInTri(p: [number, number], a: [number, number], b: [number, number], c: [number, number]): boolean {
  const d1 = (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1]);
  const d2 = (p[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (p[1] - c[1]);
  const d3 = (p[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (p[1] - a[1]);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/** Ear clipping for a simple (possibly strongly concave) polygon. Returns index triples. */
function earClip(poly: [number, number][]): number[] {
  const idx = poly.map((_, i) => i);
  if (signedArea(poly) < 0) idx.reverse(); // work on a CCW ring
  const tris: number[] = [];
  let guard = idx.length * idx.length + 8;
  while (idx.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const i0 = idx[(i + idx.length - 1) % idx.length], i1 = idx[i], i2 = idx[(i + 1) % idx.length];
      const a = poly[i0], b = poly[i1], c = poly[i2];
      if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) <= 0) continue; // reflex corner
      let blocked = false;
      for (const j of idx) {
        if (j === i0 || j === i1 || j === i2) continue;
        if (pointInTri(poly[j], a, b, c)) { blocked = true; break; }
      }
      if (blocked) continue;
      tris.push(i0, i1, i2);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  for (let i = 1; i + 1 < idx.length; i++) tris.push(idx[0], idx[i], idx[i + 1]);
  return tris;
}

// ---------------------------------------------------------------------------------------------
// Shore-distance atlas: R = 1 at open water, 0 at the shore line; G = a low-frequency foam mask.
// ---------------------------------------------------------------------------------------------

interface Tile { minX: number; minZ: number; spanX: number; spanZ: number; col: number; row: number }

function bakeShoreAtlas(lakes: LakePoly[]): { tex: DataTexture; tiles: Map<string, Tile> } {
  const data = new Uint8Array(new ArrayBuffer(ATLAS_PX * ATLAS_PX * 4));
  const tiles = new Map<string, Tile>();
  const INSET = 6; // texels of guard band so bilinear taps never cross a tile border
  lakes.forEach((lake, n) => {
    const col = n % ATLAS_COLS, row = Math.floor(n / ATLAS_COLS);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of lake.poly) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    // expand so the inset guard band still covers the whole polygon
    const padX = (maxX - minX) * (INSET / (TILE - 2 * INSET)), padZ = (maxZ - minZ) * (INSET / (TILE - 2 * INSET));
    minX -= padX; maxX += padX; minZ -= padZ; maxZ += padZ;
    const spanX = maxX - minX, spanZ = maxZ - minZ;
    tiles.set(lake.id, { minX, minZ, spanX, spanZ, col, row });
    for (let ty = 0; ty < TILE; ty++) {
      const z = minZ + ((ty + 0.5) / TILE) * spanZ;
      for (let tx = 0; tx < TILE; tx++) {
        const x = minX + ((tx + 0.5) / TILE) * spanX;
        const sdf = polygonSdf(x, z, lake.poly); // negative inside
        const depth = Math.max(0, Math.min(1, -sdf / SHORE_RANGE));
        const i = ((row * TILE + ty) * ATLAS_PX + col * TILE + tx) * 4;
        data[i] = Math.round(depth * 255);
        // foam mask: two out-of-phase wave trains along the shore so the band is not a clean ribbon
        const f = 0.5 + 0.25 * Math.sin(x * 0.11 + z * 0.07) + 0.25 * Math.sin(z * 0.19 - x * 0.05);
        data[i + 1] = Math.round(Math.max(0, Math.min(1, f)) * 255);
        data[i + 3] = 255;
      }
    }
  });
  const tex = new DataTexture(data, ATLAS_PX, ATLAS_PX, RGBAFormat, UnsignedByteType);
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter; // no mips: tiles must never bleed into each other
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return { tex, tiles };
}

// ---------------------------------------------------------------------------------------------

export interface WaterHandle {
  group: Group;
  /** Sky writes the reflection colours here each time the sun/weather changes. */
  uniforms: Record<string, { value: any }>;
  update(t: number): void;
  dispose(): void;
}

export function buildWater(): WaterHandle {
  const group = new Group();
  group.name = 'water';
  const geo = buildWorldGeo();
  const { tex: shoreTex, tiles } = bakeShoreAtlas(geo.lakes);

  const ripple0 = waterNormalTexture(0, 256);
  const ripple1 = waterNormalTexture(1, 256);
  ripple0.wrapS = ripple0.wrapT = RepeatWrapping;
  ripple1.wrapS = ripple1.wrapT = RepeatWrapping;

  const uniforms: Record<string, { value: any }> = {
    tShore: { value: shoreTex },
    tRipple0: { value: ripple0 },
    tRipple1: { value: ripple1 },
    uTime: { value: 0 },
    // Vierwaldstättersee/Urnersee: glacial-flour turquoise in the shallows, near-black blue-green deep
    uShallowColor: { value: new Color(0x2f7f88) },
    uDeepColor: { value: new Color(0x0b2a37) },
    uFoamColor: { value: new Color(0xdfeaee) },
    uWind: { value: new Vector2(0.62, 0.78) },
    ...ATMOSPHERE,
    ...FOG_UNIFORMS,
  };

  const material = new MeshStandardMaterial({
    color: 0xffffff, roughness: 0.08, metalness: 0, side: FrontSide, envMapIntensity: 1.0,
  });
  material.fog = false;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', 'attribute vec2 aShoreUv;\nvarying vec2 vShoreUv;\nvarying vec3 vWWorld;\n#include <common>')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWWorld = worldPosition.xyz;\nvShoreUv = aShoreUv;');

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */ `
        uniform sampler2D tShore, tRipple0, tRipple1;
        uniform float uTime, uGlitter, uChop;
        uniform vec3 uShallowColor, uDeepColor, uFoamColor, uSkyZenith, uSkyHorizon, uSunTint;
        uniform vec2 uWind;
        varying vec3 vWWorld;
        varying vec2 vShoreUv;
        vec4 gShore;
        vec3 gWaveN;
        float gRough = 0.08;
        // Two counter-scrolling ripple sheets at different scales; the sum never repeats visibly.
        vec3 rippleNormal(vec2 p) {
          vec2 w = normalize(uWind);
          vec2 a = p * 0.055 + w * uTime * 0.021;
          vec2 b = p * 0.017 - w.yx * uTime * 0.013;
          vec3 n0 = texture2D(tRipple0, a).xyz * 2.0 - 1.0;
          vec3 n1 = texture2D(tRipple1, b).xyz * 2.0 - 1.0;
          vec3 n = normalize(vec3((n0.xy + n1.xy) * uChop, n0.z * n1.z + 0.55));
          return n;
        }
        #include <common>
      `)
      .replace('#include <map_fragment>', /* glsl */ `
        {
          gShore = texture2D(tShore, vShoreUv);
          float depth = gShore.r;
          // colour ramp: turquoise shelf -> deep blue-green body
          vec3 col = mix(uShallowColor, uDeepColor, smoothstep(0.02, 0.42, depth));
          // foam: a broken band hugging the shore, animated by the ripple field
          float band = 1.0 - smoothstep(0.0, 0.052, depth);
          float wob = gShore.g + 0.35 * sin(uTime * 0.9 + vWWorld.x * 0.09 + vWWorld.z * 0.06);
          float foam = clamp(band * smoothstep(0.34, 0.86, wob), 0.0, 1.0);
          foam += (1.0 - smoothstep(0.0, 0.012, depth)) * 0.55; // always a thin lick right at the stones
          diffuseColor.rgb *= pow(mix(col, uFoamColor, clamp(foam, 0.0, 0.92)), vec3(2.2));
          gRough = mix(0.055, 0.75, clamp(foam, 0.0, 1.0));
        }
      `)
      .replace('#include <roughnessmap_fragment>', `
        #include <roughnessmap_fragment>
        roughnessFactor = gRough;
      `)
      .replace('#include <normal_fragment_maps>', /* glsl */ `
        {
          gWaveN = rippleNormal(vWWorld.xz);
          // the lake is a horizontal plane, so tangent = +X, bitangent = +Z: no derivative frame needed
          normal = normalize(vec3(gWaveN.x, gWaveN.z * 2.6, gWaveN.y));
          normal = normalize(mix(vec3(0.0, 1.0, 0.0), normal, 0.55));
        }
      `)
      .replace('#include <dithering_fragment>', /* glsl */ `
        {
          vec3 V = normalize(cameraPosition - vWWorld);
          vec3 N = normalize(normal);
          vec3 R = reflect(-V, N);
          // analytic sky: horizon band -> zenith, plus the sun's own warm lobe
          float up = clamp(R.y, 0.0, 1.0);
          vec3 skyCol = mix(uSkyHorizon, uSkyZenith, pow(up, 0.55));
          float sunLobe = pow(max(dot(R, normalize(uSunDir)), 0.0), 26.0);
          skyCol += uSunTint * sunLobe * 0.55 * uGlitter;
          // Fresnel: nearly mirror at grazing angles, mostly body colour looking straight down
          float f = 0.02 + 0.98 * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0);
          f *= 1.0 - clamp(gShore.r < 0.02 ? 0.6 : 0.0, 0.0, 1.0); // foam is not a mirror
          gl_FragColor.rgb = mix(gl_FragColor.rgb, pow(skyCol, vec3(2.2)), clamp(f, 0.0, 0.86));
          // sun glitter: a tight highlight the ripple normals shatter into moving sparks
          float spec = pow(max(dot(R, normalize(uSunDir)), 0.0), 900.0);
          gl_FragColor.rgb += pow(uSunTint, vec3(2.2)) * spec * 5.0 * uGlitter;
        }
        #include <dithering_fragment>
      `);
    applyAerialFog(shader as any);
    Object.assign(shader.uniforms, uniforms); // FOG_UNIFORMS are shared objects; keep our handles
  };
  registerCsmMaterial(material);

  const meshes: Mesh[] = [];
  for (const lake of geo.lakes) {
    const tile = tiles.get(lake.id)!;
    const n = lake.poly.length;
    const positions = new Float32Array(n * 3);
    const normals = new Float32Array(n * 3);
    const uvs = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const [x, z] = lake.poly[i];
      positions[i * 3] = x; positions[i * 3 + 1] = lake.levelGameH; positions[i * 3 + 2] = z;
      normals[i * 3 + 1] = 1;
      uvs[i * 2] = (tile.col + (x - tile.minX) / tile.spanX) / ATLAS_COLS;
      uvs[i * 2 + 1] = 1 - (tile.row + (z - tile.minZ) / tile.spanZ) / ATLAS_COLS;
    }
    let tris = earClip(lake.poly);
    // make sure the fan faces +Y (three.js: CCW in x/z gives a downward normal)
    if (tris.length >= 3) {
      const a = lake.poly[tris[0]], b = lake.poly[tris[1]], c = lake.poly[tris[2]];
      const ny = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
      if (ny < 0) { const f: number[] = []; for (let i = 0; i < tris.length; i += 3) f.push(tris[i], tris[i + 2], tris[i + 1]); tris = f; }
    }
    const bg = new BufferGeometry();
    bg.setAttribute('position', new BufferAttribute(positions, 3));
    bg.setAttribute('normal', new BufferAttribute(normals, 3));
    bg.setAttribute('aShoreUv', new BufferAttribute(uvs, 2));
    bg.setIndex(new BufferAttribute(Uint32Array.from(tris), 1));
    bg.computeBoundingSphere();
    const mesh = new Mesh(bg, material);
    mesh.name = `lake-${lake.id}`;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = -1; // before vegetation so the shore band is not overdrawn by alpha-tested cards
    group.add(mesh);
    meshes.push(mesh);
  }

  return {
    group,
    uniforms,
    update(t: number) { uniforms.uTime.value = t; },
    dispose() {
      for (const m of meshes) m.geometry.dispose();
      material.dispose();
      shoreTex.dispose();
      ripple0.dispose(); ripple1.dispose();
    },
  };
}

export type { Vector3 };
