/**
 * Combat engine. ARCHITECTURE.md §5.3. Stateful; wraps the pure functions in `rules/*.ts`. Implements
 * `CombatService` (core/services.ts) exactly. Uses the shared ECS world (via a PartyService-like host) so
 * enemy/ally units are real characters (`party.createCharacter`), but keeps its own lightweight per-encounter
 * `Unit` snapshots (see `types.ts`) rather than adding transient ECS components — simpler to serialize and to
 * unit-test without a live World.
 */
import type { EntityId } from '@core/ecs';
import type { World } from '@core/ecs';
import type { ContentRegistry } from '@core/content';
import type {
  AbilityDef, EncounterDef, ItemDef, NpcDef, Objective, ScriptedEvent, SerializedCombat, Side,
} from '@core/schemas';
import type { DamageType } from '@core/dsl';
import type {
  AttackContext, CellKey, CellView, CombatCommand, CombatEventRecord, CombatEvents, CombatResult, CombatService,
  CombatStateView, CommandResult, DerivedStats, WorldService,
} from '@core/services';
import { Character, Name, Renderable } from '@core/components';
import { EventBus, type Unsubscribe } from '@core/events';
import { Rng, rollDice } from '@core/rng';
import { modifier } from '@core/math';
import { buildGrid, cellDistance, cellIndex, cellToWorldXZ, inBounds, GridInfo } from './rules/grid';
import { dijkstra, reachableCells, reconstructPath, pathCost, Occupant } from './rules/path';
import { rollAttack, AttackInputs } from './rules/attack';
import { moraleCheck, moraleDc } from './rules/morale';
import { formationBonus, isFlanked, FormationUnit } from './rules/formation';
import { addStatus, hasStatus, isPolearm, removeStatus, type PendingReactionItem, type Unit, type WeaponInfo } from './types';
import { decideAndAct } from './ai';

export interface PartyServiceLike {
  createCharacter(def: NpcDef, opts?: { chapter?: string }): EntityId;
  getPlayer(): EntityId | null;
  getParty(): EntityId[];
  derived(id: EntityId): DerivedStats;
  skillLevel(id: EntityId, skill: string): number;
  hasPerk(id: EntityId, perk: string): boolean;
  damage(id: EntityId, amount: number): { hp: number; down: boolean };
  heal(id: EntityId, amount: number): void;
  grantSkillXp(id: EntityId, skill: string, amount: number): { leveled: boolean; newLevel?: number };
  formation?(): 'line' | 'wedge' | 'haufen' | 'skirmish';
}

export interface CombatHost {
  world: World;
  content: ContentRegistry;
  party: PartyServiceLike;
  rng: Rng;
  worldService?: WorldService;
  events?: { emit(event: string, ...args: unknown[]): void };
}

const DOCTRINE_BY_ARCHETYPE: Record<string, string> = {
  knight: 'knight', footman: 'footman', guard: 'footman', 'man-at-arms': 'footman', squire: 'footman',
  crossbowman: 'crossbowman', sergeant: 'sergeant', militia: 'waldstaette', saeumer: 'waldstaette', herder: 'waldstaette',
  raubritter: 'footman', 'toll-collector': 'footman',
};

function doctrineFor(archetype: string, side: Side): string {
  return DOCTRINE_BY_ARCHETYPE[archetype] ?? (side === 'player' ? 'waldstaette' : 'footman');
}

interface DeployZone { q: number; r: number; cols: number; rows: number }

export class CombatEngineImpl implements CombatService {
  private bus = new EventBus<CombatEvents>();
  private enc: EncounterDef | null = null;
  private grid: GridInfo | null = null;
  private cells: CellView[] = [];
  units = new Map<EntityId, Unit>();
  private order: EntityId[] = [];
  private turnIndex = 0;
  private round = 0;
  private phase: CombatStateView['phase'] = 'ended';
  private activeUnitId: EntityId | null = null;
  private log: CombatEventRecord[] = [];
  private objectives: { def: Objective; done: boolean; progress?: string }[] = [];
  private loseObjectives: { def: Objective; done: boolean }[] = [];
  private featureUses = new Map<number, number>();
  private deployZone: DeployZone = { q: 0, r: 0, cols: 1, rows: 1 };
  private resultResolve: ((r: CombatResult) => void) | null = null;
  private forceAiAll = false;
  private reactionQueue: PendingReactionItem[] = [];
  private scriptedRoundFired = new Set<number>();
  private ended = false;
  private ambush?: 'player' | 'enemy';
  private outcome: 'win' | 'lose' | 'fled' | null = null;

  constructor(private host: CombatHost) {}

  // ---------------- lifecycle ----------------

  async start(encounterId: string, opts?: { ambush?: 'player' | 'enemy'; encounterOverride?: EncounterDef }): Promise<CombatResult> {
    const enc = opts?.encounterOverride ?? this.host.content.encounters.get(encounterId);
    if (!enc) throw new Error(`combat: unknown encounter "${encounterId}"`);
    this.resetState();
    this.enc = enc;
    this.ambush = opts?.ambush;
    const { grid, cells } = buildGrid(enc, this.host.worldService);
    this.grid = grid;
    this.cells = cells;
    this.deployZone = enc.deploy;
    this.objectives = enc.objectives.map((def) => ({ def, done: false }));
    this.loseObjectives = (enc.loseObjectives ?? []).map((def) => ({ def, done: false }));
    this.placeUnits(enc);
    this.rollInitiative();
    this.phase = 'active';
    this.ended = false;
    this.pushLog('log', `${enc.name} begins.`);
    this.emitState();
    // Autosave contract: isActive() and serialize() must be valid before this fires.
    this.host.events?.emit('request-state', 'combat');
    this.advance();
    return new Promise<CombatResult>((resolve) => { this.resultResolve = resolve; });
  }

  private resetState(): void {
    this.enc = null; this.grid = null; this.cells = [];
    this.units.clear(); this.order = []; this.turnIndex = 0; this.round = 0;
    this.phase = 'ended'; this.activeUnitId = null; this.log = [];
    this.objectives = []; this.loseObjectives = []; this.featureUses.clear();
    this.resultResolve = null; this.forceAiAll = false; this.reactionQueue = [];
    this.scriptedRoundFired.clear(); this.ended = false; this.outcome = null;
  }

  isActive(): boolean {
    return this.enc !== null && this.phase !== 'ended';
  }

  // ---------------- unit placement ----------------

  private placeUnits(enc: EncounterDef): void {
    const realParty = this.host.party.getParty();
    const useRealParty = realParty.length > 0;
    let ordinal = 0;
    for (const pu of enc.units) {
      if (pu.side === 'player' && useRealParty) continue; // real party supersedes the standalone fallback squad
      const def = pu.npc ? this.host.content.npcs.get(pu.npc) : pu.archetype ? this.host.content.archetypes.get(pu.archetype) : undefined;
      if (!def) { console.warn(`[combat] placeUnits: no archetype/npc for placed unit`, pu); continue; }
      const count = pu.count ?? 1;
      for (let i = 0; i < count; i++) {
        const { q, r } = this.spreadCell(pu.q, pu.r, i, enc);
        this.spawnUnit(def, pu.side, q, r, { mounted: pu.mounted, group: pu.group, name: pu.name, npcId: pu.npc });
        ordinal++;
      }
    }
    void ordinal;
    if (useRealParty) {
      realParty.forEach((id, i) => {
        const { q, r } = this.deployCellFor(i);
        this.attachExistingUnit(id, 'player', q, r);
      });
    }
  }

  private spreadCell(q: number, r: number, i: number, enc: EncounterDef): CellKey {
    if (i === 0) return this.clamp(q, r, enc.grid.cols, enc.grid.rows);
    const ring: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
    const off = ring[(i - 1) % ring.length];
    const mult = 1 + Math.floor((i - 1) / ring.length);
    return this.clamp(q + off[0] * mult, r + off[1] * mult, enc.grid.cols, enc.grid.rows);
  }

