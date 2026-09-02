# Credits — world look (terrain, vegetation, sky, water)

Owned by the *world-look* builder. Everything listed here is **CC0 1.0 Universal** (public domain
dedication): no attribution is legally required, we record it anyway. Fetched and packed reproducibly
by `node tools/assets/fetch-world.mjs` from `tools/assets/world-manifest.json`.

## Source sets

Source: **Lennart Demes / ambientCG.com** — https://ambientcg.com/ — licence: **CC0 1.0 Universal (public domain dedication)**.
Downloaded as `<Name>_1K-JPG.zip`; we keep only Color, NormalGL, Roughness and AmbientOcclusion.

| Terrain layer | ambientCG set | used for |
|---|---|---|
| 0 `grass` | [Grass001](https://ambientcg.com/view?id=Grass001) | lush lowland pasture (Reuss floor, Rütli meadow, lake shores) |
| 1 `meadow` | [Grass004](https://ambientcg.com/view?id=Grass004) | drier, yellower alpine meadow above the villages |
| 2 `forest` | [Ground023](https://ambientcg.com/view?id=Ground023) | dark needle/leaf litter of the spruce-fir-beech forest floor |
| 3 `rock` | [Rocks011](https://ambientcg.com/view?id=Rocks011) | pale grey limestone cliff face (Axen, Mythen, Schöllenen, Pilatus) |
| 4 `scree` | [Gravel022](https://ambientcg.com/view?id=Gravel022) | talus / scree fans below the cliffs |
| 5 `snow` | [Snow006](https://ambientcg.com/view?id=Snow006) | old snow above the snow line |
| 6 `mud` | [Ground047](https://ambientcg.com/view?id=Ground047) | damp river gravel, lake shore, marsh |
| 7 `road` | [Ground078](https://ambientcg.com/view?id=Ground078) | beaten earth track / trampled village ground |
| vegetation `bark-conifer` | [Bark012](https://ambientcg.com/view?id=Bark012) | spruce/fir bark for tree trunks |

## Packed runtime files

| File | Contents | Size |
|---|---|---|
| `public/assets/textures/terrain/albedo-array.jpg` | 512×4096 JPEG — 8 albedo layers stacked, uploaded as a `DataArrayTexture` | 738 kB |
| `public/assets/textures/terrain/normal-array.jpg` | same layout, OpenGL-convention tangent-space normals | 1233 kB |
| `public/assets/textures/terrain/orm-array.jpg` | same layout; R = ambient occlusion, G = roughness, B = unused | 637 kB |
| `public/assets/textures/vegetation/bark-conifer.jpg` | 256² conifer bark albedo | 32 kB |
| `public/assets/textures/vegetation/bark-conifer-n.jpg` | 256² conifer bark normal | 41 kB |

## Not downloaded, and why

* **Sky HDRI (Poly Haven).** A baked HDRI cannot follow the game clock: the harness alone needs 06:00
  dawn, noon, 19:00 dusk and 23:00 night at 47° N. The sky stays the analytic Preetham model
  (`three/addons/objects/Sky.js`) driven by a real solar-position calculation, and `src/world/sky.ts`
  renders a PMREM environment map **from that sky** every time the sun moves — so the image-based
  lighting and the water reflections are the live sky, which a static HDRI could not give us.
* **Quaternius / Poly Haven tree models.** Trees are built procedurally in `src/world/treeGeometry.ts`
  (bark-textured trunk + branch whorls + alpha-tested needle sprays with a generated needle texture,
  3 LODs + a billboard impostor). A downloaded GLB would be one fixed mesh at one LOD with its own
  material; the procedural generator gives per-species silhouettes, the LOD chain the 1.5 M-triangle
  budget needs, and species variation from one shared material.
* **Alpha cut-out foliage/grass atlases.** Generated on a canvas at load time (`src/world/textures.ts`)
  so the needle/leaf/blade colour follows the season tint instead of being baked.
