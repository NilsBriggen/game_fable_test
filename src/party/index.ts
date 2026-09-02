/**
 * Party module: characters, skills, perks, equipment, inventory, derived stats. ARCHITECTURE.md §5.5, §4.
 * Registers a `PartyService` implementation. See `src/party/rules.ts` for the pure math this operates on.
 *
 * Fix round 1 (wave-1 critic, tools/critic/wave1-party.md, score 5/10): every numbered fix below cites the
 * issue number from that report.
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
// Formation preset + the two counters that must survive save/load, persisted on the player entity.
// Not transient: it should survive save/load.
export interface PartyStateC {
  formation: 'line' | 'wedge' | 'haufen' | 'skirmish';
  /** Monotonic item-instance id counter. Fix round 1, issue 2: this used to be an in-memory `instanceSeq`
   *  that restarted at 1 every session, so the first `addItem` after a load collided with an id already
   *  sitting in the loaded inventory (`item-1-1` twice). Living on this persisted component instead means
   *  it survives serialize/deserialize with no scan-and-repair step needed on `'loaded'`. */
  nextItemSeq: number;
  /** Current chapter id (see `CHAPTER_ORDER` below), used for `ItemDef.eraFrom` gating. Fix round 1, issue 8. */
  chapter: string;
}
export const PartyState = defineComponent<PartyStateC>('PartyState', () => ({ formation: 'line', nextItemSeq: 1, chapter: 'prologue-1291' }));

const STACKABLE_KINDS = new Set(['ammo', 'consumable', 'tool', 'misc', 'book', 'key']);

/** Chapter order for era gating (fix round 1, issue 8). Aligned with the quest builder's chapter ids
 *  (ARCHITECTURE §3.4 `SaveFile.chapter`, LORE §1). An id not in this list (a later act not yet built) is
 *  treated as "at least as late as the last known chapter", so it never spuriously blocks period gear. */
const CHAPTER_ORDER = ['prologue-1291', 'ch1-1307', 'ch2-1314'] as const;
function chapterIndex(chapter: string): number {
  const i = (CHAPTER_ORDER as readonly string[]).indexOf(chapter);
  return i < 0 ? CHAPTER_ORDER.length - 1 : i;
}

interface KitEntry { defId: string; qty?: number }
interface StartingKit {
  equip: Partial<Record<EquipSlot, KitEntry>>;
  items: KitEntry[];
  pfennig: number;
}

