# AGENTS.md — Eidgenossen: working guide

Browser single-player historical RPG: Three.js (r185 installed, `^0.185.1` in `package.json`; r170 was the old baseline), strict TypeScript, Vite 6 (6.4.3 installed), vanilla DOM UI, procedural WebAudio (no audio assets). No backend, framework, external ECS library or multiplayer. Implemented campaign: **1291–1315**; expansion into the 1500s is an ambition, not implemented chapters. Exploration is judged against Skyrim, tactical combat against Baldur's Gate 3, historical tone against Kingdom Come: Deliverance. No magic or default monster enemies. Phase roadmap: `docs/PHASES.md` (Phase 2 = technical + assets, ACTIVE; Phase 3 = story/NPC scripts; Phases 4–5 = feel/release sketches). Release notes: `CHANGELOG.md` (current `0.2.0-phase5`).

Reconstructed from source and tooling on **2026-09-05**, at `7902c7d` (`muse spark overhaul`), refreshed **2026-09-06** against the working tree. This explains implementation and process; it does not certify that every subsystem meets its quality bar.

Working-tree note (2026-09-06): `AGENTS.md` itself is untracked; `ARCHITECTURE.md`, `LORE.md`, `README.md`, `STATUS.json`, `package.json`, `package-lock.json`, `vite.config.ts`, many `src/` files and `tools/` files are modified; `requests/*.md`, `tools/BUILDER_RULES.md`, `public/assets/CREDITS.md` are deleted in the worktree; `docs/`, `CHANGELOG.md`, `src/ui/audio.ts`, `src/core/crashlog.ts`, `src/core/i18n.ts`, `src/strings.en.json`, `tools/i18n/` are untracked additions. Preserve unrelated edits.

## 1. Start here; preserve these boundaries

1. Read this guide, then `git status --short` and `git log --oneline -30`. Preserve unrelated edits.
2. `ARCHITECTURE.md` records binding design decisions/ownership. `LORE.md` is the historical canon/invention register. `docs/PHASES.md` is the phase plan. Actual field names and interfaces are in `src/core/{components,schemas,services,dsl,context,state}.ts`; do not copy obsolete API sketches from old reports.
3. Read the relevant entry point and implementation before changes; read all of `LORE.md` before content work. The original `swiss-rpg-build-spec.md` mentioned in handoffs is **absent** from this checkout. Do not pretend to have read it or reconstruct its exact requirements from memory.
4. Establish the test/render baseline and report built/broken/below-bar behavior before continuing a handoff. Honor any explicit user confirmation gate. Prioritize failing existing behavior over new features; record routine design/canon decisions in their owning document.
5. Keep the build runnable. Do not replace evidence with assurances, self-award critic scores, or describe a unit-test pass as visual/hardware validation.

Feature imports: own files, `@core/*`, `@content/*`, `three`/`three/*` only. Never import another feature's internals. Cross-feature calls use service interfaces in `src/core/services.ts`, through `ctx.services.get('name')` / `tryGet`. `src/main.ts` wires the modules. Aliases must agree in `tsconfig.json` and `vite.config.ts`. The gate (`tools/check-imports.mjs`) scans static `from` imports in the seven feature directories by regex; `vitest` and `node:` specifiers are also tolerated. Passing it does not validate dynamic dependencies.

In delegated work, builders edit only assigned paths. The integrator owns `src/core/*`, `src/main.ts`, `src/content/index.ts`, `src/content/gazetteer.ts`, `ARCHITECTURE.md`, `STATUS.json`, `package.json`, `index.html`, `tools/harness/*`. A scoped builder needing shared changes writes `requests/<module>-<n>.md` (what/why/proposed change); note the `requests/` directory is currently absent from the worktree (snapshots retired 2026-09-05, see §11). New npm runtime dependencies and renderer-stack changes (Three upgrade, postprocessing, WebGPU experiment) require explicit integrator approval per `docs/PHASES.md` §2.0; no casual re-architecture. Every feature retains `export async function register(ctx: GameContext)`, registering its service and scheduler systems. The integrator alone commits; builders must not stash/reset/checkout away other work. Historical multi-agent reports do not themselves authorize launching agents. Asset sources beyond CC0 (including paid/AI) are allowed with manifest + CREDITS provenance rows.

## 2. Commands and environment

Run from the repository root. Use `npm ci` for a clean locked installation; do not replace a working installation unnecessarily. Three is the sole runtime npm dependency (`three@^0.185.1` installed as `0.185.1`; `@types/three` matches). Node/npm and Playwright-compatible Chromium are required for tooling; `package.json` declares no Node engine version. Verified 2026-09-06: Node v26.8.1, npm 11.19.0, Vite 6.4.3.

```sh
npm run dev                       # http://127.0.0.1:5173, strict port
npm run typecheck                 # tsc --noEmit
npm test                          # vitest run (default config inside vite.config.ts)
node tools/check-imports.mjs      # must print: imports ok
npm run build                     # typecheck + Vite production bundle in dist/ (base './' for itch.io sub-path)
npm run preview                   # existing dist/ on 4173; does NOT build

node tools/harness/run.mjs --scenario altdorf-square-noon --out tools/harness/out/local-altdorf
npm run harness:build -- --scenario altdorf-square-noon --out tools/harness/out/local-preview
node tools/harness/playthrough.mjs --pick first --out tools/harness/out/local-story
```

