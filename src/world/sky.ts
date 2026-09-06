/**
 * Sky, sun/moon path for 47 deg N, stars, a cumulus and an overcast cloud deck, the ground-haze
 * disc that backs the horizon beyond the streaming radius, weather, exposure, CSM cascaded shadows,
 * and the atmosphere uniforms every other world material reads (aerial perspective, water
 * reflection colours). ARCHITECTURE.md §5.1.
 */
import {
  AdditiveBlending, BackSide, BufferAttribute, BufferGeometry, CanvasTexture, ClampToEdgeWrapping,
  CircleGeometry, Color, DoubleSide, FogExp2, Group, HemisphereLight, Mesh, MeshBasicMaterial, PerspectiveCamera, Points,
  PointsMaterial, RepeatWrapping, ShaderMaterial, SRGBColorSpace, Scene, SphereGeometry, Vector3, WebGLRenderer,
} from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { CSM } from 'three/examples/jsm/csm/CSM.js';
import type { Season } from '@core/clock';
import type { Weather } from '@core/services';
import { setActiveCsm, setViewPosition } from './shadowCsm';
import { getTerrainMaterial, ATMOSPHERE, FOG_UNIFORMS } from './terrainMaterial';
import { snowLineFor } from './heightmodel';
import { fbm2D } from './noise';

const LAT_DEG = 47;
const DOME_R = 8600; // inside the 12 000 m camera far plane, further than anything the player reaches

export function dayOfYearFromCalendar(month: number, day: number): number {
  const days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let doy = day;
  for (let m = 0; m < month - 1; m++) doy += days[m];
  return doy;
}

