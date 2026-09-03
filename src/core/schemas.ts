/** Content and save schemas. ARCHITECTURE.md §3.3–3.4 */
import type { DiceExpr } from './rng';
import type {
  CombatEffect, DamageType, Effect, EncounterId, FactionId, ItemId, NpcId, PoiId, QuestCondition, QuestId, SkillId, StatusId,
} from './dsl';
import type { SerializedWorld, EntityId } from './ecs';

export type Historicity = true | 'legend' | 'invented';

export interface Historical {
  /** true = attested; 'legend' = founding tradition (Weisses Buch/Tschudi); 'invented' = ours. See LORE.md. */
  historical: Historicity;
  /** One line: source or justification. */
  note: string;
}

export type Canton = 'uri' | 'schwyz' | 'unterwalden';
export type Owner = Canton | 'habsburg' | 'einsiedeln' | 'luzern' | 'zuerich' | 'bern' | 'zug' | 'none';

export type Vec2 = [x: number, z: number];

export interface RegionDef extends Historical {
  id: string;
  name: string;
  owner: Owner;
  /** polygon in world xz */
  bounds: Vec2[];
  music?: string;
  description: string;
}

export type PoiKind =
  | 'village' | 'town' | 'castle' | 'church' | 'chapel' | 'monastery' | 'alp' | 'pass' | 'bridge' | 'meadow'
  | 'landmark' | 'camp' | 'ruin' | 'port' | 'viewpoint' | 'battlefield' | 'mill' | 'hut' | 'wall' | 'cross';

export interface PlacedModel {
  modelId: string;
  x: number;
  z: number;
  /** y offset from terrain */
  dy?: number;
  yaw?: number;
  scale?: number;
  variant?: string;
}

export interface PoiDef extends Historical {
  id: PoiId;
  name: string;
  region: string;
  x: number;
  z: number;
  kind: PoiKind;
  discoverRadius: number;
  fastTravel: boolean;
  /** optional hand-placed models; the exploration/world builders may also derive layout from kind */
  models?: PlacedModel[];
  npcs?: NpcId[];
  /** generic population per kind, e.g. { peasant: 6, monk: 4 } */
  population?: Record<string, number>;
  description: string;
  /** map icon */
  icon?: string;
}

export interface ScheduleEntry {
  hour: number; // start hour 0-23
  poi: PoiId | 'home';
  activity: 'sleep' | 'work' | 'church' | 'tavern' | 'market' | 'patrol' | 'idle' | 'guard' | 'travel';
  /** local offset in metres from the POI centre */
  offset?: Vec2;
}

export interface Attributes {
  strength: number;
  agility: number;
  endurance: number;
  wits: number;
  presence: number;
}

export interface NpcDef extends Historical {
  id: NpcId;
  name: string;
  faction: FactionId;
  region?: string;
  home: PoiId;
  /** 'named' NPCs have schedules and dialogue; 'generic' are crowd */
  role: 'named' | 'companion' | 'generic' | 'enemy';
  archetype: string; // e.g. 'peasant', 'knight', 'crossbowman', 'monk', 'elder', 'bailiff'
  schedule?: ScheduleEntry[];
  dialogueRoot?: string;
  attributes: Attributes;
  skills?: Partial<Record<SkillId, number>>;
  equipment?: Partial<Record<EquipSlot, ItemId>>;
  inventory?: { item: ItemId; qty: number }[];
  portrait?: string;
  modelId?: string;
  /** birth year, for ageing across time-skips */
  born?: number;
  /** chapters in which this NPC exists at all */
  chapters?: string[];
  description: string;
}

export type EquipSlot = 'mainHand' | 'offHand' | 'head' | 'body' | 'feet' | 'ranged' | 'ammo';

export type WeaponProperty =
  | 'brace' | 'reach' | 'hook' | 'reload-1' | 'reload-2' | 'thrown' | 'finesse' | 'heavy' | 'versatile' | 'two-handed' | 'shield';

export interface WeaponDef {
  skill: SkillId;
  hands: 1 | 2;
  /** reach in cells: 1 adjacent, 2 = polearm */
  reach: 1 | 2 | 3;
  damage: DiceExpr;
  damageType: DamageType;
  properties: WeaponProperty[];
  /** cells; ranged only */
  range?: { short: number; long: number };
  ammo?: ItemId;
}

export interface ArmorDef {
  slot: 'head' | 'body' | 'feet' | 'offHand';
  soak: Record<DamageType, number>;
  defense?: number; // shields
  skill?: 'armor-light' | 'armor-heavy' | 'shield';
  speedPenaltyM?: number;
  stealthPenalty?: number;
}

export type ItemKind = 'weapon' | 'armor' | 'shield' | 'ammo' | 'consumable' | 'tool' | 'misc' | 'book' | 'key';