export const STARTING_KITS: Record<PlayerCreation['background'], StartingKit> = {
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

/** Fix round 1, issue 12: `PlayerCreation.background` was documented as "optional starting skill emphasis"
 *  but only ever granted a kit, never a skill bonus — a hunter and a smith both started crossbow/craft at 10.
 *  Mirrors `ORIGIN_SKILL_BONUS`'s shape and +5/+5 magnitude. */
const BACKGROUND_SKILL_BONUS: Record<PlayerCreation['background'], [SkillId, SkillId]> = {
  saeumer: ['trade', 'athletics'],
  herder: ['throwing', 'alpine'],
  fisher: ['athletics', 'trade'],
  hunter: ['crossbow', 'stealth'],
  smith: ['craft', 'axe-mace'],
  novice: ['herbalism', 'speech'],
};

/** Minimal shape party needs, so tests can construct one without a full GameContext. */
export interface PartyHost {
  world: World;
  content: ContentRegistry;
  clock?: { calendar(): { year: number }; advanceHours(h: number): void };
  events?: { on(event: string, cb: (...args: unknown[]) => void): () => void };
}

/** Memoised `derived()` entry: `fp` is a cheap fingerprint of everything the computation reads, so a cache
 *  hit is only trusted when nothing relevant has changed since — see `fingerprint()` and issue 3 below. */
interface DerivedCacheEntry { fp: string; stats: DerivedStats }

export class PartyServiceImpl implements PartyService {
  private readonly world: World;
  private readonly content: ContentRegistry;
  private readonly clock?: PartyHost['clock'];
  private readonly bus = new EventBus<PartyEvents>();
  private readonly derivedCache = new Map<EntityId, DerivedCacheEntry>();
  /** Formation/item-seq/chapter state before a player entity exists (mainly for tests that call
   *  `createCharacter` without `createPlayer`). Once a player exists, `state()` reads/writes its
   *  `PartyState` component instead — see `state()`. */
  private readonly fallbackState: PartyStateC = { formation: 'line', nextItemSeq: 1, chapter: 'prologue-1291' };

  constructor(host: PartyHost) {
    this.world = host.world;
    this.content = host.content;
    this.clock = host.clock;
    // Fix round 1, issue 3: clear the *whole* cache on load, not just current party members — an enemy's
    // (or a former party member's) stale entry could otherwise survive under a reused EntityId.
    host.events?.on('loaded', () => this.invalidate());
  }

  /** The one place formation/nextItemSeq/chapter live: the player's `PartyState` component once a player
   *  exists (so it round-trips through save/load), or an in-memory fallback before that. */
  private state(): PartyStateC {
    const player = this.getPlayer();
    if (player === null) return this.fallbackState;
    return this.world.get(player, PartyState) ?? this.world.add(player, PartyState, { ...this.fallbackState });
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
    this.bumpSkillsFlat(id, ORIGIN_SKILL_BONUS[creation.origin], 5);
    this.bumpSkillsFlat(id, BACKGROUND_SKILL_BONUS[creation.background], 5); // fix round 1, issue 12
    this.world.add(id, Perks, { ids: [] });
    this.world.add(id, Equipment, {});
    this.world.add(id, Inventory, { items: [], pfennig: 0, capacityKg: carryCapacityKg(creation.attributes.strength) });
    this.world.add(id, PartyMember, { slot: 0, control: 'player' });
    this.world.add(id, Faction, { factionId: creation.origin });
    this.world.add(id, Transform, { x: 0, y: 0, z: 0, yaw: 0 });
    this.world.add(id, Renderable, { modelId: 'char.player', visible: true });
    this.world.add(id, PartyState, { ...this.fallbackState });
    // starting-kit equip must not be blocked by era gating (it's authored, not player-chosen) — see equip()
    this.applyStartingKit(id, creation.background);
    this.recomputeCharacterLevel(id, true);
    this.recomputeVitals(id);
    return id;
  }

  createCharacter(def: NpcDef, _opts?: { chapter?: string }): EntityId {
    const id = this.world.create(def.id);
    this.world.add(id, Name, { id: def.id, display: def.name });
    this.initSkills(id, def.skills);
    this.world.add(id, Character, {
      attributes: { ...def.attributes }, hp: 1, hpMax: 1, morale: 1, moraleMax: 1, fatigue: 0,
      archetype: def.archetype, born: def.born, level: 1, down: false,
    });
    this.world.add(id, Perks, { ids: [] });
    this.world.add(id, Equipment, {});
    this.world.add(id, Inventory, { items: [], pfennig: 0, capacityKg: carryCapacityKg(def.attributes.strength) });
    for (const it of def.inventory ?? []) this.addItem(id, it.item, it.qty);
    for (const [slot, defId] of Object.entries(def.equipment ?? {})) {
      if (!defId) continue;
      const inst = this.addItem(id, defId, 1);
      this.equipInternal(id, inst.instanceId, slot as EquipSlot, false); // authored kit — skip era gate
    }
    this.world.add(id, Faction, { factionId: def.faction });
    this.world.add(id, Transform, { x: 0, y: 0, z: 0, yaw: 0 });
    this.world.add(id, Renderable, { modelId: def.modelId ?? `char.${def.archetype}`, visible: true });
    this.world.add(id, Npc, { defId: def.id, home: def.home, schedule: def.schedule ?? [], frozen: true, generic: def.role === 'generic' });
    this.recomputeCharacterLevel(id, true);
    this.recomputeVitals(id);
    return id;
  }

  private initSkills(id: EntityId, overrides?: Partial<Record<SkillId, number>>): void {
    const levels: SkillsC['levels'] = {};
    // Every skill defaults to 10, not 0: a level-10 baseline across all 19 skills reads as "a grown adult who
    // has done some ordinary living", not "no skills at all", and is why every fresh character starts at
    // character level 4 (`floor(19*10/40)`) rather than level 0 — intentional, see `rules.characterLevel`.
    for (const s of this.content.skills.values()) levels[s.id] = { level: overrides?.[s.id] ?? 10, xp: 0 };
    this.world.add(id, Skills, { levels });
  }

  private bumpSkillsFlat(id: EntityId, skills: SkillId[], delta: number): void {
    const skillsC = this.world.require(id, Skills);
    for (const s of skills) {
      const cur = skillsC.levels[s] ?? { level: 10, xp: 0 };
      skillsC.levels[s] = { level: cur.level + delta, xp: cur.xp };
    }
  }

  private applyStartingKit(id: EntityId, background: PlayerCreation['background']): void {
    const kit = STARTING_KITS[background];
    for (const it of kit.items) this.addItem(id, it.defId, it.qty ?? 1);
    if (kit.pfennig) this.addPfennig(id, kit.pfennig);
    for (const [slot, entry] of Object.entries(kit.equip)) {
      if (!entry) continue;
      const inst = this.addItem(id, entry.defId, entry.qty ?? 1);
      this.equipInternal(id, inst.instanceId, slot as EquipSlot, false); // authored kit — skip era gate
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

  addMember(id: EntityId, control: 'companion' | 'ally' = 'companion'): boolean {
    // Fix round 1, issue 7: no cap meant `addMember` silently built a 7-member party against §5.5's
    // "player + 3", and an entity with no Character would later crash `derived()`.
    if (!this.world.has(id, Character)) return false;
    if (this.getParty().length >= 4) return false;
    const used = new Set(this.getParty().map((m) => this.world.get(m, PartyMember)!.slot));
    let slot = 1;
    while (used.has(slot) && slot < 4) slot++;
    if (used.has(slot)) return false;
    this.world.add(id, PartyMember, { slot, control });
    this.bus.emit('party-changed', this.getParty());
    return true;
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

  spendAttributePoint(id: EntityId, attr: keyof Attributes): boolean {
    const ch = this.world.get(id, Character);
    if (!ch) return false;
    if (ch.unspentAttributePoints <= 0) return false;
    if (ch.attributes[attr] >= 20) return false;
    ch.unspentAttributePoints -= 1;
    ch.attributes[attr] = Math.min(20, ch.attributes[attr] + 1);
    const skillsC = this.world.get(id, Skills);
    const leadership = skillsC?.levels['leadership']?.level ?? 0;
    const newHpMax = hpMax(ch.attributes.endurance, ch.level);
    const newMoraleMax = moraleMax(ch.attributes.presence, leadership);
    ch.hp = rescaleHp(ch.hp, ch.hpMax || newHpMax, newHpMax);
    ch.morale = rescaleHp(ch.morale, ch.moraleMax || newMoraleMax, newMoraleMax);
    ch.hpMax = newHpMax;
    ch.moraleMax = newMoraleMax;
    this.invalidate(id);
    this.syncCapacityKg(id); // strength may have just changed carryKg (minor note)
    this.bus.emit('hp-changed', id, ch.hp, ch.hpMax); // fix round 1, issue 14: hpMax changed, UI must hear it
    return true;
  }

  grantSkillXp(id: EntityId, skill: SkillId, amount: number): { leveled: boolean; newLevel?: number } {
    if (!this.world.has(id, Character)) return { leveled: false }; // minor note: guard entities without Character
    const skillsC = this.world.get(id, Skills) ?? this.world.add(id, Skills, {});
    const prog = skillsC.levels[skill] ?? { level: 0, xp: 0 };
    const result = applySkillXp(prog, amount);
    skillsC.levels[skill] = { level: result.level, xp: result.xp };
    if (result.levelsGained > 0) {
      // Fix round 1, issue 14: recompute the character level BEFORE emitting — a listener reading
      // Character.level inside a 'level-up' handler used to see the stale value.
      this.recomputeCharacterLevel(id);
      this.bus.emit('level-up', id, skill, result.level);
      for (const lvl of result.perksCrossed) {
        for (const p of this.content.perks.values()) {
          if (p.skill === skill && p.level === lvl) this.bus.emit('perk-available', id, p.id);
        }
      }
    }
    this.invalidate(id);
    return { leveled: result.levelsGained > 0, newLevel: result.levelsGained > 0 ? result.level : undefined };
  }

  /** Bumps a skill level without emitting yet — the caller (`applyChapter`) recomputes the character
   *  level from ALL the bumps first, then emits, so a 'level-up'/'perk-available' listener never sees a
   *  stale `Character.level` (fix round 2, issue 2 — mirrors `grantSkillXp`'s ordering from round 1, issue 14). */
  private bumpSkillLevel(id: EntityId, skill: SkillId, delta: number): { skill: SkillId; newLevel: number; perkIds: string[] } | null {
    const skillsC = this.world.get(id, Skills);
    if (!skillsC) return null;
    const prog = skillsC.levels[skill] ?? { level: 0, xp: 0 };
    const oldLevel = prog.level;
    const newLevel = Math.min(100, oldLevel + delta);
    skillsC.levels[skill] = { level: newLevel, xp: prog.xp };
    if (newLevel <= oldLevel) return null;
    const perkIds: string[] = [];
    for (const lvl of PERK_LEVELS) {
      if (oldLevel < lvl && newLevel >= lvl) {
        for (const p of this.content.perks.values()) {
          if (p.skill === skill && p.level === lvl) perkIds.push(p.id);
        }
      }
    }
    return { skill, newLevel, perkIds };
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
    // +1 attribute point every 3 character levels (ARCHITECTURE §5.5), stored on Character.unspentAttributePoints.
    const pointsGained = attributePointsEarned(newLevel) - attributePointsEarned(ch.level);
    if (pointsGained > 0) ch.unspentAttributePoints += pointsGained;
    const levelChanged = newLevel !== ch.level;
    ch.hpMax = newHpMax;
    ch.moraleMax = newMoraleMax;
    ch.level = newLevel;
    this.bus.emit('hp-changed', id, ch.hp, ch.hpMax); // fix round 1, issue 14: hpMax changed here too
    if (levelChanged) this.bus.emit('character-level-up', id, newLevel, Math.max(0, pointsGained));
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
    this.syncCapacityKg(id); // a perk may grant carryKg (minor note)
    return true;
  }

  /** Keep the persisted `Inventory.capacityKg` in sync with `derived().carryKg` (minor note: it used to be
   *  written once at creation and never again, so the component — and thus save/UI — disagreed with reality
   *  after a strength point or a carryKg perk). */
  private syncCapacityKg(id: EntityId): void {
    const inv = this.world.get(id, Inventory);
    if (!inv || !this.world.has(id, Character)) return;
    inv.capacityKg = this.derived(id).carryKg;
  }

  // ---------------- equipment ----------------

  private inferSlot(def: ItemDef): EquipSlot | null {
    if (def.kind === 'weapon') return def.weapon?.range && !def.weapon.properties.includes('thrown') ? 'ranged' : 'mainHand';
    if (def.kind === 'shield') return 'offHand';
    if (def.kind === 'ammo') return 'ammo';
    if (def.kind === 'armor' && def.armor) return def.armor.slot as EquipSlot;
    return null;
  }

  private slotCompatible(def: ItemDef, slot: EquipSlot): boolean {
    switch (slot) {
      // Fix round 1, issue 5 (probe D): a ranged weapon could previously be equipped into mainHand *and*
      // ranged at once, double-counting it for combat. `thrown` weapons (sling) are hand-held either way.
      case 'mainHand': return def.kind === 'weapon' && (!def.weapon?.range || def.weapon.properties.includes('thrown'));
      case 'ranged': return def.kind === 'weapon' && !!def.weapon?.range;
      case 'ammo': return def.kind === 'ammo';
      case 'offHand': return def.kind === 'shield' || (def.kind === 'armor' && def.armor?.slot === 'offHand');
      case 'head': case 'body': case 'feet': return def.kind === 'armor' && def.armor?.slot === slot;
      default: return false;
    }
  }

  equip(id: EntityId, instanceId: string, slot?: string): boolean {
    return this.equipInternal(id, instanceId, slot, true);
  }

  /** `checkEra` is false only for authored starting kits / NpcDef equipment (`createPlayer`/`createCharacter`)
   *  — content the builder placed deliberately shouldn't be blocked by the current chapter; only a live,
   *  player-driven `equip()` call is era-gated. */
  private equipInternal(id: EntityId, instanceId: string, slot: string | undefined, checkEra: boolean): boolean {
    const inv = this.world.get(id, Inventory);
    if (!inv) return false;
    const inst = inv.items.find((i) => i.instanceId === instanceId);
    if (!inst) return false;
    const def = this.content.items.get(inst.defId);
    if (!def) return false;
    // Fix round 1, issue 8 (probe K): `item.langspiess`/`item.langschwert` carry `eraFrom` but nothing
    // enforced it — the 15th-c. pike was equippable in the 1291 prologue.
    if (checkEra && def.eraFrom && chapterIndex(def.eraFrom) > chapterIndex(this.state().chapter)) return false;
    const eq = this.world.get(id, Equipment) ?? this.world.add(id, Equipment, {});
    const targetSlot = (slot as EquipSlot | undefined) ?? this.inferSlot(def) ?? undefined;
    if (!targetSlot || !this.slotCompatible(def, targetSlot)) return false;
    if (targetSlot === 'ammo') {
      // Fix round 1, issue 5: ammo must match the currently-equipped ranged weapon's `weapon.ammo`, so
      // bolts can no longer be equipped onto a bow (probe D).
      const rangedInst = eq.ranged ? inv.items.find((i) => i.instanceId === eq.ranged) : undefined;
      const rangedDef = rangedInst ? this.content.items.get(rangedInst.defId) : undefined;
      if (!rangedDef?.weapon?.ammo || rangedDef.weapon.ammo !== def.id) return false;
    }
    if (targetSlot === 'offHand') {
      const mainInst = eq.mainHand ? inv.items.find((i) => i.instanceId === eq.mainHand) : undefined;
      const mainDef = mainInst ? this.content.items.get(mainInst.defId) : undefined;
      if (mainDef?.weapon?.hands === 2) return false;
    }
    if (targetSlot === 'mainHand' && def.weapon?.hands === 2 && eq.offHand) {
      delete eq.offHand;
      this.bus.emit('equipped', id, 'offHand', null); // fix round 1, issue 14 (probe H): UI must hear the auto-clear
    }
    // Fix round 1, issue 5 (probe D): an item instance can only occupy one slot at a time — clear any other
    // slot it was sitting in before writing it into the new one.
    for (const s of Object.keys(eq) as EquipSlot[]) {
      if (s !== targetSlot && eq[s] === instanceId) {
        delete eq[s];
        this.bus.emit('equipped', id, s, null);
      }
    }
    // Swapping to a ranged weapon with different ammo drops the now-mismatched ammo (fix round 1, issue 5).
    if (targetSlot === 'ranged' && eq.ammo) {
      const ammoInst = inv.items.find((i) => i.instanceId === eq.ammo);
      const ammoDef = ammoInst ? this.content.items.get(ammoInst.defId) : undefined;
      if (def.weapon?.ammo !== ammoDef?.id) {
        delete eq.ammo;
        this.bus.emit('equipped', id, 'ammo', null);
      }
    }
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

  private newInstanceId(): string {
    // Fix round 1, issue 2: no owner in the id, no in-memory counter — see PartyStateC.nextItemSeq above.
    const s = this.state();
    return `item-${s.nextItemSeq++}`;
  }

  addItem(id: EntityId, defId: string, qty = 1): ItemInstance {
    if (qty <= 0) qty = 1; // fix round 1, issue 11: reject/clamp a nonsensical qty rather than corrupt state
    const def = this.content.items.get(defId);
    if (!def) {
      // Fix round 2, issue 4: a misspelt/unknown defId used to still mint a nameless, weightless "phantom"
      // instance after warning. Refuse outright — nothing is added to the inventory.
      console.warn(`[party] addItem: unknown item def "${defId}"; nothing granted`);
      return { instanceId: '', defId, qty: 0 };
    }
    const inv = this.world.get(id, Inventory) ?? this.world.add(id, Inventory, {});
    // Fix round 1, issue 8: granting era-gated loot is allowed (it might be a quest reward for later), but
    // it will refuse to *equip* until the chapter catches up — see equip(). Fix round 2, issue 5: this is
    // expected/routine (e.g. a Chapter-2 Langspiess handed out early), not a real problem — console.debug,
    // not console.warn, so it doesn't turn a legitimate harness scenario yellow.
    if (def.eraFrom && chapterIndex(def.eraFrom) > chapterIndex(this.state().chapter)) {
      console.debug(`[party] addItem: "${defId}" is era-gated (${def.eraFrom}); granted, but equip() will refuse it until then`);
    }
    const stackable = STACKABLE_KINDS.has(def.kind);
    if (stackable) {
      const existing = inv.items.find((i) => i.defId === defId);
      if (existing) {
        existing.qty += qty;
        this.invalidate(id);
        this.bus.emit('item-added', id, existing);
        return existing;
      }
      const inst: ItemInstance = { instanceId: this.newInstanceId(), defId, qty, condition: 1 };
      inv.items.push(inst);
      this.invalidate(id);
      this.bus.emit('item-added', id, inst);
      return inst;
    }
    // Fix round 1, issue 11 (probe C): a non-stackable kind (weapon/armor/shield) must never collapse
    // several units into one instance with `qty > 1` — each has its own `condition`, and `qty` on a
    // "unique" item instance would corrupt equip/transfer bookkeeping. Mint one instance per unit.
    let last!: ItemInstance;
    for (let i = 0; i < qty; i++) {
      last = { instanceId: this.newInstanceId(), defId, qty: 1, condition: 1 };
      inv.items.push(last);
    }
    this.invalidate(id);
    this.bus.emit('item-added', id, last);
    return last;
  }

  removeItem(id: EntityId, defId: string, qty = 1): boolean {
    if (qty <= 0) return false;
    const inv = this.world.get(id, Inventory);
    if (!inv) return false;
    // Fix round 1, issue 4 (probe B): removing more than is held used to delete everything present and
    // still return false — a failed quest hand-in ate the player's items. Refuse up front instead.
    if (this.countItem(id, defId) < qty) return false;
    const eq = this.world.get(id, Equipment);
    let remaining = qty;
    for (let i = inv.items.length - 1; i >= 0 && remaining > 0; i--) {
      const it = inv.items[i];
      if (it.defId !== defId) continue;
      if (it.qty <= remaining) {
        remaining -= it.qty;
        inv.items.splice(i, 1);
        if (eq) {
          for (const s of Object.keys(eq) as EquipSlot[]) {
            if (eq[s] === it.instanceId) {
              delete eq[s];
              this.bus.emit('equipped', id, s, null); // fix round 1, issue 4/14: UI must hear the auto-unequip
            }
          }
        }
      } else {
        it.qty -= remaining;
        remaining = 0;
      }
    }
    this.invalidate(id);
    this.bus.emit('item-removed', id, defId, qty);
    return true;
  }

  countItem(id: EntityId, defId: string): number {
    const inv = this.world.get(id, Inventory);
    if (!inv) return 0;
    return inv.items.filter((i) => i.defId === defId).reduce((a, i) => a + i.qty, 0);
  }

  transfer(from: EntityId, to: EntityId, instanceId: string, qty?: number): boolean {
    // Fix round 1, issue 13 (probe E): transferring to/from a dead or unknown entity used to throw
    // ("ECS: entity 999 is not alive") instead of returning false as the interface promises.
    if (!this.world.isAlive(from) || !this.world.isAlive(to)) return false;
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
      if (eq) {
        for (const s of Object.keys(eq) as EquipSlot[]) {
          if (eq[s] === instanceId) {
            delete eq[s];
            this.bus.emit('equipped', from, s, null);
          }
        }
      }
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
    const newInst: ItemInstance = { instanceId: this.newInstanceId(), defId: item.defId, qty: moveQty, condition: item.condition };
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
      ch.morale = ch.moraleMax; // fix round 1, issue 6: a night's sleep resets morale too (§5.3: the second resource)
      this.bus.emit('hp-changed', id, ch.hp, ch.hpMax);
    }
    this.clock?.advanceHours(hours);
  }

  applyChapter(chapter: string): void {
    this.state().chapter = chapter; // fix round 1, issue 8: era gating needs to know "now"
    for (const id of this.getParty()) {
      const pm = this.world.get(id, PartyMember);
      if (!pm || pm.control !== 'companion') continue;
      const skillsC = this.world.get(id, Skills);
      if (!skillsC) continue;
      const top3 = Object.entries(skillsC.levels)
        .sort((a, b) => b[1].level - a[1].level)
        .slice(0, 3)
        .map(([k]) => k);
      const pending = top3
        .map((skill) => this.bumpSkillLevel(id, skill, 5))
        .filter((r): r is { skill: SkillId; newLevel: number; perkIds: string[] } => r !== null);
      // Fix round 2, issue 2: recompute BEFORE emitting (see bumpSkillLevel's doc comment above).
      this.recomputeCharacterLevel(id);
      for (const r of pending) {
        this.bus.emit('level-up', id, r.skill, r.newLevel);
        for (const perkId of r.perkIds) this.bus.emit('perk-available', id, perkId);
      }
      this.invalidate(id);
    }
  }

  // ---------------- formation ----------------

  formation(): 'line' | 'wedge' | 'haufen' | 'skirmish' {
    return this.state().formation;
  }

  setFormation(f: 'line' | 'wedge' | 'haufen' | 'skirmish'): void {
    this.state().formation = f;
  }

  // ---------------- derived stats ----------------

  /** Fix round 1, issue 3: `PartyService.invalidate(id?)` is now public (core added it to the interface) —
   *  other modules call it after editing `Character`/`Equipment`/`Perks`/`Inventory` directly. Omitting `id`
   *  clears the whole cache (used on `'loaded'`, and available to any caller that needs a hard reset). */
  invalidate(id?: EntityId): void {
    if (id === undefined) {
      this.derivedCache.clear();
      return;
    }
    this.derivedCache.delete(id);
  }

  /** A cheap fingerprint of everything `derived()` reads, so a cached entry is only trusted when nothing
   *  relevant has changed — a safety net for direct component edits that skip `invalidate()` (fix round 1,
   *  issue 3, probe G: `Character.attributes.agility = 20` used to leave `defense` stale forever). */
  private fingerprint(id: EntityId): string {
    const ch = this.world.get(id, Character);
    const eq = this.world.get(id, Equipment);
    const perksC = this.world.get(id, Perks);
    const inv = this.world.get(id, Inventory);
    const skillsC = this.world.get(id, Skills);
    const a = ch
      ? `${ch.attributes.strength},${ch.attributes.agility},${ch.attributes.endurance},${ch.attributes.wits},${ch.attributes.presence},${ch.level},${ch.fatigue},${ch.down ? 1 : 0}`
      : '';
    const e = eq ? (Object.keys(eq) as EquipSlot[]).sort().map((k) => `${k}=${eq[k]}`).join(';') : '';
    const p = perksC ? perksC.ids.slice().sort().join(';') : '';
    const items = inv ? inv.items.map((i) => `${i.defId}x${i.qty}`).sort().join(';') : '';
    const skills = skillsC ? Object.keys(skillsC.levels).sort().map((k) => `${k}:${skillsC.levels[k].level}`).join(';') : '';
    return `${a}|${e}|${p}|${items}|${skills}`;
  }

  derived(id: EntityId): DerivedStats {
    const fp = this.fingerprint(id);
    const cached = this.derivedCache.get(id);
    if (cached && cached.fp === fp) return cached.stats;

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
    const ammo = equipped.find((e) => e.slot === 'ammo');

    const result: DerivedStats = {
      defense,
      initiativeBonus: modifier(ch.attributes.agility) + (perkMods['initiative'] ?? 0),
      speedM: speed,
      carryKg,
      encumbered,
      attackBonus,
      soak,
      moraleBonus: perkMods['morale'] ?? 0,
      // leadershipRadius/moraleBonus are offered for combat's Rally/formation math (ARCHITECTURE §5.3) but
      // nothing there consumes them yet — not a bug, just noting they are offered, not required (minor note).
      leadershipRadius: 2 + Math.floor(leadershipLevel / 25),
      weapon: mainHand ? { defId: mainHand.def.id, instanceId: mainHand.instance.instanceId } : null,
      ranged: ranged ? { defId: ranged.def.id, instanceId: ranged.instance.instanceId } : null,
      shield: shield ? { defId: shield.def.id, instanceId: shield.instance.instanceId } : null,
      ammo: ammo ? { defId: ammo.def.id, instanceId: ammo.instance.instanceId, qty: ammo.instance.qty } : null,
      perkMods,
    };
    this.derivedCache.set(id, { fp, stats: result });
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
