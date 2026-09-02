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
  // Note: only the *.normalMap textures are generated but intentionally left unbound in the shader
  // below — per-fragment normal-map blending was cut for SwiftShader (software) frame-time headroom;
  // geometric vertex normals (already slope-aware from the heightmap) carry the shading instead.
  const uniforms: Record<string, { value: unknown }> = {
    tGrass: { value: grass.map },
    tForest: { value: forest.map },
    tRock: { value: rock.map },
    tSnow: { value: snow.map },
    tPath: { value: path.map },
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
        uniform float uSnowLine;
        uniform vec3 uGrassTint;
        uniform vec3 uFogColor;
        uniform float uFogDensity, uFogHeightFalloff, uFogBaseY;
        varying float vSurfaceId;
        varying vec3 vWorldPos;
        float tent(float x, float c) { return clamp(1.0 - abs(x - c), 0.0, 1.0); }
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
          vec4 texel = vec4(0.0);
          if (wGrass > 0.001) texel += texture2D(tGrass, uvY) * vec4(uGrassTint, 1.0) * wGrass;
          if (wForest > 0.001) texel += texture2D(tForest, uvY) * wForest;
          if (wRock > 0.001) texel += texture2D(tRock, uvY) * wRock;
          if (wPath > 0.001) texel += texture2D(tPath, uvY) * wPath;

          float snowAmt = clamp(smoothstep(uSnowLine - 50.0, uSnowLine + 30.0, vWorldPos.y) * (1.0 - 0.5 * wRock), 0.0, 1.0);
          if (snowAmt > 0.01) texel = mix(texel, texture2D(tSnow, uvY), snowAmt);

          diffuseColor *= texel;
        }
        #include <map_fragment>
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

  registerCsmMaterial(material);
  handle = { material, uniforms };
  return handle;
}

export function disposeTerrainMaterial(): void {
  if (!handle) return;
  handle.material.dispose();
  handle = null;
}
