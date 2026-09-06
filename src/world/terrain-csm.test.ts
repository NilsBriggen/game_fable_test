/**
 * Phase 2 A2-core: terrain must receive real CSM shadows (USE_CSM) instead of the removed
 * uDirectScale workaround. Headless checks (no GL): defines are set, the onBeforeCompile chain
 * applies both the splat uniforms and the CSM cascade uniforms, and registered materials keep
 * distinct program-cache keys so three cannot reuse one compiled program for another material.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { Group, MeshStandardMaterial, PerspectiveCamera } from 'three';
import { CSM } from 'three/examples/jsm/csm/CSM.js';
import { setActiveCsm, registerCsmMaterial } from './shadowCsm';
import { getTerrainMaterial, disposeTerrainMaterial } from './terrainMaterial';

function makeCsm(): CSM {
  const camera = new PerspectiveCamera(55, 1, 0.5, 12000);
  const parent = new Group();
  const csm = new CSM({
    camera, parent, cascades: 3, mode: 'practical',
    shadowMapSize: 512, lightIntensity: 2.2, maxFar: 600,
    lightNear: 1, lightFar: 2000, lightMargin: 200,
  });
  (csm as unknown as { fade: boolean }).fade = true;
  return csm;
}

afterEach(() => {
  setActiveCsm(null);
  disposeTerrainMaterial();
});

describe('terrain CSM registration', () => {
  it('defines USE_CSM/CSM_CASCADES on the terrain material', () => {
    setActiveCsm(makeCsm());
    const { material } = getTerrainMaterial();
    expect(material.defines?.USE_CSM).toBe(1);
    expect(material.defines?.CSM_CASCADES).toBe(3);
  });

  it('chains onBeforeCompile: splat uniforms and CSM cascade uniforms both applied', () => {
    setActiveCsm(makeCsm());
    const { material } = getTerrainMaterial();
    const shader = { vertexShader: '#include <common>\n#include <worldpos_vertex>', fragmentShader: '#include <common>', uniforms: {} as Record<string, unknown> };
    (material.onBeforeCompile as (s: unknown, r: unknown) => void)(shader, {});
    const u = shader.uniforms as Record<string, unknown>;
    expect(u.tAlbedo).toBeDefined();        // terrain splat customization ran
    expect(u.CSM_cascades).toBeDefined();   // CSM cascade uniforms ran
    expect(u.cameraNear).toBeDefined();
    expect(u.shadowFar).toBeDefined();
  });

  it('gives registered materials distinct program-cache keys', () => {
    setActiveCsm(makeCsm());
    const { material: terrain } = getTerrainMaterial();
    const other = new MeshStandardMaterial({ color: 0xffffff });
    other.onBeforeCompile = (shader) => { (shader.uniforms as Record<string, unknown>).x = { value: 1 }; };
    registerCsmMaterial(other);
    const tKey = (terrain as unknown as { customProgramCacheKey: () => string }).customProgramCacheKey();
    const oKey = (other as unknown as { customProgramCacheKey: () => string }).customProgramCacheKey();
    expect(tKey).toContain('csm');
    expect(oKey).toContain('csm');
    expect(tKey).not.toBe(oKey);
  });

  it('is idempotent: double registration does not double-wrap onBeforeCompile', () => {
    setActiveCsm(makeCsm());
    const m = new MeshStandardMaterial({ color: 0xffffff });
    let calls = 0;
    m.onBeforeCompile = () => { calls++; };
    registerCsmMaterial(m);
    registerCsmMaterial(m);
    (m.onBeforeCompile as (s: unknown, r: unknown) => void)({ uniforms: {} }, {});
    expect(calls).toBe(1);
  });

  it('no-ops without an active CSM (materials created before sky.build)', () => {
    setActiveCsm(null);
    const m = new MeshStandardMaterial({ color: 0xffffff });
    const before = m.onBeforeCompile;
    registerCsmMaterial(m);
    expect(m.onBeforeCompile).toBe(before);
    expect(m.defines?.USE_CSM).toBeUndefined();
  });
});
