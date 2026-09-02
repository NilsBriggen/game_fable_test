/**
 * Critic probe — settlement siting against the REAL height/surface grid (`buildHeightGrid(1291, 2048, 2176)`,
 * the same one the terrain worker builds; sampling copied from `TerrainManager`). Answers: which POIs sit in
 * water, how many layout models each settlement actually gets after the dry/gentle-spot filter, how steep the
 * pads are, and whether named-NPC spawn points land in water.
 */
import { describe, it, expect } from 'vitest';
import { buildHeightGrid, DEFAULT_GRID_W, DEFAULT_GRID_H, surfaceNameOf } from '../../../../src/world/heightmodel';
import { MAP_BOUNDS } from '@content/gazetteer';
import { pois } from '@content/pois';
import { npcs } from '@content/npcs';
import { generateLayout } from '../../../../src/exploration/layout';
import { buildColliders } from '../../../../src/exploration/colliders';

const grid = buildHeightGrid(1291, DEFAULT_GRID_W, DEFAULT_GRID_H);
const sx = (MAP_BOUNDS.maxX - MAP_BOUNDS.minX) / (DEFAULT_GRID_W - 1);
const sz = (MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ) / (DEFAULT_GRID_H - 1);
function heightAt(x: number, z: number): number {
  const gx = (x - MAP_BOUNDS.minX) / sx, gz = (z - MAP_BOUNDS.minZ) / sz;
  const w = grid.width, h = grid.height;
  const x0 = Math.max(0, Math.min(w - 2, Math.floor(gx))), z0 = Math.max(0, Math.min(h - 2, Math.floor(gz)));
  const tx = Math.max(0, Math.min(1, gx - x0)), tz = Math.max(0, Math.min(1, gz - z0));
  const H = grid.heights, r0 = z0 * w, r1 = (z0 + 1) * w;
  const a = H[r0 + x0] + (H[r0 + x0 + 1] - H[r0 + x0]) * tx;
  const b = H[r1 + x0] + (H[r1 + x0 + 1] - H[r1 + x0]) * tx;
  return a + (b - a) * tz;
}
function surfaceAt(x: number, z: number): string {
  const gx = Math.round((x - MAP_BOUNDS.minX) / sx), gz = Math.round((z - MAP_BOUNDS.minZ) / sz);
  const cx = Math.max(0, Math.min(grid.width - 1, gx)), cz = Math.max(0, Math.min(grid.height - 1, gz));
  return surfaceNameOf(grid.surface[cz * grid.width + cx]);
}
const isWater = (x: number, z: number) => surfaceAt(x, z) === 'water';
function slopeDeg(x: number, z: number): number {
  const eps = Math.max(sx, sz);
  const dhdx = (heightAt(x + eps, z) - heightAt(x - eps, z)) / (2 * eps);
  const dhdz = (heightAt(x, z + eps) - heightAt(x, z - eps)) / (2 * eps);
  return (Math.atan(Math.hypot(dhdx, dhdz)) * 180) / Math.PI;
}
const probe = { heightAt, isWater };
const SETTLEMENT = new Set(['village', 'town', 'castle', 'monastery', 'alp', 'pass', 'bridge', 'port', 'camp', 'wall', 'ruin', 'mill', 'hut', 'cross', 'church', 'chapel']);

