/**
 * Party module: characters, skills, perks, equipment, inventory, derived stats. ARCHITECTURE.md §5.5, §4.
 * Registers a `PartyService` implementation. See `src/party/rules.ts` for the pure math this operates on.
 */
import type { GameContext } from '@core/context';
import type { World, EntityId } from '@core/ecs';
import { defineComponent } from '@core/ecs';
import type { ContentRegistry } from '@core/content';
import {
  Character, Skills, Perks, Equipment, Inventory, PartyMember, Player, Name, Faction, Transform, Renderable, Npc,
  type SkillsC,
} from '@core/components';
import type {
  Attributes, Canton, EquipSlot, ItemDef, ItemInstance, NpcDef,
} from '@core/schemas';
import type { SkillId } from '@core/dsl';
import type { DerivedStats, PartyEvents, PartyService, PlayerCreation } from '@core/services';
import { EventBus } from '@core/events';
import {
  applySkillXp, attributePointsEarned, baseDefense, carryCapacityKg, characterLevel, hpMax, modifier, moraleMax,
  PERK_LEVELS, restFatigueLoss, restHeal, rescaleHp, skillAttackMod, sumSoak,
} from './rules';

// ---------------- module-private component ----------------
// Formation preset, persisted on the player entity. Not transient: it should survive save/load.
export interface PartyStateC { formation: 'line' | 'wedge' | 'haufen' | 'skirmish' }
export const PartyState = defineComponent<PartyStateC>('PartyState', () => ({ formation: 'line' }));

const STACKABLE_KINDS = new Set(['ammo', 'consumable', 'tool', 'misc', 'book', 'key']);

interface KitEntry { defId: string; qty?: number }
interface StartingKit {
  equip: Partial<Record<EquipSlot, KitEntry>>;
  items: KitEntry[];
  pfennig: number;
}

const STARTING_KITS: Record<PlayerCreation['background'], StartingKit> = {
  saeumer: {
    equip: { mainHand: { defId: 'item.spiess' }, body: { defId: 'item.gambeson' } },
    items: [{ defId: 'item.messer' }, { defId: 'item.rope' }, { defId: 'item.salt-sack' }],
    pfennig: 40,
  },
  herder: {
    equip: { mainHand: { defId: 'item.staff' }, ranged: { defId: 'item.sling' }, ammo: { defId: 'item.sling-stones', qty: 15 } },
    items: [{ defId: 'item.schweizerdolch' }, { defId: 'item.alpkaese' }],
    pfennig: 0,
  },
  fisher: {
    equip: { mainHand: { defId: 'item.schweizerdolch' } },
    items: [{ defId: 'item.fishing-line' }, { defId: 'item.staff' }],
    pfennig: 0,
  },
  hunter: {
    equip: { ranged: { defId: 'item.hunting-bow' }, ammo: { defId: 'item.arrows', qty: 20 }, mainHand: { defId: 'item.schweizerdolch' } },
    items: [],
    pfennig: 0,
  },
  smith: {
    equip: { mainHand: { defId: 'item.axe' }, head: { defId: 'item.leather-cap' } },
    items: [{ defId: 'item.hammer' }],
    pfennig: 60,
  },
  novice: {
    equip: { mainHand: { defId: 'item.schweizerdolch' } },
    items: [{ defId: 'item.psalter' }, { defId: 'item.herbs' }],
    pfennig: 0,
  },
};

const ORIGIN_SKILL_BONUS: Record<Canton, [SkillId, SkillId]> = {
  uri: ['alpine', 'crossbow'],
  schwyz: ['halberd', 'leadership'],
  unterwalden: ['spear', 'athletics'],
};

/** Minimal shape party needs, so tests can construct one without a full GameContext. */
export interface PartyHost {
  world: World;
  content: ContentRegistry;
  clock?: { calendar(): { year: number }; advanceHours(h: number): void };
  events?: { on(event: string, cb: (...args: unknown[]) => void): () => void };
}