/** Standard solar-position approximation; `hour` is local apparent time. */
export function solarPosition(dayOfYear: number, hour: number, decDegOverride?: number): { elevation: number; azimuth: number } {
  const lat = (LAT_DEG * Math.PI) / 180;
  const decDeg = decDegOverride ?? 23.44 * Math.sin(((2 * Math.PI) / 365) * (dayOfYear - 81));
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

/** The moon runs ~50 min later each day and swings +/-23 deg in declination over the month. */
export function lunarPosition(dayOfYear: number, hour: number): { elevation: number; azimuth: number; phase: number } {
  const synodic = ((dayOfYear % 29.53) + 29.53) % 29.53;
  const lagHours = 12 - (synodic / 29.53) * 24;   // full moon (synodic 0) rises as the sun sets
  const dec = 23.44 * Math.sin((synodic / 27.32) * Math.PI * 2);
  const p = solarPosition(dayOfYear, hour + lagHours, dec);
  return { ...p, phase: 0.5 - 0.5 * Math.cos((synodic / 29.53) * Math.PI * 2) };
}

/** elevation/azimuth (0 = north, clockwise) -> world direction (+X east, +Z south, north = -Z). */
function bodyVector(elevation: number, azimuth: number): Vector3 {
  return new Vector3(
    Math.sin(azimuth) * Math.cos(elevation),
    Math.sin(elevation),
    -Math.cos(azimuth) * Math.cos(elevation),
  ).normalize();
}

// ---------------------------------------------------------------------------------------------
// Sky colour by sun elevation. Everything that needs to know "what colour is the air right now" --
// haze, hemisphere ambient, water reflection, exposure -- interpolates these keyframes.
// ---------------------------------------------------------------------------------------------

interface SkyKey {
  el: number;       // sun elevation, degrees
  zenith: number; horizon: number;
  haze: number;     // aerial-perspective base colour
  sunGlow: number;  // haze colour looking into the sun
  light: number;    // directional light colour
  ambient: number;  // hemisphere sky colour
  exposure: number;
}

const SKY_KEYS: SkyKey[] = [
  // night floor lifted (was 0x1a2440 / 0x2f3f66): a moonless November pre-dawn rendered as a black frame
  { el: -20, zenith: 0x04060e, horizon: 0x0a1120, haze: 0x131c31, sunGlow: 0x1b2440, light: 0x5a6ea8, ambient: 0x2c3a5c, exposure: 1.5 },
  { el: -6,  zenith: 0x101c3c, horizon: 0x30456e, haze: 0x2b3a5c, sunGlow: 0x5b5878, light: 0x6d7cae, ambient: 0x3d4f7c, exposure: 1.56 },
  // twilight ambient lifted (was 0x51608c / 0x7d90b4): a dusk vista of shadowed flanks read as mud at 19:00
  { el: -1,  zenith: 0x1d3566, horizon: 0x8a6a76, haze: 0x60607f, sunGlow: 0xc07a58, light: 0xc4794e, ambient: 0x6f7fa8, exposure: 1.5 },
  // low-sun exposure lifted (1.3 / 0.97, then 1.6 -> 1.68): a valley village in the mountains' shadow
  // at 19:00 in August rendered as night while the real sky still lights it; hour-19 (el ~3.3)
  // interpolates just past this peak toward el 10, so the peak must clear the 1.6 legibility floor
  { el: 3,   zenith: 0x2a558f, horizon: 0xdc9257, haze: 0x9a8f96, sunGlow: 0xf3a860, light: 0xff9a4f, ambient: 0x9aabc8, exposure: 1.68 },
  { el: 10,  zenith: 0x2f639f, horizon: 0xe3bd92, haze: 0xb3bccb, sunGlow: 0xf7cf9b, light: 0xffd9a3, ambient: 0x9db4cd, exposure: 1.08 },
  { el: 28,  zenith: 0x336cb0, horizon: 0xcbdcea, haze: 0xa9c1da, sunGlow: 0xf6e3c0, light: 0xfff2d8, ambient: 0xbcd6e8, exposure: 0.92 },
  { el: 65,  zenith: 0x2f6bb8, horizon: 0xd3e3ef, haze: 0xa4bfdb, sunGlow: 0xf2ead8, light: 0xfffaf0, ambient: 0xc6dcec, exposure: 0.88 },
];

const tmpA = new Color(), tmpB = new Color();
function lerpKeyColor(a: number, b: number, t: number, out: Color): Color {
  tmpA.setHex(a); tmpB.setHex(b);
  return out.copy(tmpA).lerp(tmpB, t);
}

interface SkyLook {
  zenith: Color; horizon: Color; haze: Color; sunGlow: Color; light: Color; ambient: Color; exposure: number;
}

function skyLook(elevationDeg: number, out: SkyLook): SkyLook {
  let i = 0;
  while (i < SKY_KEYS.length - 2 && elevationDeg > SKY_KEYS[i + 1].el) i++;
  const a = SKY_KEYS[i], b = SKY_KEYS[i + 1];
  const t = Math.max(0, Math.min(1, (elevationDeg - a.el) / (b.el - a.el)));
  lerpKeyColor(a.zenith, b.zenith, t, out.zenith);
  lerpKeyColor(a.horizon, b.horizon, t, out.horizon);
  lerpKeyColor(a.haze, b.haze, t, out.haze);
  lerpKeyColor(a.sunGlow, b.sunGlow, t, out.sunGlow);
  lerpKeyColor(a.light, b.light, t, out.light);
  lerpKeyColor(a.ambient, b.ambient, t, out.ambient);
  out.exposure = exposureAtElevation(elevationDeg);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Weather
// ---------------------------------------------------------------------------------------------

interface WeatherParams {
  turbidity: number;
  rayleigh: number;
  sunMul: number;        // direct sun scale
  ambientMul: number;
  fogDensity: number;
  overcast: number;      // 0..1 flat cloud deck opacity
  cumulus: number;       // 0..1 broken cloud opacity
  cloudTint: number;
  desat: number;         // pull the sky colours toward grey
  particles: 'none' | 'rain' | 'snow';
  wetness: number;
  snowDepth: number;
  chop: number;          // water surface agitation
  exposureMul: number;
}

const WEATHER: Record<Weather, WeatherParams> = {
  clear:    { turbidity: 2.4, rayleigh: 1.6, sunMul: 1.00, ambientMul: 1.00, fogDensity: 0.000155, overcast: 0.00, cumulus: 0.34, cloudTint: 0xffffff, desat: 0.00, particles: 'none', wetness: 0.00, snowDepth: 0, chop: 0.9, exposureMul: 1.00 },
  overcast: { turbidity: 7.5, rayleigh: 0.7, sunMul: 0.34, ambientMul: 1.05, fogDensity: 0.000320, overcast: 0.90, cumulus: 0.70, cloudTint: 0x93a0aa, desat: 0.72, particles: 'none', wetness: 0.10, snowDepth: 0, chop: 1.3, exposureMul: 1.08 },
  rain:     { turbidity: 9.0, rayleigh: 0.5, sunMul: 0.20, ambientMul: 0.85, fogDensity: 0.000520, overcast: 0.95, cumulus: 0.80, cloudTint: 0x5f6a74, desat: 0.86, particles: 'rain', wetness: 0.85, snowDepth: 0, chop: 1.9, exposureMul: 1.14 },
  snow:     { turbidity: 5.5, rayleigh: 0.6, sunMul: 0.42, ambientMul: 1.20, fogDensity: 0.000480, overcast: 0.88, cumulus: 0.72, cloudTint: 0xc2ccd4, desat: 0.80, particles: 'snow', wetness: 0.00, snowDepth: 0.55, chop: 0.7, exposureMul: 1.05 },
  fog:      { turbidity: 4.5, rayleigh: 0.6, sunMul: 0.30, ambientMul: 1.10, fogDensity: 0.001500, overcast: 0.75, cumulus: 0.40, cloudTint: 0xc8d0d6, desat: 0.90, particles: 'none', wetness: 0.25, snowDepth: 0, chop: 0.5, exposureMul: 1.10 },
};
// ---------------------------------------------------------------------------------------------
// Pure exposure helpers (no GPU). skyLook() above is the sole runtime writer; these expose the
// same SKY_KEYS × WEATHER.exposureMul lookup for tests so the evening legibility floor and the
// night/day pins can be checked without a renderer.
// ---------------------------------------------------------------------------------------------

/** Tone-mapping exposure for a sun elevation (pure SKY_KEYS interpolation). */
export function exposureAtElevation(elevationDeg: number): number {
  let i = 0;
  while (i < SKY_KEYS.length - 2 && elevationDeg > SKY_KEYS[i + 1].el) i++;
  const a = SKY_KEYS[i], b = SKY_KEYS[i + 1];
  const t = Math.max(0, Math.min(1, (elevationDeg - a.el) / (b.el - a.el)));
  return a.exposure + (b.exposure - a.exposure) * t;
}

/** Effective renderer exposure for an elevation + weather (key × WEATHER.exposureMul), pure. */
export function effectiveExposureAtElevation(elevationDeg: number, weather: Weather): number {
  return exposureAtElevation(elevationDeg) * WEATHER[weather].exposureMul;
}

/** Effective renderer exposure for a calendar hour (solarPosition + key lookup), pure, no GPU. */
export function effectiveExposureForHour(dayOfYear: number, hour: number, weather: Weather): number {
  const elDeg = (solarPosition(dayOfYear, hour).elevation * 180) / Math.PI;
  return effectiveExposureAtElevation(elDeg, weather);
}


// ---------------------------------------------------------------------------------------------
// Canvas textures: cloud deck, star/moon sprites, rain streak, snow flake
// ---------------------------------------------------------------------------------------------

function canvas2d(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  return { canvas, ctx: canvas.getContext('2d')! };
}

/** Broken cumulus deck: fbm thresholded into cloud bodies, with a lit top edge. */
function cloudTexture(): CanvasTexture {
  const W = 512, H = 256;
  const { canvas, ctx } = canvas2d(W, H);
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // blend the field with a copy shifted by one period so the wrap seam disappears
      const f0 = fbm2D(x, y * 1.7, { octaves: 5, frequency: 0.017, seed: 613 });
      const f1 = fbm2D(x - W, y * 1.7, { octaves: 5, frequency: 0.017, seed: 613 });
      const wgt = x / W;
      let n = (f0 * (1 - wgt) + f1 * wgt) * 0.5 + 0.5;
      n -= (1 - y / H) * 0.16;  // thin out toward the zenith so the deck reads as a layer, not a lid
      const a = Math.max(0, Math.min(1, (n - 0.46) * 3.2));
      const lit = Math.max(0, Math.min(1, (n - 0.5) * 2.4));
      const i = (y * W + x) * 4;
      const v = 190 + lit * 65;
      img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = Math.min(255, v + 6);
      img.data[i + 3] = Math.round(Math.pow(a, 0.8) * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = RepeatWrapping;
  t.wrapT = ClampToEdgeWrapping;
  return t;
}

/** Soft radial disc, used for stars and snowflakes. */
function discTexture(size = 32, hardness = 0.35): CanvasTexture {
  const { canvas, ctx } = canvas2d(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(hardness, 'rgba(255,255,255,0.8)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** A moon disc with faint maria and a soft limb. */
function moonTexture(): CanvasTexture {
  const S = 128;
  const { canvas, ctx } = canvas2d(S, S);
  const g = ctx.createRadialGradient(S * 0.42, S * 0.4, S * 0.05, S / 2, S / 2, S * 0.5);
  g.addColorStop(0, 'rgba(255,253,244,1)');
  g.addColorStop(0.78, 'rgba(233,232,220,1)');
  g.addColorStop(0.93, 'rgba(206,206,198,0.85)');
  g.addColorStop(1, 'rgba(190,195,205,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(S / 2, S / 2, S * 0.5, 0, Math.PI * 2); ctx.fill();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = 'rgba(150,152,158,0.30)';
  for (const [cx, cy, r] of [[0.40, 0.35, 0.14], [0.56, 0.44, 0.10], [0.46, 0.58, 0.12], [0.62, 0.62, 0.07]]) {
    ctx.beginPath(); ctx.arc(S * cx, S * cy, S * r, 0, Math.PI * 2); ctx.fill();
  }
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/**
 * Vertical rain streak. The canvas MUST be square: a Points sprite is a screen-aligned square, so a
 * 16x64 texture is squashed back to 1:1 and the streak comes out as a fat round blob that reads as
 * snow. The streak is drawn thin inside a square instead.
 */
function rainTexture(): CanvasTexture {
  const S = 64;
  const { canvas, ctx } = canvas2d(S, S);
  const g = ctx.createLinearGradient(0, 0, 0, S);
  g.addColorStop(0, 'rgba(214,232,244,0)');
  g.addColorStop(0.25, 'rgba(224,240,250,0.9)');
  g.addColorStop(0.75, 'rgba(224,240,250,0.9)');
  g.addColorStop(1, 'rgba(200,220,235,0)');
  ctx.fillStyle = g;
  ctx.fillRect(S * 0.47, 0, S * 0.06, S);
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------------------------------------

export interface SkyHandle {
  group: Group;
  csm: CSM;
  setTimeOfDay(hour: number, month: number, day: number): void;
  setWeather(w: Weather): void;
  setSeason(s: Season): void;
  /** turn-based combat at night or in rain gets a fill so the field stays legible (BG3 lights its fights) */
  setCombatFill(on: boolean): void;
  /** current weather wetness 0..1 (§3.5 wet sheen reads this; terrain shader reads uWetness directly) */
  wetness(): number;
  /** resize the CSM cascade shadow maps (requests/ui-4, ui-5: settings `shadowRes`) */
  setShadowSize(px: number): void;
  update(dt: number, renderer: WebGLRenderer): void;
  dispose(): void;
}

export function buildSky(scene: Scene, camera: PerspectiveCamera, renderer: WebGLRenderer): SkyHandle {
  const group = new Group();
  group.name = 'sky';

  const sky = new Sky();
  sky.scale.setScalar(DOME_R * 1.15);
  sky.renderOrder = -100;
  group.add(sky);

  // --- cloud decks ---------------------------------------------------------------------------
  const cloudTex = cloudTexture();
  const domeGeo = new SphereGeometry(DOME_R, 36, 18, 0, Math.PI * 2, 0, Math.PI * 0.54);
  const cumulusMat = new MeshBasicMaterial({ map: cloudTex, transparent: true, opacity: 0.34, depthWrite: false, side: BackSide, fog: false });
  const cumulus = new Mesh(domeGeo, cumulusMat);
  cumulus.name = 'clouds-cumulus';
  cumulus.renderOrder = -90;
  cumulus.frustumCulled = false;
  group.add(cumulus);

  const overcastGeo = new SphereGeometry(DOME_R * 0.97, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.56);
  const overcastMat = new MeshBasicMaterial({ color: 0x9aa4ac, transparent: true, opacity: 0, depthWrite: false, side: BackSide, fog: false });
  const overcast = new Mesh(overcastGeo, overcastMat);
  overcast.name = 'clouds-overcast';
  overcast.renderOrder = -95;
  overcast.frustumCulled = false;
  group.add(overcast);

  // --- distant ground haze ---------------------------------------------------------------------
  // The terrain streamer holds a 3 km radius on a 17 km map, so on a vista (Pilatus over the Luzern
  // basin, the far end of the Urnersee) everything past that is simply not there and the Preetham
  // dome shows through it — and below the horizon Preetham is almost white, so the missing distance
  // reads as a blown-out void. This disc sits at the lake surface in the haze colour and fills that
  // void with atmosphere. It writes no depth and is ordered before the terrain, so any chunk that
  // does exist draws over it.
  const hazeGeo = new CircleGeometry(DOME_R, 48);
  const hazeMat = new MeshBasicMaterial({ color: 0xbfd2e0, depthWrite: false, side: DoubleSide, fog: false });
  const groundHaze = new Mesh(hazeGeo, hazeMat);
  groundHaze.name = 'ground-haze';
  groundHaze.rotation.x = -Math.PI / 2;
  groundHaze.renderOrder = -97;
  groundHaze.frustumCulled = false;
  group.add(groundHaze);

  // --- stars + moon --------------------------------------------------------------------------
  const starTex = discTexture(32, 0.15);
  const stars = makeStars(starTex);
  group.add(stars);

  const moonTex = moonTexture();
  const moonMat = new PointsMaterial({
    map: moonTex, size: 380, sizeAttenuation: true, transparent: true, opacity: 0,
    depthWrite: false, depthTest: true, blending: AdditiveBlending, fog: false,
  });
  const moonGeo = new BufferGeometry();
  moonGeo.setAttribute('position', new BufferAttribute(new Float32Array(3), 3));
  const moon = new Points(moonGeo, moonMat);
  moon.name = 'moon';
  moon.renderOrder = -80;
  moon.frustumCulled = false;
  group.add(moon);

  // --- lights ----------------------------------------------------------------------------------
  const hemi = new HemisphereLight(0xbcd6e8, 0x3a3226, 0.55);
  group.add(hemi);

  const csm = new CSM({
    camera, parent: scene, cascades: 3, mode: 'practical',
    shadowMapSize: 2048, lightIntensity: 2.2, maxFar: 600,
    lightDirection: new Vector3(0.4, -0.7, 0.3).normalize(),
    lightNear: 1, lightFar: 2000, lightMargin: 200,
  });
  (csm as any).fade = true;
  setActiveCsm(csm);

  scene.fog = new FogExp2(0xbfd2e0, 0.00016);

  // --- weather particles: GPU-animated -----------------------------------------------------------------
  // One Points cloud, shader-animated (Phase 2 A3). Fall and the snow sway run in the vertex
  // shader from uTime and wrap in a 170x80 m box around the camera; the CPU writes no
  // attributes per frame. Same coverage as the old CPU loop (1400 rain / 1000 snow in the box).
  const rainTex = rainTexture();
  const flakeTex = discTexture(32, 0.4);
  const PARTICLE_COUNT = 1400;
  // Phase 2 A5 (Sarnen-night-rain blowup): the rain Points cloud is 1 draw call but 1400
  // screen-covering alpha sprites. Triangles are NOT the particle term (2 tris/sprite); the
  // 5.43 M tris at 158 calls are alpha-tested vegetation cards + decimated scan rocks (see
  // vegetation.ts pebbleKeepFor). RAIN_COUNT/SNOW_COUNT below cut the overdraw-dominated precip
  // pass with no visible density change from a follow camera.
  const RAIN_COUNT = 700;
  const SNOW_COUNT = 350;
  const PARTICLE_BOX = 170;
  const PARTICLE_TOP = 80;
  let precip: Points | null = null;
  let precipMat: ShaderMaterial | null = null;
  let particleKind: 'rain' | 'snow' | 'none' = 'none';

  const PRECIP_VERT = /* glsl */ `
    attribute float aSeed;
    uniform float uTime, uFall, uSway, uTop, uSize, uScale;
    void main() {
      vec3 p = position;
      float span = uTop + 6.0;
      p.y = mod(position.y - uTime * uFall, span) - 6.0;
      p.x += sin(uTime * 0.7 + aSeed * 6.2831) * uSway;
      p.z += cos(uTime * 0.7 + aSeed * 6.2831) * uSway;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_PointSize = uSize * (uScale / max(1.0, -mv.z));
      gl_Position = projectionMatrix * mv;
    }
  `;
  const PRECIP_FRAG = /* glsl */ `
    uniform sampler2D map;
    uniform vec3 color;
    uniform float opacity;
    void main() {
      vec4 tex = texture2D(map, gl_PointCoord);
      vec4 c = vec4(color, opacity) * tex;
      if (c.a < 0.01) discard;
      gl_FragColor = c;
    }
  `;

  function ensureParticles(kind: 'rain' | 'snow' | 'none'): void {
    if (kind === particleKind) return;
    particleKind = kind;
    if (precip) { group.remove(precip); precip.geometry.dispose(); precipMat?.dispose(); precip = null; precipMat = null; }
    if (kind === 'none') return;
    const snowy = kind === 'snow';
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const seeds = new Float32Array(PARTICLE_COUNT);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      positions[i * 3] = (Math.random() - 0.5) * PARTICLE_BOX;
      positions[i * 3 + 1] = Math.random() * (PARTICLE_TOP + 6.0) - 6.0;
      positions[i * 3 + 2] = (Math.random() - 0.5) * PARTICLE_BOX;
      seeds[i] = Math.random();
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(positions, 3));
    geo.setAttribute('aSeed', new BufferAttribute(seeds, 1));
    // Rain reads denser than snow at the same coverage; the box itself is identical.
    geo.setDrawRange(0, snowy ? SNOW_COUNT : RAIN_COUNT);
    precipMat = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uFall: { value: snowy ? 3.2 : 34 },
        uSway: { value: snowy ? 1.6 : 0 },
        uTop: { value: PARTICLE_TOP },
        uSize: { value: snowy ? 0.55 : 3.2 },
        uScale: { value: 540 },
        map: { value: snowy ? flakeTex : rainTex },
        color: { value: new Color(snowy ? 0xffffff : 0xd6e6f2) },
        opacity: { value: snowy ? 0.95 : 0.75 },
      },
      vertexShader: PRECIP_VERT,
      fragmentShader: PRECIP_FRAG,
      transparent: true,
      depthWrite: false,
    });
    precip = new Points(geo, precipMat);
    precip.frustumCulled = false;
    precip.name = 'weather-' + kind;
    precip.renderOrder = 10;
    group.add(precip);
  }

  // --- state -----------------------------------------------------------------------------------
  let weather: Weather = 'clear';
  let season: Season = 'summer';
  let curHour = 8, curMonth = 8, curDay = 1;
  let exposure = 0.9;
  const rendererRef: WebGLRenderer | null = renderer ?? null;
  let envWarming = false;
  // §3.1 IBL: diffuse image-based ambient from the live sky. The PMREM is generated from a tiny
  // gradient scene (zenith→horizon→ground) rebuilt only when the look changes (weather/hour/season
  // steps), throttled to 2 s — zero per-frame cost, no HDR assets, no new dependencies. Applied as
  // scene.environment with LOW intensity so CSM sun + hemisphere stay the key/fill and PBR props
  // (kit.ts, characterAssets) gain shadow-side detail instead of a new look.
  let pmrem: { fromScene(s: Scene, sigma: number): { texture: unknown }; dispose(): void } | null = null;
  let envScene: Scene | null = null;
  let lastEnvKey = '';
  let lastEnvAt = -Infinity;
  function ensureEnv(): void {
    if (pmrem || envWarming || !rendererRef) return;
    envWarming = true;
    void import('three').then((m) => {
      try {
        if (!pmrem && rendererRef) pmrem = new m.PMREMGenerator(rendererRef) as unknown as typeof pmrem;
      } catch { pmrem = null; } finally { envWarming = false; }
    }).catch(() => { envWarming = false; });
  }
  function updateEnvironment(scene: Scene, nowMs: number): void {
    ensureEnv();
    const key = `${weather}|${Math.round(curHour * 2)}|${season}|${Math.round(exposure * 20)}`;
    if (key === lastEnvKey || nowMs - lastEnvAt < 2000) return;
    lastEnvKey = key;
    lastEnvAt = nowMs;
    try {
      envScene ??= new Scene();
      while (envScene.children.length) envScene.remove(envScene.children[0]);
      const grad = new CanvasTexture(envGradient());
      grad.colorSpace = SRGBColorSpace;
      grad.mapping = 3001 as unknown as typeof grad.mapping; // EquirectangularReflectionMapping
      envScene.background = grad as unknown as Scene['background'];
      const gen = pmrem;
      if (!gen) { grad.dispose(); return; }
      const rt = gen.fromScene(envScene, 0.6);
      scene.environment = rt.texture as unknown as Scene['environment'];
      (scene as unknown as { environmentIntensity?: number }).environmentIntensity = 0.35;
      grad.dispose();
    } catch { /* IBL must never break the sky */ }
  }
  function envGradient(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 32;
    const g = c.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 0, 32);
    grad.addColorStop(0, `#${look.zenith.getHexString()}`);
    grad.addColorStop(0.52, `#${look.horizon.getHexString()}`);
    grad.addColorStop(0.56, `#${look.haze.getHexString()}`);
    grad.addColorStop(1, '#3a352c');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 32);
    return c;
  }
  const look: SkyLook = {
    zenith: new Color(), horizon: new Color(), haze: new Color(), sunGlow: new Color(),
    light: new Color(), ambient: new Color(), exposure: 0.9,
  };
  const grey = new Color(0x8f9aa4);
  let combatFill = false;
  const nightLight = new Color(0x8fa6d8);
  const nightGlitter = new Color(0x9fb4de);
  const nightCloud = new Color(0x2b3550);
  const sunDir = new Vector3(0.4, 0.7, 0.3);
  const moonDir = new Vector3(0, 1, 0);

  function applySun(): void {
    const doy = dayOfYearFromCalendar(curMonth, curDay);
    const sun = solarPosition(doy, curHour);
    const w = WEATHER[weather];
    const elDeg = (sun.elevation * 180) / Math.PI;
    skyLook(elDeg, look);
    if (w.desat > 0) {
      look.zenith.lerp(grey, w.desat * 0.75);
      look.horizon.lerp(grey, w.desat * 0.80);
      look.haze.lerp(grey, w.desat * 0.55);
      look.sunGlow.lerp(grey, w.desat * 0.85);
      look.light.lerp(grey, w.desat * 0.50);
      look.ambient.lerp(grey, w.desat * 0.35);
    }

    sunDir.copy(bodyVector(sun.elevation, sun.azimuth));
    const moonP = lunarPosition(doy, curHour);
    moonDir.copy(bodyVector(moonP.elevation, moonP.azimuth));

    const night = elDeg < -1;
    const deepNight = elDeg < -8;
    const moonUp = moonP.elevation > 0.02;

    // The Preetham dome goes black the moment the sun crosses the horizon, which kills the blue
    // hour. Hold the *dome's* sun just under the horizon while the real sun keeps sinking, so the
    // low warm band and the deep blue above it survive down to astronomical twilight.
    const domeEl = Math.max(sun.elevation, (-3.5 * Math.PI) / 180);
    const domeDir = bodyVector(domeEl, sun.azimuth);
    const su = (sky.material as any).uniforms;
    su.sunPosition.value.copy(domeDir).multiplyScalar(DOME_R);
    su.turbidity.value = w.turbidity;
    su.rayleigh.value = w.rayleigh * (deepNight ? 0.05 : night ? 0.35 : 1);
    su.mieCoefficient.value = 0.006 + (weather === 'fog' ? 0.012 : 0);
    su.mieDirectionalG.value = 0.82;

    // --- direct light: the sun by day, a much dimmer moon at night ------------------------------
    const lightDir = night && moonUp ? moonDir : night ? bodyVector(0.35, sun.azimuth + Math.PI) : sunDir;
    csm.lightDirection.copy(lightDir).multiplyScalar(-1);
    // CSM reads `lightIntensity` only in its constructor, so per-frame brightness has to be pushed
    // onto the DirectionalLights themselves.
    const dayI = Math.max(0, Math.sin(Math.max(0, sun.elevation)));
    // three r155+ lighting is physical: a 0.1-linear-albedo meadow needs irradiance around 6 to
    // land in the middle of the ACES curve at exposure ~0.9. 1.8 (the pre-r155 habit) renders night.
    // The falloff is pow(sin el, 0.45), not sin el: the beam only loses ~half its strength to air
    // mass at 3 degrees, and N.L already accounts for how obliquely it lands. Scaling the light by
    // sin(el) as well double-counts the angle and turns a 19:00 village into a black frame.
    const intensity = night
      ? (moonUp ? 0.28 + moonP.phase * 0.55 : 0.14) * w.sunMul
      : (0.45 + 5.6 * Math.pow(dayI, 0.45)) * w.sunMul;
    csm.lightIntensity = intensity;
    for (const l of csm.lights) { l.color.copy(night ? nightLight : look.light); l.intensity = intensity; }
    csm.updateFrustums();

    hemi.color.copy(look.ambient);
    hemi.groundColor.setHex(night ? 0x141821 : 0x40382a).lerp(look.ambient, 0.25);
    // Sky light. Physical units: the sun lands ~6 on a meadow at noon, so a hemisphere of ~2.3 puts a
    // shadowed valley at a third of the sunlit tone instead of the 7 % that rendered the Luzern basin
    // black under Pilatus at 19:00 (was 0.55 + 1.9·√dayI). Ramps down over the last two degrees before
    // the night branch so the -1° switch is not a step.
    const twilight = Math.max(0, Math.min(1, (elDeg + 1) / 3));
    const dayHemi = 0.6 + (2.2 + 1.2 * Math.pow(dayI, 0.5) - 0.6) * twilight * (3 - 2 * twilight) * twilight;
    hemi.intensity = (night ? 0.6 + (moonUp ? moonP.phase * 0.30 : 0) : dayHemi) * w.ambientMul;
    if (combatFill) {
      // a tactical fight is read from above: lift the floor of both lights rather than the sky itself
      hemi.intensity = Math.max(hemi.intensity, 2.0);
      for (const l of csm.lights) l.intensity = Math.max(l.intensity, 1.2);
    }

    // --- clouds ----------------------------------------------------------------------------------
    // Cloud bodies take the colour of whatever is lighting them: white at noon, orange at dusk, blue at night.
    cumulusMat.color.setHex(w.cloudTint).lerp(night ? nightCloud : look.light, night ? 0.8 : 0.35);
    cumulusMat.opacity = w.cumulus * (night ? 0.55 : 1);
    overcastMat.color.setHex(w.cloudTint).lerp(night ? nightCloud : look.light, night ? 0.85 : 0.2);
    overcastMat.opacity = w.overcast;
    cumulus.visible = cumulusMat.opacity > 0.01;
    overcast.visible = overcastMat.opacity > 0.01;

    // --- stars / moon ------------------------------------------------------------------------
    const starAmt = Math.max(0, Math.min(1, (-elDeg - 4) / 8)) * (1 - w.overcast);
    stars.visible = starAmt > 0.01;
    (stars.material as PointsMaterial).opacity = starAmt;
    moonMat.opacity = moonUp ? Math.max(0, Math.min(1, (-elDeg + 2) / 8)) * (0.35 + moonP.phase * 0.65) * (1 - w.overcast) : 0;
    moon.visible = moonMat.opacity > 0.02;
    const mp = moonGeo.getAttribute('position') as BufferAttribute;
    mp.setXYZ(0, moonDir.x * DOME_R * 0.9, moonDir.y * DOME_R * 0.9, moonDir.z * DOME_R * 0.9);
    mp.needsUpdate = true;

    // --- fog / aerial perspective / shared atmosphere uniforms -----------------------------------
    const fog = scene.fog as FogExp2;
    fog.color.copy(look.haze);
    hazeMat.color.copy(look.haze);
    fog.density = w.fogDensity;
    (scene.background as Color | null)?.copy?.(look.horizon);

    const { uniforms: tu } = getTerrainMaterial();
    (FOG_UNIFORMS.uFogColor.value as Color).copy(look.haze);
    (FOG_UNIFORMS.uFogSunColor.value as Color).copy(look.sunGlow);
    FOG_UNIFORMS.uFogDensity.value = w.fogDensity;
    FOG_UNIFORMS.uFogBaseY.value = weather === 'fog' ? 90 : 30;
    FOG_UNIFORMS.uFogHeightFalloff.value = weather === 'fog' ? 0.0042 : 0.0016;
    (FOG_UNIFORMS.uSunDir.value as Vector3).copy(night && moonUp ? moonDir : sunDir);

    (ATMOSPHERE.uSkyZenith.value as Color).copy(look.zenith);
    (ATMOSPHERE.uSkyHorizon.value as Color).copy(look.horizon);
    (ATMOSPHERE.uSunTint.value as Color).copy(night ? nightGlitter : look.sunGlow);
    ATMOSPHERE.uGlitter.value = (night ? (moonUp ? 0.35 : 0.0) : 1) * (1 - w.overcast * 0.85);
    ATMOSPHERE.uChop.value = w.chop;

    (tu.uSeasonTint.value as Color).copy(seasonTint(season));
    tu.uWetness.value = w.wetness;
    // Winter lies below the season's snow line too: at Morgarten (game h 102, real 740 m a.s.l. in
    // November) the ground is patchy white, not green, so winter adds a floor of snow everywhere.
    tu.uSnowDepth.value = Math.max(w.snowDepth, season === 'winter' ? 0.45 : 0);

    ensureParticles(w.particles);
    exposure = look.exposure * w.exposureMul;
  }

  function seasonTint(s: Season): Color {
    switch (s) {
      case 'winter': return new Color(0x8b8a70);
      case 'spring': return new Color(0x9fc466);
      case 'autumn': return new Color(0xc09048);
      default: return new Color(0xa2b66a);   // high summer: a shade drier than spring's green
    }
  }

  function applySeason(): void {
    getTerrainMaterial().uniforms.uSnowLine.value = snowLineFor(season);
  }

  applySeason();
  applySun();

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
      applySun();
    },
    setSeason(s: Season) {
      season = s;
      applySeason();
      applySun();
    },
    setCombatFill(on: boolean) {
      combatFill = on;
      applySun();
    },
    wetness() {
      return WEATHER[weather].wetness;
    },
    setShadowSize(px: number) {
      // CSM reads shadowMapSize once in createLights() plus per-frame in update(); push the new size
      // onto all three places so the resize actually takes effect (verified against three r170 CSM.js).
      if (!Number.isFinite(px) || px <= 0) return;
      const size = Math.max(256, Math.min(8192, Math.round(px)));
      csm.shadowMapSize = size;
      for (const l of csm.lights) {
        l.shadow.mapSize.width = size;
        l.shadow.mapSize.height = size;
        // force three to drop the old WebGLShadowMap render target and allocate at the new size
        const map = l.shadow.map as { dispose?: () => void; setSize?: (w: number, h: number) => void } | null;
        if (map?.dispose) map.dispose();
        else if (map?.setSize) map.setSize(size, size);
        (l.shadow as unknown as { needsUpdate?: boolean }).needsUpdate = true;
      }
    },
    update(dt: number, glRenderer: WebGLRenderer) {
      clock += dt;
      camera.updateMatrixWorld(true);
      setViewPosition(camera.position.x, camera.position.y, camera.position.z);
      // Sky/cloud/star domes ride with the camera so they stay at "infinity" across a 17 km map.
      group.position.set(camera.position.x, camera.position.y, camera.position.z);
      groundHaze.position.y = -camera.position.y - 4;   // world y = -4, just under the lake surface
      cloudTex.offset.x = (clock * 0.0016) % 1;
      // CSM refreshes CSM_cascades/cameraNear/shadowFar ONLY inside updateFrustums(); update() alone
      // leaves them stale, and stale cascade bounds put the whole landscape in permanent shadow.
      csm.updateFrustums();
      csm.update();
      glRenderer.toneMappingExposure = exposure;
      // §3.1 IBL: throttled inside (2 s, look-change only) — near-free from here.
      try { updateEnvironment(scene, performance.now()); } catch { /* IBL must never break the frame */ }

      if (precip && precipMat) {
        precipMat.uniforms.uTime.value = clock;
        // Same perspective divisor three.js PointsMaterial uses (half the drawing-buffer height),
        // so uSize keeps its old meaning and coverage is unchanged.
        (precipMat.uniforms.uScale as { value: number }).value = glRenderer.domElement.height * 0.5;
        // precip lives under `group`, which is already at the camera: only offsets are local.
        precip.position.set(0, -PARTICLE_TOP * 0.42, 0);
      }
    },
    dispose() {
      setActiveCsm(null);
      csm.dispose();
      try { pmrem?.dispose(); } catch { /* ignore */ }
      pmrem = null;
      envScene = null;
      scene.environment = null;
      (sky.material as any).dispose();
      sky.geometry.dispose();
      domeGeo.dispose(); cumulusMat.dispose();
      hazeGeo.dispose(); hazeMat.dispose();
      overcastGeo.dispose(); overcastMat.dispose();
      cloudTex.dispose();
      stars.geometry.dispose(); (stars.material as PointsMaterial).dispose(); starTex.dispose();
      moonGeo.dispose(); moonMat.dispose(); moonTex.dispose();
      rainTex.dispose(); flakeTex.dispose();
      if (precip) { precip.geometry.dispose(); precipMat?.dispose(); }
    },
  };
}

/** Deterministic starfield on the upper hemisphere with a plausible magnitude spread. */
function makeStars(tex: CanvasTexture, count = 1500): Points {
  const positions = new Float32Array(count * 3);
  let seed = 20250902 >>> 0;
  const rnd = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < count; i++) {
    const theta = rnd() * Math.PI * 2;
    const y = Math.pow(rnd(), 1.5);           // a few more near the horizon, as the real sky has
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    positions[i * 3] = Math.cos(theta) * r * DOME_R;
    positions[i * 3 + 1] = y * DOME_R * 0.98 + 80;
    positions[i * 3 + 2] = Math.sin(theta) * r * DOME_R;
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(positions, 3));
  const mat = new PointsMaterial({
    map: tex, color: 0xffffff, size: 90, sizeAttenuation: true, transparent: true, opacity: 0,
    blending: AdditiveBlending, depthWrite: false, depthTest: true, fog: false,
  });
  const pts = new Points(geo, mat);
  pts.name = 'stars';
  pts.renderOrder = -85;
  pts.frustumCulled = false;
  return pts;
}
