/**
 * Critic probe — NpcSystem against the real content, with a mocked PartyService/WorldService (no GPU).
 * Covers: populate(chapter) honours `chapters`; despawn on chapter change; whether populate()/clear()
 * also destroys party companions; frozen re-entry vs. stepping (analytic == simulated after 6 h);
 * NPCs never walk into water; the dlg.generic.<archetype> fallback ids vs what generic.ts defines;
 * the 300 m freeze; mesh child count on the dynamic root across freeze/clear (leak check).
 */
import { describe, it, expect, vi } from 'vitest';
import { Object3D } from 'three';
import { World } from '@core/ecs';
import { ContentRegistry } from '@core/content';
import { Transform, Renderable, Npc, PartyMember, MeshRef, Interactable, Character, Faction } from '@core/components';
import type { NpcDef } from '@core/schemas';
import type { PartyService, WorldService } from '@core/services';
import { register as registerGeography } from '@content/geography';
import { register as registerSkills } from '@content/skills';
import { register as registerItems } from '@content/items';
import { register as registerArchetypes } from '@content/archetypes';
import { register as registerPois } from '@content/pois';
import { register as registerNpcs, npcs } from '@content/npcs';
import { register as registerGeneric } from '@content/dialogues/generic';
import { NpcSystem, NPC_SIM_RADIUS } from '../../../../src/exploration/npc';
import { analyticPosition } from '../../../../src/exploration/schedule';

function content(): ContentRegistry {
  const c = new ContentRegistry();
  registerGeography(c); registerSkills(c); registerItems(c); registerArchetypes(c); registerPois(c); registerNpcs(c);
  try { registerGeneric(c); } catch { /* fine */ }
  return c;
}

function makeSystem(opts: { water?: (x: number, z: number) => boolean } = {}) {
  const world = new World();
  const c = content();
  const party: PartyService = {
    createCharacter(def: NpcDef) {
      const id = world.create(def.id);
      world.add(id, Character, {});
      world.add(id, Faction, { factionId: def.faction });
      world.add(id, Transform, { x: 0, y: 0, z: 0, yaw: 0 });
      world.add(id, Renderable, { modelId: def.modelId ?? `char.${def.archetype}`, visible: true });
      world.add(id, Npc, { defId: def.id, home: def.home, schedule: def.schedule ?? [], frozen: true, generic: def.role === 'generic' });
      return id;
    },
  } as unknown as PartyService;
  const ws = {
    heightAt: () => 0,
    isWater: opts.water ?? (() => false),
    hasModel: () => true,
    spawnModel: () => new Object3D(),
  } as unknown as WorldService;
  const dyn = new Object3D();
  const startEncounter = vi.fn();
  const sys = new NpcSystem(world, c, party, ws, dyn, startEncounter);
  return { world, c, sys, dyn, startEncounter };
}

const defIds = (world: World) => { const out: string[] = []; world.each(Npc, (_id, n) => out.push(n.defId)); return out; };

