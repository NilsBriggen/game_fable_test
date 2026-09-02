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
import type { CombatEffect, DamageType } from '@core/dsl';
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
import { rollAttack, estimateHitChance, AttackInputs } from './rules/attack';
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
  // Cross-module request (requests/quest-2.md §2, LORE §6 step 11): read-only access to the quest module's
  // global flags, e.g. `hunenberg-warning`. Structural (not the full `QuestService`) so combat doesn't need
  // to know about quests beyond this one read.
  questService?: { getFlag(k: string): unknown };
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
  // Balance pass: `rout.threshold` must be computed against the FULL eventual column (initial units +
  // every scripted `spawn`), not just whoever has spawned so far — otherwise routing the round-1 vanguard
  // alone could satisfy a 60% threshold before waves 2/3 (11 more Habsburg units) ever arrive. Set once in
  // `start()`.
  private totalEnemyEverCount = 0;
  private loseObjectives: { def: Objective; done: boolean }[] = [];
  private featureUses = new Map<number, number>();
  private deployZone: DeployZone = { q: 0, r: 0, cols: 1, rows: 1 };
  private resultResolve: ((r: CombatResult) => void) | null = null;
  // round-2 issue 5: `restore()` never re-armed the original `start()` promise (documented as a builder-
  // admitted gap) — a loaded mid-combat save had no way to learn how the fight eventually ended except by
  // subscribing to `on('end', ...)` before it happened. `resume()` below fixes this: it returns a promise
  // that resolves once (either immediately, from the last stored result, or whenever `finish()` next runs).
  private lastResult: CombatResult | null = null;
  private forceAiAll = false;
  /** set during a `{type:'auto', rounds:N}` command: advance() stops cleanly once this many rounds have
   *  played, instead of running to completion (win/lose) — see BUILDER_RULES.md's `auto` semantics. */
  private autoStopRound: number | null = null;
  private reactionQueue: PendingReactionItem[] = [];
  private scriptedRoundFired = new Set<number>();
  private ended = false;
  private ambush?: 'player' | 'enemy';
  private outcome: 'win' | 'lose' | 'fled' | null = null;
  /** issue 10: a legal `auto` run against two sides that can never reach each other used to hit the 20 000-
   *  iteration guard and log a console.error. Instead, detect N consecutive rounds with no hp/position change
   *  and end the encounter as a stalemate. */
  private stalemateFingerprint = '';
  private stalemateRounds = 0;
  /** issue 8: at most one morale check per unit per *reason* per round (reset each `startRound`). */
  private moraleCheckedThisRound = new Map<EntityId, Set<string>>();

  constructor(private host: CombatHost) {}

  // ---------------- lifecycle ----------------

  async start(encounterId: string, opts?: { ambush?: 'player' | 'enemy'; encounterOverride?: EncounterDef }): Promise<CombatResult> {
    let enc = opts?.encounterOverride ?? this.host.content.encounters.get(encounterId);
    if (!enc) throw new Error(`combat: unknown encounter "${encounterId}"`);
    const questCaptions: string[] = [];
    if (enc.id === 'enc.morgarten') {
      // Cross-module request (requests/quest-2.md §2, LORE §6 step 11): ignoring Heinrich von Hünenberg's
      // warning means fewer boulder caches were readied before the ambush. `getFlag` returns `unknown` (it
      // may be unset entirely, e.g. the quest never ran) — only an EXPLICIT `false` (warning heard and
      // ignored) nerfs the caches; `undefined`/`true` leave the encounter as authored.
      const heeded = this.host.questService?.getFlag('hunenberg-warning');
      if (heeded === false) {
        // The two caches nearest the Haufen blocks (co-located on each block's own cells) stay; drop the two
        // farther-flung ones (up-column, and the one by the Schwyz relief's arrival point) — fewer stones
        // laid without warning enough in advance to work the whole slope.
        const dropCells = new Set(['10,11', '13,9']);
        const trimmed = (enc.terrainFeatures ?? []).filter((f) => !dropCells.has(`${f.cells[0][0]},${f.cells[0][1]}`));
        enc = { ...enc, terrainFeatures: trimmed };
        questCaptions.push('Without the warning, fewer stones were laid.');
      }
      // Cross-module request (requests/quest-3.md): `quest.muster-1315`'s letzi-craft and recruit checks set
      // two more flags for this same read-at-setup pattern — a success ADDS something earned, symmetric with
      // `hunenberg-warning` above (which removes something when the warning was ignored).
      if (this.host.questService?.getFlag('morgarten.letzi-improved') === true) {
        // One extra letzi-wall segment on the Confederate side, extending the existing north/south wall one
        // row closer to each Haufen block's own gap — cover for the "hold the slope" opening turns.
        enc = { ...enc, terrainFeatures: [...(enc.terrainFeatures ?? []), { kind: 'letzi-wall', cells: [[8, 3], [8, 19]] }] };
        questCaptions.push('The letzi stands higher than the old counts allowed.');
      }
      if (this.host.questService?.getFlag('morgarten.recruits-strong') === true) {
        // Two extra militia-spear allies, one beside each Haufen block (same `group` as that block, so they
        // merge into its formation naturally) — the Schwyz contingent's own strength check paying off on
        // the field, not just in the dialogue's text.
        enc = {
          ...enc,
          units: [
            ...enc.units,
            { archetype: 'militia-spear', side: 'player', q: 9, r: 7, group: 'haufen-a' },
            { archetype: 'militia-spear', side: 'player', q: 9, r: 17, group: 'haufen-b' },
          ],
        };
        questCaptions.push('The Schwyz contingent swelled past the old counts.');
      }
    }
    this.resetState();
    this.enc = enc;
    // issue: `enc.ambush` (schema field) was ignored — an explicit opts.ambush still wins, but the encounter's
    // own authored ambush now applies when the caller doesn't override it.
    this.ambush = opts?.ambush ?? enc.ambush;
    const { grid, cells } = buildGrid(enc, this.host.worldService);
    this.grid = grid;
    this.cells = cells;
    this.deployZone = enc.deploy;
    this.objectives = enc.objectives.map((def) => ({ def, done: false }));
    const scriptedSpawnEnemyCount = (enc.scripted ?? []).reduce((n, e) => n + e.actions.reduce((m, a) => m + ('spawn' in a && a.spawn.side === 'enemy' ? (a.spawn.count ?? 1) : 0), 0), 0);
    this.totalEnemyEverCount = enc.units.filter((u) => u.side === 'enemy').reduce((n, u) => n + (u.count ?? 1), 0) + scriptedSpawnEnemyCount;
    this.loseObjectives = (enc.loseObjectives ?? []).map((def) => ({ def, done: false }));
    this.placeUnits(enc);
    // Ambushed defenders (§5.3: "unseen attacker" round) start with weapons already set: a braced polearm
    // line is exactly what an ambush prepared for cavalry looks like.
    if (this.ambush === 'player') {
      for (const u of this.units.values()) if (u.side === 'player' && isPolearm(u.weapon)) u.stance = 'braced';
    } else if (this.ambush === 'enemy') {
      for (const u of this.units.values()) if (u.side === 'enemy' && isPolearm(u.weapon)) u.stance = 'braced';
    }
    this.ended = false;
    for (const caption of questCaptions) this.pushLog('caption', caption);
    // Real deploy phase (issue 9): only when a human party exists to place — the harness/standalone fallback
    // squad has no one to hand deployment to, so it auto-deploys and rolls initiative immediately as before.
    const realPartyPresent = this.host.party.getParty().length > 0;
    if (realPartyPresent) {
      this.phase = 'deploy';
      this.pushLog('log', `${enc.name} begins. Deploy the party.`);
      this.emitState();
      this.host.events?.emit('request-state', 'combat');
      return new Promise<CombatResult>((resolve) => { this.resultResolve = resolve; });
    }
    this.rollInitiative();
    this.phase = 'active';
    this.pushLog('log', `${enc.name} begins.`);
    this.emitState();
    // Autosave contract: isActive() and serialize() must be valid before this fires.
    this.host.events?.emit('request-state', 'combat');
    return new Promise<CombatResult>((resolve) => {
      this.resultResolve = resolve;
      // advance() can resolve the whole encounter synchronously (e.g. an instant rout) — resultResolve must
      // already be captured before that happens, or the returned promise would never settle.
      this.advance();
    });
  }

  /** Finalises deployment: rolls initiative and begins round 1. Called by the first `{type:'deploy'}` command,
   *  or by `{type:'auto'}` in harness/AI-driven mode ("auto-deploy after a timeout" — BUILDER_RULES.md). */
  private finishDeploy(): void {
    if (this.phase !== 'deploy') return;
    this.rollInitiative();
    this.phase = 'active';
    this.advance();
  }

  private resetState(): void {
    this.enc = null; this.grid = null; this.cells = [];
    this.units.clear(); this.order = []; this.turnIndex = 0; this.round = 0;
    this.phase = 'ended'; this.activeUnitId = null; this.log = [];
    this.objectives = []; this.loseObjectives = []; this.featureUses.clear();
    this.resultResolve = null; this.forceAiAll = false; this.reactionQueue = [];
    this.scriptedRoundFired.clear(); this.ended = false; this.outcome = null;
    this.stalemateFingerprint = ''; this.stalemateRounds = 0; this.moraleCheckedThisRound.clear();
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
      // A real party supersedes the standalone fallback squad (ungrouped side:'player' units, used only so
      // an encounter is playable stand-alone with no exploration/party — BUILDER_RULES.md). Grouped player-
      // side units (e.g. Morgarten's 8 allied militia, group:'haufen') are persistent NPC allies and are
      // always placed alongside whatever real party exists, not replaced by it.
      if (pu.side === 'player' && useRealParty && !pu.group) continue;
      const def = pu.npc ? this.host.content.npcs.get(pu.npc) : pu.archetype ? this.host.content.archetypes.get(pu.archetype) : undefined;
      if (!def) { console.warn(`[combat] placeUnits: no archetype/npc for placed unit`, pu); continue; }
      const count = pu.count ?? 1;
      for (let i = 0; i < count; i++) {
        const { q, r } = this.spreadCell(pu.q, pu.r, i, enc);
        const unit = this.spawnUnit(def, pu.side, q, r, { mounted: pu.mounted, group: pu.group, name: pu.name, npcId: pu.npc });
        this.applyEncounterMorale(unit, enc);
        ordinal++;
      }
    }
    void ordinal;
    if (useRealParty) {
      realParty.forEach((id, i) => {
        const { q, r } = this.deployCellFor(i);
        const unit = this.attachExistingUnit(id, 'player', q, r);
        this.applyEncounterMorale(unit, enc);
      });
    }
  }

  /** `EncounterDef.morale` ("initial morale modifier for each side") was declared on the schema but never
   *  actually read anywhere — an inert field, same class of bug as issue 5's dead abilities. Wired in here so
   *  content (e.g. Morgarten's home-ground Confederate confidence vs. a road-weary Habsburg column) can use
   *  it; clamped to the same [0, moraleMax] range `applyMoraleDelta` uses. */
  private applyEncounterMorale(unit: Unit, enc: EncounterDef): void {
    const delta = enc.morale?.[unit.side];
    if (!delta) return;
    unit.morale = Math.max(0, Math.min(unit.moraleMax, unit.morale + delta));
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
    const unit = this.attachExistingUnit(id, side, q, r, opts, def.name);
    // round-2 endgame rule a: archetype/NPC squads (not the real party, whose own inventory governs ammo) get
    // a finite quiver — the fake test party service hands out a flat 20, which reads as effectively unlimited
    // and was the actual root cause of the 100-round crossbowman-kiting grind the critic traced issue 1 to.
    // 8-10 bolts, deterministic per archetype so the same encounter always starts the same way.
    if (unit.ranged) unit.ammoQty = Math.min(unit.ammoQty, 9);
    return unit;
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
    // Every side:'player' unit waits for an explicit command (submit(), or a harness {type:'auto'} script) —
    // real party members controlled by a human UI, and the encounter's own standalone fallback squad (no
    // party exists yet) controlled by the harness/AI script per BUILDER_RULES.md. Only side:'enemy' units
    // act automatically on their own initiative turn.
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
      isPlayerControlled: side === 'player', doctrine: doctrineFor(ch.archetype, side),
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
    // issue 14: `u.initiativeBonus` (from `DerivedStats.initiativeBonus`) already includes the agility
    // modifier — adding `modifier(agility)` again here double-counted it.
    const rolled = [...this.units.values()].map((u) => ({
      u, roll: this.host.rng.die(10) + u.initiativeBonus, tie: this.host.rng.next(),
    }));
    rolled.sort((a, b) => b.roll - a.roll || (modifier(b.u.attributes.agility) - modifier(a.u.attributes.agility)) || (b.tie - a.tie));
    this.order = rolled.map((r) => r.u.id);
    for (const r of rolled) r.u.initiative = r.roll;
    // Force nextUnit()'s very first call to see "past the end of the order" so it calls startRound() and
    // properly begins round 1 (with round-1 scripted events, bleed ticks, etc.) before anyone's first turn,
    // instead of only discovering the round boundary after the whole initiative order has already acted once.
    this.turnIndex = this.order.length;
    this.activeUnitId = null;
  }

  /** A scripted mid-encounter reinforcement (issue (b), the Morgarten waves) rolls its own initiative and is
   *  appended to the end of `this.order` — safe to do at any point since `order` is a fixed, cycled array and
   *  appending never disturbs `turnIndex`'s position among the entries already visited this round. It then
   *  acts every round from here on, at the tail of the sequence. */
  private insertIntoInitiative(u: Unit): void {
    u.initiative = this.host.rng.die(10) + u.initiativeBonus;
    this.order.push(u.id);
  }

  // ---------------- round / turn loop ----------------

  private advance(): void {
    let guard = 0;
    while (guard++ < 20000) {
      if (this.ended) return;
      if (this.checkEndConditions()) { this.finish(); return; }
      if (this.reactionQueue.length) { this.phase = 'reaction'; this.emitState(); return; }
      if (this.activeUnitId === null) {
        if (this.autoStopRound !== null && this.round >= this.autoStopRound) { this.emitState(); return; }
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
    // Defensive backstop only (stalemate detection in startRound() should always end things first): never
    // spam a console error over a legal command, just end the encounter as an unresolved stalemate.
    if (!this.ended) { this.outcome = this.outcome ?? 'fled'; this.pushLog('log', 'The engagement stalls; no outcome is reached.'); this.finish(); }
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
    this.moraleCheckedThisRound.clear();
    for (const u of this.units.values()) {
      if (u.down && !u.dead) {
        u.bleedTurns -= 1;
        if (u.bleedTurns <= 0) { u.dead = true; this.pushLog('death', `${u.name} bleeds out.`, u.id); }
      }
    }
    this.pushLog('round', `Round ${this.round} begins.`, undefined, { round: this.round });
    this.runScriptedEvents((e) => e.round === this.round);
    this.updateObjectiveProgress();
    this.checkStalemate();
  }

  /** issue 10 / probe 7: end a genuinely unwinnable-by-anyone fight (e.g. two units that can never reach each
   *  other) as a stalemate instead of grinding the loop guard. Fingerprints hp+position+status every round;
   *  20 unchanged rounds in a row ends it. */
  private checkStalemate(): void {
    if (this.ended) return;
    // Balance pass: a Routed unit's exact position doesn't matter for "is this fight decided" — it just
    // wanders toward its own edge every turn (`doRoutedTurn`), which changed the fingerprint every round and
    // meant a fight with nothing left but a few fleeing stragglers, permanently stuck behind the new
    // chokepoint terrain and never quite reaching the map edge, could run for hundreds of rounds without ever
    // tripping stalemate detection.
    const fp = [...this.units.values()]
      .map((u) => (u.routed ? `${u.id}:R` : `${u.id}:${u.hp}:${u.q},${u.r}:${u.down ? 1 : 0}:0`))
      .sort().join('|');
    if (fp === this.stalemateFingerprint) {
      this.stalemateRounds++;
      if (this.stalemateRounds >= 20) {
        this.outcome = this.outcome ?? 'fled';
        this.pushLog('log', 'Neither side can close — the engagement ends in a stalemate.');
        this.finish();
      }
    } else {
      this.stalemateFingerprint = fp;
      this.stalemateRounds = 0;
    }
  }

  private beginUnitTurn(u: Unit): void {
    u.ap = { action: true, bonus: true, reaction: true, moveM: u.speedMBase, moveMax: u.speedMBase };
    u.chargeCells = 0;
    u.freeReloadUsedThisTurn = false;
    u.hasActedThisTurn = false;
    for (const s of u.status) s.turns -= 1;
    u.status = u.status.filter((s) => s.turns > 0);
    // issue 8: Shaken also impedes movement — approximated as half speed (the fuller "may not advance toward
    // the enemy" rule would need per-step direction tracking in the pathfinder).
    if (hasStatus(u, 'shaken')) { u.ap.moveM = u.speedMBase / 2; u.ap.moveMax = u.ap.moveM; }
    this.tickDrowning(u);
    // round-2 issue 3: a drowning unit cannot swim itself out — it needs a comrade to spend a bonus action
    // hauling it out (`ability.haul-out`, which clears the status). Previously it kept its full move budget
    // and simply walked out on its own next turn, which is why Drowning never mattered in play.
    if (hasStatus(u, 'drowning')) { u.ap.moveM = 0; u.ap.moveMax = 0; }
    this.pushLog('turn-start', `${u.name}'s turn.`, u.id);
  }

  /** issue 5 / issue 3: Drowning is real — 1d6 automatic damage every turn spent in water (no action needed
   *  to suffer it), and it kills outright rather than just downing, so a knight weighed down by mail does not
   *  get back up (LORE §1: "many knights drown in the lake"). Leaving the water (or being hauled out) clears it. */
  private tickDrowning(u: Unit): void {
    if (u.dead || !hasStatus(u, 'drowning')) return;
    const cell = this.cellAt(u.q, u.r);
    if (cell?.surface !== 'water') { removeStatus(u, 'drowning'); return; }
    const dmg = rollDice('1d6', this.host.rng);
    u.hp = Math.max(0, u.hp - dmg);
    if (u.isPlayerControlled) this.host.party.damage(u.id, dmg);
    this.pushLog('damage', `${u.name} is dragged under and drowns for ${dmg}.`, u.id, { amount: dmg });
    if (u.hp <= 0) { u.dead = true; u.down = false; this.pushLog('death', `${u.name} drowns.`, u.id); }
  }

  private doRoutedTurn(u: Unit): void {
    const budget = u.speedMBase * 2; // "flees toward own edge at Dash speed"
    if (!this.grid) return;
    const dist = dijkstra(u.q, u.r, budget, u.side, { cols: this.grid.cols, rows: this.grid.rows, cellM: this.grid.cellM, cells: this.cells }, this.occupants(u.id), u.mounted);
    // Round-3 minor fix: a routed unit used to head for a fixed row (its "own" edge — r=0 for enemy, rows-1
    // for player) regardless of what's actually there. At Brunnen that row IS the lake, so routed units waded
    // straight into the water they should have been fleeing from. Now it's the nearest reachable non-water
    // cell to ANY map edge — genuinely "away from the fight," never "into the lake."
    const { cols, rows } = this.grid;
    const edgeDist = (q: number, r: number) => Math.min(r, rows - 1 - r, q, cols - 1 - q);
    let best: CellKey | null = null;
    let bestScore = -Infinity;
    for (const [key, v] of dist) {
      if (v.cost === 0) continue;
      const [q, r] = key.split(',').map(Number);
      if (this.occupantAt(q, r, u.id)) continue;
      if (this.cellAt(q, r)?.surface === 'water') continue;
      const score = -edgeDist(q, r);
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
      // 'protect' reads as "the target is still safe" when met — as a lose condition that means "not lost
      // yet", so it triggers a loss on failure, the opposite of every other objective type (which trigger a
      // loss when they themselves become true, e.g. an enemy reaching a cell it shouldn't).
      const met = this.objectiveMet(lo.def);
      const triggersLoss = lo.def.type === 'protect' ? !met : met;
      if (triggersLoss) { this.outcome = 'lose'; return true; }
    }
    // Balance pass: these two unconditional "wipe/rout everyone currently on the field" checks must wait
    // for every scripted reinforcement wave to have actually spawned — otherwise wiping out just the round-1
    // vanguard (5 of ~16 Habsburg units) reads as defeating "the enemy" and ends the fight before waves 2/3
    // (11 more units) ever arrive.
    const allEnemiesSpawned = [...this.units.values()].filter((u) => u.side === 'enemy').length >= this.totalEnemyEverCount;
    if (allEnemiesSpawned && enemyAlive.length === 0) { this.outcome = 'win'; return true; }
    if (allEnemiesSpawned && enemyAlive.every((u) => u.routed)) { this.outcome = 'win'; return true; }
    // Balance pass: "you have defeated the enemy" (`rout`/`defeat-all`) is always independently sufficient
    // for victory, regardless of whatever other checkpoint objectives (`hold-cells`, `trigger-features`, ...)
    // are also listed — those describe how well you fought, not a precondition for winning at all. Without
    // this, combining a checkpoint objective that can regress (a block advancing off its `hold-cells` cells
    // once the AI presses the attack, by design) with `rout` in the same `every()` AND meant the encounter
    // could satisfy `rout` and then run forever, never able to also re-satisfy the checkpoint — the actual
    // cause of several AI-vs-AI samples hitting the sampler's 500-round cap.
    if (this.objectives.some((o) => (o.def.type === 'rout' || o.def.type === 'defeat-all') && (o.done || this.objectiveMet(o.def)))) { this.outcome = 'win'; return true; }
    // Balance pass: objectives like `hold-cells` are checkpoints ("held the line for 3 rounds") that can
    // legitimately stop being true later (the block advances off those exact cells once the AI presses the
    // attack, by design) — recomputing them fresh here would mean the encounter could NEVER win once the
    // block moved, even after the column had long since broken (this was the actual cause of several
    // AI-vs-AI samples running to the 500-round sampler cap: rout threshold satisfied, hold-cells regressed,
    // and `every()` blocked forever). `o.done` is sticky (see `updateObjectiveProgress`) — `|| objectiveMet`
    // here just means a same-round transition doesn't have to wait for the next `updateObjectiveProgress`.
    if (this.objectives.length && this.objectives.every((o) => o.done || this.objectiveMet(o.def))) { this.outcome = 'win'; return true; }
    return false;
  }

  private objectiveMet(def: Objective): boolean {
    switch (def.type) {
      case 'defeat-all': return [...this.units.values()].filter((u) => u.side === 'enemy').every((u) => u.dead);
      case 'rout': {
        // round-2 issue (b): the schema's `threshold?` was declared but never read — every `rout` objective
        // silently demanded 100%. Morgarten sets 0.6 so Leopold and a rump can "escape" (LORE §1) instead of
        // the fight dragging on until every last routed straggler is hunted down. Balance pass: the
        // denominator is the FULL eventual column (`totalEnemyEverCount`, including units that haven't
        // scripted-spawned in yet), not just whoever currently exists — otherwise routing the round-1
        // vanguard alone could satisfy 60% on round 1, before waves 2/3 (11 more Habsburg units) ever showed
        // up, which is exactly what an early version of this fix did (instant "wins" at round 1).
        const enemyUnits = [...this.units.values()].filter((u) => u.side === 'enemy');
        const total = Math.max(enemyUnits.length, this.totalEnemyEverCount);
        if (total === 0) return true;
        const removed = enemyUnits.filter((u) => u.dead || u.down || u.routed).length;
        return removed / total >= (def.threshold ?? 1);
      }
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
      // Sticky: once a checkpoint objective is met, it stays met for end-condition purposes even if it later
      // regresses (a block advancing off its `hold-cells` cells, a rallied unit un-Routing below `rout`'s
      // threshold) — see the comment in `checkEndConditions`.
      o.done = o.done || this.objectiveMet(o.def);
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
    this.lastResult = result;
    this.pushLog('end', `Combat ends: ${outcome}.`, undefined, { outcome });
    this.emitState();
    this.bus.emit('end', result);
    this.host.events?.emit('request-state', outcome === 'lose' && ![...this.units.values()].some((u) => u.isPlayerControlled && !u.dead) ? 'gameover' : 'explore');
    this.resultResolve?.(result);
    this.resultResolve = null;
  }

  /** round-2 issue 5: exposed alongside `restore()` (not part of the `CombatService` interface — see
   *  `index.ts`, which wires it in as an extra property since the save module's load path awaits `restore()`
   *  for the state sync but must NOT await `start()` again). Call after `restore()` to learn the eventual
   *  outcome of a mid-combat save: resolves immediately if the restored encounter had already ended, or once
   *  `finish()` next runs if it's still active. */
  resume(): Promise<CombatResult> {
    if (this.lastResult && (this.ended || !this.isActive())) return Promise.resolve(this.lastResult);
    if (!this.isActive()) return Promise.resolve({ outcome: 'fled', rounds: this.round, downed: [], dead: [], xp: {}, loot: [], log: this.log.map((l) => l.text) });
    return new Promise<CombatResult>((resolve) => { this.resultResolve = resolve; });
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
        if (def && this.enc) {
          // round-2 issue (b): `a.spawn.name` was silently dropped (never passed to spawnUnit) — a scripted
          // reinforcement named 'Duke Leopold' would spawn as a plain "Habsburg Knight". Also: a spawned unit
          // was never added to `this.order`, so it existed as a valid target but was never actually given a
          // turn — the "second/third wave" would stand there forever, decorative only.
          const unit = this.spawnUnit(def, a.spawn.side, a.spawn.q, a.spawn.r, { mounted: a.spawn.mounted, group: a.spawn.group, npcId: a.spawn.npc, name: a.spawn.name });
          this.insertIntoInitiative(unit);
        }
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
      defense: this.effectiveDefense(u, this.cellAt(u.q, u.r)?.cover ?? 0),
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
    out.push('ability.attack'); // always available — an unarmed strike is the fallback (see attackInputsFor)
    if (u.ranged && u.loaded) out.push('ability.aimed-shot');
    if (u.ranged && !u.loaded && u.ammoQty > 0) out.push('ability.reload');
    out.push('ability.shove', 'ability.disengage', 'ability.dash', 'ability.bandage', 'ability.haul-out');
    if (u.leadershipLevel >= 10) out.push('ability.rally');
    if (isPolearm(u.weapon)) out.push('ability.brace');
    if (u.mounted && u.weapon) out.push('ability.charge');
    // Round-3 critic issue 1: a unit standing on a ready cache never had `ability.roll-boulders` in its own
    // offered list — the engine accepted the command when the AI (or a debug script) fired it directly, but
    // the Wave-3 HUD binds to `abilitiesFor`'s list, so a real player could never see or use it.
    const standingCell = this.cellAt(u.q, u.r);
    if (standingCell?.feature === 'boulder-cache' || standingCell?.feature === 'trunk-cache') out.push('ability.roll-boulders');
    for (const abilityId of GRANTED_ABILITY_IDS) {
      // ability.riposte is an automatic substitute for an opportunity attack (see resolveOpportunityAttack),
      // never something a unit selects on its own turn — keep it out of the offered list.
      if (abilityId === 'ability.riposte') continue;
      const perkId = ABILITY_TO_PERK[abilityId];
      if (perkId && this.host.party.hasPerk(u.id, perkId)) out.push(abilityId);
    }
    return out;
  }

  // ---------------- CombatService: preview / query ----------------

  reachable(unitId: EntityId): CellKey[] {
    const u = this.units.get(unitId);
    if (!u || !this.grid) return [];
    return reachableCells(u.q, u.r, u.ap.moveM, u.side, this.pathGrid(), this.occupants(u.id), u.mounted, hasStatus(u, 'mountain-stride'));
  }

  previewMove(unitId: EntityId, to: CellKey): { path: CellKey[]; costM: number; provokes: EntityId[] } | null {
    const u = this.units.get(unitId);
    if (!u || !this.grid) return null;
    const dist = dijkstra(u.q, u.r, u.ap.moveM, u.side, this.pathGrid(), this.occupants(u.id), u.mounted, hasStatus(u, 'mountain-stride'));
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
    // issue 7 / probe 6: cover must match what `resolveAttack` actually rolls against, and the estimate must
    // be exact (crit range + nat-1), not a linear approximation — see rules/attack.ts `estimateHitChance`.
    const defense = this.effectiveDefense(targetUnit, this.cellAt(targetUnit.q, targetUnit.r)?.cover ?? 0);
    const net = edge.length - burden.length;
    const mode = net > 0 ? 'edge' : net < 0 ? 'burden' : 'normal';
    const p = estimateHitChance(attackBonus, defense, u.critRange, mode);
    return { hitChance: Math.round(p * 100) / 100, context: ctx, damage: weapon.damage };
  }

  cellToWorld(cell: CellKey): { x: number; y: number; z: number } {
    if (!this.grid) return { x: 0, y: 0, z: 0 };
    const { x, z } = cellToWorldXZ(cell.q, cell.r, this.grid);
    const c = this.cellAt(cell.q, cell.r);
    return { x, y: c?.height ?? 0, z };
  }

  // ---------------- ability / attack support ----------------

  /** issue 1 / probe 1: is `target` actually a legal target of `ability` for `u` right now — in `targets()`'s
   *  own list (which already applies `abilityRangeCells`)? A `target === undefined` call (self/area abilities
   *  used without an explicit target, e.g. Rally, Disengage, Roll Boulders) is always allowed; those read
   *  their own targets internally. */
  private targetAllowed(u: Unit, ability: AbilityDef, target: CellKey | EntityId | undefined): boolean {
    if (target === undefined) return true;
    if (ability.target === 'self') return target === u.id;
    const valid = this.targets(u.id, ability.id);
    if (typeof target === 'number') return valid.some((v) => v === target);
    return valid.some((v) => typeof v === 'object' && v.q === target.q && v.r === target.r);
  }

  /** Defensive distance re-check inside `resolveAttack` itself, independent of the `targetAllowed` gate at the
   *  command boundary (issue 1: "make `resolveAttack` assert `cellDistance ≤ reach` defensively"). */
  private withinReach(attacker: Unit, target: Unit, ability: AbilityDef): boolean {
    return cellDistance(attacker.q, attacker.r, target.q, target.r) <= this.abilityRangeCells(attacker, ability);
  }

  /** issue (round 2, endgame rule a): a ranged weapon with an empty quiver is not usable at range —
   *  `canFireRanged` is the single gate every reach/weapon-selection check below goes through. */
  private canFireRanged(u: Unit): boolean {
    return !!u.ranged && u.ammoQty > 0;
  }

  private abilityRangeCells(u: Unit, ability: AbilityDef): number {
    if (ability.range === 'weapon') {
      if (ability.id === 'ability.aimed-shot' || ability.id === 'ability.crossbow-snapshot') return this.canFireRanged(u) ? (u.ranged?.range?.long ?? 8) : 0;
      // 'ability.attack' is "whatever is in hand": a unit carrying both a melee sidearm and a loaded ranged
      // weapon (every crossbowman archetype does — a dagger alongside the Armbrust) can reach with EITHER,
      // so its target list is the union of both reaches, not just the melee sidearm's 1-cell reach (that bug
      // silently reduced every dagger+crossbow unit to melee-only — no crossbowman ever actually fired).
      const meleeReach = u.weapon?.reach ?? (u.ranged ? 0 : 1);
      const rangedReach = this.canFireRanged(u) ? (u.ranged?.range?.long ?? u.ranged?.reach ?? 0) : 0;
      return Math.max(meleeReach, rangedReach, 1);
    }
    return ability.range;
  }

  private meleeReach(u: Unit): number {
    return u.weapon?.reach ?? 1;
  }

  /** issue 4 / probe 3b-3c: flanking requires both hostiles to actually be within reach of the target, and
   *  excludes Down/Routed units (they aren't a threatening second blade). */
  private targetIsFlanked(target: Unit, attacker: Unit): boolean {
    if (target.formation.inHaufen) return false; // Haufen units are immune to flanking
    const hostiles = [...this.units.values()]
      .filter((o) => o.id !== attacker.id && o.id !== target.id && !o.dead && !o.down && !o.routed && o.side !== target.side)
      .map((o) => ({ q: o.q, r: o.r, reach: this.meleeReach(o) }));
    return isFlanked({ q: target.q, r: target.r }, { q: attacker.q, r: attacker.r, reach: this.meleeReach(attacker) }, hostiles);
  }

  private attackInputsFor(attacker: Unit, target: Unit, ability: AbilityDef, notMoved = false): { attackBonus: number; edge: string[]; burden: string[]; weapon: WeaponInfo } {
    // issue 5: Disarmed forces the unarmed fallback regardless of what's equipped.
    const disarmed = hasStatus(attacker, 'disarmed');
    // Plain 'ability.attack' picks whichever weapon can actually reach the target: melee if the target is
    // within the sidearm's reach (or there's no ranged weapon to fall back on), ranged otherwise. A unit with
    // both (every crossbowman) is not melee-only just because it happens to also carry a dagger — but only
    // when there's still a bolt to loose (round-2 endgame rule a: empty quiver forces melee).
    const meleeReachFor = attacker.weapon?.reach ?? 1;
    const distToTarget = cellDistance(attacker.q, attacker.r, target.q, target.r);
    const usingRanged = !disarmed && this.canFireRanged(attacker) && (ability.id === 'ability.aimed-shot' || ability.id === 'ability.crossbow-snapshot'
      || (ability.id === 'ability.attack' && (!attacker.weapon || distToTarget > meleeReachFor)));
    const weapon = disarmed ? undefined : ((usingRanged ? attacker.ranged : attacker.weapon) ?? attacker.weapon ?? attacker.ranged);
    if (!weapon) return { attackBonus: attacker.attackBonus['unarmed'] ?? 0, edge: [], burden: [], weapon: { defId: '', name: 'fists', hands: 1, reach: 1, damage: '1d2', damageType: 'blunt', properties: [] } };
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
    // round-2 issue 4a: a steadied Aimed Shot (hasn't moved this turn) gets its own Edge source — captured by
    // the caller (cmdAbility/aiAbility) BEFORE `checkAndSpendCost`'s `noMove` cost zeroes `ap.moveM`, since by
    // the time this method runs that zeroing has already happened.
    if (ability.id === 'ability.aimed-shot' && notMoved) edge.push('aimed');
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
    // issue 8: Shaken now actually costs the attacker something (Burden), not only granting Edge to whoever
    // attacks a Shaken target.
    if (hasStatus(attacker, 'shaken')) burden.push('shaken');
    if (hasStatus(attacker, 'fumbled')) burden.push('fumbled'); // last attack's natural 1 — consumed in resolveAttack
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
        case 'reaction': return this.cmdReaction(cmd.unit, cmd.accept);
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
    // issue 9 / probe 2: `deploy` used to be callable at any point in the fight (an exploit — reposition units
    // for free mid-battle). It now only works during the real `deploy` phase (see `start()`/`finishDeploy()`).
    if (this.phase !== 'deploy') return { ok: false, reason: 'not deploying' };
    for (const p of placements) {
      const u = this.units.get(p.unit);
      if (!u || u.side !== 'player') continue;
      const z = this.deployZone;
      if (p.to.q < z.q || p.to.q >= z.q + z.cols || p.to.r < z.r || p.to.r >= z.r + z.rows) continue;
      u.q = p.to.q; u.r = p.to.r;
    }
    this.recomputeFormation();
    this.finishDeploy();
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
    for (const d of this.computeBraceTriggers(u, path)) this.queueBrace(d, u);
    for (const d of this.computeCoverFireTriggers(u, path)) this.queueCoverFire(d, u);
    return events;
  }

  /** issue: Cover Fire reaction (§5.3, builder-admitted gap, critic-rated medium) — a loaded crossbowman
   *  fires at a unit that just ended its movement within short range, when it wasn't already in range. */
  private computeCoverFireTriggers(mover: Unit, path: CellKey[]): Unit[] {
    if (path.length < 2) return [];
    const start = path[0];
    return [...this.units.values()].filter((d) => {
      if (d.side === mover.side || d.dead || d.down || !d.ranged || !d.loaded || !d.ap.reaction) return false;
      const short = d.ranged.range?.short ?? 6;
      const wasIn = cellDistance(d.q, d.r, start.q, start.r) <= short;
      const nowIn = cellDistance(d.q, d.r, mover.q, mover.r) <= short;
      return !wasIn && nowIn;
    });
  }

  /** Braced (or in-Haufen) polearm defenders whose reach the mover just entered by moving ≥ 2 cells in a
   *  straight line, or by being mounted (ARCHITECTURE.md §5.3 Reactions / §5.5 Haufen). A charge into any
   *  front unit of a Haufen pulls the Brace reaction from every adjacent facing polearm unit in it. */
  private computeBraceTriggers(mover: Unit, path: CellKey[]): Unit[] {
    if (path.length < 2) return [];
    // Round-3 critic issue 3: the trigger required only a 2-cell straight run while Charge itself needs 3 —
    // any footman who walked two cells into a Haufen's reach drew a free Edge attack, over-generous to the
    // defender and inconsistent with the Charge rule this reaction is supposed to answer.
    if (!(mover.chargeCells >= 3 || mover.mounted)) return [];
    const startCell = path[0];
    const candidates = [...this.units.values()].filter((d) => d.side !== mover.side && !d.dead && !d.down && isPolearm(d.weapon) && (d.stance === 'braced' || d.formation.inHaufen) && d.ap.reaction);
    const primaries = candidates.filter((d) => {
      const reach = d.weapon?.reach ?? 1;
      const wasAdjacent = cellDistance(d.q, d.r, startCell.q, startCell.r) <= reach;
      const nowAdjacent = cellDistance(d.q, d.r, mover.q, mover.r) <= reach;
      return !wasAdjacent && nowAdjacent;
    });
    const extras = new Set<Unit>();
    for (const d of primaries) {
      // ARCHITECTURE §5.3: "a cavalry Charge into a front unit pulls the Brace reaction from every adjacent
      // facing polearm unit" — infantry stepping into reach only ever draws its own primary defender(s), not
      // the whole face of the Haufen.
      if (d.formation.inHaufen && mover.mounted) {
        for (const o of candidates) {
          if (o.id === d.id || o.formation.haufenId !== d.formation.haufenId) continue;
          const reach = o.weapon?.reach ?? 1;
          if (cellDistance(o.q, o.r, mover.q, mover.r) <= reach) extras.add(o);
        }
      }
      // issue 5 (Wall of Iron, perk.spear-50): a braced spearman with this status covers up to 2 adjacent
      // allies' cells too, even outside a Haufen.
      if (hasStatus(d, 'wall-of-iron')) {
        const adjAllies = [...this.units.values()]
          .filter((o) => o.id !== d.id && o.side === d.side && !o.dead && !o.down && isPolearm(o.weapon) && o.ap.reaction && cellDistance(o.q, o.r, d.q, d.r) <= 1 && cellDistance(o.q, o.r, mover.q, mover.r) <= (o.weapon?.reach ?? 1))
          .slice(0, 2);
        for (const o of adjAllies) extras.add(o);
      }
    }
    const all = new Map<EntityId, Unit>();
    for (const d of [...primaries, ...extras]) all.set(d.id, d);
    return [...all.values()];
  }

  private applyFall(u: Unit, meters: number): void {
    const dmg = Math.max(0, Math.floor(meters / 3)) * rollDice('1d6', this.host.rng);
    this.applyDamage(u, dmg, 'blunt', 0);
    // issue 5: Sure Foot — immune to falling Prone from a slope or a failed shove this round (still takes damage).
    if (!hasStatus(u, 'sure-footed')) addStatus(u, 'prone', 1);
    this.pushLog('damage', `${u.name} falls ${meters.toFixed(1)} m and takes ${dmg} damage.`, u.id, { amount: dmg });
  }

  private applyDamage(target: Unit, amount: number, _type: DamageType, _soak: number): void {
    target.hp = Math.max(0, target.hp - amount);
    const justWentDown = target.hp <= 0 && !target.down;
    if (justWentDown) { target.down = true; target.bleedTurns = 3; this.pushLog('down', `${target.name} goes down.`, target.id); }
    if (target.isPlayerControlled) this.host.party.damage(target.id, amount);
    if (amount > 0) this.checkMoraleTrigger(target, 'damage');
    if (justWentDown) {
      // issue 8: "ally Down within 3 cells" and "leader Down" morale triggers.
      const isLeader = target.archetype === 'sergeant' || target.archetype === 'knight' || !!target.npcId;
      for (const ally of this.units.values()) {
        if (ally.id === target.id || ally.side !== target.side || ally.dead || ally.down) continue;
        if (isLeader) this.checkMoraleTrigger(ally, 'leader-down');
        else if (cellDistance(ally.q, ally.r, target.q, target.r) <= 3) this.checkMoraleTrigger(ally, 'ally-down');
      }
    }
  }

  private cmdStance(unitId: EntityId, stance: Unit['stance']): CommandResult {
    const u = this.units.get(unitId);
    if (!u) return { ok: false, reason: 'no such unit' };
    // issue 2 / probe 2: `cmdStance` never checked whose turn it was — the player could flip an enemy's stance
    // (a −2 Defense debuff) or re-stance a Routed unit at will.
    if (u.id !== this.activeUnitId && !this.forceAiAll) return { ok: false, reason: 'not this unit\'s turn' };
    if (u.dead || u.down || u.routed) return { ok: false, reason: 'unit cannot act' };
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
    // "auto-deploy after a timeout in harness auto mode" (BUILDER_RULES.md): an `auto` command reaching a
    // still-deploying encounter finalises deployment at whatever positions are currently set.
    if (this.phase === 'deploy') this.finishDeploy();
    this.forceAiAll = true;
    this.autoStopRound = this.round + Math.max(1, rounds);
    let guard = 0;
    this.advance();
    // forceAiAll auto-resolves reactions inline (see queueReaction/queueBrace), but drain defensively in case
    // a reaction was queued right as autoStopRound was hit (phase left as 'reaction').
    while (this.reactionQueue.length && guard++ < 1000) this.cmdReaction(this.reactionQueue[0].unitId, true);
    this.forceAiAll = false;
    this.autoStopRound = null;
    if (this.phase === 'reaction') this.phase = 'active';
    this.emitState();
    return { ok: true };
  }

  private cmdReaction(unitId: EntityId, accept: boolean): CommandResult {
    const item = this.reactionQueue[0];
    if (!item) return { ok: false, reason: 'no pending reaction' };
    if (item.unitId !== unitId) return { ok: false, reason: 'not this unit\'s pending reaction' };
    this.reactionQueue.shift();
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

  private queueBrace(defender: Unit, mover: Unit): void {
    if (!defender.ap.reaction) return;
    const resolve = (accept: boolean) => {
      defender.ap.reaction = false;
      if (!accept) return;
      this.resolveBrace(defender, mover);
    };
    const autoResolve = this.forceAiAll || !defender.isPlayerControlled;
    if (autoResolve) { resolve(true); return; }
    this.reactionQueue.push({ unitId: defender.id, ability: 'ability.brace', trigger: 'enter-reach', targetId: mover.id, resolve });
  }

  /** Brace reaction: free attack with Edge; double weapon dice against a mounted target. */
  private resolveBrace(defender: Unit, mover: Unit): void {
    const weapon = defender.weapon;
    if (!weapon) return;
    const skillId = this.host.content.items.get(weapon.defId)?.weapon?.skill ?? '';
    const attackBonus = defender.attackBonus[skillId] ?? 0;
    const defense = this.effectiveDefense(mover, this.cellAt(mover.q, mover.r)?.cover ?? 0);
    const inputs: AttackInputs = {
      attackBonus, targetDefense: defense, edge: ['brace'], burden: [], weaponDice: weapon.damage, damageType: weapon.damageType,
      damageBonus: modifier(defender.attributes.strength), soak: mover.soak, ignoreSoak: defender.perkMods['ignoreSoak'], critRange: defender.critRange,
    };
    const roll = rollAttack(inputs, this.host.rng);
    if (roll.hit && mover.mounted) roll.damage += Math.max(0, rollDice(weapon.damage, this.host.rng) - roll.soak);
    this.pushLog('reaction', `${defender.name} braces against the charge!`, defender.id, { target: mover.id, roll });
    if (roll.hit) this.applyDamage(mover, roll.damage, weapon.damageType, roll.soak);
  }

  private queueCoverFire(defender: Unit, mover: Unit): void {
    if (!defender.ap.reaction) return;
    const resolve = (accept: boolean) => {
      defender.ap.reaction = false;
      if (!accept) return;
      this.resolveCoverFire(defender, mover);
    };
    const autoResolve = this.forceAiAll || !defender.isPlayerControlled;
    if (autoResolve) { resolve(true); return; }
    this.reactionQueue.push({ unitId: defender.id, ability: 'ability.crossbow-snapshot', trigger: 'end-move-in-range', targetId: mover.id, resolve });
  }

  private resolveCoverFire(defender: Unit, mover: Unit): void {
    const ability = this.host.content.abilities.get('ability.aimed-shot');
    if (!ability || !defender.ranged) return;
    this.resolveAttack(defender, mover, ability, { free: true });
    defender.loaded = false; // spent the bolt
    this.pushLog('reaction', `${defender.name} loosed a bolt as ${mover.name} came into range.`, defender.id, { target: mover.id });
  }

  private resolveOpportunityAttack(attacker: Unit, target: Unit, abilityId: string): void {
    // issue 5 (Riposte, perk.sword-50): "when you would take an opportunity attack with a sword, you may
    // instead riposte for full damage" — sword-skilled attackers automatically get the named ability instead
    // of a plain opportunity attack.
    const swordSkill = attacker.weapon ? this.host.content.items.get(attacker.weapon.defId)?.weapon?.skill : undefined;
    const useRiposte = abilityId === 'opportunity-attack' && swordSkill === 'sword' && this.host.party.hasPerk(attacker.id, 'perk.sword-50');
    const resolvedId = useRiposte ? 'ability.riposte' : abilityId === 'opportunity-attack' ? 'ability.attack' : abilityId;
    const ability = this.host.content.abilities.get(resolvedId) ?? this.host.content.abilities.get('ability.attack')!;
    this.resolveAttack(attacker, target, ability, { free: true });
  }

  // ---------------- ability execution ----------------

  private cmdAbility(unitId: EntityId, abilityId: string, target?: CellKey | EntityId): CommandResult {
    const u = this.units.get(unitId);
    const ability = this.host.content.abilities.get(abilityId);
    if (!u || !ability) return { ok: false, reason: 'no such unit/ability' };
    if (u.id !== this.activeUnitId && !this.forceAiAll) return { ok: false, reason: 'not this unit\'s turn' };
    if (!this.targetAllowed(u, ability, target)) return { ok: false, reason: 'target out of range' };
    // round-2 issue 4a: capture "hasn't moved this turn" BEFORE checkAndSpendCost's `noMove` cost zeroes it.
    const notMoved = u.ap.moveM === u.ap.moveMax;
    const costCheck = this.checkAndSpendCost(u, ability);
    if (!costCheck.ok) return costCheck;
    const events: CombatEventRecord[] = [];
    this.executeAbility(u, ability, target, events, notMoved);
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
    // round-2 endgame rule a: any ability that explicitly requires a ranged weapon (Aimed Shot, Cover Fire's
    // snapshot) also requires ammunition left to load into it.
    if (r?.ranged && u.ranged && u.ammoQty <= 0) return { ok: false, reason: 'out of ammo' };
    if (r?.loaded && !u.loaded) return { ok: false, reason: 'not loaded' };
    if (r?.shield && !u.shield) return { ok: false, reason: 'no shield' };
    if (r?.mounted && !u.mounted) return { ok: false, reason: 'not mounted' };
    if (r?.status && !hasStatus(u, r.status)) return { ok: false, reason: 'missing status' };
    if (r?.notStatus && hasStatus(u, r.notStatus)) return { ok: false, reason: 'blocked by status' };
    if (r?.terrainFeature) {
      const c = this.cellAt(u.q, u.r);
      const kinds = Array.isArray(r.terrainFeature) ? r.terrainFeature : [r.terrainFeature];
      if (!c?.feature || !kinds.includes(c.feature)) return { ok: false, reason: 'not on the feature' };
    }
    // issue 2 / probe 4: Charge needs a genuine run-up — `u.chargeCells` is the length of the straight-line
    // segment the mover just walked (tracked in `performMove`), reset to 0 at the start of every turn.
    if (r?.minChargeCells !== undefined && u.chargeCells < r.minChargeCells) return { ok: false, reason: 'no run-up' };
    // issue 15: "only when no enemy is adjacent" — Verschnaufen (formerly "Second Wind") is catching your
    // breath, not something you can do mid-melee.
    if (ability.id === 'ability.second-wind') {
      const adjacentEnemy = [...this.units.values()].some((o) => o.side !== u.side && !o.dead && !o.down && cellDistance(u.q, u.r, o.q, o.r) <= 1);
      if (adjacentEnemy) return { ok: false, reason: 'an enemy is too close to catch your breath' };
    }
    // reload has a dynamic ladder cost; special-case before the generic cost object.
    if (ability.id === 'ability.reload') {
      if (u.ranged && u.ammoQty <= 0) return { ok: false, reason: 'out of ammo' };
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

  /**
   * issue 16: `effects[]` is genuinely interpreted here (not switched on by ability id) for every ability that
   * can be expressed in the CombatEffect DSL — status/removeStatus/push/pull/moraleCheck/heal/reload/rally-
   * flavoured status clears/stance/line/cone/disengage/dash/stabilize (§5.4) all run through `applyEffect`.
   * A handful of mechanics genuinely need data the DSL doesn't carry and stay engine-side: the base weapon
   * hit for `attackRoll` abilities (needs the wielder's actual equipped weapon, not a fixed dice string —
   * `resolveAttack` computes it, then still interprets `effects[]` for the hit's *side* effects), Shove's
   * contested roll, Roll Boulders' cache/affects-line geometry, Bandage's herbalism-gated heal size, and
   * Rally's un-Routing (routed is a Unit flag, not a status the DSL can name). Everything else below is the
   * literal effect list from `content/abilities.ts`.
   */
  private executeAbility(u: Unit, ability: AbilityDef, target: CellKey | EntityId | undefined, events: CombatEventRecord[], notMoved = false): void {
    u.hasActedThisTurn = true;
    if (ability.attackRoll) {
      const t = typeof target === 'number' ? this.units.get(target) : undefined;
      if (!t) return;
      this.resolveAttack(u, t, ability, { charge: ability.id === 'ability.charge', notMoved });
      return;
    }
    switch (ability.id) {
      case 'ability.reload': {
        for (const effect of ability.effects) this.applyEffect(u, undefined, effect);
        this.pushLog('ability', `${u.name} reloads.`, u.id);
        return;
      }
      case 'ability.shove': {
        const t = typeof target === 'number' ? this.units.get(target) : undefined;
        if (!t) return;
        this.resolveShove(u, t);
        return;
      }
      case 'ability.bandage': case 'ability.bandage-quick': {
        const t = typeof target === 'number' ? this.units.get(target) : u;
        if (!t) return;
        if (t.down) {
          for (const effect of ability.effects) if ('stabilize' in effect) this.applyEffect(u, t, effect);
        } else {
          const bonus = this.host.party.skillLevel(u.id, 'herbalism') >= 25 ? rollDice('1d4', this.host.rng) : 0;
          for (const effect of ability.effects) {
            if ('heal' in effect) this.applyHeal(t, rollDice(effect.heal, this.host.rng) + bonus);
            else this.applyEffect(u, t, effect);
          }
        }
        return;
      }
      case 'ability.roll-boulders': {
        const cell = this.cellAt(u.q, u.r);
        const idx = cell?.featureIndex;
        const feature = idx !== undefined ? this.enc?.terrainFeatures?.[idx] : undefined;
        const affects = feature?.affects ?? [];
        this.featureUses.set(idx ?? -1, (this.featureUses.get(idx ?? -1) ?? 0) + 1);
        this.pushLog('feature', `${u.name} rolls ${feature?.kind === 'trunk-cache' ? 'a trunk' : 'boulders'} down the slope!`, u.id, { feature: feature?.kind });
        for (const [q, r] of affects) {
          const hitUnit = this.occupantAt(q, r);
          if (!hitUnit) continue;
          for (const effect of ability.effects) this.applyEffect(u, hitUnit, effect, 'rockfall');
        }
        this.updateObjectiveProgress();
        return;
      }
      case 'ability.rally': case 'ability.rally-bonus': {
        for (const effect of ability.effects) {
          if ('rally' in effect) this.doRally(u, effect.rally.radius);
          else this.applyEffect(u, undefined, effect);
        }
        return;
      }
      default: {
        const t = typeof target === 'number' ? this.units.get(target) : undefined;
        for (const effect of ability.effects) this.applyEffect(u, t, effect);
        this.pushLog('ability', `${u.name} uses ${ability.name}.`, u.id, t ? { target: t.id } : undefined);
        return;
      }
    }
  }

  /** issue 16: the generic CombatEffect interpreter (ARCHITECTURE §5.4). `target` is the explicit target unit
   *  when the command named one; effects that need a target and got none (self/area abilities) fall back to
   *  the caster. */
  private applyEffect(caster: Unit, target: Unit | undefined, effect: CombatEffect, reasonHint = 'ability'): void {
    if ('damage' in effect) {
      if (!target) return;
      const bonusAttr = effect.damage.bonus === 'strength' ? modifier(caster.attributes.strength) : effect.damage.bonus === 'agility' ? modifier(caster.attributes.agility) : 0;
      const raw = rollDice(effect.damage.dice, this.host.rng) + bonusAttr;
      const baseSoak = target.soak[effect.damage.type] ?? 0;
      const soak = effect.damage.type === 'blunt' ? Math.floor(baseSoak / 2) : baseSoak;
      const applied = Math.max(0, raw - soak);
      this.applyDamage(target, applied, effect.damage.type, soak);
      if (applied > 0) this.pushLog('damage', `${target.name} takes ${applied} ${effect.damage.type} damage.`, target.id, { amount: applied, target: target.id });
    } else if ('status' in effect) {
      const t = target ?? caster;
      if (effect.status.id === 'prone' && hasStatus(t, 'sure-footed')) return; // Sure Foot
      addStatus(t, effect.status.id, effect.status.turns);
    } else if ('removeStatus' in effect) {
      removeStatus(target ?? caster, effect.removeStatus);
    } else if ('push' in effect) {
      if (target) for (let i = 0; i < effect.push.cells; i++) this.movePush(target, caster, 1);
    } else if ('pull' in effect) {
      if (target) for (let i = 0; i < effect.pull.cells; i++) this.movePush(target, caster, -1);
    } else if ('moraleCheck' in effect) {
      this.tryMoraleTrigger(target ?? caster, reasonHint, effect.moraleCheck.dc);
    } else if ('heal' in effect) {
      this.applyHeal(target ?? caster, rollDice(effect.heal, this.host.rng));
    } else if ('reload' in effect) {
      caster.loaded = true;
    } else if ('rally' in effect) {
      this.doRally(caster, effect.rally.radius);
    } else if ('stance' in effect) {
      caster.stance = effect.stance;
      this.pushLog('status', `${caster.name} takes a ${effect.stance} stance.`, caster.id);
    } else if ('line' in effect) {
      if (target) this.applyEffect(caster, target, effect.line.effect);
    } else if ('cone' in effect) {
      for (const ally of this.alliesInRadius(caster, effect.cone.cells)) this.applyEffect(caster, ally, effect.cone.effect);
    } else if ('terrainFeature' in effect) {
      // marker only; roll-boulders records the specific feature index itself.
    } else if ('disengage' in effect) {
      addStatus(caster, 'disengaged', 1);
    } else if ('dash' in effect) {
      caster.ap.moveM += caster.speedMBase;
    } else if ('stabilize' in effect) {
      const t = target ?? caster;
      if (!t.down) return;
      t.down = false; t.bleedTurns = 3; t.hp = Math.max(1, Math.floor(t.hpMax * 0.1));
      this.pushLog('status', `${t.name} is stabilised.`, t.id);
      if (t.isPlayerControlled) this.host.party.heal(t.id, t.hp);
    }
  }

  /** issue 5 (Rally): clears Shaken and un-Routs allies in radius. "Un-Routing" is a Unit flag, not a status
   *  the CombatEffect DSL can name, so it stays a small engine-side addition alongside the DSL-driven clear. */
  private doRally(u: Unit, radius: number): void {
    for (const ally of this.units.values()) {
      if (ally.side !== u.side || ally.dead || cellDistance(u.q, u.r, ally.q, ally.r) > radius) continue;
      if (hasStatus(ally, 'shaken')) { removeStatus(ally, 'shaken'); this.pushLog('morale', `${ally.name} is rallied.`, ally.id); }
      if (ally.routed) { ally.routed = false; this.pushLog('morale', `${ally.name} is rallied and holds.`, ally.id); }
    }
  }

  private alliesInRadius(u: Unit, radius: number): Unit[] {
    return [...this.units.values()].filter((o) => o.side === u.side && !o.dead && cellDistance(u.q, u.r, o.q, o.r) <= radius);
  }

  private applyHeal(u: Unit, amount: number): void {
    u.hp = Math.min(u.hpMax, u.hp + amount);
    if (u.isPlayerControlled) this.host.party.heal(u.id, amount);
    this.pushLog('damage', `${u.name} heals ${amount}.`, u.id, { amount: -amount });
  }

  private resolveAttack(attacker: Unit, target: Unit, ability: AbilityDef, opts: { charge?: boolean; free?: boolean; notMoved?: boolean } = {}): void {
    // issue 1: defensive reach re-check even for engine-internal callers (reactions already validate adjacency
    // themselves, but this keeps the invariant true everywhere resolveAttack is reached from).
    if (!opts.free && !this.withinReach(attacker, target, ability)) return;
    const { attackBonus, edge, burden, weapon } = this.attackInputsFor(attacker, target, ability, opts.notMoved ?? false);
    // round-2 endgame rule a: every ranged shot (a loaded bolt actually loosed, incl. Cover Fire) spends one
    // round of ammunition. `weapon.range` is only set on a WeaponInfo built from a ranged item.
    if (weapon.range) attacker.ammoQty = Math.max(0, attacker.ammoQty - 1);
    if (opts.charge) edge.push('charge');
    // issue 8: being flanked is itself a morale trigger, independent of whether the hit lands.
    if (edge.includes('flanked')) this.tryMoraleTrigger(target, 'flanked', moraleDc(1));
    if (hasStatus(attacker, 'fumbled')) removeStatus(attacker, 'fumbled'); // consumed this attempt (already counted as Burden above)
    const defense = this.effectiveDefense(target, this.cellAt(target.q, target.r)?.cover ?? 0);
    const soak = { ...target.soak };
    const inputs: AttackInputs = {
      attackBonus, targetDefense: defense, edge, burden, weaponDice: weapon.damage, damageType: weapon.damageType,
      damageBonus: modifier(weapon.properties.includes('finesse') ? attacker.attributes.agility : attacker.attributes.strength),
      soak, ignoreSoak: attacker.perkMods['ignoreSoak'], critRange: attacker.critRange,
    };
    const roll = rollAttack(inputs, this.host.rng);
    if (roll.fumble) addStatus(attacker, 'fumbled', 1); // issue 8: Burden on the next attack

    // The rest of attack resolution (log, damage, effects, charge follow-up) is deferred behind Shield Block
    // below when the defender is a human waiting to be asked — everything from here on reads `roll.damage`,
    // which the block reaction may still lower first.
    const finishAttack = (): void => {
      this.pushLog('attack', `${attacker.name} attacks ${target.name}: ${roll.hit ? (roll.critical ? 'critical hit' : 'hit') : 'miss'}.`, attacker.id, { target: target.id, roll });
      if (roll.hit) {
        this.applyDamage(target, roll.damage, weapon.damageType, roll.soak);
        if (roll.damage > 0) this.pushLog('damage', `${target.name} takes ${roll.damage} ${weapon.damageType} damage.`, target.id, { amount: roll.damage, target: target.id });
        // issue 16: the ability's own effects[] beyond the base weapon hit — a 'damage' entry here is read as
        // BONUS damage on top of the weapon hit (Charge's lance impact), never a replacement for it.
        for (const effect of ability.effects) {
          if ('damage' in effect) {
            const bonusAttr = effect.damage.bonus === 'strength' ? modifier(attacker.attributes.strength) : effect.damage.bonus === 'agility' ? modifier(attacker.attributes.agility) : 0;
            const extra = rollDice(effect.damage.dice, this.host.rng) + bonusAttr;
            this.applyDamage(target, extra, effect.damage.type, 0);
            if (extra > 0) this.pushLog('damage', `${target.name} takes ${extra} additional ${effect.damage.type} damage.`, target.id, { amount: extra, target: target.id });
          } else {
            this.applyEffect(attacker, target, effect);
          }
        }
        if (ability.id === 'ability.charge') {
          attacker.chargeCells = 0; // spent the run-up (issue 2)
          this.tryMoraleTrigger(target, 'charge', 12); // ARCHITECTURE §5.3: a charge forces a morale check
        }
      }
    };

    // Round-3 critic issue 4: Shield Block now goes through the same reaction queue as Brace/Cover Fire for a
    // player-controlled defender — it was previously spending a human's reaction (and thus pre-empting a
    // Brace/OA that reaction could otherwise have bought) without ever asking. AI still auto-accepts inline
    // (there's no rational reason for the AI to ever decline pure damage reduction).
    if (roll.hit && roll.damage > 0 && target.shield && target.ap.reaction) {
      const resolveBlock = (accept: boolean) => {
        target.ap.reaction = false;
        if (accept) {
          const blocked = rollDice('1d6', this.host.rng);
          const before = roll.damage;
          roll.damage = Math.max(0, roll.damage - blocked);
          this.pushLog('reaction', `${target.name} blocks with the shield, reducing the blow by ${before - roll.damage}.`, target.id, { target: attacker.id });
        }
        finishAttack();
      };
      const autoResolve = this.forceAiAll || !target.isPlayerControlled;
      if (autoResolve) { resolveBlock(true); return; }
      this.reactionQueue.push({ unitId: target.id, ability: 'ability.shield-block', trigger: 'hit', targetId: attacker.id, resolve: resolveBlock });
      return;
    }
    finishAttack();
  }

  private resolveShove(attacker: Unit, target: Unit): void {
    // issue 6: range enforcement (issue 1) already refuses Shove past `ability.shove`'s range:1 via
    // targetAllowed(); this is a defensive re-check.
    if (cellDistance(attacker.q, attacker.r, target.q, target.r) > 1) return;
    const attRoll = this.host.rng.die(20) + modifier(attacker.attributes.strength);
    const defRoll = this.host.rng.die(20) + modifier(target.attributes.agility);
    const success = attRoll >= defRoll;
    this.pushLog('ability', `${attacker.name} shoves ${target.name}: ${success ? 'success' : 'resisted'}.`, attacker.id, { target: target.id });
    if (success) this.movePush(target, attacker, 1);
  }

  /** direction sign>0 pushes target away from source; sign<0 pulls target toward source. issue 6 / probe 5:
   *  a push along a single axis (dq or dr exactly 0) must stay on that axis — never force the zero axis to 1
   *  and go diagonal. */
  private movePush(target: Unit, source: Unit, sign: 1 | -1): void {
    if (!this.grid) return;
    let dq = Math.sign(target.q - source.q);
    let dr = Math.sign(target.r - source.r);
    if (dq === 0 && dr === 0) dq = 1; // same cell (shouldn't happen) — arbitrary axis rather than no-op
    const nq = target.q + dq * sign;
    const nr = target.r + dr * sign;
    if (!inBounds(nq, nr, this.grid.cols, this.grid.rows)) return;
    const destCell = this.cellAt(nq, nr);
    if (!destCell || !destCell.passable) return;
    const blocker = this.occupantAt(nq, nr, target.id);
    if (blocker) {
      // "into a comrade → both Prone on failure" (§5.3) — Sure Foot still protects its own bearer.
      if (!hasStatus(target, 'sure-footed')) addStatus(target, 'prone', 1);
      if (!hasStatus(blocker, 'sure-footed')) addStatus(blocker, 'prone', 1);
      this.pushLog('status', `${target.name} collides with ${blocker.name} — both stumble.`, target.id, { target: blocker.id });
      return;
    }
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

  /** issue 8: at most one morale check per unit per *reason* per round (`moraleCheckedThisRound` is cleared
   *  in `startRound`). Fixes probe10b's "8–10 damage checks in a single fight" spam that made every knight
   *  hit a coin-flip rout regardless of how tough the target actually was. */
  private tryMoraleTrigger(u: Unit, reason: string, dc: number): void {
    if (u.dead || u.down) return;
    let set = this.moraleCheckedThisRound.get(u.id);
    if (!set) { set = new Set(); this.moraleCheckedThisRound.set(u.id, set); }
    if (set.has(reason)) return;
    set.add(reason);
    this.rollMorale(u, dc, reason);
  }

  private checkMoraleTrigger(u: Unit, reason: 'damage' | 'ally-down' | 'flanked' | 'charge' | 'leader-down' | 'rockfall'): void {
    if (reason === 'damage' && u.hp > u.hpMax * 0.75) return;
    const dc = moraleDc(reason === 'rockfall' ? 3 : reason === 'ally-down' || reason === 'leader-down' ? 2 : 1);
    this.tryMoraleTrigger(u, reason, dc);
  }

  private rollMorale(u: Unit, dc: number, reason: string): void {
    if (u.dead || u.down) return;
    const result = moraleCheck({
      presenceMod: modifier(u.attributes.presence), leadershipLevel: u.leadershipLevel,
      formationBonus: u.formation.defenseBonus, moraleBonusPerk: u.perkMods['morale'] ?? 0, dc,
      // issue 5: War Cry grants Edge on the next morale check, same as standing in a Haufen.
      edge: u.formation.inHaufen || hasStatus(u, 'war-cry'),
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
  /** round-2 issue (a)(c): a forced morale check the AI can invoke directly (rate-limited the same as every
   *  other trigger — at most once per unit per reason per round) — replaces `knightAct`'s old "run to the
   *  furthest cell forever, never actually Rout" special case with the real morale-check pipeline, so a
   *  broken knight either rallies, gets Shaken, or is genuinely Routed (and then `doRoutedTurn` takes over). */
  forceMoraleCheck(u: Unit, dc: number, reason: string): void { this.tryMoraleTrigger(u, reason, dc); }
  /** round-2 issue 6: a move that triggers a reaction (Brace, OA, Cover Fire) against a `isPlayerControlled`
   *  defender queues it instead of auto-resolving inline (so a human gets asked) whenever `forceAiAll` is off
   *  — which happens for every side:'player' unit, including a standalone squad's own militia, any time an
   *  enemy AI's move+attack is decided outside a bulk `{type:'auto'}` command. Nothing previously stopped the
   *  mover's own follow-up attack (issued synchronously, in the same `decideAndAct` call) from firing before
   *  that queued reaction ever resolved — logging the attack ahead of the Brace it should have had to survive
   *  first. `ai.ts` checks this after every move and skips the follow-up attack while one is pending. */
  hasPendingReaction(): boolean { return this.reactionQueue.length > 0; }
  /** round-2 issue (c)/3: would pushing `target` away from `shover` land it on water or off a ≥3m ledge? Lets
   *  the AI decide to Shove opportunistically instead of never using the ability at all (round-1 issue 15). */
  shoveDestinationHazard(shover: Unit, target: Unit): boolean {
    if (!this.grid) return false;
    let dq = Math.sign(target.q - shover.q);
    let dr = Math.sign(target.r - shover.r);
    if (dq === 0 && dr === 0) return false;
    const nq = target.q + dq, nr = target.r + dr;
    if (!inBounds(nq, nr, this.grid.cols, this.grid.rows)) return false;
    const dest = this.cellAt(nq, nr);
    if (!dest || !dest.passable) return false;
    if (this.occupantAt(nq, nr, target.id)) return false;
    const startH = this.cellAt(target.q, target.r)?.height ?? 0;
    return dest.surface === 'water' || startH - dest.height >= 3;
  }

  aiMove(u: Unit, to: CellKey): void {
    const preview = this.previewMove(u.id, to);
    if (!preview) return;
    this.performMove(u, preview.path, preview.costM);
  }
  aiAbility(u: Unit, abilityId: string, target?: CellKey | EntityId): boolean {
    const ability = this.host.content.abilities.get(abilityId);
    if (!ability) return false;
    if (!this.targetAllowed(u, ability, target)) return false;
    const notMoved = u.ap.moveM === u.ap.moveMax;
    const cost = this.checkAndSpendCost(u, ability);
    if (!cost.ok) return false;
    this.executeAbility(u, ability, target, [], notMoved);
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
      // issue 11 / probe 8: the full CombatEventRecord (kind/unit/target/cell/roll/morale/data), not just its
      // rendered text — `SerializedCombat.log` is `unknown[]` precisely so combat can round-trip its own shape
      // through it without core depending on combat's types.
      log: this.log,
    };
  }

  /**
   * issue 11 / probe 8: restores full log fidelity (kinds, unit/target ids, roll/morale payloads). Note for
   * the save module: `restore()` returns `Promise<void>` (the `CombatService` interface, core-owned) — it does
   * NOT re-arm the `CombatResult` promise `start()` originally returned (that caller is long gone after a
   * save/load round-trip). To learn when a *restored* encounter ends, listen with `combat.on('end', cb)`
   * after calling `restore()`, rather than awaiting anything from `restore()` itself; `finish()` always still
   * emits `'end'` on the event bus regardless of how the encounter was started.
   */
  async restore(s: SerializedCombat): Promise<void> {
    if (!s) return;
    const enc = this.host.content.encounters.get(s.encounterId);
    if (!enc) throw new Error(`combat: restore: unknown encounter ${s.encounterId}`);
    this.resetState();
    this.enc = enc;
    const scriptedSpawnEnemyCount = (enc.scripted ?? []).reduce((n, e) => n + e.actions.reduce((m, a) => m + ('spawn' in a && a.spawn.side === 'enemy' ? (a.spawn.count ?? 1) : 0), 0), 0);
    this.totalEnemyEverCount = enc.units.filter((u) => u.side === 'enemy').reduce((n, u) => n + (u.count ?? 1), 0) + scriptedSpawnEnemyCount;
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
    // issue 11 / probe 8: `serialize()` now stores full CombatEventRecord objects — restore them as-is rather
    // than collapsing every entry to a bare {kind:'log', text}.
    this.log = (s.log as CombatEventRecord[]).map((l) => ({ ...l }));
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
