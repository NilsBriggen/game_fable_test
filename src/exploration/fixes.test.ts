/** Regression tests for the wave-2 exploration critic issues (overlaps, companions, dialogue fallback, discovery, sleep, boats). */
import { describe, it, expect, vi } from 'vitest';
import { Object3D } from 'three';
import { World } from '@core/ecs';
import { ContentRegistry } from '@core/content';
import { ServiceRegistry } from '@core/services';
import { EventBus } from '@core/events';
import { Transform, Renderable, Npc, PartyMember, MeshRef, Interactable, Character, Faction, Poi } from '@core/components';
import type { NpcDef } from '@core/schemas';
import type { PartyService, WorldService, ExplorationEvents } from '@core/services';
import { register as registerGeography } from '@content/geography';
import { register as registerSkills } from '@content/skills';
import { register as registerItems } from '@content/items';
import { register as registerArchetypes } from '@content/archetypes';
import { register as registerPois } from '@content/pois';
import { register as registerNpcs } from '@content/npcs';
import { register as registerDialogues } from '@content/dialogues';
import { generateLayout } from './layout';
import { SPACING } from './colliders';
import { NpcSystem } from './npc';
import { PoiSystem } from './poi';
import { spawnBoatTravel } from './interact';

function content(): ContentRegistry {
  const c = new ContentRegistry();
  registerGeography(c); registerSkills(c); registerItems(c); registerArchetypes(c); registerPois(c); registerNpcs(c); registerDialogues(c);
  return c;
}

function makeNpcSystem(c = content()) {
  const world = new World();
  const party = {
    createCharacter(def: NpcDef) {
      const id = world.create(def.id);
      world.add(id, Character, {});
      world.add(id, Faction, { factionId: def.faction });
      world.add(id, Transform, { x: 0, y: 0, z: 0, yaw: 0 });
      world.add(id, Renderable, { modelId: def.modelId ?? `char.${def.archetype}`, visible: true });
      world.add(id, Npc, { defId: def.id, home: def.home, schedule: def.schedule ?? [], frozen: true, generic: def.role === 'generic' });
      return id;
    },
  } as unknown as PartyService;
  const ws = { heightAt: () => 0, isWater: () => false, hasModel: () => true, spawnModel: () => new Object3D() } as unknown as WorldService;
  const dyn = new Object3D();
  const startEncounter = vi.fn();
  return { world, c, sys: new NpcSystem(world, c, party, ws, dyn, startEncounter), dyn, startEncounter };
}

describe('layout: no interpenetrating buildings', () => {
  it('a town on a peninsula (water in 7 of 8 directions beyond 60 m) has zero overlapping footprints', () => {
    const probe = { heightAt: () => 0, isWater: (x: number, z: number) => Math.hypot(x, z) > 60 && !(z > 0 && Math.abs(x) < 20) };
    const layout = generateLayout({ id: 'poi.test-town', kind: 'town', x: 0, z: 0, population: { merchant: 12, peasant: 20 } }, probe);
    let overlaps = 0;
    for (let i = 0; i < layout.length; i++) for (let j = i + 1; j < layout.length; j++) {
      const a = layout[i], b = layout[j];
      const ra = SPACING[a.modelId] ?? 0, rb = SPACING[b.modelId] ?? 0;
      if (ra && rb && Math.hypot(a.x - b.x, a.z - b.z) < ra + rb - 0.01) overlaps++;
    }
    expect(overlaps).toBe(0);
    expect(layout.filter((m) => m.modelId === 'house.stone').length).toBeGreaterThanOrEqual(8);
    for (const m of layout) expect(probe.isWater(m.x, m.z), m.modelId).toBe(false);
  });
  it('a village never places a house on a 45° slope', () => {
    const probe = { heightAt: (x: number, z: number) => (x > 10 ? (x - 10) * 1.0 : 0) + z * 0, isWater: () => false };
    const layout = generateLayout({ id: 'poi.test-village', kind: 'village', x: 0, z: 0, population: { peasant: 12 } }, probe);
    for (const m of layout) if (m.modelId === 'house.blockbau') expect(Math.abs(probe.heightAt(m.x + 3, m.z) - probe.heightAt(m.x, m.z))).toBeLessThan(1.6);
  });
});

