/**
 * The single terrain material. One MeshStandardMaterial, splat-blended in onBeforeCompile from three
 * CC0 PBR DataArrayTextures (8 layers) against a 2048x2176 surface-weight mask baked from the CPU
 * height model. Biplanar sampling on slopes, macro variation, live snow line, wet shores, and the
 * aerial-perspective fog that sky.ts drives (and vegetation/water share via TERRAIN_FOG_*).
 */
import { Color, DataTexture, FrontSide, LinearFilter, LinearMipmapLinearFilter, MeshStandardMaterial, RGBAFormat, UnsignedByteType, Vector2, Vector3 } from 'three';
import { MAP_BOUNDS } from '@content/gazetteer';
import { buildWorldGeo } from './geodata';
import { getTerrainArrays, macroVariationTexture, TERRAIN_LAYER } from './textures';
import { registerCsmMaterial } from './shadowCsm';
export { BLEND_GROUP } from './heightmodel';

export interface TerrainMaterialHandle {
  material: MeshStandardMaterial;
  uniforms: Record<string, { value: any }>;
}

/** Shared atmosphere uniforms; sky.ts writes them, terrain/vegetation/water read them. */
export const FOG_UNIFORMS = {
  uFogColor: { value: new Color(0xbfd2e0) },
  uFogSunColor: { value: new Color(0xffe9c4) },
  uFogDensity: { value: 0.00030 },
  uFogHeightFalloff: { value: 0.0016 },
  uFogBaseY: { value: 30 },
  uSunDir: { value: new Vector3(0.4, 0.7, 0.3) },
  uFogMax: { value: 0.96 },
};

/**
 * Shared sky-appearance uniforms. sky.ts is the only writer; water.ts (and anything else that wants
 * to reflect or tint against the current sky) reads them. Kept here rather than in sky.ts so no
 * module has to import the sky just to know what colour the air is.
 */
export const ATMOSPHERE = {
  uSkyZenith: { value: new Color(0x3f78b4) },
  uSkyHorizon: { value: new Color(0xb9d2e4) },
  uSunTint: { value: new Color(0xfff0d2) },
  uGlitter: { value: 1 },
  uChop: { value: 1 },
};

/** GLSL for the shared aerial perspective. Call applyAerialFog(shader) to inject it. */
const FOG_DECL = /* glsl */ `
uniform vec3 uFogColor, uFogSunColor, uSunDir;
uniform float uFogDensity, uFogHeightFalloff, uFogBaseY, uFogMax;
vec3 aerialPerspective(vec3 col, vec3 worldPos, vec3 viewVec) {
  float dist = length(viewVec);
  // height fog: thicker in the valleys, thin on the summits
  float hFac = exp(-max(0.0, worldPos.y - uFogBaseY) * uFogHeightFalloff);
  float amt = 1.0 - exp(-dist * uFogDensity * (0.35 + 0.65 * hFac));
  amt = clamp(amt, 0.0, uFogMax);
  // in-scattering: haze looking toward the sun is warm and bright, away from it cool blue
  float sunAmt = max(0.0, dot(normalize(viewVec), normalize(uSunDir)));
  vec3 haze = mix(uFogColor, uFogSunColor, pow(sunAmt, 3.0) * 0.85);
  return mix(col, haze, amt);
}
`;

export function applyAerialFog(shader: { vertexShader: string; fragmentShader: string; uniforms: any }): void {
  Object.assign(shader.uniforms, FOG_UNIFORMS);
  if (!shader.vertexShader.includes('vFogWorldPos')) {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', 'varying vec3 vFogWorldPos;\n#include <common>')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n#ifdef USE_INSTANCING\n  vFogWorldPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;\n#else\n  vFogWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#endif');
  }
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `varying vec3 vFogWorldPos;\n${FOG_DECL}\n#include <common>`)
    .replace('#include <dithering_fragment>', 'gl_FragColor.rgb = aerialPerspective(gl_FragColor.rgb, vFogWorldPos, vFogWorldPos - cameraPosition);\n#include <dithering_fragment>');
}

