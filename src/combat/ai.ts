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
  const weapon = u.weapon ?? u.ranged;
  const reach = weapon ? (weapon.range?.long ?? weapon.reach) : 1; // unarmed fallback (see attackInputsFor)
  if (dist(u, target) > reach) return false;
  if (u.ranged && !u.weapon && !u.loaded) return engine.aiAbility(u, 'ability.reload');
  return engine.aiAbility(u, 'ability.attack', target.id);
}

function moveThenAttack(engine: CombatEngineImpl, u: Unit, target: Unit): void {
  if (tryAttack(engine, u, target)) return;
  const cell = stepToward(engine, u, target, (u.weapon?.reach ?? u.ranged?.reach ?? 1) - 1);
  if (cell) engine.aiMove(u, cell);
  tryAttack(engine, u, target);
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
  const canCharge = u.mounted && dist(u, target) <= (u.weapon?.reach ?? 1) + 3;
  if (canCharge) {
    const dq = Math.sign(target.q - u.q) || 1, dr = Math.sign(target.r - u.r);
    const approach = { q: target.q - dq * (u.weapon?.reach ?? 1), r: target.r - dr * (u.weapon?.reach ?? 1) };
    const cell = stepToward(engine, u, { ...target, q: approach.q, r: approach.r } as Unit, 0) ?? approach;
    engine.aiMove(u, cell);
    if (dist(u, target) <= (u.weapon?.reach ?? 1)) engine.aiAbility(u, 'ability.charge', target.id);
    return;
  }
  moveThenAttack(engine, u, target);
}

function footmanAct(engine: CombatEngineImpl, u: Unit, enemies: Unit[], _rng: Rng): void {
  const target = [...enemies].sort((a, b) => (a.hp / a.hpMax) - (b.hp / b.hpMax) || dist(u, a) - dist(u, b))[0];
  if (!target) return;
  moveThenAttack(engine, u, target);
}

function crossbowmanAct(engine: CombatEngineImpl, u: Unit, enemies: Unit[], _rng: Rng): void {
  if (!u.ranged) { footmanAct(engine, u, enemies, _rng); return; }
  if (!u.loaded) { engine.aiAbility(u, 'ability.reload'); return; }
  const nearest = [...enemies].sort((a, b) => dist(u, a) - dist(u, b))[0];
  if (!nearest) return;
  const short = u.ranged.range?.short ?? 6;
  const adjacentEnemy = enemies.some((e) => dist(u, e) <= 1);
  if (adjacentEnemy) {
    const away = furthestFrom(engine, u, enemies);
    if (away) engine.aiMove(u, away);
  }
  if (dist(u, nearest) <= short) { tryAttack(engine, u, nearest); return; }
  const cell = stepToward(engine, u, nearest, short - 1);
  if (cell) engine.aiMove(u, cell);
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
  const target = [...enemies].sort((a, b) => dist(u, a) - dist(u, b))[0];
  if (!target) return;
  if (isPolearm(u.weapon)) {
    const inReach = dist(u, target) <= (u.weapon?.reach ?? 1);
    if (inReach) { tryAttack(engine, u, target); return; }
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