export class PartyServiceImpl implements PartyService {
  private readonly world: World;
  private readonly content: ContentRegistry;
  private readonly clock?: PartyHost['clock'];
  private readonly bus = new EventBus<PartyEvents>();
  private readonly derivedCache = new Map<EntityId, DerivedStats>();
  /** Unspent attribute points (+1 every 3 character levels). No core field exists yet — see requests/party-1.md.
   *  Rebuilt from Character.level whenever it changes, and on the global 'loaded' event after a save load. */
  private readonly unspentPoints = new Map<EntityId, number>();
  private instanceSeq = 1;
  private formationFallback: PartyStateC['formation'] = 'line';

  constructor(host: PartyHost) {
    this.world = host.world;
    this.content = host.content;
    this.clock = host.clock;
    host.events?.on('loaded', () => {
      for (const id of this.getParty()) {
        this.rebuildUnspent(id);
        this.invalidate(id);
      }
    });
  }

  // ---------------- creation ----------------

  createPlayer(creation: PlayerCreation): EntityId {
    const id = this.world.create('player');
    this.world.add(id, Player, { origin: creation.origin, givenName: creation.givenName, familyName: creation.familyName });
    this.world.add(id, Name, { id: 'player', display: `${creation.givenName} ${creation.familyName}` });
    const bornYear = (this.clock?.calendar().year ?? 1291) - 15;
    this.world.add(id, Character, {
      attributes: { ...creation.attributes }, hp: 1, hpMax: 1, morale: 1, moraleMax: 1, fatigue: 0,
      archetype: 'player', born: bornYear, level: 1, down: false,
    });
    this.initSkills(id);
    this.applyOriginBonus(id, creation.origin);
    this.world.add(id, Perks, { ids: [] });
    this.world.add(id, Equipment, {});
    this.world.add(id, Inventory, { items: [], pfennig: 0, capacityKg: carryCapacityKg(creation.attributes.strength) });
    this.applyStartingKit(id, creation.background);
    this.world.add(id, PartyMember, { slot: 0, control: 'player' });
    this.world.add(id, Faction, { factionId: creation.origin });
    this.world.add(id, Transform, { x: 0, y: 0, z: 0, yaw: 0 });
    this.world.add(id, Renderable, { modelId: 'char.player', visible: true });
    this.world.add(id, PartyState, { formation: this.formationFallback });
    this.recomputeCharacterLevel(id, true);
    this.recomputeVitals(id);
    this.rebuildUnspent(id);
    return id;
  }

  createCharacter(def: NpcDef, _opts?: { chapter?: string }): EntityId {
    const id = this.world.create(def.id);
    this.world.add(id, Name, { id: def.id, display: def.name });
    this.initSkills(id, def.skills);
    const skillsC = this.world.require(id, Skills);
    const sum = Object.values(skillsC.levels).reduce((a, s) => a + s.level, 0);
    const level = Math.max(1, characterLevel(sum));
    this.world.add(id, Character, {
      attributes: { ...def.attributes }, hp: 1, hpMax: 1, morale: 1, moraleMax: 1, fatigue: 0,
      archetype: def.archetype, born: def.born, level, down: false,
    });
    this.world.add(id, Perks, { ids: [] });
    this.world.add(id, Equipment, {});
    this.world.add(id, Inventory, { items: [], pfennig: 0, capacityKg: carryCapacityKg(def.attributes.strength) });
    for (const it of def.inventory ?? []) this.addItem(id, it.item, it.qty);
    for (const [slot, defId] of Object.entries(def.equipment ?? {})) {
      if (!defId) continue;
      const inst = this.addItem(id, defId, 1);
      this.equip(id, inst.instanceId, slot as EquipSlot);
    }
    this.world.add(id, Faction, { factionId: def.faction });
    this.world.add(id, Transform, { x: 0, y: 0, z: 0, yaw: 0 });
    this.world.add(id, Renderable, { modelId: def.modelId ?? `char.${def.archetype}`, visible: true });
    this.world.add(id, Npc, { defId: def.id, home: def.home, schedule: def.schedule ?? [], frozen: true, generic: def.role === 'generic' });
    this.recomputeVitals(id);
    this.rebuildUnspent(id);
    return id;
  }

  private initSkills(id: EntityId, overrides?: Partial<Record<SkillId, number>>): void {
    const levels: SkillsC['levels'] = {};
    for (const s of this.content.skills.values()) levels[s.id] = { level: overrides?.[s.id] ?? 10, xp: 0 };
    this.world.add(id, Skills, { levels });
  }