describe('populate(chapter)', () => {
  it('prologue-1291 spawns Stauffacher/Fürst/Melchtal/Attinghausen but not Tell/Gessler/Landenberg/Leopold/Hünenberg/Winterthur/Ludwig', () => {
    const { world, sys } = makeSystem();
    sys.populate('prologue-1291');
    const ids = new Set(defIds(world));
    for (const must of ['npc.werner-stauffacher', 'npc.walter-fuerst', 'npc.arnold-von-melchtal', 'npc.werner-von-attinghausen', 'npc.jost-imhof']) expect(ids.has(must), must).toBe(true);
    for (const no of ['npc.wilhelm-tell', 'npc.hermann-gessler', 'npc.beringer-von-landenberg', 'npc.leopold-i', 'npc.heinrich-von-hunenberg', 'npc.johannes-von-winterthur', 'npc.vogt-schreiber-ludwig', 'npc.abt-johannes']) expect(ids.has(no), no).toBe(false);
    const named = npcs.filter((n) => !n.chapters || n.chapters.includes('prologue-1291')).length;
    console.log(`prologue: ${ids.size} entities (${named} named defs + generic crowd + patrols)`);
  });

  it('chapter change ch1 → ch2 despawns Gessler/Tell and spawns Leopold; entity count does not accumulate', () => {
    const { world, sys } = makeSystem();
    sys.populate('ch1-1307');
    const n1 = defIds(world);
    expect(n1).toContain('npc.hermann-gessler');
    expect(n1).toContain('npc.wilhelm-tell');
    sys.populate('ch2-1314');
    const n2 = defIds(world);
    expect(n2).not.toContain('npc.hermann-gessler');
    expect(n2).toContain('npc.leopold-i');
    console.log(`ch1 entities=${n1.length} ch2 entities=${n2.length}`);
    expect(Math.abs(n2.length - n1.length)).toBeLessThan(20);
  });

  it('BUG PROBE: populate()/clear() also destroys recruited party companions (entities with PartyMember + Npc)', () => {
    const { world, sys } = makeSystem();
    sys.populate('prologue-1291');
    // Recruit Jost the way quest/index.ts:225-227 does: the spawned NPC entity gets PartyMember.
    let jost = -1;
    world.each(Npc, (id, n) => { if (n.defId === 'npc.jost-imhof') jost = id; });
    expect(jost).toBeGreaterThan(0);
    world.add(jost, PartyMember, { slot: 1, control: 'companion' });
    sys.populate('ch1-1307'); // the 1291 → 1307 time-skip
    const stillThere = world.has(jost, PartyMember);
    console.log(`companion entity ${jost} survives chapter change: ${stillThere}`);
    expect(stillThere).toBe(true); // round 2: companions survive
    let jostCount = 0;
    world.each(Npc, (_id, n) => { if (n.defId === 'npc.jost-imhof') jostCount++; });
    console.log(`Jost entities after the time-skip: ${jostCount}`);
    expect(jostCount).toBe(1);
  });

  it('dlg.generic.<archetype> fallback: which Interactable dialogue ids have no DialogueDef', () => {
    const { world, sys, c } = makeSystem();
    sys.populate('ch1-1307');
    const missing = new Map<string, number>();
    world.each(Npc, (id) => {
      const it = world.get(id, Interactable);
      if (!it?.dialogueId) return;
      if (!c.dialogues.has(it.dialogueId) && !it.dialogueId.startsWith('dlg.') === false && it.dialogueId.startsWith('dlg.generic.')) missing.set(it.dialogueId, (missing.get(it.dialogueId) ?? 0) + 1);
    });
    console.log(`generic dialogue ids defined: ${[...c.dialogues.keys()].filter((k) => k.startsWith('dlg.generic.')).join(', ')}`);
    console.log(`NPC entities whose fallback dialogue id does NOT exist: ${[...missing].map(([k, v]) => `${k}×${v}`).join(', ') || 'none'}`);
    console.log(`total entities with a dangling generic dialogue: ${[...missing.values()].reduce((a, b) => a + b, 0)}`);
  });
});

