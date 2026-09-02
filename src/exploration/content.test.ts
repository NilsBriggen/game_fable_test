/**
 * Content validation for `src/content/pois.ts` and `src/content/npcs.ts` — the exploration builder's two
 * content files. Builds an isolated `ContentRegistry` with everything those files cross-reference
 * (geography for regions, items+archetypes for equipment/skill ids, plus minimal faction/dialogue stand-ins
 * — see the "known gaps" note below) and asserts `validate()` reports zero problems that mention a `poi`
 * or `npc` id.
 */
import { describe, it, expect } from 'vitest';
import { ContentRegistry } from '@core/content';
import { register as registerGeography } from '@content/geography';
import { register as registerSkills } from '@content/skills';
import { register as registerItems } from '@content/items';
import { register as registerArchetypes } from '@content/archetypes';
import { register as registerPois, pois } from '@content/pois';
import { register as registerNpcs, npcs } from '@content/npcs';
import type { DialogueDef, FactionDef } from '@core/schemas';

const LORE_FACTIONS = ['uri', 'schwyz', 'unterwalden', 'habsburg', 'einsiedeln', 'luzern', 'zuerich', 'bern', 'saeumer', 'raubritter', 'none'];

function buildRegistry(): ContentRegistry {
  const c = new ContentRegistry();
  registerGeography(c);
  registerSkills(c);
  registerItems(c);
  registerArchetypes(c);
  registerPois(c);
  registerNpcs(c);
  // factions.ts and dialogues.ts (both quest-builder-owned, src/content/factions.ts + src/content/dialogues/)
  // are still Wave-3 stubs (`export {}` / empty register()) as of this writing — see requests/exploration-1.md.
  // Stand-ins here isolate *this* validation to problems this module actually owns, not that gap.
  const factionDefs: FactionDef[] = LORE_FACTIONS.map((id) => ({ id, name: id, kind: 'canton', hostileTo: [], historical: true, note: 'test stand-in', description: id }));
  c.addFactions(factionDefs);
  const dialogueIds = new Set(npcs.map((n) => n.dialogueRoot).filter((d): d is string => !!d));
  const dialogueDefs: DialogueDef[] = [...dialogueIds].map((id) => ({
    id, root: 'start', nodes: { start: { speaker: 'narrator', text: '', end: true } }, historical: 'invented', note: 'test stand-in',
  }));
  c.addDialogues(dialogueDefs);
  return c;
}

describe('pois.ts content validation', () => {
  const c = buildRegistry();

  it('registers at least 60 POIs (task spec: exploration builder authors ≥ 60)', () => {
    expect(c.pois.size).toBeGreaterThanOrEqual(60);
  });

  it('every mandated LORE.md §4 gazetteer POI id is present', () => {
    const mandated = [
      'poi.altdorf', 'poi.ruetli', 'poi.fluelen', 'poi.tellsplatte', 'poi.hohle-gasse', 'poi.kuessnacht',
      'poi.gesslerburg', 'poi.zwing-uri', 'poi.attinghausen', 'poi.schwyz', 'poi.steinen', 'poi.brunnen',
      'poi.sattel-letzi', 'poi.morgarten', 'poi.einsiedeln', 'poi.stans', 'poi.rotzberg', 'poi.sarnen',
      'poi.landenberg', 'poi.melchtal', 'poi.luzern', 'poi.zug', 'poi.teufelsbruecke', 'poi.andermatt',
      'poi.gotthard', 'poi.seelisberg', 'poi.muotathal', 'poi.buerglen', 'poi.rigi', 'poi.pilatus',
    ];
    for (const id of mandated) expect(c.pois.has(id), `missing ${id}`).toBe(true);
  });

  it('every POI carries historical + a non-empty note', () => {
    for (const p of c.pois.values()) {
      expect(p.historical, p.id).toBeTruthy();
      expect(p.note.length, p.id).toBeGreaterThan(0);
    }
  });

  it('every POI region resolves against content/geography.ts', () => {
    for (const p of c.pois.values()) expect(c.regions.has(p.region), `${p.id} -> ${p.region}`).toBe(true);
  });

  it('no problems reference a poi id', () => {
    const problems = c.validate().filter((p) => p.startsWith('poi '));
    expect(problems).toEqual([]);
  });

  it('invents at least 10 minor POIs (LORE.md §4/§10: alp hut, wayside crosses, charcoal camps, a hermit\'s cell, fishermen\'s huts, a mill, a quarry, a toll-station ruin), all flagged historical: "invented"', () => {
    // No filesystem access in this suite (tsconfig carries no @types/node — see BUILDER_RULES "no new npm
    // dependencies"); the corresponding LORE.md §10 row was added by hand alongside pois.ts and lists every
    // one of these ids explicitly.
    const inventedIds = pois.filter((p) => p.historical === 'invented').map((p) => p.id);
    expect(inventedIds.length).toBeGreaterThanOrEqual(10);
    for (const id of inventedIds) expect(id.startsWith('poi.'), id).toBe(true);
  });
});

