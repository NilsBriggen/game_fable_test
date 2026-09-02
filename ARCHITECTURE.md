# ARCHITECTURE.md — *Eidgenossen* (working title)

Browser single-player RPG. Old Swiss Confederacy, 1291–1315 (Act 1), extensible to the 1500s.
Skyrim-style free-roam exploration + Baldur's-Gate-3-style turn-based party combat, grounded in real
Swiss history (see `LORE.md`). This document is owned by the **integrator**. Builder agents do not edit it;
they file change requests (see §10).

Assumptions the integrator made without asking are marked **[ASSUMPTION]**.

---

## 0. Stack and repository layout

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript 5, `strict: true`, ES2022 modules | Type-checked module boundaries are the cheapest enforcement of the ownership rules. |
| Assets | **[DECISION, owner-approved]** CC0 / CC-BY assets may be downloaded (ambientCG, Poly Haven, Quaternius, KayKit, OpenGameArt); every asset is listed with licence and author in `public/assets/CREDITS-*.md` and fetched reproducibly by `tools/assets/*`. | Visual quality target raised by the owner after the core modules passed. |
| Bundler / dev server | Vite 6 | Zero-config, fast HMR, `npm run dev` must always work (Rule: keep the build runnable). |
| Rendering | Three.js r170 (`MeshStandardMaterial` / `MeshPhysicalMaterial`, `WebGLRenderer`) | Spec mandates r160+. PBR, CSM-style cascaded shadow maps via three's `CSM` addon. |
| ECS | **Hand-rolled** in `src/core/ecs.ts` (~300 lines) | **[ASSUMPTION]** No third-party ECS. We need deterministic serialization of every component to a save file, and a plain `Map<ComponentType, Map<EntityId, Component>>` store is trivially serializable, debuggable in devtools, and has no build-time codegen. bitecs / miniplex would force typed-array or class-instance layouts that fight the save schema. Performance is not the bottleneck: entity counts are ≤ ~5 000 live. |
| UI | DOM overlay (HTML/CSS, vanilla TS) on top of the canvas | Text-heavy RPG UI (dialogue, journal, inventory) is far cheaper and more accessible in DOM than in-canvas. |
| Persistence | IndexedDB (`idb`-free, raw API wrapped in `src/save/db.ts`), localStorage fallback | Spec: no backend. |
| Tests | Vitest for pure logic (combat rules, ECS, save migration); Playwright harness for rendered scenes | Combat rules must be unit-testable without a GPU. |
| Headless verification | Playwright + Chromium (`/opt/pw-browsers`), `tools/harness/` | §8. |

```
/ARCHITECTURE.md      this file (integrator-owned)
/LORE.md              historical grounding, factions, regions, quest spine
/STATUS.json          per-module scores, open issues, wave status (integrator-owned)
/index.html           single page; canvas + #ui root
/src/main.ts          bootstrap; game-state machine; harness hooks
/src/core/            INTEGRATOR ONLY. ECS, event bus, RNG, clock, shared types, schemas, service registry
/src/world/           terrain, lake, sky/day-night, vegetation, chunk streaming, world queries
/src/exploration/     player controller, camera, NPC placement/schedules, POIs, interaction, encounter triggers
/src/combat/          turn-based engine: grid, initiative, action economy, abilities, formation, morale, AI
/src/party/           characters, skills (use-based), perks, equipment, inventory, derived stats
/src/quest/           quest state machine, dialogue runner, faction reputation, journal
/src/save/            IndexedDB persistence, schema versioning, migrations
/src/ui/              HUD, menus, dialogue UI, combat UI, journal, map, settings
/src/content/         DATA ONLY: regions, POIs, NPCs, items, abilities, quests, dialogues, encounters
/tools/harness/       Playwright screenshot+metrics harness (§8)
/tools/critic/        critic rubric + score sheets per wave
/public/assets/       textures, models, audio (generated or CC0; provenance in public/assets/CREDITS.md)
```

**Module import rule (enforced by convention + `tools/check-imports.mjs` in CI/harness):**
any module may import from `src/core`. No module imports another feature module's internals; cross-module
calls go through the **service interfaces** registered in `core/services.ts` (§4). `src/content` is data only
and may be imported by anyone. `src/main.ts` is the only place that imports every module to wire them.

---

## 1. Units, coordinates, conventions

