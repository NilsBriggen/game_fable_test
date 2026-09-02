/**
 * The single terrain MeshStandardMaterial, splat-blended via onBeforeCompile from procedural
 * textures. Vertex `surfaceId` (chunkmesh.ts) is pre-remapped on the CPU into 4 broad blend groups
 * (grass, forest, rock/scree, path) so GPU interpolation between adjacent triangles blends sensibly;
 * snow is layered on top live, by height + season, so the bake never needs to change with the seasons.
 */
import { Color, DoubleSide, MeshStandardMaterial } from 'three';
import { getTerrainTexture } from './textures';
import { registerCsmMaterial } from './shadowCsm';
export { BLEND_GROUP } from './heightmodel';

export interface TerrainMaterialHandle {
  material: MeshStandardMaterial;
  uniforms: Record<string, { value: unknown }>;
}

let handle: TerrainMaterialHandle | null = null;

export function getTerrainMaterial(): TerrainMaterialHandle {
  if (handle) return handle;
  const grass = getTerrainTexture('grass');
  const forest = getTerrainTexture('forest');
  const rock = getTerrainTexture('rock');
  const snow = getTerrainTexture('snow');
  const path = getTerrainTexture('road');

  const material = new MeshStandardMaterial({ color: new Color(0xffffff), roughness: 1, metalness: 0, side: DoubleSide });
  const uniforms: Record<string, { value: unknown }> = {
    tGrass: { value: grass.map },
    tForest: { value: forest.map },
    tRock: { value: rock.map },
    tSnow: { value: snow.map },
    tPath: { value: path.map },
    tGrassN: { value: grass.normalMap },
    tForestN: { value: forest.normalMap },
    tRockN: { value: rock.normalMap },
    tSnowN: { value: snow.normalMap },
    tPathN: { value: path.normalMap },
    uSnowLine: { value: 900 },
    uGrassTint: { value: new Color(0x9fb862) },
    uFogColor: { value: new Color(0xbfd2e0) },
    uFogDensity: { value: 0.00012 },
    uFogHeightFalloff: { value: 0.0022 },
    uFogBaseY: { value: 40 },
  };

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    for (const k of Object.keys(uniforms)) (material as any).userData.shaderUniforms = uniforms;

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `attribute float surfaceId;\nvarying float vSurfaceId;\nvarying vec3 vWorldPos;\n#include <common>`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvSurfaceId = surfaceId;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\nvWorldPos = worldPosition.xyz;`);

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `
        uniform sampler2D tGrass, tForest, tRock, tSnow, tPath;
        uniform sampler2D tGrassN, tForestN, tRockN, tSnowN, tPathN;
        uniform float uSnowLine;
        uniform vec3 uGrassTint;
        uniform vec3 uFogColor;
        uniform float uFogDensity, uFogHeightFalloff, uFogBaseY;
        varying float vSurfaceId;
        varying vec3 vWorldPos;
        float tent(float x, float c) { return clamp(1.0 - abs(x - c), 0.0, 1.0); }
        // Triplanar blend weights from the geometric normal (rock/scree only — see map_fragment below):
        // a single xz projection is what produced the vertical streaking on every cliff face in every
        // scenario screenshot; blending the xz/xy/zy projections by |normal| fixes vertical surfaces.
        vec3 triplanarWeights(vec3 n) {
          vec3 a = pow(abs(n), vec3(4.0));
          return a / max(1e-5, a.x + a.y + a.z);
        }
        vec4 sampleTriplanar(sampler2D tex, vec3 wp, vec3 n, float scale) {
          vec3 w = triplanarWeights(n);
          vec4 cx = texture2D(tex, wp.zy * scale);
          vec4 cy = texture2D(tex, wp.xz * scale);
          vec4 cz = texture2D(tex, wp.xy * scale);
          return cx * w.x + cy * w.y + cz * w.z;
        }
        // Standard tangent-space normal-map perturbation from screen-space derivatives (three.js's own
        // perturbNormal2Arb technique) — lets a single planar UV carry a bound normal map without a
        // precomputed tangent attribute, which the terrain geometry (chunkmesh.ts) doesn't bake.
        vec3 perturbNormalFromMap(vec3 eyePos, vec3 surfNormal, vec2 uv, vec3 mapN) {
          vec3 q0 = dFdx(eyePos), q1 = dFdy(eyePos);
          vec2 st0 = dFdx(uv), st1 = dFdy(uv);
          vec3 N = surfNormal;
          vec3 q1perp = cross(q1, N), q0perp = cross(N, q0);
          vec3 T = q1perp * st0.x + q0perp * st1.x;
          vec3 B = q1perp * st0.y + q0perp * st1.y;
          float det = max(dot(T, T), dot(B, B));
          float scale = det == 0.0 ? 0.0 : inversesqrt(det);
          return normalize(T * (mapN.x * scale) + B * (mapN.y * scale) + N * mapN.z);
        }
        vec2 gTerrainUv;
        vec3 gTerrainMapN;
        #include <common>
        `,
      )
      .replace(
        '#include <map_fragment>',
        `
        {
          // Adjacent categories in the 0..3 blend-group scale are the only ones that can be
          // simultaneously non-zero (tent() has support width 1), so at most two texture2D calls
          // are needed here (plus a conditional snow overlay) -- kept branchy on purpose: this
          // material also has to run acceptably on the harness's software (SwiftShader) rasteriser.
          float wGrass = tent(vSurfaceId, 0.0);
          float wForest = tent(vSurfaceId, 1.0);
          float wRock = tent(vSurfaceId, 2.0);
          float wPath = tent(vSurfaceId, 3.0);
          float sum = max(1e-4, wGrass + wForest + wRock + wPath);
          wGrass /= sum; wForest /= sum; wRock /= sum; wPath /= sum;

          vec2 uvY = vWorldPos.xz / 40.0;
          gTerrainUv = uvY;
          vec3 nrm = normalize(vNormal);
          vec4 texel = vec4(0.0);
          vec3 mapN = vec3(0.0);
          if (wGrass > 0.001) { texel += texture2D(tGrass, uvY) * vec4(uGrassTint, 1.0) * wGrass; mapN += (texture2D(tGrassN, uvY).xyz * 2.0 - 1.0) * wGrass; }
          if (wForest > 0.001) { texel += texture2D(tForest, uvY) * wForest; mapN += (texture2D(tForestN, uvY).xyz * 2.0 - 1.0) * wForest; }
          if (wRock > 0.001) { texel += sampleTriplanar(tRock, vWorldPos, nrm, 1.0 / 40.0) * wRock; mapN += (texture2D(tRockN, uvY).xyz * 2.0 - 1.0) * wRock; }
          if (wPath > 0.001) { texel += texture2D(tPath, uvY) * wPath; mapN += (texture2D(tPathN, uvY).xyz * 2.0 - 1.0) * wPath; }

          float snowAmt = clamp(smoothstep(uSnowLine - 50.0, uSnowLine + 30.0, vWorldPos.y) * (1.0 - 0.5 * wRock), 0.0, 1.0);
          if (snowAmt > 0.01) {
            texel = mix(texel, texture2D(tSnow, uvY), snowAmt);
            mapN = mix(mapN, texture2D(tSnowN, uvY).xyz * 2.0 - 1.0, snowAmt);
          }
          gTerrainMapN = length(mapN) > 1e-4 ? normalize(mapN) : vec3(0.0, 0.0, 1.0);

          diffuseColor *= texel;
        }
        #include <map_fragment>
        `,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `
        #include <normal_fragment_maps>
        normal = perturbNormalFromMap(-vViewPosition, normal, gTerrainUv, gTerrainMapN);
        `,
      )
      .replace(
        '#include <dithering_fragment>',
        `
        {
          float dist = length(vViewPosition);
          float heightFactor = exp(-max(0.0, uFogBaseY - vWorldPos.y) * uFogHeightFalloff);
          float fogAmt = 1.0 - exp(-dist * uFogDensity * (0.4 + heightFactor));
          gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogColor, clamp(fogAmt, 0.0, 0.85));
        }
        #include <dithering_fragment>
        `,
      );
  };

  // Terrain now participates in CSM shadow receiving (see terrain.ts's mesh.receiveShadow=true): the
  // earlier "always renders black" symptom that led to opting out was a camera-inside-mountain bug
  // (heightmodel.ts peak fix), not a CSM shader-path bug.
  registerCsmMaterial(material);
  handle = { material, uniforms };
  return handle;
}

export function disposeTerrainMaterial(): void {
  if (!handle) return;
  handle.material.dispose();
  handle = null;
}