describe('npcs.ts content validation', () => {
  const c = buildRegistry();

  it('every LORE.md §5 named-cast id is present with the correct historical value', () => {
    const expected: Record<string, 'true' | 'legend'> = {
      'npc.werner-stauffacher': 'legend', 'npc.walter-fuerst': 'legend', 'npc.arnold-von-melchtal': 'legend',
      'npc.wilhelm-tell': 'legend', 'npc.hermann-gessler': 'legend', 'npc.beringer-von-landenberg': 'legend',
      'npc.werner-von-attinghausen': 'true', 'npc.leopold-i': 'true', 'npc.abt-johannes': 'true',
      'npc.konrad-ab-yberg': 'legend', 'npc.heinrich-von-hunenberg': 'legend', 'npc.johannes-von-winterthur': 'true',
    };
    for (const [id, hist] of Object.entries(expected)) {
      const def = c.npcs.get(id);
      expect(def, `missing ${id}`).toBeTruthy();
      expect(def!.historical, id).toBe(hist === 'true' ? true : hist);
    }
  });

  it('the invented companion pool and antagonist lieutenants are present', () => {
    for (const id of [
      'npc.jost-imhof', 'npc.mechthild-schorno', 'npc.heini-odermatt', 'npc.bruder-anselm', 'npc.ueli-zgraggen',
      'npc.ritter-eberhard-von-mulinen', 'npc.vogt-schreiber-ludwig',
    ]) expect(c.npcs.has(id), id).toBe(true);
  });

  it('registers at least 70 additional minor named NPCs beyond the named cast', () => {
    const namedCastCount = 12 + 7; // historical/legendary + invented core (LORE.md §5)
    expect(c.npcs.size - namedCastCount).toBeGreaterThanOrEqual(70);
  });

  it('Gessler and Landenberg exist only in ch1-1307', () => {
    expect(c.npcs.get('npc.hermann-gessler')!.chapters).toEqual(['ch1-1307']);
    expect(c.npcs.get('npc.beringer-von-landenberg')!.chapters).toEqual(['ch1-1307']);
  });

  it('Leopold, Hünenberg and Winterthur exist only in ch2-1314', () => {
    for (const id of ['npc.leopold-i', 'npc.heinrich-von-hunenberg', 'npc.johannes-von-winterthur']) {
      expect(c.npcs.get(id)!.chapters).toEqual(['ch2-1314']);
    }
  });

  it('Wilhelm Tell is a companion available only in ch1-1307', () => {
    expect(c.npcs.get('npc.wilhelm-tell')!.chapters).toEqual(['ch1-1307']);
  });

  it('every chapter listed is one of the three defined chapters', () => {
    const valid = new Set(['prologue-1291', 'ch1-1307', 'ch2-1314']);
    for (const n of c.npcs.values()) for (const ch of n.chapters ?? []) expect(valid.has(ch), `${n.id}: ${ch}`).toBe(true);
  });

  it('every home POI exists', () => {
    for (const n of c.npcs.values()) expect(c.pois.has(n.home), `${n.id} -> ${n.home}`).toBe(true);
  });

  it('every equipped item id exists in items.ts', () => {
    for (const n of c.npcs.values()) {
      for (const itemId of Object.values(n.equipment ?? {})) {
        if (itemId) expect(c.items.has(itemId), `${n.id}: ${itemId}`).toBe(true);
      }
    }
  });

  it('no problems reference an npc id', () => {
    const problems = c.validate().filter((p) => p.startsWith('npc '));
    expect(problems).toEqual([]);
  });

  it('validate() is entirely clean given the geography/items/archetypes/faction/dialogue stand-ins', () => {
    expect(c.validate()).toEqual([]);
  });
});
