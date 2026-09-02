/**
 * Critic probe — itemised content audit of src/content/pois.ts and src/content/npcs.ts against LORE.md
 * §3/§4/§5/§7/§8/§10 and gazetteer.ts. Prints the audit tables so the numbers land in the score sheet.
 */
import { describe, it, expect } from 'vitest';
import { pois } from '@content/pois';
import { npcs } from '@content/npcs';
import { PLACES, LAKES } from '@content/gazetteer';
import { PLACE_REGION_ID } from '@content/geography';

// LORE.md §4 mandated list → expected kind (as the critic reads §4) and expected LORE §3 status of the *place*.
const MANDATED: Record<string, { kind: string; placeStatus: 'H' | 'L' }> = {
  'poi.ruetli': { kind: 'meadow', placeStatus: 'H' },
  'poi.altdorf': { kind: 'village', placeStatus: 'H' },
  'poi.buerglen': { kind: 'village', placeStatus: 'H' },
  'poi.fluelen': { kind: 'port', placeStatus: 'H' },
  'poi.tellsplatte': { kind: 'landmark', placeStatus: 'L' },
  'poi.hohle-gasse': { kind: 'landmark', placeStatus: 'L' },
  'poi.kuessnacht': { kind: 'village', placeStatus: 'H' },
  'poi.gesslerburg': { kind: 'castle', placeStatus: 'H' },
  'poi.zwing-uri': { kind: 'castle', placeStatus: 'L' },
  'poi.attinghausen': { kind: 'castle', placeStatus: 'H' },
  'poi.schwyz': { kind: 'village', placeStatus: 'H' },
  'poi.steinen': { kind: 'village', placeStatus: 'H' },
  'poi.brunnen': { kind: 'port', placeStatus: 'H' },
  'poi.sattel': { kind: 'village', placeStatus: 'H' },
  'poi.sattel-letzi': { kind: 'wall', placeStatus: 'H' },
  'poi.morgarten': { kind: 'battlefield', placeStatus: 'H' },
  'poi.aegerisee-shore': { kind: 'landmark', placeStatus: 'H' },
  'poi.einsiedeln': { kind: 'monastery', placeStatus: 'H' },
  'poi.stans': { kind: 'village', placeStatus: 'H' },
  'poi.rotzberg': { kind: 'castle', placeStatus: 'H' },
  'poi.sarnen': { kind: 'village', placeStatus: 'H' },
  'poi.landenberg': { kind: 'castle', placeStatus: 'H' },
  'poi.melchtal': { kind: 'alp', placeStatus: 'L' },
  'poi.luzern': { kind: 'town', placeStatus: 'H' },
  'poi.zug': { kind: 'town', placeStatus: 'H' },
  'poi.teufelsbruecke': { kind: 'bridge', placeStatus: 'H' },
  'poi.andermatt': { kind: 'village', placeStatus: 'H' },
  'poi.gotthard': { kind: 'pass', placeStatus: 'H' },
  'poi.seelisberg': { kind: 'viewpoint', placeStatus: 'H' },
  'poi.pilatus': { kind: 'alp', placeStatus: 'H' },
  'poi.rigi': { kind: 'alp', placeStatus: 'H' },
  'poi.muotathal': { kind: 'village', placeStatus: 'H' },
};