Tests live beside code as `src/**/*.test.ts` (56 files / 700 tests green 2026-09-06) plus `tools/i18n/*.test.ts` under its own vitest config. Default Vitest configuration is **inside `vite.config.ts`**, uses Node, and excludes `tools/critic/probes`. Example: `npx vitest run src/combat/retreat.test.ts`. Historical probes have their own configs, e.g. `npx vitest run --config tools/critic/probes/combat/vitest.config.ts`; inspect first, because some print diagnostics with trivial assertions.

Run the import gate explicitly: `npm run build` does not run tests or the import gate. In concurrent work, scope type errors to your module while resolving integration errors separately; a scoped clean result is not a globally green build.

## 3. Repository map

| Area | Responsibility / useful entry points |
|---|---|
| `src/main.ts` | Boot order, state transitions, frame loop, new game, scenario/story drivers, perf HUD, load marks, debug API |
| `src/core/` | ECS/scheduler, events, context/settings (incl. difficulty, locale, volume, perf), graphics + opt-in GPU timer probe, RNG, Julian clock, registry, shared component/service/DSL/save types, crash log, i18n catalog |
| `src/content/` | Geography, factions, skills/perks/items/abilities/archetypes, POIs/NPCs/encounters, quests/dialogues/cutscenes/strings |
| `src/world/` | Heightfield/cache/worker, chunk streaming, terrain shading, lakes, sky/CSM/weather, vegetation, models/characters, map raster + fog-of-war helpers |
| `src/exploration/` | Player/camera, colliders, settlement layout/streaming, POIs, NPC schedules/crowds/patrols, interactions/travel |
| `src/combat/` | Headless engine, grid/pathfinding/rolls/formation/morale, AI, render adapter, difficulty scaling |
| `src/party/` | Creation/companions, derived stats, skill XP/perks, equipment/inventory/currency, chapter progression |
| `src/quest/` | Machine, conditions/effects, dialogue/checks/cutscenes, reputation/flags/journal, encounter outcomes, music-bus calls, locale overlay loading |
| `src/save/` | Snapshot validation/migrations/compression, IndexedDB/fallbacks, save/load/autosave orchestration, difficulty metadata |
| `src/ui/` | DOM HUD/dialogue/combat, title/creation/pause and RPG menus incl. settings (difficulty/locale/volume/fps), procedural audio engine; CSS/helpers/icons |
| `src/strings.en.json` + `.sha256` | Frozen English string export (i18n source of truth mirror); overlays under `tools/i18n/` |
| `docs/` | `PHASES.md` roadmap (Phase 2 active plan, Phases 3–5 sketches) |
| `tools/harness/` | Scenario JSON, screenshot/metrics runner, Act 1 runner, image shrink/montage helpers |
| `tools/critic/` | Active rubric, historical score sheets/bug hunts/lore audits, separate probes |
| `tools/i18n/` | Translation overlays (`strings.de/gsw.json`), frozen `strings.en.json`, extract/check tests |
| `tools/assets/`, `public/assets/` | Manifests/fetch/conversion tools; shipped textures/models/animations and provenance |

## 4. Boot, frame, state and data lifetime

Boot creates one `GameContext`, loads/validates content, registers **world → save → party → exploration → combat → quest → ui** sequentially (`src/main.ts`), starts the frame loop and enters title. World waits for the CPU terrain grid. Services are long-lived, not registered anew for each game/load. `main.ts` also owns the minimal perf HUD (`Settings.showFps`), boot/new-game/stream load marks (`eid:boot`, `eid:newgame`, stream ms via `loadMarks()`), and the `window.__game` debug API.

`newGame` enters loading, clears the existing ECS (`ctx.resetWorld()`), reseeds, resets time to 1 Aug 1291 06:00, creates the player, sets `prologue-1291`, populates exploration, teleports to Flüelen, streams an 800 m neighborhood, enters exploration, emits `new-game`, and starts `quest.der-eid` unless intro is skipped. Debug default: Kuoni Imhof, Uri, Säumer. Ordering caveat: `main.ts` currently emits `new-game` AFTER `setChapter`/populate/stream, while the quest reset comment describes reset-before-chapter; verify listener ordering effects before touching reset ownership (see §10).

Each frame captures state, clamps real dt to 0.1 s, ticks the clock, runs `always`, then `combat` if the captured state was combat, otherwise `explore`, then renders. Thus `explore` phase also runs in pause/dialogue/loading/title/cutscene; systems must guard themselves. A state change during `always` does not change that frame's captured phase. Scheduler and event exceptions are caught/logged, not silently acceptable.

Only main transitions the state machine; modules emit `request-state`. States: boot/title/creation/explore/dialogue/combat/cutscene/paused/loading/gameover. Legal edges are in `core/state.ts`; illegal transitions warn and return false. State changes enable player control/HUD only in explore; clock runs only in explore/cutscene. A DOM menu overlay and a paused simulation are distinct.

