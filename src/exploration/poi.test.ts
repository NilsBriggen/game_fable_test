import { describe, it, expect, vi } from 'vitest';
import { World } from '@core/ecs';
import { ContentRegistry } from '@core/content';
import { ServiceRegistry } from '@core/services';
import { EventBus } from '@core/events';
import type { PoiDef, EncounterDef, RegionDef } from '@core/schemas';
import type { ExplorationEvents, WorldService, QuestService, CombatService } from '@core/services';
import { PoiSystem } from './poi';

function makeContent(): ContentRegistry {
  const c = new ContentRegistry();
  const region: RegionDef = { id: 'r1', name: 'Test Region', owner: 'uri', bounds: [[-1000, -1000], [1000, -1000], [1000, 1000], [-1000, 1000]], historical: true, description: 'x', note: 'x' };
  c.addRegions([region]);
  // Kept well clear of the (-900..900) box the trigger stand-ins below occupy, so discovery tests never
  // accidentally overlap an encounter-trigger radius.
  const pois: PoiDef[] = [
    { id: 'poi.a', name: 'A', region: 'r1', x: 5000, z: 5000, kind: 'village', discoverRadius: 20, fastTravel: true, historical: true, note: 'x', description: 'x' },
    { id: 'poi.b', name: 'B', region: 'r1', x: 5500, z: 5000, kind: 'landmark', discoverRadius: 10, fastTravel: false, historical: true, note: 'x', description: 'x' },
  ];
  c.addPois(pois);
  // One stand-in per real TRIGGER_SEEDS entry (poi.ts), each far apart, so the "distant" seeds don't all
  // collapse onto (0,0) — otherwise a player standing at the origin would cross into all 5 at once.
  const triggerPois: PoiDef[] = [
    { id: 'poi.brunnen', name: 'Brunnen', region: 'r1', x: -900, z: -900, kind: 'port', discoverRadius: 10, fastTravel: true, historical: true, note: 'x', description: 'x' },
    { id: 'poi.altdorf', name: 'Altdorf', region: 'r1', x: 0, z: 0, kind: 'village', discoverRadius: 10, fastTravel: true, historical: true, note: 'x', description: 'x' },
    { id: 'poi.hohle-gasse', name: 'Hohle Gasse', region: 'r1', x: 900, z: -900, kind: 'landmark', discoverRadius: 10, fastTravel: true, historical: true, note: 'x', description: 'x' },
    { id: 'poi.einsiedeln', name: 'Einsiedeln', region: 'r1', x: -900, z: 900, kind: 'monastery', discoverRadius: 10, fastTravel: true, historical: true, note: 'x', description: 'x' },
    { id: 'poi.morgarten', name: 'Morgarten', region: 'r1', x: 900, z: 900, kind: 'battlefield', discoverRadius: 10, fastTravel: true, historical: true, note: 'x', description: 'x' },
  ];
  c.addPois(triggerPois);
  const encounters: EncounterDef[] = ['enc.brunnen-quay', 'enc.altdorf-square', 'enc.hohle-gasse', 'enc.einsiedeln-gate', 'enc.morgarten'].map((id, i) => ({
    id, name: id, location: { x: triggerPois[i].x, z: triggerPois[i].z }, grid: { cols: 4, rows: 4 }, deploy: { q: 0, r: 0, cols: 1, rows: 1 },
    units: [], objectives: [{ type: 'defeat-all' as const }], historical: true, note: 'x', description: 'x',
  }));
  c.addEncounters(encounters);
  return c;
}

function makeSystem(services = new ServiceRegistry()) {
  const world = new World();
  const content = makeContent();
  const bus = new EventBus<ExplorationEvents>();
  const sys = new PoiSystem(world, content, services, bus);
  sys.spawnPoiEntities();
  return { sys, bus, content };
}

