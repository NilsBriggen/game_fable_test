/**
 * Vegetation: one global InstancedMesh pool per species per LOD tier, populated from the chunks the
 * terrain streamer has active. Three tiers — full mesh under 60 m, reduced mesh under 250 m,
 * billboard impostor beyond (ARCHITECTURE §5.1) — chosen from the real camera distance rather than
 * the terrain's own chunk LOD, plus ground cover (grass tufts, ferns, herbs, loose stones) in the
 * near ring. Only the near tier casts shadows: CSM re-draws every caster once per cascade, so a
 * shadow from a tree 300 m away costs three passes for something a pixel wide.
 *
 * Placement is deterministic per chunk (hash of seed + chunk coords) from surface, slope and height,
 * nothing is planted above the tree line (LORE §3: 1500 m a.s.l. -> game h 355), and a low-frequency
 * "glade" field thins the canopy in patches so a wood has clearings to walk through instead of being
 * a uniform lawn of trunks.
 *
 * Two runtime properties this file is careful about, both from the wave-2 bug hunt
 * (tools/critic/bughunt/world-runtime.md #3 and #6):
 *
 *  * **Pools grow instead of dropping.** Two adjacent all-forest chunks at full tier want ~2 680
 *    spruce between them; a fixed 2 600-slot pool silently handed back `null` and the trees simply
 *    stopped appearing, with no log. Pools now reallocate (matrices and colours copied) when they
 *    run out, and only warn if they hit the hard ceiling.
 *  * **`update()` allocates nothing.** It runs every frame from the `world-stream` system; the old
 *    version built a `Set` and two array spreads per frame whether or not anything had changed.
 */
import { Color, DynamicDrawUsage, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, Vector3, type BufferGeometry } from 'three';
import { Rng, hashString } from '@core/rng';
import type { TerrainManager } from './terrain';
import { FOREST_MAX_H } from './heightmodel';
import { fbm2D } from './noise';
import { buildTreeGeometry, treeImpostor, treeMaterial, groundCover, type TreeKind } from './treeGeometry';
import { getViewPosition, registerCsmMaterial } from './shadowCsm';
import { buildSplatMask, splatMaskReady, getTerrainMaterial } from './terrainMaterial';
import { rockGeometry, rockScanMaterial, type RockKind } from './look/rocks';

type Tier = 'full' | 'mid' | 'impostor';

/** One candidate grid for every tier, so a tree keeps its place when its cell changes tier and
 *  only the mesh swaps under it. */
const SPACING = 9.0;
/** Chunks the terrain itself has dropped to LOD2/3 are ≥900 m away; keep this fraction of the
 *  candidates there. Sparser than that made a wooded slope read as scattered individual trees from
 *  across the Urnersee; denser and a whole valley of overlapping alpha-tested billboards becomes the
 *  frame's dominant cost. */
const FAR_KEEP = 0.38;
/** Same idea for the impostor tier inside 900 m (≈ one tree per 10.8 m). */
const IMPOSTOR_KEEP = 0.7;
/** Tier by distance from the camera to the nearest point of a 125 m CELL, not of the 500 m chunk:
 *  the terrain switches LOD at 180/420/900 m, but §5.1 wants tree impostors from 250 m, and a whole
 *  chunk at LOD0 put ~4 000 full-detail trees on screen for a camera that could see 70 m of them
 *  (wave-2 capture: 11.4 M triangles at Altdorf against a 3 M budget). */
const TIER_DIST = { full: 60, mid: 250 };
const CELL = 125;
const CELLS = 4;                       // per chunk side
const TIER_CODE: Record<Tier, number> = { full: 0, mid: 1, impostor: 2 };
const TIER_OF = ['full', 'mid', 'impostor'] as const;
/** 2 bits per cell, 16 cells: the signature of a chunk with every cell in the impostor tier. */
const ALL_IMPOSTOR = 0xaaaaaaaa;
/** Grass tufts; the ring the bar cares about ("near-field ground within 40 m") plus a margin. */
const GRASS_RADIUS = 52;
const GRASS_SPACING = 2.4;
/** Stones, ferns and herbs — the bar's "small clutter within 40 m". */
const CLUTTER_RADIUS = 40;

