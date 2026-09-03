/**
 * Critic probe — world runtime. vegetation.ts allocates one fixed-capacity InstancedMesh pool per
 * species per tier (`treePool`, capacity 2600 for the 'full' tier — vegetation.ts ~line 90) and hands
 * back `null` from `alloc()` when a pool is exhausted (~line 102-107), which `populateChunk` silently
 * treats as "skip this instance" (~line 220-226): no warning, no fallback pool, no reduced density —
 * trees just stop appearing.
 *
 * A chunk's vegetation tier is "full" for its ENTIRE 500x500m extent as soon as the camera is within
 * 70m of *any point* of the chunk (vegetation.ts `update()`, distance is to the nearest point of the
 * chunk, not a per-instance falloff) — so standing near a shared edge between two densely forested
 * chunks puts both chunks at full density (8.5m spacing, up to 0.78 tree chance) simultaneously.
 * This probe reproduces vegetation.ts's own density formula (spacing, forest treeChance, species
 * weights) to show that two such adjacent forest chunks alone are expected to demand more spruce
 * instances than the 2600-capacity pool holds — i.e. the "silent drop" is reachable in ordinary
 * dense-forest play, not just a contrived worst case.
 */
import { describe, it, expect } from 'vitest';
import { Rng, hashString } from '@core/rng';

// Mirrors vegetation.ts constants (not exported — module-private), cited above.
const SPACING_FULL = 8.5;
const TREE_CHANCE_FOREST_FULL = 0.78; // populateChunk: surface === 'forest', tier !== 'impostor'
const TREE_POOL_CAPACITY_FULL = 2600; // treePool(): tier === 'full' ? 2600 : 3600
const TREE_SPECIES: { kind: string; weight: number }[] = [
  { kind: 'spruce', weight: 0.5 }, { kind: 'fir', weight: 0.19 }, { kind: 'larch', weight: 0.13 }, { kind: 'beech', weight: 0.18 },
];

/** Re-implements vegetation.ts populateChunk's candidate loop + species roll for one all-forest,
 *  flat, below-treeline chunk, and returns per-species instance counts. seed/cx/cz match the real
 *  hashString(`${seed}:veg:${cx}:${cz}`) RNG stream so this is the exact sequence the game would use. */
function simulateChunk(seed: number, cx: number, cz: number): Record<string, number> {
  const rng = new Rng(hashString(`${seed}:veg:${cx}:${cz}`) >>> 0);
  const counts: Record<string, number> = { spruce: 0, fir: 0, larch: 0, beech: 0, pine: 0 };
  const size = 500;
  for (let gz = 0; gz < size; gz += SPACING_FULL) {
    for (let gx = 0; gx < size; gx += SPACING_FULL) {
      rng.next(); rng.next(); // jitter x, jitter z (surface/height/slope checks always pass: all-forest, flat, low)
      const roll = rng.next();
      if (roll < TREE_CHANCE_FOREST_FULL) {
        // alt ~ 0 (flat lowland chunk) -> pickSpecies weights reduce to the base TREE_SPECIES weights
        const total = TREE_SPECIES.reduce((a, s) => a + s.weight, 0);
        let r = rng.next() * total;
        let kind = 'spruce';
        for (const s of TREE_SPECIES) { r -= s.weight; if (r <= 0) { kind = s.kind; break; } }
        counts[kind]++;
        rng.next(); rng.next(); rng.next(); rng.next(); // scale, lean roll, yaw, leanDir consumed by setInstance's callers
      }
    }
  }
  return counts;
}

describe('vegetation InstancedMesh pool capacity vs. realistic dense-forest demand (vegetation.ts)', () => {
  it('two adjacent all-forest chunks at full tier alone can exceed the 2600 spruce.full capacity', () => {
    const a = simulateChunk(1, 10, 10);
    const b = simulateChunk(1, 11, 10); // the chunk sharing a is's east edge — both go "full" tier
                                          // together whenever the camera sits near that shared border
    const spruceDemand = a.spruce + b.spruce;
    // eslint-disable-next-line no-console
    console.log(`[probe] chunk(10,10) spruce=${a.spruce} chunk(11,10) spruce=${b.spruce} combined=${spruceDemand} capacity=${TREE_POOL_CAPACITY_FULL}`);
    expect(spruceDemand).toBeGreaterThan(TREE_POOL_CAPACITY_FULL); // demonstrates the pool WILL be exhausted
  });
});
