# Wave 2 — world — critic score

Reference: Skyrim (the landscape reads, landmarks visible from afar, the map is a place). Captures: 5 scenarios,
one invocation each, during an active visual wave — trees `1a40b3c`…`fc94650` (start tree per row). Renderer:
SwiftShader; frame times not scored, heap ~930–995 MB is the known regression, noted not scored. Evidence: green
checks below, every PNG + `report.json` in `tools/critic/world2/`, probes in `tools/critic/probes/world/` (P1–P12).

## Score: 6/10 (pass bar 8) → **FAIL** (round 2/3)

Pass bar: (1) score ≥8 — **no**; (2) zero console/page errors in every scenario — **yes** (0/0 in all five);
(3) LORE — **partial**: no §7 anachronism and every name traces to §3/§4, but two *mandated* places do not
exist as terrain (Bürgenstock §3, Rütli §4 — issues 2, 3).

Round 1 was 3/10, "not the Vierwaldstättersee". No longer true: lake, valleys, roads and passes are right and
9 of round 1's 10 issues are fixed. What holds it at 6 is a spike field on the valley floors that ruins one of
five captured vistas, plus three named places the (now green) suite does not cover.

## Green checks (verbatim, HEAD `1a40b3c`)
```
$ npx tsc --noEmit ; echo rc=$?
rc=0
$ node tools/check-imports.mjs
imports ok
$ npx vitest run src/world 2>&1 | tail -6
 ✓ src/world/terrain-geometry.test.ts (114 tests) 26839ms
 ✓ src/world/poi-siting.test.ts (3 tests) 5ms

 Test Files  8 passed (8)
      Tests  181 passed (181)
   Duration  30.86s
```

**The 4 known-red tests are fixed.** They failed on `90de773` (urnersee 6.6 m / zugersee 24.4 m / lauerzersee
14.0 m shore steps; sattel-road 29.2°); `19e18f8` closed all four. They mattered: my P9 transect at the zugersee
point read `-7 → 1 → 18 → 35` over 60 m (a 67° wall) and now reads `-7 → -1 → 1`. The urnersee and sattel-road
reds were margin, not visible defects.

## Harness captures
Budgets ≤1200 calls, ≤3 M tris, 0 errors/warnings — **all five pass all three**.

| scenario | tree | calls | tris | err/warn | what the PNG shows (≤12 words) |
|---|---|---|---|---|---|
| lake-overview-seelisberg | 1a40b3c | 294 | 1 950 159 | 0/0 | Urnersee reads as a lake; tan road ribbon floats across open water |
| free-altdorf | 1f9b38d | 284 | 1 465 551 | 0/0 | **Rock spike fills two-thirds of frame; Altdorf invisible behind needles** |
| ruetli-dawn | 1f9b38d | 145 | 849 453 | 0/0 | Dawn sun ramp works; Rütli is bare pale scree, blown-out highlights |
| morgarten-winter | 52025af | 80 | 614 975 | 0/0 | Snow ground under overcast; far-shore forest still summer green |
| free-pilatus-luzern | 3f0e0f2 | 150 | 1 008 255 | 0/0 | Far backdrop present at horizon; scene near-black at 19:05 |

Geometries 119–216, textures 100–111, programs 15–17. Heap 929–995 MB (budget 512) — known, excluded. The
`free-pilatus-luzern` darkness is addressed by `5a2e8cb`, committed after that capture — not re-verified.


## Probe results (`tools/critic/probes/world/`, seed 1291, full grid)
| probe | result |
|---|---|
| P2 peaks & passes | pilatus 565/565, stanserhorn 488/488, urirotstock 831/831, mythen 488/488, rigi-kulm 455/455, rossberg 383/382, fronalpstock 494/496, bristen 879/880, gotthard 555/555, klausen 505/505 — **exact**; map max 881 vs 880 |
| P2b every place | 4/89 off by >5 m: `buergenstock` **−226.2**, `rigi` +66.1, `ruetli` **+29.2 (surface `road`)**, `hohle-gasse` −7.7 |
| P3 roads (14, along the real corridor, every 10 m) | max grade 1.7–24.5°, **0 m over 30° on any road**, `road`/`settlement` on **100 %** of every centreline, **0** water crossings; Flüelen→Altdorf→Gotthard and Schwyz→Sattel→Morgarten walkable end to end |
| P1 shores / interiors | worst 10 m step ≤6.5 m on all five Vierwaldstättersee basins (ägeri 11.9, lauerz 12.9, zug 23.3, all at d≥120 m — open flank, not waterline); interiors flat at gazetteer level, ≤5 m bed bumps; ägeri/gersau/luzern have 28–87 shore samples *below* their lake level |
| P4 POIs | 89 places: 0 on >30° ground; 1 wet — `treib` sits **in** the Urnersee at water level |
| P5 Seelisberg | 0/185 sight-line samples to Flüelen occluded; **98 %** of the Urnersee surface visible |
| P7 census / slope | forest 46.1 %, grass 33.4 %, meadow 8.8 %, scree 5.2 %, water 3.0 %, road 0.4 %; **slope >60° = 1.12 %** (round-1 target ≤3 %) |
| P10 far mesh over water | **13 `road` + 1 `settlement` cells inside the Urnersee polygon, 11 up to +3.5 m above the water plane** (also ägeri 6, gersau 7, küssnacht 5, luzern 3, lauerz 3) |
| P11 free-altdorf camera | terrain 38.4 m, clearance 21.6 m, surface `rock`; **tallest terrain within 120 m = 97.4 m — above the camera**; 18/67 sight-line samples to Altdorf occluded, first at 20 m |
| P12 spike census | **1288/272228 cells (0.47 %) rise >40 m above their own 100 m neighbourhood median; worst +349 m**; clusters sit on 8–13 m valley floors |