  private applyOriginBonus(id: EntityId, origin: Canton): void {
    const skillsC = this.world.require(id, Skills);
    for (const s of ORIGIN_SKILL_BONUS[origin]) {
      const cur = skillsC.levels[s] ?? { level: 10, xp: 0 };
      skillsC.levels[s] = { level: cur.level + 5, xp: cur.xp };
    }
  }

  private applyStartingKit(id: EntityId, background: PlayerCreation['background']): void {
    const kit = STARTING_KITS[background];
    for (const it of kit.items) this.addItem(id, it.defId, it.qty ?? 1);
    if (kit.pfennig) this.addPfennig(id, kit.pfennig);
    for (const [slot, entry] of Object.entries(kit.equip)) {
      if (!entry) continue;
      const inst = this.addItem(id, entry.defId, entry.qty ?? 1);
      this.equip(id, inst.instanceId, slot as EquipSlot);
    }
  }

  private recomputeVitals(id: EntityId): void {
    const ch = this.world.get(id, Character);
    if (!ch) return;
    const skillsC = this.world.get(id, Skills);
    const leadership = skillsC?.levels['leadership']?.level ?? 0;
    ch.hpMax = hpMax(ch.attributes.endurance, ch.level);
    ch.hp = ch.hpMax;
    ch.moraleMax = moraleMax(ch.attributes.presence, leadership);
    ch.morale = ch.moraleMax;
  }

  // ---------------- party membership ----------------

  getPlayer(): EntityId | null {
    for (const id of this.world.query(PartyMember)) {
      if (this.world.get(id, PartyMember)!.control === 'player') return id;
    }
    return null;
  }

  getParty(): EntityId[] {
    return this.world.query(PartyMember)
      .slice()
      .sort((a, b) => this.world.get(a, PartyMember)!.slot - this.world.get(b, PartyMember)!.slot);
  }

  addMember(id: EntityId, control: 'companion' | 'ally' = 'companion'): void {
    const used = new Set(this.getParty().map((m) => this.world.get(m, PartyMember)!.slot));
    let slot = 1;
    while (used.has(slot) && slot < 8) slot++;
    this.world.add(id, PartyMember, { slot, control });
    this.bus.emit('party-changed', this.getParty());
  }

  removeMember(id: EntityId): void {
    this.world.remove(id, PartyMember);
    this.bus.emit('party-changed', this.getParty());
  }

  isMember(id: EntityId): boolean {
    return this.world.has(id, PartyMember);
  }

  // ---------------- skills / perks ----------------

  skillLevel(id: EntityId, skill: SkillId): number {
    return this.world.get(id, Skills)?.levels[skill]?.level ?? 0;
  }

  skillMod(id: EntityId, skill: SkillId): number {
    const ch = this.world.get(id, Character);
    const def = this.content.skills.get(skill);
    if (!ch || !def) return 0;
    return skillAttackMod(this.skillLevel(id, skill), ch.attributes[def.attribute]);
  }

  attrMod(id: EntityId, attr: keyof Attributes): number {
    const ch = this.world.get(id, Character);
    return ch ? modifier(ch.attributes[attr]) : 0;
  }

  grantSkillXp(id: EntityId, skill: SkillId, amount: number): { leveled: boolean; newLevel?: number } {
    const skillsC = this.world.get(id, Skills) ?? this.world.add(id, Skills, {});
    const prog = skillsC.levels[skill] ?? { level: 0, xp: 0 };
    const result = applySkillXp(prog, amount);
    skillsC.levels[skill] = { level: result.level, xp: result.xp };
    if (result.levelsGained > 0) {
      this.bus.emit('level-up', id, skill, result.level);
      for (const lvl of result.perksCrossed) {
        for (const p of this.content.perks.values()) {
          if (p.skill === skill && p.level === lvl) this.bus.emit('perk-available', id, p.id);
        }
      }
      this.recomputeCharacterLevel(id);
    }
    this.invalidate(id);
    return { leveled: result.levelsGained > 0, newLevel: result.levelsGained > 0 ? result.level : undefined };
  }