- ECS (`core/ecs.ts`): numeric IDs, component-name stores of plain objects, cached queries invalidated on structural change. Never sort/splice cached query results. Keep `ctx.world` stable across loads: consumers retain it. `.clear()`/`.load()` notify removal listeners for transient cleanup.
- Shared components (`core/components.ts`): Transform, Name, Renderable, Character, Skills, Perks, Equipment, Inventory, PartyMember, Faction, NPC/schedule, Interactable, Poi, EncounterTrigger, Container, Combatant, Dead, Player. `MeshRef`/`Velocity` are transient; no live Three objects in save JSON. Party adds persistent `PartyState`. Check registration options instead of assuming every combat component is transient.
- Entity IDs, content-definition IDs and item-instance IDs differ. Definition IDs are ASCII namespaced kebab-case; display names retain umlauts. Content is aggregated/validated via `content/index.ts` and `core/content.ts`.
- Events are synchronous with a copied listener list. `core/events.ts` has named signatures but also a string-index fallback, so not all custom payloads are compiler-checked.
- RNG (`core/rng.ts`): xoshiro128**, saved world/combat streams, unsaved ambient stream. Forking consumes parent RNG. `ctx.reseed()` **replaces the stream container**; combat now reads it through a lazy getter (`get rng() { return ctx.rng.combat; }` in `combat/index.ts`), so long-lived adapters no longer retain stale streams. Combat snapshots additionally contain engine RNG state.
- Clock (`core/clock.ts`): Julian seconds from 1 August 1291; initial 06:00, default 20 game seconds per real second. `setHour` does not change date. Chapter starts and authored jumps set calendar/season explicitly. Chapter starts: prologue 1 Aug 1291 06:00, ch1 10 May 1307 07:00, ch2 6 Jan 1314 18:00 (`quest/index.ts` `CHAPTER_START`).
- Graphics (`core/graphics.ts`): one renderer/scene/perspective camera, ACES/sRGB, render scale × capped device pixel ratio. Counters include rendered passes. Frame statistics are wall-clock intervals, not GPU timer queries; the opt-in `EXT_disjoint_timer_query_webgl2` GPU probe (`beginGpuSpan`/`endGpuSpan`, 240-sample ring, `gpuP95()`) is separate and only active where supported.
- Crash log (`core/crashlog.ts`): bounded 50-entry / 64 KiB in-memory ring with throttled localStorage persistence (`eidgenossen:crash-log`), Node-safe and never throwing; surfaced via `window.__game.crashLog`.
- Settings (`core/context.ts`): quality, shadowRes, renderScale, viewDistance (500–8000, default 4000), showFps, invertY, masterVolume, language (`en`/`de`/`gsw`), difficulty (`story`/`normal`/`hard`), fontScale, reducedMotion, highContrast. Persisted to `eidgenossen.settings` with validation and fallback to defaults.

## 5. Geography and world rendering

Named coordinates come from `content/gazetteer.ts`: +X east, +Z south, +Y up, north −Z. Simulation distances use game metres, but **1 game metre = 4.5 real horizontal metres**; height is `(ASL − 434) / 3`. Real altitude is `3*y + 434`, not `y + 434`. Bounds x −8000..8000, z −6500..10500. Origin is lake surface off Rütli. Vierwaldstättersee is y=0; other lakes have their own levels. Use `world.lakeLevelAt`/water queries, not a global zero. Some landing points deliberately use dry-land offsets.

Generation is synthetic geography constrained by real place/road/river/lake definitions, **not a downloaded elevation model**:

1. `geodata.ts`: cached peak shapes, road/river spline corridors, lake polygons, settlement pads from content.
2. `heightmodel.ts`: ridge/massif targets and corridor floors, detail noise, protected slope relaxation/despiking, shore blending, smoothing, dry settlement pads, then lake interiors and surface/water classification. Order matters: pads must not lift lake beds into islands. Shore-road gameplay allowances differ from strict far-water visual clamping.
3. `terrain.worker.ts`: grid/chunk generation and typed-array transfer. `TerrainManager` retains CPU height/surface arrays for gameplay even when visual chunks are absent.
4. `chunkmesh.ts`: LOD geometry; `terrainMaterial.ts` / `look/splat.ts`: PBR layers, road/yard masks, cliffs, seasonal snow/wetness and atmosphere. Gameplay surface classes and rendered material weights are not identical.

Main grid: 2048×2176. Separate IndexedDB `eidgenossen-world-cache`, store `heightmaps`, keyed by seed and **`GEOGRAPHY_VERSION` in `world/terrain.ts` (13, confirmed 2026-09-06)**. Bump the version for generation/classification changes or clients can keep old terrain. Do not erase player saves to refresh terrain.

Chunks: 500 m; sample spacing 2/4/8/16 m; LOD thresholds 180/420/900 m. Skirts hide cracks; a decimated far mesh fills the horizon outside a camera-centered hole. Uploads throttle to two/frame. `VIEW_RADIUS` is 3000 m; `viewDistance` 4000 (default) maps to the 3000 m ring (`setViewRadius(viewDistance * 0.75)`), and the settled-camera gate radius follows `viewDistance * 0.275` clamped 400–2000 m. `streamAround()` polls `isSettledAround` and resolves on settle OR a 20 s timeout with no warning (zero-warning gate); the timeout is reported via `isSettled`/`chunksPending` in `stats()`, so promise resolution does not prove every requested mesh finished.

