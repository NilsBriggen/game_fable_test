/**
 * Interaction: nearest `Interactable` within 2.5 m and a 60° facing cone → prompt; `E` fires `interact`.
 * `talk` drives `QuestService.runDialogue()` when a quest service exists, else a console/toast fallback
 * (harness scenarios that boot without the quest module registered, e.g. a bare-`world`-only smoke test).
 * Also spawns a handful of `Container` loot entities at inns/castles.
 */
import type { World, EntityId } from '@core/ecs';
import { Transform, Interactable, Name, Container } from '@core/components';
import type { ContentRegistry } from '@core/content';
import type { ServiceRegistry } from '@core/services';
import type { EventBus } from '@core/events';
import type { ExplorationEvents } from '@core/services';
import { wrapAngle } from '@core/math';

const MAX_RANGE = 2.5;
const MAX_ANGLE = (60 * Math.PI) / 180;

export class InteractSystem {
  // `content` isn't read directly (every field this system needs — dialogueId, containerId, item
  // instances — already lives on the ECS components themselves), but kept as a constructor parameter to
  // match the other exploration systems' shape and because a Wave-3 addition (e.g. a container's `owner`
  // reputation gate) will likely need it.
  constructor(
    private world: World,
    _content: ContentRegistry,
    private services: ServiceRegistry,
    private events: EventBus<ExplorationEvents>,
  ) {}

  nearestInteractable(playerId: EntityId): { entity: EntityId; prompt: string } | null {
    const t = this.world.get(playerId, Transform);
    if (!t) return null;
    let best: EntityId | null = null;
    let bestPrompt = '';
    let bestDist = Infinity;
    for (const id of this.world.query(Interactable, Transform)) {
      if (id === playerId) continue;
      const it = this.world.get(id, Interactable)!;
      if (!it.enabled) continue;
      const ot = this.world.get(id, Transform)!;
      const dx = ot.x - t.x, dz = ot.z - t.z;
      const d = Math.hypot(dx, dz);
      if (d > MAX_RANGE || d < 1e-6) continue;
      const bearing = Math.atan2(dx, -dz);
      if (Math.abs(wrapAngle(bearing - t.yaw)) > MAX_ANGLE) continue;
      if (d < bestDist) { bestDist = d; best = id; bestPrompt = it.prompt; }
    }
    return best === null ? null : { entity: best, prompt: bestPrompt };
  }

  interactWith(entity: EntityId): void {
    const it = this.world.get(entity, Interactable);
    if (!it) return;
    const name = this.world.get(entity, Name)?.display ?? 'someone';
    const quest = this.services.tryGet('quest');
    const ui = this.services.tryGet('ui');
    if (it.kind === 'travel') {
      this.travel(it.data?.destinations as string[] | undefined);
    } else if (it.kind === 'trade') {
      if (ui) ui.openMenu('trade', { entity, merchant: it.data?.merchant }); else console.info('[exploration] trade (no ui)');
    } else if (it.kind === 'rest') {
      if (ui) ui.openMenu('rest', { entity }); else console.info('[exploration] rest (no ui)');
    } else if (it.kind === 'talk') {
      if (quest && it.dialogueId && quest.dialogueExists?.(it.dialogueId) !== false) {
        quest.runDialogue(it.dialogueId, entity).catch((err) => console.error('[exploration] runDialogue failed', err));
      } else if (ui) {
        ui.toast(`${name} has nothing to say yet.`, 'info');
      } else {
        console.info(`[exploration] talk to ${name} (no quest/dialogue module loaded)`);
      }
    } else if (it.kind === 'loot' && it.containerId) {
      const c = this.world.get(entity, Container);
      if (c) c.opened = true;
      if (ui) ui.openMenu('container', { entity, containerId: it.containerId });
      else console.info(`[exploration] open container ${it.containerId}`);
    } else if (ui) {
      ui.toast(it.prompt, 'info');
    }
    this.events.emit('interact', entity);
  }

