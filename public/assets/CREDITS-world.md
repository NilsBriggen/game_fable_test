# Credits — world look (terrain, vegetation, sky, water)

Every source file below is **CC0 1.0 Universal (public domain dedication)**, from
**Lennart Demes / ambientCG.com** (https://ambientcg.com/) and **Poly Haven (Rob Tuytel, Rico Cilliers et al.)** (https://polyhaven.com/).
Fetched and packed reproducibly by `node tools/assets/fetch-world.mjs` from `tools/assets/world-manifest.json`.
Exception: the 9 `albedo-array.jpg` layers (#L0-#L8) are AI-generated (google/gemini-2.5-flash-image via OpenRouter, 2026-09-06, cached pack $0); `normal-array.jpg` and `orm-array.jpg` layers below remain CC0.


The three terrain files are 512×4608 JPEGs holding 9 512² layers each, uploaded as three.js `DataArrayTexture`s.
The foliage / ground-cover sheets are RGBA PNGs whose cells are **re-composed** from the source
photographs: each Poly Haven plant texture is split into its connected alpha blobs (one needle
sprig, one leaf, one grass blade) and those blobs are re-stamped into a branch spray, a leaf
cluster or a tuft.

Poly Haven’s rock *meshes* are used, but only after decimation: the raw scans measured here are
`rock_09` 12.4 k triangles, `rock_07` 14.8 k and `boulder_01` 66.1 k, against a scatter that puts
hundreds of stones on screen, so `fetch-world.mjs` clusters their vertices onto a coarse grid and
writes 260–640 triangle JSON meshes. The *tree* meshes are not used at any resolution:
`fir_tree_01`’s 1k glTF is 7.0 M triangles behind a 478 MB buffer — more than twice the whole
frame budget for one tree — so the trees are generated from the twig cut-outs instead.

| File | Source URL | Author | Licence | Size |
|---|---|---|---|---|
| `public/assets/textures/terrain/albedo-array.jpg #L0 (grass)` | AI-generated (google/gemini-2.5-flash-image via OpenRouter, 2026-09-06, cached pack $0) | AI-generated | project use (AI-generated, not CC0) | 1167 kB (whole array) |
| `public/assets/textures/terrain/albedo-array.jpg #L1 (meadow)` | AI-generated (google/gemini-2.5-flash-image via OpenRouter, 2026-09-06, cached pack $0) | AI-generated | project use (AI-generated, not CC0) | 1167 kB (whole array) |
| `public/assets/textures/terrain/albedo-array.jpg #L2 (forest)` | AI-generated (google/gemini-2.5-flash-image via OpenRouter, 2026-09-06, cached pack $0) | AI-generated | project use (AI-generated, not CC0) | 1167 kB (whole array) |
| `public/assets/textures/terrain/albedo-array.jpg #L3 (rock)` | AI-generated (google/gemini-2.5-flash-image via OpenRouter, 2026-09-06, cached pack $0) | AI-generated | project use (AI-generated, not CC0) | 1167 kB (whole array) |
| `public/assets/textures/terrain/albedo-array.jpg #L4 (scree)` | AI-generated (google/gemini-2.5-flash-image via OpenRouter, 2026-09-06, cached pack $0) | AI-generated | project use (AI-generated, not CC0) | 1167 kB (whole array) |
| `public/assets/textures/terrain/albedo-array.jpg #L5 (snow)` | AI-generated (google/gemini-2.5-flash-image via OpenRouter, 2026-09-06, cached pack $0) | AI-generated | project use (AI-generated, not CC0) | 1167 kB (whole array) |
| `public/assets/textures/terrain/albedo-array.jpg #L6 (mud)` | AI-generated (google/gemini-2.5-flash-image via OpenRouter, 2026-09-06, cached pack $0) | AI-generated | project use (AI-generated, not CC0) | 1167 kB (whole array) |
| `public/assets/textures/terrain/albedo-array.jpg #L7 (yard)` | AI-generated (google/gemini-2.5-flash-image via OpenRouter, 2026-09-06, cached pack $0) | AI-generated | project use (AI-generated, not CC0) | 1167 kB (whole array) |
| `public/assets/textures/terrain/albedo-array.jpg #L8 (track)` | AI-generated (google/gemini-2.5-flash-image via OpenRouter, 2026-09-06, cached pack $0) | AI-generated | project use (AI-generated, not CC0) | 1167 kB (whole array) |
| `public/assets/textures/terrain/normal-array.jpg #L0 (grass)` | https://ambientcg.com/get?file=Grass001_1K-JPG.zip | ambientCG | CC0 1.0 | 1290 kB (whole array) |
| `public/assets/textures/terrain/normal-array.jpg #L1 (meadow)` | https://ambientcg.com/get?file=Grass004_1K-JPG.zip | ambientCG | CC0 1.0 | 1290 kB (whole array) |
| `public/assets/textures/terrain/normal-array.jpg #L2 (forest)` | https://ambientcg.com/get?file=Ground023_1K-JPG.zip | ambientCG | CC0 1.0 | 1290 kB (whole array) |
| `public/assets/textures/terrain/normal-array.jpg #L3 (rock)` | https://ambientcg.com/get?file=Rock051_1K-JPG.zip | ambientCG | CC0 1.0 | 1290 kB (whole array) |
| `public/assets/textures/terrain/normal-array.jpg #L4 (scree)` | https://ambientcg.com/get?file=Rocks024L_1K-JPG.zip | ambientCG | CC0 1.0 | 1290 kB (whole array) |
| `public/assets/textures/terrain/normal-array.jpg #L5 (snow)` | https://ambientcg.com/get?file=Snow006_1K-JPG.zip | ambientCG | CC0 1.0 | 1290 kB (whole array) |
| `public/assets/textures/terrain/normal-array.jpg #L6 (mud)` | https://ambientcg.com/get?file=Ground109_1K-JPG.zip | ambientCG | CC0 1.0 | 1290 kB (whole array) |
| `public/assets/textures/terrain/normal-array.jpg #L7 (yard)` | https://ambientcg.com/get?file=Ground081_1K-JPG.zip | ambientCG | CC0 1.0 | 1290 kB (whole array) |
| `public/assets/textures/terrain/normal-array.jpg #L8 (track)` | https://ambientcg.com/get?file=Ground051_1K-JPG.zip | ambientCG | CC0 1.0 | 1290 kB (whole array) |
| `public/assets/textures/terrain/orm-array.jpg #L0 (grass)` | https://ambientcg.com/get?file=Grass001_1K-JPG.zip | ambientCG | CC0 1.0 | 631 kB (whole array) |
| `public/assets/textures/terrain/orm-array.jpg #L1 (meadow)` | https://ambientcg.com/get?file=Grass004_1K-JPG.zip | ambientCG | CC0 1.0 | 631 kB (whole array) |
| `public/assets/textures/terrain/orm-array.jpg #L2 (forest)` | https://ambientcg.com/get?file=Ground023_1K-JPG.zip | ambientCG | CC0 1.0 | 631 kB (whole array) |
| `public/assets/textures/terrain/orm-array.jpg #L3 (rock)` | https://ambientcg.com/get?file=Rock051_1K-JPG.zip | ambientCG | CC0 1.0 | 631 kB (whole array) |
| `public/assets/textures/terrain/orm-array.jpg #L4 (scree)` | https://ambientcg.com/get?file=Rocks024L_1K-JPG.zip | ambientCG | CC0 1.0 | 631 kB (whole array) |
| `public/assets/textures/terrain/orm-array.jpg #L5 (snow)` | https://ambientcg.com/get?file=Snow006_1K-JPG.zip | ambientCG | CC0 1.0 | 631 kB (whole array) |
| `public/assets/textures/terrain/orm-array.jpg #L6 (mud)` | https://ambientcg.com/get?file=Ground109_1K-JPG.zip | ambientCG | CC0 1.0 | 631 kB (whole array) |
| `public/assets/textures/terrain/orm-array.jpg #L7 (yard)` | https://ambientcg.com/get?file=Ground081_1K-JPG.zip | ambientCG | CC0 1.0 | 631 kB (whole array) |
| `public/assets/textures/terrain/orm-array.jpg #L8 (track)` | https://ambientcg.com/get?file=Ground051_1K-JPG.zip | ambientCG | CC0 1.0 | 631 kB (whole array) |
| `public/assets/textures/vegetation/bark-conifer.jpg` | https://ambientcg.com/get?file=Bark012_1K-JPG.zip | ambientCG | CC0 1.0 | 118 kB |
| `public/assets/textures/vegetation/bark-conifer-n.jpg` | https://ambientcg.com/get?file=Bark012_1K-JPG.zip | ambientCG | CC0 1.0 | 159 kB |
| `public/assets/textures/vegetation/bark-broadleaf.jpg` | https://ambientcg.com/get?file=Bark007_1K-JPG.zip | ambientCG | CC0 1.0 | 125 kB |
| `public/assets/textures/vegetation/bark-broadleaf-n.jpg` | https://ambientcg.com/get?file=Bark007_1K-JPG.zip | ambientCG | CC0 1.0 | 176 kB |
| `public/assets/models/vegetation/rock-boulder.json` | https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/boulder_01/boulder_01_1k.gltf | Poly Haven | CC0 1.0 | decimated to ~640 tris |
| `public/assets/models/vegetation/rock-block.json` | https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/rock_07/rock_07_1k.gltf | Poly Haven | CC0 1.0 | decimated to ~460 tris |
| `public/assets/models/vegetation/rock-stone.json` | https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/rock_09/rock_09_1k.gltf | Poly Haven | CC0 1.0 | decimated to ~260 tris |
| `public/assets/models/vegetation/rock-scan-diff.jpg` | https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/rock_07/rock_07_diff_1k.jpg | Poly Haven | CC0 1.0 | 66 kB |
| `public/assets/models/vegetation/rock-scan-nor.jpg` | https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/rock_07/rock_07_nor_gl_1k.jpg | Poly Haven | CC0 1.0 | 85 kB |
| `public/assets/textures/vegetation/foliage-atlas.png / public/assets/textures/vegetation/groundcover-atlas.png (conifer-sprig)` | https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/fir_tree_01/fir_tree_01_twig_diff_1k.jpg | Poly Haven | CC0 1.0 | 1046 / 237 kB |
| `public/assets/textures/vegetation/foliage-atlas.png / public/assets/textures/vegetation/groundcover-atlas.png (broadleaf)` | https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/shrub_01/shrub_01_diff_1k.jpg | Poly Haven | CC0 1.0 | 1046 / 237 kB |
| `public/assets/textures/vegetation/foliage-atlas.png / public/assets/textures/vegetation/groundcover-atlas.png (broadleaf-b)` | https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/tree_small_02/tree_small_02_leaves_diff_1k.jpg | Poly Haven | CC0 1.0 | 1046 / 237 kB |
| `public/assets/textures/vegetation/foliage-atlas.png / public/assets/textures/vegetation/groundcover-atlas.png (grass-blade)` | https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/grass_medium_02/grass_medium_02_diff_1k.jpg | Poly Haven | CC0 1.0 | 1046 / 237 kB |
| `public/assets/textures/vegetation/foliage-atlas.png / public/assets/textures/vegetation/groundcover-atlas.png (grass-dry)` | https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/grass_medium_02/grass_medium_02_dry_diff_1k.jpg | Poly Haven | CC0 1.0 | 1046 / 237 kB |
| `public/assets/textures/vegetation/foliage-atlas.png / public/assets/textures/vegetation/groundcover-atlas.png (fern)` | https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/fern_02/fern_02_diff_1k.jpg | Poly Haven | CC0 1.0 | 1046 / 237 kB |

## Generated at runtime (no external file)

| Asset | Where | Why not downloaded |
|---|---|---|
| Sky, clouds, stars, moon | `src/world/sky.ts` (Preetham `three/addons/objects/Sky.js` + canvas cloud/star/moon sprites) | a baked HDRI cannot follow the 06:00/12:00/19:00/23:00 game clock at 47° N; the sun/moon path, haze colour, exposure and the water reflection are all evaluated from the live solar elevation instead |
| Tree meshes, LODs and billboard impostors | `src/world/treeGeometry.ts`, `src/world/look/impostor.ts` | see above: the only CC0 conifer meshes available are film-resolution. The geometry is generated per species with 3 LODs, and the far billboard is painted from the SAME foliage cells the near mesh uses, so a forest does not change colour when it crosses the LOD line |
| Terrain splat mask, macro-variation noise, near-field detail, water ripple normals | `src/world/look/splat.ts`, `src/world/textures.ts`, `src/world/terrainMaterial.ts` | derived from the height model / procedural; nothing to download |
| Lake shore-distance atlas, foam mask | `src/world/water.ts` | baked from the gazetteer lake polygons at load; a downloadable texture could not know where the shore is |
| Parchment map sheet (paper, hillshade, ink work, hachures) | `src/world/map.ts` | drawn to a canvas from the live height model so the chart always matches the terrain the seed produced |