// LORE.md §5 table → exact `historical` value, faction, chapters (§1/§5 as the brief reads them).
const CAST: Record<string, { historical: true | 'legend' | 'invented'; faction: string; chapters: string[] | 'all'; home: string }> = {
  'npc.werner-stauffacher': { historical: 'legend', faction: 'schwyz', chapters: 'all', home: 'poi.steinen' },
  'npc.walter-fuerst': { historical: 'legend', faction: 'uri', chapters: 'all', home: 'poi.altdorf' },
  'npc.arnold-von-melchtal': { historical: 'legend', faction: 'unterwalden', chapters: 'all', home: 'poi.melchtal' },
  'npc.wilhelm-tell': { historical: 'legend', faction: 'uri', chapters: ['ch1-1307'], home: 'poi.buerglen' },
  'npc.hermann-gessler': { historical: 'legend', faction: 'habsburg', chapters: ['ch1-1307'], home: 'poi.gesslerburg' },
  'npc.beringer-von-landenberg': { historical: 'legend', faction: 'habsburg', chapters: ['ch1-1307'], home: 'poi.landenberg' },
  'npc.werner-von-attinghausen': { historical: true, faction: 'uri', chapters: 'all', home: 'poi.attinghausen' },
  'npc.leopold-i': { historical: true, faction: 'habsburg', chapters: ['ch2-1314'], home: 'poi.zug' },
  'npc.abt-johannes': { historical: true, faction: 'einsiedeln', chapters: ['ch2-1314'], home: 'poi.einsiedeln' },
  'npc.konrad-ab-yberg': { historical: 'invented', faction: 'schwyz', chapters: 'all', home: 'poi.schwyz' }, // LORE: "H (family; individual I)"
  'npc.heinrich-von-hunenberg': { historical: 'legend', faction: 'habsburg', chapters: ['ch2-1314'], home: 'poi.zug' },
  'npc.johannes-von-winterthur': { historical: true, faction: 'none', chapters: ['ch2-1314'], home: 'poi.zug' },
  'npc.jost-imhof': { historical: 'invented', faction: 'uri', chapters: 'all', home: 'poi.fluelen' },
  'npc.mechthild-schorno': { historical: 'invented', faction: 'schwyz', chapters: 'all', home: 'poi.steinen' },
  'npc.heini-odermatt': { historical: 'invented', faction: 'unterwalden', chapters: 'all', home: 'poi.stans' },
  'npc.bruder-anselm': { historical: 'invented', faction: 'unterwalden', chapters: 'all', home: 'poi.engelberg' },
  'npc.ueli-zgraggen': { historical: 'invented', faction: 'none', chapters: 'all', home: 'poi.altdorf' },
  'npc.ritter-eberhard-von-mülinen': { historical: 'invented', faction: 'habsburg', chapters: ['ch2-1314'], home: 'poi.zug' },
  'npc.vogt-schreiber-ludwig': { historical: 'invented', faction: 'habsburg', chapters: ['ch1-1307'], home: 'poi.altdorf' },
};
const ALL = ['prologue-1291', 'ch1-1307', 'ch2-1314'];

// LORE §5 curated given names + §8 diminutives; anything outside this set is reported (not failed) for the eye.
const LORE_GIVEN = new Set(['Kuoni', 'Ruodi', 'Werni', 'Jost', 'Heini', 'Ueli', 'Peter', 'Hans', 'Konrad', 'Burkhard', 'Rudi', 'Gret', 'Trudi', 'Elsi', 'Mechthild', 'Adelheid', 'Anna', 'Verena', 'Bertha']);
const LORE_FAMILY = new Set(['Imhof', 'Gisler', 'Zumbrunnen', 'Aschwanden', 'Herger', 'Schorno', 'Bühler', 'Zgraggen', 'Odermatt', 'Amstutz', 'Wyrsch', 'Lussi']);
// Schiller-only names (LORE §9: Schiller for the shape of the legend only, never for facts).
const SCHILLER_ONLY = /hedwig|rudenz|bruneck|st[uü]ssi|baumgarten|parricida|walther|leuthold|pfeifer|rösselmann|kuoni der hirt|werni der jäger|ruodi der fischer/i;
const BANNED = /\bswitzerland\b|\bswiss\b|\bcanton\b|\bbandit|plate harness|wheellock|handgun|musket|windlass|kapellbr|potato|maize|tomato|tobacco|chocolate|\bflag\b/i;

