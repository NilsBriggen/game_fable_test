/**
 * Probe for bughunt/exploration.md finding #1: `NpcSystem.spawnNamed()` (src/exploration/npc.ts) places a
 * named NPC at `home + jitterFor(def.id, 6)` with NO `worldService.isWater()` check — unlike the sibling
 * method `spawnGenericFromArchetype()`, which explicitly falls back to the POI centre when the jittered
 * spot lands in water (npc.ts:130-133, comment "fall back to POI centre rather than the lake"). Any named
 * NPC whose home POI sits close to a shoreline (e.g. a port — Flüelen/Brunnen/Gersau/Luzern per
 * ARCHITECTURE.md §5.2) can spawn standing in the lake.
 *
 * This test uses the real content registry (so it's tied to an actual NPC/POI pair — `npc.jost-imhof`
 * whose home is `poi.fluelen`, a port) and a WorldService stub whose `isWater` is true everywhere except
 * exactly at the POI's own centre point — i.e. "the whole shore around this dock is water, only the dock
 * plank itself is dry". That isolates the one behavioural difference between the two spawn paths without
 * needing the real terrain/heightfield.
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
import { NpcSystem } from '../../../../src/exploration/npc';

function content(): ContentRegistry {
  const c = new ContentRegistry();
  registerGeography(c); registerSkills(c); registerItems(c); registerArchetypes(c); registerPois(c); registerNpcs(c);
  return c;
}

describe('bug: NpcSystem.spawnNamed can place a named NPC in the water', () => {
  it('jost-imhof (home poi.fluelen, a port) spawns in water when jitter pushes him off the one dry point', () => {
    const c = content();
    const home = c.pois.get('poi.fluelen')!;

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

    // Everywhere is water except the exact POI centre — isolates "did this spawn path check isWater at all".
    const ws = {
      heightAt: () => 0,
      isWater: (x: number, z: number) => Math.hypot(x - home.x, z - home.z) > 0.001,
      hasModel: () => true,
      spawnModel: () => new Object3D(),
    } as unknown as WorldService;

    const sys = new NpcSystem(world, c, party, ws, new Object3D(), () => {});
    const def = c.npcs.get('npc.jost-imhof')!;
    const id = sys.spawnNamed(def);
    const t = world.get(id, Transform)!;

    const jitterMag = Math.hypot(t.x - home.x, t.z - home.z);
    expect(jitterMag).toBeGreaterThan(0.001); // sanity: jitterFor(def.id, 6) is in fact non-zero here

    // BUG: spawnNamed never calls worldService.isWater() to fall back to the POI centre the way
    // spawnGenericFromArchetype does, so the NPC is left standing in the lake.
    expect(ws.isWater(t.x, t.z)).toBe(true);
  });

  it('contrast: a generic archetype NPC at the same spot is NOT left in water (it has the isWater fallback)', () => {
    const c = content();
    const port = [...c.pois.values()].find((p) => p.kind === 'port' && p.population?.boatman)!;
    expect(port, 'expected a populated port POI in content/pois.ts').toBeTruthy();

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
    const ws = {
      heightAt: () => 0,
      isWater: (x: number, z: number) => Math.hypot(x - port.x, z - port.z) > 0.001,
      hasModel: () => true,
      spawnModel: () => new Object3D(),
    } as unknown as WorldService;

    const sys = new NpcSystem(world, c, party, ws, new Object3D(), () => {});
    sys.populate('prologue-1291'); // spawns the named cast + every POI's generic population, including this port's boatman/fisher
    let anyGenericHere: number | undefined;
    world.each(Npc, (id, n) => { if (n.generic && n.home === port.id) anyGenericHere = id; });
    expect(anyGenericHere, `expected at least one generic NPC at ${port.id}`).toBeDefined();
    const t = world.get(anyGenericHere!, Transform)!;
    expect(ws.isWater(t.x, t.z)).toBe(false); // falls back to the POI centre — the one dry point
  });
});