  private bumpSkillLevel(id: EntityId, skill: SkillId, delta: number): void {
    const skillsC = this.world.get(id, Skills);
    if (!skillsC) return;
    const prog = skillsC.levels[skill] ?? { level: 0, xp: 0 };
    const oldLevel = prog.level;
    const newLevel = Math.min(100, oldLevel + delta);
    skillsC.levels[skill] = { level: newLevel, xp: prog.xp };
    if (newLevel <= oldLevel) return;
    this.bus.emit('level-up', id, skill, newLevel);
    for (const lvl of PERK_LEVELS) {
      if (oldLevel < lvl && newLevel >= lvl) {
        for (const p of this.content.perks.values()) {
          if (p.skill === skill && p.level === lvl) this.bus.emit('perk-available', id, p.id);
        }
      }
    }
  }

  private recomputeCharacterLevel(id: EntityId, force = false): void {
    const skillsC = this.world.get(id, Skills);
    const ch = this.world.get(id, Character);
    if (!skillsC || !ch) return;
    const sum = Object.values(skillsC.levels).reduce((a, s) => a + s.level, 0);
    const newLevel = Math.max(1, characterLevel(sum));
    if (newLevel === ch.level && !force) return;
    const leadership = skillsC.levels['leadership']?.level ?? 0;
    const newHpMax = hpMax(ch.attributes.endurance, newLevel);
    const newMoraleMax = moraleMax(ch.attributes.presence, leadership);
    ch.hp = rescaleHp(ch.hp, ch.hpMax || newHpMax, newHpMax);
    ch.morale = rescaleHp(ch.morale, ch.moraleMax || newMoraleMax, newMoraleMax);
    ch.hpMax = newHpMax;
    ch.moraleMax = newMoraleMax;
    ch.level = newLevel;
    this.rebuildUnspent(id);
  }

  private rebuildUnspent(id: EntityId): void {
    const ch = this.world.get(id, Character);
    this.unspentPoints.set(id, ch ? attributePointsEarned(ch.level) : 0);
  }

  hasPerk(id: EntityId, perk: string): boolean {
    return !!this.world.get(id, Perks)?.ids.includes(perk);
  }

  availablePerks(id: EntityId): string[] {
    const out: string[] = [];
    for (const p of this.content.perks.values()) {
      if (this.hasPerk(id, p.id)) continue;
      if (this.skillLevel(id, p.skill) >= p.level) out.push(p.id);
    }
    return out;
  }

  takePerk(id: EntityId, perk: string): boolean {
    if (!this.availablePerks(id).includes(perk)) return false;
    const perksC = this.world.get(id, Perks) ?? this.world.add(id, Perks, {});
    perksC.ids.push(perk);
    this.invalidate(id);
    return true;
  }

  // ---------------- equipment ----------------

  private inferSlot(def: ItemDef): EquipSlot | null {
    if (def.kind === 'weapon') return def.weapon?.range ? 'ranged' : 'mainHand';
    if (def.kind === 'shield') return 'offHand';
    if (def.kind === 'ammo') return 'ammo';
    if (def.kind === 'armor' && def.armor) return def.armor.slot as EquipSlot;
    return null;
  }

  private slotCompatible(def: ItemDef, slot: EquipSlot): boolean {
    switch (slot) {
      case 'mainHand': return def.kind === 'weapon';
      case 'ranged': return def.kind === 'weapon' && !!def.weapon?.range;
      case 'ammo': return def.kind === 'ammo';
      case 'offHand': return def.kind === 'shield' || (def.kind === 'armor' && def.armor?.slot === 'offHand');
      case 'head': case 'body': case 'feet': return def.kind === 'armor' && def.armor?.slot === slot;
      default: return false;
    }
  }