| Item | Convention |
|---|---|
| World unit | **1 unit = 1 metre.** |
| Axes | Three.js default: **+Y up**. **+X = east, +Z = south** (so a top-down map image with (0,0) top-left maps to world (x, z) directly). North is −Z. |
| Origin | World (0, 0, 0) at lake level in the middle of the Urnersee, just off the Rütli. Lake surface is **y = 0**. Real Lake Lucerne is 434 m a.s.l.; UI shows `y + 434` when displaying altitude. |
| Map extent | **16 000 × 17 000 m** (x ∈ [−8000, 8000], z ∈ [−6500, 10500]). The shared projection and every named place's coordinates live in `src/content/gazetteer.ts` (integrator-owned). |
| Geographic scale | **[ASSUMPTION]** The real three-canton region (~60 km E–W × 45 km N–S, Gotthard included) is compressed **1 : 4.5 horizontally** and **1 : 3 vertically**. Pilatus (real 2 128 m, +1 694 above lake) renders at ~565 m above lake. Relative geography (which valley leads where, what is visible from where) is preserved; absolute distances are not. Traversal of the full map on foot ≈ 35–40 min at run speed, comparable to Skyrim. |
| Time | Game clock in **seconds of game time**; 1 real second = 20 game seconds by default (a day ≈ 72 real minutes). Calendar is Julian, starting **1 August 1291**. Story time-skips set the clock explicitly. |
| Angles | Radians internally; degrees only in UI. |
| Player speeds | walk 1.8 m/s, jog 4.0 m/s (default), sprint 6.5 m/s. |
| Combat grid | Square cells, **1.5 m** pitch, laid on the terrain heightfield at encounter start. 8-way movement; orthogonal step costs 1.5 m, diagonal 2.1 m (≈1.5·√2, rounded). Cell elevation = terrain height at cell centre. |
| Dice | `dN` = uniform 1..N from the seeded RNG. The **d20** is the resolution die; damage uses weapon dice. |
| RNG | Seeded xoshiro128** in `core/rng.ts`. Separate streams: `world` (generation, deterministic per save seed), `combat` (rolled per encounter, saved so reload cannot re-roll), `ambient` (never saved). |
| IDs | Entities: `number` (monotonic per save, never reused). Content IDs: `string` slugs, `kebab-case`, namespaced by type (`npc.werner-stauffacher`, `poi.ruetli`, `item.halbarte`, `quest.der-eid`). |
| Text | UI strings live in `src/content/strings.ts` keyed by ID; German place/person names keep their spelling (ä ö ü ss). English UI, German proper nouns. |

---

## 2. Hard budgets

| Budget | Value | Measured by |
|---|---|---|
| Frame time (exploration, 1080p, RTX 3060 / M2 class) | **≤ 16.6 ms p95**, no unscripted hitch > 16 ms outside loading screens | Harness `frame.p95`, `frame.max`, `hitches` |
| Draw calls per frame | **≤ 2 000** (`renderer.info.render.calls`) | Harness `drawCalls` |
| Triangles per frame | ≤ 3 M (soft) | Harness `triangles` |
| Shadow | 1 directional light, 3 CSM cascades, 2048² each, max 1 shadow pass | Code review + harness `lights` |
| Textures | ≤ 512 MB GPU, all ≤ 2048², KTX2/Basis or PNG | Harness `textures`, `geometries` |
| JS heap | ≤ 512 MB | Harness `heapMB` |
| Initial load to interactive | ≤ 15 s on a 50 Mbit link (bundle ≤ 8 MB gz excluding streamed assets) | `vite build` size report |
| Chunk streaming cost | ≤ 6 ms of main-thread work per frame (terrain builds on a Worker) | Harness hitch counter while camera flies |
| Save file | ≤ **2 MB** per slot (JSON, then compressed via `CompressionStream` if available), 5 slots + autosave | Save module unit test |
| Combat resolution | AI turn decides in ≤ 200 ms; all combat rules pure functions, unit-tested | Vitest |
| Live entities | ≤ 5 000 simulated; NPCs beyond 300 m from the player are frozen (schedule advanced on re-entry) | Exploration module |

Harness caveat: in the cloud container Chromium renders through SwiftShader (software). Frame times there are
an **upper bound**, not the real target; the harness reports the `WEBGL_debug_renderer_info` string so no one
can mistake one for the other. Draw calls, triangle counts, console errors and screenshots are hardware-independent
and are the primary evidence.

---

## 3. Core data model (`src/core`)

### 3.1 ECS

```ts
type EntityId = number;

interface Component {}                       // every component is a plain JSON-serialisable object

class World {
  create(tag?: string): EntityId;
  destroy(id: EntityId): void;
  add<T extends Component>(id: EntityId, type: ComponentType<T>, data: T): T;
  get<T>(id: EntityId, type: ComponentType<T>): T | undefined;
  has(id, type): boolean;
  remove(id, type): void;
  query(...types: ComponentType[]): EntityId[];       // cached per type-set, invalidated on add/remove
  serialize(): SerializedWorld;                       // {nextId, entities:[{id, tag, components:{TypeName: data}}]}
  static deserialize(s: SerializedWorld, registry: ComponentRegistry): World;
}

interface System { readonly name: string; order: number; update(dt: number, world: World, ctx: GameContext): void; }
class Scheduler { add(system: System): void; run(phase: 'explore' | 'combat' | 'always', dt): void; }
```

* Components are declared with `defineComponent<T>('Name', defaults, { transient?: boolean })`.
  `transient` components (e.g. `Mesh`, `Animation`) are never serialised; a module re-creates them on load
  from persistent components (e.g. `Renderable { modelId }`).
* Every persistent component has a `version` in its registry entry; `save/migrations.ts` upgrades old data.

### 3.2 Shared component catalogue (core-owned schemas; modules own the *systems* that use them)