describe('round 2 — life, boats, load rebinding', () => {
  it('Sarnen at 23:00: crowd/minor NPCs are asleep → mesh hidden and Interactable disabled; at 12:00 visible and enabled', () => {
    const { world, sys, c } = makeSystem();
    sys.populate('prologue-1291');
    const sarnen = c.pois.get('poi.sarnen')!;
    const p = { x: sarnen.x, z: sarnen.z };
    for (let i = 0; i < 40; i++) sys.update(1, p, 23); // enough ticks to walk ≤ 22 m to the sleep offset
    let near = 0, hidden = 0, disabled = 0;
    world.each(Npc, (id, n) => {
      const t = world.get(id, Transform)!;
      if (n.frozen || Math.hypot(t.x - p.x, t.z - p.z) > 120) return;
      near++;
      const m = world.get(id, MeshRef); if (m && !(m.object as Object3D).visible) hidden++;
      const it = world.get(id, Interactable); if (it && !it.enabled) disabled++;
    });
    console.log(`Sarnen 23:00 — near NPCs ${near}, hidden ${hidden}, not interactable ${disabled}`);
    expect(hidden).toBeGreaterThan(near * 0.7);
    for (let i = 0; i < 60; i++) sys.update(1, p, 12);
    let vis = 0, en = 0, near2 = 0;
    world.each(Npc, (id, n) => {
      const t = world.get(id, Transform)!;
      if (n.frozen || Math.hypot(t.x - p.x, t.z - p.z) > 120) return;
      near2++;
      const m = world.get(id, MeshRef); if (m && (m.object as Object3D).visible) vis++;
      const it = world.get(id, Interactable); if (it && it.enabled) en++;
    });
    console.log(`Sarnen 12:00 — near NPCs ${near2}, visible ${vis}, interactable ${en}`);
    expect(vis).toBe(near2);
  });

  it('crowd actually moves during the day: market offset differs from work offset for generic NPCs', () => {
    const { world, sys, c } = makeSystem();
    sys.populate('prologue-1291');
    let moved = 0, total = 0;
    world.each(Npc, (_id, n) => {
      if (!n.generic) return;
      total++;
      const w = n.schedule.find((e) => e.activity === 'work')?.offset ?? [0, 0];
      const m = n.schedule.find((e) => e.activity === 'market')?.offset ?? [0, 0];
      if (Math.hypot(w[0] - m[0], w[1] - m[1]) > 3) moved++;
    });
    console.log(`generic NPCs with a market spot > 3 m from their work spot: ${moved}/${total}`);
    expect(moved).toBeGreaterThan(total * 0.8);
  });

  it('a recruited companion within 300 m is still stepped by its own schedule (does it wander off from the player?)', () => {
    const { world, sys, c } = makeSystem();
    sys.populate('prologue-1291');
    let jost = -1;
    world.each(Npc, (id, n) => { if (n.defId === 'npc.jost-imhof') jost = id; });
    world.add(jost, PartyMember, { slot: 1, control: 'companion' });
    const fl = c.pois.get('poi.fluelen')!;
    const t = world.get(jost, Transform)!;
    const start = { x: t.x, z: t.z };
    for (let i = 0; i < 600; i++) sys.update(1, { x: fl.x, z: fl.z }, 15); // 15:00 → schedule says Altdorf market
    const d = Math.hypot(t.x - start.x, t.z - start.z);
    console.log(`companion Jost after 10 min at 15:00 with the player standing at Flüelen: moved ${d.toFixed(0)} m toward ${world.get(jost, Npc)!.targetPoi}`);
    // round 2b: follow. Player walks 400 m east at 4 m/s; companion must stay within 6 m and never freeze.
    let px = fl.x, pz = fl.z, worst = 0;
    for (let i = 0; i < 100; i++) { px += 4; sys.update(1, { x: px, z: pz }, 15); worst = Math.max(worst, Math.hypot(t.x - px, t.z - pz)); }
    const finalD = Math.hypot(t.x - px, t.z - pz);
    console.log(`companion follow: after a 400 m walk distance to player ${finalD.toFixed(1)} m (worst ${worst.toFixed(1)} m), frozen=${world.get(jost, Npc)!.frozen}, mesh=${world.has(jost, MeshRef)}`);
    expect(finalD).toBeLessThan(6);
    expect(world.get(jost, Npc)!.frozen).toBe(false);
  });

  it('named minor NPCs: how far do their market/sleep spots lie from their work spot after withDefaultOffset?', () => {
    const { world, sys } = makeSystem();
    sys.populate('prologue-1291');
    let named = 0, market3 = 0, sleep3 = 0;
    world.each(Npc, (_id, n) => {
      if (n.generic || n.activity === 'patrol' || !n.defId.startsWith('npc.')) return;
      const w = n.schedule.find((e) => e.activity === 'work')?.offset; const m = n.schedule.find((e) => e.activity === 'market')?.offset; const sl = n.schedule.find((e) => e.activity === 'sleep')?.offset;
      if (!w) return;
      named++;
      if (m && Math.hypot(w[0] - m[0], w[1] - m[1]) > 3) market3++;
      if (sl && Math.hypot(w[0] - sl[0], w[1] - sl[1]) > 3) sleep3++;
    });
    console.log(`named NPCs with a work entry: ${named}; market spot > 3 m from work: ${market3}; sleep spot > 3 m from work: ${sleep3}`);
  });

  it('rebindPatrols(): a fresh NpcSystem over restored patrol entities regains 10 patrols and 3 leads', () => {
    const A = makeSystem();
    A.sys.populate('prologue-1291');
    // simulate load: same World/entities, new system (index.ts teardown clears the system, save restores entities)
    const partyB = { createCharacter: () => { throw new Error('not used'); } } as unknown as PartyService;
    const ws = { heightAt: () => 0, isWater: () => false, hasModel: () => true, spawnModel: () => new Object3D() } as unknown as WorldService;
    const B = new NpcSystem(A.world, A.c, partyB, ws, new Object3D(), vi.fn());
    B.rebindPatrols();
    const pat = (B as unknown as { patrols: Map<number, unknown>; patrolLead: Set<number> });
    console.log(`after rebind: patrols=${pat.patrols.size} leads=${pat.patrolLead.size}`);
    expect(pat.patrols.size).toBe(10);
    expect(pat.patrolLead.size).toBe(3);
  });
});

