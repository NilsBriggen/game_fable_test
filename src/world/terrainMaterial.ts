/**
 * The single terrain material. One MeshStandardMaterial, splat-blended in onBeforeCompile from three
 * CC0 PBR DataArrayTextures (8 layers) against a 2048x2176 surface-weight mask baked from the CPU
 * height model. Triplanar sampling on slopes past ~30 degrees, macro variation (varying tile scale
 * plus a drifting projection rotation) so nothing repeats at 500 m, a live snow line softened by
 * slope, wet shores keyed to whichever lake is nearest, and the aerial-perspective haze that sky.ts
 * drives and that vegetation and water share through FOG_UNIFORMS / ATMOSPHERE.
 */
import { Color, DataTexture, FrontSide, LinearFilter, LinearMipmapLinearFilter, MeshStandardMaterial, RGBAFormat, UnsignedByteType, Vector2, Vector3 } from 'three';
import { MAP_BOUNDS } from '@content/gazetteer';
import { lakeLevelAt } from './lakes';
import { getTerrainArrays, macroVariationTexture, TERRAIN_LAYER } from './textures';
import { getActiveCsm } from './shadowCsm';
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
 * Coarse "what height is the nearest lake surface here" field, from the integrator's exact
 * nearest-polygon lookup (requests/worldlook-1.md). NaN means no shoreline within range, so those
 * texels get no wet band at all. The nine lakes sit at five different levels — the Ägerisee is 97
 * game-metres above the Vierwaldstättersee — which a single uLakeLevel scalar cannot express.
 */