describe('PoiSystem — discovery', () => {
  it('discovers a POI by proximity and emits poi-discovered', () => {
    const { sys, bus } = makeSystem();
    const spy = vi.fn();
    bus.on('poi-discovered', spy);
    expect(sys.isDiscovered('poi.a')).toBe(false);
    sys.update({ x: 5005, y: 0, z: 5005 }); // within poi.a's radius 20 (centre 5000,5000)
    expect(sys.isDiscovered('poi.a')).toBe(true);
    expect(spy).toHaveBeenCalledWith('poi.a');
  });

  it('does not discover a POI outside its radius', () => {
    const { sys } = makeSystem();
    sys.update({ x: 5485, y: 0, z: 5000 }); // poi.b centre is (5500,5000), radius 10 — 15 m short
    expect(sys.isDiscovered('poi.b')).toBe(false);
    sys.update({ x: 5495, y: 0, z: 5000 }); // now within 10 m
    expect(sys.isDiscovered('poi.b')).toBe(true);
  });

  it('discover()/setDiscovered()/discoveredIds() round-trip explicitly (save/load persistence)', () => {
    const { sys } = makeSystem();
    sys.discover('poi.a');
    expect(sys.discoveredIds()).toEqual(['poi.a']);
    sys.setDiscovered(['poi.b']);
    expect(sys.discoveredIds()).toEqual(['poi.b']);
    expect(sys.isDiscovered('poi.a')).toBe(false);
  });

  it('does not re-fire poi-discovered once already discovered', () => {
    const { sys, bus } = makeSystem();
    const spy = vi.fn();
    bus.on('poi-discovered', spy);
    sys.update({ x: 5000, y: 0, z: 5000 });
    sys.update({ x: 5001, y: 0, z: 5000 });
    sys.update({ x: 5002, y: 0, z: 5000 });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('PoiSystem — region-entered', () => {
  it('emits region-entered when WorldService.regionAt reports a new region', () => {
    const services = new ServiceRegistry();
    const region: RegionDef = { id: 'r1', name: 'Test Region', owner: 'uri', bounds: [], historical: true, description: 'x', note: 'x' };
    const fakeWorld = { regionAt: () => region } as unknown as WorldService;
    services.register('world', fakeWorld);
    const { sys, bus } = makeSystem(services);
    const spy = vi.fn();
    bus.on('region-entered', spy);
    sys.update({ x: 0, y: 0, z: 0 });
    sys.update({ x: 1, y: 0, z: 0 }); // still r1 — no second emit
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('r1');
  });
});

describe('PoiSystem — encounter triggers', () => {
  it('does not fire when the player spawns/teleports directly inside the radius (seedTriggerContainment)', () => {
    const services = new ServiceRegistry();
    const combat = { start: vi.fn().mockResolvedValue({}) } as unknown as CombatService;
    services.register('combat', combat);
    const { sys } = makeSystem(services);
    sys.seedTriggerContainment({ x: 0, z: 0 }); // "teleport" the player right onto the trigger
    sys.update({ x: 0, y: 0, z: 0 });
    sys.update({ x: 1, y: 0, z: 0 }); // still inside — no edge crossing
    expect(combat.start).not.toHaveBeenCalled();
  });

  it('fires (event + combat.start) on crossing into the radius when no quest service exists', () => {
    const services = new ServiceRegistry();
    const combat = { start: vi.fn().mockResolvedValue({}) } as unknown as CombatService;
    services.register('combat', combat);
    const { sys, bus } = makeSystem(services);
    const spy = vi.fn();
    bus.on('encounter-trigger', spy);
    sys.update({ x: 1000, y: 0, z: 1000 }); // well outside
    sys.update({ x: 0, y: 0, z: 0 }); // crosses in
    expect(spy).toHaveBeenCalledWith('enc.altdorf-square', expect.any(Number), undefined);
    expect(combat.start).toHaveBeenCalledWith('enc.altdorf-square', { ambush: undefined });
  });

  it('gates on QuestService.evaluate() when a quest service exists, and never calls combat.start directly', () => {
    const services = new ServiceRegistry();
    const evaluate = vi.fn().mockReturnValue(false);
    const quest = { evaluate } as unknown as QuestService;
    const combat = { start: vi.fn().mockResolvedValue({}) } as unknown as CombatService;
    services.register('quest', quest);
    services.register('combat', combat);
    const { sys, bus } = makeSystem(services);
    const spy = vi.fn();
    bus.on('encounter-trigger', spy);
    sys.update({ x: 1000, y: 0, z: 1000 });
    sys.update({ x: 0, y: 0, z: 0 });
    expect(evaluate).toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled(); // condition returned false
    expect(combat.start).not.toHaveBeenCalled(); // quest exists — exploration never starts combat itself
  });

  it('fires only once for a `once: true` trigger even after leaving and re-entering', () => {
    const services = new ServiceRegistry();
    const combat = { start: vi.fn().mockResolvedValue({}) } as unknown as CombatService;
    services.register('combat', combat);
    const { sys } = makeSystem(services);
    sys.update({ x: 1000, y: 0, z: 1000 });
    sys.update({ x: 0, y: 0, z: 0 }); // fires
    sys.update({ x: 1000, y: 0, z: 1000 }); // leave
    sys.update({ x: 0, y: 0, z: 0 }); // re-enter
    expect(combat.start).toHaveBeenCalledTimes(1);
  });
});
