/**
 * Exploration module entry point. ARCHITECTURE.md §4/§5.2. Registers a full `ExplorationService` plus every
 * system that drives free-roam play: player movement/camera, NPC life, POI discovery/fast-travel,
 * interaction, HUD feed. See `src/exploration/{player,camera,npc,poi,interact,hud,layout,schedule,
 * colliders,settlements,playerModel}.ts` for the pieces this file wires together.
 */
import { Group, Object3D } from 'three';
import type { GameContext } from '@core/context';
import type { EntityId, World } from '@core/ecs';
import { Transform, Character, PartyMember, Renderable, MeshRef, Player, Name, Poi } from '@core/components';
import type { NpcDef, PoiDef } from '@core/schemas';
import type { ExplorationEvents, ExplorationService, WorldService } from '@core/services';
import { EventBus } from '@core/events';

import { CameraRigImpl } from './camera';
import { PlayerController } from './player';
import { buildPlayerModel, animateWalkCycle } from './playerModel';
import { registerExplorationHumanoids } from './humanoid';
import { NpcSystem } from './npc';
import { PoiSystem } from './poi';
import { InteractSystem, spawnContainers, spawnBoatTravel, spawnTradeAndRest } from './interact';
import { updateHud } from './hud';
import { buildSettlements, type BuiltSettlements } from './settlements';
import { resolveCollisions, type Collider } from './colliders';

class ExplorationServiceImpl implements ExplorationService {
  private readonly bus = new EventBus<ExplorationEvents>();
  private readonly cameraRig: CameraRigImpl;
  private readonly controller: PlayerController;
  private readonly npcSystem: NpcSystem;
  private readonly poiSystem: PoiSystem;
  private readonly interactSystem: InteractSystem;
  private readonly settlementsGroup: Group;
  private colliders: Collider[] = [];
  private controlEnabled = true;
  private lastChapter = 'prologue-1291';
  private playerMesh: Object3D | null = null;
  private lastPrompt: string | null = null;

  constructor(private ctx: GameContext, private world: WorldService) {
    const roots = world.getSceneRoots();
    this.settlementsGroup = new Group();
    this.settlementsGroup.name = 'exploration-settlements';
    roots.props.add(this.settlementsGroup);

    if (!world.hasModel('char.player')) world.registerModel('char.player', () => buildPlayerModel());
    registerExplorationHumanoids(world);

    this.cameraRig = new CameraRigImpl(ctx.gfx.camera, world, () => {
      const id = this.getPlayer();
      if (id === null) return null;
      const t = ctx.world.get(id, Transform);
      return t ? { x: t.x, y: t.y, z: t.z, yaw: t.yaw } : null;
    });
    this.controller = new PlayerController(ctx.canvas, this.cameraRig);
    this.poiSystem = new PoiSystem(ctx.world, ctx.content, ctx.services, this.bus);
    this.interactSystem = new InteractSystem(ctx.world, ctx.content, ctx.services, this.bus);
    this.npcSystem = new NpcSystem(ctx.world, ctx.content, ctx.services.get('party'), world, roots.dynamic, (encId, at) => {
      // A patrol catching a hostile party is exploration's own mechanic (no quest stage owns it), so combat is
      // started here, at the player's position rather than the encounter's authored location.
      this.bus.emit('encounter-trigger', encId, -1);
      const base = ctx.content.encounters.get(encId);
      const encounterOverride = base ? { ...base, location: { x: at.x, z: at.z, yaw: 0 } } : undefined;
      ctx.services.tryGet('combat')?.start(encId, { encounterOverride }).catch((err) => console.error('[exploration] patrol combat.start failed', err));
    });

    ctx.events.on('state-changed', (from, to) => {
      if (to === 'loading') this.teardownTransientMeshes();
      // leaving combat by any door (explore, or an aftermath dialogue/cutscene first) hands the camera back
      if (from === 'combat' && to !== 'combat' && to !== 'paused') this.cameraRig.setMode('follow');
    });
    ctx.events.on('loaded', () => this.rebuildTransientMeshes());
    ctx.events.on('chapter-changed', (chapter) => this.populate(chapter));
  }

