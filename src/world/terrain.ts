/**
 * Main-thread terrain chunk manager: owns the CPU heightmap (for exact/fast queries), the worker,
 * and the streamed chunk meshes. 500m chunks, 4 LODs, geometry built on the worker, uploaded to the
 * GPU capped at 2 chunks/frame (ARCHITECTURE.md §5.1).
 */
import { BufferAttribute, BufferGeometry, Group, Mesh, Vector3 } from 'three';
import { MAP_BOUNDS } from '@content/gazetteer';
import { BLEND_GROUP, DEFAULT_GRID_H, DEFAULT_GRID_W, SURFACE_IDS, surfaceNameOf, type SurfaceName } from './heightmodel';
const WATER_ID = SURFACE_IDS.indexOf('water');
import { CHUNK_SIZE, LOD_SPACING } from './chunkmesh';
import { loadCachedGrid, saveCachedGrid } from './idbcache';
import { getTerrainMaterial } from './terrainMaterial';
import { buildWorldGeo, insideAnyLake, type WorldGeo } from './geodata';

export const GEOGRAPHY_VERSION = 13; // pads before lake-bed drop, quay-core/road-bench rules; stronger massifProtect
const UPLOAD_PER_FRAME = 2;
let VIEW_RADIUS = 3000; // metres; chunks beyond this are unloaded — big enough for the Seelisberg/Pilatus vistas
const LOD_DIST = [180, 420, 900]; // switch points between LOD0/1/2/3; keeps the triangle budget sane at VIEW_RADIUS

/** Streaming radius override from the settings panel (requests/ui-4, ui-5: `viewDistance`).
 *  The default settings value 4000 maps to the authored 3000 m ring (index.ts scales by 0.75). */
export function setViewRadius(radiusM: number): void {
  if (!Number.isFinite(radiusM)) return;
  VIEW_RADIUS = Math.max(500, Math.min(6000, Math.round(radiusM)));
}

/** Pure far-backdrop sampler, exported so the lake-water invariant has a real regression test. */
export function sampleFarMeshVertex(
  heights: Float32Array,
  surface: Uint8Array,
  width: number,
  height: number,
  ix: number,
  iz: number,
  step: number,
  scaleX: number,
  scaleZ: number,
  geo: WorldGeo,
): { x: number; z: number; terrainHeight: number; water: boolean } {
  const x = MAP_BOUNDS.minX + ix * scaleX;
  const z = MAP_BOUNDS.minZ + iz * scaleZ;
  let terrainHeight = heights[iz * width + ix];
  let water = false;
  for (let bz = Math.max(0, iz - (step >> 1)); bz <= Math.min(height - 1, iz + (step >> 1)); bz += 2) {
    for (let bx = Math.max(0, ix - (step >> 1)); bx <= Math.min(width - 1, ix + (step >> 1)); bx += 2) {
      const j = bz * width + bx;
      if (heights[j] < terrainHeight) terrainHeight = heights[j];
      if (surface[j] === WATER_ID) water = true;
    }
  }
  // Exact polygon containment is the final authority. A playable shore road may deliberately retain
  // a dry high-resolution texel, but it must never lift the separately-decimated distant backdrop.
  const lake = insideAnyLake(x, z, geo);
  if (lake) {
    water = true;
    terrainHeight = Math.min(terrainHeight, lake.levelGameH - 3);
  }
  return { x, z, terrainHeight, water };
}

function lodForDistance(d: number): number {
  if (d < LOD_DIST[0]) return 0;
  if (d < LOD_DIST[1]) return 1;
  if (d < LOD_DIST[2]) return 2;
  return 3;
}

interface ChunkEntry {
  cx: number; cz: number;
  /** worker request the current pendingLod belongs to; a chunkDone for any other id is stale (evicted + re-requested) */
  pendingReq?: number;
  mesh: Mesh | null;
  currentLod: number; // -1 = nothing built yet
  pendingLod: number | null;
  desiredLod: number;
  lastTouch: number;
}