  private clamp(q: number, r: number, cols: number, rows: number): CellKey {
    return { q: Math.max(0, Math.min(cols - 1, q)), r: Math.max(0, Math.min(rows - 1, r)) };
  }

  private deployCellFor(i: number): CellKey {
    const z = this.deployZone;
    const cols = Math.max(1, z.cols);
    return this.clamp(z.q + (i % cols), z.r + Math.floor(i / cols), this.enc!.grid.cols, this.enc!.grid.rows);
  }

  private spawnUnit(def: NpcDef, side: Side, q: number, r: number, opts: { mounted?: boolean; group?: string; name?: string; npcId?: string }): Unit {
    const id = this.host.party.createCharacter(def);
    return this.attachExistingUnit(id, side, q, r, opts, def.name);
  }

  private attachExistingUnit(id: EntityId, side: Side, q: number, r: number, opts: { mounted?: boolean; group?: string; name?: string; npcId?: string } = {}, fallbackName?: string): Unit {
    const derived = this.host.party.derived(id);
    const ch = this.host.world.require(id, Character);
    const name = opts.name ?? this.host.world.get(id, Name)?.display ?? fallbackName ?? `#${id}`;
    const items = this.host.content.items;
    const mkWeapon = (ref: { defId: string } | null): WeaponInfo | null => {
      if (!ref) return null;
      const d: ItemDef | undefined = items.get(ref.defId);
      if (!d?.weapon) return null;
      return { defId: d.id, name: d.name, hands: d.weapon.hands, reach: d.weapon.reach, damage: d.weapon.damage, damageType: d.weapon.damageType, properties: d.weapon.properties, range: d.weapon.range, ammo: d.weapon.ammo };
    };
    const isRealParty = this.host.party.getParty().includes(id);
    const unit: Unit = {
      id, name, side, archetype: ch.archetype, q, r,
      hp: ch.hp, hpMax: ch.hpMax, morale: ch.morale, moraleMax: ch.moraleMax,
      attributes: { ...ch.attributes },
      attackBonus: derived.attackBonus, soak: derived.soak,
      defenseBase: derived.defense, speedMBase: derived.speedM, initiativeBonus: derived.initiativeBonus,
      weapon: mkWeapon(derived.weapon), ranged: mkWeapon(derived.ranged), ammoQty: derived.ammo?.qty ?? 0,
      shield: !!derived.shield,
      ap: { action: true, bonus: true, reaction: true, moveM: derived.speedM, moveMax: derived.speedM },
      status: [], stance: 'neutral', loaded: false, mounted: !!opts.mounted,
      down: ch.hp <= 0, dead: false, bleedTurns: 3, routed: false, initiative: 0,
      isPlayerControlled: isRealParty, doctrine: doctrineFor(ch.archetype, side),
      chargeCells: 0, perkMods: derived.perkMods, critRange: 20 - (derived.perkMods['critRange'] ?? 0),
      modelId: this.host.world.get(id, Renderable)?.modelId, group: opts.group, npcId: opts.npcId,
      formation: { adjacentPolearms: 0, inHaufen: false, defenseBonus: 0 },
      freeReloadUsedThisTurn: false, hasActedThisTurn: false,
      leadershipLevel: this.host.party.skillLevel(id, 'leadership'), herbalismLevel: this.host.party.skillLevel(id, 'herbalism'),
    };
    this.units.set(id, unit);
    this.recomputeFormation();
    return unit;
  }

  // ---------------- initiative ----------------

  private rollInitiative(): void {
    const rolled = [...this.units.values()].map((u) => ({
      u, roll: this.host.rng.die(10) + modifier(u.attributes.agility) + u.initiativeBonus, tie: this.host.rng.next(),
    }));
    rolled.sort((a, b) => b.roll - a.roll || (modifier(b.u.attributes.agility) - modifier(a.u.attributes.agility)) || (b.tie - a.tie));
    this.order = rolled.map((r) => r.u.id);
    for (const r of rolled) r.u.initiative = r.roll;
    this.turnIndex = 0;
    this.activeUnitId = null;
  }

  // ---------------- round / turn loop ----------------

  private advance(): void {
    let guard = 0;
    while (guard++ < 20000) {
      if (this.ended) return;
      if (this.checkEndConditions()) { this.finish(); return; }
      if (this.reactionQueue.length) { this.phase = 'reaction'; this.emitState(); return; }
      if (this.activeUnitId === null) {
        if (!this.nextUnit()) { this.finish(); return; }
        continue;
      }
      const unit = this.units.get(this.activeUnitId);
      if (!unit || unit.dead) { this.activeUnitId = null; continue; }
      if (unit.down) { this.activeUnitId = null; continue; }
      if (unit.routed) { this.doRoutedTurn(unit); this.activeUnitId = null; continue; }
      const aiTurn = this.forceAiAll || !unit.isPlayerControlled;
      if (aiTurn) {
        try { decideAndAct(this, unit, this.host.rng); } catch (err) { console.error('[combat] AI decision threw', err); }
        this.activeUnitId = null;
        continue;
      }
      this.phase = 'active';
      this.emitState();
      return;
    }
    console.error('[combat] advance(): loop guard tripped');
  }

  private nextUnit(): boolean {
    let scanned = 0;
    const cap = (this.order.length + 1) * 3 + 4;
    while (scanned <= cap) {
      if (this.turnIndex >= this.order.length) {
        if (this.order.length === 0) return false;
        this.startRound();
        this.turnIndex = 0;
      }
      const id = this.order[this.turnIndex++];
      scanned++;
      const u = this.units.get(id);
      if (u && !u.dead) { this.beginUnitTurn(u); this.activeUnitId = id; return true; }
    }
    return false;
  }

  private startRound(): void {
    this.round += 1;
    for (const u of this.units.values()) {
      if (u.down && !u.dead) {
        u.bleedTurns -= 1;
        if (u.bleedTurns <= 0) { u.dead = true; this.pushLog('death', `${u.name} bleeds out.`, u.id); }
      }
    }
    this.pushLog('round', `Round ${this.round} begins.`, undefined, { round: this.round });
    this.runScriptedEvents((e) => e.round === this.round);
    this.updateObjectiveProgress();
  }

  private beginUnitTurn(u: Unit): void {
    u.ap = { action: true, bonus: true, reaction: true, moveM: u.speedMBase, moveMax: u.speedMBase };
    u.chargeCells = 0;
    u.freeReloadUsedThisTurn = false;
    u.hasActedThisTurn = false;
    for (const s of u.status) s.turns -= 1;
    u.status = u.status.filter((s) => s.turns > 0);
    this.pushLog('turn-start', `${u.name}'s turn.`, u.id);
  }

  private doRoutedTurn(u: Unit): void {
    const budget = u.speedMBase * 2; // "flees toward own edge at Dash speed"
    if (!this.grid) return;
    const dist = dijkstra(u.q, u.r, budget, u.side, { cols: this.grid.cols, rows: this.grid.rows, cellM: this.grid.cellM, cells: this.cells }, this.occupants(u.id));
    const targetR = u.side === 'player' ? this.grid.rows - 1 : 0;
    let best: CellKey | null = null;
    let bestScore = -Infinity;
    for (const [key, v] of dist) {
      if (v.cost === 0) continue;
      const [q, r] = key.split(',').map(Number);
      if (this.occupantAt(q, r, u.id)) continue;
      const score = -Math.abs(r - targetR);
      if (score > bestScore) { bestScore = score; best = { q, r }; }
    }
    if (best) { u.q = best.q; u.r = best.r; this.pushLog('move', `${u.name} flees.`, u.id, { cell: best }); }
    this.recomputeFormation();
  }

  // ---------------- end conditions ----------------