describe('freeze / re-entry / walking', () => {
  it('300 m freeze: NPCs beyond NPC_SIM_RADIUS get no mesh; within it they do; leaving disposes (dynamic root child count returns to 0)', () => {
    const { world, sys, dyn, c } = makeSystem();
    sys.populate('prologue-1291');
    const altdorf = c.pois.get('poi.altdorf')!;
    sys.update(0.016, { x: altdorf.x, z: altdorf.z }, 12);
    const meshedNear = dyn.children.length;
    let frozenFar = 0, unfrozenFar = 0;
    world.each(Npc, (id, n) => {
      const t = world.get(id, Transform)!;
      const d = Math.hypot(t.x - altdorf.x, t.z - altdorf.z);
      if (d > NPC_SIM_RADIUS) { if (n.frozen) frozenFar++; else unfrozenFar++; }
    });
    console.log(`at Altdorf noon: meshes=${meshedNear}, far NPCs frozen=${frozenFar}, far NPCs unfrozen=${unfrozenFar}`);
    expect(unfrozenFar).toBe(0);
    expect(meshedNear).toBeGreaterThan(5);
    // walk far away → everything freezes and meshes are removed
    sys.update(0.016, { x: altdorf.x + 5000, z: altdorf.z + 5000 }, 12);
    console.log(`after leaving: dynamic root children=${dyn.children.length}, MeshRef components=${[...world.query(MeshRef)].length}`);
    expect(dyn.children.length).toBe(0);
    sys.clear();
    expect([...world.query(Npc)].length).toBe(0);
    expect(dyn.children.length).toBe(0);
  });

  it('analytic position after 6 h of freeze equals what stepping the NPC for 6 h produces (Stauffacher, 8h→14h, Steinen→Schwyz market)', () => {
    const { world, sys, c } = makeSystem();
    sys.populate('prologue-1291');
    let ws = -1;
    world.each(Npc, (id, n) => { if (n.defId === 'npc.werner-stauffacher') ws = id; });
    const steinen = c.pois.get('poi.steinen')!;
    const schwyz = c.pois.get('poi.schwyz')!;
    // Player stands at Schwyz; Stauffacher is at Steinen at 08:00 (≈1000 m away → beyond 300 m → frozen).
    const player = { x: schwyz.x, z: schwyz.z };
    sys.update(0.1, player, 8);
    expect(world.get(ws, Npc)!.frozen).toBe(true);
    // (A) frozen the whole time, then re-enter at 14:00 → analytic snap.
    sys.update(0.1, player, 14);
    const tA = world.get(ws, Transform)!;
    const analytic = analyticPosition(world.get(ws, Npc)!.schedule, 14, 'poi.steinen', (p) => { const d = c.pois.get(p); return d ? { x: d.x, z: d.z } : null; });
    console.log(`analytic re-entry at 14h: (${tA.x.toFixed(1)}, ${tA.z.toFixed(1)}) analytic=(${analytic.x.toFixed(1)}, ${analytic.z.toFixed(1)}) schwyz=(${schwyz.x}, ${schwyz.z})`);
    expect(Math.hypot(tA.x - analytic.x, tA.z - analytic.z)).toBeLessThan(0.01);
    // (B) fresh system: player camps next to Stauffacher's *route* so he's simulated the whole time; step 8h→14h.
    const B = makeSystem();
    B.sys.populate('prologue-1291');
    let wsB = -1;
    B.world.each(Npc, (id, n) => { if (n.defId === 'npc.werner-stauffacher') wsB = id; });
    const dt = 10; // game seconds per step
    let tBt = B.world.get(wsB, Transform)!;
    B.sys.update(0.1, { x: steinen.x, z: steinen.z }, 8); // re-enter at Steinen at 08:00
    for (let h = 8; h < 14; h += dt / 3600) { tBt = B.world.get(wsB, Transform)!; B.sys.update(dt, { x: tBt.x + 2, z: tBt.z + 2 }, h); } // player shadows him
    const tB = B.world.get(wsB, Transform)!;
    console.log(`stepped 8h→14h: (${tB.x.toFixed(1)}, ${tB.z.toFixed(1)}) frozen=${B.world.get(wsB, Npc)!.frozen} target=${B.world.get(wsB, Npc)!.targetPoi}`);
    expect(Math.hypot(tB.x - analytic.x, tB.z - analytic.z)).toBeLessThan(2); // ARRIVE_EPS 1.5
  });

  it('never steps into water: an NPC whose destination lies across a lake stops at the shore', () => {
    // Water everywhere with x > 100 (a straight shoreline). Stauffacher walks from Steinen toward Schwyz — we
    // fake it by putting the whole route east of the line in water.
    // Jost Imhof: Flüelen (270,1483) at 05:00, Altdorf (574,2051) at 14:00. Water band z in (1700, 1900) across the route.
    const { world, sys, c } = makeSystem({ water: (_x, z) => z > 1700 && z < 1900 });
    sys.populate('prologue-1291');
    let jost = -1;
    world.each(Npc, (id, n) => { if (n.defId === 'npc.jost-imhof') jost = id; });
    const fl = c.pois.get('poi.fluelen')!;
    sys.update(0.1, { x: fl.x, z: fl.z }, 6); // re-enter at Flüelen (work entry, 05:00)
    let t = world.get(jost, Transform)!;
    for (let i = 0; i < 1500; i++) { t = world.get(jost, Transform)!; sys.update(1, { x: t.x + 2, z: t.z + 2 }, 14); } // 14h → Altdorf, 25 min of walking
    console.log(`after 1500 s heading across the water band: z=${t.z.toFixed(1)} (band 1700..1900), frozen=${world.get(jost, Npc)!.frozen}`);
    expect(t.z).toBeLessThanOrEqual(1700);
  });

  it('Habsburg patrol: hostile gate — no encounter when not hostile; encounter id used is enc.altdorf-square wherever the patrol is', () => {
    const { world, sys, startEncounter, c } = makeSystem();
    sys.populate('prologue-1291');
    // find the kuessnacht-road lead patrol (spawned at road.via[0] = arth)
    const arth = c.pois.get('poi.arth')!;
    let lead = -1;
    world.each(Npc, (id, n) => { if (n.activity === 'patrol' && lead < 0) lead = id; });
    const t = world.get(lead, Transform)!;
    const player = { x: t.x + 1, z: t.z + 1 };
    sys.setHostileHabsburg(false);
    for (let i = 0; i < 5; i++) sys.update(0.1, player, 12);
    expect(startEncounter).not.toHaveBeenCalled();
    sys.setHostileHabsburg(true);
    const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(10 * 60 * 1000);
    const pt = world.get(lead, Transform)!;
    const playerAt = { x: pt.x + 1, z: pt.z + 1 };
    for (let i = 0; i < 5; i++) sys.update(0.1, playerAt, 12);
    console.log(`patrol near (${pt.x.toFixed(0)}, ${pt.z.toFixed(0)}) (Arth is (${arth.x}, ${arth.z})); startEncounter calls: ${JSON.stringify(startEncounter.mock.calls)}`);
    expect(startEncounter.mock.calls[0][0]).toBe('enc.habsburg-patrol');
    expect(Math.hypot(startEncounter.mock.calls[0][1].x - playerAt.x, startEncounter.mock.calls[0][1].z - playerAt.z)).toBeLessThan(0.01);
    nowSpy.mockRestore();
  });

  it('patrol cooldown uses performance.now() from 0: no patrol can trigger within the first 15 s after page load', () => {
    const { world, sys, startEncounter } = makeSystem();
    sys.populate('prologue-1291');
    let lead = -1;
    world.each(Npc, (id, n) => { if (n.activity === 'patrol' && lead < 0) lead = id; });
    sys.setHostileHabsburg(true);
    const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(5000);
    const pt = world.get(lead, Transform)!;
    for (let i = 0; i < 5; i++) sys.update(0.1, { x: pt.x + 1, z: pt.z + 1 }, 12);
    console.log(`hostile, adjacent to lead patrol at t=5 s after load: startEncounter calls=${startEncounter.mock.calls.length}`);
    nowSpy.mockRestore();
  });
});