## `requests/worldlook-2.md` — far-terrain backdrop: **CLOSED, costs the score nothing**
Implemented in `274ec76` (`terrain.ts:213 buildFarMesh`, called `index.ts:44`), sunk 60 m inside the streamed
ring in `1f9b38d`. The horizon in `free-pilatus-luzern` is terrain, not haze. Not a gap any more — but it
introduced issue 4 (road quads over water), and it carries no vegetation, so beyond 3 km forest reads as a
flat green tint (10/10 territory, not scored).

## Round-1 issues
| # | issue | state |
|---|---|---|
| 1 | Lake shores vertical; the lake is a trench | **fixed** (P1, P9, seelisberg PNG) |
| 2 | Roads as sparse discs; passes 85°; road 0.0 % of map | **fixed** (P3: 0 m >30°, 100 % surface, road 0.4 %) |
| 3 | Peaks additive; cameras underground; black frames | **fixed** (P2 exact; no black frame in any of the 5) |
| 4 | Sheer walls, sawtooth jag, no triplanar | **partly** — slope >60° down to 1.12 % and triplanar is in, but the jag became a *spike field* (P12, issue 1 below) |
| 5 | No vegetation beyond 900 m | **fixed** (`vegetation.ts:26,143` tier by camera distance; impostors to 3 km) |
| 6 | Settlement pads bare tan islands | **fixed** (pad blend ×1.6, ×0.35 core; settlement 0.1 % of map) |
| 7 | Region polygons overlap | **partly** — 20/88 still in ≥2 polygons; `regionAt` (`index.ts:141`) resolves places via `PLACE_REGION_ID` |
| 8 | Tests use a 256² grid | **fixed** — `terrain-geometry.test.ts` builds the real grid, 114 tests |
| 9 | Events / unknown-model warning / `snow` missing | **fixed** (`index.ts:41,66,175`; `models.ts:1048`; `index.ts:165`) |
| 10 | No streaming-hitch evidence | **open** — `flyover-streaming` was dropped from the five-scenario scope; still unmeasured |

## Ranked fix list
1. **Valley floors carry free-standing rock needles; `free-altdorf` is a rock face, not a village vista** —
   `free-altdorf.png`; P11 (97.4 m spike 120 m from a camera at y=60; 18/67 sight-line samples to Altdorf
   blocked, first at 20 m); P12 (1288 cells >40 m above their 100 m median, worst +349 m, on 8–13 m floors).
   Fix `src/world/heightmodel.ts:286`: gate the `ridge2D` jag on rock surface *and* low local relief, then
   despike after step 5 (clamp to ≤ median(ring 100 m) + 25 m). Adopt P12 as a test.
2. **Bürgenstock does not exist** — 4.8 m vs LORE §3 / gazetteer 231 m. `src/world/geodata.ts:204`
   (`p.kind !== 'landmark'`) skips it for being kind `viewpoint`, though `peakRadius` already lists it
   (`geodata.ts:195`). Fix: admit `viewpoint` places with a `peakRadius`; widen the peak test past `landmark|pass`.
3. **Rütli is a road cut 29 m too high** — gazetteer 22, terrain 51.2, surface `road` (P2b, P9);
   `ruetli-dawn.png` shows scree where LORE §4 mandates a meadow. `nidwalden-road` ends `…seelisberg, ruetli`
   (`src/content/gazetteer.ts:141`) and `limitGrade` at 14° (`src/world/heightmodel.ts:153`) cannot drop
   122→22 m over 279 m. Fix: end the road at Seelisberg, or exempt authored terminal waypoints from `limitGrade`.
4. **The far mesh paints road/settlement quads across open water** — P10 (13 `road` + 1 `settlement` cells in
   the Urnersee, 11 up to +3.5 m above the plane); dashed tan causeway in `lake-overview-seelisberg.png` and — still,
   *after* the `1f9b38d` far-mesh sink — in `ruetli-dawn.png`, so that commit did not close it. `src/world/terrain.ts:213 buildFarMesh` nearest-samples every 8th texel (62 m). Fix: min
   height + majority surface per block; force vertices inside a lake polygon to water level.
5. **Vegetation ignores the season after populate** — `morgarten-winter.png`: snow ground, summer-green far
   forest. `snowiness()` (`src/world/vegetation.ts:312`) is read only in the populate paths (`:381`, `:425`)
   and nothing repopulates on a season change. Fix: re-tint instance colours when `uSnowDepth` changes.
6. **`treib` POI sits in the lake** — P4: surface `water` at lake level (`gazetteer.ts:19`, `h: 0`). Fix: move
   the landing 15–20 m inland, or raise it to +2 like every other port.
7. **`rigi` and `rigi-kulm` share coordinates** (`gazetteer.ts:51` / `:102`) with different heights, so the alp
   POI stands 66 m underground. Fix: offset the alp ~400 m down-slope.
8. **Lake polygon edges read as straight lines** — hard geometric shoreline corner in `free-pilatus-luzern.png`,
   right shore of `lake-overview-seelisberg.png`. Fix: subdivide/jitter the authored polygons, or feather the
   water edge against the shore-distance atlas.
9. **Region polygons still overlap** — P8: 20/88 places in ≥2 polygons; only places resolve correctly (via
   `PLACE_REGION_ID`). Fix: order `alps-high` last, or assign by nearest region seed.
10. **No streaming-hitch evidence** — `flyover-streaming` has never been captured in either round. Run it once
    and quote `hitches` from a moving camera.

## Not counted
SwiftShader frame times (p95 14–25 s); heap ~1 GB (known, being fixed); erosion-quality terrain, scattering,
planar reflections (10/10 items); far-mesh vegetation beyond 3 km; 1:3 vertical compression — ARCHITECTURE §1.
