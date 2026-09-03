/** Module public interfaces. ARCHITECTURE.md §4. Only these are legal cross-module surfaces. */
import type { Object3D, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
import type { EntityId } from './ecs';
import type { Unsubscribe } from './events';
import type { Rng } from './rng';
import type {
  Attributes, Canton, EncounterDef, FactionDef, ItemDef, ItemInstance, NpcDef, PoiDef, RegionDef, SaveMeta,
  SerializedCombat, Side,
} from './schemas';
import type { QuestCondition, Effect, FactionId, SkillId, StatusId } from './dsl';
import type { Stance, StatusEffect } from './components';

export type SurfaceType = 'grass' | 'rock' | 'snow' | 'forest' | 'scree' | 'water' | 'mud' | 'road' | 'settlement' | 'meadow';
export type Weather = 'clear' | 'overcast' | 'rain' | 'snow' | 'fog';

export interface TransformLike { x: number; y: number; z: number; yaw?: number; scale?: number }
export interface InstanceHandle { id: number; dispose(): void; setVisible(v: boolean): void }

export type CharacterAnim = 'idle' | 'walk' | 'run' | 'attack' | 'hit' | 'down' | 'dead' | 'brace' | 'shoot' | 'reload' | 'talk' | 'cheer' | 'flee';
export interface CharacterHandle {
  object: Object3D;
  /** crossfade to an animation; loop for idle/walk/run, one-shot otherwise (resolves when finished) */
  play(anim: CharacterAnim, opts?: { loop?: boolean; speed?: number; fade?: number }): Promise<void>;
  /** drive the walk cycle from actual velocity (m/s); 0 = idle */
  setSpeed(mps: number): void;
  update(dt: number): void;
  setVisible(v: boolean): void;
  /** true if a rigged asset is used (false = procedural fallback) */
  rigged: boolean;
  dispose(): void;
}

export interface WorldService {
  heightAt(x: number, z: number): number;
  normalAt(x: number, z: number): Vector3;
  surfaceAt(x: number, z: number): SurfaceType;
  isWater(x: number, z: number): boolean;
  /** game height of the lake surface nearest (x,z) within maxDist metres, else null */
  lakeLevelAt?(x: number, z: number, maxDist?: number): number | null;
  slopeAt(x: number, z: number): number; // radians
  raycast(origin: Vector3, dir: Vector3, maxDist: number): { point: Vector3; normal: Vector3; entity?: EntityId } | null;
  regionAt(x: number, z: number): RegionDef | null;
  setTimeOfDay(hour: number): void;
  getTimeOfDay(): number;
  setWeather(w: Weather): void;
  getWeather(): Weather;
  setSeason(season: 'winter' | 'spring' | 'summer' | 'autumn'): void;
  streamAround(x: number, z: number, radiusM?: number): Promise<void>;
  /** true when no chunk builds are pending for the current camera position */
  isSettled(): boolean;
  placeInstances(modelId: string, transforms: TransformLike[]): InstanceHandle;
  /** load (cached) a prop/character model as a fresh Object3D you own */
  spawnModel(modelId: string, opts?: { variant?: string; scale?: number }): Object3D;
  /**
   * Animated character from the asset library (rigged GLB when available, procedural fallback otherwise).
   * Callers own the returned object; call `update(dt)` each frame and `dispose()` when done.
   * Optional until the character-art pipeline lands; consumers fall back to `spawnModel('char.<archetype>')`.
   */
  spawnCharacter?(archetype: string, opts?: { variant?: string; mounted?: boolean; seed?: number }): CharacterHandle;
  /** other modules register their own procedural model factories (e.g. exploration registers 'char.*') */
  registerModel(modelId: string, factory: (opts: { variant?: string; scale?: number; rng: Rng }) => Object3D): void;
  hasModel(modelId: string): boolean;
  listModels(): string[];
  getSceneRoots(): { terrain: Object3D; props: Object3D; water: Object3D; dynamic: Object3D };
  getRenderer(): WebGLRenderer;
  getScene(): Scene;
  getCamera(): PerspectiveCamera;
  /** debug/harness: chunk counts */
  stats(): { chunksLoaded: number; chunksPending: number; instances: number };
  worldToMapUv(x: number, z: number): [number, number];
  /** 512×512 top-down map image (data url) for the UI map; cached */
  mapImage(): Promise<string>;
}

export interface CameraRig {
  camera: PerspectiveCamera;
  setMode(mode: 'follow' | 'free' | 'combat' | 'cutscene'): void;
  getMode(): string;
  setFree(pos: [number, number, number], lookAt: [number, number, number]): void;
  /** combat: orbit around a point */
  focus(x: number, y: number, z: number, opts?: { distance?: number; pitch?: number; yaw?: number; instant?: boolean }): void;
  update(dt: number): void;
}

export interface ExplorationEvents extends Record<string, unknown[]> {
  interact: [entity: EntityId];
  'poi-discovered': [poiId: string];
  'encounter-trigger': [encounterId: string, entity: EntityId, ambush?: 'player' | 'enemy'];
  'region-entered': [regionId: string];
  'player-moved': [x: number, y: number, z: number];
  'fast-travel': [poiId: string];
}

export interface ExplorationService {
  spawnPlayer(at: string | { x: number; z: number }, facingYaw?: number): EntityId;
  spawnNpc(def: NpcDef, at?: { x: number; z: number }): EntityId;
  populate(chapter: string): void;
  getPlayer(): EntityId | null;
  teleport(entity: EntityId, x: number, z: number, yaw?: number): void;
  setControlEnabled(on: boolean): void;
  getCameraRig(): CameraRig;
  discover(poiId: string): void;
  isDiscovered(poiId: string): boolean;
  discovered(): string[];
  setDiscovered(ids: string[]): void;
  fastTravel(poiId: string): Promise<void>;
  nearestInteractable(): { entity: EntityId; prompt: string } | null;
  interactWith(entity: EntityId): void;
  poiPosition(poiId: string): { x: number; z: number } | null;
  poiDef(poiId: string): PoiDef | undefined;
  nearestPoi(x: number, z: number): PoiDef | null;
  /** hide/show party members' world meshes (during combat) */
  setPartyVisible(v: boolean): void;
  on<K extends keyof ExplorationEvents & string>(event: K, cb: (...a: ExplorationEvents[K]) => void): Unsubscribe;
}

// ---------------- Combat ----------------

export interface CellKey { q: number; r: number }
export interface CellView extends CellKey {
  height: number;
  surface: SurfaceType;
  passable: boolean;
  cover: 0 | 1 | 2;
  difficult: boolean;
  feature?: string;
  featureIndex?: number;
  occupant?: EntityId;
}

export interface CombatantView {
  id: EntityId;
  name: string;
  side: Side;
  q: number;
  r: number;
  hp: number;
  hpMax: number;
  morale: number;
  moraleMax: number;
  initiative: number;
  ap: { action: boolean; bonus: boolean; reaction: boolean; moveM: number; moveMax: number };
  status: StatusEffect[];
  stance: Stance;
  loaded: boolean;
  mounted: boolean;
  down: boolean;
  routed: boolean;
  defense: number;
  weapon: { name: string; reach: number; ranged: boolean; damage: string } | null;
  abilities: string[]; // ability ids currently usable
  formation: FormationStatus;
  isPlayerControlled: boolean;
  modelId?: string;
  archetype: string;
  group?: string;
  attributes: Attributes;
}

export interface FormationStatus {
  adjacentPolearms: number;
  inHaufen: boolean;
  defenseBonus: number;
  haufenId?: number;
}

export interface AttackContext {
  edge: string[];
  burden: string[];
  ranged: boolean;
  distanceCells: number;
  heightDelta: number;
  flanked: boolean;
  charge: boolean;
}

export interface AttackRoll {
  d20: [number, number?];
  used: number;
  mode: 'normal' | 'edge' | 'burden';
  bonus: number;
  total: number;
  targetDefense: number;
  hit: boolean;
  critical: boolean;
  fumble: boolean;
  damage: number;
  damageRaw: number;
  soak: number;
  breakdown: string[];
}

export interface MoraleResult { roll: number; bonus: number; dc: number; passed: boolean; margin: number; outcome: 'steady' | 'shaken' | 'routed' }

export type CombatCommand =
  | { type: 'move'; unit: EntityId; to: CellKey }
  | { type: 'ability'; unit: EntityId; ability: string; target?: CellKey | EntityId }
  | { type: 'stance'; unit: EntityId; stance: Stance }
  | { type: 'end-turn'; unit: EntityId }
  | { type: 'reaction'; unit: EntityId; accept: boolean }
  | { type: 'deploy'; placements: { unit: EntityId; to: CellKey }[] }
  | { type: 'flee' }
  /** harness: let AI/auto-end play N rounds */
  | { type: 'auto'; rounds: number };

export interface CommandResult { ok: boolean; reason?: string; events?: CombatEventRecord[] }

export interface CombatEventRecord {
  kind: 'turn-start' | 'move' | 'attack' | 'ability' | 'damage' | 'down' | 'death' | 'morale' | 'status' | 'reaction' | 'feature' | 'round' | 'objective' | 'end' | 'deploy' | 'caption' | 'log';
  unit?: EntityId;
  target?: EntityId;
  cell?: CellKey;
  path?: CellKey[];
  roll?: AttackRoll;
  morale?: MoraleResult;
  text: string;
  data?: Record<string, unknown>;
}

export interface CombatStateView {
  encounterId: string;
  name: string;
  phase: 'deploy' | 'active' | 'reaction' | 'ended';
  round: number;
  order: EntityId[];
  activeUnit: EntityId | null;
  units: CombatantView[];
  grid: { cols: number; rows: number; cellM: number; origin: { x: number; z: number; yaw: number } };
  cells: CellView[];
  objectives: { text: string; done: boolean; progress?: string }[];
  log: CombatEventRecord[];
  pendingReaction?: { unit: EntityId; ability: string; trigger: string; target: EntityId };
  result?: CombatResult;
  deployZone: { q: number; r: number; cols: number; rows: number };
}

export interface CombatResult { outcome: 'win' | 'lose' | 'fled'; rounds: number; downed: EntityId[]; dead: EntityId[]; xp: Record<SkillId, number>; loot: ItemInstance[]; log: string[] }

export interface CombatEvents extends Record<string, unknown[]> {
  event: [rec: CombatEventRecord];
  state: [view: CombatStateView];
  end: [result: CombatResult];
}

export interface CombatService {
  start(encounterId: string, opts?: { ambush?: 'player' | 'enemy'; encounterOverride?: EncounterDef }): Promise<CombatResult>;
  isActive(): boolean;
  getState(): CombatStateView | null;
  submit(cmd: CombatCommand): CommandResult;
  /** UI hover helpers */
  previewMove(unit: EntityId, to: CellKey): { path: CellKey[]; costM: number; provokes: EntityId[] } | null;
  previewAttack(unit: EntityId, ability: string, target: EntityId | CellKey): { hitChance: number; context: AttackContext; damage: string } | null;
  reachable(unit: EntityId): CellKey[];
  targets(unit: EntityId, ability: string): (EntityId | CellKey)[];
  /** convert cell to world position (centre, on terrain) */
  cellToWorld(cell: CellKey): { x: number; y: number; z: number };
  on<K extends keyof CombatEvents & string>(event: K, cb: (...a: CombatEvents[K]) => void): Unsubscribe;
  serialize(): SerializedCombat | null;
  restore(s: SerializedCombat): Promise<void>;
  /** run the enemy AI synchronously for the active unit (used by harness scripts) */
  stepAi(): void;
  /** harness: run a list of commands, auto-ending AI turns */
  runScript(cmds: CombatCommand[]): Promise<CombatStateView>;
}

// ---------------- Party ----------------

export interface DerivedStats {
  defense: number;
  initiativeBonus: number;
  speedM: number;
  carryKg: number;
  encumbered: boolean;
  attackBonus: Record<SkillId, number>;
  soak: Record<'cut' | 'thrust' | 'blunt', number>;
  moraleBonus: number;
  leadershipRadius: number;
  weapon: { defId: string; instanceId: string } | null;
  ranged: { defId: string; instanceId: string } | null;
  shield: { defId: string; instanceId: string } | null;
  ammo: { defId: string; instanceId: string; qty: number } | null;
  perkMods: Record<string, number>;
}

export interface PlayerCreation {
  givenName: string;
  familyName: string;
  origin: Canton;
  attributes: Attributes;
  /** optional starting skill emphasis */
  background: 'saeumer' | 'herder' | 'fisher' | 'hunter' | 'smith' | 'novice';
}

export interface PartyEvents extends Record<string, unknown[]> {
  'level-up': [entity: EntityId, skill: SkillId, level: number];
  'perk-available': [entity: EntityId, perkId: string];
  'item-added': [entity: EntityId, item: ItemInstance];
  'item-removed': [entity: EntityId, defId: string, qty: number];
  equipped: [entity: EntityId, slot: string, instanceId: string | null];
  'hp-changed': [entity: EntityId, hp: number, hpMax: number];
  'party-changed': [members: EntityId[]];
  'character-level-up': [entity: EntityId, level: number, attributePointsGained: number];
}

export interface PartyService {
  createPlayer(creation: PlayerCreation): EntityId;
  createCharacter(def: NpcDef, opts?: { chapter?: string }): EntityId;
  getPlayer(): EntityId | null;
  getParty(): EntityId[];
  /** false when the party is full (4) or the entity is not a character */
  addMember(id: EntityId, control?: 'companion' | 'ally'): boolean;
  removeMember(id: EntityId): void;
  isMember(id: EntityId): boolean;
  derived(id: EntityId): DerivedStats;
  /** other modules call this after editing Character/Equipment/Inventory components directly */
  invalidate(id?: EntityId): void;
  skillLevel(id: EntityId, skill: SkillId): number;
  skillMod(id: EntityId, skill: SkillId): number;
  attrMod(id: EntityId, attr: keyof Attributes): number;
  grantSkillXp(id: EntityId, skill: SkillId, amount: number): { leveled: boolean; newLevel?: number };
  spendAttributePoint(id: EntityId, attr: keyof Attributes): boolean;
  hasPerk(id: EntityId, perk: string): boolean;
  takePerk(id: EntityId, perk: string): boolean;
  availablePerks(id: EntityId): string[];
  equip(id: EntityId, instanceId: string, slot?: string): boolean;
  unequip(id: EntityId, slot: string): void;
  addItem(id: EntityId, defId: string, qty?: number): ItemInstance;
  removeItem(id: EntityId, defId: string, qty?: number): boolean;
  countItem(id: EntityId, defId: string): number;
  transfer(from: EntityId, to: EntityId, instanceId: string, qty?: number): boolean;
  pfennig(id: EntityId): number;
  addPfennig(id: EntityId, delta: number): boolean;
  damage(id: EntityId, amount: number): { hp: number; down: boolean };
  heal(id: EntityId, amount: number): void;
  rest(hours: number): void;
  /** age everyone for a chapter time-skip (kills nobody; content decides that) */
  applyChapter(chapter: string): void;
  itemDef(defId: string): ItemDef | undefined;
  formation(): 'line' | 'wedge' | 'haufen' | 'skirmish';
  setFormation(f: 'line' | 'wedge' | 'haufen' | 'skirmish'): void;
  on<K extends keyof PartyEvents & string>(event: K, cb: (...a: PartyEvents[K]) => void): Unsubscribe;
}

// ---------------- Quest ----------------

export interface JournalEntry { time: number; questId?: string; text: string }
export interface DialogueOutcome { ended: boolean; lastNode: string; effectsRun: number }

export interface QuestEvents extends Record<string, unknown[]> {
  'quest-started': [questId: string];
  'quest-advanced': [questId: string, stage: string];
  'quest-completed': [questId: string];
  'quest-failed': [questId: string];
  'reputation-changed': [faction: FactionId, value: number, delta: number, reason: string];
  'flag-changed': [key: string, value: unknown];
  'dialogue-started': [dialogueId: string];
  'dialogue-ended': [dialogueId: string];
  'journal': [entry: JournalEntry];
}

export interface QuestService {
  start(questId: string): void;
  advance(questId: string, stageId: string): void;
  complete(questId: string): void;
  fail(questId: string): void;
  stage(questId: string): string | null;
  isStarted(questId: string): boolean;
  isDone(questId: string): boolean;
  setVar(questId: string, k: string, v: unknown): void;
  getVar(questId: string, k: string): unknown;
  setFlag(k: string, v: unknown): void;
  getFlag(k: string): unknown;
  reputation(faction: FactionId): number;
  reputationBand(faction: FactionId): 'outlaw' | 'suspect' | 'unknown' | 'trusted' | 'eidgenoss';
  changeReputation(faction: FactionId, delta: number, reason: string): void;
  isHostile(faction: FactionId): boolean;
  factionDef(id: FactionId): FactionDef | undefined;
  evaluate(cond: QuestCondition | undefined): boolean;
  runEffects(effects: Effect[] | undefined): Promise<void>;
  runDialogue(dialogueId: string, speakerEntity?: EntityId): Promise<DialogueOutcome>;
  dialogueExists?(dialogueId: string): boolean;
  runCutscene(cutsceneId: string): Promise<void>;
  journal(): JournalEntry[];
  addJournal(text: string, questId?: string): void;
  activeQuests(): { id: string; title: string; stage: string; objective: string; marker?: { x: number; z: number } }[];
  chapter(): string;
  setChapter(chapter: string): Promise<void>;
  /** persistence */
  serialize(): Pick<import('./schemas').SaveFile, 'quests' | 'reputation' | 'flags' | 'journal' | 'chapter'>;
  restore(s: Pick<import('./schemas').SaveFile, 'quests' | 'reputation' | 'flags' | 'journal' | 'chapter'>): void;
  on<K extends keyof QuestEvents & string>(event: K, cb: (...a: QuestEvents[K]) => void): Unsubscribe;
}

// ---------------- Save ----------------

export interface SaveService {
  save(slot: number, label?: string): Promise<SaveMeta>;
  load(slot: number): Promise<void>;
  list(): Promise<SaveMeta[]>;
  delete(slot: number): Promise<void>;
  autosave(): Promise<SaveMeta>;
  exportJson(slot: number): Promise<string>;
  importJson(json: string, slot: number): Promise<SaveMeta>;
  hasAny(): Promise<boolean>;
}

// ---------------- UI ----------------

export interface DialogueNodeView {
  speakerName: string;
  speakerPortrait?: string;
  text: string;
  choices: { text: string; enabled: boolean; hint?: string; checkOdds?: number }[];
}

export interface HudState {
  hp: number; hpMax: number; morale: number; moraleMax: number; fatigue: number;
  time: string; hour: number; season: string; region: string;
  quest?: { title: string; objective: string };
  compass: { yaw: number; markers: { bearing: number; kind: string; label: string; distance: number; discovered: boolean }[] };
  prompt?: string;
}

export type MenuId = 'pause' | 'inventory' | 'character' | 'journal' | 'map' | 'save' | 'load' | 'settings' | 'title' | 'creation' | 'party' | 'trade' | 'container' | 'rest';

export interface UiService {
  showHud(on: boolean): void;
  updateHud(state: HudState): void;
  toast(msg: string, kind?: 'info' | 'quest' | 'skill' | 'warning'): void;
  openMenu(menu: MenuId, data?: unknown): void;
  closeMenu(): void;
  currentMenu(): MenuId | null;
  dialogue: { show(node: DialogueNodeView): Promise<number>; hide(): void };
  combat: { show(state: CombatStateView): void; update(state: CombatStateView): void; hide(): void; onCommand(cb: (cmd: CombatCommand) => void): void };
  cutscene: { letterbox(on: boolean): void; caption(text: string, seconds: number): Promise<void>; fade(to: 'black' | 'clear', ms: number): Promise<void>; title(text: string, sub?: string, seconds?: number): Promise<void> };
  prompt(text: string | null): void;
  loading(on: boolean, text?: string): void;
  /** quick confirm dialog */
  confirm(text: string, ok?: string, cancel?: string): Promise<boolean>;
}

// ---------------- Registry ----------------

export interface Services {
  world: WorldService;
  exploration: ExplorationService;
  combat: CombatService;
  party: PartyService;
  quest: QuestService;
  save: SaveService;
  ui: UiService;
}

export class ServiceRegistry {
  private impl: Partial<Services> = {};
  register<K extends keyof Services>(name: K, s: Services[K]): void {
    this.impl[name] = s;
  }
  get<K extends keyof Services>(name: K): Services[K] {
    const s = this.impl[name];
    if (!s) throw new Error(`Service "${name}" is not registered`);
    return s as Services[K];
  }
  has<K extends keyof Services>(name: K): boolean {
    return !!this.impl[name];
  }
  tryGet<K extends keyof Services>(name: K): Services[K] | undefined {
    return this.impl[name] as Services[K] | undefined;
  }
}

export type { Rng };
export type { StatusId };