Scene roots: terrain-root, props-root, water-root, dynamic-root. World-stream runs in `always`, order 5, updating terrain, vegetation, water, sky and characters. Initialize sky/CSM before hooked materials. `sky.ts`/`shadowCsm.ts` own sun/cascades, weather/night/season and combat fill (`setCombatFill`, also used by mid-combat restore). `water.ts` triangulates concave lake polygons and uses an animated custom shader.

Vegetation (`vegetation.ts`, `treeGeometry.ts`, `look/{foliage,impostor,rocks}.ts`) uses pooled GPU instances/chunk and distance LOD: full trees near 60 m, intermediate near 250 m, then impostors; grass/clutter are near detail. Quality controls density; seasonal changes can redistribute vegetation. Tree line is converted from ASL, not 1500 game units. Avoid per-frame geometry/allocation storms. `stats()` exposes retained CPU MB and a degraded flag.

Buildings/props: `models.ts`, `models/*`, `assets.ts`, imported kits plus procedural fallback. `placeInstances()` may clone/group models; its name does not guarantee a single GPU-instanced draw. Settlement merging belongs to exploration. Measure actual calls/heap.

Characters (`characters.ts`, `characterAssets.ts`, `characters/looks.ts`, `characters/body.ts`): async imported bodies/Mixamo clips plus procedural/KayKit fallback, skeleton cloning/retargeting, dyed materials, attachments and LOD. Headers describing only procedural figures are stale. `spawnCharacter()` returns an owned `CharacterHandle`, while world centrally ticks animation. Do not tick twice, dispose pooled resources per NPC, or attach late async results to disposed handles. `char.*` wrappers infer movement until explicit speed/animation control. Cosmetic-pruning tests cover auxiliary meshes, not complete visual quality.

World settings consume shadow resolution, view-distance streaming and quality density; UI/core apply render scale, shadow enablement and camera far plane. Region lookup checks named-place overrides then polygons. Map raster is cached and season-invalidated; UI adds discovery/markers. Map fog-of-war helpers (`world/map.ts`: `mapFogAt`, `mapFogKey`, `mapFogSpots`) build reveal discs from discovered POIs plus player position.

## 6. Exploration and settlements

`exploration/index.ts` coordinates `player.ts`, `camera.ts`, `poi.ts`, `npc.ts`, `interact.ts`, `layout.ts`, `settlements.ts`, `colliders.ts` and schedules. Population is chapter-aware, avoids duplicate POIs, and builds layout/colliders before NPC placement. Reconcile persistent entities with transient caches on load.

- Controls: WASD/arrows, Shift sprint, left Alt/Control walk, Space jump, click canvas for mouse-look, wheel follow-camera distance, E interaction. Walk/jog/sprint 1.8/4/6.5 game m/s; swim 1.2; normal walk slope limit 40°. Movement uses terrain/colliders, not visual meshes alone. Disabling control clears held movement keys. `invertY` is wired into `PlayerController` via a settings getter.
- Camera has follow/free/combat modes. Teleports sample ground/push out of solids. Combat frames the field's real elevation with positive upward pitch. Free cameras can leave the player-centered settlement neighborhood.
- Layout searches deterministic dry centers/radii/slopes, places buildings/lanes/yards and role anchors. Ports search inland; camp allowance is 35°. Zug/Küssnacht dry pads and slope tests cover previous placement faults. Fix bad geography and bad placement separately.
- **Settlement geometry builds within 1.5 km of player, disposes beyond 2.2 km**, retaining plans/colliders. Visibility is 1.2 km, shadow range 400 m. This is the major heap fix; never eagerly reconstruct every village during population.
- NPCs: named cast/generic crowds use schedules and role anchors, freeze simulation beyond 300 m, tear down meshes, and advance schedules on reentry. Water/solid checks and crowd bounds matter. Followers/patrols have special behavior; loading rebuilds render state.
- POIs handle discovery, prompts, containers, rest/trade/travel and encounters. Quest fights must not also fire from proximity triggers. Patrol fights can override encounter location to the actual meeting point.
- Fast travel requires discovered/enabled destinations, fades/teleports/streams, advances time by distance/travel speed and emits travel. Boats are authored travel interactions, not general sailing simulation.

Exploration update (phase explore, order 40) skips title/boot/creation, not all non-explore states. Control gating is narrower than NPC/camera ticking; do not assume all simulation freezes under a menu.

## 7. Combat and party

`combat/engine.ts` is a headless `CombatEngineImpl` with a structural host: ECS/content/party/RNG and optional world/quest services. `combat/index.ts` adapts live services; `render.ts` and UI independently consume state/events. Test the adapter as well as rules. Registration-order staleness is fixed by lazy getters: `get rng()`, `get questService()`, `get difficulty()` are read at encounter time, not captured at registration (Phase 2 A1.1/A1.2).

