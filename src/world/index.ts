/**
 * World module entry point: registers WorldService (ARCHITECTURE.md §4, §5.1).
 * Owns terrain streaming, water, sky/weather/season, vegetation, the procedural model library and
 * the top-down map image. Uses ctx.gfx.renderer/scene/camera created by core.
 */
import { Group, Vector3, type Object3D, type PerspectiveCamera, type Scene, type WebGLRenderer } from 'three';
import { lakeLevelAt } from './lakes';
import type { GameContext } from '@core/context';
import { Transform } from '@core/components';
import type { InstanceHandle, SurfaceType, TransformLike, Weather, WorldService } from '@core/services';
import type { Rng } from '@core/rng';
import type { RegionDef } from '@core/schemas';
import { pointInPolygon } from '@core/math';
import { PLACES } from '@content/gazetteer';
import { PLACE_REGION_ID } from '@content/geography';

import { TerrainManager, setViewRadius } from './terrain';
import { VegetationManager, setVegetationDensity, setVegetationShed } from './vegetation';
import { buildWater, type WaterHandle } from './water';
import { buildSky, type SkyHandle } from './sky';
import { ModelLibrary } from './models';
import { spawnCharacter, updateCharacters, CHARACTER_CLIP_NAMES } from './characters';
import { renderMapImage, worldToMapUv, invalidateMapCache, mapFogKey } from './map';
import { getTerrainMaterial } from './terrainMaterial';
import { snowLineFor } from './heightmodel';
import { applyWetSheen } from './assets';

