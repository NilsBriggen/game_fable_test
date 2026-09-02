/**
 * World module entry point: registers WorldService (ARCHITECTURE.md §4, §5.1).
 * Owns terrain streaming, water, sky/weather/season, vegetation, the procedural model library and
 * the top-down map image. Uses ctx.gfx.renderer/scene/camera created by core.
 */
import { Group, Vector3, type Object3D, type PerspectiveCamera, type Scene, type WebGLRenderer } from 'three';
import type { GameContext } from '@core/context';
import type { InstanceHandle, SurfaceType, TransformLike, Weather, WorldService } from '@core/services';
import type { Rng } from '@core/rng';
import type { RegionDef } from '@core/schemas';
import { pointInPolygon } from '@core/math';

import { TerrainManager } from './terrain';
import { VegetationManager } from './vegetation';
import { buildWater, type WaterHandle } from './water';
import { buildSky, type SkyHandle } from './sky';
import { ModelLibrary } from './models';
import { renderMapImage, worldToMapUv } from './map';
import { getTerrainMaterial } from './terrainMaterial';

const STREAM_CORE_RADIUS = 1100;

export async function register(ctx: GameContext): Promise<void> {
  const { renderer, scene, camera } = ctx.gfx;

  const terrainRoot = new Group(); terrainRoot.name = 'terrain-root';
  const propsRoot = new Group(); propsRoot.name = 'props-root';
  const waterRoot = new Group(); waterRoot.name = 'water-root';
  const dynamicRoot = new Group(); dynamicRoot.name = 'dynamic-root';
  scene.add(terrainRoot, propsRoot, waterRoot, dynamicRoot);

  // Sky/CSM must exist before any material is built, so every material factory can register for CSM.
  const sky: SkyHandle = buildSky(scene, camera, renderer);
  scene.add(sky.group);

  const terrain = new TerrainManager(ctx.seed);
  terrainRoot.add(terrain.group);
  await terrain.ready;

  const water: WaterHandle = buildWater();
  waterRoot.add(water.group);

  const vegetation = new VegetationManager(ctx.seed, terrain);
  propsRoot.add(vegetation.group);

  const models = new ModelLibrary(ctx.seed);

  let weather: Weather = 'clear';
  let season: 'winter' | 'spring' | 'summer' | 'autumn' = ctx.clock.season();
  let curHour = ctx.clock.hour;

  function applyClockTime(): void {
    const cal = ctx.clock.calendar();
    sky.setTimeOfDay(curHour, cal.month, cal.day);
  }

  const unsubClock = ctx.clock.onChange((_t, hour) => {
    curHour = hour;
    applyClockTime();
  });
  applyClockTime();
  sky.setSeason(season);

  // ---- streaming system ----
  ctx.scheduler.add({
    name: 'world-stream',
    phase: 'always',
    order: 5,
    update(dt: number) {
      terrain.update({ x: camera.position.x, z: camera.position.z }, ctx.elapsed);
      vegetation.update();
      water.update(ctx.elapsed);
      sky.update(dt, renderer);
    },
  });

  // ---- InstanceHandle-based placement (for other modules; the VegetationManager above handles the
  // high-volume procedural placement separately via true GPU instancing). ----
  let instanceSeq = 1;
  function placeInstances(modelId: string, transforms: TransformLike[]): InstanceHandle {
    const container = new Group();
    container.name = `instances-${modelId}`;
    for (const t of transforms) {
      const obj = models.spawn(modelId, { scale: t.scale });
      obj.position.set(t.x, t.y, t.z);
      obj.rotation.y = t.yaw ?? 0;
      container.add(obj);
    }
    propsRoot.add(container);
    const id = instanceSeq++;
    return {
      id,
      dispose() { propsRoot.remove(container); },
      setVisible(v: boolean) { container.visible = v; },
    };
  }

  // ---- raycast: march the analytic/CPU heightmap directly, independent of which chunks are streamed ----
  function raycast(origin: Vector3, dir: Vector3, maxDist: number): { point: Vector3; normal: Vector3 } | null {
    const d = dir.clone().normalize();
    const step = 2;
    let prevT = 0;
    let prevDiff = origin.y - terrain.heightAt(origin.x, origin.z);
    if (prevDiff < 0) return null; // starting underground
    for (let t = step; t <= maxDist; t += step) {
      const x = origin.x + d.x * t, y = origin.y + d.y * t, z = origin.z + d.z * t;
      const diff = y - terrain.heightAt(x, z);
      if (diff <= 0) {
        // binary-search refine between prevT and t
        let lo = prevT, hi = t;
        for (let i = 0; i < 10; i++) {
          const mid = (lo + hi) / 2;
          const my = origin.y + d.y * mid;
          const mx = origin.x + d.x * mid, mz = origin.z + d.z * mid;
          const mdiff = my - terrain.heightAt(mx, mz);
          if (mdiff > 0) lo = mid; else hi = mid;
        }
        const hitT = (lo + hi) / 2;
        const px = origin.x + d.x * hitT, py = origin.y + d.y * hitT, pz = origin.z + d.z * hitT;
        return { point: new Vector3(px, py, pz), normal: terrain.normalAt(px, pz) };
      }
      prevT = t; prevDiff = diff;
    }
    void prevDiff;
    return null;
  }

  function regionAt(x: number, z: number): RegionDef | null {
    for (const r of ctx.content.regions.values()) {
      if (pointInPolygon(x, z, r.bounds as [number, number][])) return r;
    }
    return null;
  }

  const service: WorldService = {
    heightAt: (x, z) => terrain.heightAt(x, z),
    normalAt: (x, z) => terrain.normalAt(x, z),
    surfaceAt: (x, z) => terrain.surfaceAt(x, z) as SurfaceType,
    isWater: (x, z) => terrain.isWater(x, z),
    slopeAt: (x, z) => terrain.slopeAt(x, z),
    raycast,
    regionAt,
    setTimeOfDay(hour: number) {
      curHour = hour;
      applyClockTime();
    },
    getTimeOfDay: () => curHour,
    setWeather(w: Weather) {
      weather = w;
      sky.setWeather(w);
    },
    getWeather: () => weather,
    setSeason(s) {
      season = s;
      sky.setSeason(s);
    },
    streamAround(x: number, z: number, radiusM = 800) {
      return new Promise<void>((resolve) => {
        terrain.setFocus(x, z);
        const t0 = performance.now();
        const poll = () => {
          if (terrain.isSettledAround(x, z, radiusM) || performance.now() - t0 > 20000) {
            terrain.clearFocus();
            resolve();
            return;
          }
          requestAnimationFrame(poll);
        };
        poll();
      });
    },
    isSettled: () => terrain.isSettledAround(camera.position.x, camera.position.z, STREAM_CORE_RADIUS),
    placeInstances,
    spawnModel: (modelId: string, opts?: { variant?: string; scale?: number }) => models.spawn(modelId, opts),
    registerModel: (modelId: string, factory: (o: { variant?: string; scale?: number; rng: Rng }) => Object3D) => models.register(modelId, factory),
    hasModel: (modelId: string) => models.has(modelId),
    listModels: () => models.list(),
    getSceneRoots: () => ({ terrain: terrainRoot, props: propsRoot, water: waterRoot, dynamic: dynamicRoot }),
    getRenderer: () => renderer as WebGLRenderer,
    getScene: () => scene as Scene,
    getCamera: () => camera as PerspectiveCamera,
    stats() {
      const t = terrain.stats();
      const v = vegetation.stats();
      return { chunksLoaded: t.chunksLoaded, chunksPending: t.chunksPending, instances: v.instances };
    },
    worldToMapUv,
    mapImage: () => renderMapImage(terrain, [...ctx.content.regions.values()]),
  };

  ctx.services.register('world', service);

  ctx.events.on('state-changed', () => { /* no-op hook point; kept for future pause/resume of particles etc. */ });
  void unsubClock; // kept subscribed for the lifetime of the app (no teardown path in this game)
  void getTerrainMaterial; // ensure the module is retained (used by terrain.ts on first chunk upload)
}
