import { describe, it, expect } from 'vitest';
import { dijkstra, reachableCells } from '../../../../src/combat/rules/path';
import type { CellView } from '@core/services';

// Edge-input check named in the task: a mounted unit funneled into a 1-wide corridor with a `letzi-wall`
// segment (mounted-only impassable terrain, rules/path.ts:29) must not throw, and must correctly treat the
// wall as impassable to the mounted mover while leaving the rest of the (otherwise empty) corridor reachable.
function cell(q: number, r: number, over: Partial<CellView> = {}): CellView {
  return { q, r, height: 0, surface: 'grass', passable: true, cover: 0, difficult: false, ...over };
}

describe('edge input: mounted unit in a 1-wide corridor with a letzi-wall segment', () => {
  it('does not throw, and the wall blocks the mounted mover without blocking a dijkstra scan of the corridor', () => {
    // 1 x 5 corridor: (0,0)..(0,4), with a letzi-wall at (0,2).
    const cells: CellView[] = [];
    for (let r = 0; r < 5; r++) cells.push(cell(0, r, r === 2 ? { feature: 'letzi-wall' } : {}));
    const grid = { cols: 1, rows: 5, cellM: 1.5, cells };

    expect(() => dijkstra(0, 0, 20, 'player', grid, [], /* mounted */ true)).not.toThrow();
    const distMounted = dijkstra(0, 0, 20, 'player', grid, [], true);
    // Everything at/after the wall (r >= 2) must be unreached by the mounted mover.
    expect(distMounted.has('0,1')).toBe(true);
    expect(distMounted.has('0,2')).toBe(false);
    expect(distMounted.has('0,4')).toBe(false);

    // The same corridor for a foot mover: the wall is just ground (only mounted is blocked by it) — reaches
    // the far end.
    const reachFoot = reachableCells(0, 0, 20, 'player', grid, [], false);
    expect(reachFoot.some((c) => c.q === 0 && c.r === 4)).toBe(true);
  });
});