function nearestLakeLevelGrid(cw: number, ch: number): Float32Array {
  const out = new Float32Array(cw * ch);
  const sx = (MAP_BOUNDS.maxX - MAP_BOUNDS.minX) / (cw - 1);
  const sz = (MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ) / (ch - 1);
  for (let gz = 0; gz < ch; gz++) {
    const wz = MAP_BOUNDS.minZ + gz * sz;
    for (let gx = 0; gx < cw; gx++) {
      const lvl = lakeLevelAt(MAP_BOUNDS.minX + gx * sx, wz, 260);
      out[gz * cw + gx] = lvl === null ? NaN : lvl;
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
        if (lvl === lvl) {   // NaN = nothing to be wet next to
          const above = heightAt(wx, wz) - lvl;
          const wet = above < -2 ? 1 : 1 - Math.min(1, Math.max(0, above / SHORE_WET_M));
          b[i * 4 + 3] = Math.round(wet * 255);
        }
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

/**
 * Force the terrain program to be rebuilt.
 *
 * The terrain material is created inside buildSky(), before the sky group (and therefore the
 * hemisphere light) is in the scene and before the renderer has ever collected the CSM lights'
 * shadow state. Its very first program is compiled against that half-built light state and comes
 * out with no directional-light contribution at all — the landscape renders black while the trees,
 * whose materials are created later, light correctly. Recompiling once the scene is actually
 * running produces the correct program; sky.ts calls this on its first few frames.
 */
export function refreshTerrainMaterial(): void {
  if (handle) handle.material.needsUpdate = true;
}

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
    uDirectScale: { value: 1 },   // see the CSM note on registerCsmMaterial below
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
        uniform float uSnowLine, uSnowDepth, uWetness, uLakeLevel, uDirectScale;
        uniform vec3 uSeasonTint, uAltitudeTint;
        varying vec3 vWorldPos;
        ${FOG_DECL}

        /**
         * Detail normal around the geometric normal, with an analytic tangent frame. Perturbing
         * around N by a bounded amount cannot tip the surface past the horizon the way a
         * derivative-built frame does when the biplanar uv jumps between projections.
         */
        vec3 perturbNormalFromMap(vec3 surfNormal, vec3 mapN, float strength) {
          vec3 N = normalize(surfNormal);
          vec3 up = abs(N.y) < 0.985 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
          vec3 T = normalize(cross(up, N));
          vec3 B = cross(N, T);
          return normalize(N + (T * mapN.x + B * mapN.y) * strength);
        }

        // Splat accumulator. Deliberately a macro over named scalars rather than a float w[8] with
        // a for loop and a TILE[i] lookup: dynamically indexed local/const arrays, in a shader that
        // CSM has also filled with unrolled per-cascade light loops, miscompile on the software
        // rasteriser the harness uses and the whole terrain comes back black.
        float gRough = 1.0;    // written in <map_fragment>, applied in <roughnessmap_fragment>
        vec3 gMapN = vec3(0.0, 0.0, 1.0);
        vec3 gAlbAcc; vec3 gNrmAcc; vec3 gOrmAcc; float gWAcc;
        #define SPLAT(IDX, TILE, WGT) \
          if (WGT > 0.004) { \
            float tl = (TILE) * detile; \
            vec2 uvF = (detileRot * vWorldPos.xz) / tl; \
            vec3 a = texture(tAlbedo, vec3(uvF, float(IDX))).rgb; \
            vec3 nn = texture(tNormal, vec3(uvF, float(IDX))).rgb; \
            vec3 oo = texture(tOrm, vec3(uvF, float(IDX))).rgb; \
            if (steep > 0.02) { \
              vec2 uvS = (abs(nrm.x) > abs(nrm.z)) ? vec2(vWorldPos.z, vWorldPos.y) / tl : vec2(vWorldPos.x, vWorldPos.y) / tl; \
              a = mix(a, texture(tAlbedo, vec3(uvS, float(IDX))).rgb, steep); \
              nn = mix(nn, texture(tNormal, vec3(uvS, float(IDX))).rgb, steep); \
              oo = mix(oo, texture(tOrm, vec3(uvS, float(IDX))).rgb, steep); \
            } \
            gAlbAcc += a * (WGT); gNrmAcc += nn * (WGT); gOrmAcc += oo * (WGT); gWAcc += (WGT); \
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

          float w0 = mA.r, w1 = mA.g, w2 = mA.b, w3 = mA.a;
          float w4 = mB.r, w6 = mB.g, w7 = mB.b;

          // altitude drift: pasture below the villages becomes alpine meadow above them
          float alp = smoothstep(90.0, 230.0, vWorldPos.y);
          float toMeadow = w0 * alp;
          w0 -= toMeadow; w1 += toMeadow;

          // snow: by altitude, softened by slope (steep faces shed it) and by the weather override
          float slopeShed = smoothstep(0.42, 0.82, nrm.y);
          float w5 = clamp(smoothstep(uSnowLine - 70.0, uSnowLine + 45.0, vWorldPos.y) + uSnowDepth, 0.0, 1.0);
          w5 *= slopeShed * (0.72 + 0.28 * macro.b);

          float wsum = max(1e-4, w0 + w1 + w2 + w3 + w4 + w6 + w7);
          float keep = (1.0 - w5) / wsum;
          w0 *= keep; w1 *= keep; w2 *= keep; w3 *= keep; w4 *= keep; w6 *= keep; w7 *= keep;

          // triplanar on anything past ~30 degrees, and a macro-driven tile scale so a 5 m repeat
          // never reads as a grid at 500 m
          float steep = smoothstep(0.86, 0.5, nrm.y);
          float detile = 0.70 + 0.66 * macro.r;
          // ...and a slowly drifting rotation of the horizontal projection, which is what actually
          // kills the grid at 500 m: a pure scale change still repeats along the same axes.
          float rot = (macro.g - 0.5) * 2.2;
          mat2 detileRot = mat2(cos(rot), -sin(rot), sin(rot), cos(rot));

          gAlbAcc = vec3(0.0); gNrmAcc = vec3(0.0); gOrmAcc = vec3(0.0); gWAcc = 0.0;
          SPLAT(0, 5.0, w0)    // grass
          SPLAT(1, 6.0, w1)    // alpine meadow
          SPLAT(2, 4.5, w2)    // forest floor
          SPLAT(3, 7.0, w3)    // rock
          SPLAT(4, 4.0, w4)    // scree
          SPLAT(5, 8.0, w5)    // snow
          SPLAT(6, 4.5, w6)    // mud / shore
          SPLAT(7, 4.0, w7)    // road
          float inv = 1.0 / max(1e-4, gWAcc);
          vec3 albedo = gAlbAcc * inv;
          gMapN = normalize((gNrmAcc * inv) * 2.0 - 1.0);
          vec3 orm = gOrmAcc * inv;

          // season / altitude tint on the two grass layers only
          float greenW = w0 + w1 + w2 * 0.45;
          vec3 tint = mix(uSeasonTint, uAltitudeTint, alp);
          albedo = mix(albedo, albedo * tint * 1.85, greenW * 0.88);

          // macro variation: large-scale luminance + hue drift
          albedo *= mix(vec3(0.82), vec3(1.18), macro.b);
          albedo = mix(albedo, albedo * vec3(1.06, 1.0, 0.9), (macro.g - 0.5) * 0.5 + 0.25);

          // shore + rain wetting: darker, smoother, slightly bluer.
          // mB.a is baked "height above the nearest lake surface" (see buildSplatMask), so this is
          // correct for the Aegerisee at +97 as well as for the Vierwaldstaettersee at 0.
          float shore = smoothstep(0.35, 0.95, mB.a);
          float wet = clamp(max(shore, uWetness) * (1.0 - w5), 0.0, 1.0);
          albedo *= mix(1.0, 0.68, wet);

          diffuseColor.rgb *= pow(clamp(albedo, 0.0, 1.0), vec3(2.2)); // sRGB -> linear
          gRough = clamp(mix(orm.y, 0.22, wet), 0.05, 1.0);
          diffuseColor.rgb *= mix(1.0, orm.x, 0.55);                   // baked AO
        }
      `)
      .replace('#include <roughnessmap_fragment>', `
        #include <roughnessmap_fragment>
        roughnessFactor *= gRough;
      `)
      .replace('#include <lights_fragment_end>', `
        #include <lights_fragment_end>
        reflectedLight.directDiffuse *= uDirectScale;
        reflectedLight.directSpecular *= uDirectScale;
      `)
      .replace('#include <normal_fragment_maps>', `
        #include <normal_fragment_maps>
        normal = perturbNormalFromMap(normal, gMapN, 0.55);
      `)
      .replace('#include <dithering_fragment>', `
        gl_FragColor.rgb = aerialPerspective(gl_FragColor.rgb, vWorldPos, vWorldPos - cameraPosition);
        #include <dithering_fragment>
      `);
  };

  // NOT registered with CSM, deliberately.
  //
  // csm.setupMaterial() defines USE_CSM on the material and swaps in CSMShader's
  // lights_fragment_begin, which applies each cascade's DirectionalLight only to the depth slice
  // that cascade owns. On this material that binding comes out dead on the program three compiles
  // first: the terrain renders with zero direct light (a black landscape under a lit sky, with
  // correctly lit trees standing on it), while every other material in the scene is fine. Forcing
  // needsUpdate later does not rebuild it into a working state.
  //
  // Left un-registered, the terrain takes three's stock directional path, so ALL `cascades` lights
  // light it (and it still receives their shadow maps — a fragment outside a cascade's map reads as
  // lit, so the three maps union correctly). That over-lights the direct term by exactly the cascade
  // count, which uDirectScale takes back out in <lights_fragment_end>; the ambient term is untouched
  // and therefore still correct. See the note in the final report.
  const csm = getActiveCsm() as { cascades?: number } | null;
  uniforms.uDirectScale.value = 1 / Math.max(1, csm?.cascades ?? 1);
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