  equip(id: EntityId, instanceId: string, slot?: string): boolean {
    const inv = this.world.get(id, Inventory);
    if (!inv) return false;
    const inst = inv.items.find((i) => i.instanceId === instanceId);
    if (!inst) return false;
    const def = this.content.items.get(inst.defId);
    if (!def) return false;
    const eq = this.world.get(id, Equipment) ?? this.world.add(id, Equipment, {});
    const targetSlot = (slot as EquipSlot | undefined) ?? this.inferSlot(def) ?? undefined;
    if (!targetSlot || !this.slotCompatible(def, targetSlot)) return false;
    if (targetSlot === 'offHand') {
      const mainInst = eq.mainHand ? inv.items.find((i) => i.instanceId === eq.mainHand) : undefined;
      const mainDef = mainInst ? this.content.items.get(mainInst.defId) : undefined;
      if (mainDef?.weapon?.hands === 2) return false;
    }
    if (targetSlot === 'mainHand' && def.weapon?.hands === 2) delete eq.offHand;
    eq[targetSlot] = instanceId;
    this.invalidate(id);
    this.bus.emit('equipped', id, targetSlot, instanceId);
    return true;
  }

  unequip(id: EntityId, slot: string): void {
    const eq = this.world.get(id, Equipment);
    if (!eq) return;
    delete (eq as Record<string, string | undefined>)[slot];
    this.invalidate(id);
    this.bus.emit('equipped', id, slot, null);
  }

  // ---------------- inventory ----------------

  private newInstanceId(owner: EntityId): string {
    return `item-${owner}-${this.instanceSeq++}`;
  }

  addItem(id: EntityId, defId: string, qty = 1): ItemInstance {
    const inv = this.world.get(id, Inventory) ?? this.world.add(id, Inventory, {});
    const def = this.content.items.get(defId);
    const stackable = !def || STACKABLE_KINDS.has(def.kind);
    if (stackable) {
      const existing = inv.items.find((i) => i.defId === defId);
      if (existing) {
        existing.qty += qty;
        this.invalidate(id);
        this.bus.emit('item-added', id, existing);
        return existing;
      }
    }
    const inst: ItemInstance = { instanceId: this.newInstanceId(id), defId, qty, condition: 1 };
    inv.items.push(inst);
    this.invalidate(id);
    this.bus.emit('item-added', id, inst);
    return inst;
  }

  removeItem(id: EntityId, defId: string, qty = 1): boolean {
    const inv = this.world.get(id, Inventory);
    if (!inv) return false;
    const eq = this.world.get(id, Equipment);
    let remaining = qty;
    for (let i = inv.items.length - 1; i >= 0 && remaining > 0; i--) {
      const it = inv.items[i];
      if (it.defId !== defId) continue;
      if (it.qty <= remaining) {
        remaining -= it.qty;
        inv.items.splice(i, 1);
        if (eq) {
          for (const s of Object.keys(eq) as EquipSlot[]) if (eq[s] === it.instanceId) delete eq[s];
        }
      } else {
        it.qty -= remaining;
        remaining = 0;
      }
    }
    this.invalidate(id);
    this.bus.emit('item-removed', id, defId, qty - remaining);
    return remaining === 0;
  }

  countItem(id: EntityId, defId: string): number {
    const inv = this.world.get(id, Inventory);
    if (!inv) return 0;
    return inv.items.filter((i) => i.defId === defId).reduce((a, i) => a + i.qty, 0);
  }

  transfer(from: EntityId, to: EntityId, instanceId: string, qty?: number): boolean {
    const fromInv = this.world.get(from, Inventory);
    if (!fromInv) return false;
    const idx = fromInv.items.findIndex((i) => i.instanceId === instanceId);
    if (idx < 0) return false;
    const item = fromInv.items[idx];
    const moveQty = qty ?? item.qty;
    if (moveQty <= 0 || moveQty > item.qty) return false;
    const def = this.content.items.get(item.defId);
    if (moveQty === item.qty) {
      fromInv.items.splice(idx, 1);
      const eq = this.world.get(from, Equipment);
      if (eq) for (const s of Object.keys(eq) as EquipSlot[]) if (eq[s] === instanceId) delete eq[s];
    } else {
      item.qty -= moveQty;
    }
    const toInv = this.world.get(to, Inventory) ?? this.world.add(to, Inventory, {});
    const stackable = !def || STACKABLE_KINDS.has(def.kind);
    if (stackable) {
      const existing = toInv.items.find((i) => i.defId === item.defId);
      if (existing) {
        existing.qty += moveQty;
        this.invalidate(from);
        this.invalidate(to);
        this.bus.emit('item-removed', from, item.defId, moveQty);
        this.bus.emit('item-added', to, existing);
        return true;
      }
    }
    const newInst: ItemInstance = { instanceId: this.newInstanceId(to), defId: item.defId, qty: moveQty, condition: item.condition };
    toInv.items.push(newInst);
    this.invalidate(from);
    this.invalidate(to);
    this.bus.emit('item-removed', from, item.defId, moveQty);
    this.bus.emit('item-added', to, newInst);
    return true;
  }

