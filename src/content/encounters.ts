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
    // Fix round 1 (wave2 critic, tools/critic/wave2-combat.md, score 5/10): issue 3. Grid axes: q = depth from
    // the lake (0 west edge = water, rising east up the slope — real geography, the Ägerisee is WEST of the
    // Sattel–Ägeri road, LORE §1/§3), r = position along the marching column (0..23). Two 2×2 Haufen blocks
    // exist at deployment (not 6-cells-apart individuals); a `letzi-wall` fences both flanks so mounted units
    // can't ride around the blocks, funnelling the column into the killing ground between them; `ambush:
    // 'player'` (honoured by `engine.ts` `start()`) starts the militia braced; Duke Leopold is a named knight
    // in the column — like every other unit he can rout and flee rather than die, which is how §1's "Leopold
    // escapes" actually resolves (the objective is `rout`, never kill-all).
    id: 'enc.morgarten', name: 'The Battle of Morgarten', location: { x: morgarten.x, z: morgarten.z, yaw: -Math.PI / 2 },
    grid: { cols: 40, rows: 24, cellM: 1.5 }, heightOverride: 'morgarten',
    ambush: 'player',
    deploy: { q: 11, r: 9, cols: 6, rows: 4 },
    units: [
      // Habsburg column, strung along the lakeside road (q=4..6), marching along r. This encounter models the
      // vanguard that actually reaches the ambush point (the historical column of several thousand is far
      // larger than any encounter can represent) — sized against the two Haufen blocks below so an AI-vs-AI
      // sample lands close to a real fight rather than a foregone one in either direction (fix round 1,
      // wave2 critic issue 2 / probe 10b; see morgarten.test.ts for the sampler).
      { archetype: 'habsburg-knight', side: 'enemy', q: 5, r: 4, mounted: true, group: 'column' },
      { archetype: 'habsburg-knight', side: 'enemy', q: 5, r: 10, mounted: true, group: 'column', name: 'Duke Leopold' },
      { archetype: 'habsburg-footman', side: 'enemy', q: 6, r: 6, group: 'column' },
      { archetype: 'habsburg-footman', side: 'enemy', q: 6, r: 12, group: 'column' },
      { archetype: 'habsburg-footman', side: 'enemy', q: 6, r: 18, group: 'column' },
      { archetype: 'habsburg-crossbowman', side: 'enemy', q: 4, r: 0, group: 'column' },
      { archetype: 'habsburg-crossbowman', side: 'enemy', q: 4, r: 23, group: 'column' },
      // Confederate slope line: two 2×2 Haufen blocks (halberd front rank, spear rear rank) already formed at
      // deployment, sitting just above the road behind the letzi-fenced killing ground (wave2 critic issue 3
      // asks for exactly this shape — kept at 2×2 rather than padded out for win-rate tuning; see
      // morgarten.test.ts for how the rest of the balance pass was done instead).
      { archetype: 'militia-halberd', side: 'player', q: 9, r: 5, group: 'haufen-a' },
      { archetype: 'militia-halberd', side: 'player', q: 10, r: 5, group: 'haufen-a' },
      { archetype: 'militia-spear', side: 'player', q: 9, r: 6, group: 'haufen-a' },
      { archetype: 'militia-spear', side: 'player', q: 10, r: 6, group: 'haufen-a' },
      { archetype: 'militia-halberd', side: 'player', q: 9, r: 15, group: 'haufen-b' },
      { archetype: 'militia-halberd', side: 'player', q: 10, r: 15, group: 'haufen-b' },
      { archetype: 'militia-spear', side: 'player', q: 9, r: 16, group: 'haufen-b' },
      { archetype: 'militia-spear', side: 'player', q: 10, r: 16, group: 'haufen-b' },
    ],
    objectives: [
      { type: 'survive', turns: 3 },
      { type: 'hold-cells', cells: [[9, 5], [10, 5], [9, 6], [10, 6], [9, 15], [10, 15], [9, 16], [10, 16]], turns: 3 },
      { type: 'trigger-features', kind: 'boulder-cache', count: 2 },
      { type: 'rout' },
    ],
    loseObjectives: [{ type: 'protect', npc: 'player' }],
    terrainFeatures: [
      // Fix round 1 (wave2 critic issue 5 — "trunk-cache usable"): every cache sits directly on one of the
      // four cells a Haufen unit already occupies at deployment, so the militia's own `waldstaetteAct` AI can
      // fire it without needing a bespoke "go stand on the feature" pathing step (it already checks the cell
      // it's standing on for a ready cache) — two boulder-caches (satisfying the `trigger-features count:2`
      // objective) and two trunk-caches, each aimed at the column element nearest that block.
      { kind: 'boulder-cache', cells: [[9, 5]], affects: [[7, 4], [6, 4], [5, 4]] },
      { kind: 'trunk-cache', cells: [[10, 5]], affects: [[7, 6], [6, 6], [5, 6]] },
      { kind: 'boulder-cache', cells: [[9, 15]], affects: [[7, 18], [6, 18], [5, 18]] },
      { kind: 'trunk-cache', cells: [[10, 15]], affects: [[6, 23], [5, 23], [4, 23]] },
      // The letzi wall (LORE §1: the Sattel letzi blocked cavalry) fences both flanks beyond the two Haufen
      // blocks — mounted units cannot cross it (path.ts), funnelling the column into the r=3..20 killing
      // ground between the lake-road and the slope instead of riding around the blocks.
      { kind: 'letzi-wall', cells: [[8, 0], [8, 1], [8, 2], [8, 21], [8, 22], [8, 23]] },
    ],
    scripted: [
      { round: 4, actions: [{ moraleAll: { side: 'enemy', delta: -15 } }, { caption: 'The column bunches between the lake and the slope.' }] },
      { round: 10, actions: [{ caption: 'Duke Leopold wheels his banner back toward Zug — by every chronicle, the Duke himself must escape the field.' }] },
    ],
    description: 'The Confederate slope ambush above the Ägerisee road, 15 November 1315: boulders and trunks, then the Haufen against the cramped Habsburg cavalry.',
    historical: true, note: 'LORE.md §1 and §6 Chapter 2 step 12. Chroniclers (Johannes of Winterthur) and the founding tradition describe rocks and tree trunks rolled onto the column from the Figlenfluh above, then halberds against horsemen trapped between the lake and the slope. Leopold survives (objective is rout, not kill-all), per §1 — mechanically he is a named knight who can rout and flee just like the rest of the column, never scripted to die.',
  },
];

export function register(c: ContentRegistry): void {
  c.addEncounters(encounters);
}
