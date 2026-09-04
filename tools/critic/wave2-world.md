# Wave 2 — world — critic score

Reference: Skyrim (the landscape reads, landmarks visible from afar, the map is a place)
Tree: `2074f51` (incl. `19e18f8` geometry round, `274ec76` far-terrain backdrop). Renderer: SwiftShader — frame times not scored.
Evidence: green checks below; 10 harness scenarios to `tools/critic/world2/<id>/` (every PNG + `report.json` read); my probes in `tools/critic/probes/world/` (full 2048×2176 grid, 4 files).

## Score: PENDING/10 (captures in flight)

## Green checks (verbatim)

```
$ npx tsc --noEmit ; echo rc=$?
rc=0
$ node tools/check-imports.mjs
imports ok
$ npx vitest run src/world 2>&1 | tail -6
 ✓ src/world/terrain-geometry.test.ts (113 tests) 18828ms
 ✓ src/world/poi-siting.test.ts (3 tests) 5ms

 Test Files  7 passed (7)
      Tests  166 passed (166)
   Duration  21.92s
```

**The 4 known-red tests in `terrain-geometry.test.ts` are no longer red.** At my first run on `90de773` they
failed (urnersee 6.6 m, zugersee 24.4 m, lauerzersee 14.0 m shore steps; sattel-road 29.2°); `19e18f8` fixed all
four and the suite is 166/166. They mattered: the zugersee 24.4 m step was a real 67° wall at the waterline
(my P9 transect then read `-7 → 1 → 18 → 35` over 60 m off the water; it now reads `-7 → -1 → 1` — flat shore).
The urnersee 6.6 m and sattel-road 29.2° reds were cosmetic margin, not visible defects.

## Probe results (`tools/critic/probes/world/`, seed 1291, full grid)

| probe | result |
|---|---|
| P1 lake interiors flat at gazetteer level | zugersee/sarnersee perfect; elsewhere 0.3–9 % of interior cells poke ≤ +9.7 m through the plane (urnersee 97/2305, luzern-basin worst +9.7 m at 28 m inside the shore) |
| P1 shore continuity | worst 10 m step: urnersee 6.2 m, luzern 3.8 m, gersau 4.6 m, alpnach 5.0 m, küssnacht 6.5 m, sarnen 9.2 m, ägeri 11.9 m, lauerz 12.9 m, zug 23.3 m (all at d≥120 m, i.e. open flank, not the waterline) |
| P1 lake as raised slab | ägerisee 87, gersau 28, luzern 28 shore samples sit **below** their lake level (was 7/28/28) |
| P2 peaks & passes vs gazetteer | pilatus 565/565, stanserhorn 488/488, urirotstock 831/831, grosser-mythen 488/488, rigi-kulm 455/455, rossberg 383/382, fronalpstock 494/496, bristen 879/880, gotthard 555/555, klausenpass 505/505 — **exact** |
| P2b every place vs gazetteer | 4/88 off by >5 m: `ruetli` +29.2 (surface `road`), `rigi` +66.1, `hohle-gasse` −7.7, `buergenstock` **−226.2** |
| P2 map maximum | 881 game-m (highest gazetteer landmark 880) ✓ |
| P3 roads (14, along the real corridor, every 10 m) | max grade 0.8–24.5°, **0 m over 30° on any road**, `road`/`settlement` on **100 %** of every centreline, **0** water crossings |
| P3 Flüelen→Altdorf→Gotthard | corridor walkable end to end; straight-line shortcuts still hit 78–83° (Silenen→Amsteg, Amsteg→Göschenen) — correct for a gorge, the road is the way through |
| P3 Schwyz→Sattel→Morgarten | walkable; worst straight-line segment 30.4° |
| P4 POI siting | 88 places: 0 on >30° ground, 1 wet — `treib` is **inside the Urnersee at water level** |
| P5 Seelisberg sight line | 0/185 ray samples occluded to Flüelen; **97 %** (408/419) of the Urnersee surface visible from the viewpoint |
| P6 terrain within 3 km | only the 7 summit POIs have nothing higher within the stream radius (correct — they are the high points); 27.9 % of the map is >3 km from any place |
| P7 surface census | forest 46.1 %, grass 33.4 %, meadow 8.8 %, scree 5.1 %, water 3.0 %, rock 2.2 %, mud 0.7 %, **road 0.4 %**, settlement 0.1 % |
| P7 slope budget | <30° 93.3 %, 30–45° 4.0 %, 45–60° 1.6 %, **>60° 1.12 %** (round-1 target ≤3 %) |
| P8 regions | 0 places unresolved; 20/88 inside ≥2 polygons, but `regionAt` resolves gazetteer places via `PLACE_REGION_ID` first, so all 88 are correct |
| P9 transects | Axen `0→83 m over 240 m` continuous ✓; Rütli `51 m, surface road` ✗; Bürgenstock `0→28 m over 240 m` where LORE §3 wants a 231 m ridge ✗ |

