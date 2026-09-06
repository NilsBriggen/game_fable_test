/**
 * HUD data feed: if a UI service exists, calls `ui.updateHud()` once a frame with hp/morale/fatigue/time/
 * region/compass. No-op (not even the trig work) when there is no UI service — true for every scenario in
 * this build (`src/ui` is still a Wave-3 stub), but written against the real interface so it needs no
 * changes once UI lands.
 */
import type { World, EntityId } from '@core/ecs';
import { Character, Transform } from '@core/components';
import type { ContentRegistry } from '@core/content';
import type { ServiceRegistry, HudState } from '@core/services';
import type { GameClock } from '@core/clock';
import { dist2 } from '@core/math';
import type { PoiSystem } from './poi';

export function updateHud(
  world: World, content: ContentRegistry, services: ServiceRegistry, clock: GameClock,
  poiSystem: PoiSystem, playerId: EntityId | null, prompt: string | null,
): void {
  const ui = services.tryGet('ui');
  if (!ui || playerId === null) return;
  const ch = world.get(playerId, Character);
  const t = world.get(playerId, Transform);
  if (!ch || !t) return;

  const cal = clock.calendar();
  const world_ = services.tryGet('world');
  const region = world_?.regionAt(t.x, t.z)?.name ?? '';

  const markers: HudState['compass']['markers'] = [];
  let nearestUndiscovered: { def: { name: string; x: number; z: number }; d: number } | null = null;
  for (const def of content.pois.values()) {
    const discovered = poiSystem.isDiscovered(def.id);
    const d = dist2(t.x, t.z, def.x, def.z); // dist2, despite the name, is already the real (not squared) distance
    if (discovered) {
      const bearing = Math.atan2(def.x - t.x, -(def.z - t.z));
      markers.push({ bearing, kind: def.kind, label: def.name, distance: d, discovered: true });
    } else if (!nearestUndiscovered || d < nearestUndiscovered.d) {
      nearestUndiscovered = { def, d };
    }
  }
  if (nearestUndiscovered) {
    const { def } = nearestUndiscovered;
    const bearing = Math.atan2(def.x - t.x, -(def.z - t.z));
    // 4.6 fog: undiscovered stays `?`-only — no name, real kind, or distance leaks (distance: -1).
    markers.push({ bearing, kind: 'landmark', label: '?', distance: -1, discovered: false });
  }

  const state: HudState = {
    hp: ch.hp, hpMax: ch.hpMax, morale: ch.morale, moraleMax: ch.moraleMax, fatigue: ch.fatigue,
    time: cal.label, hour: cal.hour, season: clock.season(), region,
    compass: { yaw: t.yaw, markers },
    prompt: prompt ?? undefined,
  };
  ui.updateHud(state);
}