  pfennig(id: EntityId): number {
    return this.world.get(id, Inventory)?.pfennig ?? 0;
  }

  addPfennig(id: EntityId, delta: number): boolean {
    const inv = this.world.get(id, Inventory);
    if (!inv) return false;
    if (inv.pfennig + delta < 0) return false;
    inv.pfennig += delta;
    return true;
  }

  itemDef(defId: string): ItemDef | undefined {
    return this.content.items.get(defId);
  }

  // ---------------- hp / rest / chapters ----------------

  damage(id: EntityId, amount: number): { hp: number; down: boolean } {
    const ch = this.world.require(id, Character);
    ch.hp = Math.max(0, ch.hp - Math.max(0, amount));
    if (ch.hp <= 0) ch.down = true;
    this.bus.emit('hp-changed', id, ch.hp, ch.hpMax);
    return { hp: ch.hp, down: ch.down };
  }

  heal(id: EntityId, amount: number): void {
    const ch = this.world.require(id, Character);
    ch.hp = Math.min(ch.hpMax, ch.hp + Math.max(0, amount));
    if (ch.hp > 0) ch.down = false;
    this.bus.emit('hp-changed', id, ch.hp, ch.hpMax);
  }

  rest(hours: number): void {
    for (const id of this.getParty()) {
      const ch = this.world.get(id, Character);
      if (!ch) continue;
      const gain = restHeal(hours, ch.attributes.endurance);
      ch.hp = Math.min(ch.hpMax, ch.hp + gain);
      if (ch.hp > 0) ch.down = false;
      ch.fatigue = Math.max(0, ch.fatigue - restFatigueLoss(hours));
      this.bus.emit('hp-changed', id, ch.hp, ch.hpMax);
    }
    this.clock?.advanceHours(hours);
  }

  applyChapter(_chapter: string): void {
    for (const id of this.getParty()) {
      const pm = this.world.get(id, PartyMember);
      if (!pm || pm.control !== 'companion') continue;
      const skillsC = this.world.get(id, Skills);
      if (!skillsC) continue;
      const top3 = Object.entries(skillsC.levels)
        .sort((a, b) => b[1].level - a[1].level)
        .slice(0, 3)
        .map(([k]) => k);
      for (const skill of top3) this.bumpSkillLevel(id, skill, 5);
      this.recomputeCharacterLevel(id);
      this.invalidate(id);
    }
  }

  // ---------------- formation ----------------

  formation(): 'line' | 'wedge' | 'haufen' | 'skirmish' {
    const player = this.getPlayer();
    if (player !== null) {
      const ps = this.world.get(player, PartyState);
      if (ps) return ps.formation;
    }
    return this.formationFallback;
  }

  setFormation(f: 'line' | 'wedge' | 'haufen' | 'skirmish'): void {
    const player = this.getPlayer();
    if (player !== null) {
      const ps = this.world.get(player, PartyState) ?? this.world.add(player, PartyState, { formation: f });
      ps.formation = f;
    }
    this.formationFallback = f;
  }

  // ---------------- derived stats ----------------

  private invalidate(id: EntityId): void {
    this.derivedCache.delete(id);
  }