export interface ItemDef extends Historical {
  id: ItemId;
  name: string;
  kind: ItemKind;
  weightKg: number;
  /** value in Pfennig */
  value: number;
  weapon?: WeaponDef;
  armor?: ArmorDef;
  consumable?: { effect: CombatEffect | Effect; uses?: number };
  /** minimum skill level to use without Burden */
  requires?: { skill: SkillId; level: number };
  /** chapters in which the item is available (era gating) */
  eraFrom?: string;
  description: string;
  icon?: string;
}

export interface ItemInstance {
  instanceId: string;
  defId: ItemId;
  qty: number;
  condition?: number; // 0..1
}

export interface AbilityCost {
  action?: boolean;
  bonus?: boolean;
  reaction?: boolean;
  moveM?: number;
  /** the whole turn's movement is forfeited (aimed shot) */
  noMove?: boolean;
}

export interface AbilityRequires {
  skill?: SkillId;
  level?: number;
  perk?: string;
  weaponProperty?: WeaponProperty;
  weaponSkill?: SkillId;
  ranged?: boolean;
  loaded?: boolean;
  formation?: 'haufen';
  status?: StatusId;
  notStatus?: StatusId;
  terrainFeature?: string | string[];
  /** unit must have a shield equipped (armor slot, not a weapon property) */
  shield?: boolean;
  mounted?: boolean;
  /** charge: unit must have moved at least this many cells in a straight line this turn */
  minChargeCells?: number;
}

export type AbilityTarget = 'self' | 'ally' | 'enemy' | 'cell' | 'line' | 'cone' | 'any';

export interface AbilityDef extends Historical {
  id: string;
  name: string;
  cost: AbilityCost;
  requires?: AbilityRequires;
  target: AbilityTarget;
  /** cells; 0 = self; 'weapon' = weapon reach/range */
  range: number | 'weapon';
  /** to-hit roll required (default true for enemy-targeted) */
  attackRoll?: boolean;
  effects: CombatEffect[];
  /** which trigger for reactions */
  reactionTrigger?: 'leave-reach' | 'enter-reach' | 'charged' | 'ally-attacked' | 'end-move-in-range';
  description: string;
  icon?: string;
  /** AI hint */
  aiWeight?: number;
}

export interface PerkDef extends Historical {
  id: string;
  name: string;
  skill: SkillId;
  level: 25 | 50 | 75 | 100;
  description: string;
  /** flat modifiers read by party.derived() and combat rules */
  modifiers?: Partial<Record<string, number>>;
  grantsAbility?: string;
}

export interface SkillDef {
  id: SkillId;
  name: string;
  attribute: keyof Attributes;
  group: 'weapon' | 'armor' | 'body' | 'mind';
  description: string;
}

export type Side = 'player' | 'enemy' | 'neutral';

export interface PlacedUnit {
  /** NpcDef id or an archetype template */
  npc?: NpcId;
  archetype?: string;
  side: Side;
  /** grid cell */
  q: number;
  r: number;
  /** enemy squad label for UI */
  group?: string;
  /** override display name for generic units */
  name?: string;
  mounted?: boolean;
  /** how many copies to place (spread around q,r) */
  count?: number;
}

export type TerrainFeatureKind = 'boulder-cache' | 'trunk-cache' | 'letzi-wall' | 'palisade' | 'ledge' | 'water' | 'mud' | 'road' | 'scree' | 'snow' | 'tree' | 'rock' | 'fence' | 'house';

export interface TerrainFeature {
  kind: TerrainFeatureKind;
  cells: [number, number][];
  /** for caches: cells hit when triggered */
  affects?: [number, number][];
  uses?: number;
  /** feature-specific data */
  data?: Record<string, unknown>;
}

export type Objective =
  | { type: 'defeat-all' }
  | { type: 'rout'; threshold?: number }
  | { type: 'hold-cells'; cells: [number, number][]; turns: number }
  | { type: 'reach-cell'; cells: [number, number][]; unit?: NpcId | 'any' }
  | { type: 'protect'; npc: NpcId }
  | { type: 'survive'; turns: number }
  | { type: 'trigger-features'; kind: TerrainFeatureKind; count: number };

export interface ScriptedEvent {
  /** fire at the start of this round (1-based) or when a condition is met */
  round?: number;
  when?: 'objective-complete' | 'unit-down' | 'feature-used';
  ref?: string;
  actions: (
    | { spawn: PlacedUnit }
    | { caption: string }
    | { moraleAll: { side: Side; delta: number } }
    | { kill: NpcId }
    | { dialogue: string }
    | { win: true }
    | { lose: true }
    | { camera: { q: number; r: number } }
  )[];
}

