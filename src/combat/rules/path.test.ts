import { describe, it, expect } from 'vitest';
import type { CellView } from '@core/services';
import { stepCost, dijkstra, reachableCells, reconstructPath, pathCost } from './path';

function flatGrid(cols: number, rows: number): CellView[] {
  const cells: CellView[] = [];
  for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) cells.push({ q, r, height: 0, surface: 'grass', passable: true, cover: 0, difficult: false });
  return cells;
}
function idx(q: number, r: number, cols: number): number { return r * cols + q; }

describe('stepCost', () => {
  it('orthogonal vs diagonal base costs', () => {
    const cells = flatGrid(3, 3);
    const a = cells[idx(0, 0, 3)];
    const b = cells[idx(1, 0, 3)];
    const c = cells[idx(1, 1, 3)];
    expect(stepCost(a, b, false, 1.5)).toBeCloseTo(1.5);
    expect(stepCost(a, c, true, 1.5)).toBeCloseTo(1.5 * 1.4);
  });

  it('difficult terrain doubles the step cost', () => {
    const cells = flatGrid(3, 3);
    cells[idx(1, 0, 3)].difficult = true;
    const a = cells[idx(0, 0, 3)];
    const b = cells[idx(1, 0, 3)];
    expect(stepCost(a, b, false, 1.5)).toBeCloseTo(3.0);
  });

  it('slope > 30 degrees adds +1 cell of cost', () => {
    const cells = flatGrid(3, 3);
    cells[idx(1, 0, 3)].height = 1.0; // atan2(1.0,1.5) ≈ 33.7°
    const a = cells[idx(0, 0, 3)];
    const b = cells[idx(1, 0, 3)];
    expect(stepCost(a, b, false, 1.5)).toBeCloseTo(1.5 + 1.5);
  });

  it('slope > 45 degrees is impassable', () => {
    const cells = flatGrid(3, 3);
    cells[idx(1, 0, 3)].height = 2.0; // atan2(2.0,1.5) ≈ 53.1°
    const a = cells[idx(0, 0, 3)];
    const b = cells[idx(1, 0, 3)];
    expect(stepCost(a, b, false, 1.5)).toBeNull();
  });
});

describe('dijkstra / reachableCells', () => {
  it('finds the reachable set within a movement budget on flat ground', () => {
    const cells = flatGrid(5, 5);
    const reach = reachableCells(2, 2, 3.0, 'player', { cols: 5, rows: 5, cellM: 1.5, cells }, []);
    // 3.0m / 1.5m per orthogonal step = 2 cells in a straight line
    expect(reach.some((c) => c.q === 2 && c.r === 0)).toBe(true); // 2 cells north
    expect(reach.some((c) => c.q === 2 && c.r === 5)).toBe(false); // off-grid
  });

  it('enemy-occupied cells are impassable; allied-occupied cells are passable-through but not stoppable', () => {
    const cells = flatGrid(5, 5);
    const grid = { cols: 5, rows: 5, cellM: 1.5, cells };
    const withEnemy = reachableCells(0, 0, 6, 'player', grid, [{ q: 1, r: 0, side: 'enemy' }]);
    expect(withEnemy.some((c) => c.q === 1 && c.r === 0)).toBe(false); // the enemy's own cell is impassable
    const dist = dijkstra(0, 0, 6, 'player', grid, [{ q: 1, r: 0, side: 'enemy' }]);
    // straight through would cost 3.0m (2 orthogonal steps); blocked, it must detour and cost more
    expect(pathCost(dist, 2, 0)!).toBeGreaterThan(3.0);

    const withAlly = reachableCells(0, 0, 6, 'player', grid, [{ q: 1, r: 0, side: 'player' }]);
    expect(withAlly.some((c) => c.q === 1 && c.r === 0)).toBe(false); // occupied: not a valid stop
    expect(withAlly.some((c) => c.q === 2 && c.r === 0)).toBe(true); // but passable-through to beyond
  });

  it('reconstructs a path and matches pathCost', () => {
    const cells = flatGrid(5, 5);
    const grid = { cols: 5, rows: 5, cellM: 1.5, cells };
    const dist = dijkstra(0, 0, 10, 'player', grid, []);
    const path = reconstructPath(dist, 3, 0);
    expect(path).not.toBeNull();
    expect(path![0]).toEqual({ q: 0, r: 0 });
    expect(path![path!.length - 1]).toEqual({ q: 3, r: 0 });
    expect(pathCost(dist, 3, 0)).toBeCloseTo(4.5);
  });
});