/** Treeline in game metres (LORE §3: real 1500 m a.s.l. -> h≈355). */
const TREELINE = FOREST_MAX_H;

const TREE_SPECIES: { kind: TreeKind; weight: number }[] = [
  { kind: 'spruce', weight: 0.5 }, { kind: 'fir', weight: 0.19 }, { kind: 'larch', weight: 0.13 }, { kind: 'beech', weight: 0.18 },
];

/** Per-pool starting capacity: a typical scene, not the worst case — grow() covers the rest, and a
 *  worst-case pool for every species up front is heap that is never used. */
const CAPACITY: Record<string, number> = { full: 1200, mid: 3000, impostor: 12000, rock: 500, cover: 5000 };
const HARD_CAP = 70000;

interface Pool {
  key: string;
  mesh: InstancedMesh;
  capacity: number;
  free: number[];
  /** InstancedMesh renders [0, count); with a free-list the live slots can be scattered, so track
   * the highest index ever handed out. Freed slots below it get a zero-scale matrix. */
  highWater: number;
  casts: boolean;
  /** per-instance tint (grass/foliage colour variation) */
  tinted: boolean;
}

interface Alloc { poolKey: string; index: number }

const tmpMat = new Matrix4();
const tmpPos = new Vector3();
const tmpQuat = new Quaternion();
const tmpTilt = new Quaternion();
const tmpScale = new Vector3();
const tmpColor = new Color();
/** registerCsmMaterial() wraps onBeforeCompile; the tree/impostor/cover materials are shared
 *  singletons across ~12 pools and their factories already register themselves, so without this
 *  every pool would wrap the same material's compile hook again. */
const csmRegistered = new WeakSet<MeshStandardMaterial>();
const UP = new Vector3(0, 1, 0);
const tiltAxis = new Vector3();

export class VegetationManager {
  readonly group = new Group();
  private pools = new Map<string, Pool>();
  private chunkAlloc = new Map<string, Alloc[]>();
  /** per-chunk tier signature: 2 bits per 125 m cell (see TIER_CODE) */
  private chunkTier = new Map<string, number>();
  private chunkGrass = new Map<string, Alloc[]>();
  private maskKicked = false;
  private overflowWarned = false;
  /** reused across frames: update() must not allocate (bughunt world-runtime #6) */
  private activeKeys = new Set<string>();
  private dirtyPools = new Set<Pool>();

  constructor(private seed: number, private terrain: TerrainManager) {
    this.group.name = 'vegetation';
  }

  private poolFor(key: string, capacity: number, build: () => { geometry: BufferGeometry; material: MeshStandardMaterial }, casts = true, tinted = false): Pool {
    let p = this.pools.get(key);
    if (p) return p;
    const { geometry, material } = build();
    if (!csmRegistered.has(material)) { csmRegistered.add(material); registerCsmMaterial(material); }
    const mesh = this.makeMesh(key, geometry, material, capacity, casts);
    this.group.add(mesh);
    const free: number[] = [];
    for (let i = capacity - 1; i >= 0; i--) free.push(i);
    p = { key, mesh, capacity, free, highWater: 0, casts, tinted };
    this.pools.set(key, p);
    return p;
  }

  private makeMesh(key: string, geometry: BufferGeometry, material: MeshStandardMaterial, capacity: number, casts: boolean): InstancedMesh {
    const mesh = new InstancedMesh(geometry, material, capacity);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.count = 0;
    mesh.castShadow = casts;
    mesh.receiveShadow = true;
    mesh.name = `veg-${key}`;
    mesh.frustumCulled = true;
    return mesh;
  }

