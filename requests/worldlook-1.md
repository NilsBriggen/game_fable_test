# worldlook-1 — expose the lake level at a point (geometry builder / `src/world/terrain.ts`)

**Owner of the change:** the terrain-geometry builder (`heightmodel.ts` / `terrain.ts` / `geodata.ts`) — files
the world-look builder must not edit.

## What

Add to `TerrainManager` (and, if it is cheap, to `WorldService`):

```ts
/** Game-height of the lake surface nearest to (x, z), or null if no lake is within `maxDist` metres. */
lakeLevelAt(x: number, z: number, maxDist?: number): number | null;
```

`buildWorldGeo().lakes` already holds `levelGameH` per polygon, so this is a nearest-polygon lookup
over nine polygons — the same one `insideAnyLake()` already does.

## Why

`terrainMaterial.ts` darkens and glosses the ground in a band just above the water line ("wet shore
darkening", ARCHITECTURE §5.1). The shader currently gets a single scalar `uLakeLevel`, which is
correct only for the five Vierwaldstättersee basins at game height 0. The other lakes sit elsewhere:

| lake | level (game h) |
|---|---|
| Vierwaldstättersee (5 basins) | 0 |
| Zugersee | −6.7 |
| Lauerzersee | +4.3 |
| Sarnersee | +11.7 |
| **Ägerisee** | **+96.7** |

So the Ägerisee — the Morgarten shoreline, i.e. the whole `morgarten-winter` scenario — gets no wet
shore band at all, and every other lake gets one that is a few metres off.

## Work-around in place (no one is blocked)

`buildSplatMask()` in `terrainMaterial.ts` now bakes a "height above the nearest lake surface" term
into the spare alpha channel of splat mask B, using a coarse nearest-lake grid built from
`buildWorldGeo()` (a read-only import). It is correct, but it duplicates knowledge that belongs to
the geometry module and it re-samples the height grid a second time at bake.

If `lakeLevelAt()` lands, `buildSplatMask` can drop the coarse grid and the extra height pass.