  private checkEndConditions(): boolean {
    if (this.ended || !this.enc) return false;
    const living = (side: Side) => [...this.units.values()].filter((u) => u.side === side && !u.dead);
    const playerAlive = living('player');
    const enemyAlive = living('enemy');
    if (playerAlive.length === 0) { this.outcome = 'lose'; return true; }
    for (const lo of this.loseObjectives) {
      if (this.objectiveMet(lo.def)) { this.outcome = 'lose'; return true; }
    }
    if (enemyAlive.length === 0) { this.outcome = 'win'; return true; }
    if (enemyAlive.every((u) => u.routed)) { this.outcome = 'win'; return true; }
    if (this.objectives.length && this.objectives.every((o) => this.objectiveMet(o.def))) { this.outcome = 'win'; return true; }
    return false;
  }

  private objectiveMet(def: Objective): boolean {
    switch (def.type) {
      case 'defeat-all': return [...this.units.values()].filter((u) => u.side === 'enemy').every((u) => u.dead);
      case 'rout': return [...this.units.values()].filter((u) => u.side === 'enemy').every((u) => u.dead || u.routed);
      case 'survive': return this.round >= def.turns;
      case 'trigger-features': {
        let count = 0;
        for (const [idx, uses] of this.featureUses) {
          const f = this.enc?.terrainFeatures?.[idx];
          if (f?.kind === def.kind && uses > 0) count++;
        }
        return count >= def.count;
      }
      case 'reach-cell': {
        const units = def.unit && def.unit !== 'any' ? [...this.units.values()].filter((u) => u.npcId === def.unit) : [...this.units.values()].filter((u) => u.side === 'player');
        return units.some((u) => def.cells.some(([q, r]) => q === u.q && r === u.r));
      }
      case 'hold-cells': {
        const players = [...this.units.values()].filter((u) => u.side === 'player' && !u.dead && !u.down);
        const held = def.cells.every(([q, r]) => players.some((u) => u.q === q && u.r === r));
        return held && this.round >= def.turns;
      }
      case 'protect': {
        if (def.npc === 'player') return [...this.units.values()].some((u) => u.side === 'player' && !u.dead);
        const target = [...this.units.values()].find((u) => u.npcId === def.npc);
        return !target || !target.dead;
      }
      default: return false;
    }
  }

  private updateObjectiveProgress(): void {
    for (const o of this.objectives) {
      o.done = this.objectiveMet(o.def);
      o.progress = this.objectiveProgressText(o.def);
    }
  }

  private objectiveProgressText(def: Objective): string {
    switch (def.type) {
      case 'survive': return `${Math.min(this.round, def.turns)}/${def.turns} rounds`;
      case 'trigger-features': {
        let count = 0;
        for (const [idx, uses] of this.featureUses) { if (this.enc?.terrainFeatures?.[idx]?.kind === def.kind && uses > 0) count++; }
        return `${count}/${def.count}`;
      }
      default: return '';
    }
  }

  private finish(): void {
    if (this.ended) return;
    this.ended = true;
    this.phase = 'ended';
    const outcome = this.outcome ?? 'lose';
    const dead: EntityId[] = [];
    const downed: EntityId[] = [];
    const xp: Record<string, number> = {};
    for (const u of this.units.values()) {
      if (u.dead) dead.push(u.id);
      else if (u.down) downed.push(u.id);
    }
    if (outcome === 'win') {
      for (const u of this.units.values()) {
        if (!u.isPlayerControlled || u.dead) continue;
        const weaponSkill = u.weapon ? this.skillIdForDamage(u) : null;
        if (weaponSkill) {
          const gained = this.host.party.grantSkillXp(u.id, weaponSkill, 5);
          xp[weaponSkill] = (xp[weaponSkill] ?? 0) + (gained.leveled ? 20 : 5);
        }
      }
    }
    // sync hp back to the party's Character component for real party members
    for (const u of this.units.values()) {
      if (!u.isPlayerControlled) continue;
      const ch = this.host.world.get(u.id, Character);
      if (ch) { ch.hp = u.hp; ch.down = u.down; }
    }
    const result: CombatResult = { outcome, rounds: this.round, downed, dead, xp, loot: [], log: this.log.map((l) => l.text) };
    this.pushLog('end', `Combat ends: ${outcome}.`, undefined, { outcome });
    this.emitState();
    this.bus.emit('end', result);
    this.host.events?.emit('request-state', outcome === 'lose' && ![...this.units.values()].some((u) => u.isPlayerControlled && !u.dead) ? 'gameover' : 'explore');
    this.resultResolve?.(result);
    this.resultResolve = null;
  }

  private skillIdForDamage(u: Unit): string | null {
    const def = u.weapon ? this.host.content.items.get(u.weapon.defId) : undefined;
    return def?.weapon?.skill ?? null;
  }

  // ---------------- scripted events ----------------

  private runScriptedEvents(pred: (e: ScriptedEvent) => boolean): void {
    if (!this.enc?.scripted) return;
    this.enc.scripted.forEach((e, idx) => {
      if (this.scriptedRoundFired.has(idx)) return;
      if (!pred(e)) return;
      this.scriptedRoundFired.add(idx);
      this.runScriptedActions(e);
    });
  }

  private runScriptedActions(e: ScriptedEvent): void {
    for (const a of e.actions) {
      if ('caption' in a) this.pushLog('caption', a.caption);
      else if ('moraleAll' in a) {
        for (const u of this.units.values()) if (u.side === a.moraleAll.side && !u.dead) this.adjustMorale(u, a.moraleAll.delta, 'scripted event');
      } else if ('kill' in a) {
        const target = [...this.units.values()].find((u) => u.npcId === a.kill) ?? [...this.units.values()].find((u) => u.side === 'enemy' && u.archetype === 'sergeant' && !u.dead);
        if (target) { target.hp = 0; target.dead = true; this.pushLog('death', `${target.name} falls.`, target.id); }
      } else if ('win' in a) { this.outcome = 'win'; }
      else if ('lose' in a) { this.outcome = 'lose'; }
      else if ('spawn' in a) {
        const def = a.spawn.npc ? this.host.content.npcs.get(a.spawn.npc) : a.spawn.archetype ? this.host.content.archetypes.get(a.spawn.archetype) : undefined;
        if (def && this.enc) this.spawnUnit(def, a.spawn.side, a.spawn.q, a.spawn.r, { mounted: a.spawn.mounted, group: a.spawn.group, npcId: a.spawn.npc });
      }
      // 'dialogue' / 'camera' are UI/render concerns; recorded in the log for visibility, no engine effect here.
      else if ('dialogue' in a) this.pushLog('log', `[dialogue: ${a.dialogue}]`);
      else if ('camera' in a) this.pushLog('log', `[camera → ${a.camera.q},${a.camera.r}]`);
    }
    this.recomputeFormation();
    this.updateObjectiveProgress();
  }

  // ---------------- formation ----------------

  private recomputeFormation(): void {
    const list: FormationUnit[] = [...this.units.values()].map((u) => ({ id: u.id, q: u.q, r: u.r, side: u.side, polearm: isPolearm(u.weapon), down: u.down || u.dead || u.routed }));
    for (const u of this.units.values()) {
      const fu = list.find((l) => l.id === u.id)!;
      u.formation = formationBonus(fu, list);
    }
  }

  // ---------------- occupancy / grid helpers ----------------

  private occupants(excludeId?: EntityId): Occupant[] {
    return [...this.units.values()].filter((u) => u.id !== excludeId && !u.dead).map((u) => ({ q: u.q, r: u.r, side: u.side }));
  }
  private occupantAt(q: number, r: number, excludeId?: EntityId): Unit | undefined {
    return [...this.units.values()].find((u) => u.id !== excludeId && !u.dead && u.q === q && u.r === r);
  }
  private cellAt(q: number, r: number): CellView | undefined {
    if (!this.grid || !inBounds(q, r, this.grid.cols, this.grid.rows)) return undefined;
    return this.cells[cellIndex(q, r, this.grid.cols)];
  }
  private pathGrid() {
    return { cols: this.grid!.cols, rows: this.grid!.rows, cellM: this.grid!.cellM, cells: this.cells };
  }

