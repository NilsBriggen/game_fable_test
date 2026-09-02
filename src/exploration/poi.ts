/**
 * POI discovery, fast travel, region tracking, and the five Act-1 `EncounterTrigger` sites (task spec).
 * Discovery is plain proximity → `Poi.discovered` (persistent) + `poi-discovered` event + a toast if a UI
 * service exists. Encounter triggers are edge-triggered (fire only when the player *crosses into* the
 * radius, not merely "is inside") so spawning/teleporting the player directly onto a trigger — which is
 * exactly what `spawnAt: 'poi.altdorf'` does in the harness — never ambushes them on arrival.
 */
import type { World, EntityId } from '@core/ecs';
import { Transform, Poi, EncounterTrigger, Name } from '@core/components';
import type { ContentRegistry } from '@core/content';
import type { PoiDef } from '@core/schemas';
import type { QuestCondition } from '@core/dsl';
import type { ServiceRegistry } from '@core/services';
import type { EventBus } from '@core/events';
import { dist2 } from '@core/math';
import type { ExplorationEvents } from '@core/services';

interface TriggerSeed { encounterId: string; poiId: string; condition: QuestCondition; ambush?: 'player' | 'enemy' }

/** LORE.md §6 chapter titles used as placeholder quest-stage gates (task spec: "condition placeholders
 *  so quests can enable them"); the quest builder's Wave-3 `content/quests/act1/*` is expected to define
 *  matching stage ids — these are not authoritative quest ids, just consistent, readable placeholders. */
const TRIGGER_SEEDS: TriggerSeed[] = [
  { encounterId: 'enc.brunnen-quay', poiId: 'poi.brunnen', condition: { questStage: ['quest.der-eid', 'escort-brunnen'] } },
  { encounterId: 'enc.altdorf-square', poiId: 'poi.altdorf', condition: { questStage: ['quest.der-hut-auf-der-stange', 'square-confrontation'] } },
  { encounterId: 'enc.hohle-gasse', poiId: 'poi.hohle-gasse', condition: { questStage: ['quest.der-hut-auf-der-stange', 'hohle-gasse-ambush'] } },
  { encounterId: 'enc.einsiedeln-gate', poiId: 'poi.einsiedeln', condition: { questStage: ['quest.marchenstreit', 'abbey-gate'] } },
  { encounterId: 'enc.morgarten', poiId: 'poi.morgarten', condition: { questStage: ['quest.morgarten', 'battle'] } },
];

export class PoiSystem {
  private lastRegion: string | null = null;
  private readonly insideTrigger = new Set<EntityId>();

  constructor(
    private world: World,
    private content: ContentRegistry,
    private services: ServiceRegistry,
    private events: EventBus<ExplorationEvents>,
  ) {}

  /** Rebuilds every `Poi`/`EncounterTrigger` entity — called once from `populate()`. Existing discovered
   *  state is passed back in by the caller via `setDiscovered()` after this (e.g. on load). */
  spawnPoiEntities(): void {
    for (const id of this.world.query(Poi)) this.world.destroy(id);
    for (const id of this.world.query(EncounterTrigger)) this.world.destroy(id);
    for (const def of this.content.pois.values()) {
      const id = this.world.create(def.id);
      this.world.add(id, Transform, { x: def.x, y: 0, z: def.z, yaw: 0 });
      this.world.add(id, Poi, { poiId: def.id, kind: def.kind, radius: def.discoverRadius, discovered: false, fastTravel: def.fastTravel });
      this.world.add(id, Name, { id: def.id, display: def.name });
    }
    for (const seed of TRIGGER_SEEDS) {
      const poiDef = this.content.pois.get(seed.poiId);
      const enc = this.content.encounters.get(seed.encounterId);
      const loc = enc?.location ?? (poiDef ? { x: poiDef.x, z: poiDef.z } : { x: 0, z: 0 });
      const id = this.world.create(`trigger.${seed.encounterId}`);
      this.world.add(id, Transform, { x: loc.x, y: 0, z: loc.z, yaw: 0 });
      this.world.add(id, EncounterTrigger, { encounterId: seed.encounterId, radius: 14, once: true, fired: false, condition: seed.condition, ambush: seed.ambush });
    }
  }