  /**
   * Reallocate a full pool at 1.7x. Slot indices are preserved, so every Alloc already handed out
   * stays valid; only the InstancedMesh object is replaced.
   */
  private grow(pool: Pool): boolean {
    if (pool.capacity >= HARD_CAP) {
      if (!this.overflowWarned) {
        this.overflowWarned = true;
        console.warn(`[world] vegetation pool ${pool.key} hit the ${HARD_CAP} instance ceiling; some plants will not be placed`);
      }
      return false;
    }
    const next = Math.min(HARD_CAP, Math.ceil(pool.capacity * 1.7));
    const old = pool.mesh;
    const mesh = this.makeMesh(pool.key, old.geometry as BufferGeometry, old.material as MeshStandardMaterial, next, pool.casts);
    mesh.instanceMatrix.array.set(old.instanceMatrix.array as Float32Array);
    if (old.instanceColor) {
      const arr = new Float32Array(next * 3).fill(1);
      arr.set(old.instanceColor.array as Float32Array);
      mesh.instanceColor = new InstancedBufferAttribute(arr, 3);
      mesh.instanceColor.setUsage(DynamicDrawUsage);
      mesh.instanceColor.needsUpdate = true;
    }
    mesh.count = old.count;
    this.group.remove(old);
    old.dispose();
    this.group.add(mesh);
    for (let i = next - 1; i >= pool.capacity; i--) pool.free.push(i);
    pool.mesh = mesh;
    pool.capacity = next;
    this.dirtyPools.add(pool);
    return true;
  }

  private treePool(kind: TreeKind, tier: Tier): Pool {
    if (tier === 'impostor') return this.poolFor(`tree.${kind}.impostor`, CAPACITY.impostor, () => treeImpostor(kind), false);
    const lod: 0 | 1 = tier === 'full' ? 0 : 1;
    // Only the near tier casts: CSM re-draws every caster once per cascade, so shadows from trees
    // past ~100 m cost three extra passes for something a pixel wide.
    return this.poolFor(`tree.${kind}.${tier}`, tier === 'full' ? CAPACITY.full : CAPACITY.mid,
      () => ({ geometry: buildTreeGeometry(kind, new Rng(7 + lod), lod), material: treeMaterial() }), tier === 'full', true);
  }
  private rockPool(size: RockKind): Pool {
    // Real decimated photogrammetry scans (look/rocks.ts); the geometry object is filled in place
    // when the JSON lands, so the pool can be created before the fetch resolves.
    return this.poolFor(`rock.${size}`, CAPACITY.rock, () => ({ geometry: rockGeometry(size), material: rockScanMaterial() }), size !== 'pebble');
  }
  private coverPool(kind: 'grass' | 'grassDry' | 'fern' | 'herb'): Pool {
    const shape: Record<string, [number, number, number]> = {
      grass: [3, 0.7, 0.62], grassDry: [3, 0.72, 0.66], fern: [3, 1.05, 0.85], herb: [2, 0.5, 0.42],
    };
    const [blades, w, h] = shape[kind];
    return this.poolFor(`cover.${kind}`, CAPACITY.cover, () => groundCover(kind, blades, w, h), false, true);
  }

  private alloc(pool: Pool): number | null {
    if (!pool.free.length && !this.grow(pool)) return null;
    const idx = pool.free.pop();
    if (idx === undefined) return null;
    if (idx + 1 > pool.highWater) pool.highWater = idx + 1;
    return idx;
  }

  private setInstance(pool: Pool, index: number, x: number, y: number, z: number, yaw: number, scale: number, lean = 0, leanDir = 0, scaleY = scale): void {
    tmpPos.set(x, y, z);
    tmpQuat.setFromAxisAngle(UP, yaw);
    if (lean > 0.001) {
      tiltAxis.set(Math.cos(leanDir), 0, Math.sin(leanDir));
      tmpTilt.setFromAxisAngle(tiltAxis, lean);
      tmpQuat.premultiply(tmpTilt);
    }
    tmpScale.set(scale, scaleY, scale);
    tmpMat.compose(tmpPos, tmpQuat, tmpScale);
    pool.mesh.setMatrixAt(index, tmpMat);
    this.dirtyPools.add(pool);
  }

