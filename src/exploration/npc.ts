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
import type { CharacterHandle, PartyService, WorldService } from '@core/services';
import { Rng, hashString } from '@core/rng';
import { dist2 } from '@core/math';
import { resolveCollisions, type Collider } from './colliders';
import { generateLayout, type HeightProbe } from './layout';
import { anchorsForLayout } from './settlements';
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

/** Per-POI activity anchors (critic N2): world coords of the settlement's well/church/inn/house
 *  pads, built by settlements.ts from the generated layout and passed into `populate()` so named
 *  NPCs' day-parts spread across real features instead of the ±6 m spawn jitter. Offsets stored are
 *  relative to the POI centre (the schedule/analytic machinery adds them onto the POI position). */
export interface NpcAnchors {
  well: { x: number; z: number } | null;
  church: { x: number; z: number } | null;
  inn: { x: number; z: number } | null;
  houses: { x: number; z: number }[];
}

export type EncounterStarter = (encounterId: string, at: { x: number; z: number }) => void;

/** `char.*` model ids owned by exploration's own procedural factories (humanoid.ts, playerModel.ts)
 *  — these stay on `spawnModel` even when the world offers `spawnCharacter`, whose animation-library
 *  look table would otherwise reskin them (N5). Combat registers its own set after exploration. */