describe('POI siting on the real terrain (seed 1291)', () => {
  it('POI centres: water / surface / slope', () => {
    const wet: string[] = [], steep: string[] = [];
    for (const p of pois) {
      const w = isWater(p.x, p.z), s = slopeDeg(p.x, p.z);
      if (w) wet.push(`${p.id}(${p.kind})`);
      if (s > 30 && SETTLEMENT.has(p.kind)) steep.push(`${p.id}(${p.kind}) ${s.toFixed(0)}°`);
    }
    console.log(`POI centres in water (${wet.length}): ${wet.join(', ') || 'none'}`);
    console.log(`settlement POI centres steeper than 30° (${steep.length}): ${steep.join(', ') || 'none'}`);
  });

  it('layout yield per settlement: models requested vs placed after the dry/gentle filter; empty settlements listed', () => {
    const flat = { heightAt: () => 0, isWater: () => false };
    const rows: string[] = []; const empty: string[] = []; let totalPlaced = 0, totalReq = 0, overlapsTotal = 0, steepPads = 0, padCount = 0;
    for (const p of pois) {
      if (!SETTLEMENT.has(p.kind)) continue;
      const req = generateLayout({ id: p.id, kind: p.kind, x: p.x, z: p.z, population: p.population }, flat).length;
      const out = generateLayout({ id: p.id, kind: p.kind, x: p.x, z: p.z, population: p.population }, probe);
      totalReq += req; totalPlaced += out.length;
      const houses = out.filter((m) => /house|church|chapel|castle|monastery|mill/.test(m.modelId));
      for (const m of houses) { padCount++; if (slopeDeg(m.x, m.z) > 40) steepPads++; }
      const cols = buildColliders(out);
      let ov = 0;
      for (let i = 0; i < cols.length; i++) for (let j = i + 1; j < cols.length; j++) if (Math.hypot(cols[i].x - cols[j].x, cols[i].z - cols[j].z) < cols[i].radius + cols[j].radius) ov++;
      overlapsTotal += ov;
      if (out.filter((m) => m.modelId !== 'boat').length === 0) empty.push(`${p.id}(${p.kind})`);
      if (['village', 'town', 'port', 'castle', 'monastery'].includes(p.kind) && (out.length < req || ov > 0)) rows.push(`${p.id.padEnd(22)} ${p.kind.padEnd(9)} placed ${String(out.length).padStart(2)}/${String(req).padStart(2)} buildings ${houses.length} overlaps ${ov} slope@centre ${slopeDeg(p.x, p.z).toFixed(0)}°`);
    }
    console.log(rows.join('\n'));
    console.log(`TOTAL placed ${totalPlaced}/${totalReq}; settlements with NO built layout: ${empty.length} → ${empty.join(', ') || 'none'}`);
    console.log(`building pads on > 40° ground (unreachable on foot): ${steepPads}/${padCount}; overlapping building pairs across the map: ${overlapsTotal}`);
  });

  it('named-NPC spawn points (home + ≤ 6 m jitter) and the Altdorf gallows pole are on dry land', () => {
    const wetNpcs: string[] = [];
    const byId = new Map(pois.map((p) => [p.id, p]));
    for (const n of npcs) {
      const h = byId.get(n.home);
      if (!h) continue;
      // jitter ≤ 6 m: test the centre and 6 m in the 4 axis directions
      const pts = [[0, 0], [6, 0], [-6, 0], [0, 6], [0, -6]];
      if (pts.some(([dx, dz]) => isWater(h.x + dx, h.z + dz))) wetNpcs.push(`${n.id}@${n.home}`);
    }
    console.log(`named NPCs whose home spawn disc touches water (${wetNpcs.length}): ${wetNpcs.join(', ') || 'none'}`);
    const a = byId.get('poi.altdorf')!;
    console.log(`gallows pole spot (${a.x + 12}, ${a.z - 6}): surface=${surfaceAt(a.x + 12, a.z - 6)} slope=${slopeDeg(a.x + 12, a.z - 6).toFixed(1)}°`);
    console.log(`Rütli (${byId.get('poi.ruetli')!.x}, ${byId.get('poi.ruetli')!.z}): surface=${surfaceAt(byId.get('poi.ruetli')!.x, byId.get('poi.ruetli')!.z)} h=${heightAt(byId.get('poi.ruetli')!.x, byId.get('poi.ruetli')!.z).toFixed(1)} slope=${slopeDeg(byId.get('poi.ruetli')!.x, byId.get('poi.ruetli')!.z).toFixed(0)}°`);
    for (const id of ['poi.wegkreuz-axenweg', 'poi.klausnerzelle', 'poi.fischerhuetten-gersau', 'poi.aegerisee-shore', 'poi.steinbruch-axen']) {
      const p = byId.get(id)!;
      console.log(`${id}: surface=${surfaceAt(p.x, p.z)} h=${heightAt(p.x, p.z).toFixed(1)} slope=${slopeDeg(p.x, p.z).toFixed(0)}°`);
    }
    expect(wetNpcs.length).toBeLessThan(100);
  });

  it('Zug / Luzern / Küssnacht pile-up: buildings pulled onto each other by findDrySpot', () => {
    const byId = new Map(pois.map((p) => [p.id, p]));
    for (const id of ['poi.zug', 'poi.luzern', 'poi.kuessnacht', 'poi.altdorf']) {
      const p = byId.get(id)!;
      const out = generateLayout({ id: p.id, kind: p.kind, x: p.x, z: p.z, population: p.population }, probe).filter((m) => /house|church|chapel|castle/.test(m.modelId));
      let nn3 = 0, maxR = 0; const centre = { x: p.x, z: p.z };
      for (let i = 0; i < out.length; i++) {
        let nn = Infinity;
        for (let j = 0; j < out.length; j++) if (i !== j) nn = Math.min(nn, Math.hypot(out[i].x - out[j].x, out[i].z - out[j].z));
        if (nn < 3) nn3++;
        maxR = Math.max(maxR, Math.hypot(out[i].x - centre.x, out[i].z - centre.z));
      }
      const wetRing = [0, 45, 90, 135, 180, 225, 270, 315].filter((deg) => isWater(p.x + 60 * Math.sin((deg * Math.PI) / 180), p.z + 60 * Math.cos((deg * Math.PI) / 180))).length;
      console.log(`${id.padEnd(16)} ${out.length} buildings; ${nn3} have a neighbour < 3 m away (stacked); footprint radius ${maxR.toFixed(0)} m; water at 60 m in ${wetRing}/8 directions`);
    }
  });

  it('scenario spawn points: schwyz / sarnen / morgarten / teufelsbruecke / altdorf / ruetli — surface and slope where the player is dropped', () => {
    const byId = new Map(pois.map((p) => [p.id, p]));
    for (const id of ['poi.schwyz', 'poi.sarnen', 'poi.morgarten', 'poi.teufelsbruecke', 'poi.altdorf', 'poi.ruetli']) {
      const p = byId.get(id)!;
      console.log(`${id.padEnd(20)} surface=${surfaceAt(p.x, p.z).padEnd(10)} h=${heightAt(p.x, p.z).toFixed(1).padStart(6)} slope=${slopeDeg(p.x, p.z).toFixed(0)}°`);
    }
  });
});

describe('round 2 — Zug / Küssnacht composition on the real grid', () => {
  it('model counts per settlement after dry-land sizing', () => {
    const byId = new Map(pois.map((p) => [p.id, p]));
    for (const id of ['poi.zug', 'poi.kuessnacht', 'poi.luzern', 'poi.treib', 'poi.steinbruch-axen']) {
      const p = byId.get(id)!;
      const out = generateLayout({ id: p.id, kind: p.kind, x: p.x, z: p.z, population: p.population }, probe);
      const counts: Record<string, number> = {};
      for (const m of out) counts[m.modelId] = (counts[m.modelId] ?? 0) + 1;
      console.log(`${id}: ${JSON.stringify(counts)}`);
    }
  });
});