interface ChunkDoneMsg {
  type: 'chunkDone'; requestId: number; cx: number; cz: number; lod: number;
  positions: Float32Array; normals: Float32Array; uvs: Float32Array; surfaceId: Float32Array; indices: Uint32Array;
  allWater: boolean; minY: number; maxY: number;
}
type WorkerMsg = { type: 'generated'; width: number; height: number; heights: Float32Array; surface: Uint8Array } | { type: 'ready' } | ChunkDoneMsg;

export class TerrainManager {
  readonly group = new Group();
  private worker: Worker;
  private chunks = new Map<string, ChunkEntry>();
  private uploadQueue: ChunkDoneMsg[] = [];
  private requestSeq = 1;
  private inFlight = new Set<number>();
  ready: Promise<void>;
  private resolveReady!: () => void;

  // CPU heightmap kept on the main thread for exact/fast queries (heightAt/normalAt/slopeAt/surfaceAt).
  cpuWidth = DEFAULT_GRID_W;
  cpuHeight = DEFAULT_GRID_H;
  cpuScaleX = (MAP_BOUNDS.maxX - MAP_BOUNDS.minX) / (DEFAULT_GRID_W - 1);
  cpuScaleZ = (MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ) / (DEFAULT_GRID_H - 1);
  private heights: Float32Array | null = null;
  private surface: Uint8Array | null = null;

  private focus: { x: number; z: number } | null = null;
  private frameBudgetUsed = 0;
  chunksBuilt = 0;

