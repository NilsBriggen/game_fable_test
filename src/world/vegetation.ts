/**
 * Vegetation & ambient props: one global InstancedMesh per model per LOD tier, populated from the
 * chunks the terrain streamer currently has active (ARCHITECTURE.md §5.1: ≤600 draw calls).
 * Placement is deterministic per chunk (hash of seed + chunk coords), driven by surface type + slope.
 */
import { DynamicDrawUsage, Group, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import { Rng, hashString } from '@core/rng';
import type { TerrainManager } from './terrain';
import { FOREST_MAX_H } from './heightmodel';
import { buildTreeGeometry, treeImpostor, treeMaterial, type TreeKind } from './treeGeometry';
import { registerCsmMaterial } from './shadowCsm';
import { boulderGeometry, rockMaterial } from './propGeometry';

const FULL_SPACING = 11;
const IMPOSTOR_SPACING = 26;
const IMPOSTOR_SPACING_FAR = 46; // LOD3 (>900m): sparser, count-capped impostors so distant slopes read
// as forest instead of bald grey domes (critic issue 5) without blowing the triangle/instance budget.
const TREE_SPECIES: { kind: TreeKind; weight: number }[] = [
  { kind: 'spruce', weight: 0.52 }, { kind: 'fir', weight: 0.2 }, { kind: 'larch', weight: 0.14 }, { kind: 'beech', weight: 0.14 },
];

interface Pool {
  mesh: InstancedMesh;
  capacity: number;
  free: number[];
  /** InstancedMesh only ever renders indices [0, mesh.count) — with a free-list allocator, active
   * slots can end up scattered past a naively-shrunk count, so track the highest index ever handed
   * out instead. Freed slots below it get a zero-scale matrix, so they cost nothing to draw. */
  highWater: number;
}

const tmpMat = new Matrix4();
const tmpPos = new Vector3();
const tmpQuat = new Quaternion();
const tmpScale = new Vector3();

export class VegetationManager {
  readonly group = new Group();
  private pools = new Map<string, Pool>();
  private chunkAlloc = new Map<string, { poolKey: string; index: number }[]>();
  private chunkTier = new Map<string, 'full' | 'impostor' | 'none'>();

  constructor(private seed: number, private terrain: TerrainManager) {
    this.group.name = 'vegetation';
  }

  private poolFor(key: string, capacity: number, build: () => { geometry: any; material: MeshStandardMaterial }): Pool {
    let p = this.pools.get(key);
    if (p) return p;
    const { geometry, material } = build();
    registerCsmMaterial(material);
    const mesh = new InstancedMesh(geometry, material, capacity);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.count = 0;
    mesh.castShadow = key.includes('impostor') ? false : true;
    mesh.receiveShadow = true;
    mesh.name = `veg-${key}`;
    // Bounding sphere is recomputed after each allocation batch (see update()) so real frustum culling
    // applies — important under software rendering, where a shadow/color pass over unused capacity is costly.
    this.group.add(mesh);
    const free: number[] = [];
    for (let i = capacity - 1; i >= 0; i--) free.push(i);
    p = { mesh, capacity, free, highWater: 0 };
    this.pools.set(key, p);
    return p;
  }

  private treePool(kind: TreeKind, tier: 'full' | 'impostor'): Pool {
    if (tier === 'full') return this.poolFor(`tree.${kind}.full`, 3200, () => ({ geometry: buildTreeGeometry(kind, new Rng(1)), material: treeMaterial() }));
    return this.poolFor(`tree.${kind}.impostor`, 9000, () => treeImpostor());
  }
  private rockPool(size: 'large' | 'small'): Pool {
    return this.poolFor(`rock.${size}`, 1200, () => ({ geometry: boulderGeometry(size === 'large' ? 1.7 : 0.55), material: rockMaterial() }));
  }

  private dirtyPools = new Set<Pool>();

  private alloc(pool: Pool): number | null {
    if (!pool.free.length) return null;
    const idx = pool.free.pop()!;
    if (idx + 1 > pool.highWater) pool.highWater = idx + 1;
    return idx;
  }
  private setInstance(pool: Pool, index: number, x: number, y: number, z: number, yaw: number, scale: number): void {
    tmpPos.set(x, y, z);
    tmpQuat.setFromAxisAngle(Vector3_UP, yaw);
    tmpScale.set(scale, scale, scale);
    tmpMat.compose(tmpPos, tmpQuat, tmpScale);
    pool.mesh.setMatrixAt(index, tmpMat);
    this.dirtyPools.add(pool);
  }

  /** Called every frame by the world 'always' system after terrain streaming. */
  update(): void {
    const active = this.terrain.listActiveChunks();
    const activeKeys = new Set(active.map((c) => c.key));
    // evict chunks no longer streamed
    for (const key of [...this.chunkAlloc.keys()]) {
      if (!activeKeys.has(key)) this.freeChunk(key);
    }
    for (const c of active) {
      // LOD0/1 (near): full geometry. LOD2/3 (far, incl. distant mountainsides): impostors — kept all
      // the way to LOD3 so distant flanks never go bald; LOD3 just uses a much wider, capped spacing.
      const tier: 'full' | 'impostor' = c.lod <= 1 ? 'full' : 'impostor';
      const prevTier = this.chunkTier.get(c.key);
      if (prevTier === tier) continue;
      this.freeChunk(c.key);
      this.chunkTier.set(c.key, tier);
      this.populateChunk(c.key, c.cx, c.cz, c.originX, c.originZ, tier, c.lod);
    }
    for (const p of this.dirtyPools) {
      p.mesh.count = p.highWater;
      p.mesh.instanceMatrix.needsUpdate = true;
      // Recomputing this every dirty frame is what makes frustum culling actually work per-pool
      // (an empty/near pool otherwise keeps a stale, world-spanning bounding sphere from earlier use).
      p.mesh.computeBoundingSphere();
    }
    this.dirtyPools.clear();
  }

  private freeChunk(key: string): void {
    const allocs = this.chunkAlloc.get(key);
    if (allocs) {
      for (const a of allocs) {
        const pool = this.pools.get(a.poolKey);
        if (pool) {
          tmpMat.makeScale(0, 0, 0);
          pool.mesh.setMatrixAt(a.index, tmpMat);
          pool.free.push(a.index);
          this.dirtyPools.add(pool);
        }
      }
      this.chunkAlloc.delete(key);
    }
    this.chunkTier.delete(key);
  }

  private populateChunk(key: string, cx: number, cz: number, originX: number, originZ: number, tier: 'full' | 'impostor', lod: number): void {
    const rng = new Rng((hashString(`${this.seed}:veg:${cx}:${cz}`) >>> 0));
    const spacing = tier === 'full' ? FULL_SPACING : lod >= 3 ? IMPOSTOR_SPACING_FAR : IMPOSTOR_SPACING;
    const size = 500;
    const allocs: { poolKey: string; index: number }[] = [];
    for (let gz = 0; gz < size; gz += spacing) {
      for (let gx = 0; gx < size; gx += spacing) {
        const jx = (rng.next() - 0.5) * spacing * 0.8;
        const jz = (rng.next() - 0.5) * spacing * 0.8;
        const x = originX + gx + jx;
        const z = originZ + gz + jz;
        const surface = this.terrain.surfaceAt(x, z);
        if (surface === 'water' || surface === 'road' || surface === 'settlement') continue;
        const slope = this.terrain.slopeAt(x, z);
        if (slope > 0.62) continue;
        const y = this.terrain.heightAt(x, z);
        if (y > FOREST_MAX_H * 1.65) continue; // above the tree/scrub line entirely

        let placeTreeChance = 0, placeRockChance = 0;
        if (surface === 'forest') { placeTreeChance = tier === 'full' ? 0.62 : 0.5; placeRockChance = 0.015; }
        else if (surface === 'grass' || surface === 'meadow') { placeTreeChance = tier === 'full' ? 0.05 : 0.03; placeRockChance = 0.01; }
        else if (surface === 'scree' || surface === 'rock') { placeRockChance = 0.05; }
        else if (surface === 'mud') { placeTreeChance = 0.02; }

        const roll = rng.next();
        if (roll < placeTreeChance) {
          const kind = pickSpecies(rng);
          const pool = this.treePool(kind, tier);
          const idx = this.alloc(pool);
          if (idx !== null) {
            const scale = 0.75 + rng.next() * 0.55;
            this.setInstance(pool, idx, x, y, z, rng.next() * Math.PI * 2, scale);
            allocs.push({ poolKey: pool.mesh.name.slice(4), index: idx });
          }
        } else if (roll < placeTreeChance + placeRockChance) {
          const size2 = rng.next() < 0.4 ? 'large' : 'small';
          const pool = this.rockPool(size2 as 'large' | 'small');
          const idx = this.alloc(pool);
          if (idx !== null) {
            const scale = 0.6 + rng.next() * 0.9;
            this.setInstance(pool, idx, x, y, z, rng.next() * Math.PI * 2, scale);
            allocs.push({ poolKey: pool.mesh.name.slice(4), index: idx });
          }
        }
      }
    }
    this.chunkAlloc.set(key, allocs);
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
  }
}

const Vector3_UP = new Vector3(0, 1, 0);

function pickSpecies(rng: Rng): TreeKind {
  const r = rng.next();
  let acc = 0;
  for (const s of TREE_SPECIES) { acc += s.weight; if (r <= acc) return s.kind; }
  return 'spruce';
}