  // ---------------- logging / events ----------------

  private pushLog(kind: CombatEventRecord['kind'], text: string, unit?: EntityId, data?: Record<string, unknown>): CombatEventRecord {
    const rec: CombatEventRecord = { kind, text, unit, data };
    this.log.push(rec);
    if (this.log.length > 500) this.log.shift();
    this.bus.emit('event', rec);
    return rec;
  }

  private emitState(): void {
    const view = this.getState();
    if (view) this.bus.emit('state', view);
  }

  on<K extends keyof CombatEvents & string>(event: K, cb: (...a: CombatEvents[K]) => void): Unsubscribe {
    return this.bus.on(event, cb);
  }

  // ---------------- state projection ----------------

  getState(): CombatStateView | null {
    if (!this.enc || !this.grid) return null;
    const pending = this.reactionQueue[0];
    return {
      encounterId: this.enc.id,
      name: this.enc.name,
      phase: this.phase,
      round: this.round,
      order: this.order,
      activeUnit: this.activeUnitId,
      units: [...this.units.values()].map((u) => this.viewOf(u)),
      grid: { cols: this.grid.cols, rows: this.grid.rows, cellM: this.grid.cellM, origin: this.grid.origin },
      cells: this.cells.map((c) => ({ ...c, occupant: this.occupantAt(c.q, c.r)?.id })),
      objectives: this.objectives.map((o) => ({ text: this.objectiveText(o.def), done: o.done, progress: o.progress })),
      log: this.log.slice(-50),
      pendingReaction: pending ? { unit: pending.unitId, ability: pending.ability, trigger: pending.trigger, target: pending.targetId } : undefined,
      result: this.ended ? { outcome: this.outcome ?? 'lose', rounds: this.round, downed: [], dead: [...this.units.values()].filter((u) => u.dead).map((u) => u.id), xp: {}, loot: [], log: this.log.map((l) => l.text) } : undefined,
      deployZone: this.deployZone,
    };
  }

  private objectiveText(def: Objective): string {
    switch (def.type) {
      case 'defeat-all': return 'Defeat all enemies';
      case 'rout': return 'Rout the enemy';
      case 'survive': return `Survive ${def.turns} rounds`;
      case 'trigger-features': return `Trigger ${def.count} ${def.kind}`;
      case 'reach-cell': return 'Reach the marked cell';
      case 'hold-cells': return `Hold the line ${def.turns} rounds`;
      case 'protect': return `Protect ${def.npc}`;
      default: return 'Objective';
    }
  }

  private viewOf(u: Unit) {
    return {
      id: u.id, name: u.name, side: u.side, q: u.q, r: u.r, hp: u.hp, hpMax: u.hpMax, morale: u.morale, moraleMax: u.moraleMax,
      initiative: u.initiative, ap: { ...u.ap }, status: u.status.map((s) => ({ ...s })), stance: u.stance, loaded: u.loaded,
      mounted: u.mounted, down: u.down, routed: u.routed,
      defense: this.effectiveDefense(u, 0),
      weapon: u.weapon ? { name: u.weapon.name, reach: u.weapon.reach, ranged: false, damage: u.weapon.damage } : u.ranged ? { name: u.ranged.name, reach: u.ranged.range?.long ?? 8, ranged: true, damage: u.ranged.damage } : null,
      abilities: this.abilitiesFor(u),
      formation: u.formation,
      isPlayerControlled: u.isPlayerControlled,
      modelId: u.modelId,
      archetype: u.archetype,
      group: u.group,
      attributes: u.attributes,
    };
  }

  private abilitiesFor(u: Unit): string[] {
    const out: string[] = [];
    if (u.weapon || u.ranged) out.push('ability.attack');
    if (u.ranged && u.loaded) out.push('ability.aimed-shot');
    if (u.ranged && !u.loaded) out.push('ability.reload');
    out.push('ability.shove', 'ability.disengage', 'ability.dash');
    if (this.host.party.skillLevel(u.id, 'herbalism') > 0 || true) out.push('ability.bandage');
    if (u.leadershipLevel >= 10) out.push('ability.rally');
    if (u.weapon && (u.weapon.properties.includes('brace'))) out.push('ability.brace');
    if (u.mounted && u.weapon) out.push('ability.charge');
    for (const abilityId of GRANTED_ABILITY_IDS) {
      const perkId = ABILITY_TO_PERK[abilityId];
      if (perkId && this.host.party.hasPerk(u.id, perkId)) out.push(abilityId);
    }
    return out;
  }

  // ---------------- CombatService: preview / query ----------------

  reachable(unitId: EntityId): CellKey[] {
    const u = this.units.get(unitId);
    if (!u || !this.grid) return [];
    return reachableCells(u.q, u.r, u.ap.moveM, u.side, this.pathGrid(), this.occupants(u.id));
  }

  previewMove(unitId: EntityId, to: CellKey): { path: CellKey[]; costM: number; provokes: EntityId[] } | null {
    const u = this.units.get(unitId);
    if (!u || !this.grid) return null;
    const dist = dijkstra(u.q, u.r, u.ap.moveM, u.side, this.pathGrid(), this.occupants(u.id));
    const path = reconstructPath(dist, to.q, to.r);
    const cost = pathCost(dist, to.q, to.r);
    if (!path || cost === null) return null;
    const provokes = this.wouldProvoke(u, path).map((p) => p.id);
    return { path, costM: cost, provokes };
  }

  targets(unitId: EntityId, abilityId: string): (EntityId | CellKey)[] {
    const u = this.units.get(unitId);
    const ability = this.host.content.abilities.get(abilityId);
    if (!u || !ability || !this.grid) return [];
    const rangeCells = this.abilityRangeCells(u, ability);
    if (ability.target === 'enemy' || ability.target === 'ally' || ability.target === 'any') {
      const wantSide = ability.target === 'ally' ? u.side : ability.target === 'enemy' ? (u.side === 'player' ? 'enemy' : 'player') : null;
      return [...this.units.values()]
        .filter((o) => o.id !== u.id && !o.dead && (wantSide === null || o.side === wantSide) && cellDistance(u.q, u.r, o.q, o.r) <= rangeCells)
        .map((o) => o.id);
    }
    if (ability.target === 'self') return [u.id];
    // cell/line/cone: any in-range cell
    const out: CellKey[] = [];
    for (let dq = -rangeCells; dq <= rangeCells; dq++) for (let dr = -rangeCells; dr <= rangeCells; dr++) {
      const q = u.q + dq, r = u.r + dr;
      if (!inBounds(q, r, this.grid.cols, this.grid.rows)) continue;
      if (cellDistance(u.q, u.r, q, r) <= rangeCells) out.push({ q, r });
    }
    return out;
  }

  previewAttack(unitId: EntityId, abilityId: string, target: EntityId | CellKey): { hitChance: number; context: AttackContext; damage: string } | null {
    const u = this.units.get(unitId);
    const ability = this.host.content.abilities.get(abilityId);
    if (!u || !ability) return null;
    const targetUnit = typeof target === 'number' ? this.units.get(target) : undefined;
    if (!targetUnit) return null;
    const { attackBonus, edge, burden, weapon } = this.attackInputsFor(u, targetUnit, ability);
    const ctx: AttackContext = { edge, burden, ranged: !!weapon.range, distanceCells: cellDistance(u.q, u.r, targetUnit.q, targetUnit.r), heightDelta: (this.cellAt(u.q, u.r)?.height ?? 0) - (this.cellAt(targetUnit.q, targetUnit.r)?.height ?? 0), flanked: this.targetIsFlanked(targetUnit, u), charge: false };
    const defense = this.effectiveDefense(targetUnit, 0);
    // Simplified hit-chance estimate (does not roll): P(d20+bonus >= defense) with edge/burden net.
    const net = edge.length - burden.length;
    const need = defense - attackBonus;
    const pSingle = Math.max(0, Math.min(20, 21 - need)) / 20;
    const p = net > 0 ? 1 - (1 - pSingle) ** 2 : net < 0 ? pSingle ** 2 : pSingle;
    return { hitChance: Math.round(p * 100) / 100, context: ctx, damage: weapon.damage };
  }

