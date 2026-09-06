# Phases — Eidgenossen roadmap

Saved 2026-09-05. Phase 2 is the active, fully-planned phase. Phases 3–5 are rough sketches to be refined when reached.
Owner decisions locked: 1080p/60 (RTX 3060/M2); Three upgrade + new npm deps + WebGPU experiment allowed;
any asset source OK (price-conscious AI use, provenance still logged); GEOGRAPHY_VERSION / save-schema breaks OK with migrations.

Baseline (2026-09-05 survey): single WebGLRenderer (ACES/PCFSoft), Preetham Sky + 3-cascade CSM
(terrain excluded via workaround), one splat-shaded terrain material, ear-clip lake water, pooled
InstancedMesh vegetation (60/250 m tiers + impostors), per-POI merged settlements, ≤4-draw characters,
DOM UI with per-frame rebuilds. Tests 39 files/534 green; finalgate 20/20 numeric PASS on SwiftShader
(no 1080p/60 proof). World critic 6/10 FAIL; re-score + blind comparison never ran.

## Phase 2 — Technical + Assets (ACTIVE, no story/NPC-script work)

### 2.0 Enablement (integrator, first)
1. Amend AGENTS.md §1/§5 + ARCHITECTURE.md §0/§2: allow Three >r170, named new runtime deps,
   WebGPU experiment, paid/AI assets with manifest rows.
2. Stack upgrade: three ^0.170 → current, Vite 6→7 if needed. Add: postprocessing (or addons
   EffectComposer), meshoptimizer, KTX2/Basis transcoder.
3. Versioning: GEOGRAPHY_VERSION 13→14 for generation changes; save schema 1→2 only if needed,
   with migration test. Never delete player saves.
4. Observability: opt-in GPU timer queries, in-page perf HUD, --gpu runs recorded with renderer string.
   SwiftShader stays for correctness only.

### Category A — Technical
- **A1 bug batch (AGENTS §10 P0/P1):** quest→combat registration order (main.ts:82-87, combat/index.ts:17);
  stale combat RNG (combat/index.ts:15 vs context.ts:85-88); same-page new-game reset (quest has no reset
  listener); restore() bypassing fill-light wrapper; streamAround() 20 s-timeout resolution; explore-phase
  running under menus; wire invertY/masterVolume to real consumers. Failing-first tests for each.
- **A2 renderer/lighting/shadows:** terrain into CSM (kill terrainMaterial.ts:465-485 workaround); IBL/PMREM
  environment, baked cavity/SSAO; toggleable post chain (AA, grade, vignette/grain; restrained bloom);
  WebGPU path behind flag, timeboxed.
- **A3 sky/weather/water:** volumetric-feel clouds + lightning; GPU rain/snow (replace 1400 CPU points);
  wet-sheen on props/characters; SSR-or-planar water reflection on high quality only;
  fix free-pilatus-luzern near-black exposure.
- **A4 terrain/vegetation:** fix skirt residual + far-cut band; splat bake off main thread if blocking; KTX2
  layers; seasonal re-tint on snow change (critic issue); wind sway; resolve Sarnen 5.43 M tri blowup;
  finally capture flyover-streaming hitch evidence.
- **A5 streaming/memory/CPU:** adaptive view radius under hitch; heap-after-eviction measurement (≤512 MB);
  kill per-frame allocs (HUD compass rebuild, combat renderAll, hover raycast).
- **A6 UI (technical only):** dirty-check HUD, throttle combat hover, virtualize lists, cache mapImage();
  key art, shaded icons, parchment map + fog-of-war + zoom, combat readability, responsive 720p pass;
  delete dead debug overlay; **new WebAudio engine** (ambient/UI/combat; music content stays Phase 3).

### Category B — Assets (manifest → fetcher → CREDITS row → wire with fallback)
- **B1 characters** (biggest gap): 2–3 male civilian bodies ≤8 k tris, 1–2 more women, child/monk/rider
  upgrades, real Habsburg livery cloth, crowd LOD/impostors.
- **B2 buildings/props:** Alpine Blockbau/church/castle/letzi/bridge upgrades, inn/church interiors, market
  stalls, boats; keep 1-call-per-material merges.
- **B3 textures:** KTX2/Basis migration, snow/mud/rock variants, repaint impostor atlas.
- **B4 animation:** missing loops (climb/swim/row/limp), Talk visemes-lite, preload clips on scenario load.
- **B5 key art/icons/map/VFX sprites** (AI-painted title vista, price-capped).
- Per-asset acceptance: evidence PNG, budget delta, fallback proven by deleting the file.

### Phase 2 exit gate
Full finalgate 20/20 + playthrough first/last 18/18 + world critic re-score ≥8 + blind comparison
(the two items never done). STATUS.json evidence updated, no scoreless claims.

## Phase 3 — Story, quests & NPC life (ROUGH)
- Branching: Act 1 choice consequences that persist (raid/restraint memory, hat-outcome callbacks,
  Tell companion arc); gate Burgenbruch castle stages on nearPoi; Morgarten retry polish.
- Dialogue pass: voice-ready line edits, skill-check coverage on flat nodes, KCD tone sweep.
- NPC life content: schedules for the 71 static minors (layout-anchored, not jitter), traveller count up,
  ambient chatter/barks, herds + crossing boats.
- Audio content: music system on the Phase 2 bus (tavern/church/battle stingers), ambient beds per region.
- Balance: Morgarten indiscipline punished (Habsburg footmen brace, sergeant Rally reach; target
  charger ≤50%), enc.brunnen-quay winnable-by-AI or authored-assist canonized.
- Gate: quest critic re-score, blind story playthrough with human-driven fights, lore audit clean.

## Phase 4 — Polish & feel (ROUGH)
- Game feel: hit feedback, camera shake/tweens, controller support, animated UI transitions, portraits,
  damage numbers / BG3-style hover depth.
- Accessibility + i18n groundwork, difficulty modes, tutorials.
- Full content sweep: all six side quests tied to historical mechanics, POI dressing pass, map
  fog-of-war content.

## Phase 5 — Release readiness (ROUGH)
- Hardware 1080p/60 certification on 2–3 real machines, load-time ≤15 s budget, bundle ≤8 MB gz.
- Save-compat freeze + migration suite, crash reporting (local-only), settings auto-detect.
- Steam/itch packaging decision, trailer captures from harness scenarios.

## Risks
Three upgrade breaks onBeforeCompile chains (CSM + splat + foliage share hooks — pin a known-good commit
first); WebGPU path may stall — timebox it; AI asset spend — prefer free downloads, cap per-asset
generation, Blender kitbash for Alpine-specific shapes no dataset has.