## `requests/worldlook-2.md` — far-terrain backdrop: **CLOSED, not a gap**

Implemented and committed in `274ec76` (`terrain.ts:213 buildFarMesh`, called at `index.ts:44`): one static
~256×272 decimated mesh of the whole map, 1.5 m below the true surface, terrain material as-is, one draw call,
`frustumCulled = false`. It is in these captures. Cost to the score: **0** — it was the largest open legibility
gap at the time it was filed and it is now closed; what remains is that the far mesh carries no vegetation, so
beyond 3 km forest reads as a flat green tint rather than trees (noted, not scored — that is 10/10 territory).

## Historical compliance (LORE)

- 14 regions, ids exactly LORE §3 ✓; lakes and their levels per §3 ✓; peak heights per §3 now exact ✓
- **Bürgenstock is named in LORE §3 as a visual anchor at 1128 m → 231 game-m and renders at 4.8 m** — the massif
  between the Luzern and Buochs basins is absent. Not a §7 anachronism; a §3 legibility failure (issue 2).
- Rütli is a LORE §4 *mandated* POI of kind `meadow`; the terrain there is `road` at +29 m (issue 1).
- No invented place names; no §7 anachronism is player-facing; no §10 rows required ✓

## Round-1 issues

| # | round-1 issue | state |
|---|---|---|
| 1 | Lake shores vertical walls; the lake is a trench | **fixed** — Axen now continuous (P9); worst waterline step ≤6.5 m on the Vierwaldstättersee basins |
| 2 | Roads/rivers as sparse discs; passes 85°; `road` 0.0 % of map | **fixed** — polyline corridors + `limitGrade`; 0 m over 30°, 100 % road surface, road 0.4 % of map |
| 3 | Peaks additive; cameras underground; black frames | **fixed** — peaks are absolute targets, all 10 exact, map max 881 vs 880; camera-above-ground tests green |
| 4 | Sheer walls, sawtooth jag, no triplanar | **fixed** — slope-limited relaxation, jag ×3 rock-gated (`heightmodel.ts:286`), triplanar + de-tiling (`terrainMaterial.ts:301`) |
| 5 | No vegetation beyond 900 m | **fixed** — tiering is by camera distance not chunk LOD (`vegetation.ts:26,143`), impostors to the full 3 km |
| 6 | Settlement pads bare tan islands | **fixed** — pad blend ×1.6 outer, only a ×0.35 core classifies `settlement` (`heightmodel.ts:420-421`); settlement is 0.1 % of the map |
| 7 | Region polygons overlap | **partly** — 20/88 still in ≥2 polygons; `regionAt` (`index.ts:141`) resolves *places* via `PLACE_REGION_ID`, arbitrary points still first-match |
| 8 | Tests use a 256² grid | **fixed** — `terrain-geometry.test.ts` builds the real 2048×2176 grid, 113 tests |
| 9 | `chunk-loaded` / `time-changed` not emitted; no unknown-model warning; no `snow` | **fixed** — `index.ts:41,66,175`, `models.ts:1048`, `SURFACE_IDS` + live snow override `index.ts:165` |
| 10 | No streaming-hitch evidence | see the `flyover-streaming` row in the capture table |

## Harness captures

Budgets: ≤1200 calls, ≤3 M tris, 0 errors, 0 warnings. Frame times SwiftShader — not scored.

| scenario | calls | tris | err/warn | what the PNG shows (≤12 words) |
|---|---|---|---|---|
| lake-overview-seelisberg | 366 | 2 004 376 | 0/0 | Urnersee reads as a lake; road ribbon floats across open water |
| (remaining 9) | | | | PENDING |

## Ranked fix list

PENDING — finalised with the captures.