| Component | Fields | Owner system |
|---|---|---|
| `Transform` | `x,y,z, yaw` (pitch/roll unused for characters) | exploration / combat |
| `Renderable` | `modelId: string, variant?: string, scale?: number` | world (instancing) |
| `Name` | `id: string (content id), display: string` | – |
| `Character` | `attributes: {strength, agility, endurance, wits, presence}` (1–20), `hp, hpMax, morale, moraleMax, fatigue` | party |
| `Skills` | `Record<SkillId, {level: 0–100, xp: number}>` | party |
| `Perks` | `PerkId[]` | party |
| `Equipment` | `{mainHand?, offHand?, head?, body?, feet?, ranged?, ammo?}: ItemInstanceId` | party |
| `Inventory` | `items: ItemInstance[]`, `pfennig: number`, `capacityKg` | party |
| `PartyMember` | `slot: number, control: 'player' \| 'companion' \| 'ally'` | party |
| `Faction` | `factionId: FactionId` | quest |
| `NpcSchedule` | `entries: {hour: number, poiId: string, activity: string}[]` | exploration |
| `Interactable` | `kind: 'talk' \| 'loot' \| 'read' \| 'use' \| 'travel', dialogueId?, containerId?, prompt` | exploration |
| `Poi` | `poiId, radius, discovered: boolean, kind: PoiKind` | exploration |
| `EncounterTrigger` | `encounterId, radius, once: boolean, fired: boolean, condition?: QuestCondition` | exploration → combat |
| `Combatant` | `side: 'player' \| 'enemy' \| 'neutral', initiative, cell: {q,r}, ap: {action, bonus, reaction, moveM}, status: StatusEffect[], stance, formationId?` (transient, exists only during an encounter) | combat |
| `Dead` | `at: gameTime` | – |

### 3.3 Content schemas (in `core/schemas.ts`, data in `src/content`)

* `RegionDef { id, name, canton: 'uri'|'schwyz'|'unterwalden'|'habsburg'|'einsiedeln'|'luzern'|..., bounds: Polygon(xz), music?, historical: true|'invented', note }`
* `PoiDef { id, name, region, x, z, kind: 'village'|'town'|'castle'|'church'|'monastery'|'alp'|'pass'|'bridge'|'meadow'|'landmark'|'camp'|'ruin', discoverRadius, fastTravel: boolean, models: PlacedModel[], npcs: string[], historical, note }`
* `NpcDef { id, name, faction, region, home: poiId, schedule, portrait?, dialogueRoot: dialogueId, attributes, skills, equipment, historical: true|'legend'|'invented', note }`
* `ItemDef { id, name, kind: 'weapon'|'armor'|'shield'|'ammo'|'consumable'|'tool'|'misc', weightKg, value, weapon?: WeaponDef, armor?: ArmorDef, historical, note }`
* `WeaponDef { skill: SkillId, hands: 1|2, reach: 1|2|3 (cells), damage: DiceExpr, damageType: 'cut'|'thrust'|'blunt', properties: ('brace'|'reach'|'hook'|'reload-1'|'reload-2'|'thrown'|'finesse'|'heavy')[], range?: {short, long} (cells) }`
* `AbilityDef { id, name, cost: {action?|bonus?|reaction?|moveM?}, requires: {skill?, level?, perk?, weaponProperty?, formation?}, target: 'self'|'ally'|'enemy'|'cell'|'line'|'cone', range, effect: EffectScript, description }` — `EffectScript` is a small data DSL (§5.4), **no free-form code in content**.
* `EncounterDef { id, location: {x,z, radiusM}, gridSize, sides, units: PlacedUnit[], objectives: Objective[], terrainFeatures: TerrainFeature[], scripted: ScriptedEvent[], historical, note }`
* `QuestDef { id, title, stages: QuestStage[], onStart/onComplete: QuestEffect[], journal: Record<stageId, string>, historical, note }`
* `DialogueDef { id, nodes: Record<nodeId, {speaker, text, choices: {text, condition?, effects?, next?}[], next?}> }`
* `FactionDef { id, name, kind: 'canton'|'house'|'town'|'abbey'|'band', hostileTo: FactionId[], repThresholds }`

Every content def carries `historical: true | 'legend' | 'invented'` plus `note`; `tools/check-content.mjs`
fails if any def lacks it (Rule: never blur the historical/invented line).

### 3.4 Save-file schema (`core/schemas.ts → SaveFile`, persisted by `src/save`)

```ts
interface SaveFile {
  schemaVersion: number;          // bump on any breaking change; migrations in save/migrations.ts
  slot: number;                   // 0 = autosave, 1..5 manual, 6 = quicksave
  createdAt: string; updatedAt: string;   // ISO real-time
  seed: number;                   // world RNG seed
  gameTime: number;               // seconds since 1 Aug 1291 00:00
  chapter: string;                // 'prologue-1291' | 'ch1-1307' | 'ch2-1314' ...
  world: SerializedWorld;         // all non-transient components
  playerId: EntityId;
  party: EntityId[];
  quests: Record<QuestId, {stage: string, vars: Record<string, number|string|boolean>, done: boolean}>;
  reputation: Record<FactionId, number>;      // −100..100
  discovered: string[];           // poiIds
  flags: Record<string, boolean|number|string>; // global story flags
  combat?: SerializedCombat;      // present only if saved mid-encounter (autosave at encounter start)
  rngState: {world: number[], combat?: number[]};
  playtimeSec: number;
  thumbnailDataUrl?: string;      // 160×90 JPEG ≤ 12 KB
}
```

---

## 4. Module public interfaces (`src/core/services.ts`)

Modules register an implementation of their interface at boot; consumers call `services.get('world')` etc.
Interfaces are the *only* legal cross-module surface. Anything not listed here is private.