  discoveredIds(): string[] {
    const out: string[] = [];
    this.world.each(Poi, (_id, p) => { if (p.discovered) out.push(p.poiId); });
    return out;
  }

  setDiscovered(ids: string[]): void {
    const set = new Set(ids);
    this.world.each(Poi, (_id, p) => { p.discovered = set.has(p.poiId); });
  }

  discover(poiId: string): void {
    this.world.each(Poi, (_id, p) => {
      if (p.poiId !== poiId || p.discovered) return;
      p.discovered = true;
      this.announceDiscovery(poiId);
    });
  }

  isDiscovered(poiId: string): boolean {
    let found = false;
    this.world.each(Poi, (_id, p) => { if (p.poiId === poiId && p.discovered) found = true; });
    return found;
  }

  poiPos(poiId: string): { x: number; z: number } | null {
    const p = this.content.pois.get(poiId);
    return p ? { x: p.x, z: p.z } : null;
  }

  poiDef(poiId: string): PoiDef | undefined {
    return this.content.pois.get(poiId);
  }

  nearestPoi(x: number, z: number): PoiDef | null {
    let best: PoiDef | null = null, bestD = Infinity;
    for (const p of this.content.pois.values()) {
      const d = dist2(x, z, p.x, p.z);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  /** Pre-seeds the trigger-containment set so teleporting/spawning the player directly inside a trigger
   *  radius does not fire it — only crossing *into* one afterwards does. Called after every
   *  spawn/teleport/fast-travel. */
  seedTriggerContainment(playerPos: { x: number; z: number }): void {
    this.insideTrigger.clear();
    this.world.each(EncounterTrigger, (id, trig) => {
      const t = this.world.get(id, Transform);
      if (!t) return;
      if (dist2(playerPos.x, playerPos.z, t.x, t.z) <= trig.radius) this.insideTrigger.add(id);
    });
  }

  /** Per-frame: discovery, region-entered, and edge-triggered encounter triggers. */
  update(playerPos: { x: number; y: number; z: number } | null): void {
    if (!playerPos) return;
    this.world.each(Poi, (_id, p) => {
      if (p.discovered) return;
      const pos = this.poiPos(p.poiId);
      if (!pos) return;
      if (dist2(playerPos.x, playerPos.z, pos.x, pos.z) <= p.radius) {
        p.discovered = true;
        this.announceDiscovery(p.poiId);
      }
    });

    const world = this.services.tryGet('world');
    if (world) {
      const region = world.regionAt(playerPos.x, playerPos.z);
      const regionId = region?.id ?? null;
      if (regionId && regionId !== this.lastRegion) {
        this.lastRegion = regionId;
        this.events.emit('region-entered', regionId);
        this.services.tryGet('ui')?.toast(`Entering ${region!.name}`, 'info');
      }
    }

    this.world.each(EncounterTrigger, (id, trig) => {
      const t = this.world.get(id, Transform);
      if (!t) return;
      const inside = dist2(playerPos.x, playerPos.z, t.x, t.z) <= trig.radius;
      const wasInside = this.insideTrigger.has(id);
      if (inside) this.insideTrigger.add(id); else this.insideTrigger.delete(id);
      if (!inside || wasInside) return; // only a fresh crossing-in fires
      if (trig.once && trig.fired) return;
      const quest = this.services.tryGet('quest');
      const conditionOk = quest ? quest.evaluate(trig.condition) : true; // no quest yet → let the harness exercise it
      if (!conditionOk) return;
      trig.fired = true;
      this.events.emit('encounter-trigger', trig.encounterId, id, trig.ambush);
      if (!quest) {
        const combat = this.services.tryGet('combat');
        combat?.start(trig.encounterId, { ambush: trig.ambush }).catch((err) => console.error('[exploration] combat.start failed', err));
      }
    });
  }

  private announceDiscovery(poiId: string): void {
    this.events.emit('poi-discovered', poiId);
    const def = this.content.pois.get(poiId);
    this.services.tryGet('ui')?.toast(`Discovered: ${def?.name ?? poiId}`, 'info');
  }
}