  cellToWorld(cell: CellKey): { x: number; y: number; z: number } {
    if (!this.grid) return { x: 0, y: 0, z: 0 };
    const { x, z } = cellToWorldXZ(cell.q, cell.r, this.grid);
    const c = this.cellAt(cell.q, cell.r);
    return { x, y: c?.height ?? 0, z };
  }

  // ---------------- ability / attack support ----------------

  private abilityRangeCells(u: Unit, ability: AbilityDef): number {
    if (ability.range === 'weapon') {
      if (ability.id === 'ability.aimed-shot' || ability.id === 'ability.crossbow-snapshot') return u.ranged?.range?.long ?? 8;
      const w = u.weapon ?? u.ranged;
      return w?.range?.long ?? w?.reach ?? 1;
    }
    return ability.range;
  }

  private targetIsFlanked(target: Unit, attacker: Unit): boolean {
    const hostiles = [...this.units.values()].filter((o) => o.id !== attacker.id && o.id !== target.id && !o.dead && o.side !== target.side).map((o) => ({ q: o.q, r: o.r }));
    if (target.formation.inHaufen) return false; // Haufen units are immune to flanking
    return isFlanked({ q: target.q, r: target.r }, { q: attacker.q, r: attacker.r }, hostiles);
  }

  private attackInputsFor(attacker: Unit, target: Unit, ability: AbilityDef): { attackBonus: number; edge: string[]; burden: string[]; weapon: WeaponInfo } {
    const usingRanged = ability.id === 'ability.aimed-shot' || ability.id === 'ability.crossbow-snapshot' || (ability.id === 'ability.attack' && !attacker.weapon && !!attacker.ranged);
    const weapon = (usingRanged ? attacker.ranged : attacker.weapon) ?? attacker.weapon ?? attacker.ranged;
    if (!weapon) return { attackBonus: 0, edge: [], burden: [], weapon: { defId: '', name: 'fists', hands: 1, reach: 1, damage: '1d2', damageType: 'blunt', properties: [] } };
    const def = this.host.content.items.get(weapon.defId);
    const skillId = def?.weapon?.skill ?? 'unarmed';
    const attackBonus = (attacker.attackBonus[skillId] ?? 0) + (attacker.stance === 'aggressive' ? 2 : attacker.stance === 'guarded' ? -2 : 0);
    const edge: string[] = [];
    const burden: string[] = [];
    const attackerCell = this.cellAt(attacker.q, attacker.r);
    const targetCell = this.cellAt(target.q, target.r);
    const heightDelta = (attackerCell?.height ?? 0) - (targetCell?.height ?? 0);
    if (usingRanged) {
      if (heightDelta >= 2) edge.push('high ground');
    } else if (heightDelta >= 1) edge.push('high ground');
    if (this.targetIsFlanked(target, attacker)) edge.push('flanked');
    if (hasStatus(target, 'prone')) edge.push('target prone');
    if (hasStatus(target, 'shaken')) edge.push('target shaken');
    if (this.round === 1 && this.ambush === (attacker.side === 'player' ? 'player' : 'enemy')) edge.push('ambush');
    if (hasStatus(attacker, 'prone')) burden.push('attacker prone');
    if (usingRanged && weapon.range) {
      const dist = cellDistance(attacker.q, attacker.r, target.q, target.r);
      if (dist > weapon.range.short) burden.push('long range');
      const adjacentEnemy = [...this.units.values()].some((o) => o.side !== attacker.side && !o.dead && cellDistance(attacker.q, attacker.r, o.q, o.r) <= 1);
      if (adjacentEnemy) burden.push('adjacent enemy');
    }
    if (hasStatus(attacker, 'exhausted')) burden.push('exhausted');
    if (!usingRanged && target.stance === 'braced' && isPolearm(target.weapon) && !this.targetIsFlanked(target, attacker)) burden.push('braced pike front');
    return { attackBonus, edge, burden, weapon };
  }

  private effectiveDefense(u: Unit, coverBonus: number): number {
    const stanceMod = u.stance === 'aggressive' ? -2 : u.stance === 'guarded' ? 2 : 0;
    return u.defenseBase + stanceMod + u.formation.defenseBonus + coverBonus + (hasStatus(u, 'shield-wall') ? 1 : 0);
  }

  private wouldProvoke(mover: Unit, path: CellKey[]): Unit[] {
    if (hasStatus(mover, 'disengaged')) return [];
    const provokers: Unit[] = [];
    const enemies = [...this.units.values()].filter((o) => o.side !== mover.side && !o.dead && !o.down);
    for (let i = 1; i < path.length; i++) {
      const from = path[i - 1], to = path[i];
      for (const e of enemies) {
        const reach = e.weapon?.reach ?? 1;
        const wasAdjacent = cellDistance(e.q, e.r, from.q, from.r) <= reach;
        const nowAdjacent = cellDistance(e.q, e.r, to.q, to.r) <= reach;
        if (wasAdjacent && !nowAdjacent && e.ap.reaction && !provokers.includes(e)) provokers.push(e);
      }
    }
    return provokers;
  }

  // ---------------- CombatService: commands ----------------

  submit(cmd: CombatCommand): CommandResult {
    try {
      switch (cmd.type) {
        case 'move': return this.cmdMove(cmd.unit, cmd.to);
        case 'ability': return this.cmdAbility(cmd.unit, cmd.ability, cmd.target);
        case 'stance': return this.cmdStance(cmd.unit, cmd.stance);
        case 'end-turn': return this.cmdEndTurn(cmd.unit);
        case 'reaction': return this.cmdReaction(cmd.accept);
        case 'deploy': return this.cmdDeploy(cmd.placements);
        case 'flee': return this.cmdFlee();
        case 'auto': return this.cmdAuto(cmd.rounds);
        default: return { ok: false, reason: 'unknown command' };
      }
    } catch (err) {
      console.error('[combat] submit threw', err);
      return { ok: false, reason: String(err) };
    }
  }

  private cmdDeploy(placements: { unit: EntityId; to: CellKey }[]): CommandResult {
    for (const p of placements) {
      const u = this.units.get(p.unit);
      if (!u) continue;
      const z = this.deployZone;
      if (p.to.q < z.q || p.to.q >= z.q + z.cols || p.to.r < z.r || p.to.r >= z.r + z.rows) continue;
      u.q = p.to.q; u.r = p.to.r;
    }
    this.recomputeFormation();
    this.emitState();
    return { ok: true };
  }

  private cmdMove(unitId: EntityId, to: CellKey): CommandResult {
    const u = this.units.get(unitId);
    if (!u) return { ok: false, reason: 'no such unit' };
    if (u.id !== this.activeUnitId && !this.forceAiAll) return { ok: false, reason: 'not this unit\'s turn' };
    const preview = this.previewMove(unitId, to);
    if (!preview) return { ok: false, reason: 'unreachable' };
    const events = this.performMove(u, preview.path, preview.costM);
    this.advance();
    return { ok: true, events };
  }

  performMove(u: Unit, path: CellKey[], costM: number): CombatEventRecord[] {
    const events: CombatEventRecord[] = [];
    // straight-line tracking for charge detection
    let dq = 0, dr = 0, straight = 0;
    for (let i = 1; i < path.length; i++) {
      const sdq = Math.sign(path[i].q - path[i - 1].q), sdr = Math.sign(path[i].r - path[i - 1].r);
      if (sdq === dq && sdr === dr) straight++; else { straight = 1; dq = sdq; dr = sdr; }
    }
    u.chargeCells = Math.max(u.chargeCells, straight);
    const provokers = this.wouldProvoke(u, path);
    u.q = path[path.length - 1].q;
    u.r = path[path.length - 1].r;
    u.ap.moveM = Math.max(0, u.ap.moveM - costM);
    events.push(this.pushLog('move', `${u.name} moves.`, u.id, { path, cell: path[path.length - 1] }));
    // ledge fall: dropping ≥ 3 m in the move
    const startH = this.cellAt(path[0].q, path[0].r)?.height ?? 0;
    const endH = this.cellAt(u.q, u.r)?.height ?? 0;
    if (startH - endH >= 3) this.applyFall(u, startH - endH);
    this.recomputeFormation();
    for (const p of provokers) this.queueReaction(p, u, 'leave-reach', 'opportunity-attack');
    return events;
  }

