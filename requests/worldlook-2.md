# worldlook-2 — a far-terrain backdrop mesh beyond the streaming radius

**Owner of the change:** the terrain-geometry builder (`src/world/terrain.ts` / `heightmodel.ts`) —
files the world-look builder must not edit.

## What

Alongside the streamed 500 m chunks, build **one** static low-resolution mesh of the whole map
(e.g. the 2048x2176 height grid decimated to ~256x272, ~140 k triangles, one draw call) and add it
to the terrain group behind the streamed chunks. It never streams, never changes LOD, and can reuse
the terrain material as-is.

Suggested surface: `TerrainManager.buildFarMesh(): Mesh` called once after `ready`, with the
streamed chunks rendering over it (they are nearer, so the depth buffer already does this).

## Why

`VIEW_RADIUS` is 3 000 m (`terrain.ts:15`) on a map that is 16 000 x 17 000 m. Every long view
therefore ends in nothing at 3 km:

| scenario | what is missing |
|---|---|
| `free-pilatus-luzern` | the Luzern basin and the whole far shore — the camera looks at empty sky below the horizon |
| `lake-overview-seelisberg` | the head of the Urnersee and the Uri Alps behind Flüelen |
| `free-altdorf` | the Reuss valley beyond Erstfeld |

ARCHITECTURE §5.1's stated goal for this module is "readable landmarks, visible destinations". At
3 km a destination is not visible; Pilatus, the Mythen and the Rigi are all further away than that
from most of the valley floor.

## Work-around in place (no one is blocked)

`sky.ts` now draws a `ground-haze` disc at the lake surface in the current aerial-perspective haze
colour, ordered before the terrain and writing no depth. Missing distance reads as haze instead of
as a blown-out Preetham sky, which is a large improvement, but it is haze — not the Rigi.

With a far mesh the disc stays useful (it still backs the horizon) and the mountains come back.
