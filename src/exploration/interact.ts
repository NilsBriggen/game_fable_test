/**
 * Interaction: nearest `Interactable` within 2.5 m and a 60° facing cone → prompt; `E` fires `interact`.
 * `talk` drives `QuestService.runDialogue()` when a quest service exists, else a console/toast fallback
 * (quest is a Wave-3 stub today). Also spawns a handful of `Container` loot entities at inns/castles.
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
    if (it.kind === 'talk') {
      if (quest && it.dialogueId) {
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
