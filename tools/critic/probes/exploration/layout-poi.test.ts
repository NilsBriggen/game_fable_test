/**
 * Critic probe — layout.ts (pure) and PoiSystem with the real POI content.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { World } from '@core/ecs';
import { ContentRegistry } from '@core/content';
import { ServiceRegistry } from '@core/services';
import { EventBus } from '@core/events';
import type { ExplorationEvents } from '@core/services';
import { register as registerGeography } from '@content/geography';
import { register as registerPois, pois } from '@content/pois';
import { PLACES, LAKES } from '@content/gazetteer';
import { generateLayout } from '../../../../src/exploration/layout';
import { buildColliders } from '../../../../src/exploration/colliders';
import { PoiSystem } from '../../../../src/exploration/poi';

const flat = { heightAt: () => 0, isWater: () => false };

describe('generateLayout', () => {
  it('village of population 12 → ≥ 6 houses, none within 2 m of another, none on water, all inside the discover radius', () => {
    const out = generateLayout({ id: 'poi.probe-village', kind: 'village', x: 1000, z: 1000, population: { peasant: 8, herder: 2, elder: 1, innkeeper: 1 } }, flat);
    const houses = out.filter((m) => m.modelId === 'house.blockbau');
    let minD = Infinity;
    for (let i = 0; i < houses.length; i++) for (let j = i + 1; j < houses.length; j++) minD = Math.min(minD, Math.hypot(houses[i].x - houses[j].x, houses[i].z - houses[j].z));
    const maxR = Math.max(...out.map((m) => Math.hypot(m.x - 1000, m.z - 1000)));
    console.log(`village pop 12: ${houses.length} houses, ${out.length} models, min house spacing ${minD.toFixed(1)} m, max radius ${maxR.toFixed(1)} m; kinds: ${[...new Set(out.map((m) => m.modelId))].join(', ')}`);
    expect(houses.length).toBeGreaterThanOrEqual(6);
    expect(minD).toBeGreaterThanOrEqual(2);
    expect(out.some((m) => m.modelId === 'church' || m.modelId === 'chapel')).toBe(true);
    expect(out.some((m) => m.modelId === 'well')).toBe(true);
  });

  it('house footprints (collider radius 4.2) — do any two houses overlap each other?', () => {
    const out = generateLayout({ id: 'poi.altdorf', kind: 'village', x: 0, z: 0, population: { peasant: 6, 'woman-peasant': 3, elder: 2, merchant: 1, innkeeper: 1, child: 2, 'militia-spear': 2, 'bailiff-guard': 2 } }, flat);
    const cols = buildColliders(out);
    let overlaps = 0;
    for (let i = 0; i < cols.length; i++) for (let j = i + 1; j < cols.length; j++) if (Math.hypot(cols[i].x - cols[j].x, cols[i].z - cols[j].z) < cols[i].radius + cols[j].radius) overlaps++;
    console.log(`Altdorf-sized village: ${cols.length} solid colliders, ${overlaps} overlapping pairs (interpenetrating buildings)`);
  });

  it('slope gate: a uniform 45° slope (dy 3.0 m per 3 m) is accepted as a building pad although the player cannot walk > 40°', () => {
    const slope45 = { heightAt: (x: number) => x * 1.0, isWater: () => false }; // 45°
    const slope49 = { heightAt: (x: number) => x * 1.2, isWater: () => false }; // 50°
    const a = generateLayout({ id: 'poi.probe-a', kind: 'village', x: 0, z: 0, population: { peasant: 8 } }, slope45);
    const b = generateLayout({ id: 'poi.probe-b', kind: 'village', x: 0, z: 0, population: { peasant: 8 } }, slope49);
    console.log(`houses placed on a 45° slope: ${a.filter((m) => m.modelId === 'house.blockbau').length}; on a 50° slope: ${b.filter((m) => m.modelId === 'house.blockbau').length}`);
    expect(a.filter((m) => m.modelId === 'house.blockbau').length).toBeGreaterThan(0); // documents the too-lenient MAX_SLOPE_DY
  });

  it('no boat/quay of a real port sits inside a gazetteer lake polygon *unless* it is the water-layer boat', () => {
    function pip(x: number, z: number, poly: [number, number][]): boolean {
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside; }
      return inside;
    }
    const probe = { heightAt: () => 0, isWater: (x: number, z: number) => LAKES.some((l) => pip(x, z, l.poly)) };
    let wetBuildings = 0, totalModels = 0, settlements = 0;
    for (const p of pois) {
      if (!['village', 'town', 'port', 'castle', 'monastery', 'alp'].includes(p.kind)) continue;
      settlements++;
      const out = generateLayout({ id: p.id, kind: p.kind, x: p.x, z: p.z, population: p.population }, probe);
      totalModels += out.length;
      for (const m of out) if (m.modelId !== 'boat' && probe.isWater(m.x, m.z)) wetBuildings++;
    }
    console.log(`${settlements} settlement layouts, ${totalModels} models, ${wetBuildings} non-boat models on gazetteer water`);
    expect(wetBuildings).toBe(0);
  });
});

describe('PoiSystem with real content', () => {
  function sys() {
    const c = new ContentRegistry();
    registerGeography(c); registerPois(c);
    const world = new World();
    const bus = new EventBus<ExplorationEvents>();
    const services = new ServiceRegistry();
    const s = new PoiSystem(world, c, services, bus);
    s.spawnPoiEntities();
    return { s, bus, c };
  }

  it('walking through the Rütli fires poi-discovered exactly once, and nearestPoi at the Rütli is the Rütli', () => {
    const { s, bus } = sys();
    const spy = vi.fn();
    bus.on('poi-discovered', spy);
    const r = PLACES.ruetli;
    for (let i = 0; i < 50; i++) s.update({ x: r.x - 150 + i * 6, y: 0, z: r.z });
    const calls = spy.mock.calls.map((c) => c[0]);
    console.log('discoveries while crossing the Rütli:', calls);
    expect(calls.filter((id) => id === 'poi.ruetli').length).toBe(1);
    expect(s.nearestPoi(r.x, r.z)!.id).toBe('poi.ruetli');
    expect(s.nearestPoi(PLACES.altdorf.x + 5, PLACES.altdorf.z - 5)!.id).toBe('poi.altdorf');
  });

  it('discover radii: how many POIs overlap another POI\'s discover disc (double toasts on arrival)', () => {
    let overl: string[] = [];
    for (const a of pois) for (const b of pois) if (a.id < b.id && Math.hypot(a.x - b.x, a.z - b.z) < a.discoverRadius + b.discoverRadius) overl.push(`${a.id}~${b.id}`);
    console.log(`overlapping discover discs: ${overl.length} → ${overl.slice(0, 12).join(', ')}${overl.length > 12 ? ' …' : ''}`);
  });

  it('fastTravel gate: ExplorationServiceImpl.fastTravel has no isDiscovered / def.fastTravel check (source probe)', () => {
    const src = readFileSync(new URL('../../../../src/exploration/index.ts', import.meta.url), 'utf8');
    const start = src.indexOf('async fastTravel(');
    const body = src.slice(start, src.indexOf('\n  }\n', start));
    const gated = /isDiscovered|discovered|fastTravel\b.*def|poiDef\(/.test(body);
    console.log('fastTravel body:\n' + body);
    console.log('gated on discovery or PoiDef.fastTravel:', gated);
    expect(gated).toBe(false); // documents the missing gate
  });
});

describe('PoiSystem — discovered state across a repeat populate (chapter change)', () => {
  it('spawnPoiEntities() after a discovery: is the discovery kept?', () => {
    const c = new ContentRegistry();
    registerGeography(c); registerPois(c);
    const world = new World();
    const s = new PoiSystem(world, c, new ServiceRegistry(), new EventBus<ExplorationEvents>());
    s.spawnPoiEntities();
    s.discover('poi.ruetli');
    expect(s.isDiscovered('poi.ruetli')).toBe(true);
    s.spawnPoiEntities(); // what ExplorationServiceImpl.populate() does on every chapter change
    console.log('poi.ruetli still discovered after a repeat populate():', s.isDiscovered('poi.ruetli'));
    expect(s.isDiscovered('poi.ruetli')).toBe(false); // documents the wipe
  });
});
