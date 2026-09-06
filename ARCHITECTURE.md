# ARCHITECTURE.md — Eidgenossen

Binding design decisions and module boundaries. Integrator-owned. The current implementation map, commands, lifecycle details and verified open findings are in [AGENTS.md](AGENTS.md). Historical canon remains in [LORE.md](LORE.md).

Consolidated 2026-09-05: earlier illustrative interfaces/component tables had drifted from the code and have been removed. Exact public contracts live in `src/core`; this document records decisions, not duplicate TypeScript declarations. Numbered areas remain recognizable to existing source comments.

## 0. Stack and scope

Single-player browser RPG; Three.js (r170 baseline, upgrades allowed by integrator decision — Phase 2: r18x),
strict TypeScript, Vite 6 (7 if upgrade requires), vanilla DOM overlay. Hand-rolled Map-based ECS, no backend,
raw IndexedDB with local fallback. New npm runtime dependencies allowed by explicit integrator decision
(Phase 2: postprocessing/EffectComposer path, meshoptimizer, KTX2/Basis transcoder). A WebGPU renderer path
may exist behind a flag alongside WebGL (experimental, timeboxed). Preserve deterministic/saveable plain data
and independently testable rules.

Act 1 covers 1291–1315; later centuries are extension scope. Skyrim exploration loop, BG3 action economy without magic, Kingdom Come grounded tone. Existing choices are settled: propose architectural changes only for demonstrated bugs/limitations, documenting why and affected contracts here.

External assets are permitted with recorded source/author/licence/files/sizes and appropriate usage rights. Provenance lives in `public/assets/CREDITS-{models,world,characters}.md` and matching `tools/assets/*manifest.json`; not all assets are CC0.

## 1. Coordinates and time

Game-space distances use metres, with +X east, +Z south, +Y up. Geography compresses real horizontal distance 4.5:1 and vertical relief 3:1. Gazetteer is authoritative: `src/content/gazetteer.ts`. Height = `(ASL - 434) / 3`; inverse = `3*y + 434`. Bounds x −8000..8000, z −6500..10500. Vierwaldstättersee is y=0; other lake levels are queried, not assumed zero.

Julian calendar, game seconds from 1 August 1291, default 20× time; story jumps explicitly set dates. Content IDs are namespaced ASCII slugs; proper names retain historical spelling. Combat normally uses a 1.5 m square grid. Seeded world/combat randomness is persisted; ambient randomness is not.

## 2. Quality and performance budgets

- 60 fps at 1080p on mid-range hardware; p95 ≤16.6 ms and no unscripted >16 ms hitch outside loading.
- ≤2000 draw calls/frame; harness limits ≤3M triangles and ≤512 MB JS heap.
- Encoded save ≤2 MiB per slot; autosave, five manual slots, quicksave.
- Zero browser console/page errors and warnings; critic score ≥8 on evidence, full historical compliance for content.

Software-rendered harness results do not establish hardware frame budgets. Automated pass omits some acceptance criteria; see AGENTS §10. Do not describe texture/geometries counters as measured GPU memory or treat desired budgets as already achieved.

## 3. Shared data model

`core/components.ts` declares ECS schemas; `core/schemas.ts` defines content/save types; `core/dsl.ts` defines conditions/effects; `core/ecs.ts` supplies storage/query/serialization/scheduler behavior. Preserve the same ECS object across reset/load. Persistent components are plain serializable data; transient Three objects are rebuilt. Item definitions, item instances and entity IDs are distinct.

Save migration is explicit at file-schema level in `save/migrations.ts`. Shared fields require coordinated type, validation, migration and consumer updates. Never use stale prose signatures in place of actual types.

## 4. Service contracts and dependencies

`GameContext` owns ECS, scheduler, events, clock, RNG, services, content, settings and graphics. `core/services.ts` defines the shared interfaces. Features import only own files, core, content and Three. Cross-feature calls go through services, never another feature's implementation. `src/main.ts` alone composes all feature registrations.