```ts
interface WorldService {
  heightAt(x: number, z: number): number;                 // terrain height (metres), lake = 0 in water
  normalAt(x, z): Vector3;
  surfaceAt(x, z): 'grass'|'rock'|'snow'|'forest'|'scree'|'water'|'mud'|'road'|'settlement';
  isWater(x, z): boolean;
  raycast(origin: Vector3, dir: Vector3, maxDist: number): {point, normal, entity?} | null;
  regionAt(x, z): RegionDef | null;
  setTimeOfDay(hour0to24: number): void;  getTimeOfDay(): number;
  setWeather(w: 'clear'|'overcast'|'rain'|'snow'|'fog'): void;
  streamAround(x, z, radiusM): Promise<void>;             // ensure chunks loaded (used by loads/teleports)
  placeInstances(modelId: string, transforms: Transform[]): InstanceHandle;   // vegetation / props
  getSceneRoots(): {terrain: Object3D, props: Object3D, water: Object3D};
  getRenderer(): WebGLRenderer;  getScene(): Scene;  getCamera(): PerspectiveCamera;
}

interface ExplorationService {
  spawnPlayer(atPoi: string | {x,z}, facingYaw?): EntityId;
  teleport(entity: EntityId, x, z): void;
  setControlEnabled(on: boolean): void;                   // false during dialogue/combat/cutscene
  getCameraRig(): CameraRig;                              // for combat/cutscene camera handoff
  discover(poiId): void;   isDiscovered(poiId): boolean;   fastTravel(poiId): Promise<void>;
  nearestInteractable(): {entity, def} | null;
  on(event: 'interact'|'poi-discovered'|'encounter-trigger'|'region-entered', cb): Unsubscribe;
}

interface CombatService {
  start(encounterId: string, opts?: {ambush?: 'player'|'enemy'}): Promise<CombatResult>;   // resolves when encounter ends
  // Pure rule functions (also exported directly for tests/UI):
  rules: {
    rollAttack(attacker: CombatantView, target: CombatantView, ctx: AttackContext, rng): AttackRoll;
    validMoves(unit, grid): PathMap;   reachable(unit, grid): Set<CellKey>;
    abilityTargets(unit, ability, grid): Cell[];
    formationBonus(unit, grid): FormationStatus;   // Gewalthaufen evaluation, §5.5
    moraleCheck(unit, reason, rng): MoraleResult;
  };
  getState(): CombatStateView | null;                     // read-only projection for UI
  submit(cmd: CombatCommand): CommandResult;              // UI → engine
  on(event: CombatEvent, cb): Unsubscribe;                // 'turn-start'|'action'|'damage'|'move'|'morale'|'end'...
  serialize(): SerializedCombat;  restore(s): void;
}

interface PartyService {
  createCharacter(def: NpcDef | PlayerCreation): EntityId;
  getParty(): EntityId[];   addMember(id, control): void;   removeMember(id): void;
  derived(id: EntityId): DerivedStats;                    // defense, initiative bonus, speedM, carry, damage mods
  grantSkillXp(id, skill: SkillId, amount): {leveled: boolean, newLevel?: number};   // use-based progression
  equip(id, item: ItemInstanceId, slot): boolean;   unequip(id, slot): void;
  addItem(id, itemDefId, qty?): ItemInstanceId;   removeItem(id, instanceId, qty?): void;
  rest(id | 'party', hours: number): void;                // heals hp/fatigue per rules, advances clock via GameContext
  on(event: 'level-up'|'item-added'|'equipped'|'hp-changed', cb): Unsubscribe;
}

interface QuestService {
  start(questId): void;   advance(questId, stageId): void;   complete(questId): void;   fail(questId): void;
  stage(questId): string | null;   isDone(questId): boolean;   setVar(questId, k, v): void;   getVar(questId, k): unknown;
  setFlag(k, v): void;   getFlag(k): unknown;
  reputation(faction: FactionId): number;   changeReputation(faction, delta, reason): void;
  evaluate(cond: QuestCondition): boolean;                // shared condition DSL used by dialogue, POIs, triggers
  runDialogue(dialogueId, speakerEntity?): Promise<DialogueOutcome>;   // drives UI via UiService
  journal(): JournalEntry[];
  on(event: 'quest-started'|'quest-advanced'|'quest-completed'|'reputation-changed'|'flag-changed', cb): Unsubscribe;
}

interface SaveService {
  save(slot: number, label?: string): Promise<SaveMeta>;  load(slot): Promise<void>;   list(): Promise<SaveMeta[]>;
  delete(slot): Promise<void>;   autosave(): Promise<void>;
  exportJson(slot): Promise<string>;   importJson(json): Promise<SaveMeta>;
}

interface UiService {
  showHud(on: boolean): void;   toast(msg: string, kind?: 'info'|'quest'|'skill'|'warning'): void;
  openMenu(menu: 'pause'|'inventory'|'character'|'journal'|'map'|'save'|'load'|'settings'|'title'): void;  closeMenu(): void;
  dialogue: { show(node: DialogueNodeView): Promise<number /*choice index*/>; hide(): void; };
  combat: { show(state: CombatStateView): void; update(state): void; hide(): void; onCommand(cb: (cmd: CombatCommand) => void): void; };
  cutscene: { letterbox(on: boolean): void; caption(text: string, seconds: number): Promise<void>; fade(to: 'black'|'clear', ms): Promise<void>; };
  prompt(text: string): void;                             // "[E] Talk to Werner Stauffacher"
}
```

`GameContext` (core) is passed to every system and holds `{ world: World, services, clock: GameClock, events: EventBus, rng, state: GameStateMachine }`.

