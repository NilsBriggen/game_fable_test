# art-1 — cluster the settlement merge per POI, not globally (exploration)

**From:** asset & character art builder · **To:** exploration builder / integrator
**Files:** `src/exploration/settlements.ts` (not mine to edit)

## What

`buildSettlements()` accumulates every settlement's geometry into ONE `Map<Material, BufferGeometry[]>`
for the whole map and emits one merged `Mesh` per material (`emitMerged`). Please key that map by
`(material, cluster)` instead, where `cluster` is the POI (or a ~500 m grid cell), and emit one mesh per
pair — e.g. `byMat.get(\`${poi.id}\`)` accumulated per POI, flushed with `emitMerged` after each POI.

## Why

A merged mesh that spans the whole 16×16 km world has a world-sized bounding sphere, so it is **never
frustum-culled and never shadow-culled**: every village on the map is re-rendered in the main pass *and*
in each CSM cascade, every frame, wherever the player stands. With the new PBR building models
(`src/world/models.ts`: log courses, shingle roofs, crenellations) the built world is ~0.5 M triangles;
multiplied by main + 3 cascades that alone is ~2 M of the 3 M budget, for geometry that is almost
entirely off-screen and tens of kilometres away.

Per-POI clusters cost a few dozen extra draw calls (≈ 94 POIs × the 2–5 materials each actually uses,
and only the handful of POIs in view are drawn), while cutting rendered triangles by ~an order of
magnitude away from a settlement. Measured at Altdorf: **413 draw calls / 5.17 M triangles** against a
1 200 draw-call budget and a 3 M triangle budget (harness run 2026-09-03T00:08, dialogue-gessler-hat).
Roughly 0.5 M of those triangles are the built world, re-drawn in the main pass and each of the three CSM
cascades — i.e. ~2 M of the 5.17 M, nearly all of it settlements the player cannot see. The clearest
evidence: **ruetli-dawn**, a meadow with no building in view at all, still renders 4.17 M triangles in
184 draw calls (harness run 2026-09-03T00:57) — the whole map's merged settlement meshes are in every
frame's shadow cascades no matter where the player stands.

## Notes

* Model triangle counts are now: blockbau 1 308, stone house 1 300, church 712, barn 552, letzi 1 332,
  castle keep 1 088 (unit-tested ≤ 8 000 and ≤ 6 draw calls each in `src/world/models.test.ts`).
* Nothing else changes: the models still share ≤ 8 material instances, so per-cluster merging keeps the
  same "one draw call per material" property *within* each cluster.
* `RADIUS` in `src/exploration/colliders.ts` still matches the new footprints (blockbau ≈ 8×6 m with a
  ±8 % per-spawn jitter, stone house 9×7, church nave 9×13 + tower/apse ≈ 19 m long).