Look up late-registered services and replaced RNG streams at the right lifetime boundary. Registration order is world/save/party/exploration/combat/quest/ui; dependencies may be unavailable at registration but available when an action runs. Current adapter violations are recorded in AGENTS §10, not silently waived.

## 5. Feature ownership

### 5.1 World

Owns geography generation, CPU queries, visual streaming, sky/water/vegetation, assets/characters/map. Gameplay queries remain independent of visual chunk residency. Generation changes invalidate the versioned terrain cache. Callers own spawned handles; world centrally ticks character animation.

### 5.2 Exploration

Owns player/camera, collision, POI interaction/discovery, NPC schedules/patrols and settlement layout/streaming. Keep lightweight plans/colliders separate from disposable render geometry. Story encounter ownership belongs to quest, not duplicate proximity triggers.

### 5.3 Combat

Owns headless authoritative command/rules engine and render adapter. Action/bonus/movement/reaction, Edge/Burden, mundane weapons/formations/morale. Start completion and restore completion are different contracts; preserve active-state autosave and deterministic resume.

### 5.4 Effect / condition DSL

Shared definitions live in `core/dsl.ts`; quest interprets conditions/effects against service-backed runtime reads/writes. Preserve sequential async effects and quest-scoped outcomes. Extend the DSL explicitly instead of putting free code into content.

### 5.5 Party

Owns creation, companions, use-based XP/perks, equipment/inventory/derived stats and chapter progression. Equipment uses instance IDs; persistent PartyState makes item sequencing/formation/chapter awards saveable.

### 5.6 Quest/dialogue

Quest owns DSL execution, machine/dialogue/cutscene runtime, flags/reputation/journal and encounter outcome routing. Content owns declarative definitions and grounded text. LORE remains authoritative; invented additions must be registered in §10. No arbitrary callbacks inside content definitions.

### 5.7 Save

Owns validation, migration, codec/storage, transactional orchestration and autosave policy. Validate before mutation; rebuild transient state after restore. Settings/world cache/player saves have distinct stores and lifetimes.

### 5.8 UI

Owns DOM presentation/input and command submission, not duplicated gameplay rules. Respect state/menu/typing ownership; preview does not authorize an action. Settings need real downstream consumers.

### 5.9 Content

Owns registered declarative geography, factions, people, equipment, abilities and authored story. Every definition needs historical metadata and valid references. Named coordinates are shared through the gazetteer; invented additions belong in LORE §10.

## 6. State and frame ownership

Only main transitions states; features emit request-state. Scheduler phases are not automatic state guards: always runs each frame, then combat for captured combat state, explore otherwise. Features must explicitly gate updates. Menu presentation is not equivalent to paused simulation.

## 7. Bootstrap and persistence lifecycle

Services survive new games/loads, while ECS data is cleared/restored. Reset responsibilities must cover both ECS and service-local state. Never assume reseeding mutates retained RNG objects. Loading rebuilds render objects through persistent identities and loaded events, then streams/resumes; do not rerun story entry effects merely to reconstruct visuals.

## 8. Verification process

Run typecheck, tests, import gate, production build and task-relevant rendered scenarios. Inspect actual PNGs and report renderer/resolution/counts/frames/errors/warnings/assists. Act 1 completion can follow fled branches and is not proof of four victories. Commands and harness pitfalls: AGENTS §§2/10. Active scoring policy: `tools/critic/RUBRIC.md`; old score sheets are historical evidence.

## 9. Historical grounding

Every definition carries historical/legend/invented metadata plus note. Factual history, founding legend and gameplay invention remain separate. Follow LORE timeline/equipment/social terms; no magic/monsters by default or anachronistic arms/flags/food. Missing original build-spec file is a documentation gap, not permission to invent its contents.

## 10. Integrator and builder workflow

Integrators own core/main/shared registration/gazetteer, architecture/status, package/index and harness. Builders stay in assigned modules and request shared changes via `requests/<module>-<n>.md`, with rationale/proposed change. No builder commits/pushes, destructive worktree cleanup or new dependencies. Full instructions and reporting obligations are consolidated in AGENTS; obsolete builder/request snapshots were retired after preserving their useful findings there.
