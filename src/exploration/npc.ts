/**
 * NPC life: `populate(chapter)` spawns the named cast (whose `NpcDef.chapters` includes the target
 * chapter) plus generic crowd from each `PoiDef.population`, and per-frame simulation freezes anything
 * beyond 300 m (task/ARCHITECTURE §2 "Live entities") — a frozen NPC's mesh is torn down and its position
 * is left untouched until re-entry, when it's snapped straight to `analyticPosition()` rather than being
 * stepped through the time that passed. Near NPCs walk straight lines toward their schedule's current POI,
 * terrain-following, never stepping into water. A handful of Habsburg patrols walk fixed road chains near
 * Küssnacht, Zug and Altdorf and can trigger a fight if the party is hostile with `habsburg`.
 */
import { Object3D } from 'three';
import type { World, EntityId } from '@core/ecs';
import { Transform, Renderable, Interactable, Npc, MeshRef, type NpcC } from '@core/components';
import type { ContentRegistry } from '@core/content';
import type { NpcDef } from '@core/schemas';
import type { PartyService, WorldService } from '@core/services';
import { Rng, hashString } from '@core/rng';
import { dist2 } from '@core/math';
import { PLACES, ROADS } from '@content/gazetteer';
import { resolveSchedule, analyticPosition } from './schedule';

export const NPC_SIM_RADIUS = 300;
const NPC_WALK_SPEED = 1.5;
const ARRIVE_EPS = 1.5;

interface PatrolState {
  waypoints: { x: number; z: number }[];
  index: number;
  forward: boolean;
}

export type EncounterStarter = (encounterId: string) => void;

export class NpcSystem {
  /** `EntityId -> content npc id`, so interaction can find the dialogueRoot / display name again without
   *  re-scanning `content.npcs`. */
  readonly defIdOf = new Map<EntityId, string>();
  private readonly patrols = new Map<EntityId, PatrolState>();
  private readonly patrolLead = new Set<EntityId>();
  private lastTrigger = 0;
  private isHostileHabsburg = false;

  constructor(
    private world: World,
    private content: ContentRegistry,
    private party: PartyService,
    private worldService: WorldService,
    private dynamicRoot: Object3D,
    private startEncounter: EncounterStarter,
  ) {}

  setHostileHabsburg(v: boolean): void {
    this.isHostileHabsburg = v;
  }

  /** Removes every previously-populated NPC entity (used before a fresh `populate()` on new-game/load,
   *  so re-running a scenario never doubles the cast). */
  clear(): void {
    for (const id of this.world.query(Npc)) {
      const mesh = this.world.get(id, MeshRef);
      if (mesh?.object) disposeObject3D(mesh.object as Object3D, this.dynamicRoot);
      this.world.destroy(id);
    }
    this.defIdOf.clear();
    this.patrols.clear();
    this.patrolLead.clear();
  }

  populate(chapter: string): void {
    this.clear();
    for (const def of this.content.npcs.values()) {
      if (def.chapters && !def.chapters.includes(chapter)) continue;
      this.spawnNamed(def);
    }
    for (const poi of this.content.pois.values()) {
      if (!poi.population) continue;
      for (const [archId, count] of Object.entries(poi.population)) {
        for (let i = 0; i < count; i++) this.spawnGenericFromArchetype(archId, poi.id, poi.x, poi.z, i);
      }
    }
    this.spawnPatrols();
  }

  spawnNamed(def: NpcDef): EntityId {
    const pos = this.poiPos(def.home) ?? { x: 0, z: 0 };
    const id = this.party.createCharacter(def);
    const jitter = jitterFor(def.id, 6);
    const x = pos.x + jitter.x, z = pos.z + jitter.z;
    const t = this.world.get(id, Transform)!;
    t.x = x; t.y = this.worldService.heightAt(x, z); t.z = z; t.yaw = 0;
    // Falls back to the quest builder's `dlg.generic.<archetype>` (requests/quest-1.md) for the vast
    // majority of named NPCs that carry no bespoke `dialogueRoot` of their own.
    this.world.add(id, Interactable, { kind: 'talk', prompt: `Talk to ${def.name}`, dialogueId: def.dialogueRoot ?? `dlg.generic.${def.archetype}`, enabled: true });
    // frozen=true initially — the lifecycle system unfreezes + snaps position + spawns a mesh on first
    // proximity check, so we don't pay a spawn cost for NPCs the player never gets near this session.
    const npc = this.world.get(id, Npc)!;
    npc.frozen = true;
    this.defIdOf.set(id, def.id);
    return id;
  }