// ---------------------------------------------------------------------------------------------
// Splat mask: 7 surface weights over the whole map, baked once from the CPU surface grid.
//   A.rgba = grass, meadow, forest, rock      B.rgb = scree, mud, road
// ---------------------------------------------------------------------------------------------

/** heightmodel SURFACE_IDS index -> (mask texture 0|1, channel 0..3), or null to fall back to grass. */
const SURFACE_TO_MASK: Record<number, [0 | 1, number]> = {
  0: [0, 0],  // grass
  8: [0, 1],  // meadow
  2: [0, 2],  // forest
  1: [0, 3],  // rock
  3: [1, 0],  // scree
  5: [1, 1],  // mud
  4: [1, 1],  // water -> wet shore under the lake surface
  6: [1, 2],  // road
  7: [1, 2],  // settlement -> trampled earth
  9: [0, 0],  // snow (never baked; the shader adds it live)
};

let maskA: DataTexture | null = null;
let maskB: DataTexture | null = null;
let maskBuilt = false;

function emptyMask(): DataTexture {
  const t = new DataTexture(new Uint8Array([255, 0, 0, 0]), 1, 1, RGBAFormat, UnsignedByteType);
  t.needsUpdate = true;
  return t;
}

/** Metres of height above the lake surface over which the shore stays visibly wet. */
const SHORE_WET_M = 9;

/**
 * Coarse "which lake is nearest, and at what height does it sit" field. The nine lakes are at five
 * different levels (the Ägerisee is 97 game-metres above the Vierwaldstättersee), so a single
 * uLakeLevel scalar cannot place the wet band correctly — see requests/worldlook-1.md.
 */
function nearestLakeLevelGrid(cw: number, ch: number): Float32Array {
  const lakes = buildWorldGeo().lakes;
  const out = new Float32Array(cw * ch);
  const sx = (MAP_BOUNDS.maxX - MAP_BOUNDS.minX) / (cw - 1);
  const sz = (MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ) / (ch - 1);
  const cx: number[] = [], cz: number[] = [];
  for (const l of lakes) {
    let ax = 0, az = 0;
    for (const [x, z] of l.poly) { ax += x; az += z; }
    cx.push(ax / l.poly.length); cz.push(az / l.poly.length);
  }
  for (let gz = 0; gz < ch; gz++) {
    const wz = MAP_BOUNDS.minZ + gz * sz;
    for (let gx = 0; gx < cw; gx++) {
      const wx = MAP_BOUNDS.minX + gx * sx;
      let best = Infinity, lvl = 0;
      for (let k = 0; k < lakes.length; k++) {
        const d = (wx - cx[k]) * (wx - cx[k]) + (wz - cz[k]) * (wz - cz[k]);
        if (d < best) { best = d; lvl = lakes[k].levelGameH; }
      }
      out[gz * cw + gx] = lvl;
    }
  }
  return out;
}

/** Bake the mask from a surface-id sampler (vegetation.ts calls this once the CPU grid exists). */
export function buildSplatMask(
  surfaceIdAt: (x: number, z: number) => number,
  gridW: number,
  gridH: number,
  heightAt?: (x: number, z: number) => number,
): void {
  if (maskBuilt) return;
  maskBuilt = true;
  const n = gridW * gridH;
  const a = new Uint8Array(new ArrayBuffer(n * 4));
  const b = new Uint8Array(new ArrayBuffer(n * 4));
  const sx = (MAP_BOUNDS.maxX - MAP_BOUNDS.minX) / (gridW - 1);
  const sz = (MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ) / (gridH - 1);
  const CW = 128, CH = 136;
  const lakeLvl = heightAt ? nearestLakeLevelGrid(CW, CH) : null;
  for (let gz = 0; gz < gridH; gz++) {
    const wz = MAP_BOUNDS.minZ + gz * sz;
    const cz = Math.min(CH - 1, Math.round((gz / (gridH - 1)) * (CH - 1)));
    for (let gx = 0; gx < gridW; gx++) {
      const i = gz * gridW + gx;
      const wx = MAP_BOUNDS.minX + gx * sx;
      const slot = SURFACE_TO_MASK[surfaceIdAt(wx, wz)] ?? SURFACE_TO_MASK[0];
      (slot[0] === 0 ? a : b)[i * 4 + slot[1]] = 255;
      if (lakeLvl && heightAt) {
        // B.a = 1 right at the water line of whichever lake is nearest, 0 SHORE_WET_M above it
        const lvl = lakeLvl[cz * CW + Math.min(CW - 1, Math.round((gx / (gridW - 1)) * (CW - 1)))];
        const above = heightAt(wx, wz) - lvl;
        const wet = above < -2 ? 1 : 1 - Math.min(1, Math.max(0, above / SHORE_WET_M));
        b[i * 4 + 3] = Math.round(wet * 255);
      }
    }
  }
  const mk = (data: Uint8Array<ArrayBuffer>): DataTexture => {
    const t = new DataTexture(data, gridW, gridH, RGBAFormat, UnsignedByteType);
    t.magFilter = LinearFilter;
    t.minFilter = LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.needsUpdate = true;
    return t;
  };
  const ta = mk(a), tb = mk(b);
  if (handle) {
    handle.uniforms.tMaskA.value?.dispose?.();
    handle.uniforms.tMaskB.value?.dispose?.();
    handle.uniforms.tMaskA.value = ta;
    handle.uniforms.tMaskB.value = tb;
    handle.uniforms.uMaskTexel.value.set(1 / gridW, 1 / gridH);
  }
  maskA = ta; maskB = tb;
}