  /** Per-instance tint. Multiplies the geometry's own vertex colours (three's instancing_color chunk). */
  private setTint(pool: Pool, index: number, r: number, g: number, b: number): void {
    if (!pool.tinted) return;
    tmpColor.setRGB(r, g, b);
    pool.mesh.setColorAt(index, tmpColor);
    if (pool.mesh.instanceColor) pool.mesh.instanceColor.needsUpdate = true;
  }

  /** Called every frame by the world 'always' system after terrain streaming. */
  update(): void {
    const view = getViewPosition();
    const camX = view.x, camZ = view.z;
    // The terrain splat mask can only be baked once the CPU grid exists; this is the first place in
    // the world module that is guaranteed to run after `await terrain.ready`.
    if (!this.maskKicked && !splatMaskReady()) {
      this.maskKicked = true;
      buildSplatMask((x, z) => this.terrain.surfaceIdAt(x, z), this.terrain.cpuWidth, this.terrain.cpuHeight, (x, z) => this.terrain.heightAt(x, z));
    }
    const active = this.terrain.listActiveChunks();
    this.activeKeys.clear();
    for (let i = 0; i < active.length; i++) this.activeKeys.add(active[i].key);
    // Map iteration tolerates deletion of the entry currently being visited, so this needs no copy.
    for (const key of this.chunkAlloc.keys()) if (!this.activeKeys.has(key)) this.freeChunk(key);
    for (const key of this.chunkGrass.keys()) if (!this.activeKeys.has(key)) this.freeGrass(key);

    for (let i = 0; i < active.length; i++) {
      const c = active[i];
      // distance from the camera to the nearest point of this 500 m chunk
      const ddx = Math.max(c.originX - camX, 0, camX - (c.originX + 500));
      const ddz = Math.max(c.originZ - camZ, 0, camZ - (c.originZ + 500));
      const d = Math.hypot(ddx, ddz);
      let sig = ALL_IMPOSTOR;
      if (d < TIER_DIST.mid) {
        sig = 0;
        for (let i = 0; i < CELLS * CELLS; i++) {
          const x0 = c.originX + (i % CELLS) * CELL, z0 = c.originZ + Math.floor(i / CELLS) * CELL;
          const cdx = Math.max(x0 - camX, 0, camX - (x0 + CELL));
          const cdz = Math.max(z0 - camZ, 0, camZ - (z0 + CELL));
          const cd = Math.hypot(cdx, cdz);
          sig |= (cd < TIER_DIST.full ? 0 : cd < TIER_DIST.mid ? 1 : 2) << (2 * i);
        }
        sig >>>= 0;
      }
      if (this.chunkTier.get(c.key) !== sig) {
        this.freeChunk(c.key);
        this.chunkTier.set(c.key, sig);
        this.populateChunk(c.key, c.cx, c.cz, c.originX, c.originZ, sig, c.lod);
      }
      const near = d < GRASS_RADIUS;
      const hasGrass = this.chunkGrass.has(c.key);
      if (near && !hasGrass) this.populateGround(c.key, c.cx, c.cz, c.originX, c.originZ, camX, camZ);
      else if (!near && hasGrass) this.freeGrass(c.key);
    }
    for (const p of this.dirtyPools) {
      p.mesh.count = p.highWater;
      p.mesh.instanceMatrix.needsUpdate = true;
      p.mesh.computeBoundingSphere();
    }
    this.dirtyPools.clear();
  }

  private release(list: Alloc[] | undefined): void {
    if (!list) return;
    for (const a of list) {
      const pool = this.pools.get(a.poolKey);
      if (!pool) continue;
      tmpMat.makeScale(0, 0, 0);
      pool.mesh.setMatrixAt(a.index, tmpMat);
      pool.free.push(a.index);
      this.dirtyPools.add(pool);
    }
  }