const PROCEDURAL_CHAR_MODELS = new Set(['char.player']);

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
  /** Current game state (`ctx.state.state`), pushed by exploration/index.ts each frame; undefined in
   *  unit-test fakes, which behave as `explore`. Gates patrol encounter triggers (never interrupt a
   *  dialogue/cutscene/combat/loading scene). */
  gameState: string | undefined = undefined;
  /** Draw-call budget safety valve (coordinator alert: 5 295 draw calls at Altdorf; target <= 1 200):
   *  even with the 300 m freeze radius, a single dense village can have more generic crowd than is
   *  worth rendering at once. Named NPCs are exempt (there are only ever a handful near at a time). */
  private readonly maxVisibleCrowd = 60;
  private meshedCount = 0;
  /** Ambient bark timer: at most one one-liner per BARK_INTERVAL, only when the UI sink is wired. */
  private barkAcc = 0;
  /** HUD toast sink for ambient barks; unset in unit tests (barks stay silent, still queryable). */
  private emitBark: ((msg: string) => void) | null = null;

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

  /** Wire the HUD toast sink for ambient barks (index.ts passes ui.toast). Unset = silent. */
  setBarkSink(sink: ((msg: string) => void) | null): void {
    this.emitBark = sink;
  }

  /** Test hook: resolve the bark an NPC would currently utter (null = none eligible), without emitting. */
  barkFor(id: EntityId, hour: number): string | null {
    const npc = this.world.get(id, Npc);
    if (!npc || npc.frozen || npc.activity === 'sleep' || this.world.has(id, PartyMember)) return null;
    return pickBark(this.defIdOf.get(id) ?? npc.defId, npc, hour);
  }

  /** Removes every previously-populated NPC entity (used before a fresh `populate()` on new-game/load,
   *  so re-running a scenario never doubles the cast). */
  clear(): void {
    for (const id of this.world.query(Npc)) {
      const mesh = this.world.get(id, MeshRef);
      if (mesh?.object) {
        if (mesh.kind === 'npc-character') {
          (mesh.object as CharacterHandle).dispose();
          this.dynamicRoot.remove((mesh.object as CharacterHandle).object);
        } else {
          disposeObject3D(mesh.object as Object3D, this.dynamicRoot);
        }
        this.world.remove(id, MeshRef);
      }
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

  populate(chapter: string, anchors?: Map<string, NpcAnchors>): void {
    this.clear();
    const inParty = new Set(this.defIdOf.values());
    // Production (index.ts) passes the real settlement anchors; when omitted (tests, probes,
    // external callers) build them from the generated layouts against the live height probe so
    // named NPCs still anchor to layout features instead of the spawn jitter.
    const map = anchors ?? this.buildAnchors();
    for (const def of this.content.npcs.values()) {
      if (def.chapters && !def.chapters.includes(chapter)) continue;
      if (inParty.has(def.id)) continue;
      this.spawnNamed(def, map.get(def.home));
    }
    for (const poi of this.content.pois.values()) {
      if (!poi.population) continue;
      for (const [archId, count] of Object.entries(poi.population)) {
        for (let i = 0; i < count; i++) this.spawnGenericFromArchetype(archId, poi.id, poi.x, poi.z, i);
      }
    }
    this.spawnPatrols();
  }

  private colliders: Collider[] = [];
  /** settlement building footprints, so no one spawns inside a house or the church */
  setColliders(c: Collider[]): void { this.colliders = c; }
  /** per-POI activity anchors built from the generated layouts (fallback when `populate()` gets no
   *  anchors map — tests, probes, external spawn callers). Costs one layout pass per settlement. */
  private buildAnchors(): Map<string, NpcAnchors> {
    const probe: HeightProbe = { heightAt: (x, z) => this.worldService.heightAt(x, z), isWater: (x, z) => this.worldService.isWater(x, z) };
    const out = new Map<string, NpcAnchors>();
    for (const poi of this.content.pois.values()) {
      try {
        out.set(poi.id, anchorsForLayout(generateLayout({ id: poi.id, kind: poi.kind, x: poi.x, z: poi.z, population: poi.population }, probe)));
      } catch { /* keep populate() total: a layout that throws leaves this POI unanchored */ }
    }
    return out;
  }
  /** a spawn point on dry land outside every building footprint (falls back to the POI centre) */
  private dryStand(cx: number, cz: number, x: number, z: number): { x: number; z: number } {
    const p = { x, z };
    if (this.worldService.isWater(p.x, p.z)) { p.x = cx; p.z = cz; }
    resolveCollisions(p, this.colliders, 0.6);
    if (this.worldService.isWater(p.x, p.z)) { p.x = cx; p.z = cz; resolveCollisions(p, this.colliders, 0.6); }
    return p;
  }

  spawnNamed(def: NpcDef, anchors?: NpcAnchors): EntityId {
    const pos = this.poiPos(def.home) ?? { x: 0, z: 0 };
    const id = this.party.createCharacter(def);
    const jitter = jitterFor(def.id, 6);
    const stand = this.dryStand(pos.x, pos.z, pos.x + jitter.x, pos.z + jitter.z);
    const x = stand.x, z = stand.z;
    jitter.x = x - pos.x; jitter.z = z - pos.z;
    const t = this.world.get(id, Transform)!;
    t.x = x; t.y = this.worldService.heightAt(x, z); t.z = z; t.yaw = 0;
    // Falls back to the quest builder's `dlg.generic.<archetype>` (requests/quest-1.md) for the vast
    // majority of named NPCs that carry no bespoke `dialogueRoot` of their own.
    this.world.add(id, Interactable, { kind: 'talk', prompt: `Talk to ${def.name}`, dialogueId: def.dialogueRoot ?? this.genericDialogue(def.archetype), enabled: true });
    // frozen=true initially — the lifecycle system unfreezes + snaps position + spawns a mesh on first
    // proximity check, so we don't pay a spawn cost for NPCs the player never gets near this session.
    const npc = this.world.get(id, Npc)!;
    npc.frozen = true;
    // Any schedule entry with no offset of its own (i.e. most minor NPCs' plain daySchedule()) is
    // anchored to the settlement's layout features (well/church/inn/houses) instead of the spawn
    // jitter (critic N2) — see withDefaultOffset's doc comment.
    npc.schedule = withDefaultOffset(npc.schedule, [jitter.x, jitter.z], def, pos, anchors);
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
    const stand = this.dryStand(x, z, x + jitter.x, z + jitter.z); // dry, and outside every building footprint
    const jx = stand.x, jz = stand.z;
    const offset: [number, number] = [jx - x, jz - z]; // the *actual* jitter used, post water-fallback
    const rng = new Rng(hashString(`${homePoi}:${archId}:${salt}:life`));
    // midday on the square: a ring 5–16 m out from the well (the well itself is a collider), so a village of
    // twenty does not pile up on one spot; evenings drift toward the inn side rather than back onto the well
    const ma = rng.next() * 6.283, mr = 5 + rng.next() * 11;
    const market: [number, number] = [Math.cos(ma) * mr, Math.sin(ma) * mr];
    const tavern: [number, number] = [Math.cos(ma + 1.2) * (8 + rng.next() * 8), Math.sin(ma + 1.2) * (8 + rng.next() * 8)];
    const house: [number, number] = [offset[0] * 1.6, offset[1] * 1.6]; // out toward the ring of houses
    const genericDef: NpcDef = {
      ...arch, id: `${homePoi}.${archId}.${salt}`, home: homePoi, role: 'generic',
      schedule: [
        { hour: 6, poi: 'home', activity: 'work', offset },
        { hour: 11 + Math.floor(rng.next() * 3), poi: 'home', activity: 'market', offset: market },
        { hour: 17 + Math.floor(rng.next() * 2), poi: 'home', activity: 'tavern', offset: tavern },
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
   *  patrols and (if hostile) trigger a fight when a patrol reaches the player. Barks (ambient one-liners
   *  shown as HUD toasts) fire from the same pass. */
  update(dt: number, playerPos: { x: number; z: number } | null, hour: number): void {
    if (!playerPos) return;
    this.barkAcc += dt;
    const barkReady = this.barkAcc >= BARK_INTERVAL && this.emitBark;
    if (barkReady) this.barkAcc = 0;
    // Pick at most one barker per interval: the nearest unfrozen bark-eligible NPC already solved below
    // is found with a two-pass approach — first pass resolves lifecycle, second picks the bark. To keep
    // the walk single-pass, candidates are collected inline and the bark resolves after the loop.
    const barkCandidate: { id: EntityId; npc: NpcC; d2: number } = { id: -1, npc: null as unknown as NpcC, d2: Infinity };
    let hasBarkCandidate = false;
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
      if (barkReady && npc.activity !== 'sleep') {
        const d2 = dist2(t.x, t.z, playerPos.x, playerPos.z);
        if (d2 <= BARK_RADIUS * BARK_RADIUS && d2 < barkCandidate.d2) { barkCandidate.id = id; barkCandidate.npc = npc; barkCandidate.d2 = d2; hasBarkCandidate = true; }
      }
    });
    if (hasBarkCandidate) this.fireBark(barkCandidate.id, barkCandidate.npc, hour);
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
      if (mesh.kind === 'npc-character') {
        (mesh.object as CharacterHandle).dispose();
        this.dynamicRoot.remove((mesh.object as CharacterHandle).object);
      } else {
        disposeObject3D(mesh.object as Object3D, this.dynamicRoot);
      }
      this.world.remove(id, MeshRef);
      this.meshedCount--;
    }
  }

  private spawnMesh(id: EntityId, t: { x: number; y: number; z: number; yaw: number }): void {
    if (this.world.has(id, MeshRef)) return;
    const r = this.world.get(id, Renderable);
    if (!r) return;
    if (!this.worldService.hasModel(r.modelId)) return; // combat/exploration model registration hasn't happened yet
    // Preferred path (critic N5): the rigged character library — its handle drives the walk cycle
    // from actual velocity via setSpeed, and falls back to auto-inferred speed when untouched.
    const handle = this.charHandleOf(id, r);
    if (handle) {
      this.dynamicRoot.add(handle.object);
      handle.object.position.set(t.x, t.y, t.z);
      handle.object.rotation.y = t.yaw;
      this.world.add(id, MeshRef, { object: handle, kind: 'npc-character' });
      this.meshedCount++;
      return;
    }
    // seed = entity id: the same villager keeps the same face/cloth across freeze/re-entry and reloads (N5)
    const obj = this.worldService.spawnModel(r.modelId, { variant: r.variant, seed: id });
    obj.position.set(t.x, t.y, t.z);
    obj.rotation.y = t.yaw;
    this.dynamicRoot.add(obj);
    this.world.add(id, MeshRef, { object: obj, kind: 'npc' });
    this.meshedCount++;
  }

  private syncMesh(id: EntityId, t: { x: number; y: number; z: number; yaw: number }): void {
    const mesh = this.world.get(id, MeshRef);
    if (!mesh?.object) { this.spawnMesh(id, t); return; }
    if (mesh.kind === 'npc-character') {
      const handle = mesh.object as CharacterHandle;
      handle.object.position.set(t.x, t.y, t.z);
      handle.object.rotation.y = t.yaw;
      return;
    }
    const obj = mesh.object as Object3D;
    obj.position.set(t.x, t.y, t.z);
    obj.rotation.y = t.yaw;
  }

  /** Rigged handle for an NPC mesh when the world service offers `spawnCharacter` (N5). The
   *  `char.<archetype>` model ids exploration registers are animation-library backed, so the
   *  procedural-fallback ids stay on `spawnModel`; everything else prefers the rigged path for its
   *  velocity-driven walk cycle. Per-entity seed keeps the look stable across freeze/re-entry. */
  private charHandleOf(id: EntityId, r: { modelId: string; variant?: string }): CharacterHandle | null {
    const spawn = this.worldService.spawnCharacter;
    if (!spawn) return null;
    if (!r.modelId.startsWith('char.')) return null;
    if (PROCEDURAL_CHAR_MODELS.has(r.modelId)) return null;
    try {
      return spawn.call(this.worldService, r.modelId.slice(5), { variant: r.variant, seed: id });
    } catch {
      return null;
    }
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
    const arrived = walkToward(t, dest, NPC_WALK_SPEED, dt, this.worldService, this.charHandle(id), this.colliders);
    // Settlement-life poses (3.5): locomotion owns the handle while walking; once arrived, tavern
    // evenings sit and work parties work. walkToward's setSpeed(0) on arrival only blends to idle, so
    // the pose call after it wins for settled NPCs without fighting the walk cycle.
    if (arrived) this.poseForActivity(id, active.activity);
    const asleep = active.activity === 'sleep' && arrived;
    const it = this.world.get(id, Interactable);
    if (it) it.enabled = !asleep;
    const mesh = this.world.get(id, MeshRef);
    if (mesh?.object) {
      const obj = mesh.kind === 'npc-character' ? (mesh.object as CharacterHandle).object : (mesh.object as Object3D);
      obj.visible = !asleep; // indoors
    }
  }

  /** The rigged handle when this NPC's mesh is one (else null — caller passes it to walkToward). */
  private charHandle(id: EntityId): CharacterHandle | null {
    const mesh = this.world.get(id, MeshRef);
    return mesh?.kind === 'npc-character' ? (mesh.object as CharacterHandle) : null;
  }

  /** Settlement-life pose hooks (3.5): a seated tavern evening and working wall-gang read at a glance.
   *  Driven from the schedule activity the NPC already resolved this frame — no new state, no new
   *  schedule values. One-shots (talk/cheer) are NOT auto-played here: dialogue and combat own those. */
  private poseForActivity(id: EntityId, activity: string | undefined): void {
    if (activity !== 'tavern' && activity !== 'work') return;
    const handle = this.charHandle(id);
    if (!handle) return;
    // play() on a loop returns immediately; re-issuing every frame would restart the crossfade every
    // frame, so only fire when the handle isn't already holding that loop.
    const want = activity === 'tavern' ? 'sit' : 'work';
    if (handle.currentAnimName() === want) return;
    void handle.play(want, { loop: true });
  }

  /** Party companions trail the player at 2–3 m; a companion left far behind (fast travel, teleport) is snapped. */
  private stepFollow(id: EntityId, t: { x: number; y: number; z: number; yaw: number }, playerPos: { x: number; z: number }, dt: number): void {
    const d = dist2(t.x, t.z, playerPos.x, playerPos.z);
    if (d > 60) { t.x = playerPos.x - 2; t.z = playerPos.z + 1.5; t.y = this.worldService.heightAt(t.x, t.z); return; }
    if (d < 2.5) return;
    const slot = ((this.world.get(id, PartyMember)?.slot ?? 1) % 3) - 1; // party slot → left/centre/right behind the player
    const dest = { x: playerPos.x + slot * 1.8, z: playerPos.z + 2.2 };
    walkToward(t, dest, Math.min(6.5, 2 + d), dt, this.worldService, this.charHandle(id), this.colliders);
  }

  private stepPatrol(id: EntityId, t: { x: number; y: number; z: number; yaw: number }, dt: number): void {
    const state = this.patrols.get(id);
    if (!state) return;
    const target = state.waypoints[state.index];
    const arrived = walkToward(t, target, NPC_WALK_SPEED * 1.1, dt, this.worldService, this.charHandle(id), this.colliders);
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
    // Never interrupt an active scene: quest/dialogue/cutscene/loading own the screen, and the quest
    // module's own {encounter} effects own story fights — a proximity patrol must not double-fire them.
    // NpcSystem has no state-machine handle, soNpcSystem.update receives the current game state from
    // exploration/index.ts (which reads ctx.state.state); unit-test fakes may omit it (undefined = explore).
    if (this.gameState !== undefined && this.gameState !== 'explore') return;
    const now = performance.now();
    if (now - this.lastTrigger < 15000) return; // cooldown so one patrol can't refire every frame
    if (dist2(t.x, t.z, playerPos.x, playerPos.z) > 8) return;
    // Authored road over player position: the fight must happen on walkable ground, not wherever the
    // player happens to stand (water, steep shore, inside a house). The override location is snapped
    // to dry, gentle terrain near the patrol before combat starts.
    const at = this.snapEncounterGround(playerPos.x, playerPos.z, t.x, t.z);
    if (!at) return;
    this.lastTrigger = now;
    this.startEncounter('enc.habsburg-patrol', at);
  }

  /** Snap a patrol-fight location to dry, walkable ground near the meeting point. Null = no safe
   *  ground found, caller must not start the encounter. */
  private snapEncounterGround(px: number, pz: number, fx: number, fz: number): { x: number; z: number } | null {
    const w = this.worldService;
    const ok = (x: number, z: number): boolean => !w.isWater(x, z) && w.slopeAt(x, z) <= 0.7;
    if (ok(px, pz)) return { x: px, z: pz };
    if (ok(fx, fz)) return { x: fx, z: fz };
    for (const [ox, oz] of [[4, 0], [-4, 0], [0, 4], [0, -4], [8, 0], [-8, 0], [0, 8], [0, -8]] as [number, number][]) {
      if (ok(px + ox, pz + oz)) return { x: px + ox, z: pz + oz };
    }
    return null;
  }

  /** Emit one ambient bark for the chosen NPC (seeded by entity id + hour so it is stable, not chatty). */
  private fireBark(id: EntityId, npc: NpcC, hour: number): void {
    if (!this.emitBark) return;
    const line = pickBark(this.defIdOf.get(id) ?? npc.defId, npc, hour);
    if (line) this.emitBark(line);
  }
}

/** Ambient bark tuning: at most one line per interval, only within earshot, never from sleepers. */
const BARK_INTERVAL = 45;
const BARK_RADIUS = 25;

/**
 * Ambient one-liner tables (3.3): short period-register remarks keyed by what the NPC *is* (def id for a
 * few named voices, archetype/faction/activity otherwise). Shown as HUD toasts, never modal dialogue;
 * no quest state reads, no quest state writes — pure colour. Deterministic per (npc, hour): the same
 * NPC at the same hour always says the same line, so barks are stable under freeze/re-entry.
 */
const BARK_TABLES: { match: (defId: string, npc: NpcC) => boolean; lines: string[] }[] = [
  { match: (defId) => defId.startsWith('patrol.'), lines: ['"Papers? No — walk on, and keep your hands where I see them."', '"The Landvogt pays us to watch this road. So we watch."'] },
  { match: (_d, npc) => npc.activity === 'guard', lines: ['"Nothing to report. That is the whole point of standing here."', '"Move along unless the Vogt\'s business is yours."'] },
  { match: (_d, npc) => npc.activity === 'market', lines: ['"Tolls up again, they say. When are they not?"', '"Fine cheese today — if the toll-men leave any of it."'] },
  { match: (_d, npc) => npc.activity === 'tavern', lines: ['"Sit a while. The road will still be there tomorrow."', '"They say Schwyz grazes where it pleases now. Drink to that, or don\'t."'] },
  { match: (_d, npc) => npc.activity === 'church', lines: ['"Bei Sankt Verena, keep your voice down in here."', '"The hours keep whether the valley does or not."'] },
  { match: (_d, npc) => npc.activity === 'work', lines: ['"Good grazing this year, God willing it stays that way."', '"Mind the mist up high — a man can walk off an edge he never saw."'] },
];

function pickBark(defId: string, npc: NpcC, hour: number): string | null {
  for (const table of BARK_TABLES) {
    if (!table.match(defId, npc)) continue;
    const rng = new Rng(hashString(`${defId}:${Math.floor(hour)}`));
    return table.lines[Math.floor(rng.next() * table.lines.length)];
  }
  return null;
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

/** Anchors every schedule entry that doesn't already carry its own `offset` to the settlement's
 *  layout features (critic N2) instead of the spawn jitter, so a named NPC visibly moves through
 *  the day: work at the spawn jitter, innkeeper/tavern at the `inn` pad, priest/church at the
 *  church, market at the well ± 8 m, sleep at the nearest `house` pad. Preserved behaviour:
 *  - entries with a bespoke `offset` are untouched (Rütli-gathering offsets, traveler schedules);
 *  - `guard`/`patrol`-style single-entry schedules stay at the spawn jitter (stand post);
 *  - multi-POI schedules (travelers) keep the jitter fallback, so steps to another POI resolve
 *    around that POI's centre rather than this home's features;
 *  - without anchors (tests, POIs with no layout) this degrades to the old jitter behaviour.
 *  Relative offsets are clamped to ±40 m of the POI centre so a far-flung house ring can't strand
 *  an NPC outside the freeze/mesh budget. Returns a fresh array — never mutates the
 *  original `NpcDef.schedule`, which content may share across spawns/tests. */
export function withDefaultOffset(
  schedule: ScheduleEntry[],
  fallback: [number, number],
  def?: NpcDef,
  homePos?: { x: number; z: number },
  anchors?: NpcAnchors,
): ScheduleEntry[] {
  const rel = (p: { x: number; z: number } | null): [number, number] | null => {
    if (!p || !homePos) return null;
    const dx = Math.max(-40, Math.min(40, p.x - homePos.x));
    const dz = Math.max(-40, Math.min(40, p.z - homePos.z));
    return [dx, dz];
  };
  const well = rel(anchors?.well ?? null);
  const church = rel(anchors?.church ?? null);
  const inn = rel(anchors?.inn ?? null);
  const houseFor = (seed: [number, number]): [number, number] | null => {
    if (!anchors?.houses.length || !homePos) return null;
    let best = anchors.houses[0], bestD = Infinity;
    const sx = homePos.x + seed[0], sz = homePos.z + seed[1];
    for (const h of anchors.houses) {
      const d = Math.hypot(h.x - sx, h.z - sz);
      if (d < bestD) { bestD = d; best = h; }
    }
    return rel(best);
  };
  const seed = jitterFor(def?.id ?? 'npc', 8);
  const market: [number, number] = well
    ? [well[0] + Math.cos(seed.x * 3.1) * 8, well[1] + Math.sin(seed.x * 3.1) * 8]
    : [fallback[0] * 0.35, fallback[1] * 0.35];
  // role-anchored spots: innkeeper tends the inn, priest the church, everyone else the tavern-side
  const isInnkeeper = (def?.archetype ?? '') === 'innkeeper';
  const isPriest = (def?.archetype ?? '') === 'monk';
  const tavernSpot: [number, number] = isInnkeeper && inn ? inn
    : inn ?? [fallback[0] * 0.6 + 3, fallback[1] * 0.6 - 2];
  const churchSpot: [number, number] = isPriest && church ? church
    : church ?? [fallback[0] * 0.4, fallback[1] * 0.4 - 8];
  const sleepSpot: [number, number] = houseFor([fallback[0] * 1.6, fallback[1] * 1.6])
    ?? [fallback[0] * 1.6, fallback[1] * 1.6];
  const singlePost = schedule.length <= 1;
  const byActivity: Record<string, [number, number]> = {
    market, tavern: tavernSpot, church: churchSpot, sleep: sleepSpot,
  };
  return schedule.map((e) => {
    if (e.offset) return e;
    if (singlePost) return { ...e, offset: [...fallback] as [number, number] };
    if (e.poi !== 'home' && e.poi !== def?.home) return { ...e, offset: [...fallback] as [number, number] };
    return { ...e, offset: byActivity[e.activity] ?? fallback };
  });
}

/** Straight-line walk toward `dest`, terrain-following via `heightAt`, refusing to step into water.
 *  Returns true once within `ARRIVE_EPS` of the destination. Drives the rigged `CharacterHandle`
 *  walk cycle from the actual travelled speed when the mesh is one (critic N5); procedural meshes
 *  infer speed from owner movement themselves. */
function walkToward(
  t: { x: number; y: number; z: number; yaw: number },
  dest: { x: number; z: number },
  speed: number,
  dt: number,
  worldService: WorldService,
  handle?: CharacterHandle | null,
  colliders?: Collider[],
): boolean {
  const dx = dest.x - t.x, dz = dest.z - t.z;
  const d = Math.hypot(dx, dz);
  if (d < ARRIVE_EPS) { t.y = worldService.heightAt(t.x, t.z); handle?.setSpeed(0); return true; }
  const step = Math.min(d, speed * dt);
  const nx = t.x + (dx / d) * step, nz = t.z + (dz / d) * step;
  // Player parity (player.ts MAX_SLOPE 40°): NPCs must not scale cliffs the player cannot climb,
  // and must not walk through houses/walls the player collides with.
  if (!worldService.isWater(nx, nz) && worldService.slopeAt(nx, nz) <= 0.7) {
    const p = { x: nx, z: nz };
    if (colliders) resolveCollisions(p, colliders, 0.4);
    if (!worldService.isWater(p.x, p.z)) {
      t.x = p.x; t.z = p.z;
      t.yaw = Math.atan2(dx, -dz);
      handle?.setSpeed(step / Math.max(dt, 1e-6));
    } else {
      handle?.setSpeed(0);
    }
  } else {
    handle?.setSpeed(0);
  } // else: stand rather than wade in or climb — avoids water/cliff walking per task spec
  t.y = worldService.heightAt(t.x, t.z);
  return false;
}

/** Geometry only: materials are shared library instances still used by other meshes. */
function disposeObject3D(obj: Object3D, parent: Object3D): void {
  parent.remove(obj);
  obj.traverse((child) => { (child as unknown as { geometry?: { dispose(): void } }).geometry?.dispose(); });
}
