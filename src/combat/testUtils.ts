/**
 * Test-only fixtures. NOT a *.test.ts file (vitest won't collect it), imported by combat/*.test.ts.
 * `PartyServiceImpl` in src/party is not importable here (cross-module import rule), so this is a minimal
 * fake `PartyServiceLike` (per BUILDER_RULES.md) backed by the same core ECS components and real content.
 */
import { World, type EntityId } from '@core/ecs';
import { ContentRegistry } from '@core/content';
import { Character, Equipment, Faction, Inventory, Name, Perks, Renderable, Skills } from '@core/components';
import type { Attributes, EquipSlot, NpcDef } from '@core/schemas';
import type { DerivedStats } from '@core/services';
import { modifier } from '@core/math';
import { loadContent } from '@content/index';
import type { PartyServiceLike } from './engine';

export function makeTestContent(): ContentRegistry {
  const c = new ContentRegistry();
  loadContent(c);
  return c;
}

export function makeTestNpc(over: Partial<NpcDef> & { id: string; attributes: Attributes }): NpcDef {
  return {
    id: over.id, name: over.name ?? over.id, faction: over.faction ?? 'none', home: '', role: over.role ?? 'enemy',
    archetype: over.archetype ?? 'militia', attributes: over.attributes, skills: over.skills, equipment: over.equipment,
    modelId: over.modelId, historical: 'invented', note: 'test fixture', description: 'test fixture',
  };
}

export class FakePartyService implements PartyServiceLike {
  private party: EntityId[] = [];
  private id = 1000;

  constructor(private world: World, private content: ContentRegistry) {}

  createCharacter(def: NpcDef): EntityId {
    const id = this.world.create(def.id + '#' + this.id++);
    this.world.add(id, Name, { id: def.id, display: def.name });
    const levels: Record<string, { level: number; xp: number }> = {};
    for (const s of this.content.skills.values()) levels[s.id] = { level: def.skills?.[s.id] ?? 10, xp: 0 };
    this.world.add(id, Skills, { levels });
    const endurance = def.attributes.endurance;
    const hpMax = 10 + endurance * 3;
    this.world.add(id, Character, {
      attributes: { ...def.attributes }, hp: hpMax, hpMax, morale: 60, moraleMax: 60, fatigue: 0,
      archetype: def.archetype, level: 1, down: false, unspentAttributePoints: 0,
    });
    this.world.add(id, Perks, { ids: [] });
    this.world.add(id, Equipment, {});
    this.world.add(id, Inventory, { items: [], pfennig: 0, capacityKg: 40 });
    this.world.add(id, Faction, { factionId: def.faction });
    this.world.add(id, Renderable, { modelId: def.modelId ?? `char.${def.archetype}`, visible: true });
    const inv = this.world.require(id, Inventory);
    const eq = this.world.require(id, Equipment);
    for (const [slot, defId] of Object.entries(def.equipment ?? {})) {
      if (!defId) continue;
      const instanceId = `${id}-${slot}`;
      inv.items.push({ instanceId, defId, qty: 1, condition: 1 });
      eq[slot as EquipSlot] = instanceId;
    }
    return id;
  }

  addToParty(id: EntityId): void { this.party.push(id); }
  getPlayer(): EntityId | null { return this.party[0] ?? null; }
  getParty(): EntityId[] { return this.party; }

  private findItem(id: EntityId, slot: string) {
    const eq = this.world.get(id, Equipment) ?? {};
    const inv = this.world.get(id, Inventory);
    const instId = (eq as Record<string, string | undefined>)[slot];
    if (!instId || !inv) return undefined;
    const inst = inv.items.find((i) => i.instanceId === instId);
    return inst ? this.content.items.get(inst.defId) : undefined;
  }

  derived(id: EntityId): DerivedStats {
    const ch = this.world.require(id, Character);
    const skillsC = this.world.get(id, Skills);
    const perksC = this.world.get(id, Perks);
    const perkMods: Record<string, number> = {};
    for (const pid of perksC?.ids ?? []) {
      const p = this.content.perks.get(pid);
      if (!p) continue;
      for (const [k, v] of Object.entries(p.modifiers ?? {})) perkMods[k] = (perkMods[k] ?? 0) + (v ?? 0);
    }
    const mainHand = this.findItem(id, 'mainHand');
    const ranged = this.findItem(id, 'ranged');
    const shield = this.findItem(id, 'offHand');
    const ammo = this.findItem(id, 'ammo');
    const soak = { cut: 0, thrust: 0, blunt: 0 };
    for (const slot of ['head', 'body', 'feet', 'offHand']) {
      const it = this.findItem(id, slot);
      if (it?.armor) { soak.cut += it.armor.soak.cut; soak.thrust += it.armor.soak.thrust; soak.blunt += it.armor.soak.blunt; }
    }
    soak.cut += perkMods['soak.cut'] ?? 0; soak.thrust += perkMods['soak.thrust'] ?? 0; soak.blunt += perkMods['soak.blunt'] ?? 0;
    let defense = 10 + modifier(ch.attributes.agility) + (perkMods['defense'] ?? 0);
    if (shield?.armor?.defense) defense += shield.armor.defense;
    let speedDelta = perkMods['speedM'] ?? 0;
    const body = this.findItem(id, 'body');
    if (body?.armor?.speedPenaltyM) speedDelta += body.armor.speedPenaltyM;
    const attackBonus: Record<string, number> = {};
    for (const s of this.content.skills.values()) {
      const lvl = skillsC?.levels[s.id]?.level ?? 0;
      attackBonus[s.id] = Math.floor(lvl / 10) + modifier(ch.attributes[s.attribute]) + (perkMods[`attack.${s.id}`] ?? 0);
    }
    return {
      defense, initiativeBonus: modifier(ch.attributes.agility) + (perkMods['initiative'] ?? 0),
      speedM: Math.max(4.5, 9 + speedDelta), carryKg: 40, encumbered: false, attackBonus, soak,
      moraleBonus: perkMods['morale'] ?? 0, leadershipRadius: 2,
      weapon: mainHand ? { defId: mainHand.id, instanceId: 'w' } : null,
      ranged: ranged ? { defId: ranged.id, instanceId: 'r' } : null,
      shield: shield ? { defId: shield.id, instanceId: 's' } : null,
      ammo: ammo ? { defId: ammo.id, instanceId: 'a', qty: 20 } : null,
      perkMods,
    };
  }

  skillLevel(id: EntityId, skill: string): number {
    return this.world.get(id, Skills)?.levels[skill]?.level ?? 0;
  }
  hasPerk(id: EntityId, perk: string): boolean {
    return !!this.world.get(id, Perks)?.ids.includes(perk);
  }
  grantPerk(id: EntityId, perk: string): void {
    this.world.require(id, Perks).ids.push(perk);
  }
  damage(id: EntityId, amount: number): { hp: number; down: boolean } {
    const ch = this.world.require(id, Character);
    ch.hp = Math.max(0, ch.hp - amount);
    if (ch.hp <= 0) ch.down = true;
    return { hp: ch.hp, down: ch.down };
  }
  heal(id: EntityId, amount: number): void {
    const ch = this.world.require(id, Character);
    ch.hp = Math.min(ch.hpMax, ch.hp + amount);
  }
  grantSkillXp(): { leveled: boolean; newLevel?: number } {
    return { leveled: false };
  }
}