  derived(id: EntityId): DerivedStats {
    const cached = this.derivedCache.get(id);
    if (cached) return cached;

    const ch = this.world.require(id, Character);
    const skillsC = this.world.get(id, Skills);
    const perksC = this.world.get(id, Perks);
    const eq = this.world.get(id, Equipment) ?? {};
    const inv = this.world.get(id, Inventory);

    type EquippedEntry = { slot: EquipSlot; def: ItemDef; instance: ItemInstance };
    const equipped: EquippedEntry[] = [];
    if (inv) {
      for (const [slot, instId] of Object.entries(eq) as [EquipSlot, string | undefined][]) {
        if (!instId) continue;
        const instance = inv.items.find((i) => i.instanceId === instId);
        if (!instance) continue;
        const def = this.content.items.get(instance.defId);
        if (!def) continue;
        equipped.push({ slot, def, instance });
      }
    }

    const perkMods: Record<string, number> = {};
    for (const pid of perksC?.ids ?? []) {
      const p = this.content.perks.get(pid);
      if (!p) continue;
      for (const [k, v] of Object.entries(p.modifiers ?? {})) perkMods[k] = (perkMods[k] ?? 0) + (v ?? 0);
    }

    // burden from an equipped weapon whose skill requirement isn't met
    for (const e of equipped) {
      if ((e.slot === 'mainHand' || e.slot === 'ranged') && e.def.requires) {
        if (this.skillLevel(id, e.def.requires.skill) < e.def.requires.level) {
          perkMods['burden.weapon'] = (perkMods['burden.weapon'] ?? 0) + 1;
        }
      }
    }

    const soak = sumSoak(equipped.filter((e) => e.def.armor).map((e) => e.def.armor!.soak));
    soak.cut += perkMods['soak.cut'] ?? 0;
    soak.thrust += perkMods['soak.thrust'] ?? 0;
    soak.blunt += perkMods['soak.blunt'] ?? 0;

    let defense = baseDefense(ch.attributes.agility) + (perkMods['defense'] ?? 0);
    const shieldEntry = equipped.find((e) => e.slot === 'offHand' && e.def.armor?.defense);
    if (shieldEntry) defense += shieldEntry.def.armor!.defense ?? 0;

    let speedDelta = 0;
    for (const e of equipped) if (e.def.armor?.speedPenaltyM) speedDelta += e.def.armor.speedPenaltyM;
    speedDelta += perkMods['speedM'] ?? 0;
    const totalWeight = inv ? inv.items.reduce((a, i) => a + (this.content.items.get(i.defId)?.weightKg ?? 0) * i.qty, 0) : 0;
    const carryKg = carryCapacityKg(ch.attributes.strength) + (perkMods['carryKg'] ?? 0);
    const encumbered = totalWeight > carryKg;
    if (encumbered) speedDelta -= 3;
    const speed = Math.max(4.5, 9 + speedDelta);

    const attackBonus: Record<SkillId, number> = {};
    for (const s of this.content.skills.values()) {
      const lvl = skillsC?.levels[s.id]?.level ?? 0;
      attackBonus[s.id] = skillAttackMod(lvl, ch.attributes[s.attribute]) + (perkMods[`attack.${s.id}`] ?? 0);
    }

    const leadershipLevel = skillsC?.levels['leadership']?.level ?? 0;
    const mainHand = equipped.find((e) => e.slot === 'mainHand');
    const ranged = equipped.find((e) => e.slot === 'ranged');
    const shield = equipped.find((e) => e.slot === 'offHand' && (e.def.kind === 'shield' || e.def.armor?.defense));

    const result: DerivedStats = {
      defense,
      initiativeBonus: modifier(ch.attributes.agility) + (perkMods['initiative'] ?? 0),
      speedM: speed,
      carryKg,
      encumbered,
      attackBonus,
      soak,
      moraleBonus: perkMods['morale'] ?? 0,
      leadershipRadius: 2 + Math.floor(leadershipLevel / 25),
      weapon: mainHand ? { defId: mainHand.def.id, instanceId: mainHand.instance.instanceId } : null,
      ranged: ranged ? { defId: ranged.def.id, instanceId: ranged.instance.instanceId } : null,
      shield: shield ? { defId: shield.def.id, instanceId: shield.instance.instanceId } : null,
      perkMods,
    };
    this.derivedCache.set(id, result);
    return result;
  }

  // ---------------- events ----------------

  on<K extends keyof PartyEvents & string>(event: K, cb: (...a: PartyEvents[K]) => void) {
    return this.bus.on(event, cb);
  }
}

export async function register(ctx: GameContext): Promise<void> {
  const host: PartyHost = {
    world: ctx.world,
    content: ctx.content,
    clock: ctx.clock,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    events: { on: (event, cb) => ctx.events.on(event as any, cb as any) },
  };
  const svc = new PartyServiceImpl(host);
  ctx.services.register('party', svc);
}
