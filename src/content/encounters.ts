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
    id: 'enc.habsburg-patrol',
    name: 'A Habsburg road patrol',
    location: { x: 0, z: 0 },
    grid: { cols: 18, rows: 18 },
    deploy: { q: 2, r: 12, cols: 6, rows: 4 },
    units: [
      { archetype: 'habsburg-sergeant', side: 'enemy', q: 9, r: 3, group: 'patrol' },
      { archetype: 'habsburg-footman', side: 'enemy', q: 7, r: 3, group: 'patrol' },
      { archetype: 'habsburg-footman', side: 'enemy', q: 11, r: 3, group: 'patrol' },
    ],
    objectives: [{ type: 'rout' }],
    heightOverride: 'flat',
    historical: 'invented',
    note: 'A roving bailiff\'s patrol on the Küssnacht, Arth or Gotthard road; started by exploration when the party is hostile to the Habsburgs, with the location overridden to the player\'s position.',
    description: 'Three of the Vogt\'s men block the road and demand to know your business.',
  },
  {
    id: 'enc.brunnen-quay', name: 'The Brunnen Quay', location: { x: brunnen.x, z: brunnen.z, yaw: 0.3 },
    grid: { cols: 16, rows: 16, cellM: 1.5 }, heightOverride: 'quay',
    // Round-3 minor (wave2-combat.md issue 5: grid water sits opposite the real lake — the `quay` preset puts
    // water at low r, but low r maps through yaw 0.3 to world NNE, the land side; the real lake is SSW, high
    // r). The preset itself is shared geometry, so the fix here mirrors placements/deploy in r (r' = 15 - r):
    // the boat party starts high-r (lake/SSW side, disembarking) with the toll party inland of them. The q
    // axis is already correct (party west/lake-side, toll men east/inland) and the preset is q-invariant, so
    // q is untouched.
    deploy: { q: 2, r: 10, cols: 3, rows: 3 },
    units: [
      { archetype: 'toll-collector', side: 'enemy', q: 11, r: 7 },
      { archetype: 'habsburg-footman', side: 'enemy', q: 12, r: 6 },
      { archetype: 'saeumer', side: 'player', q: 3, r: 8, group: 'escort', name: 'Säumer of the boat' },
      { archetype: 'herder', side: 'player', q: 3, r: 6, group: 'escort', name: 'The elder\'s man' },
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
      { archetype: 'militia-spear', side: 'player', q: 3, r: 3, count: 2, group: 'uri-men' },
      { archetype: 'herder', side: 'player', q: 3, r: 5, group: 'uri-men' },
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
      { archetype: 'militia-halberd', side: 'player', q: 3, r: 5, count: 2, group: 'uri-men' },
      { archetype: 'militia-spear', side: 'player', q: 3, r: 7, group: 'uri-men' },
      { archetype: 'herder', side: 'player', q: 2, r: 6, group: 'uri-men' },
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
      { archetype: 'militia-halberd', side: 'player', q: 2, r: 4, group: 'schwyz-men' },
      { archetype: 'militia-spear', side: 'player', q: 2, r: 6, count: 2, group: 'schwyz-men' },
      { archetype: 'saeumer', side: 'player', q: 3, r: 8, group: 'schwyz-men' },
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
      // Habsburg column, arriving in three waves along the lakeside road (q=4..6, marching along r) instead
      // of all ~16 men being in play from round 1 (fix round 2, wave2 critic issue 2/(b): a 7-unit "patrol"
      // on a 24-cell road didn't read as Leopold's column, and everything arriving at once made every extra
      // unit make the AI-vs-AI ratio worse, not more historical). The vanguard below is what's actually on
      // the board at the ambush; `scripted` below spawns the second wave on round 2 and the third on round 4
      // (with the existing "column bunches" caption/morale hit) so the caches and the Haufen's hold-vs-chase
      // decision have something arriving to react to across several rounds, the way a real column would.
      // One knight sits at q=4, the road's own lake edge, precisely so a Shove/Push-of-Pike from the block can
      // put him in the water (critic (b): "knights on it").
      { archetype: 'habsburg-knight', side: 'enemy', q: 4, r: 5, mounted: true, group: 'vanguard' },
      { archetype: 'habsburg-knight', side: 'enemy', q: 5, r: 15, mounted: true, group: 'vanguard' },
      { archetype: 'habsburg-footman', side: 'enemy', q: 6, r: 6, group: 'vanguard' },
      { archetype: 'habsburg-footman', side: 'enemy', q: 6, r: 16, group: 'vanguard' },
      { archetype: 'habsburg-crossbowman', side: 'enemy', q: 4, r: 8, group: 'vanguard' },
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
      // Fix round 2 issue (b): `threshold` existed on the schema but was never read — a bare `rout` silently
      // demanded every last straggler dead or routed, so the fight never ended even after the column broke.
      // 60% dead/down/routed lets Leopold and a rump "escape" (LORE §1) the moment the column actually breaks.
      { type: 'rout', threshold: 0.6 },
    ],
    loseObjectives: [{ type: 'protect', npc: 'player' }],
    terrainFeatures: [
      // Fix round 1 (wave2 critic issue 5 — "trunk-cache usable"): every cache sits directly on one of the
      // four cells a Haufen unit already occupies at deployment, so the militia's own `waldstaetteAct` AI can
      // fire it without needing a bespoke "go stand on the feature" pathing step (it already checks the cell
      // it's standing on for a ready cache) — two boulder-caches (satisfying the `trigger-features count:2`
      // objective) and two trunk-caches, each aimed at the column element nearest that block.
      { kind: 'boulder-cache', cells: [[9, 5]], affects: [[6, 5], [5, 5], [4, 5]] },
      { kind: 'trunk-cache', cells: [[10, 5]], affects: [[7, 6], [6, 6], [5, 6]] },
      { kind: 'boulder-cache', cells: [[9, 15]], affects: [[7, 15], [6, 15], [5, 15]] },
      { kind: 'trunk-cache', cells: [[10, 15]], affects: [[7, 16], [6, 16], [5, 16]] },
      // Fix round 2 issue (b) "third cache": up-column, roughly equidistant between the two Haufen blocks —
      // reaching it means a unit leaving its block's adjacency (and the formation Defense bonus that comes
      // with it), the "hold vs. chase" tension the design asks for, rather than every cache sitting free on
      // a cell the block already occupies.
      { kind: 'boulder-cache', cells: [[10, 11]], affects: [[6, 11], [5, 11], [4, 11]] },
      // Balance pass, 4th cache: sits on one of the Schwyz relief column's own arrival cells (round 3 below),
      // so they can fire it the moment they arrive rather than needing a separate approach turn.
      { kind: 'trunk-cache', cells: [[13, 9]], affects: [[6, 9], [5, 9], [4, 9]] },
      // The letzi wall (LORE §1: the Sattel letzi blocked cavalry) fences both flanks beyond the two Haufen
      // blocks — mounted units cannot cross it (path.ts), funnelling the column into the r=3..20 killing
      // ground between the lake-road and the slope instead of riding around the blocks.
      { kind: 'letzi-wall', cells: [[8, 0], [8, 1], [8, 2], [8, 21], [8, 22], [8, 23]] },
    ],
    scripted: [
      // Second wave (fix round 2 issue (b)): Leopold himself, with the sergeant riding as his banner-man
      // (same `group` — the sergeant's archetype already counts as a morale "leader" in `applyDamage`, so his
      // going down is a shock to the whole column, and losing Leopold specifically is doubly so).
      // Split north/south (rather than all piling in behind the vanguard's northern half) so both Haufen
      // blocks face a comparable share of the 16-unit column over the course of the fight, matching the
      // vanguard's own north/south balance instead of leaving haufen-b (r=15-16) essentially unopposed while
      // haufen-a (r=5-6) alone faces the whole reinforced column (an early rebalance pass that put all of
      // waves 2-3 at r=0-2 made every AI-vs-AI sample a fast, lopsided loss \u2014 see morgarten.test.ts).
      { round: 2, actions: [
        { caption: 'More riders come down the col road \u2014 the Duke\'s own company from the north, more men-at-arms from the south.' },
        { spawn: { archetype: 'habsburg-knight', side: 'enemy', q: 4, r: 1, mounted: true, group: 'command', name: 'Duke Leopold' } },
        { spawn: { archetype: 'habsburg-sergeant', side: 'enemy', q: 5, r: 1, group: 'command' } },
        { spawn: { archetype: 'habsburg-knight', side: 'enemy', q: 4, r: 0, mounted: true, group: 'command' } },
        { spawn: { archetype: 'habsburg-footman', side: 'enemy', q: 6, r: 0, group: 'command' } },
        { spawn: { archetype: 'habsburg-squire', side: 'enemy', q: 5, r: 0, group: 'command' } },
        { spawn: { archetype: 'habsburg-knight', side: 'enemy', q: 4, r: 23, mounted: true, group: 'rearguard' } },
        { spawn: { archetype: 'habsburg-footman', side: 'enemy', q: 6, r: 23, group: 'rearguard' } },
        { spawn: { archetype: 'habsburg-squire', side: 'enemy', q: 5, r: 23, group: 'rearguard' } },
      ] },
      // Balance pass: the Schwyz main body (LORE ~1500 Confederates total — the two Haufen blocks alone were
      // a token squad, not remotely that). Arrives round 3, descending from the slope top through the same
      // gap corridor as the third cache, and can reinforce either block or press onto the road once the
      // cavalry breaks.
      { round: 3, actions: [
        { caption: 'The men of Schwyz come down from the Sattel.' },
        { spawn: { archetype: 'militia-halberd', side: 'player', q: 13, r: 9, group: 'schwyz' } },
        { spawn: { archetype: 'militia-halberd', side: 'player', q: 14, r: 9, group: 'schwyz' } },
        { spawn: { archetype: 'militia-halberd', side: 'player', q: 13, r: 10, group: 'schwyz' } },
        { spawn: { archetype: 'militia-halberd', side: 'player', q: 14, r: 10, group: 'schwyz' } },
        { spawn: { archetype: 'militia-halberd', side: 'player', q: 13, r: 11, group: 'schwyz' } },
        { spawn: { archetype: 'militia-halberd', side: 'player', q: 14, r: 11, group: 'schwyz' } },
      ] },
      // Third wave (existing caption/morale hit, unchanged): the tail of the column piles into the ambush.
      { round: 4, actions: [
        { moraleAll: { side: 'enemy', delta: -15 } },
        { caption: 'The column bunches between the lake and the slope.' },
        { spawn: { archetype: 'habsburg-footman', side: 'enemy', q: 4, r: 0, group: 'command' } },
        { spawn: { archetype: 'habsburg-footman', side: 'enemy', q: 6, r: 22, group: 'rearguard' } },
        { spawn: { archetype: 'habsburg-crossbowman', side: 'enemy', q: 5, r: 22, group: 'rearguard' } },
      ] },
      { round: 10, actions: [{ caption: 'Duke Leopold wheels his banner back toward Zug \u2014 by every chronicle, the Duke himself must escape the field.' }] },
    ],
    description: 'The Confederate slope ambush above the Ägerisee road, 15 November 1315: boulders and trunks, then the Haufen against the cramped Habsburg cavalry.',
    historical: true, note: 'LORE.md §1 and §6 Chapter 2 step 12. Chroniclers (Johannes of Winterthur) and the founding tradition describe rocks and tree trunks rolled onto the column from the Figlenfluh above, then halberds against horsemen trapped between the lake and the slope. §1\'s actual mechanism — the column, strung out on the narrow road between lake and slope, could not deploy or bring its numbers to bear — is modelled directly in the terrain (a rock chokepoint above the road, passable only at three narrow gaps) as well as the letzi and the caches. The Habsburg column arrives as a small vanguard plus two scripted reinforcement waves (round 2, round 4) rather than all ~16 men from round 1, standing in for a much larger historical column strung along the road; the Confederate side is likewise not a token squad — two Haufen blocks at deployment plus the Schwyz main body arriving round 3 (LORE ~1500 Confederates total). Leopold survives (objective is rout, not kill-all), per §1 — mechanically he is a named knight who can rout and flee just like the rest of the column, never scripted to die.',
  },
];

export function register(c: ContentRegistry): void {
  c.addEncounters(encounters);
}
