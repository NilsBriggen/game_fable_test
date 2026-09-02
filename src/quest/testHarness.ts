/**
 * Shared test scaffolding for src/quest/*.test.ts — NOT a *.test.ts file itself (vitest only collects
 * that glob). Builds a `GameContext`-shaped object without touching `Graphics` (which needs a real
 * WebGL canvas and cannot run under vitest's node environment), plus small fake party/exploration/combat/ui
 * services, per BUILDER_RULES's "fake services... built as small objects".
 */
import { World, Scheduler, type EntityId } from '@core/ecs';
import { EventBus, type GameEvents } from '@core/events';
import { GameClock } from '@core/clock';
import { RngStreams } from '@core/rng';
import { ServiceRegistry } from '@core/services';
import { GameStateMachine } from '@core/state';
import { ContentRegistry } from '@core/content';
import type { GameContext } from '@core/context';
import { Name, Player } from '@core/components';
import type { NpcDef, PoiDef } from '@core/schemas';
import type {
  CameraRig, CombatResult, CombatService, DialogueNodeView, ExplorationEvents, ExplorationService, PartyService, UiService,
} from '@core/services';

export function makeTestContext(seed = 1291): GameContext {
  const ctx: Partial<GameContext> = {
    world: new World(),
    scheduler: new Scheduler(),
    events: new EventBus<GameEvents>(),
    clock: new GameClock(),
    rng: new RngStreams(seed),
    services: new ServiceRegistry(),
    state: new GameStateMachine(),
    content: new ContentRegistry(),
    harness: false,
    elapsed: 0,
    playtimeSec: 0,
    seed,
  };
  return ctx as GameContext;
}

/** Creates the player entity with a real `Player`+`Name` component so `QuestServiceImpl.getOrigin()` etc. work. */
export function spawnTestPlayer(ctx: GameContext, opts: { origin?: 'uri' | 'schwyz' | 'unterwalden'; givenName?: string; familyName?: string } = {}): EntityId {
  const id = ctx.world.create('player');
  ctx.world.add(id, Player, { origin: opts.origin ?? 'uri', givenName: opts.givenName ?? 'Kuoni', familyName: opts.familyName ?? 'Imhof' });
  ctx.world.add(id, Name, { id: 'player', display: `${opts.givenName ?? 'Kuoni'} ${opts.familyName ?? 'Imhof'}` });
  return id;
}

export class FakePartyService {
  pfennigAmt = 0;
  items = new Map<string, number>();
  skills = new Map<string, number>();
  members = new Set<EntityId>();
  chapterApplied: string[] = [];
  restCalls: number[] = [];

  constructor(private world: World, private playerId: EntityId) {
    this.members.add(playerId);
  }
  getPlayer(): EntityId | null { return this.playerId; }
  getParty(): EntityId[] { return [...this.members]; }
  addMember(id: EntityId): boolean { this.members.add(id); return true; }
  removeMember(id: EntityId): void { this.members.delete(id); }
  isMember(id: EntityId): boolean { return this.members.has(id); }
  derived(): unknown { return {}; }
  invalidate(): void {}
  skillLevel(_id: EntityId, skill: string): number { return this.skills.get(skill) ?? 0; }
  skillMod(id: EntityId, skill: string): number { return Math.floor(this.skillLevel(id, skill) / 10); }
  attrMod(): number { return 0; }
  grantSkillXp(_id: EntityId, skill: string, amount: number): { leveled: boolean } {
    this.skills.set(skill, (this.skills.get(skill) ?? 0) + amount);
    return { leveled: false };
  }
  spendAttributePoint(): boolean { return false; }
  hasPerk(): boolean { return false; }
  takePerk(): boolean { return false; }
  availablePerks(): string[] { return []; }
  equip(): boolean { return true; }
  unequip(): void {}
  addItem(_id: EntityId, defId: string, qty = 1) { this.items.set(defId, (this.items.get(defId) ?? 0) + qty); return { instanceId: `${defId}#1`, defId, qty }; }
  removeItem(_id: EntityId, defId: string, qty = 1): boolean {
    const cur = this.items.get(defId) ?? 0;
    this.items.set(defId, Math.max(0, cur - qty));
    return cur >= qty;
  }
  countItem(_id: EntityId, defId: string): number { return this.items.get(defId) ?? 0; }
  transfer(): boolean { return true; }
  pfennig(): number { return this.pfennigAmt; }
  addPfennig(_id: EntityId, delta: number): boolean { this.pfennigAmt += delta; return true; }
  damage() { return { hp: 0, down: false }; }
  heal(): void {}
  rest(hours: number): void { this.restCalls.push(hours); }
  applyChapter(chapter: string): void { this.chapterApplied.push(chapter); }
  itemDef(): undefined { return undefined; }
  formation(): 'line' { return 'line'; }
  setFormation(): void {}
  createCharacter(def: NpcDef): EntityId {
    const id = this.world.create(def.id);
    this.world.add(id, Name, { id: def.id, display: def.name });
    return id;
  }
  createPlayer(): EntityId { return this.playerId; }
  on() { return () => {}; }
}