  private applyFall(u: Unit, meters: number): void {
    const dmg = Math.max(0, Math.floor(meters / 3)) * rollDice('1d6', this.host.rng);
    this.applyDamage(u, dmg, 'blunt', 0);
    addStatus(u, 'prone', 1);
    this.pushLog('damage', `${u.name} falls ${meters.toFixed(1)} m and takes ${dmg} damage.`, u.id, { amount: dmg });
  }

  private applyDamage(target: Unit, amount: number, _type: DamageType, _soak: number): void {
    target.hp = Math.max(0, target.hp - amount);
    if (target.hp <= 0 && !target.down) { target.down = true; target.bleedTurns = 3; this.pushLog('down', `${target.name} goes down.`, target.id); }
    if (target.isPlayerControlled) this.host.party.damage(target.id, amount);
    if (amount > 0) this.checkMoraleTrigger(target, 'damage');
  }

  private cmdStance(unitId: EntityId, stance: Unit['stance']): CommandResult {
    const u = this.units.get(unitId);
    if (!u) return { ok: false, reason: 'no such unit' };
    if (stance === 'braced' && !isPolearm(u.weapon)) return { ok: false, reason: 'requires a polearm' };
    if (!u.ap.bonus) return { ok: false, reason: 'no bonus action' };
    u.ap.bonus = false;
    u.stance = stance;
    this.pushLog('status', `${u.name} takes a ${stance} stance.`, u.id);
    this.emitState();
    return { ok: true };
  }

  private cmdEndTurn(unitId: EntityId): CommandResult {
    if (unitId !== this.activeUnitId) return { ok: false, reason: 'not this unit\'s turn' };
    this.activeUnitId = null;
    this.advance();
    return { ok: true };
  }

  private cmdFlee(): CommandResult {
    this.outcome = 'fled';
    this.finish();
    return { ok: true };
  }

  private cmdAuto(rounds: number): CommandResult {
    this.forceAiAll = true;
    const targetRound = this.round + Math.max(1, rounds);
    let guard = 0;
    while (this.round < targetRound && !this.ended && guard++ < 20000) {
      this.activeUnitId = this.activeUnitId ?? null;
      this.advance();
      if (this.reactionQueue.length) this.cmdReaction(true); // AI-driven auto-play always resolves reactions
    }
    this.forceAiAll = false;
    this.emitState();
    return { ok: true };
  }

  private cmdReaction(accept: boolean): CommandResult {
    const item = this.reactionQueue.shift();
    if (!item) return { ok: false, reason: 'no pending reaction' };
    item.resolve(accept);
    if (this.reactionQueue.length === 0) this.phase = 'active';
    this.advance();
    return { ok: true };
  }

  private queueReaction(reactingUnit: Unit, source: Unit, trigger: string, ability: string): void {
    if (!reactingUnit.ap.reaction) return;
    const resolve = (accept: boolean) => {
      reactingUnit.ap.reaction = false;
      if (!accept) return;
      this.resolveOpportunityAttack(reactingUnit, source, ability);
    };
    const autoResolve = this.forceAiAll || !reactingUnit.isPlayerControlled;
    if (autoResolve) { resolve(true); return; }
    this.reactionQueue.push({ unitId: reactingUnit.id, ability, trigger, targetId: source.id, resolve });
  }

  private resolveOpportunityAttack(attacker: Unit, target: Unit, abilityId: string): void {
    const ability = this.host.content.abilities.get(abilityId === 'opportunity-attack' ? 'ability.attack' : abilityId) ?? this.host.content.abilities.get('ability.attack')!;
    this.resolveAttack(attacker, target, ability, { free: true });
  }

  // ---------------- ability execution ----------------

  private cmdAbility(unitId: EntityId, abilityId: string, target?: CellKey | EntityId): CommandResult {
    const u = this.units.get(unitId);
    const ability = this.host.content.abilities.get(abilityId);
    if (!u || !ability) return { ok: false, reason: 'no such unit/ability' };
    if (u.id !== this.activeUnitId && !this.forceAiAll) return { ok: false, reason: 'not this unit\'s turn' };
    const costCheck = this.checkAndSpendCost(u, ability);
    if (!costCheck.ok) return costCheck;
    const events: CombatEventRecord[] = [];
    this.executeAbility(u, ability, target, events);
    this.emitState();
    this.advance();
    return { ok: true, events };
  }

  private checkAndSpendCost(u: Unit, ability: AbilityDef): CommandResult {
    const r = ability.requires;
    if (r?.skill && this.host.party.skillLevel(u.id, r.skill) < (r.level ?? 1)) return { ok: false, reason: 'skill too low' };
    if (r?.perk && !this.host.party.hasPerk(u.id, r.perk)) return { ok: false, reason: 'missing perk' };
    if (r?.weaponProperty && !u.weapon?.properties.includes(r.weaponProperty)) return { ok: false, reason: 'wrong weapon' };
    if (r?.weaponSkill) {
      const def = u.weapon ? this.host.content.items.get(u.weapon.defId) : undefined;
      if (def?.weapon?.skill !== r.weaponSkill) return { ok: false, reason: 'wrong weapon skill' };
    }
    if (r?.ranged && !u.ranged) return { ok: false, reason: 'no ranged weapon' };
    if (r?.loaded && !u.loaded) return { ok: false, reason: 'not loaded' };
    if (r?.status && !hasStatus(u, r.status)) return { ok: false, reason: 'missing status' };
    if (r?.notStatus && hasStatus(u, r.notStatus)) return { ok: false, reason: 'blocked by status' };
    if (r?.terrainFeature) {
      const c = this.cellAt(u.q, u.r);
      if (c?.feature !== r.terrainFeature) return { ok: false, reason: 'not on the feature' };
    }
    // reload has a dynamic ladder cost; special-case before the generic cost object.
    if (ability.id === 'ability.reload') {
      const rung = this.reloadRung(u);
      if (rung === 'free') { if (u.freeReloadUsedThisTurn) return { ok: false, reason: 'free reload already used' }; u.freeReloadUsedThisTurn = true; return { ok: true }; }
      if (rung === 'bonus') { if (!u.ap.bonus) return { ok: false, reason: 'no bonus action' }; u.ap.bonus = false; return { ok: true }; }
      if (!u.ap.action) return { ok: false, reason: 'no action' };
      u.ap.action = false;
      return { ok: true };
    }
    const c = ability.cost;
    if (c.action && !u.ap.action) return { ok: false, reason: 'no action' };
    if (c.bonus && !u.ap.bonus) return { ok: false, reason: 'no bonus action' };
    if (c.reaction && !u.ap.reaction) return { ok: false, reason: 'no reaction' };
    if (c.action) u.ap.action = false;
    if (c.bonus) u.ap.bonus = false;
    if (c.reaction) u.ap.reaction = false;
    if (c.noMove) u.ap.moveM = 0;
    return { ok: true };
  }

  private reloadRung(u: Unit): 'free' | 'bonus' | 'action' {
    const props = u.ranged?.properties ?? [];
    let rung = props.includes('reload-2') ? 2 : props.includes('reload-1') ? 1 : 0;
    rung = Math.max(0, rung + (u.perkMods['reloadStep'] ?? 0));
    return rung === 0 ? 'free' : rung === 1 ? 'bonus' : 'action';
  }