  // ---------------- lifecycle ----------------

  private populatedChapter: string | null = null;

  /** Idempotent per chapter: newGame, quest.setChapter and the chapter-changed event all call this. */
  populate(chapter: string): void {
    if (this.populatedChapter === chapter && this.ctx.world.count(Poi) > 0) return;
    this.populatedChapter = chapter;
    this.lastChapter = chapter;
    // settlements (and their colliders) first, so NPCs can be kept out of house footprints when they spawn
    this.rebuildSettlements();
    this.npcSystem.populate(chapter);
    this.poiSystem.spawnPoiEntities();
    spawnContainers(this.ctx.world, this.ctx.content);
    spawnBoatTravel(this.ctx.world, this.ctx.content);
    spawnTradeAndRest(this.ctx.world, this.ctx.content);
  }

  private rebuildSettlements(): void {
    for (const child of [...this.settlementsGroup.children]) disposeObject3D(child);
    this.settlementsGroup.clear();
    const built: BuiltSettlements = buildSettlements(this.ctx.content, this.world, this.settlementsGroup, this.lastChapter === 'ch1-1307');
    this.colliders = built.colliders;
    this.settlementsChapter = this.lastChapter;
    this.npcSystem.setColliders(built.colliders);
    this.cameraRig.setColliders(built.colliders);
  }
  private settlementsChapter: string | null = null;

  private teardownTransientMeshes(): void {
    if (this.playerMesh) { disposeObject3D(this.playerMesh); this.playerMesh = null; }
    this.npcSystem.clear();
  }

  private rebuildTransientMeshes(): void {
    // Player mesh now; NPC meshes lazily by proximity; patrol state and settlement geometry rebuilt from the
    // restored entities / content.
    const id = this.getPlayer();
    if (id !== null) this.ensurePlayerMesh(id);
    this.npcSystem.rebindPatrols();
    this.populatedChapter = null;
    // a load into another chapter must rebuild the settlement geometry/colliders too (Gessler's hat pole,
    // burnt castles), not only when nothing was built yet (bughunt exploration)
    if (this.settlementsGroup.children.length === 0 || this.settlementsChapter !== this.lastChapter) this.rebuildSettlements();
  }

  // ---------------- player ----------------

  spawnPlayer(at: string | { x: number; z: number }, facingYaw = 0): EntityId {
    const existing = this.getPlayer();
    const pos = typeof at === 'string' ? (this.poiPosition(at) ?? { x: 0, z: 0 }) : at;
    if (existing !== null) {
      this.teleport(existing, pos.x, pos.z, facingYaw);
      return existing;
    }
    const id = this.ctx.world.create('player');
    this.ctx.world.add(id, Player, {});
    this.ctx.world.add(id, Name, { id: 'player', display: 'Player' });
    this.ctx.world.add(id, Character, {});
    this.ctx.world.add(id, Transform, { x: pos.x, y: this.world.heightAt(pos.x, pos.z), z: pos.z, yaw: facingYaw });
    this.ctx.world.add(id, Renderable, { modelId: 'char.player', visible: true });
    this.ctx.world.add(id, PartyMember, { slot: 0, control: 'player' });
    this.cameraRig.setYaw(facingYaw);
    this.ensurePlayerMesh(id);
    this.poiSystem.seedTriggerContainment(pos);
    return id;
  }

  spawnNpc(def: NpcDef, at?: { x: number; z: number }): EntityId {
    const id = this.npcSystem.spawnNamed(def);
    if (at) {
      const t = this.ctx.world.get(id, Transform)!;
      t.x = at.x; t.z = at.z; t.y = this.world.heightAt(at.x, at.z);
    }
    return id;
  }