**Game state machine** (`core/state.ts`): `boot → title → creation → explore ⇄ dialogue`, `explore → combat → (explore | gameover)`, `explore → cutscene → explore`, any → `paused`. Only `main.ts` transitions states; modules *request* transitions via `events.emit('request-state', …)`.

---

## 5. Module designs

### 5.1 World (`src/world`) — Skyrim reference: readable landmarks, visible destinations

* **Terrain source.** A hand-authored feature map in `content/geography.ts`: the lake polygon (all five
  arms of the Vierwaldstättersee: Luzerner Becken, Küssnachtersee, Alpnachersee, Gersauer/Buochser Becken,
  Urnersee), the Zugersee/Ägerisee/Lauerzersee, valley splines (Reuss/Urner Reusstal up to the Gotthard,
  Muotatal, Schächental, Engelbergertal, Sarneraatal, Ägerital, Sihl toward Einsiedeln), ridge/peak points with
  heights (Pilatus, Rigi, Bürgenstock, Fronalpstock, Urirotstock, Mythen, Rossberg, Stanserhorn, Uri Alps toward
  the Gotthard), and the Gotthard pass corridor including the Schöllenen gorge. `world/heightmap.ts` rasterises
  these on a Worker into a **2048 × 2048 float heightmap (7.8 m/texel)** using signed-distance blending +
  multi-octave noise for detail, deterministic from the save seed's `world` stream. Generation ≤ 3 s; cached in
  IndexedDB by `(seed, geographyVersion)`.
* **Mesh.** 32 × 32 chunks of 500 m; 4 LOD levels (2, 4, 8, 16 m vertex spacing) with skirts; chunk LOD chosen by
  distance; nearest 3×3 at LOD0. Geometry built on the Worker, uploaded on the main thread capped at 2 chunks/frame.
  Budget: ≈ 200 terrain draw calls.
* **Materials.** One `MeshStandardMaterial` with a splat shader chunk (`onBeforeCompile`) blending grass / rock /
  scree / snow / forest floor by height, slope and a hand-painted `surface` mask; triplanar on steep faces.
  Snow line at +900 m world (winter chapters lower it).
* **Water.** Single lake plane per basin (`MeshPhysicalMaterial`, transmission off, normal-map animation,
  planar reflection *off* by default, SSR none) — ≤ 6 draw calls.
* **Vegetation & props.** `InstancedMesh` per model per chunk (spruce, fir, larch, beech, boulder, fence, hay
  rack, cross). Placed procedurally by surface type + hand-authored exclusion zones (settlements, roads) with LOD
  impostors (billboard) beyond 250 m. Budget: ≤ 600 draw calls.
* **Sky / day-night.** `Sky` addon (Preetham) + one `DirectionalLight` sun/moon driven by `clock`; three CSM
  cascades (0–40 / 40–160 / 160–600 m); hemisphere ambient; height fog. Stars at night via a point sprite sheet.
* **Roads and paths.** Authored splines (`content/geography.ts`), stamped into the surface mask and lightly
  flattened in the heightmap: Gotthard mule track, lake-shore paths, Sattel–Ägeri road (Morgarten!).
* **Settlements** are placed by exploration (POIs) but their models are streamed by world: a shared prop library
  (`public/assets/models/*.glb`): Alemannic log-frame house (Blockbau), stone church w/ tower, chapel, barn,
  castle keep + curtain wall, mill, bridge, stone letzi wall, wooden palisade, boat.
* **Exposes:** `WorldService`. Emits `chunk-loaded`, `time-changed`.

### 5.2 Exploration (`src/exploration`) — Skyrim reference: POI density, discovery, NPC life

* **Player controller.** Third-person, capsule vs. heightfield + prop colliders (simple AABB/sphere list per chunk);
  slopes > 40° are unwalkable (mountains are barriers, passes matter). Swim in lakes (slow, fatigue drain).
  Boats at Flüelen/Brunnen/Gersau/Luzern as `travel` interactables.
