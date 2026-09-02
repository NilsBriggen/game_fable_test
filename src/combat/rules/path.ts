/**
 * A-star / Dijkstra pathfinding over the combat grid. Pure functions — ARCHITECTURE.md §5.3.
 * Difficult terrain doubles step cost; slope > 30° between cells costs +1 cell (≈ cellM); slope > 45° is
 * impassable. Occupied cells are impassable, except allied occupants, which are passable-through but never
 * a valid stopping cell.
 */
import type { CellKey, CellView } from '@core/services';
import type { Side } from '@core/schemas';
import { NEIGHBOR_OFFSETS, cellIndex, inBounds, slopeDeg } from './grid';

export interface PathGrid {
  cols: number;
  rows: number;
  cellM: number;
  cells: CellView[];
}

export interface Occupant {
  q: number;
  r: number;
  side: Side;
}

/** null = impassable between these two adjacent cells */
export function stepCost(a: CellView, b: CellView, diag: boolean, cellM: number): number | null {
  if (!b.passable) return null;
  const slope = slopeDeg(a, b, cellM, diag);
  if (slope > 45) return null;
  let cost = diag ? cellM * 1.4 : cellM;
  if (b.difficult) cost *= 2;
  if (slope > 30) cost += cellM;
  return cost;
}

function occupantAt(q: number, r: number, occ: Occupant[]): Occupant | undefined {
  return occ.find((o) => o.q === q && o.r === r);
}

/** Dijkstra from (startQ,startR) up to moveBudgetM. Returns cost-to-reach for every traversable node
 *  (including ally-occupied ones, which are needed to route past them) plus a `from` pointer for path
 *  reconstruction. The caller filters out non-stoppable cells (occupied, self) when building `reachable()`. */
export function dijkstra(
  startQ: number, startR: number, moveBudgetM: number, side: Side, grid: PathGrid, occupants: Occupant[],
): Map<string, { cost: number; from?: CellKey }> {
  const dist = new Map<string, { cost: number; from?: CellKey }>();
  const startKey = `${startQ},${startR}`;
  dist.set(startKey, { cost: 0 });
  // simple Dijkstra via a sorted frontier (grids here are small: ≤ 40x24)
  const frontier: { q: number; r: number; cost: number }[] = [{ q: startQ, r: startR, cost: 0 }];
  const visited = new Set<string>();
  while (frontier.length) {
    frontier.sort((a, b) => a.cost - b.cost);
    const cur = frontier.shift()!;
    const curKey = `${cur.q},${cur.r}`;
    if (visited.has(curKey)) continue;
    visited.add(curKey);
    const curCell = grid.cells[cellIndex(cur.q, cur.r, grid.cols)];
    if (!curCell) continue;
    for (const off of NEIGHBOR_OFFSETS) {
      const nq = cur.q + off.dq, nr = cur.r + off.dr;
      if (!inBounds(nq, nr, grid.cols, grid.rows)) continue;
      const nCell = grid.cells[cellIndex(nq, nr, grid.cols)];
      if (!nCell) continue;
      const occupant = occupantAt(nq, nr, occupants);
      if (occupant && occupant.side !== side) continue; // enemy-occupied: impassable
      const sc = stepCost(curCell, nCell, off.diag, grid.cellM);
      if (sc === null) continue;
      const newCost = cur.cost + sc;
      if (newCost > moveBudgetM + 1e-6) continue;
      const key = `${nq},${nr}`;
      const existing = dist.get(key);
      if (!existing || newCost < existing.cost - 1e-9) {
        dist.set(key, { cost: newCost, from: { q: cur.q, r: cur.r } });
        frontier.push({ q: nq, r: nr, cost: newCost });
      }
    }
  }
  return dist;
}

/** Cells the unit may legally end its move on: reachable, not the start cell, and not occupied. */
export function reachableCells(
  startQ: number, startR: number, moveBudgetM: number, side: Side, grid: PathGrid, occupants: Occupant[],
): CellKey[] {
  const dist = dijkstra(startQ, startR, moveBudgetM, side, grid, occupants);
  const out: CellKey[] = [];
  for (const [key, v] of dist) {
    if (v.cost === 0) continue;
    const [q, r] = key.split(',').map(Number);
    if (occupantAt(q, r, occupants)) continue;
    out.push({ q, r });
  }
  return out;
}

export function reconstructPath(dist: Map<string, { cost: number; from?: CellKey }>, toQ: number, toR: number): CellKey[] | null {
  const key = `${toQ},${toR}`;
  if (!dist.has(key)) return null;
  const path: CellKey[] = [];
  let cur: CellKey | undefined = { q: toQ, r: toR };
  while (cur) {
    path.unshift(cur);
    const entry = dist.get(`${cur.q},${cur.r}`);
    cur = entry?.from;
  }
  return path;
}

export function pathCost(dist: Map<string, { cost: number; from?: CellKey }>, toQ: number, toR: number): number | null {
  return dist.get(`${toQ},${toR}`)?.cost ?? null;
}
