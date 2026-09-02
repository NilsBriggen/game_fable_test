/**
 * Combat AI. ARCHITECTURE.md §5.3: utility scoring over {attack, move-to-attack, brace, reload, rally, flee}
 * with faction doctrines. Deterministic given the `combat` RNG; every decision is O(units × cells) at worst
 * on these small grids (≤ 40×24), comfortably under the 200 ms budget.
 */
import type { Rng } from '@core/rng';
import type { CellKey } from '@core/services';
import type { CombatEngineImpl } from './engine';
import type { Unit } from './types';
import { hasStatus, isPolearm } from './types';
import { cellDistance } from './rules/grid';

function dist(a: Unit, b: Unit): number { return cellDistance(a.q, a.r, b.q, b.r); }

function adjacentAllyCount(engine: CombatEngineImpl, u: Unit): number {
  return engine.unitList().filter((o) => o.id !== u.id && o.side === u.side && !o.dead && dist(o, u) <= 1).length;
}

/** True when `a` and `b` sit on opposite sides of `pivot` (flanking geometry, no reach check — the AI uses
 *  this only to score prospective cells before actually moving there). */
function onOppositeSides(a: CellKey, b: CellKey, pivot: CellKey): boolean {
  const dx1 = Math.sign(a.q - pivot.q), dz1 = Math.sign(a.r - pivot.r);
  const dx2 = Math.sign(b.q - pivot.q), dz2 = Math.sign(b.r - pivot.r);
  if ((dx1 === 0 && dz1 === 0) || (dx2 === 0 && dz2 === 0)) return false;
  return dx1 === -dx2 && dz1 === -dz2;
}

/** Nearest reachable-or-adjacent cell to `target` the mover could end on (naive greedy step toward target). */
function stepToward(engine: CombatEngineImpl, u: Unit, target: Unit, keepRange = 0): CellKey | null {
  const reach = engine.reachable(u.id);
  if (reach.length === 0) return null;
  let best: CellKey | null = null;
  let bestScore = Infinity;
  for (const c of reach) {
    const d = cellDistance(c.q, c.r, target.q, target.r);
    const score = Math.abs(d - keepRange);
    if (score < bestScore) { bestScore = score; best = c; }
  }
  return best;
}