  getPlayer(): EntityId | null {
    for (const id of this.ctx.world.query(PartyMember)) {
      if (this.ctx.world.get(id, PartyMember)!.control === 'player') return id;
    }
    return null;
  }

  teleport(entity: EntityId, x: number, z: number, yaw?: number): void {
    const t = this.ctx.world.get(entity, Transform);
    if (!t) return;
    // a POI centre is usually its well: land just south of any solid prop instead of inside it
    const p = { x, z };
    for (const c of this.colliders) if (Math.hypot(p.x - c.x, p.z - c.z) < 0.5) { p.z = c.z + 0.5; break; }
    resolveCollisions(p, this.colliders, 0.6);
    t.x = p.x; t.z = p.z; t.y = this.world.heightAt(p.x, p.z);
    if (yaw !== undefined) { t.yaw = yaw; this.cameraRig.setYaw(yaw); }
    if (entity === this.getPlayer()) this.poiSystem.seedTriggerContainment({ x, z });
  }

  setControlEnabled(on: boolean): void {
    this.controlEnabled = on;
    this.controller.setControlEnabled(on);
  }

  getCameraRig(): CameraRigImpl {
    return this.cameraRig;
  }

  /** Keyed off the ECS `MeshRef` component (not just the cached field) so a *new* player entity — a
   *  second `newGame()` in the same page, which the harness's multi-scenario runs can do — gets its own
   *  mesh rather than silently reusing a stale reference from the previous playthrough. */
  private ensurePlayerMesh(id: EntityId): void {
    const existing = this.ctx.world.get(id, MeshRef);
    if (existing) { this.playerMesh = existing.object as Object3D; return; }
    const obj = this.world.spawnModel('char.player');
    this.world.getSceneRoots().dynamic.add(obj);
    this.playerMesh = obj;
    this.ctx.world.add(id, MeshRef, { object: obj, kind: 'player' });
  }

  // ---------------- POIs ----------------

  discover(poiId: string): void { this.poiSystem.discover(poiId); }
  isDiscovered(poiId: string): boolean { return this.poiSystem.isDiscovered(poiId); }
  discovered(): string[] { return this.poiSystem.discoveredIds(); }
  setDiscovered(ids: string[]): void { this.poiSystem.setDiscovered(ids); }
  poiPosition(poiId: string): { x: number; z: number } | null { return this.poiSystem.poiPos(poiId); }
  poiDef(poiId: string): PoiDef | undefined { return this.poiSystem.poiDef(poiId); }
  nearestPoi(x: number, z: number): PoiDef | null { return this.poiSystem.nearestPoi(x, z); }

  async fastTravel(poiId: string): Promise<void> {
    const pos = this.poiPosition(poiId);
    const player = this.getPlayer();
    if (!pos || player === null) return;
    const def = this.poiDef(poiId);
    if (!this.isDiscovered(poiId) || !def?.fastTravel) {
      this.ctx.services.tryGet('ui')?.toast('You have not found that place yet.', 'warning');
      return;
    }
    const from = this.ctx.world.get(player, Transform);
    const distM = from ? Math.hypot(pos.x - from.x, pos.z - from.z) : 0;
    const ui = this.ctx.services.tryGet('ui');
    if (ui) await ui.cutscene.fade('black', 350);
    this.teleport(player, pos.x, pos.z);
    await this.world.streamAround(pos.x, pos.z, 800);
    this.ctx.clock.advanceHours(distM / 4 / 3600); // task spec: advance the clock by distance / 4 m/s
    if (ui) await ui.cutscene.fade('clear', 350);
    this.bus.emit('fast-travel', poiId);
  }

  // ---------------- interaction ----------------

  nearestInteractable(): { entity: EntityId; prompt: string } | null {
    const id = this.getPlayer();
    return id === null ? null : this.interactSystem.nearestInteractable(id);
  }
  interactWith(entity: EntityId): void {
    this.interactSystem.interactWith(entity);
  }

