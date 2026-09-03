/**
 * The single terrain material. One MeshStandardMaterial, splat-blended in onBeforeCompile from
 * three CC0 PBR DataArrayTextures (9 layers) against the two surface-weight masks baked in
 * `look/splat.ts`. Triplanar on slopes, macro variation so nothing repeats at 500 m, an analytic
 * near-field detail noise so nothing is flat at 3 m either, a live snow line softened by slope, wet
 * shores keyed to whichever lake is nearest, and the aerial-perspective haze that sky.ts drives and
 * that vegetation and water share through FOG_UNIFORMS / ATMOSPHERE.
 *
 * The two things that make the *ground* read rather than just be textured:
 *
 *  * **Roads and yards are reconstructed, not painted.** The mask is 7.8 m per texel; a cart track
 *    is 3 m wide. `look/splat.ts` stores distance-to-road and a smooth village-pad falloff instead of
 *    a road/settlement weight, and the shader thresholds them per pixel — so a track is crisp at any
 *    zoom, its width breathes, grass creeps raggedly back into the yard, and the lane entering a
 *    village is a lane instead of a 7.8 m staircase of gravel.
 *  * **Slope wins over classification.** A 45° face is limestone whatever the height model called
 *    it. Without that, every cliff in the Axen and the Schöllenen wore stretched pasture.
 */
import { Color, DataTexture, FrontSide, MeshStandardMaterial, RGBAFormat, UnsignedByteType, Vector2, Vector3 } from 'three';
import { MAP_BOUNDS } from '@content/gazetteer';
import { getTerrainArrays, macroVariationTexture, TERRAIN_LAYER } from './textures';
import { bakeSplatMasks, ROAD_RANGE, type SplatMasks } from './look/splat';
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

/**
 * Analytic value noise. Deliberately not another texture lookup: the near-field grain needs
 * features of a few centimetres AND no visible repeat, and a 256² tile driven at that frequency
 * repeats every ~2 m, which is precisely the "visible tiling at 3 m" this is here to kill.
 */