export function splatMaskReady(): boolean { return maskBuilt; }

// ---------------------------------------------------------------------------------------------

let handle: TerrainMaterialHandle | null = null;

export function getTerrainMaterial(): TerrainMaterialHandle {
  if (handle) return handle;
  const arrays = getTerrainArrays();

  const material = new MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, side: FrontSide });
  material.fog = false; // aerial perspective below replaces scene fog on the terrain

  const uniforms: Record<string, { value: any }> = {
    tAlbedo: { value: arrays.albedo },
    tNormal: { value: arrays.normal },
    tOrm: { value: arrays.orm },
    tMaskA: { value: maskA ?? emptyMask() },
    tMaskB: { value: maskB ?? emptyMask() },
    tMacro: { value: macroVariationTexture() },
    uMaskMin: { value: new Vector2(MAP_BOUNDS.minX, MAP_BOUNDS.minZ) },
    uMaskSpan: { value: new Vector2(MAP_BOUNDS.maxX - MAP_BOUNDS.minX, MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ) },
    uMaskTexel: { value: new Vector2(1 / 2048, 1 / 2176) },
    uSnowLine: { value: 900 },
    uSnowDepth: { value: 0 },      // weather: extra whitening at any altitude (0..1)
    uSeasonTint: { value: new Color(0x9fb862) },
    uAltitudeTint: { value: new Color(0xc9c58a) }, // grass drifts to this above the villages
    uWetness: { value: 0 },        // rain darkens + glosses the ground
    uLakeLevel: { value: 0 },
    uDebug: { value: 0 },   // TEMP diagnostic channel
    ...FOG_UNIFORMS,
  };

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    (material as any).userData.shaderUniforms = uniforms;

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', 'varying vec3 vWorldPos;\n#include <common>')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldPos = worldPosition.xyz;');

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */ `
        precision highp sampler2DArray;
        uniform sampler2DArray tAlbedo, tNormal, tOrm;
        uniform sampler2D tMaskA, tMaskB, tMacro;
        uniform vec2 uMaskMin, uMaskSpan, uMaskTexel;
        uniform float uSnowLine, uSnowDepth, uWetness, uLakeLevel, uDebug;
        uniform vec3 uSeasonTint, uAltitudeTint;
        varying vec3 vWorldPos;
        ${FOG_DECL}
        // metres per texture repeat, per layer (grass meadow forest rock scree snow mud road)
        const float TILE[8] = float[8](5.0, 6.0, 4.5, 7.0, 4.0, 8.0, 4.5, 4.0);
        vec3 gMapN;
        float gRough = 1.0;    // written in <map_fragment>, applied in <roughnessmap_fragment>
        vec3 gDbgAlbedo; vec3 gDbgW;
        float gSnow = 0.0;

        // Biplanar: the horizontal projection plus whichever vertical plane faces the surface.
        void planes(vec3 wp, vec3 n, float tile, out vec2 uvFlat, out vec2 uvSteep, out float steep) {
          uvFlat = wp.xz / tile;
          uvSteep = (abs(n.x) > abs(n.z)) ? vec2(wp.z, wp.y) / tile : vec2(wp.x, wp.y) / tile;
          steep = smoothstep(0.86, 0.5, n.y); // ~30deg .. ~60deg
        }
        /**
         * Detail normal around the geometric normal, with an analytic tangent frame.
         * A derivative-built frame (three's perturbNormalArb) is unusable here: the biplanar uv
         * jumps between projections from pixel to pixel, so dFdx/dFdy of it are meaningless on
         * every slope, the frame's scale explodes, and the resulting normal tips past the horizon,
         * which is why the whole terrain went to ambient-only while the trees stayed lit.
         * Perturbing around N by a bounded amount cannot flip the surface away from the sun.
         */
        vec3 perturbNormalFromMap(vec3 surfNormal, vec3 mapN, float strength) {
          vec3 N = normalize(surfNormal);
          vec3 up = abs(N.y) < 0.985 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
          vec3 T = normalize(cross(up, N));
          vec3 B = cross(N, T);
          return normalize(N + (T * mapN.x + B * mapN.y) * strength);
        }
        #include <common>
      `)
      .replace('#include <map_fragment>', /* glsl */ `
        {
          vec3 nrm = normalize(vNormal);
          vec2 muv = (vWorldPos.xz - uMaskMin) / uMaskSpan;
          vec3 macro = texture2D(tMacro, vWorldPos.xz * 0.0022).rgb;
          // warp the mask lookup by a texel so the 7.8 m grid never shows as straight edges
          muv += (macro.rg - 0.5) * uMaskTexel * 2.2;
          vec4 mA = texture2D(tMaskA, muv);
          vec4 mB = texture2D(tMaskB, muv);

          float w[8];
          w[0] = mA.r; w[1] = mA.g; w[2] = mA.b; w[3] = mA.a;
          w[4] = mB.r; w[6] = mB.g; w[7] = mB.b; w[5] = 0.0;

          // altitude drift: pasture below the villages becomes alpine meadow above them
          float alp = smoothstep(90.0, 230.0, vWorldPos.y);
          float toMeadow = w[0] * alp;
          w[0] -= toMeadow; w[1] += toMeadow;

          // snow: by altitude, softened by slope (steep faces shed snow) and by the weather override
          float slopeShed = smoothstep(0.42, 0.82, nrm.y);
          float snowAmt = clamp(smoothstep(uSnowLine - 70.0, uSnowLine + 45.0, vWorldPos.y) + uSnowDepth, 0.0, 1.0);
          snowAmt *= slopeShed * (0.72 + 0.28 * macro.b);
          float wsum = max(1e-4, w[0]+w[1]+w[2]+w[3]+w[4]+w[6]+w[7]);
          for (int i = 0; i < 8; i++) w[i] /= wsum;
          for (int i = 0; i < 8; i++) w[i] *= (1.0 - snowAmt);
          w[5] = snowAmt;

          // dominant two layers -> two taps per map instead of eight
          int i0 = 0; float w0 = -1.0;
          for (int i = 0; i < 8; i++) if (w[i] > w0) { w0 = w[i]; i0 = i; }
          int i1 = 0; float w1 = -1.0;
          for (int i = 0; i < 8; i++) if (i != i0 && w[i] > w1) { w1 = w[i]; i1 = i; }
          float blend = w1 / max(1e-4, w0 + w1);

          float t0 = TILE[i0], t1 = TILE[i1];
          vec2 f0, s0, f1, s1; float st0v, st1v;
          planes(vWorldPos, nrm, t0, f0, s0, st0v);
          planes(vWorldPos, nrm, t1, f1, s1, st1v);

          // de-tiling: the dominant layer is also sampled at 4.3x and mixed by the macro field
          vec4 a0 = mix(texture(tAlbedo, vec3(f0, float(i0))), texture(tAlbedo, vec3(f0 * 0.233, float(i0))), 0.42 * macro.r + 0.12);
          vec4 a1 = texture(tAlbedo, vec3(f1, float(i1)));
          vec3 n0 = texture(tNormal, vec3(f0, float(i0))).xyz;
          vec3 n1 = texture(tNormal, vec3(f1, float(i1))).xyz;
          vec3 o0 = texture(tOrm, vec3(f0, float(i0))).xyz;
          vec3 o1 = texture(tOrm, vec3(f1, float(i1))).xyz;
          if (st0v > 0.02) {
            a0 = mix(a0, texture(tAlbedo, vec3(s0, float(i0))), st0v);
            n0 = mix(n0, texture(tNormal, vec3(s0, float(i0))).xyz, st0v);
            o0 = mix(o0, texture(tOrm, vec3(s0, float(i0))).xyz, st0v);
            a1 = mix(a1, texture(tAlbedo, vec3(s1, float(i1))), st1v);
            n1 = mix(n1, texture(tNormal, vec3(s1, float(i1))).xyz, st1v);
          }
          vec3 albedo = mix(a0.rgb, a1.rgb, blend);
          gMapN = normalize(mix(n0, n1, blend) * 2.0 - 1.0);
          vec3 orm = mix(o0, o1, blend);

          // season / altitude tint on the two grass layers only
          float greenW = w[0] + w[1];
          vec3 tint = mix(uSeasonTint, uAltitudeTint, alp);
          albedo = mix(albedo, albedo * tint * 1.85, greenW * 0.88);

          // macro variation: large-scale luminance + hue drift so 5 m tiles vanish at 500 m
          albedo *= mix(vec3(0.78), vec3(1.22), macro.b);
          albedo = mix(albedo, albedo * vec3(1.06, 1.0, 0.9), (macro.g - 0.5) * 0.5 + 0.25);

          // shore + rain wetting: darker, smoother, slightly bluer.
          // mB.a is baked "height above the nearest lake surface" (see buildSplatMask), so this is
          // correct for the Aegerisee at +97 as well as for the Vierwaldstaettersee at 0.
          float shore = smoothstep(0.12, 0.92, mB.a);
          float wet = clamp(max(shore, uWetness) * (1.0 - snowAmt), 0.0, 1.0);
          albedo *= mix(1.0, 0.52, wet);

          diffuseColor.rgb *= pow(clamp(albedo, 0.0, 1.0), vec3(2.2)); // sRGB -> linear
          gDbgAlbedo = clamp(albedo, 0.0, 1.0); gDbgW = vec3(w[0], w[2], w[3]);
          gRough = clamp(mix(orm.y, 0.22, wet), 0.05, 1.0);
          gSnow = snowAmt;
          diffuseColor.rgb *= mix(1.0, orm.x, 0.55);                   // baked AO
        }
      `)
      .replace('#include <roughnessmap_fragment>', `
        #include <roughnessmap_fragment>
        roughnessFactor *= gRough;
      `)
      .replace('#include <normal_fragment_maps>', `
        #include <normal_fragment_maps>
        normal = perturbNormalFromMap(normal, gMapN, 0.55);
      `)
      .replace('#include <dithering_fragment>', `
        gl_FragColor.rgb = aerialPerspective(gl_FragColor.rgb, vWorldPos, vWorldPos - cameraPosition);
        if (uDebug > 0.5) {
          if (uDebug < 1.5) gl_FragColor.rgb = gDbgAlbedo;
          else if (uDebug < 2.5) gl_FragColor.rgb = normalize(vNormal) * 0.5 + 0.5;
          else if (uDebug < 3.5) gl_FragColor.rgb = normalize(normal) * 0.5 + 0.5;
          else if (uDebug < 4.5) gl_FragColor.rgb = gDbgW;
          else gl_FragColor.rgb = vec3(diffuseColor.rgb);
        }
        #include <dithering_fragment>
      `);
  };

  registerCsmMaterial(material);
  handle = { material, uniforms };
  return handle;
}

/** Layer ids, exported so vegetation/map can stay in step with the array order. */
export { TERRAIN_LAYER };

export function disposeTerrainMaterial(): void {
  if (!handle) return;
  handle.material.dispose();
  maskA?.dispose(); maskB?.dispose();
  maskA = maskB = null; maskBuilt = false;
  handle = null;
}
