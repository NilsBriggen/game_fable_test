/**
 * Sky, sun/moon, CSM cascaded shadows, weather and season. ARCHITECTURE.md §5.1.
 */
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, DirectionalLight, FogExp2, Group,
  HemisphereLight, PerspectiveCamera, Points, PointsMaterial, Scene, Vector3, WebGLRenderer,
} from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { CSM } from 'three/examples/jsm/csm/CSM.js';
import type { Season } from '@core/clock';
import type { Weather } from '@core/services';
import { setActiveCsm } from './shadowCsm';
import { getTerrainMaterial } from './terrainMaterial';
import { snowLineFor } from './heightmodel';

const LAT_DEG = 47;

function dayOfYearFromCalendar(month: number, day: number): number {
  const days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let doy = day;
  for (let m = 0; m < month - 1; m++) doy += days[m];
  return doy;
}

function solarPosition(dayOfYear: number, hour: number): { elevation: number; azimuth: number } {
  const lat = (LAT_DEG * Math.PI) / 180;
  const decDeg = 23.44 * Math.sin(((2 * Math.PI) / 365) * (dayOfYear - 81));
  const dec = (decDeg * Math.PI) / 180;
  const H = ((hour - 12) * 15 * Math.PI) / 180;
  const sinEl = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H);
  const elevation = Math.asin(Math.max(-1, Math.min(1, sinEl)));
  let cosAz = (Math.sin(dec) - Math.sin(elevation) * Math.sin(lat)) / (Math.cos(elevation) * Math.cos(lat) + 1e-9);
  cosAz = Math.max(-1, Math.min(1, cosAz));
  let az = Math.acos(cosAz);
  if (H > 0) az = Math.PI * 2 - az;
  return { elevation, azimuth: az };
}

/** elevation/azimuth (0=north, clockwise) -> world direction, matching +X east / +Z south / north=-Z. */
function sunVector(elevation: number, azimuth: number): Vector3 {
  const dx = Math.sin(azimuth) * Math.cos(elevation);
  const dz = -Math.cos(azimuth) * Math.cos(elevation);
  const dy = Math.sin(elevation);
  return new Vector3(dx, dy, dz).normalize();
}

function makeStars(count = 1200): Points {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    // random point on the upper hemisphere of a large sphere
    const u = Math.random(), v = Math.random();
    const theta = u * Math.PI * 2;
    const phi = Math.acos(v); // 0..pi/2-ish weighting toward zenith is fine for a starfield
    const r = 5000;
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = Math.abs(r * Math.cos(phi)) * 0.6 + 400;
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(positions, 3));
  const mat = new PointsMaterial({ color: 0xffffff, size: 4, sizeAttenuation: false, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false });
  const pts = new Points(geo, mat);
  pts.name = 'stars';
  pts.frustumCulled = false;
  return pts;
}

interface WeatherParams { turbidity: number; sunMul: number; fogDensity: number; particles: 'none' | 'rain' | 'snow'; skyTint: Color }
const WEATHER: Record<Weather, WeatherParams> = {
  clear: { turbidity: 2.2, sunMul: 1, fogDensity: 0.00010, particles: 'none', skyTint: new Color(0xffffff) },
  overcast: { turbidity: 8, sunMul: 0.55, fogDensity: 0.00028, particles: 'none', skyTint: new Color(0xc9d2d8) },
  rain: { turbidity: 9, sunMul: 0.4, fogDensity: 0.00042, particles: 'rain', skyTint: new Color(0xaab2b8) },
  snow: { turbidity: 6, sunMul: 0.6, fogDensity: 0.00046, particles: 'snow', skyTint: new Color(0xe6ecf0) },
  fog: { turbidity: 5, sunMul: 0.5, fogDensity: 0.0011, particles: 'none', skyTint: new Color(0xd7dee2) },
};

export interface SkyHandle {
  group: Group;
  csm: CSM;
  setTimeOfDay(hour: number, month: number, day: number): void;
  setWeather(w: Weather): void;
  setSeason(s: Season): void;
  update(dt: number, renderer: WebGLRenderer): void;
  dispose(): void;
}

