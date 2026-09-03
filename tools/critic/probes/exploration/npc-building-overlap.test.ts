/**
 * Probe for bughunt/exploration.md finding: neither `NpcSystem.spawnNamed()` nor
 * `spawnGenericFromArchetype()` (src/exploration/npc.ts) check the settlement's own building colliders
 * when placing an NPC — only water (and only for the generic path; see npc-water-spawn.test.ts for the
 * named-path gap). `settlements.ts` builds those same colliders from `layout.ts`'s `generateLayout()` for
 * `player.ts`'s movement to collide against, but `npc.ts`'s spawn jitter (`jitterFor`, up to 14 m for
 * generic crowd, 6 m for named NPCs) never consults them, so an NPC can end up standing inside a house/
 * church footprint.
 *
 * This drives the *real* production pipeline for a real content POI (`poi.luzern`, a town — the layout
 * places its chapel/church just 8 m from the POI centre, well inside the generic archetype jitter radius
 * of 14 m): `generateLayout()` + `buildColliders()` (exactly what `settlements.ts` does) for the
 * collider list, and the real `NpcSystem.populate()` for where the generic crowd actually spawns.
 */
import { describe, it, expect } from 'vitest';
import { Object3D } from 'three';
import { World } from '@core/ecs';
import { ContentRegistry } from '@core/content';
import { Transform, Character, Renderable, Npc, Faction } from '@core/components';
import type { NpcDef } from '@core/schemas';
import type { PartyService, WorldService } from '@core/services';
import { register as registerGeography } from '@content/geography';
import { register as registerSkills } from '@content/skills';
import { register as registerItems } from '@content/items';
import { register as registerArchetypes } from '@content/archetypes';
import { register as registerPois } from '@content/pois';
import { register as registerNpcs } from '@content/npcs';
import { generateLayout, type HeightProbe } from '../../../../src/exploration/layout';
import { buildColliders } from '../../../../src/exploration/colliders';
import { NpcSystem } from '../../../../src/exploration/npc';

function content(): ContentRegistry {
  const c = new ContentRegistry();
  registerGeography(c); registerSkills(c); registerItems(c); registerArchetypes(c); registerPois(c); registerNpcs(c);
  return c;
}

describe('bug: NPC spawn placement never checks building colliders', () => {
  it('at least one generic-crowd NPC at poi.luzern spawns inside a building footprint', () => {
    const c = content();
    const poi = c.pois.get('poi.luzern')!;
    expect(poi.kind).toBe('town');

    // Same inputs settlements.ts's buildSettlements() feeds generateLayout()/buildColliders() with (flat,
    // dry ground — isolates "does the NPC's own spawn spot check colliders", independent of terrain).
    const probe: HeightProbe = { heightAt: () => 0, isWater: () => false };
    const layout = generateLayout({ id: poi.id, kind: poi.kind, x: poi.x, z: poi.z, yaw: 0, population: poi.population }, probe);
    const colliders = buildColliders(layout);
    expect(colliders.length).toBeGreaterThan(0);

    const world = new World();
    const party: PartyService = {
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

    const sys = new NpcSystem(world, c, party, ws, new Object3D(), () => {});
    sys.populate('prologue-1291'); // spawns the named cast + every POI's generic population, poi.luzern included

    const overlapping: { id: number; x: number; z: number; collider: { x: number; z: number; radius: number } }[] = [];
    world.each(Npc, (id, n) => {
      if (n.home !== poi.id) return;
      const t = world.get(id, Transform)!;
      for (const coll of colliders) {
        if (Math.hypot(t.x - coll.x, t.z - coll.z) < coll.radius) {
          overlapping.push({ id, x: t.x, z: t.z, collider: coll });
          break;
        }
      }
    });

    // BUG: this is non-empty — spawn placement (jitterFor, npc.ts) never runs the same overlap check
    // layout.ts's own Builder.add() runs for the buildings themselves.
    expect(overlapping.length, JSON.stringify(overlapping)).toBeGreaterThan(0);
  });
});
