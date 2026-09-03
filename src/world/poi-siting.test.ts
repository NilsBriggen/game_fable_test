/** Every POI must stand on land on the real height grid (critic wave2-exploration issue 1). */
import { describe, it, expect } from 'vitest';
import { buildHeightGrid, DEFAULT_GRID_W, DEFAULT_GRID_H, surfaceNameOf } from './heightmodel';
import { MAP_BOUNDS } from '@content/gazetteer';
import { pois } from '@content/pois';

const grid = buildHeightGrid(1291, DEFAULT_GRID_W, DEFAULT_GRID_H);
const sx = (MAP_BOUNDS.maxX - MAP_BOUNDS.minX) / (DEFAULT_GRID_W - 1);
const sz = (MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ) / (DEFAULT_GRID_H - 1);
function heightAt(x: number, z: number): number {
  const gx = (x - MAP_BOUNDS.minX) / sx, gz = (z - MAP_BOUNDS.minZ) / sz;
  const x0 = Math.max(0, Math.min(grid.width - 2, Math.floor(gx))), z0 = Math.max(0, Math.min(grid.height - 2, Math.floor(gz)));
  const tx = gx - x0, tz = gz - z0, h = grid.heights, w = grid.width;
  const a = h[z0 * w + x0] * (1 - tx) + h[z0 * w + x0 + 1] * tx;
  const b = h[(z0 + 1) * w + x0] * (1 - tx) + h[(z0 + 1) * w + x0 + 1] * tx;
  return a * (1 - tz) + b * tz;
}
function slopeDeg(x: number, z: number): number {
  const e = 8;
  return (Math.atan(Math.hypot((heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e), (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e))) * 180) / Math.PI;
}
function surfaceAt(x: number, z: number): string {
  const gx = Math.round((x - MAP_BOUNDS.minX) / sx), gz = Math.round((z - MAP_BOUNDS.minZ) / sz);
  const cx = Math.max(0, Math.min(grid.width - 1, gx)), cz = Math.max(0, Math.min(grid.height - 1, gz));
  return surfaceNameOf(grid.surface[cz * grid.width + cx]);
}

describe('POI siting on the real terrain (seed 1291)', () => {
  it('no POI centre is in water except ports and landmarks', () => {
    const wet = pois.filter((p) => p.kind !== 'port' && p.kind !== 'landmark' && surfaceAt(p.x, p.z) === 'water').map((p) => p.id);
    expect(wet).toEqual([]);
  });
  it('no settlement-shaped POI centre is steeper than 30°', () => {
    const steep = pois.filter((p) => !['landmark', 'viewpoint', 'battlefield', 'pass', 'port'].includes(p.kind) && slopeDeg(p.x, p.z) > 30).map((p) => `${p.id} ${slopeDeg(p.x, p.z).toFixed(0)}°`);
    expect(steep).toEqual([]);
  });
  it('the three relocated invented POIs are on land', () => {
    for (const id of ['poi.wegkreuz-axenweg', 'poi.klausnerzelle', 'poi.fischerhuetten-gersau']) {
      const p = pois.find((q) => q.id === id)!;
      expect(surfaceAt(p.x, p.z), id).not.toBe('water');
    }
  });
});
