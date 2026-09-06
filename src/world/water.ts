/**
 * Lake surfaces. One mesh per lake polygon sharing a single material (≤ 10 draw calls, usually 1–3
 * after frustum culling). Ear-clipped triangulation (the Vierwaldstättersee arms are strongly
 * concave, so a centroid fan would spill water over the land between them), a baked shore-distance
 * atlas that drives the deep→shallow colour ramp and the foam band, two counter-scrolling ripple
 * normal maps, Fresnel sky reflection and sun glitter. ARCHITECTURE.md §5.1.
 */
import {
  BufferAttribute, BufferGeometry, Color, DataTexture, FrontSide, Group, LinearFilter, Matrix4, Mesh,
  MeshStandardMaterial, PerspectiveCamera, Plane, RepeatWrapping, RGBAFormat, Scene, UnsignedByteType, Vector2, Vector3,
  Vector4, WebGLRenderer, WebGLRenderTarget,
} from 'three';
import { polygonSdf } from '@core/math';
import { buildWorldGeo, type LakePoly } from './geodata';
import { releaseAfterUpload, waterNormalTexture } from './textures';
import { registerCsmMaterial } from './shadowCsm';
import { applyAerialFog, ATMOSPHERE, FOG_UNIFORMS } from './terrainMaterial';

const TILE = 256;        // shore-atlas texels per lake
const ATLAS_COLS = 4;    // 4x4 tiles = 16 slots for 9 lakes
const ATLAS_PX = TILE * ATLAS_COLS;
const SHORE_RANGE = 130; // metres of shore distance mapped into 0..1

// ---------------------------------------------------------------------------------------------
// Wave 3 water look (flat-cyan fix): analytic-sky Fresnel + glitter gains shared by the shader
// below and the headless helpers underneath. Foam band (0.052/0.010) and ripple scroll
// (0.021/0.013) are intentionally untouched; only the sky-mix ceiling and sun gains move.
// ---------------------------------------------------------------------------------------------

export const WATER_FRESNEL_F0 = 0.04;    // was 0.02
export const WATER_FRESNEL_MAX = 0.85;   // was 0.58
export const WATER_SUN_LOBE_GAIN = 0.65; // was 0.38
export const WATER_SPEC_GAIN = 4.0;      // was 2.6
export const WATER_SUN_LOBE_POWER = 26;  // unchanged: broad warm lobe
export const WATER_SPEC_POWER = 900;     // unchanged: tight shattered spark