  /** Season changed after populate (harness scenario, save load, a long night): drop every chunk's
   *  instances so the next update re-tints and re-thins them for the new snow depth. */
  reseason(): void {
    for (const key of [...this.chunkAlloc.keys()]) this.freeChunk(key);
    for (const key of [...this.chunkGrass.keys()]) this.freeGrass(key);
    this.chunkTier.clear();
  }

  private freeChunk(key: string): void {
    this.release(this.chunkAlloc.get(key));
    this.chunkAlloc.delete(key);
    this.chunkTier.delete(key);
  }

  private freeGrass(key: string): void {
    this.release(this.chunkGrass.get(key));
    this.chunkGrass.delete(key);
  }

  /**
   * How wintry the world currently is, read from the terrain material's own live snow uniform
   * (sky.ts writes it from the season and the weather). Ground cover and foliage tint follow it:
   * a scene whose ground is under snow with bright summer grass tufts standing in it and green
   * beeches behind them is worse than no ground cover at all.
   */
  private snowiness(): number {
    return Math.min(1, Number(getTerrainMaterial().uniforms.uSnowDepth.value) || 0);
  }

  /** Low-frequency clearing field: 0 in a glade, 1 in closed canopy. ~120 m features. */
  private glade(x: number, z: number): number {
    const n = fbm2D(x, z, { octaves: 2, frequency: 0.0082, seed: 9001 });
    return Math.min(1, Math.max(0, (n + 0.42) * 1.35));
  }

  private populateChunk(key: string, cx: number, cz: number, originX: number, originZ: number, sig: number, lod: number): void {
    const allocs: Alloc[] = [];
    for (let cell = 0; cell < CELLS * CELLS; cell++) {
      const tier: Tier = TIER_OF[(sig >>> (2 * cell)) & 3] ?? 'impostor';
      const ox = originX + (cell % CELLS) * CELL, oz = originZ + Math.floor(cell / CELLS) * CELL;
      // one RNG stream per cell: a cell changing tier must not reshuffle its neighbours' trees
      const rng = new Rng(hashString(`${this.seed}:veg:${cx}:${cz}:${cell}`) >>> 0);
      this.populateCell(rng, ox, oz, tier, lod, allocs);
    }
    this.chunkAlloc.set(key, allocs);
  }

