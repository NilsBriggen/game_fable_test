/**
 * encounters — content data owned by the combat builder. The four Act 1 fights (LORE.md §6 steps 3/7/10/12)
 * plus Morgarten. Each `units` list includes a small `side:'player'` fallback squad so the encounter is
 * playable stand-alone when no real party exists yet (Wave-2 harness runs without exploration) — a real
 * party (`PartyService.getParty()`) supersedes it at placement time (see `combat/engine.ts` `placeUnits`).
 */
import type { ContentRegistry } from '@core/content';
import type { EncounterDef } from '@core/schemas';
import { PLACES } from './gazetteer';

const brunnen = PLACES['brunnen'];
const altdorf = PLACES['altdorf'];
const hohleGasse = PLACES['hohle-gasse'];
const einsiedeln = PLACES['einsiedeln'];
const morgarten = PLACES['morgarten'];

export const encounters: EncounterDef[] = [
  {
    id: 'enc.brunnen-quay', name: 'The Brunnen Quay', location: { x: brunnen.x, z: brunnen.z, yaw: 0.3 },
    grid: { cols: 16, rows: 16, cellM: 1.5 }, heightOverride: 'quay',
    deploy: { q: 2, r: 3, cols: 3, rows: 3 },
    units: [
      { archetype: 'toll-collector', side: 'enemy', q: 11, r: 8 },
      { archetype: 'habsburg-footman', side: 'enemy', q: 12, r: 9 },
      { archetype: 'saeumer', side: 'player', q: 3, r: 7 },
      { archetype: 'herder', side: 'player', q: 3, r: 9 },
    ],
    objectives: [{ type: 'defeat-all' }],
    terrainFeatures: [],
    scripted: [],
    description: 'A Habsburg road-toll party tries to seize the escorted boat\'s cargo on the raised stone quay at Brunnen.',
    historical: 'legend', note: 'LORE.md §6 Prologue step 3: the combat tutorial (2v2), introducing action/bonus/movement, high-ground Edge on the quay, and a spear brace.',
  },
  {
    id: 'enc.altdorf-square', name: 'The Square at Altdorf', location: { x: altdorf.x, z: altdorf.z, yaw: 0 },
    grid: { cols: 18, rows: 18, cellM: 1.5 },
    deploy: { q: 2, r: 2, cols: 3, rows: 3 },
    units: [
      { archetype: 'bailiff-guard', side: 'enemy', q: 12, r: 12, count: 4 },
      { archetype: 'militia-spear', side: 'player', q: 3, r: 3, count: 2 },
      { archetype: 'herder', side: 'player', q: 3, r: 5 },
    ],
    objectives: [{ type: 'rout' }],
    terrainFeatures: [],
    scripted: [],
    description: 'A player who will not bow to Gessler\'s hat on the pole is set upon by the bailiff\'s guards in the Altdorf square.',
    historical: 'legend', note: 'LORE.md §6 Chapter 1 step 5: the "walk past and fight" branch of the hat-on-the-pole scene (3v4), Weisses Buch von Sarnen tradition.',
  },
  {
    id: 'enc.hohle-gasse', name: 'The Hohle Gasse', location: { x: hohleGasse.x, z: hohleGasse.z, yaw: 1.1 },
    grid: { cols: 22, rows: 12, cellM: 1.5 }, heightOverride: 'gasse',
    deploy: { q: 1, r: 4, cols: 2, rows: 4 },
    units: [
      { archetype: 'habsburg-sergeant', side: 'enemy', q: 14, r: 6, group: 'gessler' },
      { archetype: 'habsburg-footman', side: 'enemy', q: 16, r: 5, count: 3 },
      { archetype: 'habsburg-crossbowman', side: 'enemy', q: 18, r: 6, count: 2 },
      { archetype: 'militia-halberd', side: 'player', q: 3, r: 5, count: 2 },
      { archetype: 'militia-spear', side: 'player', q: 3, r: 7 },
      { archetype: 'herder', side: 'player', q: 2, r: 6 },
    ],
    objectives: [{ type: 'rout' }],
    terrainFeatures: [],
    scripted: [
      { round: 2, actions: [{ caption: 'Tell\'s bolt finds Gessler.' }, { kill: 'npc.hermann-gessler' }] },
    ],
    description: 'The party holds the sunken road behind Tell while his crossbow waits for Gessler\'s escort to pass.',
    historical: 'legend', note: 'LORE.md §6 Chapter 1 step 7: combat 4v6 against Gessler\'s escort; the scripted round-2 kill resolves Gessler\'s death by Tell\'s bolt (falls back to the escort\'s sergeant if the named Landvogt is not present as a unit).',
  },
  {
    id: 'enc.einsiedeln-gate', name: 'The Abbey Gate', location: { x: einsiedeln.x, z: einsiedeln.z, yaw: 0 },
    grid: { cols: 18, rows: 18, cellM: 1.5 }, heightOverride: 'gate',
    deploy: { q: 2, r: 2, cols: 3, rows: 3 },
    units: [
      { archetype: 'abbey-man-at-arms', side: 'enemy', q: 9, r: 9, count: 5 },
      { archetype: 'militia-halberd', side: 'player', q: 2, r: 4 },
      { archetype: 'militia-spear', side: 'player', q: 2, r: 6, count: 2 },
      { archetype: 'saeumer', side: 'player', q: 3, r: 8 },
    ],
    objectives: [{ type: 'rout' }],
    terrainFeatures: [],
    scripted: [],
    description: 'The Marchenstreit raid: Schwyz men force the abbey gate over the disputed March pastures on Epiphany night, 1314.',
    historical: true, note: 'LORE.md §1 and §6 Chapter 2 step 10: the Einsiedeln raid (H event, 6 Jan 1314), combat 4v5 against the abbey\'s own retainers.',
  },
  {
    id: 'enc.morgarten', name: 'The Battle of Morgarten', location: { x: morgarten.x, z: morgarten.z, yaw: 0.2 },
    grid: { cols: 40, rows: 24, cellM: 1.5 }, heightOverride: 'morgarten',
    deploy: { q: 14, r: 11, cols: 8, rows: 3 },
    units: [
      // Habsburg column, strung along the road between the lake and the slope.
      { archetype: 'habsburg-knight', side: 'enemy', q: 4, r: 5, mounted: true, group: 'column' },
      { archetype: 'habsburg-knight', side: 'enemy', q: 10, r: 5, mounted: true, group: 'column' },
      { archetype: 'habsburg-knight', side: 'enemy', q: 16, r: 5, mounted: true, group: 'column' },
      { archetype: 'habsburg-knight', side: 'enemy', q: 22, r: 5, mounted: true, group: 'column' },
      { archetype: 'habsburg-knight', side: 'enemy', q: 28, r: 5, mounted: true, group: 'column' },
      { archetype: 'habsburg-knight', side: 'enemy', q: 34, r: 5, mounted: true, group: 'column' },
      { archetype: 'habsburg-footman', side: 'enemy', q: 6, r: 6, group: 'column' },
      { archetype: 'habsburg-footman', side: 'enemy', q: 12, r: 6, group: 'column' },
      { archetype: 'habsburg-footman', side: 'enemy', q: 18, r: 6, group: 'column' },
      { archetype: 'habsburg-footman', side: 'enemy', q: 24, r: 6, group: 'column' },
      { archetype: 'habsburg-footman', side: 'enemy', q: 30, r: 6, group: 'column' },
      { archetype: 'habsburg-footman', side: 'enemy', q: 36, r: 6, group: 'column' },
      { archetype: 'habsburg-crossbowman', side: 'enemy', q: 2, r: 4, group: 'column' },
      { archetype: 'habsburg-crossbowman', side: 'enemy', q: 37, r: 4, group: 'column' },
      // Confederate slope line: halberd militia stand directly on the boulder/trunk caches, each lined up
      // on a Habsburg footman's column below (r=6) so the rockfall has a target from the opening round;
      // spear militia hold the line just below them, ready to close the Haufen once the boulders have fallen.
      { archetype: 'militia-halberd', side: 'player', q: 6, r: 8, group: 'haufen' },
      { archetype: 'militia-halberd', side: 'player', q: 12, r: 8, group: 'haufen' },
      { archetype: 'militia-halberd', side: 'player', q: 18, r: 8, group: 'haufen' },
      { archetype: 'militia-halberd', side: 'player', q: 24, r: 8, group: 'haufen' },
      { archetype: 'militia-halberd', side: 'player', q: 30, r: 8, group: 'haufen' },
      { archetype: 'militia-spear', side: 'player', q: 9, r: 9, group: 'haufen' },
      { archetype: 'militia-spear', side: 'player', q: 21, r: 9, group: 'haufen' },
      { archetype: 'militia-spear', side: 'player', q: 33, r: 9, group: 'haufen' },
    ],
    objectives: [
      { type: 'survive', turns: 3 },
      { type: 'trigger-features', kind: 'boulder-cache', count: 2 },
      { type: 'rout' },
    ],
    loseObjectives: [{ type: 'protect', npc: 'player' }],
    terrainFeatures: [
      { kind: 'boulder-cache', cells: [[6, 8]], affects: [[6, 7], [6, 6], [6, 5]] },
      { kind: 'boulder-cache', cells: [[18, 8]], affects: [[18, 7], [18, 6], [18, 5]] },
      { kind: 'boulder-cache', cells: [[30, 8]], affects: [[30, 7], [30, 6], [30, 5]] },
      { kind: 'trunk-cache', cells: [[12, 8]], affects: [[12, 7], [12, 6], [12, 5]] },
      { kind: 'trunk-cache', cells: [[24, 8]], affects: [[24, 7], [24, 6], [24, 5]] },
    ],
    scripted: [
      { round: 4, actions: [{ moraleAll: { side: 'enemy', delta: -15 } }, { caption: 'The column bunches between the lake and the slope.' }] },
    ],
    description: 'The Confederate slope ambush above the Ägerisee road, 15 November 1315: boulders and trunks, then the Haufen against the cramped Habsburg cavalry.',
    historical: true, note: 'LORE.md §1 and §6 Chapter 2 step 12. Chroniclers (Johannes of Winterthur) and the founding tradition describe rocks and tree trunks rolled onto the column from the Figlenfluh above, then halberds against horsemen trapped between the lake and the slope. Leopold survives (objective is rout, not kill-all), per §1.',
  },
];

export function register(c: ContentRegistry): void {
  c.addEncounters(encounters);
}