/** JS mirror of the body-colour ramp `mix(uShallow, uDeep, smoothstep(0.015, 0.30, depth))`. */
export function waterBodyMix(depth: number): number {
  if (!Number.isFinite(depth)) return depth > 0 ? 1 : 0;
  const t = (depth - 0.015) / (0.30 - 0.015);
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/** JS mirror of the Schlick Fresnel + foam suppression + cap. Returns 0..WATER_FRESNEL_MAX, never NaN. */
export function waterFresnelFactor(ndv: number, shoreDepth: number): number {
  const c = Number.isFinite(ndv) ? (ndv < 0 ? 0 : ndv > 1 ? 1 : ndv) : 0;
  let f = WATER_FRESNEL_F0 + (1 - WATER_FRESNEL_F0) * Math.pow(1 - c, 5);
  if (shoreDepth < 0.02) f *= 0.4; // foam is not a mirror (NaN depth compares false -> deep water)
  if (!Number.isFinite(f)) return 0;
  return f < 0 ? 0 : f > WATER_FRESNEL_MAX ? WATER_FRESNEL_MAX : f;
}

/** JS mirror of the broad sun lobe `pow(cosRH, 26)`. Returns 0..1, never NaN. */
export function waterSunLobeFactor(cosRH: number): number {
  if (!Number.isFinite(cosRH)) return 0;
  const c = cosRH < 0 ? 0 : cosRH > 1 ? 1 : cosRH;
  return Math.pow(c, WATER_SUN_LOBE_POWER);
}

/** JS mirror of the tight glitter `pow(cosRH, 900)`. Returns 0..1, never NaN. */
export function waterSunSpecFactor(cosRH: number): number {
  if (!Number.isFinite(cosRH)) return 0;
  const c = cosRH < 0 ? 0 : cosRH > 1 ? 1 : cosRH;
  return Math.pow(c, WATER_SPEC_POWER);
}

// ---------------------------------------------------------------------------------------------
// Triangulation
// ---------------------------------------------------------------------------------------------

export function signedArea(poly: [number, number][]): number {  // exported for water.test.ts
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
export function earClip(poly: [number, number][]): number[] {
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
  tex.onUpdate = () => releaseAfterUpload(tex);
  return { tex, tiles };
}

// ---------------------------------------------------------------------------------------------

export interface WaterHandle {
  group: Group;
  /** Sky writes the reflection colours here each time the sun/weather changes. */
  uniforms: Record<string, { value: any }>;
  /** HIGH quality only: half-res planar reflection. Default off (analytic sky above). */
  setReflectionEnabled(on: boolean): void;
  isReflectionEnabled(): boolean;
  update(t: number, renderer?: WebGLRenderer, scene?: Scene, camera?: PerspectiveCamera): void;
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
    tPlanar: { value: null },       // filled when planar reflection is enabled (HIGH only)
    uPlanarOn: { value: 0 },        // 0 = analytic sky, 1 = sample the reflection target
    uPlanarTexel: { value: new Vector2(1 / 512, 1 / 512) },
    uTime: { value: 0 },
    // Vierwaldstättersee/Urnersee: glacial-flour turquoise in the shallows, near-black blue-green deep.
    // Phase 6: pulled 12% darker/deeper than the flat-cyan trailer look; the lake is a mirror, not a pool.
    uShallowColor: { value: new Color(0x2e8b94) },
    uDeepColor: { value: new Color(0x0a2c3d) },
    uFoamColor: { value: new Color(0xdfeaee) },
    uWind: { value: new Vector2(0.62, 0.78) },
    ...ATMOSPHERE,
    ...FOG_UNIFORMS,
  };

  const material = new MeshStandardMaterial({
    color: 0xffffff, roughness: 0.08, metalness: 0, side: FrontSide, envMapIntensity: 1.0,
  });
  material.fog = false;
  // Phase 2 A3: HIGH-only half-res planar reflection. One shared target, no extra scene meshes
  // (water draw calls stay ≤10); the reflection pass itself re-renders the scene once.
  let reflectionOn = false;
  let reflectTarget: WebGLRenderTarget | null = null;
  const planarMatrix = new Matrix4();
  (uniforms as Record<string, { value: any }>).uPlanarMatrix = { value: planarMatrix };
  const reflectorPlane = new Plane(new Vector3(0, 1, 0), 0);
  const virtualCam = new PerspectiveCamera();
  const reflEye = new Vector3();
  const reflDir = new Vector3();
  const reflUp = new Vector3();
  const reflTarget = new Vector3();

  function ensureReflectTarget(): WebGLRenderTarget {
    if (!reflectTarget) {
      reflectTarget = new WebGLRenderTarget(960, 540);
      uniforms.tPlanar.value = reflectTarget.texture;
      uniforms.uPlanarTexel.value.set(1 / 960, 1 / 540);
    }
    return reflectTarget;
  }
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', 'uniform mat4 uPlanarMatrix;\nattribute vec2 aShoreUv;\nvarying vec2 vShoreUv;\nvarying vec3 vWWorld;\nvarying vec4 vPlanarUv;\n#include <common>')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWWorld = worldPosition.xyz;\nvShoreUv = aShoreUv;\nvPlanarUv = uPlanarMatrix * vec4(worldPosition.xyz, 1.0);');

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */ `
        uniform sampler2D tShore, tRipple0, tRipple1, tPlanar;
        uniform float uTime, uGlitter, uChop, uPlanarOn;
        uniform vec2 uPlanarTexel;
        uniform vec3 uShallowColor, uDeepColor, uFoamColor, uSkyZenith, uSkyHorizon, uSunTint;
        uniform vec2 uWind;
        varying vec3 vWWorld;
        varying vec2 vShoreUv;
        varying vec4 vPlanarUv;
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
          vec3 col = mix(uShallowColor, uDeepColor, smoothstep(0.015, 0.30, depth));
          // foam: a broken band hugging the shore, animated by the ripple field
          float band = 1.0 - smoothstep(0.0, 0.052, depth);
          float wob = gShore.g + 0.35 * sin(uTime * 0.9 + vWWorld.x * 0.09 + vWWorld.z * 0.06);
          float foam = clamp(band * smoothstep(0.34, 0.86, wob), 0.0, 1.0);
          foam += (1.0 - smoothstep(0.0, 0.010, depth)) * 0.32; // always a thin lick right at the stones
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
          // a near-horizontal reflection ray crosses 1-3 km of Urnersee and hits the far wall of the
          // valley long before it reaches the sky: reflect the mountains, not the bright horizon
          vec3 shoreRefl = mix(uDeepColor * 1.5, uSkyHorizon, 0.22);
          skyCol = mix(shoreRefl, skyCol, smoothstep(0.015, 0.20, up));
          if (uPlanarOn > 0.5) {
            // Half-res mirrored scene, projective tap; the ripple normal wobbles the lookup
            // so the mirror shimmers instead of reading as glass. Falls back to analytic sky above.
            vec2 mirrorUv = vPlanarUv.xy / max(1e-4, vPlanarUv.w);
            mirrorUv += gWaveN.xy * 0.035;
            vec3 mirror = pow(texture2D(tPlanar, mirrorUv).rgb, vec3(2.2));
            skyCol = mix(skyCol, mirror, 0.75);
          }
          float sunLobe = pow(max(dot(R, normalize(uSunDir)), 0.0), 26.0);
          skyCol += uSunTint * sunLobe * 0.65 * uGlitter;
          // Fresnel: nearly mirror at grazing angles, mostly body colour looking straight down.
          // Wave 3: F0 0.02->0.04 + cap 0.58->0.85 so a still midday lake keeps a sky tint
          // instead of collapsing to flat body cyan; foam suppression + ripple scroll untouched.
          float f = 0.04 + 0.96 * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0);
          f *= 1.0 - clamp(gShore.r < 0.02 ? 0.6 : 0.0, 0.0, 1.0); // foam is not a mirror
          gl_FragColor.rgb = mix(gl_FragColor.rgb, pow(skyCol, vec3(2.2)), clamp(f, 0.0, 0.85));
          // sun glitter: a tight highlight the ripple normals shatter into moving sparks
          float spec = pow(max(dot(R, normalize(uSunDir)), 0.0), 900.0);
          gl_FragColor.rgb += pow(uSunTint, vec3(2.2)) * spec * 4.0 * uGlitter;
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
    setReflectionEnabled(on: boolean) {
      reflectionOn = on;
      uniforms.uPlanarOn.value = on ? 1 : 0;
      if (on) ensureReflectTarget();
    },
    isReflectionEnabled() { return reflectionOn; },
    update(t: number, renderer?: WebGLRenderer, scene?: Scene, camera?: PerspectiveCamera) {
      uniforms.uTime.value = t;
      if (!reflectionOn || !renderer || !scene || !camera) return;
      renderPlanarReflection(renderer, scene, camera);
    },
    dispose() {
      for (const m of meshes) m.geometry.dispose();
      material.dispose();
      shoreTex.dispose();
      ripple0.dispose(); ripple1.dispose();
      reflectTarget?.dispose();
      reflectTarget = null;
    },
  };

  /** Reflector-style half-res planar pass on the main lake level, before the main render. */
  function renderPlanarReflection(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera): void {
    const target = ensureReflectTarget();
    // Use the first lake level as the mirror plane; other lakes differ by metres, acceptable.
    const planeY = geo.lakes.length > 0 ? geo.lakes[0].levelGameH : 0;
    if (camera.position.y < planeY) return; // below the mirror: nothing sensible to reflect
    // Mirror the camera position across y = planeY.
    reflEye.copy(camera.position);
    reflEye.y = 2 * planeY - reflEye.y;
    // Mirror the look direction (flip y) and the up vector.
    camera.getWorldDirection(reflDir);
    reflDir.y *= -1;
    reflUp.copy(camera.up);
    reflUp.y *= -1;
    virtualCam.position.copy(reflEye);
    virtualCam.up.copy(reflUp);
    virtualCam.lookAt(reflTarget.copy(reflEye).add(reflDir));
    virtualCam.fov = camera.fov;
    virtualCam.aspect = camera.aspect;
    virtualCam.near = camera.near;
    virtualCam.far = camera.far;
    virtualCam.updateProjectionMatrix();
    virtualCam.updateMatrixWorld();
    // Projective texture matrix: clip -> uv.
    planarMatrix.set(
      0.5, 0.0, 0.0, 0.5,
      0.0, 0.5, 0.0, 0.5,
      0.0, 0.0, 0.5, 0.5,
      0.0, 0.0, 0.0, 1.0,
    );
    planarMatrix.multiply(virtualCam.projectionMatrix);
    planarMatrix.multiply(virtualCam.matrixWorldInverse);
    // Oblique near-plane clip so submerged geometry does not bleed into the mirror.
    reflectorPlane.set(new Vector3(0, -1, 0), planeY + 0.003);
    const clip = new Vector4(
      reflectorPlane.normal.x, reflectorPlane.normal.y, reflectorPlane.normal.z, reflectorPlane.constant,
    ).applyMatrix4(virtualCam.matrixWorldInverse);
    const proj = virtualCam.projectionMatrix;
    proj.elements[2] -= clip.x;
    proj.elements[6] -= clip.y;
    proj.elements[10] -= clip.z + 1 - 0.003;
    proj.elements[14] -= clip.w;
    // Hide the water itself during the reflection pass.
    const wasVisible = group.visible;
    group.visible = false;
    const currentTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.render(scene, virtualCam);
    renderer.setRenderTarget(currentTarget);
    group.visible = wasVisible;
  }
}

export type { Vector3 };
