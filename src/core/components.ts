/** Shared component catalogue. ARCHITECTURE.md §3.2. Modules own the *systems*, core owns the schemas. */
import { defineComponent } from './ecs';
import type { Attributes, EquipSlot, ItemInstance, PoiKind, ScheduleEntry, Side } from './schemas';
import type { QuestCondition, SkillId, StatusId } from './dsl';

export interface TransformC { x: number; y: number; z: number; yaw: number }
export const Transform = defineComponent<TransformC>('Transform', () => ({ x: 0, y: 0, z: 0, yaw: 0 }));

export interface RenderableC { modelId: string; variant?: string; scale?: number; visible: boolean }
export const Renderable = defineComponent<RenderableC>('Renderable', () => ({ modelId: 'placeholder', visible: true }));

export interface NameC { id: string; display: string }
export const Name = defineComponent<NameC>('Name', () => ({ id: '', display: '' }));

export interface CharacterC {
  attributes: Attributes;
  hp: number;
  hpMax: number;
  morale: number;
  moraleMax: number;
  fatigue: number; // 0 = fresh, 100 = exhausted
  archetype: string;
  born?: number;
  level: number;
  /** derived on load: unconscious/bleeding */
  down: boolean;
}
export const Character = defineComponent<CharacterC>('Character', () => ({
  attributes: { strength: 10, agility: 10, endurance: 10, wits: 10, presence: 10 },
  hp: 20, hpMax: 20, morale: 60, moraleMax: 60, fatigue: 0, archetype: 'peasant', level: 1, down: false,
}));

export interface SkillsC { levels: Record<SkillId, { level: number; xp: number }> }
export const Skills = defineComponent<SkillsC>('Skills', () => ({ levels: {} }));

export interface PerksC { ids: string[] }
export const Perks = defineComponent<PerksC>('Perks', () => ({ ids: [] }));

export type EquipmentC = Partial<Record<EquipSlot, string>>; // ItemInstance ids
export const Equipment = defineComponent<EquipmentC>('Equipment', () => ({}));

export interface InventoryC { items: ItemInstance[]; pfennig: number; capacityKg: number }
export const Inventory = defineComponent<InventoryC>('Inventory', () => ({ items: [], pfennig: 0, capacityKg: 40 }));

export interface PartyMemberC { slot: number; control: 'player' | 'companion' | 'ally' }
export const PartyMember = defineComponent<PartyMemberC>('PartyMember', () => ({ slot: 0, control: 'companion' }));

export interface FactionC { factionId: string }
export const Faction = defineComponent<FactionC>('Faction', () => ({ factionId: 'none' }));

export interface NpcC {
  defId: string;
  home: string;
  schedule: ScheduleEntry[];
  /** current schedule target */
  targetPoi?: string;
  activity?: string;
  frozen: boolean;
  /** generic crowd NPC */
  generic: boolean;
}
export const Npc = defineComponent<NpcC>('Npc', () => ({ defId: '', home: '', schedule: [], frozen: true, generic: false }));

export interface InteractableC {
  kind: 'talk' | 'loot' | 'read' | 'use' | 'travel' | 'rest' | 'trade' | 'inspect';
  prompt: string;
  dialogueId?: string;
  containerId?: string;
  data?: Record<string, unknown>;
  enabled: boolean;
  condition?: QuestCondition;
}
export const Interactable = defineComponent<InteractableC>('Interactable', () => ({ kind: 'inspect', prompt: 'Inspect', enabled: true }));

export interface PoiC { poiId: string; kind: PoiKind; radius: number; discovered: boolean; fastTravel: boolean }
export const Poi = defineComponent<PoiC>('Poi', () => ({ poiId: '', kind: 'landmark', radius: 40, discovered: false, fastTravel: false }));

export interface EncounterTriggerC { encounterId: string; radius: number; once: boolean; fired: boolean; condition?: QuestCondition; ambush?: 'player' | 'enemy' }
export const EncounterTrigger = defineComponent<EncounterTriggerC>('EncounterTrigger', () => ({ encounterId: '', radius: 20, once: true, fired: false }));

export interface ContainerC { containerId: string; items: ItemInstance[]; pfennig: number; opened: boolean; owner?: string }
export const Container = defineComponent<ContainerC>('Container', () => ({ containerId: '', items: [], pfennig: 0, opened: false }));

export interface StatusEffect { id: StatusId; turns: number; source?: number }
export type Stance = 'neutral' | 'aggressive' | 'guarded' | 'braced';

export interface CombatantC {
  side: Side;
  initiative: number;
  q: number;
  r: number;
  ap: { action: boolean; bonus: boolean; reaction: boolean; moveM: number };
  status: StatusEffect[];
  stance: Stance;
  loaded: boolean;
  mounted: boolean;
  group?: string;
  /** cells moved this turn in a straight line (charge tracking) */
  chargeLine: number;
  /** temp per-encounter flags */
  flags: Record<string, unknown>;
  /** aiDoctrine for enemies */
  doctrine?: string;
}
export const Combatant = defineComponent<CombatantC>('Combatant', () => ({
  side: 'enemy', initiative: 0, q: 0, r: 0,
  ap: { action: true, bonus: true, reaction: true, moveM: 9 },
  status: [], stance: 'neutral', loaded: false, mounted: false, chargeLine: 0, flags: {},
}), { transient: true });

export interface DeadC { at: number }
export const Dead = defineComponent<DeadC>('Dead', () => ({ at: 0 }));

export interface PlayerC { origin: 'uri' | 'schwyz' | 'unterwalden'; givenName: string; familyName: string }
export const Player = defineComponent<PlayerC>('Player', () => ({ origin: 'uri', givenName: 'Kuoni', familyName: 'Imhof' }));

/** transient: attached Three.js object; owned by whichever module rendered it */
export interface MeshRefC { object: unknown; kind: string }
export const MeshRef = defineComponent<MeshRefC>('MeshRef', () => ({ object: null, kind: '' }), { transient: true });

export interface VelocityC { vx: number; vy: number; vz: number; grounded: boolean }
export const Velocity = defineComponent<VelocityC>('Velocity', () => ({ vx: 0, vy: 0, vz: 0, grounded: true }), { transient: true });