  private executeAbility(u: Unit, ability: AbilityDef, target: CellKey | EntityId | undefined, events: CombatEventRecord[]): void {
    u.hasActedThisTurn = true;
    switch (ability.id) {
      case 'ability.attack': case 'ability.aimed-shot': case 'ability.crossbow-snapshot': case 'ability.hook':
      case 'ability.push-of-pike': case 'ability.riposte': case 'ability.disarm': case 'ability.charge': {
        const t = typeof target === 'number' ? this.units.get(target) : undefined;
        if (!t) return;
        const isCharge = ability.id === 'ability.charge';
        this.resolveAttack(u, t, ability, { charge: isCharge });
        return;
      }
      case 'ability.reload': {
        u.loaded = true;
        this.pushLog('ability', `${u.name} reloads.`, u.id);
        return;
      }
      case 'ability.shove': {
        const t = typeof target === 'number' ? this.units.get(target) : undefined;
        if (!t) return;
        this.resolveShove(u, t);
        return;
      }
      case 'ability.disengage': addStatus(u, 'disengaged', 1); this.pushLog('ability', `${u.name} disengages.`, u.id); return;
      case 'ability.dash': u.ap.moveM += u.speedMBase; this.pushLog('ability', `${u.name} dashes.`, u.id); return;
      case 'ability.bandage': case 'ability.bandage-quick': {
        const t = typeof target === 'number' ? this.units.get(target) : u;
        if (!t) return;
        if (t.down) { t.down = false; t.bleedTurns = 3; t.hp = Math.max(1, Math.floor(t.hpMax * 0.1)); this.pushLog('status', `${t.name} is stabilised.`, t.id); if (t.isPlayerControlled) this.host.party.heal(t.id, t.hp); }
        else { const bonus = this.host.party.skillLevel(u.id, 'herbalism') >= 25 ? rollDice('1d4', this.host.rng) : 0; const heal = rollDice('1d4', this.host.rng) + bonus; this.applyHeal(t, heal); }
        return;
      }
      case 'ability.rally': case 'ability.rally-bonus': {
        const radius = 3;
        for (const ally of this.units.values()) {
          if (ally.side !== u.side || ally.dead || cellDistance(u.q, u.r, ally.q, ally.r) > radius) continue;
          if (hasStatus(ally, 'shaken')) { removeStatus(ally, 'shaken'); this.pushLog('morale', `${ally.name} is rallied.`, ally.id); }
          if (ally.routed) { ally.routed = false; this.pushLog('morale', `${ally.name} is rallied and holds.`, ally.id); }
        }
        return;
      }
      case 'ability.brace': u.stance = 'braced'; this.pushLog('status', `${u.name} braces.`, u.id); return;
      case 'ability.roll-boulders': {
        const cell = this.cellAt(u.q, u.r);
        const idx = cell?.featureIndex;
        const feature = idx !== undefined ? this.enc?.terrainFeatures?.[idx] : undefined;
        const affects = feature?.affects ?? [];
        this.featureUses.set(idx ?? -1, (this.featureUses.get(idx ?? -1) ?? 0) + 1);
        this.pushLog('feature', `${u.name} rolls boulders down the slope!`, u.id, { feature: feature?.kind });
        for (const [q, r] of affects) {
          const hitUnit = this.occupantAt(q, r);
          if (!hitUnit) continue;
          const dmg = rollDice('2d10', this.host.rng);
          this.applyDamage(hitUnit, dmg, 'blunt', 0);
          addStatus(hitUnit, 'prone', 1);
          this.pushLog('damage', `${hitUnit.name} is struck by a rolling boulder for ${dmg}.`, hitUnit.id, { amount: dmg });
          this.rollMorale(hitUnit, moraleDc(3), 'rockfall');
        }
        this.updateObjectiveProgress();
        return;
      }
      case 'ability.wall-of-iron': addStatus(u, 'wall-of-iron', 99); this.pushLog('status', `${u.name} anchors the line.`, u.id); return;
      case 'ability.shield-wall': addStatus(u, 'shield-wall', 1); for (const a of this.adjacentAllies(u)) addStatus(a, 'shield-wall', 1); this.pushLog('status', `${u.name} locks shields.`, u.id); return;
      case 'ability.second-wind': { const h = rollDice('1d6', this.host.rng); this.applyHeal(u, h); removeStatus(u, 'shaken'); this.pushLog('status', `${u.name} finds a second wind.`, u.id); return; }
      case 'ability.war-cry': for (const a of this.alliesInRadius(u, 3)) addStatus(a, 'war-cry', 2); this.pushLog('morale', `${u.name} shouts — the line steadies.`, u.id); return;
      case 'ability.mountain-stride': addStatus(u, 'mountain-stride', 1); this.pushLog('status', `${u.name} strides over the broken ground.`, u.id); return;
      case 'ability.sure-foot': addStatus(u, 'sure-footed', 2); this.pushLog('status', `${u.name} finds sure footing.`, u.id); return;
      default: this.pushLog('ability', `${u.name} uses ${ability.name}.`, u.id); return;
    }
  }

  private adjacentAllies(u: Unit): Unit[] {
    return [...this.units.values()].filter((o) => o.id !== u.id && o.side === u.side && !o.dead && cellDistance(u.q, u.r, o.q, o.r) <= 1);
  }
  private alliesInRadius(u: Unit, radius: number): Unit[] {
    return [...this.units.values()].filter((o) => o.side === u.side && !o.dead && cellDistance(u.q, u.r, o.q, o.r) <= radius);
  }

  private applyHeal(u: Unit, amount: number): void {
    u.hp = Math.min(u.hpMax, u.hp + amount);
    if (u.isPlayerControlled) this.host.party.heal(u.id, amount);
    this.pushLog('damage', `${u.name} heals ${amount}.`, u.id, { amount: -amount });
  }

  private resolveAttack(attacker: Unit, target: Unit, ability: AbilityDef, opts: { charge?: boolean; free?: boolean } = {}): void {
    const { attackBonus, edge, burden, weapon } = this.attackInputsFor(attacker, target, ability);
    if (opts.charge) edge.push('charge');
    const defense = this.effectiveDefense(target, this.cellAt(target.q, target.r)?.cover ?? 0);
    const soak = { ...target.soak };
    const inputs: AttackInputs = {
      attackBonus, targetDefense: defense, edge, burden, weaponDice: weapon.damage, damageType: weapon.damageType,
      damageBonus: modifier(weapon.properties.includes('finesse') ? attacker.attributes.agility : attacker.attributes.strength),
      soak, ignoreSoak: attacker.perkMods['ignoreSoak'], critRange: attacker.critRange,
    };
    if (opts.charge) inputs.weaponDice = `${inputs.weaponDice}+1d8`;
    const roll = rollAttack(inputs, this.host.rng);
    this.pushLog('attack', `${attacker.name} attacks ${target.name}: ${roll.hit ? (roll.critical ? 'critical hit' : 'hit') : 'miss'}.`, attacker.id, { target: target.id, roll });
    if (roll.hit) {
      this.applyDamage(target, roll.damage, weapon.damageType, roll.soak);
      if (roll.damage > 0) this.pushLog('damage', `${target.name} takes ${roll.damage} ${weapon.damageType} damage.`, target.id, { amount: roll.damage, target: target.id });
      if (ability.id === 'ability.hook') this.movePush(target, attacker, -1);
      if (ability.id === 'ability.push-of-pike') this.movePush(target, attacker, 1);
      if (ability.id === 'ability.disarm') addStatus(target, 'disarmed', 2);
      if (opts.charge) this.rollMorale(target, 12, 'charged by cavalry');
    }
  }

  private resolveShove(attacker: Unit, target: Unit): void {
    const attRoll = this.host.rng.die(20) + modifier(attacker.attributes.strength);
    const defRoll = this.host.rng.die(20) + modifier(target.attributes.agility);
    const success = attRoll >= defRoll;
    this.pushLog('ability', `${attacker.name} shoves ${target.name}: ${success ? 'success' : 'resisted'}.`, attacker.id, { target: target.id });
    if (success) this.movePush(target, attacker, 1);
  }