Square grid, usually 1.5 m cells, terrain elevation/cover/obstacles, 8-way movement. Phases: deployment, active, reaction, ended. Commands include deploy/move/ability/stance/end-turn/reaction/flee/auto; exact unions in `core/services.ts`. Action + bonus + movement + reaction economy, d20 Edge/Burden (cancelling advantage/disadvantage equivalents), mundane weapon/formation skills. Pure helpers cover paths, rolls/armor soak, shove/fall, morale/rout, opportunity/brace/cover reactions and polearm/Haufen bonuses. Difficulty (4.4) is snapshotted at `start()`: enemy-originated damage ×0.75 Story / ×1.25 Hard, player-side morale DCs −2 Story / +2 Hard; mid-fight panel changes never retune the running encounter.

Engine legality is authoritative, not preview/UI/AI. `ai.ts` selects doctrine-dependent moves/attacks/reload/brace; overhaul added retreat-tile evaluation and move-before-ranged-follow-up. Preserve reaction costs, loaded state and command-result handling.

`start()` resolves at encounter end; state must be active/serializable before requesting combat because transition autosave relies on it. `restore()` resolves when state is applied, **not** at fight end. Concrete service has additional `resume()` for the eventual outcome (not currently in shared `CombatService`). Never call start to resume a save. Keep engine snapshots and ECS coherent.

Render tick: combat phase, order 200; character animation is world-ticked. Ended state remains for result UI while 3D battlefield objects are cleared (`clearAfterEnd`). Start and restore both turn the combat fill light on; the `end` listener turns it off, so restored mid-combat saves stay legible at night/rain (Phase 2 A1.4).

Party (`party/index.ts`, `rules.ts`) uses ECS with up to four members. Creation: Uri/Schwyz/Unterwalden, mundane backgrounds, strength/agility/endurance/wits/presence. Skill XP is explicitly granted by use; perks/equipment/encumbrance/fatigue affect derived stats. **Equipment slots reference item-instance IDs, not item-definition IDs**; instances point to definitions and currency is separate. Respect era/slot/two-hand/offhand/ammo rules; transfers/removal must clear stale equipped references.

Derived stats use fingerprints/invalidation; avoid undocumented direct mutations. Persistent `PartyState` holds formation, next-item sequence and chapter bookkeeping. Chapter awards/aging must not run twice. `Character.unspentAttributePoints` and its spending service already exist.

## 8. Quest, dialogue, canon and authoring

Content is registered declarative data. Registration functions are fine; arbitrary callbacks inside definitions are not. Shared condition/effect DSL: `core/dsl.ts`; interpreters: quest. Every definition needs `historical: true | 'legend' | 'invented'` and `note`. Invented additions go in `LORE.md` §10. Do not invent named historical politics/geography/conflicts to avoid grounding work.

The Federal Charter is historical; Rütli oath scenes and Tell/Gessler tradition are founding legend, not documented eyewitness history. No literal Pilatus dragon, plate harness, windlass crossbows, anachronistic Kapellbrücke, Swiss-cross national flag, potatoes/maize or modern “canton” in NPC speech. Read the full canon for social terms/equipment/timeline. Future events in canon do not imply implemented chapters. Source new factual claims; label gameplay inventions.

`quest/index.ts` coordinates runtime reads/writes, machine, dialogue, conditions/effects and cutscenes. Machine state holds stages/vars/done/failed/journal. Progress checks occur about every 0.5 s and on relevant flag/reputation/discovery/time events. Stage changes emit before async entry effects finish; public start/advance may launch effects asynchronously. A closed UI is not evidence an effect chain ended.

Effects execute sequentially, awaiting encounters/scenes. Combat outcome/dead/downed are quest-scoped with separate last-combat data; stale results must not advance unrelated quests. Scene-depth/deferred effects avoid reentrant transitions: do not await a deferred job that cannot execute until the containing scene ends. Dialogue caches check rolls in quest vars and sets speaker/talked flags. Hiding dialogue can resolve its pending choice as index 0; it is not neutral cancellation.

Quest owns a same-page new-game reset (`resetForNewGame`, subscribed to `new-game`): it clears machine, reputation, flags, deferred effects and chapter bookkeeping. Chapter chapters are `prologue-1291`, `ch1-1307`, `ch2-1314`; `setChapter` is idempotent for the current chapter and restores without replaying entry effects.

Main spine (IDs prefixed `quest.`): der-eid → der-hut/burgenbruch → epilog-1308 → marchenstreit → muster-1315 → morgarten → brunnen-1315, plus six side quests. `setChapter` applies clock/party/population/journal once per chapter; restore copies state without replaying entry effects. Morgarten failure resets muster/battle with silent-journal retry handling; whole-party death can enter gameover. The `{music: 'music.*'}` DSL effect now drives the real procedural music bus (`ui/audio.ts` beds `tavern`/`church`/`battle`/`explore`/`morgarten`/`title` plus region ambience), not a log stub; unknown beds stop the music.