  private spawnGenericFromArchetype(archId: string, homePoi: string, x: number, z: number, salt: number): EntityId | null {
    const arch = this.content.archetypes.get(archId);
    if (!arch) {
      console.warn(`[exploration] populate: unknown archetype "${archId}" in poi.population`);
      return null;
    }
    const jitter = jitterFor(`${homePoi}:${archId}:${salt}`, 14);
    let jx = x + jitter.x, jz = z + jitter.z;
    if (this.worldService.isWater(jx, jz)) { jx = x; jz = z; } // fall back to POI centre rather than the lake
    const genericDef: NpcDef = {
      ...arch, id: `${homePoi}.${archId}.${salt}`, home: homePoi, role: 'generic',
      schedule: [{ hour: 6, poi: 'home', activity: 'work' }, { hour: 20, poi: 'home', activity: 'sleep' }],
    };
    const id = this.party.createCharacter(genericDef);
    const t = this.world.get(id, Transform)!;
    t.x = jx; t.y = this.worldService.heightAt(jx, jz); t.z = jz;
    this.world.add(id, Interactable, { kind: 'talk', prompt: `Talk to ${arch.name}`, dialogueId: `dlg.generic.${archId}`, enabled: true });
    const npc = this.world.get(id, Npc)!;
    npc.frozen = true;
    npc.generic = true;
    return id;
  }

  private spawnPatrols(): void {
    const routes: { road: string; count: number }[] = [
      { road: 'kuessnacht-road', count: 4 },
      { road: 'arth-road', count: 3 },
      { road: 'gotthard-road', count: 3 },
    ];
    for (const r of routes) {
      const road = ROADS.find((rd) => rd.id === r.road);
      if (!road) continue;
      const waypoints = road.via.map((pid) => PLACES[pid]).filter(Boolean).map((p) => ({ x: p.x, z: p.z }));
      if (waypoints.length < 2) continue;
      const footman = this.content.archetypes.get('habsburg-footman');
      if (!footman) continue;
      let leadId: EntityId | null = null;
      for (let i = 0; i < r.count; i++) {
        const def: NpcDef = {
          id: `patrol.${r.road}.${i}`, name: 'Habsburg Patrol', faction: 'habsburg', home: road.via[0],
          role: 'enemy', archetype: 'habsburg-footman', attributes: footman.attributes,
          skills: footman.skills, equipment: footman.equipment,
          modelId: 'char.habsburg-footman', schedule: [],
          description: 'A Habsburg road patrol.', historical: 'invented', note: 'Roving patrol, LORE.md §10.',
        };
        const id = this.party.createCharacter(def);
        const start = waypoints[0];
        const off = jitterFor(`${r.road}:${i}`, 3);
        const t = this.world.get(id, Transform)!;
        t.x = start.x + off.x; t.z = start.z + off.z; t.y = this.worldService.heightAt(t.x, t.z);
        const npc = this.world.get(id, Npc)!;
        npc.frozen = true;
        npc.activity = 'patrol';
        this.patrols.set(id, { waypoints, index: 1, forward: true });
        if (leadId === null) leadId = id;
      }
      if (leadId !== null) this.patrolLead.add(leadId);
    }
  }

  private poiPos(poiId: string): { x: number; z: number } | null {
    const p = this.content.pois.get(poiId);
    return p ? { x: p.x, z: p.z } : null;
  }

