/**
 * Gewalthaufen / Haufen formation. ARCHITECTURE.md §5.3 & §5.5 (mandated mechanic, not flavour):
 * +1 Defense per adjacent allied polearm unit (max +3); a convex block of ≥4 mutually adjacent polearm
 * units is a Haufen: immune to flanking, Edge on morale checks, and a cavalry Charge into a front unit
 * pulls the Brace reaction from every adjacent facing polearm unit.
 */
import type { EntityId } from '@core/ecs';
import type { Side } from '@core/schemas';
import type { FormationStatus } from '@core/services';
import { NEIGHBOR_OFFSETS, cellDistance } from './grid';

export interface FormationUnit {
  id: EntityId;
  q: number;
  r: number;
  side: Side;
  polearm: boolean;
  down: boolean;
}

function adjacent(a: FormationUnit, b: FormationUnit): boolean {
  return NEIGHBOR_OFFSETS.some((o) => a.q + o.dq === b.q && a.r + o.dr === b.r);
}

/** Connected component of mutually-adjacent, same-side, living polearm units containing `unit` (if any). */
function polearmComponent(unit: FormationUnit, all: FormationUnit[]): FormationUnit[] {
  if (!unit.polearm || unit.down) return [];
  const pool = all.filter((u) => u.side === unit.side && u.polearm && !u.down);
  const seen = new Set<EntityId>([unit.id]);
  const queue = [unit];
  const component: FormationUnit[] = [unit];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const cand of pool) {
      if (seen.has(cand.id)) continue;
      if (adjacent(cur, cand)) {
        seen.add(cand.id);
        component.push(cand);
        queue.push(cand);
      }
    }
  }
  return component;
}

/** Loose "convex block" test: the component fills at least half of its own bounding box — rejects a thin
 *  scattered chain while accepting a 2×2 (or similar blocky) formation. */
function isConvexish(component: FormationUnit[]): boolean {
  const qs = component.map((u) => u.q);
  const rs = component.map((u) => u.r);
  const w = Math.max(...qs) - Math.min(...qs) + 1;
  const h = Math.max(...rs) - Math.min(...rs) + 1;
  const area = w * h;
  return area > 0 && component.length / area >= 0.5;
}

let haufenIdCounter = 1;
const componentIdCache = new Map<string, number>();

export function formationBonus(unit: FormationUnit, all: FormationUnit[]): FormationStatus {
  if (unit.down) return { adjacentPolearms: 0, inHaufen: false, defenseBonus: 0 };
  const allies = all.filter((u) => u.side === unit.side && u.id !== unit.id && !u.down);
  const adjacentPolearms = allies.filter((a) => a.polearm && adjacent(unit, a)).length;
  const defenseBonus = Math.min(3, adjacentPolearms);
  let inHaufen = false;
  let haufenId: number | undefined;
  if (unit.polearm) {
    const component = polearmComponent(unit, all);
    if (component.length >= 4 && isConvexish(component)) {
      inHaufen = true;
      const key = component.map((u) => u.id).sort((a, b) => a - b).join(',');
      let id = componentIdCache.get(key);
      if (id === undefined) {
        id = haufenIdCounter++;
        componentIdCache.set(key, id);
      }
      haufenId = id;
    }
  }
  return { adjacentPolearms, inHaufen, defenseBonus, haufenId };
}

export interface ReachPoint { q: number; r: number; reach: number }

/** True when `attacker` and a second hostile unit sit on opposite sides of `target` (flanking geometry) AND
 *  both are within their own reach of the target — a unit seven cells away cannot flank anyone (issue 4). */
export function isFlanked(target: { q: number; r: number }, attacker: ReachPoint, otherHostiles: ReachPoint[]): boolean {
  if (cellDistance(attacker.q, attacker.r, target.q, target.r) > attacker.reach) return false;
  const dx1 = Math.sign(attacker.q - target.q);
  const dz1 = Math.sign(attacker.r - target.r);
  if (dx1 === 0 && dz1 === 0) return false;
  return otherHostiles.some((o) => {
    if (cellDistance(o.q, o.r, target.q, target.r) > o.reach) return false;
    const dx2 = Math.sign(o.q - target.q);
    const dz2 = Math.sign(o.r - target.r);
    if (dx2 === 0 && dz2 === 0) return false;
    return dx2 === -dx1 && dz2 === -dz1;
  });
}