| Encounter | Sole story owner / entry |
|---|---|
| `enc.brunnen-quay` | `quest.der-eid`, escort entry effect |
| `enc.altdorf-square` | `dlg.gessler-hat` confrontation choice during `quest.der-hut` / altdorf-pole |
| `enc.hohle-gasse` | `quest.der-hut`, hohle-gasse entry effect |
| `enc.einsiedeln-gate` | `quest.marchenstreit`, raid entry effect |
| `enc.morgarten` | `quest.morgarten`, battle entry effect |

Side-giver roots are wired: Niklaus Planzer (Säumer), Melchior Arnold (Alpstreit), Uli Fischer (Gersau), Trudi Meier (Pilatus tale), Burkhard Wyrsch (shooting contest), Jost Durrer (Wolfenschiessen). New content needs definition/registration, valid references/era/history, accessible interaction entry, effect/save tests and branch playthrough. Merely registering a quest does not finish it.

Strings/i18n (Phase 4 groundwork, already landed): content defs are never rewritten per language. Display-time `t()` resolves `quest.*`, `dlg.*`, `ui.*`, `cs.*`, `misc.*` IDs; `en` is builtin and extracted from content at load, `de`/`gsw` are fetched JSON overlays with silent `en` fallback. Translators work from the frozen `tools/i18n/strings.en.json` (+ `.sha256` mirror at `src/strings.en.json`); `tools/i18n/check` validates 100% ID coverage and placeholder-set equality (`{player}` etc. must be preserved byte-identical).

## 9. Save/load and UI

Save: `save/index.ts` orchestration, `host.ts` structural adapter, `db.ts` storage, `snapshot.ts` validation/codec, `migrations.ts` upgrades. Storage/round-trip tests need no GPU. A Phase 5 freeze suite pins `SAVE_SCHEMA_VERSION = 1` (no bump in that workstream).

- Current file schema 1. Migrate supported old payloads; reject future/corrupt data before mutation. Save persistent ECS including PartyState, quests/flags/reputation/journal/chapter, discovery, world/combat RNG, clock/weather/season, difficulty + encounter difficulty metadata, and optional active combat. Rebuild render objects. File-schema migrations are not automatic per-component migration magic.
- Slots: autosave 0, manual 1–5, quick 6. Encoded limit 2 MiB; codec header + gzip via browser compression streams, raw fallback.
- IndexedDB `eidgenossen` / `saves`; sticky fallback to localStorage then memory. Settings key `eidgenossen.settings`; world cache is separate. Crash log key `eidgenossen:crash-log`. Do not conflate them.
- Save/load share a busy queue; list/delete/import do not all use that queue. Loading validates, enters loading, clears/reseeds/restores ECS/services, emits loaded for transient reconstruction, streams the neighborhood, resumes combat/explore. Failure after mutation returns to title rather than asserting old state survived.
- Autosave requests follow quest/chapter/new-game/travel and ten-minute timer, usually deferred until explore. Entering combat is special so the snapshot includes the active encounter. Loading clears pending autosave. F5/F9 are exploration-only. Thumbnails are small JPEGs, not full screenshots.

UI: vanilla DOM under `#ui` over `#game`; `ui/index.ts`, `menus.ts`, `combat.ts`, helpers/icons and `ui.css`. Screens cover title/creation, HUD/dialogue, inventory/character/perks/formation, map/journal (with fog-of-war), trade/container/rest, settings (quality/shadow/view-distance/render-scale, difficulty, locale, font scale, reduced motion, high contrast, show-FPS, invert-Y, master volume)/save/load/pause, combat deploy/turn/reaction/results. Shared party selection links inventory/character views. Combat submits authoritative commands and displays rejection; previews/target cards must refresh when state changes. Hotkeys must respect typing, menus and terminal states.

Audio (`ui/audio.ts`): lazy-unlock procedural WebAudio, no-op without WebAudio. SFX (click/hit/clash/twang/step/splash/fanfare/lament), modal music beds, region ambience. Master gain follows `ctx.settings.masterVolume` via `ctx.onSettings` (perceptual `volumeToGain`); invert-Y has a real consumer (player controller). Reduced-motion is read tolerantly by the combat renderer (setting + panel control only). `ctx.applySettings` persists, resizes and notifies subscribers. Menu requests can pause only where the state graph permits; test cutscene/gameover overlays explicitly. Build uses `base: './'` so `dist/` serves from sub-paths/iframes.

## 10. Verification and open findings

### Fresh baseline, 2026-09-06

`npm test`: **56 files / 700 tests passed** (was 39/534 on 2026-09-05). `npm run typecheck`: clean. Import gate: **imports ok**. Installed: three 0.185.1, Vite 6.4.3, Node v26.8.1. Corrupt-save tests intentionally print handled errors; these are not browser console failures. No fresh browser captures were run for this refresh.

Previously inspected `tools/harness/out/finalgate/report.json` (2026-09-05 13:21 UTC): 20/20 numeric passes, zero errors/warnings, maxima 567 calls / 2,891,090 triangles / 225 MB heap. Altdorf: 451 calls / 2,519,688 triangles / 109 MB. SwiftShader worst p95 **2582.8 ms**, not 60 fps evidence. These are existing report values, not a new run or visual score. Ignored reports may be absent in another checkout.

