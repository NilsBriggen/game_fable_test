/** 4.6 compass fog: undiscovered markers stay `?`-only; discovery invalidates the baked map image. */
import { describe, it, expect, vi } from 'vitest';
import { World } from '@core/ecs';
import { ContentRegistry } from '@core/content';
import { ServiceRegistry } from '@core/services';
import { EventBus } from '@core/events';
import type { PoiDef } from '@core/schemas';
import type { ExplorationEvents } from '@core/services';
import { Character, Transform } from '@core/components';
import type { GameClock } from '@core/clock';
import { PoiSystem } from './poi';
import { updateHud } from './hud';

function makeContent(): ContentRegistry {
  const c = new ContentRegistry();
  c.addRegions([{
    id: 'r1', name: 'R', owner: 'uri',
    bounds: [[-1000, -1000], [1000, -1000], [1000, 1000], [-1000, 1000]],
    historical: true, description: 'x', note: 'x',
  }]);
  const pois: PoiDef[] = [
    { id: 'poi.a', name: 'A', region: 'r1', x: 0, z: 0, kind: 'village', discoverRadius: 90, fastTravel: true, historical: true, note: 'x', description: 'x' },
    { id: 'poi.b', name: 'B', region: 'r1', x: 5000, z: 0, kind: 'landmark', discoverRadius: 50, fastTravel: false, historical: true, note: 'x', description: 'x' },
  ];
  c.addPois(pois);
  return c;
}

describe('compass — undiscovered stays `?`-only (4.6)', () => {
  function setup() {
    const world = new World();
    const content = makeContent();
    const services = new ServiceRegistry();
    const bus = new EventBus<ExplorationEvents>();
    const poi = new PoiSystem(world, content, services, bus);
    poi.spawnPoiEntities();
    poi.discover('poi.a');
    const player = world.create('player');
    world.add(player, Character, { hp: 20, hpMax: 20, morale: 60, moraleMax: 60, fatigue: 0 });
    world.add(player, Transform, { x: 0, y: 0, z: 0, yaw: 0 });
    const states: { compass: { markers: { label: string; kind: string; distance: number; discovered: boolean }[] } }[] = [];
    services.register('ui', { updateHud: (s: never) => { states.push(s as never); } } as never);
    const clock = { calendar: () => ({ label: 'x', hour: 12 }), season: () => 'summer' } as unknown as GameClock;
    updateHud(world, content, services, clock, poi, player, null);
    return states[0]!.compass;
  }
  it('discovered POI keeps name/kind/distance; undiscovered is `?`/landmark/distance -1', () => {
    const s = setup();
    const found = s.markers.find((m) => m.discovered)!;
    expect(found.label).toBe('A');
    expect(found.distance).toBeGreaterThanOrEqual(0);
    const hidden = s.markers.find((m) => !m.discovered)!;
    expect(hidden.label).toBe('?');
    expect(hidden.kind).toBe('landmark');
    expect(hidden.distance).toBe(-1);
  });
  it('announceDiscovery invalidates the baked map image (fog re-bake path)', () => {
    const services = new ServiceRegistry();
    const invalidate = vi.fn();
    services.register('world', { regionAt: () => null, invalidateMapCache: invalidate } as never);
    const world = new World();
    const content = makeContent();
    const bus = new EventBus<ExplorationEvents>();
    const poi = new PoiSystem(world, content, services, bus);
    poi.spawnPoiEntities();
    poi.update({ x: 0, y: 0, z: 0 }); // inside poi.a radius → discovery
    expect(poi.isDiscovered('poi.a')).toBe(true);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });
});