  setPartyVisible(v: boolean): void {
    if (this.playerMesh) this.playerMesh.visible = v;
    for (const id of this.ctx.world.query(PartyMember)) {
      const mesh = this.ctx.world.get(id, MeshRef);
      if (mesh?.object) (mesh.object as Object3D).visible = v;
    }
  }

  on<K extends keyof ExplorationEvents & string>(event: K, cb: (...a: ExplorationEvents[K]) => void) {
    return this.bus.on(event, cb);
  }

  // ---------------- per-frame ----------------

  update(dt: number): void {
    const playerId = this.getPlayer();
    if (playerId !== null) this.ensurePlayerMesh(playerId);
    const speed = playerId !== null ? this.controller.update(dt, this.ctx.world, this.world, playerId, this.colliders) : 0;
    if (playerId !== null && this.playerMesh) {
      const t = this.ctx.world.get(playerId, Transform)!;
      this.playerMesh.position.set(t.x, t.y, t.z);
      this.playerMesh.rotation.y = t.yaw;
      // settlement LOD: every village inside the 3 km streaming ring used to render at full detail (3.2 M
      // tris in one Altdorf frame); beyond 1.2 km a village is a few pixels — hide it, and only nearby
      // ones cast shadows (each cascade re-renders its casters)
      for (const m of this.settlementsGroup.children) {
        const c = (m.userData as { settlement?: { x: number; z: number } }).settlement;
        if (!c) continue;
        const d2 = (c.x - t.x) * (c.x - t.x) + (c.z - t.z) * (c.z - t.z);
        m.visible = d2 < 1200 * 1200;
        m.castShadow = d2 < 400 * 400;
      }
      animateWalkCycle(this.playerMesh, speed, dt);
    }
    this.cameraRig.update(dt);

    const t = playerId !== null ? this.ctx.world.get(playerId, Transform) : undefined;
    const hour = this.ctx.clock.hour;
    this.npcSystem.setHostileHabsburg(this.ctx.services.tryGet('quest')?.isHostile('habsburg') ?? false);
    this.npcSystem.update(dt, t ? { x: t.x, z: t.z } : null, hour);
    this.poiSystem.update(t ?? null);

    const nearest = playerId !== null ? this.interactSystem.nearestInteractable(playerId) : null;
    const promptText = nearest ? `[E] ${nearest.prompt}` : null;
    if (promptText !== this.lastPrompt) {
      this.lastPrompt = promptText;
      this.ctx.services.tryGet('ui')?.prompt(promptText);
    }

    updateHud(this.ctx.world, this.ctx.content, this.ctx.services, this.ctx.clock, this.poiSystem, playerId, promptText);
  }

  handleInteractKey(): void {
    if (!this.controlEnabled) return;
    const nearest = this.nearestInteractable();
    if (nearest) this.interactWith(nearest.entity);
  }
}

/** Geometry only: materials are shared library instances (world/models.ts) still used by other meshes. */
function disposeObject3D(obj: Object3D): void {
  obj.parent?.remove(obj);
  obj.traverse((child) => { (child as unknown as { geometry?: { dispose(): void } }).geometry?.dispose(); });
}

export async function register(ctx: GameContext): Promise<void> {
  const world = ctx.services.get('world');
  const svc = new ExplorationServiceImpl(ctx, world);
  ctx.services.register('exploration', svc);

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyE' && ctx.state.state === 'explore') svc.handleInteractKey();
  });

  ctx.scheduler.add({
    name: 'exploration-update',
    phase: 'explore',
    order: 40,
    update(dt: number) {
      if (ctx.state.state === 'title' || ctx.state.state === 'boot' || ctx.state.state === 'creation') return;
      svc.update(dt);
    },
  });
}

// Re-exported so tests can reach the pure helpers without importing three.js-touching index.ts internals.
export type { World };
