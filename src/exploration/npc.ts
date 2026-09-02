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
import { Transform, Renderable, Interactable, Npc, MeshRef, PartyMember, type NpcC } from '@core/components';
import type { ContentRegistry } from '@core/content';
import type { NpcDef, ScheduleEntry } from '@core/schemas';
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

export type EncounterStarter = (encounterId: string, at: { x: number; z: number }) => void;

/** Archetypes without a bespoke generic dialogue map onto the nearest one the quest module defines. */
const GENERIC_DIALOGUE: Record<string, string> = {
  'woman-peasant': 'peasant', fisher: 'boatman', 'militia-spear': 'peasant', 'militia-halberd': 'peasant', 'militia-crossbow': 'peasant',
  'habsburg-footman': 'habsburg-guard', 'habsburg-sergeant': 'habsburg-guard', 'habsburg-crossbowman': 'habsburg-guard', 'habsburg-knight': 'habsburg-guard',
  'habsburg-squire': 'habsburg-guard', 'bailiff-guard': 'habsburg-guard', 'abbey-man-at-arms': 'habsburg-guard', raubritter: 'habsburg-guard',
};

export class NpcSystem {
  /** `EntityId -> content npc id`, so interaction can find the dialogueRoot / display name again without
   *  re-scanning `content.npcs`. */
  readonly defIdOf = new Map<EntityId, string>();
  private readonly patrols = new Map<EntityId, PatrolState>();
  private readonly patrolLead = new Set<EntityId>();
  private lastTrigger = -Infinity;
  private isHostileHabsburg = false;
  /** Draw-call budget safety valve (coordinator alert: 5 295 draw calls at Altdorf; target <= 1 200):
   *  even with the 300 m freeze radius, a single dense village can have more generic crowd than is
   *  worth rendering at once. Named NPCs are exempt (there are only ever a handful near at a time). */
  private readonly maxVisibleCrowd = 60;
  private meshedCount = 0;

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
      if (mesh?.object) { disposeObject3D(mesh.object as Object3D, this.dynamicRoot); this.world.remove(id, MeshRef); }
      if (this.world.has(id, PartyMember)) continue; // recruited companions travel with the party across time-skips
      this.world.destroy(id);
    }
    const kept = new Map<EntityId, string>();
    for (const [id, defId] of this.defIdOf) if (this.world.isAlive(id)) kept.set(id, defId);
    this.defIdOf.clear();
    for (const [id, defId] of kept) this.defIdOf.set(id, defId);
    this.patrols.clear();
    this.patrolLead.clear();
    this.meshedCount = 0;
  }

  populate(chapter: string): void {
    this.clear();
    const inParty = new Set(this.defIdOf.values());
    for (const def of this.content.npcs.values()) {
      if (def.chapters && !def.chapters.includes(chapter)) continue;
      if (inParty.has(def.id)) continue;
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
    this.world.add(id, Interactable, { kind: 'talk', prompt: `Talk to ${def.name}`, dialogueId: def.dialogueRoot ?? this.genericDialogue(def.archetype), enabled: true });
    // frozen=true initially — the lifecycle system unfreezes + snaps position + spawns a mesh on first
    // proximity check, so we don't pay a spawn cost for NPCs the player never gets near this session.
    const npc = this.world.get(id, Npc)!;
    npc.frozen = true;
    // Any schedule entry with no offset of its own (i.e. most minor NPCs' plain daySchedule()) settles
    // at this same spawn jitter rather than drifting onto the POI's exact centre once simulated — see
    // withDefaultOffset's doc comment.
    npc.schedule = withDefaultOffset(npc.schedule, [jitter.x, jitter.z]);
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
    const offset: [number, number] = [jx - x, jz - z]; // the *actual* jitter used, post water-fallback
    const rng = new Rng(hashString(`${homePoi}:${archId}:${salt}:life`));
    const market: [number, number] = [Math.cos(rng.next() * 6.283) * (4 + rng.next() * 6), Math.sin(rng.next() * 6.283) * (4 + rng.next() * 6)];
    const house: [number, number] = [offset[0] * 1.6, offset[1] * 1.6]; // out toward the ring of houses
    const genericDef: NpcDef = {
      ...arch, id: `${homePoi}.${archId}.${salt}`, home: homePoi, role: 'generic',
      schedule: [
        { hour: 6, poi: 'home', activity: 'work', offset },
        { hour: 11 + Math.floor(rng.next() * 3), poi: 'home', activity: 'market', offset: market },
        { hour: 17 + Math.floor(rng.next() * 2), poi: 'home', activity: 'tavern', offset: [market[0] * 0.5, market[1] * 0.5] },
        { hour: 21 + Math.floor(rng.next() * 2), poi: 'home', activity: 'sleep', offset: house },
      ],
    };
    const id = this.party.createCharacter(genericDef);
    const t = this.world.get(id, Transform)!;
    t.x = jx; t.y = this.worldService.heightAt(jx, jz); t.z = jz;
    this.world.add(id, Interactable, { kind: 'talk', prompt: `Talk to ${arch.name}`, dialogueId: this.genericDialogue(archId), enabled: true });
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
        npc.defId = def.id;
        this.patrols.set(id, { waypoints, index: 1, forward: true });
        if (leadId === null) leadId = id;
      }
      if (leadId !== null) this.patrolLead.add(leadId);
    }
  }

  private genericDialogue(archetype: string): string {
    const direct = `dlg.generic.${archetype}`;
    if (this.content.dialogues.has(direct)) return direct;
    const mapped = `dlg.generic.${GENERIC_DIALOGUE[archetype] ?? 'peasant'}`;
    return this.content.dialogues.has(mapped) ? mapped : 'dlg.generic.peasant';
  }

  /** Rebuild patrol state for patrol entities restored from a save (they carry `activity: 'patrol'`). */
  rebindPatrols(): void {
    if (this.patrols.size > 0) return;
    this.world.each(Npc, (id, npc) => {
      if (npc.activity !== 'patrol') return;
      const road = ROADS.find((rd) => npc.defId.startsWith(`patrol.${rd.id}.`));
      if (!road) return;
      const waypoints = road.via.map((pid) => PLACES[pid]).filter(Boolean).map((p) => ({ x: p.x, z: p.z }));
      this.patrols.set(id, { waypoints, index: 1, forward: true });
      if (npc.defId.endsWith('.0')) this.patrolLead.add(id);
    });
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
      if (this.world.has(id, PartyMember) && npc.frozen) { npc.frozen = false; t.x = playerPos.x - 2; t.z = playerPos.z + 1.5; t.y = this.worldService.heightAt(t.x, t.z); this.spawnMesh(id, t); }
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
        if (dist2(checkX, checkZ, playerPos.x, playerPos.z) <= NPC_SIM_RADIUS
          && (!npc.generic || this.meshedCount < this.maxVisibleCrowd)) this.reenter(id, npc, t, analytic);
        return;
      }
      if (this.world.has(id, PartyMember)) { this.stepFollow(id, t, playerPos, dt); this.syncMesh(id, t); return; }
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
      this.meshedCount--;
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
    this.meshedCount++;
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
    const base = this.poiPos(active.poiId) ?? this.poiPos(home);
    if (!base) return;
    // Apply the entry's local offset (same as analyticPosition/reenter) so a walking-and-arrived NPC
    // settles at its spread-out gathering spot instead of drifting back onto the POI's exact centre —
    // where the player often stands too (e.g. a scripted gathering at the Rütli).
    const [ox, oz] = active.offset ?? [0, 0];
    const dest = { x: base.x + ox, z: base.z + oz };
    npc.targetPoi = active.poiId;
    npc.activity = active.activity;
    const arrived = walkToward(t, dest, NPC_WALK_SPEED, dt, this.worldService);
    const asleep = active.activity === 'sleep' && arrived;
    const it = this.world.get(id, Interactable);
    if (it) it.enabled = !asleep;
    const mesh = this.world.get(id, MeshRef);
    if (mesh?.object) (mesh.object as Object3D).visible = !asleep; // indoors
  }

  /** Party companions trail the player at 2–3 m; a companion left far behind (fast travel, teleport) is snapped. */
  private stepFollow(id: EntityId, t: { x: number; y: number; z: number; yaw: number }, playerPos: { x: number; z: number }, dt: number): void {
    const d = dist2(t.x, t.z, playerPos.x, playerPos.z);
    if (d > 60) { t.x = playerPos.x - 2; t.z = playerPos.z + 1.5; t.y = this.worldService.heightAt(t.x, t.z); return; }
    if (d < 2.5) return;
    const slot = (id % 3) - 1; // spread three companions across the player's back
    const dest = { x: playerPos.x + slot * 1.8, z: playerPos.z + 2.2 };
    walkToward(t, dest, Math.min(6.5, 2 + d), dt, this.worldService);
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
    this.startEncounter('enc.habsburg-patrol', { x: playerPos.x, z: playerPos.z });
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

/** Gives every schedule entry that doesn't already carry its own `offset` this NPC's spawn jitter, so
 *  `stepSchedule`/`analyticPosition` settle it back at the same spread-out spot it was jittered to at
 *  spawn — not the POI's exact centre (where the player, and every other NPC with no offset of its own,
 *  would otherwise also converge; see the Rütli-gathering `offset`s in `content/npcs.ts` for the case
 *  where a bespoke offset per entry is wanted instead). Returns a fresh array — never mutates the
 *  original `NpcDef.schedule`, which content may share across spawns/tests. */
function withDefaultOffset(schedule: ScheduleEntry[], fallback: [number, number]): ScheduleEntry[] {
  // activity-specific spots so a named NPC visibly moves through the day: work at the spawn jitter,
  // market by the well, tavern/church a little inward, sleep out at the houses
  const byActivity: Record<string, [number, number]> = {
    market: [fallback[0] * 0.35, fallback[1] * 0.35],
    tavern: [fallback[0] * 0.6 + 3, fallback[1] * 0.6 - 2],
    church: [fallback[0] * 0.4, fallback[1] * 0.4 - 8],
    sleep: [fallback[0] * 1.6, fallback[1] * 1.6],
  };
  return schedule.map((e) => (e.offset ? e : { ...e, offset: byActivity[e.activity] ?? fallback }));
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

/** Geometry only: materials are shared library instances still used by other meshes. */
function disposeObject3D(obj: Object3D, parent: Object3D): void {
  parent.remove(obj);
  obj.traverse((child) => { (child as unknown as { geometry?: { dispose(): void } }).geometry?.dispose(); });
}