const NOISE_DECL = /* glsl */ `
float hash21(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
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
// Splat mask (baked in look/splat.ts; see the channel contract there)
// ---------------------------------------------------------------------------------------------

let masks: SplatMasks | null = null;
let maskBuilt = false;

/** All-zero placeholder: every weight 0 means the derived grass channel is 1, so the terrain is
 *  pasture until the real mask bakes. Left on the DataTexture default NEAREST filters on purpose —
 *  a mip filter on a texture with no mip chain is an incomplete texture and samples black. */
function emptyMask(): DataTexture {
  const t = new DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, RGBAFormat, UnsignedByteType);
  t.needsUpdate = true;
  return t;
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
  const next = bakeSplatMasks(surfaceIdAt, gridW, gridH, heightAt);
  masks?.a.dispose();
  masks?.b.dispose();
  masks = next;
  if (handle) {
    handle.uniforms.tMaskA.value = next.a;
    handle.uniforms.tMaskB.value = next.b;
    handle.uniforms.uMaskTexel.value.set(1 / gridW, 1 / gridH);
  }
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
    tMaskA: { value: masks?.a ?? emptyMask() },
    tMaskB: { value: masks?.b ?? emptyMask() },
    tMacro: { value: macroVariationTexture() },
    uMaskMin: { value: new Vector2(MAP_BOUNDS.minX, MAP_BOUNDS.minZ) },
    uMaskSpan: { value: new Vector2(MAP_BOUNDS.maxX - MAP_BOUNDS.minX, MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ) },
    uMaskTexel: { value: new Vector2(1 / 2048, 1 / 2176) },
    uRoadRange: { value: ROAD_RANGE },
    uSnowLine: { value: 900 },
    uSnowDepth: { value: 0 },      // weather: extra whitening at any altitude (0..1)
    uSeasonTint: { value: new Color(0x9fb862) },
    uAltitudeTint: { value: new Color(0xa8bc78) }, // pasture drifts to this alpine sage above the villages
    uWetness: { value: 0 },        // rain darkens + glosses the ground
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
        uniform float uSnowLine, uSnowDepth, uWetness, uDirectScale, uRoadRange;
        uniform vec3 uSeasonTint, uAltitudeTint;
        varying vec3 vWorldPos;
        ${FOG_DECL}
        ${NOISE_DECL}

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

        // Splat accumulator. Deliberately a macro over named scalars rather than a float w[9] with
        // a for loop and a TILE[i] lookup: dynamically indexed local/const arrays, in a shader that
        // CSM has also filled with unrolled per-cascade light loops, miscompile on the software
        // rasteriser the harness uses and the whole terrain comes back black.
        //
        // De-tiling is a macro-driven TRANSLATION plus a blend of two fixed scales, never a
        // per-pixel rotation or scale of the world position. World x/z reach 8 000 here, so any
        // per-pixel factor applied to them lands in the uv derivative multiplied by 8 000, the
        // hardware picks the coarsest mip, and every slope smears into long streaks.
        float gRough = 1.0;    // written in <map_fragment>, applied in <roughnessmap_fragment>
        vec3 gMapN = vec3(0.0, 0.0, 1.0);
        vec3 gAlbAcc; vec3 gNrmAcc; vec3 gOrmAcc; float gWAcc;
        #define SPLAT(IDX, TILE, WGT) \
          if (WGT > 0.004) { \
            vec2 uvF = vWorldPos.xz / (TILE) + detileOff; \
            vec3 a = mix(texture(tAlbedo, vec3(uvF, float(IDX))).rgb, \
                         texture(tAlbedo, vec3(uvF * 0.237 + 3.71, float(IDX))).rgb, detileMix); \
            vec3 nn = texture(tNormal, vec3(uvF, float(IDX))).rgb; \
            vec3 oo = texture(tOrm, vec3(uvF, float(IDX))).rgb; \
            if (steep > 0.02) { \
              vec2 uvS = ((abs(nrm.x) > abs(nrm.z)) ? vec2(vWorldPos.z, vWorldPos.y) : vec2(vWorldPos.x, vWorldPos.y)) / (TILE) + detileOff; \
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
          float viewDist = length(vWorldPos - cameraPosition);
          vec2 muv = (vWorldPos.xz - uMaskMin) / uMaskSpan;
          vec3 macro = texture2D(tMacro, vWorldPos.xz * 0.0022).rgb;
          // warp the mask lookup by a texel so the 7.8 m grid never shows as straight edges
          muv += (macro.rg - 0.5) * uMaskTexel * 2.2;
          vec4 mA = texture2D(tMaskA, muv);
          vec4 mB = texture2D(tMaskB, muv);

          // Near-field grain: a 30 cm octave out to 60 m and a 12 cm one only in the first few
          // metres. The fine octave has to die that fast — once one pixel covers more than its
          // feature size it stops being detail and starts being noise that crawls when you walk.
          // Distance alone is the wrong fade for the analytic grain below. A slope seen at a grazing
          // angle is close to the camera AND covers metres of ground per pixel, and un-mipmapped
          // noise sampled at that rate aliases into long streaks running away from the viewer —
          // which is exactly what the Rütli bank and the Schwyz square were doing. Fade by the real
          // screen-space footprint instead, so the grain switches off the moment one pixel is wider
          // than the features it is trying to draw.
          float foot = max(fwidth(vWorldPos.x), fwidth(vWorldPos.z));   // metres of ground per pixel
          float nearK = (1.0 - smoothstep(10.0, 60.0, viewDist)) * (1.0 - smoothstep(0.07, 0.22, foot));
          float fineK = (1.0 - smoothstep(3.0, 16.0, viewDist)) * (1.0 - smoothstep(0.025, 0.075, foot));
          // grainC drives the track width and the yard edge, so it is needed at any range; the two
          // fine octaves are only ever weighted by nearK/fineK, so past 60 m they are pure cost.
          float grainC = vnoise(vWorldPos.xz * 0.55);
          float grainA = 0.5, grainB = 0.5;
          if (nearK > 0.01) {
            grainA = vnoise(vWorldPos.xz * 3.1);
            grainB = fineK > 0.01 ? vnoise(vWorldPos.xz * 8.3) : 0.5;
          }

          float w1 = mA.r;   // alpine meadow
          float w2 = mA.g;   // forest floor
          float w3 = mA.b;   // rock
          float w4 = mA.a;   // scree
          float w6 = mB.r;   // mud / wet shore
          float yardF = mB.g;                          // smooth village-pad falloff, 1 at the centre
          float roadDist = (1.0 - mB.b) * uRoadRange;  // metres to the nearest road centreline
          float roadVergeMax = 11.0;   // beyond this no verge/track can exist, so skip the noise

          // ---- cart track, reconstructed from the distance field ----------------------------
          // The width breathes between ~1.8 and ~3.6 m along the road, so it reads as something worn
          // by carts rather than surveyed. The verge is the wider band of scuffed ground beside it.
          float halfW = 2.7 + (grainC - 0.5) * 1.7 + (macro.g - 0.5) * 0.8;
          float w8 = 1.0 - smoothstep(halfW, halfW + 1.6, roadDist);
          float verge = (1.0 - smoothstep(halfW + 1.2, halfW + 6.0, roadDist)) * (0.45 + 0.35 * grainC);

          // ---- village yard: grass creeps raggedly back in at the edges ----------------------
          // Only villages and road verges need the second yard octave; everywhere else (which is
          // almost the whole map) the branch is skipped.
          float yardNoise = 0.5;
          if (yardF > 0.002 || roadDist < roadVergeMax) yardNoise = grainC * 0.65 + vnoise(vWorldPos.xz * 0.17) * 0.35;
          float w7 = yardF * smoothstep(0.10, 0.62, yardF + (yardNoise - 0.5) * 0.62);
          w7 = max(w7, verge);
          // hollows in the yard hold dung and rainwater; the same field, thresholded high
          float puddle = smoothstep(0.66, 0.86, yardNoise) * w7 * 0.85;
          w6 = max(w6, puddle);
          w7 = max(0.0, w7 - puddle);
          w7 = max(0.0, w7 - w8);

          // Altitude drift: pasture below the villages becomes alpine meadow above them. The band
          // starts well above the valley floors — at 90 m it caught the Seelisberg terrace and every
          // slope above Brunnen, and turned the whole middle distance the colour of dead hay.
          float alp = smoothstep(160.0, 330.0, vWorldPos.y);

          // ---- slope wins over classification ------------------------------------------------
          // A 40-60 degree face is bare limestone whatever the height model called it; below that a
          // band of loose scree collects. Without this every cliff wore stretched pasture.
          float rockify = smoothstep(0.78, 0.52, nrm.y);
          float screeify = smoothstep(0.90, 0.74, nrm.y) * (1.0 - rockify) * 0.75;
          float soften = 1.0 - max(rockify, screeify);
          w1 *= soften; w2 *= soften; w6 *= soften; w7 *= soften; w8 *= soften;
          w3 = max(w3 * soften, rockify);
          w4 = max(w4 * soften, screeify);

          // Trodden ground REPLACES what was there rather than blending with it. Without this the
          // splat normalises a forest road to 1 part litter, 1 part track and the lane disappears
          // into the wood it runs through.
          float trodden = clamp(max(w7, w8), 0.0, 1.0);
          float keepNat = 1.0 - trodden * 0.92;
          w1 *= keepNat; w2 *= keepNat; w3 *= keepNat; w4 *= keepNat; w6 *= keepNat;

          // grass is the remainder: seven weights plus wetness do not fit in eight channels, and
          // they sum to one, so this is the one that never had to be stored
          float used = w1 + w2 + w3 + w4 + w6 + w7 + w8;
          float w0 = max(0.0, 1.0 - used);
          float toMeadow = w0 * alp;
          w0 -= toMeadow; w1 += toMeadow;

          // snow: by altitude, softened by slope (steep faces shed it) and by the weather override.
          // The line itself is ragged — a straight contour of snow across a whole massif is the
          // single most artificial thing a mountain can do.
          float slopeShed = smoothstep(0.42, 0.82, nrm.y);
          float lineWobble = (macro.b - 0.5) * 90.0 + (grainC - 0.5) * 18.0;
          float w5 = clamp(smoothstep(uSnowLine - 70.0 + lineWobble, uSnowLine + 45.0 + lineWobble, vWorldPos.y) + uSnowDepth, 0.0, 1.0);
          w5 *= slopeShed * (0.72 + 0.28 * macro.b);

          float wsum = max(1e-4, w0 + w1 + w2 + w3 + w4 + w6 + w7 + w8);
          float keep = (1.0 - w5) / wsum;
          w0 *= keep; w1 *= keep; w2 *= keep; w3 *= keep; w4 *= keep; w6 *= keep; w7 *= keep; w8 *= keep;

          // Triplanar. The weight follows 1 - n.y^3 rather than a smoothstep band, so a 20 degree
          // bank already takes 15% of the side projection and a 45 degree one two thirds of it —
          // the flat projection stretches as 1/n.y, and letting it run alone up to ~35 degrees is
          // what smeared the meadow banks above the Urnersee into vertical streaks.
          // The 0.12 floor matters for cost, not looks: the SPLAT macro skips its three extra
          // projected samples entirely when steep is 0, so leaving a hair of side projection on the
          // valley floors (where 1 - n.y^3 is 0.02-0.10) would triple the texture fetches of every
          // flat fragment in the game for a stretch of 1.001x that nobody can see.
          float ny = max(nrm.y, 0.0);
          float steep = clamp((1.0 - ny * ny * ny) * 1.14 - 0.14, 0.0, 1.0);
          // De-tiling, both derivative-safe: a low-frequency uv shift (a translation leaves the uv
          // derivative untouched) and a blend with the same layer sampled 4.2x larger.
          vec2 detileOff = (macro.rg - 0.5) * 9.0;
          float detileMix = 0.30 + 0.30 * macro.r;

          gAlbAcc = vec3(0.0); gNrmAcc = vec3(0.0); gOrmAcc = vec3(0.0); gWAcc = 0.0;
          SPLAT(0, 5.0, w0)    // grass
          SPLAT(1, 6.0, w1)    // alpine meadow
          SPLAT(2, 4.5, w2)    // forest floor
          SPLAT(3, 7.0, w3)    // limestone
          SPLAT(4, 3.2, w4)    // scree
          SPLAT(5, 8.0, w5)    // snow
          SPLAT(6, 4.0, w6)    // mud / shore
          SPLAT(7, 3.4, w7)    // village yard
          SPLAT(8, 2.6, w8)    // cart track
          float inv = 1.0 / max(1e-4, gWAcc);
          vec3 albedo = gAlbAcc * inv;
          gMapN = normalize((gNrmAcc * inv) * 2.0 - 1.0);
          vec3 orm = gOrmAcc * inv;

          // season / altitude tint: both pasture layers, and the forest floor at 4/5 weight so a
          // wood turns with the season too
          float greenW = w0 + w1 + w2 * 0.8;
          vec3 tint = mix(uSeasonTint, uAltitudeTint, alp);
          albedo = mix(albedo, albedo * tint * 1.85, greenW * 0.88);

          // A spruce stand seen from across the Urnersee has to read as forest between the trunks,
          // not as the bare litter texture. Desaturate the litter first and only then tint it toward
          // the canopy: multiplying a warm brown by a green just gives a duller warm brown, which is
          // how the wooded slopes ended up the colour of ploughed earth.
          float litterLum = dot(albedo, vec3(0.30, 0.59, 0.11));
          albedo = mix(albedo, mix(albedo, vec3(litterLum), 0.55) * vec3(0.52, 0.66, 0.44), w2 * 0.82);

          // limestone is grey-white, not the green-grey the season tint would drag it toward, and a
          // cliff face is brighter on its bedding ledges than in the joints
          albedo = mix(albedo, albedo * vec3(1.06, 1.05, 1.02) * (0.86 + 0.30 * grainC), w3 * 0.7);

          // The yard set (Ground081) is a pale grey-beige path gravel out of the box; a village
          // trodden by cattle and emptied of chamber pots is browner and duller than that.
          albedo = mix(albedo, albedo * vec3(0.84, 0.77, 0.63), w7 * 0.75);
          // the track is packed and darker than the yard it cuts through
          albedo *= mix(1.0, 0.74 + 0.16 * grainA, w8 * 0.9);

          // old snow is not white paper: cool it, and keep the macro field visible through it so a
          // snowfield still reads as a surface with form rather than a blown-out sheet
          albedo = mix(albedo, albedo * vec3(0.90, 0.94, 1.03) * (0.86 + 0.20 * macro.b), w5 * 0.9);

          // macro variation: large-scale luminance + hue drift
          albedo *= mix(vec3(0.82), vec3(1.18), macro.b);
          albedo = mix(albedo, albedo * vec3(1.06, 1.0, 0.9), (macro.g - 0.5) * 0.5 + 0.25);

          // near-field grain: without it every ground layer is a smooth wash within a few metres of
          // the camera whatever its texture resolution, because one 512px tile covers 3-5 m
          albedo *= mix(1.0, 0.82 + 0.38 * grainA, nearK * 0.85) * mix(1.0, 0.86 + 0.28 * grainB, fineK * 0.7);
          if (nearK > 0.02) {
            // central-difference gradient of the same field, so the bumps the shading shows line up
            // with the bumps the albedo shows instead of being an unrelated wobble
            vec2 pn = vWorldPos.xz * 3.1;
            float gx = vnoise(pn + vec2(0.7, 0.0)) - vnoise(pn - vec2(0.7, 0.0));
            float gz = vnoise(pn + vec2(0.0, 0.7)) - vnoise(pn - vec2(0.0, 0.7));
            gMapN.xy += vec2(gx, gz) * nearK * 1.1;
            gMapN = normalize(gMapN);
          }

          // shore + rain wetting: darker, smoother, slightly bluer.
          // mB.a is baked "height above the nearest lake surface" (see look/splat.ts), so this is
          // correct for the Aegerisee at +97 as well as for the Vierwaldstaettersee at 0.
          float shore = smoothstep(0.35, 0.95, mB.a);
          float wet = clamp(max(shore, uWetness) * (1.0 - w5), 0.0, 1.0);
          albedo *= mix(1.0, 0.68, wet);

          diffuseColor.rgb *= pow(clamp(albedo, 0.0, 1.0), vec3(2.2)); // sRGB -> linear
          gRough = clamp(mix(orm.y, 0.42, wet), 0.05, 1.0);   // wet earth is damp, not a mirror
          gRough = mix(gRough, gRough * 0.86, w8);            // a packed track has a slight sheen
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
        normal = perturbNormalFromMap(normal, gMapN, 0.62);
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
  // that cascade owns. On this material, inside the full scene, that binding comes out dead: the
  // terrain renders with zero direct light (a black landscape under a lit sky, with correctly lit
  // trees standing on it) while every other material is fine. Measured, not guessed — deleting
  // USE_CSM from the live material at runtime restores the light immediately, and forcing
  // needsUpdate does not. Reproducing it outside the app (this same material, this same CSM
  // configuration, a bare scene) does NOT fail, so the trigger is something about the full scene's
  // material and light set that I could not isolate; hence a workaround rather than a fix.
  //
  // Left un-registered, the terrain takes three's stock directional path, so ALL `cascades` lights
  // light it (and it still receives their shadow maps — a fragment outside a cascade's map reads as
  // lit, so the three maps union correctly). That over-lights the direct term by exactly the cascade
  // count, which uDirectScale takes back out in <lights_fragment_end>; the ambient term is untouched
  // and therefore still correct. The one cost is that a shadow cast onto the terrain only darkens
  // the cascade that owns it, i.e. roughly a third of the direct term, so tree shadows on the ground
  // are softer than they should be. Called out in the final report as a known gap.
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
  masks?.a.dispose(); masks?.b.dispose();
  masks = null; maskBuilt = false;
  handle = null;
}
