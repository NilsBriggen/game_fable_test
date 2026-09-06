/**
 * POI discovery, fast travel, region tracking, and the generic `EncounterTrigger` mechanism.
 * Discovery is plain proximity → `Poi.discovered` (persistent) + `poi-discovered` event + a toast if a UI
 * service exists. Encounter triggers are edge-triggered (fire only when the player *crosses into* the
 * radius, not merely "is inside") so spawning/teleporting the player directly onto one never ambushes
 * them on arrival.
 *
 * The five Act-1 `EncounterTrigger` sites this file originally hard-coded (`enc.brunnen-quay`,
 * `enc.altdorf-square`, `enc.hohle-gasse`, `enc.einsiedeln-gate`, `enc.morgarten`) are deliberately gone:
 * per `requests/quest-2.md` (fix round 1, critic issue 10), the quest module now fires every one of those
 * encounters itself, directly, via `{encounter: id}` effects on the owning quest stage's `onEnter` — a
 * proximity trigger covering the same encounter id here would double-invoke `CombatService.start()`.
 * `addEncounterTrigger()` below is the generic mechanism kept for any future trigger (a purely visual/
 * camera cue, say) that is gated on `condition` and never calls `combat.start` itself when a quest service
 * exists — see that method's doc comment. The Habsburg patrol trigger (`npc.ts`) is unrelated: it is not
 * an `EncounterTrigger` entity at all, and stays as the coordinator confirmed.
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

export class PoiSystem {
  private lastRegion: string | null = null;
  private readonly insideTrigger = new Set<EntityId>();

  constructor(
    private world: World,
    private content: ContentRegistry,
    private services: ServiceRegistry,
    private events: EventBus<ExplorationEvents>,
  ) {}

  /** Rebuilds every `Poi` entity, and clears any previously-added `EncounterTrigger` entities (so a
   *  repeat `populate()` — a second `newGame()` in the same page — never doubles them up). Called once
   *  from `populate()`. Existing discovered state is passed back in by the caller via `setDiscovered()`
   *  after this (e.g. on load). */
  spawnPoiEntities(): void {
    const keep = new Set(this.discoveredIds()); // discoveries survive a repeat populate (chapter change)
    for (const id of this.world.query(Poi)) this.world.destroy(id);
    for (const id of this.world.query(EncounterTrigger)) this.world.destroy(id);
    for (const def of this.content.pois.values()) {
      const id = this.world.create(def.id);
      this.world.add(id, Transform, { x: def.x, y: 0, z: def.z, yaw: 0 });
      this.world.add(id, Poi, { poiId: def.id, kind: def.kind, radius: def.discoverRadius, discovered: keep.has(def.id), fastTravel: def.fastTravel });
      this.world.add(id, Name, { id: def.id, display: def.name });
    }
  }

  /** Generic `EncounterTrigger` mechanism (see file header). `condition` should be the exact
   *  `{questStage: [questId, stageId]}` the owning quest stage uses, and — because the quest module
   *  already calls `combat.start()` itself for every encounter it owns — a caller wiring up a *visual*
   *  cue trigger here must not also start combat from its own `encounter-trigger` listener. */
  addEncounterTrigger(encounterId: string, x: number, z: number, opts: { radius?: number; once?: boolean; condition?: QuestCondition; ambush?: 'player' | 'enemy' } = {}): EntityId {
    const id = this.world.create(`trigger.${encounterId}`);
    this.world.add(id, Transform, { x, y: 0, z, yaw: 0 });
    this.world.add(id, EncounterTrigger, { encounterId, radius: opts.radius ?? 14, once: opts.once ?? true, fired: false, condition: opts.condition, ambush: opts.ambush });
    return id;
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
    // 4.6 fog: the map image bakes its reveal discs, so a new discovery re-bakes (cheap, cached).
    this.services.tryGet('world')?.invalidateMapCache?.();
  }
}