Existing first/last-choice story reports (17:37/18:01 UTC) both record an early-fight concession assist at round 28 with no player units standing, followed by the authored fled branch. **18/18 means progression, not four victories or an unassisted run.** Current Morgarten test sample: 23/24 wins (96%), p90 26 rounds; an old test-title percentage is stale. Neither sample nor progression certifies balance.

### Resolved since the 2026-09-05 audit (verify before regressing)

1. **Live quest→combat wiring:** fixed by lazy getters in `combat/index.ts` (`get questService()`, `get rng()`, `get difficulty()` read at encounter time). Engine flags `hunenberg-warning`, `morgarten.letzi-improved`, `morgarten.recruits-strong` now resolve through the live quest service. Keep live-adapter coverage, not only mocked-engine tests.
2. **Stale combat RNG:** fixed by the same lazy `get rng()`; `ctx.reseed()` replacement no longer leaves a stale retained stream. Mid-combat snapshots separately restore engine RNG.
3. **Settings consumers:** `invertY` feeds `PlayerController`; `masterVolume` drives the audio master gain via `onSettings`; combat `restore()` turns the combat fill light on with `end`-listener teardown matching `start()` (Phase 2 A1.4).
4. **Streaming timeout ambiguity:** `streamAround()` still resolves after 20 s, but settle-vs-timeout is now observable via `isSettled`/`chunksPending` in `stats()` instead of being mistaken for completion.

### Open findings: reproduce/fix, do not silently mark complete

1. **Same-page new-game ordering:** `resetForNewGame` exists and subscribes to `new-game`, but `main.ts` emits `new-game` AFTER `setChapter`/populate/stream while the quest comment describes reset-before-chapter. Reproduce a second game after progress and reconcile the comment/order before changing reset ownership.
2. **Visual bar unproven:** last reported world critic score 6/10; round-3 re-score and blind side-by-side judging lack completion evidence. Shared male body, procedural child/monk/rider and tint-based Habsburg livery remain art limitations to inspect. New terrain work can invalidate old frames.
3. **Hardware target unverified:** software reports cannot establish 1080p/60 fps/no-hitch budgets. Numeric passes cannot establish composition, walkability, historical fidelity or absence of loading artifacts.
4. **Phase 2 exit gate still pending:** full finalgate 20/20 + playthrough first/last 18/18 + world critic re-score ≥8 + blind comparison, with STATUS evidence and no scoreless claims (`docs/PHASES.md`).

`STATUS.json` mixes older top-level scores/timestamp with newer nested evidence. Read dates/source rather than treating any single stale field as current truth; preserve existing status edits during unrelated work.

### Harness mechanics and interpretation

`run.mjs` launches a private Vite server on a free loopback port with HMR/watch disabled (`HARNESS_NO_HMR=1`). Flags: `--scenario id[,id]`, `--out dir`, `--preview`, `--gpu`, `--port N`, `--keep`. **Direct `--preview` only serves existing dist**; `npm run harness:build -- ...` builds first. Browser: `HARNESS_CHROMIUM`, else `/opt/pw-browsers/chromium`, else Playwright default. `--gpu` changes launch flags; check actual renderer string.

Scenario resolution: 1920×1080, DPR 1. SwiftShader default can be extremely slow. **Two** lock slots `.lock`/`.lock2`, PID files, five-minute heartbeat, three-hour stale threshold, four-hour acquisition timeout. Old comments about one slot/45 minutes are stale. Use distinct output dirs; avoid unnecessary software contention. Never remove a live lock merely because execution is slow.

Budgets: ≤2000 calls/frame, ≤3M triangles, ≤512 MB heap; zero browser errors **and warnings**. p95 ≤16.6 ms is ENFORCED only with `--gpu` or `HARNESS_ENFORCE_P95=1`; software runs record `p95warn` instead of failing. Hardware target: 60 fps at 1080p mid-range hardware, p95 ≤16.6 ms, no unscripted >16 ms hitch outside loading. Critic's ≤1200 world calls is headroom, not a new hard cap. Score ≥8 needs screenshot/test evidence and canon compliance. Report renderer/resolution/scenarios/numbers/untested gaps; never inflate scores.

`window.__game` is always exposed; `window.__harness` aliases it with `?harness=1`. Await `ready`; API includes ctx/newGame/loadScenario/setCamera/setTime/setWeather/stats/screenshotReady/runCombatScript/runAct1Playthrough plus `loadMarks()` and `crashLog`. This is debug access, not a backend.

Scenarios configure game/chapter/flags/time/weather/camera and optional fight/dialogue/menu/save/flyover. Existing uncommitted main changes clean up between scenarios with flee/hide/frame waits. Cleanup is effectful, not a complete runtime reset. Read the driver before blaming leaked state on a module.

`screenshotReady()` waits for streaming with timeout, warms 30 frames, clears samples/hitches, samples 120 frames. Inspect PNGs for intended content. Reports include counts/heap/frames/errors/warnings/notes plus GPU-probe p95, frame p95 and load marks. **Automated `pass` does not enforce p95 without `--gpu`/opt-in; warnings and `skipped` notes do not automatically fail.** `ok` is an earlier scenario-execution flag, not the aggregate budget verdict. Some skipped fields hold successful diagnostics. Read each field; Boolean pass is not critic acceptance.