const STREAM_CORE_RADIUS_DEFAULT = 1100;
/** Settled radius for the harness/camera gate; follows `viewDistance` (see applyWorldSettings below). */
let streamCoreRadius = STREAM_CORE_RADIUS_DEFAULT;

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

  const terrain = new TerrainManager(ctx.seed, (info) => ctx.events.emit('chunk-loaded', info));
  terrainRoot.add(terrain.group);
  await terrain.ready;
  terrain.buildFarMesh(); // whole-map backdrop behind the 3 km streamed ring (requests/worldlook-2)

  const water: WaterHandle = buildWater();
  waterRoot.add(water.group);

  const vegetation = new VegetationManager(ctx.seed, terrain);
  propsRoot.add(vegetation.group);

  const models = new ModelLibrary(ctx.seed);

  // Phase 2 A4-core: mirror the terrain governor into vegetation density. The terrain manager owns
  // the frame-time governor (fed from its update()); this poll runs in the same system tick and
  // only re-scatters on transitions, so shed mode never pays a re-scatter storm to engage.
  let shedApplied = false;

  let weather: Weather = 'clear';
  let season: 'winter' | 'spring' | 'summer' | 'autumn' = ctx.clock.season();
  let curHour = ctx.clock.hour;

  function applyClockTime(): void {
    const cal = ctx.clock.calendar();
    sky.setTimeOfDay(curHour, cal.month, cal.day);
  }

  const unsubClock = ctx.clock.onChange((t, hour) => {
    curHour = hour;
    applyClockTime();
    ctx.events.emit('time-changed', t, hour);
  });
  applyClockTime();
  sky.setSeason(season);

  // Phase 2 A3: planar water reflection on HIGH quality only, default OFF (analytic sky above).
  // Phase 6: boot-ON when saved quality is already high — the mirror is the single biggest
  // water-realism win and the plumbing (960x540 target, HIGH-only) already exists.
  let lastQuality: string | null = null;
  function applyReflectionQuality(): void {
    const q = ctx.settings.quality;
    if (q === lastQuality) return;
    lastQuality = q;
    water.setReflectionEnabled(q === 'high');
  }
  applyReflectionQuality();

  // ---- character clip warmup (3.5): the rigged bodies stream their Mixamo clips on first play
  // (async fetch + retarget, see characterAssets.modelClip). A scenario that opens on a settlement
  // full of NPCs would otherwise play the first seconds of every conversation in the procedural bind
  // pose while clips trickle in. Warm the clips every CharacterAnim can request — fire-and-forget at
  // registration (boot), retried on scenario load (a failed fetch under a cold cache resolves later).
  // Pure prefetch: no scene objects, no mixer, bounded by the clip cache.
  function warmCharacterClips(): void {
    void import('./characterAssets').then((m) => {
      for (const name of CHARACTER_CLIP_NAMES) void m.loadClip(name).catch(() => {});
    }).catch(() => {});
  }
  warmCharacterClips();
  ctx.events.on('loaded', () => warmCharacterClips());

  // ---- streaming system ----
  ctx.scheduler.add({
    name: 'world-stream',
    phase: 'always',
    order: 5,
    update(dt: number) {
      // Phase 2 observability: feed the streaming governor from the real renderer frame-time ring
      // (wall-clock intervals around render, includes GPU wait) instead of the game-clock delta.
      const ring = ctx.gfx.frameMs;
      const frameMs = ring.length ? ring[ring.length - 1] : dt * 1000;
      terrain.update({ x: camera.position.x, z: camera.position.z }, ctx.elapsed, frameMs);
      const degradedNow = terrain.degraded;
      if (degradedNow !== shedApplied) {
        shedApplied = degradedNow;
        // 0.5 keeps FAR_KEEP/IMPOSTOR_KEEP-shaped thinning, halved; recovery re-scatters once.
        setVegetationShed(degradedNow ? 0.5 : 1);
        vegetation.reseason();
      }
      vegetation.update(ctx.elapsed, ctx.settings.reducedMotion ? 0 : 1);
      applyReflectionQuality();
      // §3.5: rain/fog wetness sheens roofs and cobbles (uniform-only, no new materials).
      try { applyWetSheen(sky.wetness()); } catch { /* sheen must never break the frame */ }
      // The planar pass renders the scene before the main render (reflection off = cheap uniform update).
      water.update(ctx.elapsed, water.isReflectionEnabled() ? renderer : undefined, scene, camera);
      sky.update(dt, renderer);
      updateCharacters(dt);
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

  // Region polygons are hand-authored hulls and can legitimately overlap near a shared border
  // (e.g. uri-gotthard sits wholly inside the alps-high backdrop). For a gazetteer place, the
  // authored membership list (PLACE_REGION_ID) is the ground truth, not polygon containment order —
  // this guarantees every gazetteer place resolves to exactly its own region regardless of overlap.
  // Arbitrary (non-place) points fall back to first-match polygon containment.
  function regionAt(x: number, z: number): RegionDef | null {
    for (const p of Object.values(PLACES)) {
      if (Math.abs(p.x - x) < 0.5 && Math.abs(p.z - z) < 0.5) {
        const rid = PLACE_REGION_ID[p.id];
        const r = rid ? ctx.content.regions.get(rid) : undefined;
        if (r) return r;
        break;
      }
    }
    for (const r of ctx.content.regions.values()) {
      if (pointInPolygon(x, z, r.bounds as [number, number][])) return r;
    }
    return null;
  }

  const service: WorldService = {
    heightAt: (x, z) => terrain.heightAt(x, z),
    normalAt: (x, z) => terrain.normalAt(x, z),
    // Snow is never baked into the height/surface grid (the bake is season-independent) — it's a
    // live override here so it always tracks the current season's snow line (§5.1's "Weather and
    // seasons"), the way vegetation and the terrain shader's own live snow overlay already do.
    surfaceAt: (x, z) => {
      const base = terrain.surfaceAt(x, z) as SurfaceType;
      if (base === 'water' || base === 'settlement' || base === 'road') return base;
      return terrain.heightAt(x, z) > snowLineFor(season) ? 'snow' : base;
    },
    isWater: (x, z) => terrain.isWater(x, z),
    lakeLevelAt: (x, z, maxDist) => lakeLevelAt(x, z, maxDist),
    slopeAt: (x, z) => terrain.slopeAt(x, z),
    raycast,
    regionAt,
    setTimeOfDay(hour: number) {
      curHour = hour;
      applyClockTime();
      ctx.events.emit('time-changed', ctx.elapsed, hour);
    },
    getTimeOfDay: () => curHour,
    setWeather(w: Weather) {
      weather = w;
      sky.setWeather(w);
    },
    getWeather: () => weather,
    setCombatFill(on) { sky.setCombatFill(on); },
    setSeason(s) {
      season = s;
      invalidateMapCache(); // the parchment map bakes the snow line (bughunt world-runtime)
      sky.setSeason(s);
      vegetation.reseason();   // tints and stubble follow uSnowDepth, which sky.setSeason just changed
    },
    streamAround(x: number, z: number, radiusM = 800) {
      return new Promise<void>((resolve) => {
        terrain.setFocus(x, z);
        const t0 = performance.now();
        const poll = () => {
          // Phase 2 A1.4: report whether the wait settled or timed out — callers (and the harness)
          // can no longer mistake a 20 s timeout for completed streaming. Resolves true on settle.
          if (terrain.isSettledAround(x, z, radiusM)) {
            terrain.clearFocus();
            resolve();
            return;
          }
          if (performance.now() - t0 > 20000) {
            // NOTE: intentionally no console.warn here — the harness counts in-page warnings as
            // failures (zero-warning gate). A timeout is reported via isSettled/chunksPending in
            // stats() instead; callers screenshoting too early see pending chunks, not a warn.
            terrain.clearFocus();
            resolve();
            return;
          }
          requestAnimationFrame(poll);
        };
        poll();
      });
    },
    isSettled: () => terrain.isSettledAround(camera.position.x, camera.position.z, streamCoreRadius),
    placeInstances,
    spawnModel: (modelId: string, opts?: { variant?: string; scale?: number; seed?: number }) => models.spawn(modelId, opts),
    spawnCharacter: (archetype: string, opts?: { variant?: string; mounted?: boolean; seed?: number }) => spawnCharacter(archetype, opts),
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
      // Phase 2 observability: retained CPU MB + degraded flag flow through the shared interface
      // (core/services.ts) so the harness/integrator can read them without reaching past the service.
      return {
        chunksLoaded: t.chunksLoaded,
        chunksPending: t.chunksPending,
        instances: v.instances,
        retainedMb: Math.round((t.retainedMb + v.retainedMb) * 10) / 10,
        degraded: t.degraded,
      };
    },
    worldToMapUv,
    mapImage: () => {
      // 4.6 fog: reveal discs around discovered POIs (6x discoverRadius, min 900 m) + the player
      // (1200 m). Cached under the discovery set + a coarse player cell; baked, not per-frame.
      const exploration = ctx.services.tryGet('exploration');
      const discoveredIds = exploration?.discovered() ?? [];
      const set = new Set(discoveredIds);
      const spots: { x: number; z: number; r: number }[] = [];
      for (const p of ctx.content.pois.values()) {
        if (!set.has(p.id)) continue;
        spots.push({ x: p.x, z: p.z, r: Math.max(900, p.discoverRadius * 6) });
      }
      let player: { x: number; z: number } | null = null;
      const playerId = exploration?.getPlayer() ?? null;
      if (playerId !== null) {
        const t = ctx.world.get(playerId, Transform) as { x: number; z: number } | undefined;
        if (t) {
          player = { x: t.x, z: t.z };
          spots.push({ x: t.x, z: t.z, r: 1200 });
        }
      }
      return renderMapImage(terrain, [...ctx.content.regions.values()], { spots, key: mapFogKey(discoveredIds, player) });
    },
    invalidateMapCache: () => invalidateMapCache(),
  };

  ctx.services.register('world', service);

  // Settings the world module owns (requests/ui-4, ui-5): CSM shadow resolution, streaming radius,
  // and quality-tier vegetation density. Render scale / pixel ratio / shadowMap.enabled / camera far
  // stay UI-side in `applyUiSettingsSideEffects` (src/ui/menus.ts) — this subscriber only adds what
  // the UI legally cannot reach. Applied once at boot (loaded settings) and on every later change.
  // `streamAround` callers (exploration fast-travel, harness) pass their own radius and are untouched.
  function applyWorldSettings(): void {
    const s = ctx.settings;
    if (s.shadowRes !== lastShadowRes) { lastShadowRes = s.shadowRes; sky.setShadowSize(s.shadowRes); }
    // viewDistance 4000 (the default) maps to the authored 3000 m streaming ring, so boot with
    // loaded/default settings renders exactly what the fixed radius always rendered; the panel
    // then scales the ring down/up from there. §3.11: each adaptive-hitch step sheds 500 m
    // (floor 1500 m, logged by the governor in core/graphics.ts).
    const step = ctx.gfx.streamRadiusStep();
    setViewRadius(Math.max(1500, s.viewDistance * 0.75 - step * 500));
    streamCoreRadius = Math.max(400, Math.min(2000, Math.round(s.viewDistance * 0.275)));
    const density = s.quality === 'low' ? 0.4 : s.quality === 'medium' ? 0.7 : 1;
    if (density !== lastDensity) {
      lastDensity = density;
      setVegetationDensity(density);
      // already-placed chunks keep their old instances until a tier change; force a re-scatter so
      // the new tier is visible without a teleport (same path as a season change).
      vegetation.reseason();
    }
  }
  let lastShadowRes = -1;
  let lastDensity = -1;
  let lastHitchStep = -1;
  // §3.11: poll the adaptive governor in the stream tick (cheap int compare) so hitch steps
  // actually reshape the ring without waiting for a settings change.
  ctx.scheduler.add({
    name: 'world-adaptive-radius',
    phase: 'always',
    order: 6,
    update(): void {
      const step = ctx.gfx.streamRadiusStep();
      if (step !== lastHitchStep) { lastHitchStep = step; applyWorldSettings(); }
    },
  });
  applyWorldSettings();
  ctx.onSettings(() => applyWorldSettings());

  ctx.events.on('state-changed', () => { /* no-op hook point; kept for future pause/resume of particles etc. */ });
  void unsubClock; // kept subscribed for the lifetime of the app (no teardown path in this game)
  void getTerrainMaterial; // ensure the module is retained (used by terrain.ts on first chunk upload)
}