function furthestFrom(engine: CombatEngineImpl, u: Unit, enemies: Unit[]): CellKey | null {
  const reach = engine.reachable(u.id);
  if (reach.length === 0) return null;
  let best: CellKey | null = null;
  let bestScore = -Infinity;
  for (const c of reach) {
    const score = Math.min(...enemies.map((e) => cellDistance(c.q, c.r, e.q, e.r)));
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best;
}

function tryAttack(engine: CombatEngineImpl, u: Unit, target: Unit): boolean {
  // Union of melee and ranged reach, mirroring engine.ts's `abilityRangeCells('ability.attack')` — a unit
  // carrying both a sidearm and a loaded ranged weapon (every crossbowman) can reach with either.
  const meleeReach = u.weapon?.reach ?? (u.ranged ? 0 : 1);
  const rangedReach = u.ranged ? (u.ranged.range?.long ?? u.ranged.reach ?? 0) : 0;
  const reach = Math.max(meleeReach, rangedReach, 1);
  const d = dist(u, target);
  if (d > reach) return false;
  // Prefer ranged (matching attackInputsFor's usingRanged gate) whenever the target is beyond melee reach.
  if (u.ranged && d > meleeReach && !u.loaded) return engine.aiAbility(u, 'ability.reload');
  return engine.aiAbility(u, 'ability.attack', target.id);
}

function moveThenAttack(engine: CombatEngineImpl, u: Unit, target: Unit): void {
  if (tryAttack(engine, u, target)) return;
  const cell = stepToward(engine, u, target, (u.weapon?.reach ?? u.ranged?.reach ?? 1) - 1);
  if (cell) engine.aiMove(u, cell);
  tryAttack(engine, u, target);
}

/** issue 2 / probe 4: a real run-up — among cells reachable THIS turn that are aligned with the mover's
 *  current position (a straight queen's-move line, so the pathfinder's shortest path to it actually IS that
 *  line) and end within weapon reach of `target`, pick the longest straight segment ≥ 3 cells. Returns null
 *  if no genuine charge lane exists this turn (the knight should fall back to a plain attack, not force a
 *  charge that can't legally resolve). */
function findChargeApproach(engine: CombatEngineImpl, u: Unit, target: Unit): CellKey | null {
  const reach = u.weapon?.reach ?? 1;
  let best: CellKey | null = null;
  let bestLen = 2; // must beat the 3-cell minimum
  for (const c of engine.reachable(u.id)) {
    if (cellDistance(c.q, c.r, target.q, target.r) > reach) continue;
    const dq = c.q - u.q, dr = c.r - u.r;
    const aligned = dq === 0 || dr === 0 || Math.abs(dq) === Math.abs(dr);
    if (!aligned) continue;
    const len = Math.max(Math.abs(dq), Math.abs(dr));
    if (len > bestLen) { bestLen = len; best = c; }
  }
  return best;
}

function knightAct(engine: CombatEngineImpl, u: Unit, enemies: Unit[], _rng: Rng): void {
  if (u.morale < 20) {
    const away = furthestFrom(engine, u, enemies);
    if (away) engine.aiMove(u, away);
    return;
  }
  // Prefer isolated, non-Haufen, non-polearm targets; avoid a Haufen front unless no other target exists.
  const nonHaufen = enemies.filter((e) => !e.formation.inHaufen);
  const pool = nonHaufen.length > 0 ? nonHaufen : enemies;
  const scored = pool
    .map((e) => ({ e, score: -(isPolearm(e.weapon) ? 3 : 0) - adjacentAllyCount(engine, e) - dist(u, e) * 0.1 }))
    .sort((a, b) => b.score - a.score);
  const target = scored[0]?.e;
  if (!target) return;
  const reach = u.weapon?.reach ?? 1;
  if (u.mounted && u.weapon && dist(u, target) > reach) {
    const approach = findChargeApproach(engine, u, target);
    if (approach) {
      engine.aiMove(u, approach);
      // `u.chargeCells` reflects the straight-line length the path actually achieved (may fall short of the
      // plan if terrain forced a detour) — only charge if the run-up genuinely landed.
      if (u.chargeCells >= 3 && dist(u, target) <= reach && u.ap.action) { engine.aiAbility(u, 'ability.charge', target.id); return; }
      tryAttack(engine, u, target);
      return;
    }
  }
  moveThenAttack(engine, u, target);
}

function footmanAct(engine: CombatEngineImpl, u: Unit, enemies: Unit[], _rng: Rng): void {
  const target = [...enemies].sort((a, b) => (a.hp / a.hpMax) - (b.hp / b.hpMax) || dist(u, a) - dist(u, b))[0];
  if (!target) return;
  if (tryAttack(engine, u, target)) return;
  // issue 15: prefer a cell that actually flanks the target (an ally already on the opposite side) over the
  // merely-nearest one, when both are reachable within melee reach.
  const reach = u.weapon?.reach ?? 1;
  const allies = engine.unitList().filter((o) => o.side === u.side && o.id !== u.id && !o.dead && !o.down);
  let best: CellKey | null = null;
  let bestScore = -Infinity;
  for (const c of engine.reachable(u.id)) {
    const d = cellDistance(c.q, c.r, target.q, target.r);
    if (d > reach) continue;
    const flanks = allies.some((a) => cellDistance(a.q, a.r, target.q, target.r) <= (a.weapon?.reach ?? 1) && onOppositeSides(c, { q: a.q, r: a.r }, target));
    const score = (flanks ? 5 : 0) - d;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  if (best) { engine.aiMove(u, best); tryAttack(engine, u, target); return; }
  moveThenAttack(engine, u, target);
}

function crossbowmanAct(engine: CombatEngineImpl, u: Unit, enemies: Unit[], _rng: Rng): void {
  if (!u.ranged) { footmanAct(engine, u, enemies, _rng); return; }
  if (!u.loaded) { engine.aiAbility(u, 'ability.reload'); return; }
  const nearest = [...enemies].sort((a, b) => dist(u, a) - dist(u, b))[0];
  if (!nearest) return;
  const short = u.ranged.range?.short ?? 6;
  const adjacentEnemy = enemies.some((e) => dist(u, e) <= 1);
  if (adjacentEnemy || dist(u, nearest) > short) {
    // issue 15: prefer high ground within range over the merely-closest in-range cell.
    let best: CellKey | null = null;
    let bestScore = -Infinity;
    for (const c of engine.reachable(u.id)) {
      const d = cellDistance(c.q, c.r, nearest.q, nearest.r);
      if (d > short || d < 1) continue;
      const height = engine.cellViewAt(c.q, c.r)?.height ?? 0;
      const score = height - d * 0.1;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    if (best) engine.aiMove(u, best);
    else if (adjacentEnemy) { const away = furthestFrom(engine, u, enemies); if (away) engine.aiMove(u, away); }
    else { const cell = stepToward(engine, u, nearest, short - 1); if (cell) engine.aiMove(u, cell); }
  }
  tryAttack(engine, u, nearest);
}

function waldstaetteAct(engine: CombatEngineImpl, u: Unit, enemies: Unit[], _rng: Rng): void {
  // Roll boulders if standing on a ready feature with a target in its line.
  const cell = engine.cellViewAt(u.q, u.r);
  if (cell?.feature === 'boulder-cache' || cell?.feature === 'trunk-cache') {
    const feature = engine.encounterDef()?.terrainFeatures?.[cell.featureIndex ?? -1];
    const hasTarget = feature?.affects?.some(([q, r]) => enemies.some((e) => e.q === q && e.r === r));
    if (hasTarget && u.ap.action) { engine.aiAbility(u, 'ability.roll-boulders'); return; }
  }
  // issue 2: Brace whenever a mounted threat is within charge range (2× this unit's speed), so the Haufen
  // isn't caught flat-footed the way probe10b's 24/24 samples showed (`braces=0` — the AI never used it).
  if (isPolearm(u.weapon) && u.stance !== 'braced' && u.ap.bonus) {
    const cellM = engine.gridInfo()?.cellM ?? 1.5;
    const cavalryNear = enemies.some((e) => e.mounted && cellDistance(u.q, u.r, e.q, e.r) * cellM <= 2 * u.speedMBase);
    if (cavalryNear) engine.aiAbility(u, 'ability.brace');
  }
  const target = [...enemies].sort((a, b) => dist(u, a) - dist(u, b))[0];
  if (!target) return;
  if (isPolearm(u.weapon)) {
    const inReach = dist(u, target) <= (u.weapon?.reach ?? 1);
    if (inReach) { tryAttack(engine, u, target); return; }
    // "Hold, rockfall, Haufen" doctrine: a Gewalthaufen wins by staying a block and making the column come to
    // it, not by chasing individual enemies into the open where it loses the formation bonus and gets picked
    // off piecemeal by mounted knights. Only sally out for a target already fairly close; otherwise hold the
    // line (bracing if a threat is on the way) and let the next attacker walk onto the halberds.
    const holdRange = 5;
    if (dist(u, target) > holdRange) {
      if (u.stance !== 'braced' && u.ap.bonus) engine.aiAbility(u, 'ability.brace');
      return;
    }
    // Move toward the target but prefer a cell that keeps/builds adjacency with allied polearms (Haufen).
    const reach = engine.reachable(u.id);
    const allies = engine.unitList().filter((o) => o.side === u.side && isPolearm(o.weapon) && o.id !== u.id && !o.dead);
    let best: CellKey | null = null; let bestScore = -Infinity;
    for (const c of reach) {
      const dEnemy = cellDistance(c.q, c.r, target.q, target.r);
      const adjAllies = allies.filter((a) => cellDistance(a.q, a.r, c.q, c.r) <= 1).length;
      const score = adjAllies * 2 - dEnemy * 0.5;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    if (best) engine.aiMove(u, best);
    tryAttack(engine, u, target);
    return;
  }
  moveThenAttack(engine, u, target);
}

function sergeantAct(engine: CombatEngineImpl, u: Unit, enemies: Unit[], rng: Rng): void {
  const needsRally = engine.unitList().some((o) => o.side === u.side && o.id !== u.id && !o.dead && (hasStatus(o, 'shaken') || o.routed) && dist(u, o) <= 3);
  if (needsRally && u.ap.action) { engine.aiAbility(u, 'ability.rally'); return; }
  footmanAct(engine, u, enemies, rng);
}

export function decideAndAct(engine: CombatEngineImpl, u: Unit, rng: Rng): void {
  if (u.dead || u.down) return;
  const enemies = engine.unitList().filter((o) => o.side !== u.side && !o.dead && !o.down);
  if (enemies.length === 0) return;
  switch (u.doctrine) {
    case 'knight': knightAct(engine, u, enemies, rng); break;
    case 'crossbowman': crossbowmanAct(engine, u, enemies, rng); break;
    case 'sergeant': sergeantAct(engine, u, enemies, rng); break;
    case 'waldstaette': waldstaetteAct(engine, u, enemies, rng); break;
    default: footmanAct(engine, u, enemies, rng); break;
  }
}