  /** Boat travel: offer the discovered ports in order of distance; the first accepted one is the destination. */
  private travel(destinations: string[] | undefined): void {
    const ex = this.services.tryGet('exploration');
    const ui = this.services.tryGet('ui');
    if (!ex || !destinations?.length) return;
    const open = destinations.filter((d) => ex.isDiscovered(d));
    if (open.length === 0) { ui?.toast('You know of no other landing to row to yet.', 'info'); return; }
    void (async () => {
      for (const d of open.slice(0, 3)) {
        const name = ex.poiDef(d)?.name ?? d;
        const ok = ui ? await ui.confirm(`Take the boat to ${name}?`, 'Row', 'Not there') : true;
        if (ok) { await ex.fastTravel(d); return; }
      }
    })();
  }
}

/** A bed at every inn ("rest") and a stall at every merchant-populated settlement ("trade"). */
export function spawnTradeAndRest(world: World, content: ContentRegistry): void {
  for (const id of world.query(Interactable)) { const k = world.get(id, Interactable)!.kind; if (k === 'trade' || k === 'rest') world.destroy(id); }
  for (const poi of content.pois.values()) {
    if (poi.population?.innkeeper) {
      const id = world.create(`rest.${poi.id}`);
      world.add(id, Transform, { x: poi.x - 4, y: 0, z: poi.z + 3, yaw: 0 });
      world.add(id, Name, { id: `rest.${poi.id}`, display: 'Inn' });
      world.add(id, Interactable, { kind: 'rest', prompt: `Rest at the inn`, enabled: true });
    }
    if (poi.population?.merchant || poi.kind === 'town') {
      const id = world.create(`trade.${poi.id}`);
      world.add(id, Transform, { x: poi.x + 4, y: 0, z: poi.z - 3, yaw: 0 });
      world.add(id, Name, { id: `trade.${poi.id}`, display: 'Market stall' });
      world.add(id, Interactable, { kind: 'trade', prompt: `Trade at the market`, enabled: true, data: { merchant: poi.id } });
    }
  }
}

/** One `travel` interactable per port POI (§5.2 "boats at Flüelen/Brunnen/Gersau/Luzern as travel interactables"). */
export function spawnBoatTravel(world: World, content: ContentRegistry): void {
  for (const id of world.query(Interactable)) { if (world.get(id, Interactable)!.kind === 'travel') world.destroy(id); }
  const ports = [...content.pois.values()].filter((p) => p.kind === 'port');
  for (const poi of ports) {
    const others = ports.filter((o) => o.id !== poi.id).sort((a, b) => Math.hypot(a.x - poi.x, a.z - poi.z) - Math.hypot(b.x - poi.x, b.z - poi.z)).map((o) => o.id);
    const id = world.create(`travel.${poi.id}`);
    world.add(id, Transform, { x: poi.x + 6, y: 0, z: poi.z + 4, yaw: 0 });
    world.add(id, Name, { id: `travel.${poi.id}`, display: 'Boat' });
    world.add(id, Interactable, { kind: 'travel', prompt: 'Take the boat', enabled: true, data: { destinations: others } });
  }
}

const CASTLE_LOOT = ['item.bolzen', 'item.torch', 'item.rope', 'item.bread'];
const INN_LOOT = ['item.bread', 'item.alpkaese', 'item.wine', 'item.dried-meat'];
const MONASTERY_LOOT = ['item.herbs', 'item.psalter', 'item.bandage'];

/** One container per castle/monastery/inn-bearing village POI — enough to make looting worthwhile
 *  without turning every settlement into a shopping trip. */
export function spawnContainers(world: World, content: ContentRegistry): void {
  for (const id of world.query(Container)) world.destroy(id); // avoid doubling up on a repeat populate()
  for (const poi of content.pois.values()) {
    let table: string[] | null = null;
    let pfennig = 0;
    if (poi.kind === 'castle') { table = CASTLE_LOOT; pfennig = 20; }
    else if (poi.kind === 'monastery') { table = MONASTERY_LOOT; pfennig = 5; }
    else if (poi.population?.innkeeper) { table = INN_LOOT; pfennig = 15; }
    if (!table) continue;
    const containerId = `container.${poi.id}`;
    const id = world.create(containerId);
    world.add(id, Transform, { x: poi.x + 2, y: 0, z: poi.z + 2, yaw: 0 });
    world.add(id, Container, {
      containerId, opened: false, pfennig,
      items: table.map((defId, i) => ({ instanceId: `${containerId}-${i}`, defId, qty: 1, condition: 1 })),
    });
    world.add(id, Interactable, { kind: 'loot', prompt: `Search ${poi.name}`, containerId, enabled: true });
  }
}