export class FakeExplorationService {
  discoveredSet = new Set<string>();
  teleports: { entity: EntityId; x: number; z: number }[] = [];
  populateCalls: string[] = [];
  spawned = new Map<string, EntityId>();
  private listeners: { [K in keyof ExplorationEvents]?: ((...a: ExplorationEvents[K]) => void)[] } = {};

  constructor(private world: World, private playerId: EntityId, private pois: Map<string, PoiDef>) {}

  spawnPlayer(): EntityId { return this.playerId; }
  spawnNpc(def: NpcDef): EntityId {
    const id = this.world.create(def.id);
    this.world.add(id, Name, { id: def.id, display: def.name });
    this.spawned.set(def.id, id);
    return id;
  }
  populate(chapter: string): void { this.populateCalls.push(chapter); }
  getPlayer(): EntityId | null { return this.playerId; }
  teleport(entity: EntityId, x: number, z: number): void { this.teleports.push({ entity, x, z }); }
  setControlEnabled(): void {}
  getCameraRig(): CameraRig {
    return { camera: {} as never, setMode: () => {}, getMode: () => 'follow', setFree: () => {}, focus: () => {}, update: () => {} };
  }
  discover(poiId: string): void { this.discoveredSet.add(poiId); this.emit('poi-discovered', poiId); }
  isDiscovered(poiId: string): boolean { return this.discoveredSet.has(poiId); }
  discovered(): string[] { return [...this.discoveredSet]; }
  setDiscovered(ids: string[]): void { this.discoveredSet = new Set(ids); }
  async fastTravel(poiId: string): Promise<void> { this.emit('fast-travel', poiId); }
  nearestInteractable() { return null; }
  interactWith(): void {}
  poiPosition(poiId: string): { x: number; z: number } | null {
    const p = this.pois.get(poiId);
    return p ? { x: p.x, z: p.z } : null;
  }
  poiDef(poiId: string): PoiDef | undefined { return this.pois.get(poiId); }
  nearestPoi() { return null; }
  setPartyVisible(): void {}
  on<K extends keyof ExplorationEvents & string>(event: K, cb: (...a: ExplorationEvents[K]) => void) {
    (this.listeners[event] ??= [] as never).push(cb as never);
    return () => { this.listeners[event] = (this.listeners[event] ?? []).filter((c) => c !== cb) as never; };
  }
  emit<K extends keyof ExplorationEvents & string>(event: K, ...args: ExplorationEvents[K]): void {
    for (const cb of this.listeners[event] ?? []) (cb as (...a: ExplorationEvents[K]) => void)(...args);
  }
}

export class FakeCombatService {
  results = new Map<string, CombatResult>();
  calls: string[] = [];
  defaultOutcome: CombatResult = { outcome: 'win', rounds: 1, downed: [], dead: [], xp: {}, loot: [], log: [] };
  async start(id: string): Promise<CombatResult> {
    this.calls.push(id);
    return this.results.get(id) ?? this.defaultOutcome;
  }
  isActive(): boolean { return false; }
  getState() { return null; }
  submit() { return { ok: true }; }
  previewMove() { return null; }
  previewAttack() { return null; }
  reachable() { return []; }
  targets() { return []; }
  cellToWorld() { return { x: 0, y: 0, z: 0 }; }
  on() { return () => {}; }
  serialize() { return null; }
  async restore(): Promise<void> {}
  stepAi(): void {}
  async runScript() { return {} as never; }
}

export type ChoicePolicy = (node: DialogueNodeView) => number;

export class ScriptedUiService {
  log: string[] = [];
  toasts: string[] = [];
  constructor(private pick: ChoicePolicy = (n) => Math.max(0, n.choices.findIndex((c) => c.enabled))) {}
  showHud(): void {}
  updateHud(): void {}
  toast(msg: string): void { this.toasts.push(msg); }
  openMenu(): void {}
  closeMenu(): void {}
  currentMenu() { return null; }
  dialogue = {
    show: async (node: DialogueNodeView): Promise<number> => {
      this.log.push(node.text);
      if (!node.choices.length) return 0;
      return Math.max(0, this.pick(node));
    },
    hide: (): void => {},
  };
  combat = { show(): void {}, update(): void {}, hide(): void {}, onCommand(): void {} };
  cutscene = {
    letterbox: (): void => {},
    caption: async (t: string): Promise<void> => { this.log.push(`[caption] ${t}`); },
    fade: async (): Promise<void> => {},
    title: async (t: string): Promise<void> => { this.log.push(`[title] ${t}`); },
  };
  prompt(): void {}
  loading(): void {}
  async confirm(): Promise<boolean> { return true; }
}

export function asPartyService(f: FakePartyService): PartyService { return f as unknown as PartyService; }
export function asExplorationService(f: FakeExplorationService): ExplorationService { return f as unknown as ExplorationService; }
export function asCombatService(f: FakeCombatService): CombatService { return f as unknown as CombatService; }
export function asUiService(f: ScriptedUiService): UiService { return f as unknown as UiService; }