  private populateCell(rng: Rng, originX: number, originZ: number, tier: Tier, lod: number, allocs: Alloc[]): void {
    const spacing = SPACING;
    const size = CELL;
    const keep = tier !== 'impostor' ? 1 : lod >= 2 ? FAR_KEEP : IMPOSTOR_KEEP;
    for (let gz = 0; gz < size; gz += spacing) {
      for (let gx = 0; gx < size; gx += spacing) {
        const x = originX + gx + (rng.next() - 0.5) * spacing * 0.85;
        const z = originZ + gz + (rng.next() - 0.5) * spacing * 0.85;
        // consumed on every tier so the stream stays aligned; only the far impostors are thinned
        if (rng.next() > keep) continue;
        const surface = this.terrain.surfaceAt(x, z);
        if (surface === 'water' || surface === 'road' || surface === 'settlement') continue;
        const y = this.terrain.heightAt(x, z);
        if (y > TREELINE) continue; // LORE §3: nothing grows above game h 355
        // slopeAt() goes through normalAt(), which allocates a Vector3 per call; do it last so the
        // ~3 500 candidates per chunk only pay for it once surface and altitude have passed
        const slope = this.terrain.slopeAt(x, z);
        if (slope > 0.72) continue;

        let treeChance = 0, rockChance = 0;
        if (surface === 'forest') { treeChance = 0.86 * (0.35 + 0.65 * this.glade(x, z)); rockChance = 0.010; }
        else if (surface === 'grass' || surface === 'meadow') { treeChance = tier === 'impostor' ? 0.03 : 0.05; rockChance = 0.008; }
        else if (surface === 'scree' || surface === 'rock') { treeChance = y < TREELINE * 0.8 ? 0.03 : 0; rockChance = 0.06; }
        else if (surface === 'mud') { treeChance = 0.03; }
        // The scans are 260-640 triangles each; scattered over every chunk in the 3 km stream radius
        // they were several million triangles of stones nobody could see. Past 250 m the scree and
        // rock layers of the terrain carry the stones.
        if (tier === 'impostor') rockChance = 0;

        const roll = rng.next();
        if (roll < treeChance) {
          // mountain pine takes over the last 15% below the treeline; beech drops out above ~2/3
          const alt = y / TREELINE;
          const kind: TreeKind = alt > 0.85 ? 'pine' : pickSpecies(rng, alt);
          const pool = this.treePool(kind, tier);
          const idx = this.alloc(pool);
          if (idx !== null) {
            const scale = (0.8 + rng.next() * 0.5) * (1 - 0.25 * Math.max(0, alt - 0.6));
            // a stand is not one tree stamped N times: vary the height/width ratio too
            const scaleY = scale * (0.86 + rng.next() * 0.34);
            const lean = tier === 'impostor' ? 0 : Math.min(slope * 0.35, 0.16);
            this.setInstance(pool, idx, x, y, z, rng.next() * Math.PI * 2, scale, lean, rng.next() * Math.PI * 2, scaleY);
            // foliage tint: cooler/darker in the shade of a closed stand, warmer on an open edge,
            // and drained toward grey-brown once the snow uniform says it is winter
            // beech leaves come out of the shrub_01 sheet already lime-bright; unscaled they read as
            // lollipops next to the dark conifers
            const t = (kind === 'beech' ? 0.70 : 0.84) + rng.next() * 0.22;
            const wnt = this.snowiness();
            const r = t * (0.94 + rng.next() * 0.12), g = t, b = t * (0.9 + rng.next() * 0.14);
            this.setTint(pool, idx, r * (1 + wnt * 0.35), g * (1 - wnt * 0.22), b * (1 - wnt * 0.05));
            allocs.push({ poolKey: pool.key, index: idx });
          }
        } else if (roll < treeChance + rockChance) {
          const pool = this.rockPool(rng.next() < 0.4 && tier === 'full' ? 'large' : 'small');
          const idx = this.alloc(pool);
          if (idx !== null) {
            this.setInstance(pool, idx, x, y, z, rng.next() * Math.PI * 2, 0.6 + rng.next() * 0.9);
            allocs.push({ poolKey: pool.key, index: idx });
          }
        }
      }
    }
  }