  constructor(private seed: number, private onChunkLoaded?: (info: { cx: number; cz: number; lod: number; allWater: boolean }) => void) {
    this.worker = new Worker(new URL('./terrain.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<WorkerMsg>) => this.onMessage(e.data);
    this.ready = new Promise((res) => { this.resolveReady = res; });
    void this.init();
  }

  private async init(): Promise<void> {
    const cached = await loadCachedGrid(this.seed, GEOGRAPHY_VERSION);
    if (cached) {
      this.setCpuGrid(cached.width, cached.height, cached.heights, cached.surface);
      const heightsCopy = cached.heights.slice();
      const surfaceCopy = cached.surface.slice();
      this.worker.postMessage(
        { type: 'init', width: cached.width, height: cached.height, heights: heightsCopy, surface: surfaceCopy },
        [heightsCopy.buffer, surfaceCopy.buffer],
      );
    } else {
      this.worker.postMessage({ type: 'generate', seed: this.seed });
    }
  }

  private setCpuGrid(width: number, height: number, heights: Float32Array, surface: Uint8Array): void {
    this.cpuWidth = width; this.cpuHeight = height;
    this.cpuScaleX = (MAP_BOUNDS.maxX - MAP_BOUNDS.minX) / (width - 1);
    this.cpuScaleZ = (MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ) / (height - 1);
    this.heights = heights;
    this.surface = surface;
  }

  private onMessage(msg: WorkerMsg): void {
    if (msg.type === 'generated') {
      this.setCpuGrid(msg.width, msg.height, msg.heights, msg.surface);
      void saveCachedGrid(this.seed, GEOGRAPHY_VERSION, { width: msg.width, height: msg.height, heights: msg.heights, surface: msg.surface });
      this.resolveReady();
    } else if (msg.type === 'ready') {
      this.resolveReady();
    } else if (msg.type === 'chunkDone') {
      this.inFlight.delete(msg.requestId);
      this.uploadQueue.push(msg);
    }
  }

  // ---------------- CPU queries (exact, fast, bilinear) ----------------

  heightAt(x: number, z: number): number {
    if (!this.heights) return 0;
    const gx = (x - MAP_BOUNDS.minX) / this.cpuScaleX;
    const gz = (z - MAP_BOUNDS.minZ) / this.cpuScaleZ;
    const w = this.cpuWidth, h = this.cpuHeight;
    const x0 = Math.max(0, Math.min(w - 2, Math.floor(gx)));
    const z0 = Math.max(0, Math.min(h - 2, Math.floor(gz)));
    const tx = Math.max(0, Math.min(1, gx - x0));
    const tz = Math.max(0, Math.min(1, gz - z0));
    const row0 = z0 * w, row1 = (z0 + 1) * w;
    const H = this.heights;
    const h00 = H[row0 + x0], h10 = H[row0 + x0 + 1], h01 = H[row1 + x0], h11 = H[row1 + x0 + 1];
    const a = h00 + (h10 - h00) * tx;
    const b = h01 + (h11 - h01) * tx;
    return a + (b - a) * tz;
  }

  normalAt(x: number, z: number): Vector3 {
    const eps = Math.max(this.cpuScaleX, this.cpuScaleZ);
    const hL = this.heightAt(x - eps, z), hR = this.heightAt(x + eps, z);
    const hN = this.heightAt(x, z - eps), hS = this.heightAt(x, z + eps);
    const dhdx = (hR - hL) / (2 * eps);
    const dhdz = (hS - hN) / (2 * eps);
    return new Vector3(-dhdx, 1, -dhdz).normalize();
  }

  slopeAt(x: number, z: number): number {
    const n = this.normalAt(x, z);
    return Math.acos(Math.max(-1, Math.min(1, n.y)));
  }

  surfaceIdAt(x: number, z: number): number {
    if (!this.surface) return 0;
    const gx = Math.round((x - MAP_BOUNDS.minX) / this.cpuScaleX);
    const gz = Math.round((z - MAP_BOUNDS.minZ) / this.cpuScaleZ);
    const cx = Math.max(0, Math.min(this.cpuWidth - 1, gx));
    const cz = Math.max(0, Math.min(this.cpuHeight - 1, gz));
    return this.surface[cz * this.cpuWidth + cx];
  }

  surfaceAt(x: number, z: number): SurfaceName {
    return surfaceNameOf(this.surfaceIdAt(x, z));
  }

  isWater(x: number, z: number): boolean {
    return this.surfaceAt(x, z) === 'water';
  }

  // ---------------- streaming ----------------

  private key(cx: number, cz: number): string { return `${cx}|${cz}`; }

  private chunkOrigin(cx: number, cz: number): [number, number] {
    return [MAP_BOUNDS.minX + cx * CHUNK_SIZE, MAP_BOUNDS.minZ + cz * CHUNK_SIZE];
  }

  private chunkRange(): { cxMin: number; cxMax: number; czMin: number; czMax: number } {
    const cxMax = Math.floor((MAP_BOUNDS.maxX - MAP_BOUNDS.minX) / CHUNK_SIZE);
    const czMax = Math.floor((MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ) / CHUNK_SIZE);
    return { cxMin: 0, cxMax, czMin: 0, czMax };
  }

  private ensureRequested(cx: number, cz: number, lod: number, time: number): void {
    const key = this.key(cx, cz);
    let e = this.chunks.get(key);
    if (!e) {
      e = { cx, cz, mesh: null, currentLod: -1, pendingLod: null, desiredLod: lod, lastTouch: time };
      this.chunks.set(key, e);
    }
    e.desiredLod = lod;
    e.lastTouch = time;
    if (e.currentLod === lod || e.pendingLod === lod) return;
    if (!this.heights) return; // grid not ready yet
    const [ox, oz] = this.chunkOrigin(cx, cz);
    const requestId = this.requestSeq++;
    e.pendingLod = lod;
    e.pendingReq = requestId;
    this.inFlight.add(requestId);
    this.worker.postMessage({ type: 'chunk', requestId, cx, cz, lod, originX: ox, originZ: oz });
  }

  private applyRegion(centerX: number, centerZ: number, radius: number, time: number): void {
    const { cxMin, cxMax, czMin, czMax } = this.chunkRange();
    const cx0 = Math.max(cxMin, Math.floor((centerX - radius - MAP_BOUNDS.minX) / CHUNK_SIZE));
    const cx1 = Math.min(cxMax, Math.floor((centerX + radius - MAP_BOUNDS.minX) / CHUNK_SIZE));
    const cz0 = Math.max(czMin, Math.floor((centerZ - radius - MAP_BOUNDS.minZ) / CHUNK_SIZE));
    const cz1 = Math.min(czMax, Math.floor((centerZ + radius - MAP_BOUNDS.minZ) / CHUNK_SIZE));
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const [ox, oz] = this.chunkOrigin(cx, cz);
        const ccx = ox + CHUNK_SIZE / 2, ccz = oz + CHUNK_SIZE / 2;
        const d = Math.hypot(ccx - centerX, ccz - centerZ);
        if (d > radius) continue;
        let lod = lodForDistance(d);
        // hysteresis: a chunk sitting on a LOD boundary keeps its current LOD until the camera moves 12 % past it
        const cur = this.chunks.get(this.key(cx, cz))?.currentLod ?? -1;
        if (cur >= 0 && cur !== lod && Math.abs(cur - lod) === 1) {
          const boundary = LOD_DIST[Math.min(cur, lod)];
          if (Math.abs(d - boundary) < boundary * 0.12) lod = cur;
        }
        this.ensureRequested(cx, cz, lod, time);
      }
    }
  }