describe('NPC system fixes', () => {
  it('a recruited companion survives populate() for the next chapter', () => {
    const { world, sys } = makeNpcSystem();
    sys.populate('prologue-1291');
    let jost = -1;
    world.each(Npc, (id, n) => { if (n.defId === 'npc.jost-imhof') jost = id; });
    expect(jost).toBeGreaterThan(0);
    world.add(jost, PartyMember, { slot: 1, control: 'companion' });
    sys.populate('ch1-1307');
    expect(world.isAlive(jost)).toBe(true);
    let copies = 0;
    world.each(Npc, (_id, n) => { if (n.defId === 'npc.jost-imhof') copies++; });
    expect(copies).toBe(1);
  });
  it('every talk interactable points at a dialogue that exists', () => {
    const { world, c, sys } = makeNpcSystem();
    sys.populate('ch1-1307');
    const missing = new Set<string>();
    for (const id of world.query(Interactable)) {
      const it = world.get(id, Interactable)!;
      if (it.kind === 'talk' && it.dialogueId && !c.dialogues.has(it.dialogueId)) missing.add(it.dialogueId);
    }
    expect([...missing]).toEqual([]);
  });
  it('a sleeping crowd NPC is hidden and not interactable; awake by day', () => {
    const { world, sys } = makeNpcSystem();
    sys.populate('prologue-1291');
    const altdorf = { x: 574, z: 2051 };
    let generic = -1;
    world.each(Npc, (id, n) => { if (generic < 0 && n.generic && n.home === 'poi.altdorf') generic = id; });
    expect(generic).toBeGreaterThan(0);
    for (let i = 0; i < 400; i++) sys.update(1, altdorf, 23.5); // walk home and sleep
    expect(world.get(generic, Interactable)!.enabled).toBe(false);
    expect((world.get(generic, MeshRef)!.object as Object3D).visible).toBe(false);
    for (let i = 0; i < 400; i++) sys.update(1, altdorf, 8);
    expect(world.get(generic, Interactable)!.enabled).toBe(true);
    expect((world.get(generic, MeshRef)!.object as Object3D).visible).toBe(true);
  });
  it('a hostile patrol starts enc.habsburg-patrol at the player position', () => {
    const { world, sys, startEncounter } = makeNpcSystem();
    sys.populate('prologue-1291');
    sys.setHostileHabsburg(true);
    let lead = -1;
    world.each(Npc, (id, n) => { if (lead < 0 && n.defId === 'patrol.kuessnacht-road.0') lead = id; });
    const t = world.get(lead, Transform)!;
    sys.update(0.1, { x: t.x + 1, z: t.z + 1 }, 12);
    sys.update(0.1, { x: t.x + 1, z: t.z + 1 }, 12);
    expect(startEncounter).toHaveBeenCalledWith('enc.habsburg-patrol', expect.objectContaining({ x: expect.any(Number) }));
  });
});

describe('POI fixes', () => {
  it('discoveries survive a repeat spawnPoiEntities (chapter change)', () => {
    const c = content();
    const world = new World();
    const sys = new PoiSystem(world, c, new ServiceRegistry(), new EventBus<ExplorationEvents>());
    sys.spawnPoiEntities();
    sys.discover('poi.ruetli');
    sys.spawnPoiEntities();
    expect(sys.isDiscovered('poi.ruetli')).toBe(true);
    expect(world.count(Poi)).toBe(c.pois.size);
  });
  it('every port gets a boat travel interactable listing the other ports', () => {
    const c = content();
    const world = new World();
    spawnBoatTravel(world, c);
    const travel = world.query(Interactable).filter((id) => world.get(id, Interactable)!.kind === 'travel');
    const ports = [...c.pois.values()].filter((p) => p.kind === 'port');
    expect(travel.length).toBe(ports.length);
    const dest = (world.get(travel[0], Interactable)!.data as { destinations: string[] }).destinations;
    expect(dest.length).toBe(ports.length - 1);
  });
});