  /**
   * Ground cover in the near ring: grass tufts on pasture, ferns and stones in the wood, herbs on
   * the meadow, loose pebbles on scree and on the village yard. This is what the near-field bar is
   * about — bare ground within 40 m reads as a painted texture no matter how good the texture is.
   */
  private populateGround(key: string, cx: number, cz: number, originX: number, originZ: number, camX: number, camZ: number): void {
    const rng = new Rng(hashString(`${this.seed}:grass:${cx}:${cz}`) >>> 0);
    const allocs: Alloc[] = [];
    const step = GRASS_SPACING;
    const x0 = Math.max(originX, camX - GRASS_RADIUS), x1 = Math.min(originX + 500, camX + GRASS_RADIUS);
    const z0 = Math.max(originZ, camZ - GRASS_RADIUS), z1 = Math.min(originZ + 500, camZ + GRASS_RADIUS);
    for (let z = z0; z < z1; z += step) {
      for (let x = x0; x < x1; x += step) {
        const px = x + (rng.next() - 0.5) * step;
        const pz = z + (rng.next() - 0.5) * step;
        const dist = Math.hypot(px - camX, pz - camZ);
        if (dist > GRASS_RADIUS) continue;
        const roll = rng.next();
        const surface = this.terrain.surfaceAt(px, pz);
        if (surface === 'water') continue;
        const slope = this.terrain.slopeAt(px, pz);
        if (slope > 0.75) continue;
        const y = this.terrain.heightAt(px, pz);

        let pool: Pool | null = null;
        let scale = 0.8 + rng.next() * 0.7;
        let tintR = 1, tintG = 1, tintB = 1;
        const winter = this.snowiness();
        if (surface === 'grass' || surface === 'meadow') {
          // winter thins the sward to stubble poking through the snow
          if (roll > 0.62 - winter * 0.42) continue;
          const dry = surface === 'meadow' || y > 150 || winter > 0.25;
          pool = this.coverPool(dry && (winter > 0.25 || rng.next() < 0.55) ? 'grassDry' : 'grass');
          // real pasture is not one green: spread the tufts over a yellow-to-blue-green range
          const k = rng.next();
          tintR = 0.78 + k * 0.5; tintG = 0.86 + rng.next() * 0.3; tintB = 0.7 + (1 - k) * 0.42;
          if (winter > 0.25) { tintR = 1.05 + k * 0.25; tintG = 1.0 + k * 0.2; tintB = 0.92 + k * 0.2; scale *= 0.7; }
        } else if (surface === 'forest') {
          if (dist > CLUTTER_RADIUS || roll > 0.34 - winter * 0.26) continue;
          pool = rng.next() < 0.55 ? this.coverPool('fern') : this.coverPool('herb');
          tintR = 0.8 + rng.next() * 0.25; tintG = 0.85 + rng.next() * 0.28; tintB = 0.75 + rng.next() * 0.25;
          if (winter > 0.25) { tintR *= 1.3; tintG *= 1.05; tintB *= 0.95; }
          scale *= 0.9;
        } else if (surface === 'scree' || surface === 'rock' || surface === 'mud') {
          if (dist > CLUTTER_RADIUS || roll > 0.30) continue;
          pool = this.rockPool('pebble');
          scale = 0.5 + rng.next() * 1.1;
        } else if (surface === 'settlement' || surface === 'road') {
          // a village yard is trodden earth with stones and weeds pushed to its edges
          if (dist > CLUTTER_RADIUS || roll > 0.13) continue;
          pool = rng.next() < 0.62 ? this.rockPool('pebble') : this.coverPool('herb');
          scale = 0.45 + rng.next() * 0.7;
          tintR = 0.8; tintG = 0.82; tintB = 0.66;
        }
        if (!pool) continue;
        const idx = this.alloc(pool);
        if (idx === null) break;
        this.setInstance(pool, idx, px, y - 0.05, pz, rng.next() * Math.PI * 2, scale);
        this.setTint(pool, idx, tintR, tintG, tintB);
        allocs.push({ poolKey: pool.key, index: idx });
      }
    }
    this.chunkGrass.set(key, allocs);
  }

  stats(): { instances: number; drawCalls: number } {
    let instances = 0;
    for (const p of this.pools.values()) instances += p.capacity - p.free.length;
    return { instances, drawCalls: this.pools.size };
  }

  dispose(): void {
    for (const p of this.pools.values()) p.mesh.dispose();
    this.pools.clear();
    this.chunkAlloc.clear();
    this.chunkTier.clear();
    this.chunkGrass.clear();
  }
}

/** Beech is a lowland/mid-slope tree; spruce and larch take over higher up. */
function pickSpecies(rng: Rng, alt: number): TreeKind {
  const beechFall = Math.max(0, 1 - Math.max(0, alt - 0.35) * 2.2);
  const weights = TREE_SPECIES.map((s) => (s.kind === 'beech' ? s.weight * beechFall : s.kind === 'larch' ? s.weight * (0.5 + alt) : s.weight));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng.next() * total;
  for (let i = 0; i < TREE_SPECIES.length; i++) { r -= weights[i]; if (r <= 0) return TREE_SPECIES[i].kind; }
  return 'spruce';
}
