import { describe, it, expect, beforeEach } from 'vitest';
import { World } from '@core/ecs';
import { ContentRegistry } from '@core/content';
import { Character, Equipment, Inventory, Skills } from '@core/components';
import { register as registerSkills } from '@content/skills';
import { register as registerPerks } from '@content/perks';
import { register as registerItems } from '@content/items';
import { register as registerArchetypes } from '@content/archetypes';
import { PartyServiceImpl, type PartyHost } from './index';
import { applySkillXp, xpToNext, hpMax, carryCapacityKg, characterLevel, attributePointsEarned } from './rules';
import type { PlayerCreation } from '@core/services';
import type { Canton } from '@core/schemas';

function makeContent(): ContentRegistry {
  const c = new ContentRegistry();
  registerSkills(c);
  registerPerks(c);
  registerItems(c);
  registerArchetypes(c);
  return c;
}

function makeService(content: ContentRegistry): { world: World; svc: PartyServiceImpl } {
  const world = new World();
  const host: PartyHost = { world, content };
  const svc = new PartyServiceImpl(host);
  return { world, svc };
}

const content = makeContent();

describe('content registration', () => {
  it('registers 19 skills and has zero cross-reference problems for party kinds', () => {
    expect(content.skills.size).toBe(19);
    const problems = content.validate();
    const relevant = problems.filter((p) => /^(item|npc|archetype|perk)/.test(p));
    expect(relevant).toEqual([]);
  });

  it('every weapon item references an existing skill', () => {
    for (const it of content.items.values()) {
      if (!it.weapon) continue;
      expect(content.skills.has(it.weapon.skill), `${it.id} -> unknown skill ${it.weapon.skill}`).toBe(true);
    }
  });

  it('every perk references an existing skill and every item/perk carries historical+note', () => {
    for (const p of content.perks.values()) {
      expect(content.skills.has(p.skill), `perk ${p.id} -> unknown skill ${p.skill}`).toBe(true);
      expect(p.historical).toBeDefined();
      expect(p.note.length).toBeGreaterThan(0);
    }
    for (const it of content.items.values()) {
      expect(it.historical).toBeDefined();
      expect(it.note.length).toBeGreaterThan(0);
    }
  });

  it('has at least 3 perks for every weapon/armor/leadership/athletics skill, >=2 for others', () => {
    const majorGroups = ['halberd', 'spear', 'sword', 'dagger', 'axe-mace', 'shield', 'crossbow', 'throwing', 'unarmed', 'armor-light', 'armor-heavy', 'leadership', 'athletics'];
    const counts = new Map<string, number>();
    for (const p of content.perks.values()) counts.set(p.skill, (counts.get(p.skill) ?? 0) + 1);
    for (const s of majorGroups) expect(counts.get(s) ?? 0, `skill ${s}`).toBeGreaterThanOrEqual(3);
    for (const s of content.skills.keys()) {
      if (majorGroups.includes(s)) continue;
      expect(counts.get(s) ?? 0, `skill ${s}`).toBeGreaterThanOrEqual(2);
    }
  });

  it('archetypes cover the required roster', () => {
    const required = [
      'peasant', 'herder', 'fisher', 'saeumer', 'militia-spear', 'militia-halberd', 'militia-crossbow', 'elder',
      'monk', 'merchant', 'innkeeper', 'habsburg-footman', 'habsburg-crossbowman', 'habsburg-sergeant',
      'habsburg-knight', 'habsburg-squire', 'bailiff-guard', 'abbey-man-at-arms', 'toll-collector', 'raubritter',
      'boatman', 'child', 'woman-peasant',
    ];
    for (const id of required) expect(content.archetypes.has(id), id).toBe(true);
  });
});

describe('rules: xp curve and derived math', () => {
  it('xpToNext grows with level (~level^1.6)', () => {
    expect(xpToNext(0)).toBe(20);
    expect(xpToNext(24)).toBeGreaterThan(xpToNext(10));
    expect(xpToNext(50)).toBeGreaterThan(xpToNext(24));
  });

  it('applySkillXp loops multiple level-ups and reports crossed perk thresholds', () => {
    // enough xp to blow past level 25 from level 0
    let totalNeeded = 0;
    for (let l = 0; l < 25; l++) totalNeeded += xpToNext(l);
    const result = applySkillXp({ level: 0, xp: 0 }, totalNeeded);
    expect(result.level).toBe(25);
    expect(result.xp).toBe(0);
    expect(result.levelsGained).toBe(25);
    expect(result.perksCrossed).toEqual([25]);
  });

  it('hpMax floors at 6 and grows with level/endurance', () => {
    expect(hpMax(1, 0)).toBeGreaterThanOrEqual(6);
    expect(hpMax(14, 5)).toBeGreaterThan(hpMax(10, 1));
  });

  it('carry capacity scales with strength', () => {
    expect(carryCapacityKg(10)).toBe(45);
    expect(carryCapacityKg(20)).toBeGreaterThan(carryCapacityKg(10));
  });
});