  /** Per-frame lifecycle: freeze/unfreeze by distance, spawn/despawn meshes, walk near NPCs, drive
   *  patrols and (if hostile) trigger a fight when a patrol reaches the player. */
  update(dt: number, playerPos: { x: number; z: number } | null, hour: number): void {
    if (!playerPos) return;
    this.world.each(Npc, (id, npc) => {
      const t = this.world.get(id, Transform);
      if (!t) return;
      if (npc.frozen) {
        // A frozen NPC's stored Transform is just wherever it happened to be when last simulated (or its
        // spawn default near `home`) — not a live indicator of relevance. For an NPC whose schedule only
        // ever resolves to one POI (every generic crowd member, most minor named NPCs) that's exactly
        // "home" anyway, so checking the stored position is correct *and* preserves each one's spawn
        // jitter. But a "traveler" (a bespoke multi-POI schedule — e.g. Stauffacher/Fürst/Melchtal walking
        // to the Rütli for the oath) could currently be scheduled somewhere far from home, so re-entry has
        // to be checked against the *analytic* position, not the stale one, or it can never re-enter.
        const traveler = isTraveler(npc.schedule);
        let checkX = t.x, checkZ = t.z;
        let analytic: ReturnType<typeof analyticPosition> | null = null;
        if (traveler) {
          const home = this.homeOf(id, npc);
          if (home) { analytic = analyticPosition(npc.schedule, hour, home, (poiId) => this.poiPos(poiId)); checkX = analytic.x; checkZ = analytic.z; }
        }
        if (dist2(checkX, checkZ, playerPos.x, playerPos.z) <= NPC_SIM_RADIUS) this.reenter(id, npc, t, analytic);
        return;
      }
      const near = dist2(t.x, t.z, playerPos.x, playerPos.z) <= NPC_SIM_RADIUS;
      if (!near) { this.freeze(id, npc); return; }
      if (this.patrols.has(id)) this.stepPatrol(id, t, dt);
      else this.stepSchedule(id, npc, t, hour, dt);
      this.syncMesh(id, t);
      if (npc.activity === 'patrol' && this.isHostileHabsburg) this.checkPatrolTrigger(t, playerPos, id);
    });
  }

  private homeOf(id: EntityId, npc: NpcC): string | undefined {
    const defId = this.defIdOf.get(id);
    const def = defId ? this.content.npcs.get(defId) : undefined;
    return def?.home ?? npc.home;
  }

  /** `analytic`, when given, is the position already computed by `update()`'s re-entry check — reused
   *  here instead of resolving the schedule a second time. */
  private reenter(id: EntityId, npc: NpcC, t: { x: number; y: number; z: number; yaw: number }, analytic: ReturnType<typeof analyticPosition> | null): void {
    npc.frozen = false;
    if (analytic) {
      t.x = analytic.x; t.z = analytic.z; npc.targetPoi = analytic.poiId; npc.activity = analytic.activity;
    } else {
      npc.targetPoi = npc.targetPoi ?? this.homeOf(id, npc);
    }
    t.y = this.worldService.heightAt(t.x, t.z);
    this.spawnMesh(id, t);
  }

  private freeze(id: EntityId, npc: NpcC): void {
    npc.frozen = true;
    const mesh = this.world.get(id, MeshRef);
    if (mesh?.object) {
      disposeObject3D(mesh.object as Object3D, this.dynamicRoot);
      this.world.remove(id, MeshRef);
    }
  }

  private spawnMesh(id: EntityId, t: { x: number; y: number; z: number; yaw: number }): void {
    if (this.world.has(id, MeshRef)) return;
    const r = this.world.get(id, Renderable);
    if (!r) return;
    if (!this.worldService.hasModel(r.modelId)) return; // combat/exploration model registration hasn't happened yet
    const obj = this.worldService.spawnModel(r.modelId, { variant: r.variant });
    obj.position.set(t.x, t.y, t.z);
    obj.rotation.y = t.yaw;
    this.dynamicRoot.add(obj);
    this.world.add(id, MeshRef, { object: obj, kind: 'npc' });
  }

  private syncMesh(id: EntityId, t: { x: number; y: number; z: number; yaw: number }): void {
    const mesh = this.world.get(id, MeshRef);
    if (!mesh?.object) { this.spawnMesh(id, t); return; }
    const obj = mesh.object as Object3D;
    obj.position.set(t.x, t.y, t.z);
    obj.rotation.y = t.yaw;
  }