* **Camera.** Orbit follow, collision-adjusted; default distance 6 m (the harness' "default exploration camera").
* **POIs.** ~**60** hand-authored POIs across the three cantons + Habsburg holdings (list in `LORE.md` §4),
  discovered by proximity → toast + map marker + fast travel. Kinds map to model kits.
* **NPCs.** ~**90** named NPCs with schedules (home / work / church / tavern by hour), ~150 unnamed
  (peasants, herders, monks, soldiers) generated per settlement. NPCs beyond 300 m are frozen; schedule
  position is computed analytically on re-entry.
* **Interaction.** Nearest `Interactable` within 2.5 m and 60° of facing → `UiService.prompt`. `E` triggers.
* **Encounter triggers.** `EncounterTrigger` components + faction hostility (Habsburg patrols attack the party
  if `reputation.habsburg < −40` or quest flags say so). Entering a trigger emits `encounter-trigger` → `main.ts`
  fades, calls `CombatService.start`, resumes after `CombatResult`.
* **Exposes:** `ExplorationService`.

### 5.3 Combat (`src/combat`) — BG3 reference, non-magical

**Encounter setup.** On `start`, the engine samples the terrain around the location into a grid
(default 24 × 24 cells = 36 × 36 m; Morgarten uses 40 × 24), computes per-cell `{height, surface, cover: 0|1|2,
passable, feature?}`, places units from `EncounterDef` (party from formation preset), rolls initiative.

**Initiative.** `d10 + agility mod + perks`, rolled once per combatant per encounter; ties broken by agility then by
`combat` RNG. Player-side units act on their own initiative (not grouped) — **[ASSUMPTION]** matches BG3 default.

**Action economy per turn.** `Action` (1), `Bonus action` (1), `Movement` (speedM: 9 m base = 6 cells; armour
reduces), `Reaction` (1, refreshes at the start of the unit's turn). Free: drop item, shout (morale, 1/turn).

**Resolution.** Attack: `d20 + skillMod + situational ≥ target Defense` where Defense = `10 + agility mod + armor +
shield + cover + stance`. **Edge / Burden** (advantage / disadvantage analogue): roll 2d20, take best / worst;
sources cancel out pairwise. Natural 20 = critical (double dice); natural 1 = fumble (drop to Burden next attack).
Sources of Edge: attacking from ≥ 2 m higher ground (ranged) or ≥ 1 m (melee); target flanked (two hostile units
on opposite sides); target prone; target `Shaken`; unseen attacker (ambush round). Sources of Burden: attacker
prone; ranged at long range; ranged with adjacent enemy; `Exhausted`; attacking a braced pike wall in melee from
the front.

**Damage** = weapon dice + strength mod (melee) − armour soak by type (mail soaks cuts well, thrusts poorly;
coat-of-plates soaks thrusts; blunt bypasses half). HP represent fighting capacity; at 0 a unit is **Down**
(bleeding out, 3 turns to stabilise via `Bandage` bonus action) — companions can die permanently if the party
loses or leaves them.

**Movement & terrain.** Difficult terrain (mud, scree, deep snow, water < 1 m) doubles cost; slope > 30° between
cells costs +1 cell; slope > 45° impassable. Verticality: ledges ≥ 3 m drop → `Fall` damage `1d6 / 3 m` and Prone.
`Shove` (bonus action, contested strength/agility) pushes 1 cell — off a ledge, into water (heavy armour →
`Drowning` status), into a comrade (both Prone on failure).

**Reactions.** `Opportunity attack` on leaving reach without Disengage; `Brace` (pike/spear with `brace`
property: if a mounted or charging unit enters reach, free attack with Edge, double dice vs. mounted);
`Shield block` (reduce damage 1d6, needs shield); `Cover fire` (loaded crossbow: attack a unit that ends movement
in range).

**Ranged.** Crossbow: `reload-1` (light, bonus action) or `reload-2` (windlass/heavy, full action) — the loaded
state is a status; `Aimed shot` (action + no movement: Edge). Sling/rocks (`thrown`): rocks from above at
Morgarten are an **environment interaction** (`TerrainFeature: 'boulder-cache'` cell → action `Roll boulders`,
hits a 3-cell line below, `2d10` blunt, Prone, morale check).

**Morale** (no spells → morale is the second resource). `morale` 0–100; damage taken, ally Down/killed within 3
cells, being flanked, cavalry charge, leader Down → `moraleCheck` (`d20 + presence mod + formation bonus vs. DC`).
Fail → `Shaken` (Burden on attacks, may not advance), fail badly → `Routed` (flees toward own edge, drops
formation). `Rally` (action, presence-based, cone 3 cells): remove Shaken. Enemy routs are how most historical
fights ended — encounters can end by **enemy rout** without a kill-all.

**Stances** (bonus action to switch): `Aggressive` (+2 hit, −2 Defense), `Guarded` (opposite), `Braced`
(pike/spear only, no movement, brace reaction always ready).

**Formation — Gewalthaufen** (§5.5) is a *mechanic*: a unit with a `reach` polearm gains **+1 Defense per adjacent
allied polearm unit (max +3)** and its `Brace` covers adjacent allies; a **Haufen** of ≥ 4 mutually adjacent polearm
units in a convex block gains the `Haufen` status: immune to flanking, Edge on morale checks, and cavalry that
charges it takes the brace reaction from *every* facing unit. Breaking adjacency (moving out) drops it — the
tactical tension is "hold the square or chase". Enemy knights get `Charge` (move ≥ 3 cells in a line into an
attack: +1d8 damage, target morale check) — the Haufen is the counter.

**AI.** Utility scoring over `{attack, move-to-attack, brace, reload, rally, flee}` with faction doctrine
(`knight`: charge isolated targets, avoid Haufen fronts; `footman`: flank; `crossbowman`: high ground, keep
range; `waldstätte`: form Haufen, use terrain features). Decision ≤ 200 ms, deterministic given RNG.

**Objectives.** `defeat-all`, `rout`, `hold-cells(N turns)`, `reach-cell`, `protect(entity)`, `survive(N turns)`.
Morgarten = `hold the Letzi line 3 turns` → scripted rockfall event → `rout`.

**Exposes:** `CombatService`. All rules are pure functions in `combat/rules/*.ts` with Vitest coverage.

### 5.4 Effect / condition DSL (core-owned, used by combat, quest, dialogue)

```ts
type QuestCondition =
  | {all: QuestCondition[]} | {any: QuestCondition[]} | {not: QuestCondition}
  | {flag: string, eq?: unknown} | {questStage: [QuestId, string]} | {questDone: QuestId}
  | {rep: [FactionId, '>=' | '<', number]} | {skill: [SkillId, '>=', number]} | {hasItem: [ItemId, number?]}
  | {chapter: string} | {timeOfDay: [number, number]} | {var: [QuestId, string, unknown]};
type Effect =
  | {setFlag: [string, unknown]} | {quest: ['start'|'advance'|'complete'|'fail', QuestId, string?]}
  | {rep: [FactionId, number]} | {giveItem: [ItemId, number]} | {takeItem: [ItemId, number]} | {pfennig: number}
  | {skillXp: [SkillId, number]} | {encounter: EncounterId} | {teleport: PoiId} | {addCompanion: NpcId} | {removeCompanion: NpcId}
  | {cutscene: CutsceneId} | {advanceTime: number /*hours*/} | {setChapter: string} | {toast: string};
type CombatEffect =  // used by AbilityDef
  | {damage: {dice: DiceExpr, type: DamageType, bonus?: 'strength'|'agility'}} | {status: {id: StatusId, turns: number}}
  | {push: {cells: number}} | {moraleCheck: {dc: number}} | {heal: DiceExpr} | {reload: 1|2} | {rally: {radius: number}}
  | {line: {cells: number, effect: CombatEffect}} | {cone: {cells: number, effect: CombatEffect}};
```

### 5.5 Party & progression (`src/party`) — Skyrim reference: learn by doing

* **Attributes** (1–20, fixed at creation + rare perk boosts): Strength, Agility, Endurance, Wits, Presence. Modifier = `floor((attr − 10) / 2)`.
* **Skills** (0–100, use-based): `halberd`, `spear` (spear & pike), `sword` (longsword/arming sword/messer),
  `dagger`, `axe-mace` (axes, Morgenstern), `shield`, `crossbow`, `throwing`, `unarmed`, `armor-light`, `armor-heavy`,
  `athletics` (movement, climbing, swimming), `leadership` (morale, rally, formation), `stealth`, `speech`,
  `herbalism` (bandage/rest healing), `craft` (repair, fletching), `trade` (prices), `alpine` (weather, terrain reading, pathfinding on slopes).
  XP per use: hit = 5 + weapon tier, kill = 15, block = 4, successful speech check = 20, etc. Level-up cost grows
  `~ level^1.6`. Perks at 25/50/75/100 per skill (e.g. `halberd 25: Hook` — pull target 1 cell; `spear 50: Wall of Iron` — brace covers 2 cells; `leadership 50: Eidgenoss` — Rally as bonus action; `crossbow 75: Windlass Drill` — heavy reload as bonus).
* **Character level** = `floor(sum(skill levels) / 40)`; each level: +hpMax by endurance, +1 attribute every 3 levels.
* **Equipment** with weight, armour soak per damage type, skill requirement, encumbrance → speed & fatigue.
* **Party** up to 4 (player + 3), companions are full ECS characters with their own skills and gear; formation preset (`line`, `wedge`, `haufen`, `skirmish`) chosen in the party screen and used as combat deployment.
* **Exposes:** `PartyService`.

### 5.6 Quest & dialogue (`src/quest`)

* Quests are stage machines with named stages, `QuestCondition` guards, `Effect` lists; journal text per stage.
* Dialogue: node graph with `speaker`, `text`, choices guarded by conditions (skill checks are `{skill: ['speech','>=',30]}`
  or a rolled `speechCheck` node: `d20 + speech/10 + presence mod vs DC`). Dialogue runs in `dialogue` state; camera
  frames the speaker. Effects execute on choice.
* **Reputation** per faction −100..100 with named bands (`Outlaw < −60 < Suspect < −20 < Unknown < 20 < Trusted < 60 < Eidgenoss`).
  Habsburg patrol hostility, shop prices, and quest gating read from it.
* **Exposes:** `QuestService`.

### 5.7 Save (`src/save`)

IndexedDB database `eidgenossen`, store `saves` keyed by slot; `SaveFile` (§3.4). Serialise → JSON → `CompressionStream('gzip')` when available
(else raw). **Load convention:** modules tear down transient scene objects on `state-changed → loading` and rebuild them on the `loaded` event (emitted after the world is populated). Migrations are an ordered list `[{from, to, migrate(save) }]`. Autosave on: new chapter, quest complete,
encounter start (with `combat` block), fast travel, every 10 min of play. Load performs `world.streamAround` before
fade-in. Unit tests round-trip a synthetic full-size world and assert ≤ 2 MB.

### 5.8 UI (`src/ui`)

DOM overlay in `#ui`; one root controller with panels: HUD (compass with POI markers, health/morale/fatigue bars,
time, interaction prompt, quest tracker), dialogue (portrait, text, choices with skill-check odds shown BG3-style),
combat (initiative tracker bar, action/bonus/reaction/movement pips, ability bar, hit-chance % on hover, Edge/Burden
icons, cell highlighting handled by combat's renderer but *driven* by UI hover), inventory/character (skills with
progress bars, perks), journal, map (top-down rendered heightmap with markers, fast travel), save/load, settings
(quality preset, shadow resolution, render scale). Aesthetic: parchment/ink, Fraktur-free (readability first), historical iconography.

### 5.9 Content (`src/content`)

Pure data honouring `LORE.md`. Every def has `historical` + `note`. `tools/check-content.mjs` validates against
`core/schemas.ts` and cross-references IDs. Main-quest content for Act 1 (Rütlischwur → Morgarten) is a Wave-3 deliverable.

---

## 6. Frame loop and threading

```
requestAnimationFrame
 ├─ input.poll()
 ├─ clock.tick(dt)                       (game time, pauses in menus/dialogue/combat planning)
 ├─ scheduler.run('always')             (world streaming, sky, audio)
 ├─ scheduler.run(state === 'combat' ? 'combat' : 'explore')
 ├─ ui.update()                          (DOM writes batched)
 └─ renderer.render()                    (single pass + CSM shadow pass)
Worker: terrain heightmap rasterisation, chunk geometry, pathfinding for NPC schedules (batched).
```

---

## 7. Game bootstrap and harness hooks (`src/main.ts`)

`main.ts` builds `GameContext`, registers services, and exposes **`window.__harness`** (only when `?harness=1`):

```ts
interface HarnessApi {
  ready: Promise<void>;
  loadScenario(id: string): Promise<void>;      // from tools/harness/scenarios.json (camera, time, weather, state, encounter)
  setCamera(pos: [x,y,z], lookAt: [x,y,z]): void;
  setTime(hour: number): void;   setWeather(w): void;
  stats(): { drawCalls, triangles, geometries, textures, programs, heapMB, renderer: string, frameMs: number[] /* last 120 */ , entities, chunksLoaded };
  screenshotReady(): Promise<void>;             // resolves after streaming settles + 30 stable frames
  console: {errors: string[], warnings: string[]};
  runCombatScript(cmds: CombatCommand[]): Promise<CombatStateView>;   // deterministic replay for combat scenarios
  state(): string;                               // game state machine
}
```

---

## 8. Verification harness (`tools/harness`)

`node tools/harness/run.mjs [--preview] [--scenario id] [--out dir]`

1. Starts `vite` (dev) or `vite preview` (built) on a fixed port; waits for HTTP 200.
2. Launches Playwright Chromium 1920×1080 (`--use-angle=swiftshader` in the container; real GPU locally),
   opens `/?harness=1`, awaits `window.__harness.ready`.
3. For each scenario in `tools/harness/scenarios.json`: `loadScenario`, `screenshotReady`, sample 120 frames
   (frame times from `performance.now` deltas around `renderer.render` measured *inside* the page), read `stats()`,
   capture `tools/harness/out/<scenario>.png`, collect console errors/warnings and page errors.
4. Writes `tools/harness/out/report.json` and `report.md` with per-scenario: draw calls, triangles, frame p50/p95/max,
   hitch count (> 16 ms), heap, GPU string, error/warning lists, pass/fail against §2 budgets.
5. Exit code 1 if any scenario has a console error or a page error, or exceeds draw-call/triangle budgets.

Scenarios (initial set; content waves add more): `title`, `ruetli-dawn`, `altdorf-square-noon`,
`urnersee-from-seelisberg`, `gotthard-schoellenen`, `schwyz-village-dusk`, `sarnen-night-rain`, `flyover-streaming`
(camera path, hitch detection), `combat-morgarten-setup`, `combat-morgarten-turn5` (scripted commands),
`dialogue-gessler-hat`, `menu-inventory`, `menu-map`.

The critic (§9) uses only this output.

---

## 9. Agents, waves, ownership

| Role | Tier | Touches |
|---|---|---|
| Integrator (this session) | Fable | `src/core`, `src/main.ts`, `ARCHITECTURE.md`, `STATUS.json`, `tools/harness`, wiring |
| Builder: world (geometry) | Sonnet | `src/world/{heightmodel,terrain,geodata,chunkmesh,terrain.worker}.ts`, `content/geography.ts` |
| Builder: world-look | Opus | `src/world/{terrainMaterial,textures,vegetation,treeGeometry,sky,water,shadowCsm,map}.ts`, `public/assets/textures`, `public/assets/vegetation` |
| Builder: assets & characters | Opus | `src/world/{models,propGeometry,assets,characters}.ts`, `public/assets/models`, `public/assets/characters`, `tools/assets` |
| Builder: save | Sonnet | `src/save` |
| Builder: exploration | Sonnet | `src/exploration`, `content/pois.ts`, `content/npcs.ts` |
| Builder: combat | Sonnet | `src/combat`, `content/abilities.ts`, `content/encounters.ts` |
| Builder: party | Sonnet | `src/party`, `content/items.ts`, `content/skills.ts` |
| Builder: quest | Sonnet | `src/quest`, `content/quests/*`, `content/dialogues/*`, `content/factions.ts` |
| Builder: ui | Sonnet | `src/ui`, `index.html` styles |
| Builder: main-quest content | Sonnet | `content/quests/act1/*`, `content/encounters/morgarten.ts`, cutscenes |
| Critic | Fable | `tools/critic/*.md` score sheets; reads harness output only; never edits `src` |

Waves: **1** core (integrator) + world + save → critic → **2** exploration + combat + party → critic →
**3** quest + ui + Act 1 content → critic → **final gate** (§10 of the task: full Act 1 harness playthrough + blind comparison).

Pass bar per module: harness-evidenced score ≥ 8/10, zero console errors, historical compliance (content modules).
Up to 3 fix rounds, then the issue is escalated into `STATUS.json.escalations` rather than downgraded.

---

## 10. Core change requests

Builders needing a change in `src/core` (new component, new schema field, new service method) write a file
`requests/<module>-<n>.md` with: what, why, proposed diff. The integrator applies (or rejects with reason) and
records the decision in `STATUS.json.coreChanges`. Builders may add *private* types inside their own module freely.