  /** direction sign>0 pushes target away from source; sign<0 pulls target toward source. */
  private movePush(target: Unit, source: Unit, sign: 1 | -1): void {
    if (!this.grid) return;
    const dq = Math.sign(target.q - source.q) || 1;
    const dr = Math.sign(target.r - source.r) || 0;
    const nq = target.q + dq * sign;
    const nr = target.r + dr * sign;
    if (!inBounds(nq, nr, this.grid.cols, this.grid.rows)) return;
    const destCell = this.cellAt(nq, nr);
    if (!destCell || !destCell.passable) return;
    if (this.occupantAt(nq, nr, target.id)) { addStatus(target, 'prone', 1); return; } // collision: both prone (simplified)
    const startH = this.cellAt(target.q, target.r)?.height ?? 0;
    target.q = nq; target.r = nr;
    const endH = destCell.height;
    if (startH - endH >= 3) this.applyFall(target, startH - endH);
    else if (destCell.surface === 'water') {
      const heavy = (target.soak.thrust ?? 0) >= 2; // mail/coat-of-plates soak thrust well → proxy for "heavy armour"
      if (heavy) { addStatus(target, 'drowning', 99); this.pushLog('status', `${target.name} is dragged under, weighed down by armour.`, target.id); }
    }
    this.recomputeFormation();
  }

  // ---------------- morale ----------------

  private checkMoraleTrigger(u: Unit, reason: 'damage' | 'ally-down' | 'flanked' | 'charge' | 'leader-down' | 'rockfall'): void {
    if (u.dead || u.down) return;
    if (reason === 'damage' && u.hp > u.hpMax * 0.75) return;
    const dc = moraleDc(reason === 'rockfall' ? 3 : 1);
    this.rollMorale(u, dc, reason);
  }

  private rollMorale(u: Unit, dc: number, reason: string): void {
    if (u.dead || u.down) return;
    const result = moraleCheck({
      presenceMod: modifier(u.attributes.presence), leadershipLevel: u.leadershipLevel,
      formationBonus: u.formation.defenseBonus, moraleBonusPerk: u.perkMods['morale'] ?? 0, dc, edge: u.formation.inHaufen,
    }, this.host.rng);
    this.pushLog('morale', `${u.name} morale check (${reason}): ${result.outcome}.`, u.id, { morale: result });
    if (result.outcome === 'shaken') addStatus(u, 'shaken', 3);
    else if (result.outcome === 'routed') { u.routed = true; removeStatus(u, 'shaken'); }
    this.adjustMorale(u, result.outcome === 'steady' ? 0 : result.outcome === 'shaken' ? -10 : -25, reason);
  }

  private adjustMorale(u: Unit, delta: number, _reason: string): void {
    u.morale = Math.max(0, Math.min(u.moraleMax, u.morale + delta));
  }

  // ---------------- AI-facing helpers (used by ai.ts) ----------------

  gridInfo(): GridInfo | null { return this.grid; }
  cellsView(): CellView[] { return this.cells; }
  unitList(): Unit[] { return [...this.units.values()]; }
  occupantsFor(excludeId?: EntityId): Occupant[] { return this.occupants(excludeId); }
  cellViewAt(q: number, r: number): CellView | undefined { return this.cellAt(q, r); }
  encounterDef(): EncounterDef | null { return this.enc; }
  featureUsesMap(): Map<number, number> { return this.featureUses; }

  aiMove(u: Unit, to: CellKey): void {
    const preview = this.previewMove(u.id, to);
    if (!preview) return;
    this.performMove(u, preview.path, preview.costM);
  }
  aiAbility(u: Unit, abilityId: string, target?: CellKey | EntityId): boolean {
    const ability = this.host.content.abilities.get(abilityId);
    if (!ability) return false;
    const cost = this.checkAndSpendCost(u, ability);
    if (!cost.ok) return false;
    this.executeAbility(u, ability, target, []);
    return true;
  }
  aiEndTurn(): void { this.activeUnitId = null; }

  // ---------------- stepAi / runScript ----------------

  stepAi(): void {
    const u = this.activeUnitId !== null ? this.units.get(this.activeUnitId) : undefined;
    if (!u) return;
    try { decideAndAct(this, u, this.host.rng); } catch (err) { console.error('[combat] stepAi threw', err); }
    this.activeUnitId = null;
    this.advance();
  }

  async runScript(cmds: CombatCommand[]): Promise<CombatStateView> {
    for (const cmd of cmds) this.submit(cmd);
    return this.getState() ?? ({} as CombatStateView);
  }

  // ---------------- serialize / restore ----------------

  serialize(): SerializedCombat | null {
    if (!this.enc || !this.grid) return null;
    return {
      encounterId: this.enc.id,
      round: this.round,
      turnIndex: this.turnIndex,
      order: this.order,
      rngState: this.host.rng.getState(),
      units: [...this.units.values()].map((u) => ({ ...u, status: u.status.map((s) => ({ ...s })), attackBonus: { ...u.attackBonus }, soak: { ...u.soak }, ap: { ...u.ap } })),
      features: [...this.featureUses.entries()],
      objectivesState: { objectives: this.objectives.map((o) => ({ done: o.done, progress: o.progress })), phase: this.phase, ended: this.ended, outcome: this.outcome, deployZone: this.deployZone, grid: this.grid, cells: this.cells, activeUnitId: this.activeUnitId },
      log: this.log.map((l) => l.text),
    };
  }

  async restore(s: SerializedCombat): Promise<void> {
    if (!s) return;
    const enc = this.host.content.encounters.get(s.encounterId);
    if (!enc) throw new Error(`combat: restore: unknown encounter ${s.encounterId}`);
    this.resetState();
    this.enc = enc;
    const os = s.objectivesState as { objectives: { done: boolean; progress?: string }[]; phase: CombatStateView['phase']; ended: boolean; outcome: 'win' | 'lose' | 'fled' | null; deployZone: DeployZone; grid: GridInfo; cells: CellView[]; activeUnitId: EntityId | null };
    this.grid = os.grid;
    this.cells = os.cells;
    this.deployZone = os.deployZone;
    this.objectives = enc.objectives.map((def, i) => ({ def, done: os.objectives[i]?.done ?? false, progress: os.objectives[i]?.progress }));
    this.loseObjectives = (enc.loseObjectives ?? []).map((def) => ({ def, done: false }));
    this.units = new Map((s.units as Unit[]).map((u) => [u.id, { ...u }]));
    this.order = s.order;
    this.turnIndex = s.turnIndex;
    this.round = s.round;
    this.featureUses = new Map(s.features as [number, number][]);
    this.phase = os.phase;
    this.ended = os.ended;
    this.outcome = os.outcome;
    this.activeUnitId = os.activeUnitId;
    this.host.rng.setState(s.rngState);
    this.log = s.log.map((text) => ({ kind: 'log', text }));
  }
}

const ABILITY_TO_PERK: Record<string, string> = {
  'ability.hook': 'perk.halberd-25', 'ability.wall-of-iron': 'perk.spear-50', 'ability.push-of-pike': 'perk.spear-75',
  'ability.riposte': 'perk.sword-50', 'ability.disarm': 'perk.dagger-50', 'ability.crossbow-snapshot': 'perk.crossbow-50',
  'ability.sure-foot': 'perk.athletics-25', 'ability.second-wind': 'perk.athletics-75', 'ability.war-cry': 'perk.leadership-25',
  'ability.rally-bonus': 'perk.leadership-50', 'ability.shield-wall': 'perk.shield-75', 'ability.bandage-quick': 'perk.herbalism-25',
  'ability.mountain-stride': 'perk.alpine-50',
};
const GRANTED_ABILITY_IDS = Object.keys(ABILITY_TO_PERK);