  private stepSchedule(id: EntityId, npc: NpcC, t: { x: number; y: number; z: number; yaw: number }, hour: number, dt: number): void {
    const home = this.homeOf(id, npc);
    if (!home) return;
    const active = resolveSchedule(npc.schedule, hour, home);
    const dest = this.poiPos(active.poiId) ?? this.poiPos(home);
    if (!dest) return;
    npc.targetPoi = active.poiId;
    npc.activity = active.activity;
    walkToward(t, dest, NPC_WALK_SPEED, dt, this.worldService);
  }

  private stepPatrol(id: EntityId, t: { x: number; y: number; z: number; yaw: number }, dt: number): void {
    const state = this.patrols.get(id);
    if (!state) return;
    const target = state.waypoints[state.index];
    const arrived = walkToward(t, target, NPC_WALK_SPEED * 1.1, dt, this.worldService);
    if (arrived) {
      if (state.forward) {
        state.index++;
        if (state.index >= state.waypoints.length) { state.index = state.waypoints.length - 2; state.forward = false; }
      } else {
        state.index--;
        if (state.index < 0) { state.index = 1; state.forward = true; }
      }
    }
  }

  private checkPatrolTrigger(t: { x: number; z: number }, playerPos: { x: number; z: number }, id: EntityId): void {
    if (!this.patrolLead.has(id)) return;
    const now = performance.now();
    if (now - this.lastTrigger < 15000) return; // cooldown so one patrol can't refire every frame
    if (dist2(t.x, t.z, playerPos.x, playerPos.z) > 8) return;
    this.lastTrigger = now;
    // Task spec: patrols reuse `enc.altdorf-square` (encounters.ts is combat's file; not adding a new id here).
    this.startEncounter('enc.altdorf-square');
  }
}

/** True when a schedule actually sends its NPC to more than one distinct POI (Stauffacher/Fürst/Melchtal
 *  walking to the Rütli for the oath; a few other named NPCs with market-town/home splits) — as opposed
 *  to the common case (generic crowd, most minor named NPCs) whose schedule always resolves to `home`. */
function isTraveler(schedule: { poi: string }[] | undefined): boolean {
  if (!schedule || schedule.length <= 1) return false;
  return new Set(schedule.map((e) => e.poi)).size > 1;
}

/** Deterministic per-entity jitter (so the same NPC always spawns at the same offset within a POI, and
 *  tests are reproducible) rather than an unseeded `Math.random()`. */
function jitterFor(seed: string, radius: number): { x: number; z: number } {
  const rng = new Rng(hashString(seed));
  const a = rng.next() * Math.PI * 2;
  const r = rng.next() * radius;
  return { x: Math.cos(a) * r, z: Math.sin(a) * r };
}

/** Straight-line walk toward `dest`, terrain-following via `heightAt`, refusing to step into water.
 *  Returns true once within `ARRIVE_EPS` of the destination. */
function walkToward(
  t: { x: number; y: number; z: number; yaw: number },
  dest: { x: number; z: number },
  speed: number,
  dt: number,
  worldService: WorldService,
): boolean {
  const dx = dest.x - t.x, dz = dest.z - t.z;
  const d = Math.hypot(dx, dz);
  if (d < ARRIVE_EPS) { t.y = worldService.heightAt(t.x, t.z); return true; }
  const step = Math.min(d, speed * dt);
  const nx = t.x + (dx / d) * step, nz = t.z + (dz / d) * step;
  if (!worldService.isWater(nx, nz)) {
    t.x = nx; t.z = nz;
    t.yaw = Math.atan2(dx, -dz);
  } // else: stand at the shore rather than wade in — avoids walking into water per task spec
  t.y = worldService.heightAt(t.x, t.z);
  return false;
}

function disposeObject3D(obj: Object3D, parent: Object3D): void {
  parent.remove(obj);
  obj.traverse((child) => {
    const anyChild = child as unknown as { geometry?: { dispose(): void }; material?: { dispose(): void } | { dispose(): void }[] };
    anyChild.geometry?.dispose();
    if (Array.isArray(anyChild.material)) anyChild.material.forEach((m) => m.dispose());
    else anyChild.material?.dispose();
  });
}