  private farMesh: Mesh | null = null;

  /**
   * One static low-resolution mesh of the whole map, drawn behind the streamed chunks so long views end in
   * the Rigi and the Luzern basin rather than haze at VIEW_RADIUS (requests/worldlook-2). Built once from
   * the CPU grid after `ready`; ~256×272 vertices, ~140 k triangles, one draw call, terrain material as-is.
   * Sits 1.5 m under the true surface so the nearer chunks always win the depth test without z-fighting.
   */
  buildFarMesh(step = 8): Mesh | null {
    if (!this.heights || !this.surface || this.farMesh) return this.farMesh;
    const w = this.cpuWidth, h = this.cpuHeight;
    const cols = Math.floor((w - 1) / step) + 1, rows = Math.floor((h - 1) / step) + 1;
    const count = cols * rows;
    const positions = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);
    const uvs = new Float32Array(count * 2);
    const surfaceId = new Float32Array(count);
    const H = this.heights, S = this.surface;
    const geo = buildWorldGeo();
    const gx = (c: number) => Math.min(w - 1, c * step), gz = (r: number) => Math.min(h - 1, r * step);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const ix = gx(c), iz = gz(r);
        const i = r * cols + c;
        const sample = sampleFarMeshVertex(H, S, w, h, ix, iz, step, this.cpuScaleX, this.cpuScaleZ, geo);
        const { x, z, terrainHeight: hMin, water } = sample;
        positions[i * 3] = x; positions[i * 3 + 1] = hMin - 1.5; positions[i * 3 + 2] = z;
        const xl = Math.max(0, ix - step), xr = Math.min(w - 1, ix + step), zn = Math.max(0, iz - step), zs = Math.min(h - 1, iz + step);
        const dhdx = (H[iz * w + xr] - H[iz * w + xl]) / ((xr - xl) * this.cpuScaleX);
        const dhdz = (H[zs * w + ix] - H[zn * w + ix]) / ((zs - zn) * this.cpuScaleZ);
        const nl = Math.hypot(dhdx, 1, dhdz);
        normals[i * 3] = -dhdx / nl; normals[i * 3 + 1] = 1 / nl; normals[i * 3 + 2] = -dhdz / nl;
        uvs[i * 2] = x / 40; uvs[i * 2 + 1] = z / 40;
        surfaceId[i] = BLEND_GROUP[water ? WATER_ID : S[iz * w + ix]] ?? 0;
      }
    }
    const indices = new Uint32Array((cols - 1) * (rows - 1) * 6);
    let k = 0;
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
        indices[k++] = a; indices[k++] = d; indices[k++] = b;
        indices[k++] = b; indices[k++] = d; indices[k++] = e;
      }
    }
    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(positions, 3));
    geom.setAttribute('normal', new BufferAttribute(normals, 3));
    geom.setAttribute('uv', new BufferAttribute(uvs, 2));
    geom.setAttribute('surfaceId', new BufferAttribute(surfaceId, 1));
    geom.setIndex(new BufferAttribute(indices, 1));
    geom.computeBoundingSphere();
    const mesh = new Mesh(geom, getTerrainMaterial().material);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.name = 'terrain-far';
    this.group.add(mesh);
    this.farMesh = mesh;
    this.farBaseY = Float32Array.from(positions.filter((_, i) => i % 3 === 1));
    return mesh;
  }

  /** the backdrop's authored heights (its position attribute is lowered near the camera, see `cutFarNearCamera`) */
  private farBaseY: Float32Array | null = null;
  private farCutAt = { x: NaN, z: NaN };

  /**
   * Inside the streamed ring the backdrop must never show through: its 62 m triangles interpolate ABOVE the
   * fine surface in every concavity (a valley floor, a flattened village pad), which cut the villagers off
   * at the waist even though the 1.5 m offset held on open slopes. Vertices within the ring are sunk 60 m
   * (a smooth band up to the ring's edge, where streamed chunks end anyway); recomputed only when the
   * camera has moved 150 m, ~70 k vertices per pass.
   */
  private cutFarNearCamera(camX: number, camZ: number): void {
    const mesh = this.farMesh, base = this.farBaseY;
    if (!mesh || !base) return;
    if (Math.hypot(camX - this.farCutAt.x, camZ - this.farCutAt.z) < 150) return;
    this.farCutAt = { x: camX, z: camZ };
    const pos = mesh.geometry.attributes.position as BufferAttribute;
    const arr = pos.array as Float32Array;
    const inner = VIEW_RADIUS - 500, outer = VIEW_RADIUS - 100;
    for (let i = 0, n = base.length; i < n; i++) {
      const dx = arr[i * 3] - camX, dz = arr[i * 3 + 2] - camZ;
      const d = Math.sqrt(dx * dx + dz * dz);
      const t = d <= inner ? 1 : d >= outer ? 0 : 1 - (d - inner) / (outer - inner);
      arr[i * 3 + 1] = base[i] - 60 * t;
    }
    pos.needsUpdate = true;
  }

  /** Called every frame by the world system with the current camera position. */
  update(camPos: { x: number; z: number }, frameTime: number): void {
    this.cutFarNearCamera(camPos.x, camPos.z);
    this.applyRegion(camPos.x, camPos.z, VIEW_RADIUS, frameTime);
    if (this.focus) this.applyRegion(this.focus.x, this.focus.z, 900, frameTime);

    // evict chunks that have drifted well outside anything we care about
    const evictDist = VIEW_RADIUS + CHUNK_SIZE * 1.5;
    for (const [key, e] of this.chunks) {
      if (frameTime - e.lastTouch < 0.001) continue; // touched this frame
      const [ox, oz] = this.chunkOrigin(e.cx, e.cz);
      const ccx = ox + CHUNK_SIZE / 2, ccz = oz + CHUNK_SIZE / 2;
      const d = Math.hypot(ccx - camPos.x, ccz - camPos.z);
      const nearFocus = this.focus && Math.hypot(ccx - this.focus.x, ccz - this.focus.z) < 900 + CHUNK_SIZE;
      if (d > evictDist && !nearFocus) {
        if (e.mesh) { this.group.remove(e.mesh); e.mesh.geometry.dispose(); e.mesh = null; }
        this.chunks.delete(key);
      }
    }

    this.frameBudgetUsed = 0;
    while (this.frameBudgetUsed < UPLOAD_PER_FRAME && this.uploadQueue.length) {
      const msg = this.uploadQueue.shift()!;
      this.uploadChunk(msg);
      this.frameBudgetUsed++;
    }
  }

  private uploadChunk(msg: ChunkDoneMsg): void {
    const e = this.chunks.get(this.key(msg.cx, msg.cz));
    if (!e) return; // evicted while the worker was building it
    if (e.pendingReq !== undefined && msg.requestId !== e.pendingReq) return; // stale build for an entry evicted and re-created since (bughunt world-runtime #1)
    if (e.mesh) { this.group.remove(e.mesh); e.mesh.geometry.dispose(); e.mesh = null; }
    e.pendingLod = null;
    e.pendingReq = undefined;
    e.currentLod = msg.lod;
    if (msg.allWater) { this.onChunkLoaded?.({ cx: msg.cx, cz: msg.cz, lod: msg.lod, allWater: true }); return; } // fully submerged chunk: the lake mesh covers it, skip the draw call
    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(msg.positions, 3));
    geom.setAttribute('normal', new BufferAttribute(msg.normals, 3));
    geom.setAttribute('uv', new BufferAttribute(msg.uvs, 2));
    geom.setAttribute('surfaceId', new BufferAttribute(msg.surfaceId, 1));
    geom.setIndex(new BufferAttribute(msg.indices, 1));
    geom.computeBoundingSphere();
    const { material } = getTerrainMaterial();
    const mesh = new Mesh(geom, material);
    // Shadow receiving was previously forced off everywhere: the "black frame" that motivated it was
    // the harness camera sitting *inside* the mountain (peaks overshot the gazetteer by up to +133m —
    // see heightmodel.ts step 2's fix), rendering unlit back-faces, not a CSM/shadow-shader bug. With
    // peaks now clamped to the gazetteer target height and cameras genuinely above ground, terrain
    // receives its own shadows again.
    mesh.receiveShadow = true;
    // Terrain does NOT cast shadows (onto itself/vegetation/props): with up to ~100+ chunks in view
    // and CSM's 3 cascades each requiring an extra shadow-map draw per cast-shadow object, this alone
    // was responsible for a 25x draw-call blowup (105 -> 2660, budget ≤1200) in testing — terrain
    // self-shadowing is a much smaller visual win than staying inside the draw-call budget. Terrain
    // still *receives* shadows (from vegetation/props) via receiveShadow above.
    mesh.castShadow = false;
    mesh.name = `terrain-chunk-${msg.cx}-${msg.cz}`;
    e.mesh = mesh;
    this.group.add(mesh);
    this.chunksBuilt++;
    this.onChunkLoaded?.({ cx: msg.cx, cz: msg.cz, lod: msg.lod, allWater: false });
  }

  /** Prioritise streaming around an arbitrary point (teleport/load) without moving the camera. */
  setFocus(x: number, z: number): void { this.focus = { x, z }; }
  clearFocus(): void { this.focus = null; }

  isSettledAround(x: number, z: number, radius: number): boolean {
    const { cxMin, cxMax, czMin, czMax } = this.chunkRange();
    const cx0 = Math.max(cxMin, Math.floor((x - radius - MAP_BOUNDS.minX) / CHUNK_SIZE));
    const cx1 = Math.min(cxMax, Math.floor((x + radius - MAP_BOUNDS.minX) / CHUNK_SIZE));
    const cz0 = Math.max(czMin, Math.floor((z - radius - MAP_BOUNDS.minZ) / CHUNK_SIZE));
    const cz1 = Math.min(czMax, Math.floor((z + radius - MAP_BOUNDS.minZ) / CHUNK_SIZE));
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const [ox, oz] = this.chunkOrigin(cx, cz);
        const ccx = ox + CHUNK_SIZE / 2, ccz = oz + CHUNK_SIZE / 2;
        if (Math.hypot(ccx - x, ccz - z) > radius) continue;
        const e = this.chunks.get(this.key(cx, cz));
        if (!e || e.currentLod === -1 || e.pendingLod !== null) return false;
      }
    }
    return true;
  }

  /** Chunks that currently have a built mesh (or are known-all-water), for vegetation/prop placement to hook into. */
  listActiveChunks(): { key: string; cx: number; cz: number; originX: number; originZ: number; lod: number }[] {
    const out: { key: string; cx: number; cz: number; originX: number; originZ: number; lod: number }[] = [];
    for (const [key, e] of this.chunks) {
      if (e.currentLod === -1) continue;
      const [ox, oz] = this.chunkOrigin(e.cx, e.cz);
      out.push({ key, cx: e.cx, cz: e.cz, originX: ox, originZ: oz, lod: e.currentLod });
    }
    return out;
  }

  stats(): { chunksLoaded: number; chunksPending: number } {
    let pending = 0;
    for (const e of this.chunks.values()) if (e.pendingLod !== null) pending++;
    return { chunksLoaded: this.chunks.size, chunksPending: pending + this.uploadQueue.length };
  }

  dispose(): void {
    for (const e of this.chunks.values()) if (e.mesh) { e.mesh.geometry.dispose(); }
    this.chunks.clear();
    this.worker.terminate();
  }
}