export interface EncounterDef extends Historical {
  id: EncounterId;
  name: string;
  location: { x: number; z: number; yaw?: number };
  grid: { cols: number; rows: number; cellM?: number };
  /** deploy zone for the player party */
  deploy: { q: number; r: number; cols: number; rows: number };
  units: PlacedUnit[];
  objectives: Objective[];
  loseObjectives?: Objective[];
  terrainFeatures?: TerrainFeature[];
  scripted?: ScriptedEvent[];
  /** initial morale modifier for each side */
  morale?: Partial<Record<Side, number>>;
  ambush?: 'player' | 'enemy';
  /** override terrain sampling with an authored height function for set pieces */
  heightOverride?: 'morgarten' | 'quay' | 'gate' | 'gasse' | 'flat';
  description: string;
  onWin?: Effect[];
  onLose?: Effect[];
  music?: string;
}

export interface QuestStage {
  id: string;
  /** shown in journal */
  journal: string;
  /** optional map marker */
  marker?: PoiId | { x: number; z: number };
  onEnter?: Effect[];
  /** auto-advance when condition holds */
  advanceWhen?: { cond: QuestCondition; to: string }[];
  objectiveText?: string;
}

export interface QuestDef extends Historical {
  id: QuestId;
  title: string;
  kind: 'main' | 'side';
  chapter: string;
  stages: QuestStage[];
  onStart?: Effect[];
  onComplete?: Effect[];
  onFail?: Effect[];
  description: string;
}

export interface DialogueChoice {
  text: string;
  condition?: QuestCondition;
  /** show but disable when condition fails */
  showDisabled?: boolean;
  effects?: Effect[];
  next?: string;
  /** rolled skill check; success → next, failure → fail */
  check?: { skill: SkillId; dc: number; fail: string };
  /** ends dialogue */
  end?: boolean;
}

export interface DialogueNode {
  speaker: NpcId | 'player' | 'narrator';
  text: string;
  /** alternative texts by condition, first match wins */
  variants?: { condition: QuestCondition; text: string }[];
  choices?: DialogueChoice[];
  next?: string;
  effects?: Effect[];
  end?: boolean;
}

export interface DialogueDef extends Historical {
  id: string;
  /** node id to start at; may be a list of {condition, node} evaluated in order */
  root: string | { condition: QuestCondition; node: string }[];
  nodes: Record<string, DialogueNode>;
}

export interface FactionDef extends Historical {
  id: FactionId;
  name: string;
  kind: 'canton' | 'house' | 'town' | 'abbey' | 'band' | 'none';
  hostileTo: FactionId[];
  /** reputation at which patrols attack */
  hostileBelow?: number;
  description: string;
}

export interface CutsceneStep {
  camera?: { pos: [number, number, number]; lookAt: [number, number, number]; seconds?: number };
  caption?: string;
  seconds?: number;
  fade?: 'black' | 'clear';
  effects?: Effect[];
  dialogue?: string;
  letterbox?: boolean;
  time?: number; // hour
  weather?: string;
}

export interface CutsceneDef extends Historical {
  id: string;
  steps: CutsceneStep[];
}

// ---------------- Save file ----------------

export interface SerializedCombat {
  encounterId: EncounterId;
  round: number;
  turnIndex: number;
  order: EntityId[];
  rngState: number[];
  units: unknown[];
  features: unknown[];
  objectivesState: unknown;
  /** CombatEventRecord[] (typed loosely so core does not depend on the view types) */
  log: unknown[];
  /** per-round bookkeeping that must survive a mid-round save (bughunt combat-engine #2) */
  roundState?: { moraleChecked: [EntityId, string[]][]; scriptedRoundFired: number[]; stalemateFingerprint: string; stalemateRounds: number };
}

export interface SaveMeta {
  /** 0 = autosave, 1..5 manual, 6 = quicksave */
  slot: number;
  label: string;
  createdAt: string;
  updatedAt: string;
  chapter: string;
  calendar: string;
  location: string;
  playtimeSec: number;
  thumbnailDataUrl?: string;
  schemaVersion: number;
  bytes: number;
}

export interface SaveFile {
  schemaVersion: number;
  /** 0 = autosave, 1..5 manual, 6 = quicksave */
  slot: number;
  label: string;
  createdAt: string;
  updatedAt: string;
  seed: number;
  gameTime: number;
  chapter: string;
  world: SerializedWorld;
  playerId: EntityId;
  party: EntityId[];
  quests: Record<QuestId, { stage: string; vars: Record<string, unknown>; done: boolean; failed?: boolean; started: number }>;
  reputation: Record<FactionId, number>;
  discovered: PoiId[];
  flags: Record<string, unknown>;
  journal: { time: number; questId?: QuestId; text: string }[];
  combat?: SerializedCombat;
  rngState: { world: number[]; combat?: number[] };
  playtimeSec: number;
  playerOrigin: Canton;
  location: string;
  weather?: string;
  season?: string;
  thumbnailDataUrl?: string;
}

export const SAVE_SCHEMA_VERSION = 1;
export const SAVE_MAX_BYTES = 2 * 1024 * 1024;
export const AUTOSAVE_SLOT = 0;
export const QUICKSAVE_SLOT = 6;
export const MANUAL_SLOTS = [1, 2, 3, 4, 5] as const;