export function buildSky(scene: Scene, camera: PerspectiveCamera, renderer: WebGLRenderer): SkyHandle {
  const group = new Group();
  group.name = 'sky';

  const sky = new Sky();
  sky.scale.setScalar(9500);
  group.add(sky);

  const hemi = new HemisphereLight(0xbcd6e8, 0x3a3226, 0.55);
  group.add(hemi);

  const csm = new CSM({
    camera, parent: scene, cascades: 3, mode: 'practical',
    shadowMapSize: 2048, lightIntensity: 2.2, maxFar: 620,
    lightDirection: new Vector3(0.4, -0.7, 0.3).normalize(),
    lightNear: 1, lightFar: 2000, lightMargin: 200,
  });
  (csm as any).fade = true;
  setActiveCsm(csm);

  const stars = makeStars();
  group.add(stars);

  scene.fog = new FogExp2(0xbfd2e0, 0.00012);

  let weather: Weather = 'clear';
  let season: Season = 'summer';
  let curHour = 8, curMonth = 8, curDay = 1;
  let particles: Points | null = null;
  let particleMat: PointsMaterial | null = null;
  const PARTICLE_COUNT = 900;
  const particleBox = 260;

  function ensureParticles(kind: 'rain' | 'snow' | 'none'): void {
    if (kind === 'none') {
      if (particles) { group.remove(particles); particles.geometry.dispose(); particleMat?.dispose(); particles = null; particleMat = null; }
      return;
    }
    if (particles) { group.remove(particles); particles.geometry.dispose(); particleMat?.dispose(); }
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      positions[i * 3] = (Math.random() - 0.5) * particleBox;
      positions[i * 3 + 1] = Math.random() * 120;
      positions[i * 3 + 2] = (Math.random() - 0.5) * particleBox;
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(positions, 3));
    particleMat = new PointsMaterial({
      color: kind === 'snow' ? 0xffffff : 0xaecbe0,
      size: kind === 'snow' ? 0.6 : 0.25,
      transparent: true, opacity: kind === 'snow' ? 0.85 : 0.55, depthWrite: false,
    });
    particles = new Points(geo, particleMat);
    particles.frustumCulled = false;
    particles.name = `weather-${kind}`;
    group.add(particles);
  }

  function applySun(): void {
    const doy = dayOfYearFromCalendar(curMonth, curDay);
    const { elevation, azimuth } = solarPosition(doy, curHour);
    const w = WEATHER[weather];
    const night = elevation < -0.02;
    const dir = night ? sunVector(Math.max(0.15, -elevation * 0.6), azimuth + Math.PI) : sunVector(elevation, azimuth);

    // Sky shader wants a position, not a direction; push it far away along the direction.
    const sunPos = dir.clone().multiplyScalar(4500);
    (sky.material as any).uniforms.sunPosition.value.copy(sunPos);
    (sky.material as any).uniforms.turbidity.value = w.turbidity;
    (sky.material as any).uniforms.rayleigh.value = night ? 0.15 : 1.4;
    (sky.material as any).uniforms.mieCoefficient.value = 0.006;
    (sky.material as any).uniforms.mieDirectionalG.value = 0.8;

    csm.lightDirection.copy(dir).multiplyScalar(-1);
    // CSM only reads `lightIntensity` once, at construction (createLights()) — assigning it later is a
    // no-op, so the per-frame day/night/weather brightness has to be pushed onto the actual lights.
    const intensity = (night ? 0.35 : Math.max(0.35, Math.sin(elevation)) * 3.2) * w.sunMul;
    csm.lightIntensity = intensity;
    const color = night ? new Color(0x6f85c9) : new Color(0xfff3da).lerp(new Color(0xffffff), Math.min(1, Math.sin(Math.max(0, elevation)) * 1.5));
    for (const l of csm.lights) { l.color.copy(color); l.intensity = intensity; }
    csm.updateFrustums();

    hemi.intensity = night ? 0.25 : 0.55 + Math.max(0, Math.sin(elevation)) * 0.4;
    hemi.color.copy(night ? new Color(0x24304a) : new Color(0xbcd6e8)).lerp(w.skyTint, 0.3);

    stars.visible = night;
    (stars.material as PointsMaterial).opacity = night ? Math.min(1, -elevation * 3) : 0;

    const fog = scene.fog as FogExp2;
    fog.density = w.fogDensity * (night ? 1.15 : 1);
    fog.color.copy(w.skyTint).lerp(new Color(0x0c1220), night ? 0.75 : 0);

    const terrainMat = getTerrainMaterial();
    (terrainMat.uniforms.uFogColor.value as Color).copy(fog.color);
    terrainMat.uniforms.uFogDensity.value = fog.density;
    (terrainMat.uniforms.uGrassTint.value as Color).copy(seasonTint(season));
  }

  function seasonTint(s: Season): Color {
    switch (s) {
      case 'winter': return new Color(0xb9c2b0);
      case 'spring': return new Color(0x9fc466);
      case 'autumn': return new Color(0xb98f4a);
      default: return new Color(0x9fb862);
    }
  }

  function applySeason(): void {
    const { uniforms } = getTerrainMaterial();
    uniforms.uSnowLine.value = snowLineFor(season);
  }

  applySun();
  applySeason();

  let clock = 0;
  return {
    group,
    csm,
    setTimeOfDay(hour: number, month: number, day: number) {
      curHour = hour; curMonth = month; curDay = day;
      applySun();
    },
    setWeather(w: Weather) {
      weather = w;
      ensureParticles(WEATHER[w].particles);
      applySun();
    },
    setSeason(s: Season) {
      season = s;
      applySeason();
      applySun();
    },
    update(dt: number, glRenderer: WebGLRenderer) {
      clock += dt;
      camera.updateMatrixWorld(true);
      csm.updateFrustums();
      csm.update();
      if (particles) {
        const pos = particles.geometry.getAttribute('position') as BufferAttribute;
        const fall = (weather === 'snow' ? 6 : 40) * dt;
        const camX = camera.position.x, camZ = camera.position.z;
        for (let i = 0; i < PARTICLE_COUNT; i++) {
          let y = pos.getY(i) - fall;
          if (y < 0) y = 120;
          pos.setY(i, y);
        }
        particles.position.set(camX, 0, camZ);
        pos.needsUpdate = true;
      }
      void glRenderer;
    },
    dispose() {
      setActiveCsm(null);
      csm.dispose();
      (sky.material as any).dispose();
      sky.geometry.dispose();
      stars.geometry.dispose();
      (stars.material as PointsMaterial).dispose();
      if (particles) { particles.geometry.dispose(); particleMat?.dispose(); }
    },
  };
}