function pointInPoly(x: number, z: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

describe('POI audit (LORE §3/§4, gazetteer)', () => {
  const byId = new Map(pois.map((p) => [p.id, p]));

  it('every mandated §4 POI exists with the right kind, at the gazetteer coordinates (max deviation printed), in the LORE region', () => {
    const rows: string[] = [];
    let maxDev = 0;
    const kindMismatch: string[] = [];
    const missing: string[] = [];
    for (const [id, exp] of Object.entries(MANDATED)) {
      const p = byId.get(id);
      if (!p) { missing.push(id); continue; }
      const gaz = PLACES[id.slice(4)];
      const dev = gaz ? Math.hypot(p.x - gaz.x, p.z - gaz.z) : NaN;
      if (gaz) maxDev = Math.max(maxDev, dev);
      if (p.kind !== exp.kind) kindMismatch.push(`${id}: ${p.kind} (expected ${exp.kind})`);
      const regionExpected = gaz ? PLACE_REGION_ID[id.slice(4)] : '(invented)';
      rows.push(`${id.padEnd(22)} kind=${p.kind.padEnd(11)} dev=${Number.isNaN(dev) ? 'n/a ' : dev.toFixed(0).padStart(4)} region=${p.region.padEnd(24)} ${p.region === regionExpected ? '' : 'REGION≠geography'} hist=${String(p.historical).padEnd(8)} note=${p.note ? 'y' : 'MISSING'}`);
    }
    console.log(rows.join('\n'));
    console.log(`max coordinate deviation from gazetteer: ${maxDev} m; missing: ${missing.length}; kind mismatches: ${kindMismatch.join('; ') || 'none'}`);
    expect(missing).toEqual([]);
    expect(maxDev).toBe(0);
    expect(kindMismatch).toEqual([]);
  });

  it('reports `historical` values that contradict LORE §3 for the *place* (H place marked legend / L place marked H)', () => {
    const contra: string[] = [];
    for (const [id, exp] of Object.entries(MANDATED)) {
      const p = byId.get(id)!;
      const got = p.historical === true ? 'H' : p.historical === 'legend' ? 'L' : 'I';
      if (got !== exp.placeStatus) contra.push(`${id}: file=${got} LORE-place=${exp.placeStatus}`);
    }
    console.log('historical-vs-LORE contradictions:', contra.length ? contra.join('\n  ') : 'none');
    expect(contra.length).toBeLessThanOrEqual(12); // informational — listed in the sheet
  });

  it('counts and categorises: mandated / gazetteer-extra / invented; every def has historical+note+description', () => {
    const inv = pois.filter((p) => p.historical === 'invented');
    const gaz = pois.filter((p) => PLACES[p.id.slice(4)]);
    console.log(`POIs total=${pois.length} gazetteer-backed=${gaz.length} invented=${inv.length} (${inv.map((p) => p.id).join(', ')})`);
    for (const p of pois) { expect(p.note).toBeTruthy(); expect(p.description).toBeTruthy(); expect(p.historical).toBeDefined(); }
    expect(pois.length).toBeGreaterThanOrEqual(60);
    const ids = new Set(pois.map((p) => p.id));
    expect(ids.size).toBe(pois.length);
  });

  it('invented POIs sit on dry land (not inside a gazetteer lake polygon) and the Ägerisee "south shore" is actually south', () => {
    const wet: string[] = [];
    for (const p of pois) {
      for (const lake of LAKES) if (pointInPoly(p.x, p.z, lake.poly)) wet.push(`${p.id} in ${lake.id}`);
    }
    console.log('POIs inside a lake polygon:', wet.length ? wet.join(', ') : 'none');
    const sh = byId.get('poi.aegerisee-shore')!;
    const aeg = LAKES.find((l) => l.id === 'aegerisee')!;
    const southMost = Math.max(...aeg.poly.map((v) => v[1])); // +z = south
    console.log(`Ägerisee shore POI at (${sh.x}, ${sh.z}); lake's southern-most vertex z=${southMost}; Morgarten z=${PLACES.morgarten.z}; region=${sh.region}`);
    // Coarse gazetteer polygons swallow several real shore villages; only the *invented* ones are the builder's call.
    const wetInvented = wet.filter((w) => /wegkreuz|klausner|fischerhuetten|kohler|muehle|steinbruch|zollstatt|bannalp/.test(w));
    console.log('INVENTED POIs inside a lake polygon:', wetInvented);
  });

  it('banned-word grep on every player-facing POI description/name', () => {
    const hits = pois.filter((p) => BANNED.test(p.description) || BANNED.test(p.name)).map((p) => `${p.id}: "${(p.description.match(BANNED) ?? p.name.match(BANNED))![0]}"`);
    console.log('POI description banned-word hits:', hits.length ? hits.join('\n  ') : 'none');
  });

  it('population totals (the "~150 unnamed" target) and archetype ids used', () => {
    let total = 0; const arch = new Map<string, number>();
    for (const p of pois) for (const [a, n] of Object.entries(p.population ?? {})) { total += n; arch.set(a, (arch.get(a) ?? 0) + n); }
    console.log(`generic crowd total=${total}; by archetype: ${[...arch].map(([a, n]) => `${a}=${n}`).join(', ')}`);
    console.log(`settlements with population: ${pois.filter((p) => p.population).length}`);
  });
});

describe('NPC audit (LORE §5/§7/§8/§10)', () => {
  const byId = new Map(npcs.map((n) => [n.id, n]));

  it('every LORE §5 id exists with the exact historical value, faction, home and chapters', () => {
    const rows: string[] = []; const missing: string[] = []; const bad: string[] = [];
    for (const [id, exp] of Object.entries(CAST)) {
      const n = byId.get(id);
      if (!n) { missing.push(id); continue; }
      const expCh = exp.chapters === 'all' ? ALL : exp.chapters;
      const chOk = JSON.stringify([...(n.chapters ?? ALL)].sort()) === JSON.stringify([...expCh].sort());
      const flags = [n.historical === exp.historical ? '' : `HIST ${String(n.historical)}≠${String(exp.historical)}`, n.faction === exp.faction ? '' : `FACTION ${n.faction}≠${exp.faction}`, n.home === exp.home ? '' : `HOME ${n.home}`, chOk ? '' : `CHAPTERS ${JSON.stringify(n.chapters)}`].filter(Boolean);
      if (flags.length) bad.push(`${id}: ${flags.join(', ')}`);
      rows.push(`${id.padEnd(34)} hist=${String(n.historical).padEnd(8)} faction=${n.faction.padEnd(12)} arch=${n.archetype.padEnd(18)} ch=${(n.chapters ?? ALL).join('|')} equip=${Object.values(n.equipment ?? {}).join(',')}`);
    }
    console.log(rows.join('\n'));
    console.log('missing:', missing, '\ndeviations:', bad.length ? '\n  ' + bad.join('\n  ') : 'none');
    expect(missing.filter((m) => m !== 'npc.ritter-eberhard-von-mülinen')).toEqual([]);
  });

  it('counts: historical/legend cast, invented core, minors; names vs LORE §8 lists; Schiller-only names; "Bruder" on non-monks', () => {
    const hist = npcs.filter((n) => n.historical === true || n.historical === 'legend');
    const invented = npcs.filter((n) => n.historical === 'invented');
    const minors = npcs.filter((n) => !(n.id in CAST) && n.id !== 'npc.ritter-eberhard-von-mulinen');
    console.log(`NPCs total=${npcs.length} H/L=${hist.length} invented=${invented.length} minors(not in §5)=${minors.length}`);
    const offGiven: string[] = []; const offFamily: string[] = []; const schiller: string[] = []; const bruderNonMonk: string[] = [];
    for (const n of minors) {
      const [given, ...rest] = n.name.split(' ');
      const family = rest.join(' ');
      if (!LORE_GIVEN.has(given) && given !== 'Bruder') offGiven.push(given);
      if (!LORE_FAMILY.has(family)) offFamily.push(family);
      if (SCHILLER_ONLY.test(n.name)) schiller.push(n.name);
      if (given === 'Bruder' && n.archetype !== 'monk') bruderNonMonk.push(`${n.id} (${n.archetype})`);
    }
    console.log('given names outside LORE §5 curated list:', [...new Set(offGiven)].join(', '));
    console.log('family names outside LORE §5 curated list:', [...new Set(offFamily)].join(', '));
    console.log('Schiller-only names:', schiller.length ? schiller : 'none');
    console.log('"Bruder" used for non-monk archetypes:', bruderNonMonk.length ? bruderNonMonk : 'none');
    expect(schiller).toEqual([]);
  });

  it('banned-word grep on every NPC description/name; every def has historical+note', () => {
    const hits = npcs.filter((n) => BANNED.test(n.description) || BANNED.test(n.name)).map((n) => `${n.id}: "${(n.description.match(BANNED) ?? n.name.match(BANNED))![0]}"`);
    console.log('NPC description banned-word hits:', hits.length ? hits.join('\n  ') : 'none');
    for (const n of npcs) { expect(n.note).toBeTruthy(); expect(n.historical).toBeDefined(); }
  });

  it('equipment is LORE §7 kit only (no plate harness / windlass / handgun item ids)', () => {
    const ids = new Set<string>();
    for (const n of npcs) for (const v of Object.values(n.equipment ?? {})) if (v) ids.add(v);
    console.log('equipment item ids used by npcs.ts:', [...ids].sort().join(', '));
    expect([...ids].filter((i) => /plate-harness|windlass|handgun|arquebus|musket/.test(i))).toEqual([]);
  });

  it('schedules: how many NPCs ever leave home (multi-POI schedules) vs stay put all day', () => {
    const travelers = npcs.filter((n) => n.schedule && new Set(n.schedule.map((e) => (e.poi === 'home' ? n.home : e.poi))).size > 1);
    console.log(`NPCs whose schedule visits >1 POI: ${travelers.length}/${npcs.length} → ${travelers.map((n) => n.id).join(', ')}`);
    const homes = new Set(npcs.map((n) => n.home));
    console.log(`distinct home settlements: ${homes.size}`);
    expect(homes.size).toBeGreaterThanOrEqual(6);
  });
});
