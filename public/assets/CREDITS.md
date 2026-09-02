# Asset credits

All terrain, water, sky, vegetation and prop assets used by `src/world` are **procedurally generated
at runtime** — there are no downloaded or externally-sourced textures, models, or audio files in this
directory. This satisfies `tools/BUILDER_RULES.md`'s "no external asset downloads" rule.

- **Textures** (`src/world/textures.ts`): canvas-drawn tiling diffuse + normal maps for grass, forest
  floor, rock, scree, snow, mud/road, wood grain, cut stone, wooden shingle and lime-washed plaster,
  built from the seeded value-noise/fBm functions in `src/world/noise.ts`.
- **Terrain heightfield & surface mask** (`src/world/heightmodel.ts`, `src/world/geodata.ts`): rasterised
  from `src/content/gazetteer.ts`'s real place coordinates, rivers, roads, lakes and peaks — no
  external elevation data.
- **3D models** (`src/world/models.ts`, `src/world/treeGeometry.ts`): built entirely from Three.js
  primitive geometry (box/cylinder/cone/sphere/icosahedron/torus) composed into houses, churches,
  castles, bridges, trees and other props, with the canvas textures above.
- **Sky** (`src/world/sky.ts`): Three.js's built-in `Sky` addon (Preetham analytic daylight model,
  MIT-licensed, bundled with `three`), driven by a simple solar-position calculation for 47° N.

No CC0/third-party asset packs were used.
