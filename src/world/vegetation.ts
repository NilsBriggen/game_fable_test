/**
 * Vegetation: one global InstancedMesh per species per LOD tier, populated from the chunks the
 * terrain streamer has active. Tiers follow the chunk LOD — full mesh, reduced mesh, billboard
 * impostor — plus a grass-tuft pool that only fills the chunks within 80 m of the camera.
 * Placement is deterministic per chunk (hash of seed + chunk coords) from surface, slope and height.
 */
import { DynamicDrawUsage, Group, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import { Rng, hashString } from '@core/rng';
import type { TerrainManager } from './terrain';
import { FOREST_MAX_H } from './heightmodel';
import { buildTreeGeometry, treeImpostor, treeMaterial, grassTuft, type TreeKind } from './treeGeometry';
import { registerCsmMaterial } from './shadowCsm';
import { buildSplatMask, splatMaskReady } from './terrainMaterial';
import { getViewPosition } from './shadowCsm';
import { boulderGeometry, rockMaterial } from './propGeometry';

type Tier = 'full' | 'mid' | 'impostor';

const SPACING: Record<Tier, number> = { full: 10, mid: 14, impostor: 26 };
const IMPOSTOR_SPACING_FAR = 46;
const GRASS_RADIUS = 80;
const GRASS_SPACING = 2.6;

/** Treeline in game metres (LORE §3: real 1500 m a.s.l. -> h≈355). */
const TREELINE = FOREST_MAX_H;

const TREE_SPECIES: { kind: TreeKind; weight: number }[] = [
  { kind: 'spruce', weight: 0.5 }, { kind: 'fir', weight: 0.19 }, { kind: 'larch', weight: 0.13 }, { kind: 'beech', weight: 0.18 },
];

interface Pool {
  mesh: InstancedMesh;
  capacity: number;
  free: number[];
  /** InstancedMesh renders [0, count); with a free-list the live slots can be scattered, so track
   * the highest index ever handed out. Freed slots below it get a zero-scale matrix. */
  highWater: number;
}

const tmpMat = new Matrix4();
const tmpPos = new Vector3();
const tmpQuat = new Quaternion();
const tmpTilt = new Quaternion();
const tmpScale = new Vector3();
const UP = new Vector3(0, 1, 0);
const tiltAxis = new Vector3();

export class VegetationManager {
  readonly group = new Group();
  private pools = new Map<string, Pool>();
  private chunkAlloc = new Map<string, { poolKey: string; index: number }[]>();
  private chunkTier = new Map<string, Tier | 'grass' | 'none'>();
  private chunkGrass = new Map<string, { poolKey: string; index: number }[]>();
  private maskKicked = false;

  constructor(private seed: number, private terrain: TerrainManager) {
    this.group.name = 'vegetation';
  }

  private poolFor(key: string, capacity: number, build: () => { geometry: any; material: MeshStandardMaterial }, casts = true): Pool {
    let p = this.pools.get(key);
    if (p) return p;
    const { geometry, material } = build();
    registerCsmMaterial(material);
    const mesh = new InstancedMesh(geometry, material, capacity);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.count = 0;
    mesh.castShadow = casts;
    mesh.receiveShadow = true;
    mesh.name = `veg-${key}`;
    this.group.add(mesh);
    const free: number[] = [];
    for (let i = capacity - 1; i >= 0; i--) free.push(i);
    p = { mesh, capacity, free, highWater: 0 };
    this.pools.set(key, p);
    return p;
  }

  private treePool(kind: TreeKind, tier: Tier): Pool {
    if (tier === 'impostor') return this.poolFor(`tree.${kind}.impostor`, 9000, () => treeImpostor(kind), false);
    const lod: 0 | 1 = tier === 'full' ? 0 : 1;
    return this.poolFor(`tree.${kind}.${tier}`, tier === 'full' ? 2600 : 3600, () => ({ geometry: buildTreeGeometry(kind, new Rng(7 + lod), lod), material: treeMaterial() }));
  }
  private rockPool(size: 'large' | 'small'): Pool {
    return this.poolFor(`rock.${size}`, 1200, () => ({ geometry: boulderGeometry(size === 'large' ? 1.7 : 0.55), material: rockMaterial() }));
  }
  private grassPool(): Pool {
    return this.poolFor('grass.tuft', 14000, () => grassTuft(), false);
  }

  private dirtyPools = new Set<Pool>();

  private alloc(pool: Pool): number | null {
    if (!pool.free.length) return null;
    const idx = pool.free.pop()!;
    if (idx + 1 > pool.highWater) pool.highWater = idx + 1;
    return idx;
  }

  private setInstance(pool: Pool, index: number, x: number, y: number, z: number, yaw: number, scale: number, lean = 0, leanDir = 0): void {
    tmpPos.set(x, y, z);
    tmpQuat.setFromAxisAngle(UP, yaw);
    if (lean > 0.001) {
      tiltAxis.set(Math.cos(leanDir), 0, Math.sin(leanDir));
      tmpTilt.setFromAxisAngle(tiltAxis, lean);
      tmpQuat.premultiply(tmpTilt);
    }
    tmpScale.set(scale, scale, scale);
    tmpMat.compose(tmpPos, tmpQuat, tmpScale);
    pool.mesh.setMatrixAt(index, tmpMat);
    this.dirtyPools.add(pool);
  }

  /** Called every frame by the world 'always' system after terrain streaming. */
  update(): void {
    const view = getViewPosition();
    const camX = view.x, camZ = view.z;
    // The terrain splat mask can only be baked once the CPU grid exists; this is the first place in
    // the world module that is guaranteed to run after `await terrain.ready`.
    if (!this.maskKicked && !splatMaskReady()) {
      this.maskKicked = true;
      buildSplatMask((x, z) => this.terrain.surfaceIdAt(x, z), this.terrain.cpuWidth, this.terrain.cpuHeight);
    }
    const active = this.terrain.listActiveChunks();
    const activeKeys = new Set(active.map((c) => c.key));
    for (const key of [...this.chunkAlloc.keys()]) if (!activeKeys.has(key)) this.freeChunk(key);
    for (const key of [...this.chunkGrass.keys()]) if (!activeKeys.has(key)) this.freeGrass(key);

    for (const c of active) {
      const tier: Tier = c.lod === 0 ? 'full' : c.lod === 1 ? 'mid' : 'impostor';
      if (this.chunkTier.get(c.key) !== tier) {
        this.freeChunk(c.key);
        this.chunkTier.set(c.key, tier);
        this.populateChunk(c.key, c.cx, c.cz, c.originX, c.originZ, tier, c.lod);
      }
      // grass only in the chunks that overlap the 80 m ring around the camera
      const dx = Math.max(c.originX - camX, 0, camX - (c.originX + 500));
      const dz = Math.max(c.originZ - camZ, 0, camZ - (c.originZ + 500));
      const near = Math.hypot(dx, dz) < GRASS_RADIUS;
      const hasGrass = this.chunkGrass.has(c.key);
      if (near && !hasGrass) this.populateGrass(c.key, c.cx, c.cz, c.originX, c.originZ, camX, camZ);
      else if (!near && hasGrass) this.freeGrass(c.key);
    }
    for (const p of this.dirtyPools) {
      p.mesh.count = p.highWater;
      p.mesh.instanceMatrix.needsUpdate = true;
      p.mesh.computeBoundingSphere();
    }
    this.dirtyPools.clear();
  }

  private release(list: { poolKey: string; index: number }[] | undefined): void {
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

  private freeChunk(key: string): void {
    this.release(this.chunkAlloc.get(key));
    this.chunkAlloc.delete(key);
    this.chunkTier.delete(key);
  }

  private freeGrass(key: string): void {
    this.release(this.chunkGrass.get(key));
    this.chunkGrass.delete(key);
  }

  private populateChunk(key: string, cx: number, cz: number, originX: number, originZ: number, tier: Tier, lod: number): void {
    const rng = new Rng(hashString(`${this.seed}:veg:${cx}:${cz}`) >>> 0);
    const spacing = tier === 'impostor' && lod >= 3 ? IMPOSTOR_SPACING_FAR : SPACING[tier];
    const size = 500;
    const allocs: { poolKey: string; index: number }[] = [];
    for (let gz = 0; gz < size; gz += spacing) {
      for (let gx = 0; gx < size; gx += spacing) {
        const x = originX + gx + (rng.next() - 0.5) * spacing * 0.85;
        const z = originZ + gz + (rng.next() - 0.5) * spacing * 0.85;
        const surface = this.terrain.surfaceAt(x, z);
        if (surface === 'water' || surface === 'road' || surface === 'settlement') continue;
        const slope = this.terrain.slopeAt(x, z);
        if (slope > 0.72) continue;
        const y = this.terrain.heightAt(x, z);
        if (y > TREELINE * 1.12) continue;

        let treeChance = 0, rockChance = 0;
        if (surface === 'forest') { treeChance = tier === 'impostor' ? 0.5 : 0.66; rockChance = 0.012; }
        else if (surface === 'grass' || surface === 'meadow') { treeChance = tier === 'impostor' ? 0.025 : 0.05; rockChance = 0.008; }
        else if (surface === 'scree' || surface === 'rock') { treeChance = y < TREELINE * 0.8 ? 0.03 : 0; rockChance = 0.06; }
        else if (surface === 'mud') { treeChance = 0.03; }

        const roll = rng.next();
        if (roll < treeChance) {
          // mountain pine takes over the last 15% below the treeline; beech drops out above ~2/3
          const alt = y / TREELINE;
          let kind: TreeKind;
          if (alt > 0.85) kind = 'pine';
          else kind = pickSpecies(rng, alt);
          const pool = this.treePool(kind, tier);
          const idx = this.alloc(pool);
          if (idx !== null) {
            const scale = (0.78 + rng.next() * 0.5) * (1 - 0.25 * Math.max(0, alt - 0.6));
            const lean = tier === 'impostor' ? 0 : Math.min(slope * 0.35, 0.16);
            this.setInstance(pool, idx, x, y, z, rng.next() * Math.PI * 2, scale, lean, rng.next() * Math.PI * 2);
            allocs.push({ poolKey: pool.mesh.name.slice(4), index: idx });
          }
        } else if (roll < treeChance + rockChance) {
          const pool = this.rockPool(rng.next() < 0.4 ? 'large' : 'small');
          const idx = this.alloc(pool);
          if (idx !== null) {
            this.setInstance(pool, idx, x, y, z, rng.next() * Math.PI * 2, 0.6 + rng.next() * 0.9);
            allocs.push({ poolKey: pool.mesh.name.slice(4), index: idx });
          }
        }
      }
    }
    this.chunkAlloc.set(key, allocs);
  }

  private populateGrass(key: string, cx: number, cz: number, originX: number, originZ: number, camX: number, camZ: number): void {
    const rng = new Rng(hashString(`${this.seed}:grass:${cx}:${cz}`) >>> 0);
    const pool = this.grassPool();
    const allocs: { poolKey: string; index: number }[] = [];
    const x0 = Math.max(originX, camX - GRASS_RADIUS), x1 = Math.min(originX + 500, camX + GRASS_RADIUS);
    const z0 = Math.max(originZ, camZ - GRASS_RADIUS), z1 = Math.min(originZ + 500, camZ + GRASS_RADIUS);
    for (let z = z0; z < z1; z += GRASS_SPACING) {
      for (let x = x0; x < x1; x += GRASS_SPACING) {
        const px = x + (rng.next() - 0.5) * GRASS_SPACING;
        const pz = z + (rng.next() - 0.5) * GRASS_SPACING;
        if (Math.hypot(px - camX, pz - camZ) > GRASS_RADIUS) continue;
        if (rng.next() > 0.55) continue;
        const surface = this.terrain.surfaceAt(px, pz);
        if (surface !== 'grass' && surface !== 'meadow') continue;
        if (this.terrain.slopeAt(px, pz) > 0.7) continue;
        const idx = this.alloc(pool);
        if (idx === null) break;
        const y = this.terrain.heightAt(px, pz);
        this.setInstance(pool, idx, px, y - 0.05, pz, rng.next() * Math.PI * 2, 0.7 + rng.next() * 0.7);
        allocs.push({ poolKey: 'grass.tuft', index: idx });
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