`playthrough.mjs`: private server, **1280×720 SwiftShader**. `--pick first|last|random`; `--dialogue-shots` opts into extra per-node dialogue captures (slow: up to ~25 s each under load; beats are always captured). Drives 18 story beats including recruits, deploys/auto-steps fights, may concede with explicit `harness-assist` notes. Inspect outcomes/errors/warnings/party/screenshot failures/final state. Completion is not a screenshot-quality gate; final metrics are not per-beat maxima.

Current scenario IDs (`tools/harness/scenarios.json`):

```text
title                       lake-overview-seelisberg
free-altdorf                free-morgarten
free-schoellenen            free-pilatus-luzern
ruetli-dawn                 altdorf-square-noon
gotthard-schoellenen         schwyz-village-dusk
sarnen-night-rain           morgarten-winter
flyover-streaming           combat-morgarten-setup
combat-brunnen-quay         dialogue-gessler-hat
menu-inventory              menu-map
combat-brunnen-quay-turn    save-load-roundtrip
```

Acceptance: ≤2000 calls/frame, ≤3M triangles, ≤512 MB heap; zero browser errors **and warnings**. Hardware target: 60 fps at 1080p mid-range hardware, p95 ≤16.6 ms, no unscripted >16 ms hitch outside loading. Critic's ≤1200 world calls is headroom, not a new hard cap. Score ≥8 needs screenshot/test evidence and canon compliance. Report renderer/resolution/scenarios/numbers/untested gaps; never inflate scores.

## 11. Assets, documents and change recipes

Provenance: `public/assets/CREDITS-models.md`, `CREDITS-world.md`, `CREDITS-characters.md` (the old single `CREDITS.md` is gone in the worktree); manifests: `tools/assets/{manifest,world-manifest,characters-manifest}.json`. Preserve KayKit/upstream licences. Owner allowed sources beyond CC0, but availability is not redistribution permission: record author/URL/licence as found/files/sizes and check intended-use terms. Do not label all art original or CC0. Current inputs include village/KayKit kits, Poly Haven maps and Mixamo-derived bodies/clips.

Fetchers (`tools/assets/fetch.mjs`, `fetch-world.mjs`, `fetch-characters.mjs`) write assets/credits: inspect manifests before running. `fbx2glb.mjs` handles embedded textures, downscaling and cm→m; `glbsheet.mjs` renders evidence, `albedo.mjs` supports texture inspection. Browser tooling, not Blender; inspect script headers for parameters/executable assumptions. `mixamo-clips.txt` is an upstream name catalogue, not approved medieval gameplay—modern names there do not justify modern abilities. `tools/assets/ai-terrain.mjs` is untracked worktree tooling; inspect before use.

Common change routes:

- Terrain/siting: gazetteer/geodata/heightmodel → layout/collisions; bump geography version; test terrain/siting and inspect free/ground-level scenes. Check shore/roads/massifs together.
- Models: preserve IDs/handle lifetime, update manifests/credits, verify async load/dispose/grounding/attachments/LOD, measure heap after eviction as well as calls.
- Combat: pure rules **and** real adapter/state/save integration; deployment/reactions/results scenarios plus story branches. Do not tune encounter data to conceal wiring faults. Difficulty changes need engine + save-metadata + settings-panel updates together.
- UI: state/hotkey ownership and authoritative result tests, then actual dialogue/combat/menu captures at target resolution. Settings additions need context validation + panel control + real consumer.
- Saves: types/validation/explicit migrations together; test corrupt/future data, all slot kinds, equipment/PartyState/RNG/mid-combat/difficulty. Never delete player saves to fix a cache issue. Schema is frozen at 1 by `save/freeze.test.ts` for the Phase 5 workstream.
- Strings: content stays language-neutral; add IDs to the extractor mirror (`quest/i18n` + `tools/i18n/extract`), regenerate `strings.en.json`/sha, validate overlays with check (100% coverage, placeholder equality).
- Shared change: smallest interface request, integrator wiring, real registration-order test; document justified architecture changes explicitly.

Maintain this as operational entry point, architecture decisions in `ARCHITECTURE.md`, canon in `LORE.md`, phase plan in `docs/PHASES.md`, release notes in `CHANGELOG.md`, dated verification in STATUS/critic evidence. Historical score sheets/audits are evidence, not current task instructions (`tools/critic/README.md`). Do not delete licences, machine-input text or useful evidence solely for age.

The 2026-09-05 cleanup consolidated builder rules and retired these request snapshots: art-1/2 (batching/animation), exploration-1/2 (dry siting), party-1 (attributes), quest-1 (giver wiring), quest-2/3 (encounter ownership/Morgarten flags), ui-4/5 (settings), world-1/2 (camera/scenario cleanup), worldlook-1/2 (lake API/far mesh). `requests/` and `tools/BUILDER_RULES.md` are absent from the current worktree. **Retired does not mean all acceptance criteria passed**: the remaining new-game ordering question is above. Historical reports naming deleted requests refer to snapshots recoverable in Git where tracked. Source comments mentioning `BUILDER_RULES` refer to the former task constraints now consolidated here, not a missing runtime dependency.