describe('PartyServiceImpl', () => {
  let world: World;
  let svc: PartyServiceImpl;

  beforeEach(() => {
    ({ world, svc } = makeService(content));
  });

  it('grantSkillXp levels up and emits level-up + perk-available at threshold', () => {
    const id = svc.createPlayer(playerCreation({ origin: 'unterwalden' }));
    let leveledEvents: unknown[] = [];
    let perkEvents: string[] = [];
    svc.on('level-up', (entity, skill, level) => leveledEvents.push([entity, skill, level]));
    svc.on('perk-available', (entity, perkId) => perkEvents.push(perkId));
    // spiess (spear) starts at level 15 for unterwalden origin; push it well past 25
    let needed = 0;
    for (let l = 15; l < 25; l++) needed += xpToNext(l);
    const res = svc.grantSkillXp(id, 'spear', needed);
    expect(res.leveled).toBe(true);
    expect(res.newLevel).toBe(25);
    expect(leveledEvents.length).toBeGreaterThan(0);
    expect(perkEvents).toContain('perk.spear-25');
  });

  it('derived(): a knight has higher defense, more soak and lower speed than a peasant', () => {
    const peasantId = svc.createCharacter(content.archetypes.get('peasant')!);
    const knightId = svc.createCharacter(content.archetypes.get('habsburg-knight')!);
    const peasant = svc.derived(peasantId);
    const knight = svc.derived(knightId);
    expect(knight.defense).toBeGreaterThan(peasant.defense);
    expect(knight.soak.cut).toBeGreaterThan(peasant.soak.cut);
    expect(knight.soak.thrust).toBeGreaterThan(peasant.soak.thrust);
    expect(knight.speedM).toBeLessThan(peasant.speedM);
    expect(knight.shield).not.toBeNull();
  });

  it('equipping a two-handed weapon clears offHand', () => {
    const id = svc.createCharacter(content.archetypes.get('militia-spear')!);
    // militia-spear starts with buckler in offHand
    expect(svc.derived(id).shield).not.toBeNull();
    const halbarte = svc.addItem(id, 'item.halbarte', 1);
    const ok = svc.equip(id, halbarte.instanceId, 'mainHand');
    expect(ok).toBe(true);
    const eq = world.require(id, Equipment);
    expect(eq.mainHand).toBe(halbarte.instanceId);
    expect(eq.offHand).toBeUndefined();
  });

  it('flags encumbrance once carried weight exceeds capacity', () => {
    const id = svc.createPlayer(playerCreation({ strength: 10 }));
    const before = svc.derived(id);
    expect(before.encumbered).toBe(false);
    // carry capacity at str 10 is 45kg; add heavy stuff well past it
    for (let i = 0; i < 6; i++) svc.addItem(id, 'item.coat-of-plates', 1);
    const after = svc.derived(id);
    expect(after.encumbered).toBe(true);
    expect(after.speedM).toBeLessThan(before.speedM);
  });

  it('damage sets down at 0 hp (never below), heal clears it', () => {
    const id = svc.createCharacter(content.archetypes.get('peasant')!);
    const ch = world.require(id, Character);
    const big = ch.hpMax + 50;
    const res = svc.damage(id, big);
    expect(res.hp).toBe(0);
    expect(res.down).toBe(true);
    expect(ch.hp).toBe(0);
    svc.heal(id, 5);
    expect(ch.down).toBe(false);
    expect(ch.hp).toBe(5);
  });

  it('rest() heals hp, drains fatigue and advances the clock', () => {
    let advanced = 0;
    const w = new World();
    const host: PartyHost = { world: w, content, clock: { calendar: () => ({ year: 1291 }), advanceHours: (h) => { advanced += h; } } };
    const s = new PartyServiceImpl(host);
    const id = s.createPlayer(playerCreation());
    s.damage(id, 10);
    const ch = w.require(id, Character);
    ch.fatigue = 40;
    const hpBefore = ch.hp;
    s.rest(4);
    expect(ch.hp).toBeGreaterThan(hpBefore);
    expect(ch.fatigue).toBeLessThan(40);
    expect(advanced).toBe(4);
  });

  it.each(['saeumer', 'herder', 'fisher', 'hunter', 'smith', 'novice'] as const)('createPlayer(%s) grants the background kit', (background) => {
    const id = svc.createPlayer(playerCreation({ background }));
    const inv = world.require(id, Inventory);
    expect(inv.items.length).toBeGreaterThan(0);
    const eq = world.require(id, Equipment);
    expect(eq.mainHand || eq.ranged).toBeTruthy();
  });

  it.each([
    ['uri', 'alpine', 'crossbow'],
    ['schwyz', 'halberd', 'leadership'],
    ['unterwalden', 'spear', 'athletics'],
  ] as const)('createPlayer origin %s grants +5 to %s and %s', (origin, skillA, skillB) => {
    const id = svc.createPlayer(playerCreation({ origin }));
    expect(svc.skillLevel(id, skillA)).toBe(15);
    expect(svc.skillLevel(id, skillB)).toBe(15);
  });

  it('createPlayer wires the core components the interface promises', () => {
    const id = svc.createPlayer(playerCreation());
    expect(svc.getPlayer()).toBe(id);
    expect(svc.getParty()).toContain(id);
    expect(svc.isMember(id)).toBe(true);
    expect(world.has(id, Skills)).toBe(true);
  });

  it('spendAttributePoint consumes a point on Character.unspentAttributePoints, bumps the attribute and rescales hpMax; refuses at zero points or the attribute cap', () => {
    const id = svc.createCharacter(content.archetypes.get('peasant')!);
    const ch = world.require(id, Character);
    ch.unspentAttributePoints = 3;
    const enduranceBefore = ch.attributes.endurance;
    const hpMaxBefore = ch.hpMax;

    // the attribute *modifier* (rules.modifier) only steps every 2 points, so spend twice to
    // guarantee crossing a modifier boundary regardless of the archetype's starting parity —
    // this exercises hpMax's ratio-preserving rescale (rules.hpMax depends on endurance).
    expect(svc.spendAttributePoint(id, 'endurance')).toBe(true);
    expect(svc.spendAttributePoint(id, 'endurance')).toBe(true);
    expect(ch.attributes.endurance).toBe(enduranceBefore + 2);
    expect(ch.unspentAttributePoints).toBe(1);
    expect(ch.hpMax).toBeGreaterThan(hpMaxBefore);
    // started fully healed, so a ratio-preserving rescale keeps the bar full
    expect(ch.hp).toBe(ch.hpMax);

    ch.attributes.wits = 20;
    expect(svc.spendAttributePoint(id, 'wits')).toBe(false); // capped at 20 — refused, point kept
    expect(ch.unspentAttributePoints).toBe(1);

    expect(svc.spendAttributePoint(id, 'agility')).toBe(true);
    expect(ch.unspentAttributePoints).toBe(0);
    expect(svc.spendAttributePoint(id, 'agility')).toBe(false); // no points left
  });

  it('character creation and skill level-ups grant Character.unspentAttributePoints (+1 every 3 character levels)', () => {
    const id = svc.createCharacter(content.archetypes.get('peasant')!);
    const ch = world.require(id, Character);
    // every skill defaults to level 10 (19 skills) -> a real starting character level, not always 0
    expect(ch.level).toBe(characterLevel(19 * 10));
    expect(ch.unspentAttributePoints).toBe(attributePointsEarned(ch.level));

    const before = ch.unspentAttributePoints;
    let needed = 0;
    for (let l = 10; l < 90; l++) needed += xpToNext(l);
    svc.grantSkillXp(id, 'unarmed', needed);
    expect(ch.level).toBeGreaterThan(4);
    expect(ch.unspentAttributePoints).toBeGreaterThan(before);
    expect(ch.unspentAttributePoints).toBe(attributePointsEarned(ch.level));
  });
});

function playerCreation(overrides: { origin?: Canton; background?: PlayerCreation['background']; strength?: number } = {}): PlayerCreation {
  return {
    givenName: 'Kuoni', familyName: 'Imhof',
    origin: overrides.origin ?? 'uri',
    attributes: { strength: overrides.strength ?? 12, agility: 12, endurance: 12, wits: 10, presence: 10 },
    background: overrides.background ?? 'saeumer',
  };
}
