/**
 * npcs — content data owned by the exploration builder. ARCHITECTURE.md §3.3, §5.2; LORE.md §5 (the named
 * cast, exact ids) plus ~70 invented minor named NPCs (LORE.md §10 row). `historical`/`chapters` follow
 * LORE.md §5/§1 precisely: Gessler and Landenberg exist only in `ch1-1307`; Leopold I, Hünenberg and
 * Winterthur only in `ch2-1314`; Tell only in `ch1-1307` (LORE.md §5's companion-pool note); Abt Johannes
 * only from `ch1-1307` on (abbot from 1298, not yet in office in the 1291 prologue).
 *
 * Equipment/skills for every minor NPC and the generic-crowd template are cloned from `archetypes.ts` so
 * every item id is guaranteed to exist in `items.ts` (that file's own `register()` already validates it).
 * `dialogueRoot` is set on the named cast the task calls out by id, plus six side-quest-bearing minor NPCs
 * the quest builder named (requests/quest-1.md) — every other minor NPC and the generic crowd fall back to
 * `dlg.generic.<archetype>` at interaction time (`src/exploration/interact.ts`), which the quest builder
 * defines. Dialogues are a Wave-3 deliverable (`src/content/dialogues` is still a stub as of this writing),
 * so `ContentRegistry.validate()` will report every one of these as "unknown dialogue" until that content
 * lands; see `requests/exploration-1.md`. The same applies to `faction` cross-references against
 * `src/content/factions.ts` (also still a stub) — both are pre-existing Wave-3 gaps, not bugs here.
 */
import type { ContentRegistry } from '@core/content';
import type { Historicity, NpcDef, ScheduleEntry } from '@core/schemas';
import { archetypes } from './archetypes';

const archById = new Map(archetypes.map((a) => [a.id, a]));

const ALL_CHAPTERS = ['prologue-1291', 'ch1-1307', 'ch2-1314'];

/** A minor named NPC: clones an archetype's stats/skills/equipment (so items are guaranteed valid) and
 *  gives it a name, a home and a schedule. `dialogueRoot` is left unset for most (the interact system
 *  falls back to `dlg.generic.<archetype>` — see `src/exploration/interact.ts`) except the six side-quest
 *  NPCs the quest builder named explicitly (requests/quest-1.md). */
function minor(
  id: string, given: string, family: string, home: string, faction: string, archetypeId: string,
  opts: { chapters?: string[]; born?: number; schedule?: ScheduleEntry[]; description: string; historical?: Historicity; note?: string; dialogueRoot?: string },
): NpcDef {
  const a = archById.get(archetypeId);
  if (!a) throw new Error(`npcs: unknown archetype "${archetypeId}"`);
  return {
    id, name: `${given} ${family}`, faction, home, region: undefined, role: 'named', archetype: archetypeId,
    attributes: { ...a.attributes },
    skills: a.skills ? { ...a.skills } : undefined,
    equipment: a.equipment ? { ...a.equipment } : undefined,
    inventory: a.inventory ? a.inventory.map((i) => ({ ...i })) : undefined,
    modelId: a.modelId,
    dialogueRoot: opts.dialogueRoot,
    chapters: opts.chapters ?? ALL_CHAPTERS,
    born: opts.born,
    schedule: opts.schedule ?? daySchedule(),
    description: opts.description,
    historical: opts.historical ?? 'invented',
    note: opts.note ?? "Alemannic-named minor NPC populating the settlement per LORE.md §8's naming rules; see LORE.md §10.",
  };
}

/** Sleep at home overnight, work through the day, an evening turn at the tavern (villages with an
 *  innkeeper) — a plain, generically-plausible daily rhythm for a minor NPC with no bespoke schedule. */
function daySchedule(workActivity: ScheduleEntry['activity'] = 'work'): ScheduleEntry[] {
  return [
    { hour: 6, poi: 'home', activity: workActivity },
    { hour: 12, poi: 'home', activity: 'market' },
    { hour: 18, poi: 'home', activity: 'tavern' },
    { hour: 22, poi: 'home', activity: 'sleep' },
  ];
}
function guardSchedule(): ScheduleEntry[] {
  return [{ hour: 0, poi: 'home', activity: 'guard' }];
}
function monkSchedule(): ScheduleEntry[] {
  return [
    { hour: 5, poi: 'home', activity: 'church' },
    { hour: 8, poi: 'home', activity: 'work' },
    { hour: 18, poi: 'home', activity: 'church' },
    { hour: 21, poi: 'home', activity: 'sleep' },
  ];
}

// ==================================================================================================
// Historical / legendary cast — LORE.md §5, exact ids and `historical` values.
// ==================================================================================================

const historicalCast: NpcDef[] = [
  {
    id: 'npc.werner-stauffacher', name: 'Werner Stauffacher', faction: 'schwyz', home: 'poi.steinen', role: 'named',
    archetype: 'elder', born: 1250,
    attributes: { strength: 12, agility: 10, endurance: 12, wits: 15, presence: 17 },
    skills: { leadership: 45, speech: 40, spear: 25, trade: 20 },
    equipment: { mainHand: 'item.spiess', body: 'item.gambeson', head: 'item.eisenhut' },
    modelId: 'char.elder', dialogueRoot: 'dlg.werner-stauffacher',
    chapters: ALL_CHAPTERS,
    schedule: [
      { hour: 3, poi: 'poi.ruetli', activity: 'idle', offset: [4, -3] }, // the oath-gathering (LORE.md §6 Prologue step 4)
      { hour: 8, poi: 'poi.steinen', activity: 'work' },
      { hour: 11, poi: 'poi.schwyz', activity: 'market' },
      { hour: 19, poi: 'poi.steinen', activity: 'tavern' },
      { hour: 22, poi: 'poi.steinen', activity: 'sleep' },
    ],
    description: 'A prosperous Schwyz freeman, name attested in period Schwyz documents; tradition makes him the first of the three oath-swearers and, later, the Confederate commander at Morgarten.',
    historical: 'legend', note: 'The name is H (Schwyz documents); his Rütli role, house at Steinen and Morgarten command are L (Tschudi/Weisses Buch). See LORE.md §2/§5.',
  },
  {
    id: 'npc.walter-fuerst', name: 'Walter Fürst', faction: 'uri', home: 'poi.altdorf', role: 'named',
    archetype: 'elder', born: 1255,
    attributes: { strength: 11, agility: 9, endurance: 11, wits: 14, presence: 15 },
    skills: { leadership: 35, speech: 35, trade: 25 },
    equipment: { mainHand: 'item.staff' },
    modelId: 'char.elder', dialogueRoot: 'dlg.walter-fuerst',
    chapters: ALL_CHAPTERS,
    schedule: [
      { hour: 3, poi: 'poi.ruetli', activity: 'idle', offset: [-4, -2] }, // the oath-gathering (LORE.md §6 Prologue step 4)
      { hour: 8, poi: 'poi.altdorf', activity: 'work' },
      { hour: 12, poi: 'poi.altdorf', activity: 'market' },
      { hour: 20, poi: 'poi.altdorf', activity: 'sleep' },
    ],
    description: "An Uri householder at Altdorf; tradition makes him one of the three oath-swearers and a kinsman of Wilhelm Tell's.",
    historical: 'legend', note: "L throughout (Weisses Buch/Tschudi/Schiller tradition); the game keeps Tell's kinship as 'kinsman' per LORE.md §5.",
  },
  {
    id: 'npc.arnold-von-melchtal', name: 'Arnold von Melchtal', faction: 'unterwalden', home: 'poi.melchtal', role: 'named',
    archetype: 'militia-halberd', born: 1275,
    attributes: { strength: 15, agility: 12, endurance: 14, wits: 11, presence: 13 },
    skills: { halberd: 35, athletics: 25, leadership: 20 },
    equipment: { mainHand: 'item.halbarte', body: 'item.gambeson' },
    modelId: 'char.militia-halberd', dialogueRoot: 'dlg.arnold-von-melchtal',
    // LORE.md §6 Prologue step 4: the oath at the Rütli is sworn by "the three men" — Melchtal included —
    // so he (like Stauffacher and Fürst below) has to exist from `prologue-1291`, not just Chapter 1 on.
    chapters: ALL_CHAPTERS,
    schedule: [
      { hour: 3, poi: 'poi.ruetli', activity: 'idle', offset: [0, 5] }, // the oath-gathering (LORE.md §6 Prologue step 4)
      { hour: 8, poi: 'poi.melchtal', activity: 'work' },
      { hour: 13, poi: 'poi.sarnen', activity: 'market' },
      { hour: 21, poi: 'poi.melchtal', activity: 'sleep' },
    ],
    description: "A young Obwalden herdsman, his father Heinrich blinded by the bailiff's man in the tradition's telling — the third of the three oath-swearers.",
    historical: 'legend', note: 'Wholly L (Weisses Buch/Tschudi tradition); not attested before c. 1470. See LORE.md §5.',
  },
  {
    id: 'npc.wilhelm-tell', name: 'Wilhelm Tell', faction: 'uri', home: 'poi.buerglen', role: 'companion',
    archetype: 'militia-crossbow', born: 1268,
    attributes: { strength: 13, agility: 16, endurance: 13, wits: 11, presence: 12 },
    skills: { crossbow: 55, athletics: 30, stealth: 20 },
    equipment: { ranged: 'item.armbrust', ammo: 'item.bolzen', mainHand: 'item.schweizerdolch' },
    modelId: 'char.militia-crossbow', dialogueRoot: 'dlg.wilhelm-tell',
    chapters: ['ch1-1307'],
    schedule: [
      { hour: 6, poi: 'poi.buerglen', activity: 'work' },
      { hour: 12, poi: 'poi.altdorf', activity: 'market' },
      { hour: 21, poi: 'poi.buerglen', activity: 'sleep' },
    ],
    description: "Bürglen's crossbowman — the hat, the apple, and the Hohle Gasse are all his. A temporary companion in Chapter 1 only.",
    historical: 'legend', note: 'Entirely L; central to the Weisses Buch/Tschudi tradition. Chapter-1-only per LORE.md §5.',
  },
  {
    id: 'npc.hermann-gessler', name: 'Hermann Gessler', faction: 'habsburg', home: 'poi.gesslerburg', role: 'named',
    archetype: 'habsburg-sergeant', born: 1265,
    attributes: { strength: 12, agility: 11, endurance: 12, wits: 13, presence: 12 },
    skills: { sword: 35, leadership: 25, 'armor-heavy': 20 },
    equipment: { mainHand: 'item.schwert', offHand: 'item.heater-shield', body: 'item.mail-shirt', head: 'item.bascinet' },
    modelId: 'char.habsburg-sergeant', dialogueRoot: 'dlg.hermann-gessler',
    chapters: ['ch1-1307'],
    schedule: [
      { hour: 8, poi: 'poi.altdorf', activity: 'work' },
      { hour: 18, poi: 'poi.gesslerburg', activity: 'sleep' },
    ],
    description: "The Landvogt whose hat sits on the pole in Altdorf's square — Chapter 1's antagonist.",
    historical: 'legend', note: 'No Landvogt of this name is attested; entirely L tradition (Weisses Buch). Chapter-1-only per LORE.md §5.',
  },
  {
    id: 'npc.beringer-von-landenberg', name: 'Beringer von Landenberg', faction: 'habsburg', home: 'poi.landenberg', role: 'named',
    archetype: 'habsburg-sergeant', born: 1260,
    attributes: { strength: 11, agility: 9, endurance: 11, wits: 12, presence: 11 },
    skills: { sword: 25, leadership: 20, trade: 20 },
    equipment: { mainHand: 'item.schwert', body: 'item.mail-shirt', head: 'item.eisenhut' },
    modelId: 'char.habsburg-sergeant', dialogueRoot: 'dlg.beringer-von-landenberg',
    chapters: ['ch1-1307'],
    schedule: [
      { hour: 8, poi: 'poi.landenberg', activity: 'work' },
      { hour: 20, poi: 'poi.landenberg', activity: 'sleep' },
    ],
    description: "Sarnen's bailiff — antagonist of the Burgenbruch's New Year's-gift set piece.",
    historical: 'legend', note: 'L (Weisses Buch tradition); the Landenberg hill and castle are H, the bailiff is not. See LORE.md §2/§5.',
  },
  {
    id: 'npc.werner-von-attinghausen', name: 'Freiherr Werner von Attinghausen', faction: 'uri', home: 'poi.attinghausen', role: 'named',
    archetype: 'elder', born: 1245,
    attributes: { strength: 10, agility: 8, endurance: 10, wits: 16, presence: 18 },
    skills: { leadership: 50, speech: 45, trade: 25 },
    equipment: { mainHand: 'item.schwert' },
    modelId: 'char.elder', dialogueRoot: 'dlg.werner-von-attinghausen',
    chapters: ALL_CHAPTERS,
    schedule: [
      { hour: 7, poi: 'poi.attinghausen', activity: 'work' },
      { hour: 12, poi: 'poi.altdorf', activity: 'market' },
      { hour: 20, poi: 'poi.attinghausen', activity: 'sleep' },
    ],
    description: "Uri's Landammann and the moderate voice among the three Länder — the Freiherr the Prologue's message is carried to.",
    historical: true, note: 'H: Landammann of Uri c. 1294–1321. See LORE.md §5.',
  },
  {
    id: 'npc.leopold-i', name: 'Duke Leopold I of Austria', faction: 'habsburg', home: 'poi.zug', role: 'named',
    archetype: 'habsburg-knight', born: 1290,
    attributes: { strength: 14, agility: 12, endurance: 14, wits: 13, presence: 16 },
    skills: { sword: 40, leadership: 40, 'armor-heavy': 35 },
    equipment: { mainHand: 'item.lance', offHand: 'item.heater-shield', body: 'item.coat-of-plates', head: 'item.bascinet' },
    modelId: 'char.habsburg-knight', dialogueRoot: 'dlg.leopold-i',
    chapters: ['ch2-1314'],
    schedule: [{ hour: 0, poi: 'poi.zug', activity: 'work' }],
    description: 'Commander of the column that marches on Schwyz — seen only at a distance and as Morgarten\'s objective.',
    historical: true, note: 'H: Leopold I commanded the Habsburg force at Morgarten. Chapter-2-only per LORE.md §1/§5.',
  },
  {
    id: 'npc.abt-johannes', name: 'Abbot Johannes von Schwanden', faction: 'einsiedeln', home: 'poi.einsiedeln', role: 'named',
    archetype: 'monk', born: 1255,
    attributes: { strength: 9, agility: 8, endurance: 10, wits: 15, presence: 15 },
    skills: { leadership: 30, speech: 30, herbalism: 20 },
    equipment: { mainHand: 'item.staff' },
    modelId: 'char.monk', dialogueRoot: 'dlg.abt-johannes',
    chapters: ['ch1-1307', 'ch2-1314'],
    schedule: monkSchedule(),
    description: "Einsiedeln's abbot, negotiator and antagonist of the Marchenstreit raid.",
    historical: true, note: 'H: Abbot of Einsiedeln 1298–1327 — not yet in office during the 1291 prologue, hence chapters ch1/ch2 only. See LORE.md §5.',
  },
  {
    id: 'npc.konrad-ab-yberg', name: 'Konrad Ab Yberg', faction: 'schwyz', home: 'poi.schwyz', role: 'named',
    archetype: 'elder', born: 1258,
    attributes: { strength: 11, agility: 9, endurance: 11, wits: 13, presence: 15 },
    skills: { leadership: 35, speech: 30 },
    equipment: { mainHand: 'item.staff' },
    modelId: 'char.elder', dialogueRoot: 'dlg.konrad-ab-yberg',
    chapters: ALL_CHAPTERS,
    schedule: daySchedule(),
    description: "A Schwyz Landsgemeinde voice and hawk on the March dispute — pushes for the Einsiedeln raid.",
    historical: 'legend', note: 'The Ab Yberg family is H in Schwyz politics; this individual and his Marchenstreit role are I. See LORE.md §5.',
  },
  {
    id: 'npc.heinrich-von-hunenberg', name: 'Heinrich von Hünenberg', faction: 'habsburg', home: 'poi.zug', role: 'named',
    archetype: 'habsburg-squire', born: 1285,
    attributes: { strength: 12, agility: 12, endurance: 12, wits: 11, presence: 11 },
    skills: { sword: 25, throwing: 20 },
    equipment: { mainHand: 'item.schwert', offHand: 'item.buckler' },
    modelId: 'char.habsburg-squire', dialogueRoot: 'dlg.heinrich-von-hunenberg',
    chapters: ['ch2-1314'],
    schedule: [{ hour: 0, poi: 'poi.zug', activity: 'work' }],
    description: 'A Zug-district knight whose warning arrow into Schwyz — "Hütet euch am Morgarten" — tradition credits with the ambush\'s intelligence.',
    historical: 'legend', note: "L tradition; the family name is a real Zug-district ministerial one, the warning-arrow episode is not attested contemporaneously. Chapter-2-only per LORE.md §5.",
  },
  {
    id: 'npc.johannes-von-winterthur', name: 'Johannes of Winterthur', faction: 'none', home: 'poi.zug', role: 'named',
    archetype: 'child', born: 1300,
    attributes: { strength: 8, agility: 10, endurance: 9, wits: 15, presence: 10 },
    skills: { speech: 15 },
    equipment: {},
    modelId: 'char.child', dialogueRoot: 'dlg.johannes-von-winterthur',
    chapters: ['ch2-1314'],
    schedule: [{ hour: 0, poi: 'poi.zug', activity: 'idle' }],
    description: 'A boy of about fourteen in his father\'s retinue on the Austrian side — a cameo the journal notes belongs to the future chronicler of Morgarten.',
    historical: true, note: "H: Johannes of Winterthur's father served on the Austrian side at Morgarten; the chronicler wrote his account in the 1340s. Cameo, chapter-2-only. See LORE.md §5.",
  },
];

// ==================================================================================================
// Invented (I) core cast — companions and antagonist lieutenants. LORE.md §5.
// ==================================================================================================

const inventedCore: NpcDef[] = [
  {
    id: 'npc.jost-imhof', name: 'Jost Imhof', faction: 'uri', home: 'poi.fluelen', role: 'companion',
    archetype: 'saeumer', born: 1276,
    attributes: { strength: 13, agility: 12, endurance: 14, wits: 11, presence: 11 },
    skills: { spear: 30, crossbow: 25, alpine: 35, athletics: 25 },
    equipment: { mainHand: 'item.spiess', ranged: 'item.armbrust', ammo: 'item.bolzen', body: 'item.gambeson', feet: 'item.hobnailed-boots' },
    modelId: 'char.saeumer', dialogueRoot: 'dlg.jost-imhof',
    chapters: ALL_CHAPTERS,
    schedule: [
      { hour: 5, poi: 'poi.fluelen', activity: 'work' },
      { hour: 14, poi: 'poi.altdorf', activity: 'market' },
      { hour: 21, poi: 'poi.fluelen', activity: 'tavern' },
      { hour: 23, poi: 'poi.fluelen', activity: 'sleep' },
    ],
    description: 'A Gotthard muleteer out of Flüelen, spear and crossbow both, who knows every switchback of the pass road.',
    historical: 'invented', note: 'Companion pool; the Säumergenossenschaft cooperatives he belongs to are H (LORE.md §2), the man is I.',
  },
  {
    id: 'npc.mechthild-schorno', name: 'Mechthild Schorno', faction: 'schwyz', home: 'poi.steinen', role: 'companion',
    archetype: 'monk', born: 1280,
    attributes: { strength: 10, agility: 12, endurance: 12, wits: 14, presence: 12 },
    skills: { herbalism: 40, dagger: 20, speech: 15 },
    equipment: { mainHand: 'item.schweizerdolch' },
    modelId: 'char.woman-peasant', dialogueRoot: 'dlg.mechthild-schorno',
    chapters: ALL_CHAPTERS,
    schedule: [
      { hour: 6, poi: 'poi.steinen', activity: 'work' },
      { hour: 13, poi: 'poi.schwyz', activity: 'market' },
      { hour: 21, poi: 'poi.steinen', activity: 'sleep' },
    ],
    description: "A Landsgemeinde daughter of Schwyz turned herb-healer — the party's field medic.",
    historical: 'invented', note: 'Companion pool (LORE.md §5); herbalism as period household medicine is H.',
  },
  {
    id: 'npc.heini-odermatt', name: 'Heini Odermatt', faction: 'unterwalden', home: 'poi.stans', role: 'companion',
    archetype: 'militia-halberd', born: 1279,
    attributes: { strength: 17, agility: 9, endurance: 16, wits: 8, presence: 9 },
    skills: { halberd: 35, athletics: 20 },
    equipment: { mainHand: 'item.halbarte', body: 'item.gambeson', head: 'item.eisenhut' },
    modelId: 'char.militia-halberd', dialogueRoot: 'dlg.heini-odermatt',
    chapters: ALL_CHAPTERS,
    schedule: [
      { hour: 6, poi: 'poi.stans', activity: 'work' },
      { hour: 19, poi: 'poi.stans', activity: 'tavern' },
      { hour: 22, poi: 'poi.stans', activity: 'sleep' },
    ],
    description: 'A huge Nidwalden herder built like a barn door, halberd over one shoulder — the party\'s teaching case for the morale system, prone to rout unless rallied.',
    historical: 'invented', note: 'Companion pool (LORE.md §5); low presence is a deliberate mechanical hook for teaching Rally.',
  },
  {
    id: 'npc.bruder-anselm', name: 'Bruder Anselm', faction: 'unterwalden', home: 'poi.engelberg', role: 'companion',
    archetype: 'monk', born: 1282,
    attributes: { strength: 9, agility: 10, endurance: 10, wits: 15, presence: 13 },
    skills: { speech: 35, trade: 30, herbalism: 15 },
    equipment: { mainHand: 'item.staff' },
    modelId: 'char.monk', dialogueRoot: 'dlg.bruder-anselm',
    chapters: ALL_CHAPTERS,
    schedule: monkSchedule(),
    description: 'A literate lay brother out of Engelberg abbey, torn between the abbey life and the road — conflicted when the party raids Einsiedeln.',
    historical: 'invented', note: 'Companion pool (LORE.md §5); Engelberg abbey (Benedictine) is H, the man is I. Faction simplified to `unterwalden` — no distinct Engelberg faction id exists yet.',
  },
  {
    id: 'npc.ueli-zgraggen', name: 'Ueli Zgraggen', faction: 'none', home: 'poi.altdorf', role: 'companion',
    archetype: 'habsburg-squire', born: 1281,
    attributes: { strength: 13, agility: 12, endurance: 13, wits: 10, presence: 10 },
    skills: { sword: 30, shield: 25, 'armor-heavy': 20 },
    equipment: { mainHand: 'item.schwert', offHand: 'item.heater-shield', body: 'item.gambeson', head: 'item.leather-cap' },
    modelId: 'char.habsburg-squire', dialogueRoot: 'dlg.ueli-zgraggen',
    chapters: ALL_CHAPTERS,
    schedule: [
      { hour: 7, poi: 'poi.altdorf', activity: 'work' },
      { hour: 19, poi: 'poi.altdorf', activity: 'tavern' },
      { hour: 22, poi: 'poi.altdorf', activity: 'sleep' },
    ],
    description: "A deserter from a Habsburg garrison who knows knightly tactics from the other side of the shield wall — his standing with Habsburg matters.",
    historical: 'invented', note: 'Companion pool (LORE.md §5); faction set to `none` (deserted, no longer Habsburg\'s man).',
  },
  {
    id: 'npc.ritter-eberhard-von-mulinen', name: 'Ritter Eberhard von Mülinen', faction: 'habsburg', home: 'poi.zug', role: 'named',
    archetype: 'habsburg-knight', born: 1278,
    attributes: { strength: 15, agility: 12, endurance: 14, wits: 11, presence: 13 },
    skills: { spear: 35, sword: 30, shield: 25, 'armor-heavy': 30 },
    equipment: { mainHand: 'item.lance', offHand: 'item.heater-shield', body: 'item.coat-of-plates', head: 'item.bascinet' },
    modelId: 'char.habsburg-knight', dialogueRoot: 'dlg.ritter-eberhard-von-mulinen',
    chapters: ['ch2-1314'],
    schedule: [{ hour: 0, poi: 'poi.zug', activity: 'guard' }],
    description: 'An Aargau knight of Leopold\'s column, riding in the front rank toward Morgarten.',
    historical: 'invented', note: 'Antagonist lieutenant (LORE.md §5/§10); Mülinen is a real Aargau ministerial family, the individual is I.',
  },
  {
    id: 'npc.vogt-schreiber-ludwig', name: 'Vogt-Schreiber Ludwig', faction: 'habsburg', home: 'poi.altdorf', role: 'named',
    archetype: 'toll-collector', born: 1270,
    attributes: { strength: 9, agility: 9, endurance: 9, wits: 13, presence: 10 },
    skills: { trade: 35, speech: 20 },
    equipment: { mainHand: 'item.messer' },
    modelId: 'char.toll-collector', dialogueRoot: 'dlg.vogt-schreiber-ludwig',
    chapters: ['ch1-1307'],
    schedule: daySchedule('work'),
    description: "Gessler's clerk, the man who actually runs Altdorf's tolls and keeps the accounts of who has and hasn't bowed to the hat.",
    historical: 'invented', note: 'Antagonist lieutenant (LORE.md §5/§10); wholly I.',
  },
];

// ==================================================================================================
// Minor named cast (I) — LORE.md §10 register row. Alemannic given/family names per LORE.md §8;
// equipment/skills cloned from the matching archetype (guaranteed-valid item ids).
// ==================================================================================================

const minorCast: NpcDef[] = [
  // ---- Altdorf ----
  minor('npc.kuoni-gisler', 'Kuoni', 'Gisler', 'poi.altdorf', 'uri', 'innkeeper', { description: 'Keeper of the Altdorf tavern by the square, first to hear every rumour off the Gotthard road.' }),
  minor('npc.trudi-aschwanden', 'Trudi', 'Aschwanden', 'poi.altdorf', 'uri', 'woman-peasant', { description: "A weaver's wife of Altdorf, running her household's dairying and spinning." }),
  minor('npc.hans-zumbrunnen', 'Hans', 'Zumbrunnen', 'poi.altdorf', 'uri', 'merchant', { description: 'A cloth trader working the Gotthard road, sharp about a Pfennig price.' }),
  minor('npc.peter-bühler', 'Peter', 'Bühler', 'poi.altdorf', 'uri', 'militia-spear', { schedule: guardSchedule(), description: "One of Altdorf's own levy, spear and Eisenhut, called up for the square when trouble is close." }),
  minor('npc.elsi-lussi', 'Elsi', 'Lussi', 'poi.altdorf', 'uri', 'child', { description: 'An Altdorf child, present for colour and dialogue only.' }),
  minor('npc.burkhard-wyrsch', 'Burkhard', 'Wyrsch', 'poi.altdorf', 'uri', 'elder', { description: "An Altdorf Landsgemeinde man, grey-haired and still heard.", dialogueRoot: 'dlg.schuetzenkoenig-entry' }),
  // ---- Bürglen ----
  minor('npc.ruodi-imhof', 'Ruodi', 'Imhof', 'poi.buerglen', 'uri', 'herder', { description: "A Bürglen herder driving cattle up the Schächental alps every summer." }),
  minor('npc.verena-gisler', 'Verena', 'Gisler', 'poi.buerglen', 'uri', 'woman-peasant', { description: "Bürglen's midwife and herbwife, known to half the Reusstal." }),
  minor('npc.jakob-arnold', 'Jakob', 'Arnold', 'poi.buerglen', 'uri', 'monk', { schedule: monkSchedule(), description: "Bürglen's parish priest, keeper of the small church register." }),
  // ---- Flüelen ----
  minor('npc.werni-furrer', 'Werni', 'Furrer', 'poi.fluelen', 'uri', 'boatman', { description: 'A Flüelen ferryman, first to row news up from the south end of the lake.' }),
  minor('npc.gret-steiner', 'Gret', 'Steiner', 'poi.fluelen', 'uri', 'fisher', { description: 'A fisherwoman working the Flüelen shallows before the Säumer boats crowd the quay.' }),
  minor('npc.konrad-huber', 'Konrad', 'Huber', 'poi.fluelen', 'habsburg', 'toll-collector', { description: "Runs the boat toll at Flüelen for the bailiff's account." }),
  // ---- Attinghausen ----
  minor('npc.ueli-baumann', 'Ueli', 'Baumann', 'poi.attinghausen', 'uri', 'militia-spear', { schedule: guardSchedule(), description: "One of the Freiherr's household men-at-arms at Attinghausen." }),
  minor('npc.anna-waser', 'Anna', 'Waser', 'poi.attinghausen', 'uri', 'woman-peasant', { description: "A household servant of the Attinghausen castle kitchens." }),
  // ---- Erstfeld / Silenen / Amsteg (Säumer road) ----
  minor('npc.toni-zurfluh', 'Toni', 'Zurfluh', 'poi.erstfeld', 'saeumer', 'saeumer', { description: 'A Gotthard muleteer resting his train at Erstfeld before the climb.' }),
  minor('npc.sepp-infanger', 'Sepp', 'Infanger', 'poi.silenen', 'saeumer', 'saeumer', { description: "A Säumer cooperative man out of Silenen, salt sacks on his mules." }),
  minor('npc.niklaus-planzer', 'Niklaus', 'Planzer', 'poi.amsteg', 'saeumer', 'saeumer', { description: 'An Amsteg muleteer, the last easy stop before the Schöllenen.', dialogueRoot: 'dlg.saeumer-escort' }),
  // ---- Andermatt / Gotthard ----
  minor('npc.balz-truttmann', 'Balz', 'Truttmann', 'poi.andermatt', 'uri', 'herder', { description: 'An Ursern herder, sure-footed on the high Gotthard meadows.' }),
  minor('npc.bruder-gion', 'Bruder', 'Gion', 'poi.gotthard', 'einsiedeln', 'monk', { schedule: monkSchedule(), description: 'A hospice brother keeping the fire lit for travellers crossing the pass.' }),
  // ---- Schwyz ----
  minor('npc.ruodi-kälin', 'Ruodi', 'Kälin', 'poi.schwyz', 'schwyz', 'innkeeper', { description: "Keeper of the Schwyz tavern, where the Landsgemeinde men argue after the meadow disperses." }),
  minor('npc.mechthild-betschart', 'Mechthild', 'Betschart', 'poi.schwyz', 'schwyz', 'woman-peasant', { description: 'A Schwyz farmwife running her household\'s dairy trade.' }),
  minor('npc.jost-reichmuth', 'Jost', 'Reichmuth', 'poi.schwyz', 'schwyz', 'merchant', { description: 'A Schwyz cattle-trader, well known from Arth to Brunnen.' }),
  minor('npc.heini-camenzind', 'Heini', 'Camenzind', 'poi.schwyz', 'schwyz', 'militia-halberd', { schedule: guardSchedule(), description: "One of Schwyz's own halberd levy." }),
  minor('npc.bertha-bissig', 'Bertha', 'Bissig', 'poi.schwyz', 'schwyz', 'elder', { description: 'A respected Schwyz Landsgemeinde voice.' }),
  minor('npc.jakob-businger', 'Jakob', 'Businger', 'poi.schwyz', 'schwyz', 'monk', { schedule: monkSchedule(), description: "Schwyz's parish priest." }),
  // ---- Steinen ----
  minor('npc.rudi-christen', 'Rudi', 'Christen', 'poi.steinen', 'schwyz', 'herder', { description: "A Steinen herder working the slopes above the Stauffacher house." }),
  minor('npc.adelheid-durrer', 'Adelheid', 'Durrer', 'poi.steinen', 'schwyz', 'woman-peasant', { description: 'A Steinen farmwife, neighbour to the Stauffachers.' }),
  minor('npc.hans-frunz', 'Hans', 'Frunz', 'poi.steinen', 'schwyz', 'peasant', { description: 'A Steinen field-worker.' }),
  // ---- Brunnen ----
  minor('npc.uli-halter', 'Uli', 'Halter', 'poi.brunnen', 'schwyz', 'boatman', { description: 'A Brunnen ferryman working the crossing to Flüelen and Treib.' }),
  minor('npc.margret-krummenacher', 'Margret', 'Krummenacher', 'poi.brunnen', 'schwyz', 'fisher', { description: 'A Brunnen fisherwoman, up before dawn to beat the boat traffic.' }),
  minor('npc.konrad-niederberger', 'Konrad', 'Niederberger', 'poi.brunnen', 'habsburg', 'toll-collector', { description: 'Runs the road toll where the Schwyz road meets the Brunnen quay.' }),
  minor('npc.werni-omlin', 'Werni', 'Omlin', 'poi.brunnen', 'habsburg', 'habsburg-footman', { schedule: guardSchedule(), description: "One of the toll party's footmen at the Brunnen quay." }),
  // ---- Muotathal / Lauerz / Sattel / Arth ----
  minor('npc.gion-rohrer', 'Gion', 'Rohrer', 'poi.muotathal', 'schwyz', 'herder', { description: 'A Muotathal herder working the slopes toward the closed Pragel.' }),
  minor('npc.trudi-wallimann', 'Trudi', 'Wallimann', 'poi.lauerz', 'schwyz', 'fisher', { description: 'A Lauerzersee fisherwoman.' }),
  minor('npc.melchior-arnold', 'Melchior', 'Arnold', 'poi.sattel', 'schwyz', 'peasant', { description: 'A Sattel farmer whose fields run down toward the Morgarten road.', dialogueRoot: 'dlg.alpstreit-dispute' }),
  minor('npc.barbara-schmid', 'Barbara', 'Schmid', 'poi.arth', 'schwyz', 'merchant', { description: 'An Arth trader at the road junction where Schwyz, Zug and Küssnacht routes meet.' }),
  // ---- Küssnacht / Gesslerburg ----
  minor('npc.hans-müller', 'Hans', 'Müller', 'poi.kuessnacht', 'habsburg', 'peasant', { description: 'A Küssnacht villager under Habsburg administration.' }),
  minor('npc.ita-weber', 'Ita', 'Weber', 'poi.kuessnacht', 'habsburg', 'innkeeper', { description: "Keeper of Küssnacht's roadside inn on the way to Luzern." }),
  minor('npc.rudolf-meier', 'Rudolf', 'Meier', 'poi.gesslerburg', 'habsburg', 'habsburg-footman', { schedule: guardSchedule(), description: 'A footman garrisoning Gesslerburg.' }),
  minor('npc.anton-fischer', 'Anton', 'Fischer', 'poi.gesslerburg', 'habsburg', 'habsburg-crossbowman', { schedule: guardSchedule(), description: 'A crossbowman drilled to hold the Gesslerburg gate.' }),
  // ---- Zwing Uri ----
  minor('npc.jost-wyrsch', 'Jost', 'Wyrsch', 'poi.zwing-uri', 'habsburg', 'habsburg-footman', { schedule: guardSchedule(), description: 'A footman set to guard the half-built Zwing Uri.' }),
  // ---- Rotzberg / Landenberg ----
  minor('npc.ueli-durrer', 'Ueli', 'Durrer', 'poi.rotzberg', 'habsburg', 'habsburg-footman', { schedule: guardSchedule(), description: "Rotzberg's watch, thinner than the castle would like." }),
  minor('npc.hans-omlin', 'Hans', 'Omlin', 'poi.landenberg', 'habsburg', 'habsburg-sergeant', { schedule: guardSchedule(), description: "Landenberg's sergeant of the watch." }),
  // ---- Sarnen ----
  minor('npc.peter-wallimann', 'Peter', 'Wallimann', 'poi.sarnen', 'unterwalden', 'innkeeper', { description: "Keeper of Sarnen's inn, whose tap-room gossip the journal draws on." }),
  minor('npc.mechthild-christen', 'Mechthild', 'Christen', 'poi.sarnen', 'unterwalden', 'woman-peasant', { description: 'A Sarnen household worker.' }),
  minor('npc.jost-krummenacher', 'Jost', 'Krummenacher', 'poi.sarnen', 'unterwalden', 'merchant', { description: 'A Sarnen cattle trader.' }),
  minor('npc.werni-niederberger', 'Werni', 'Niederberger', 'poi.sarnen', 'unterwalden', 'elder', { description: 'A Sarnen Landsgemeinde man, one of the tellers of the old story.' }),
  minor('npc.rudi-bissig', 'Rudi', 'Bissig', 'poi.sarnen', 'unterwalden', 'monk', { schedule: monkSchedule(), description: "Sarnen's parish priest." }),
  // ---- Stans ----
  minor('npc.kuoni-durrer', 'Kuoni', 'Durrer', 'poi.stans', 'unterwalden', 'innkeeper', { description: "Keeper of the Stans tavern." }),
  minor('npc.elsi-camenzind', 'Elsi', 'Camenzind', 'poi.stans', 'unterwalden', 'woman-peasant', { description: 'A Stans household worker.' }),
  minor('npc.hans-businger', 'Hans', 'Businger', 'poi.stans', 'unterwalden', 'merchant', { description: 'A Stans trader working the Nidwalden shore.' }),
  minor('npc.burkhard-frunz', 'Burkhard', 'Frunz', 'poi.stans', 'unterwalden', 'elder', { description: 'A Stans Landsgemeinde voice.' }),
  minor('npc.bruder-halter', 'Bruder', 'Halter', 'poi.stans', 'unterwalden', 'monk', { schedule: monkSchedule(), description: "Stans's parish priest." }),
  // ---- Melchtal / Kerns / Alpnach ----
  minor('npc.heinrich-von-melchtal', 'Heinrich', 'von Melchtal', 'poi.melchtal', 'unterwalden', 'herder', {
    description: "Arnold's father — old, and blinded in the tradition's telling by the bailiff's man.", historical: 'legend',
    note: "Wholly L (Weisses Buch tradition); Arnold's blinded father. See LORE.md §1.",
  }),
  minor('npc.rudi-omlin', 'Rudi', 'Omlin', 'poi.kerns', 'unterwalden', 'peasant', { description: 'A Kerns farmer on the Sarnen–Melchtal road.' }),
  minor('npc.gret-wyrsch', 'Gret', 'Wyrsch', 'poi.alpnach', 'unterwalden', 'woman-peasant', { description: 'An Alpnach household worker.' }),
  // ---- Stansstad / Engelberg / Wolfenschiessen ----
  minor('npc.werni-bühler', 'Werni', 'Bühler', 'poi.stansstad', 'unterwalden', 'boatman', { description: 'A Stansstad ferryman.' }),
  minor('npc.bruder-melchior', 'Bruder', 'Melchior', 'poi.engelberg', 'unterwalden', 'monk', { schedule: monkSchedule(), description: 'An Engelberg brother, colleague of Bruder Anselm.' }),
  minor('npc.jost-durrer', 'Jost', 'Durrer', 'poi.wolfenschiessen', 'unterwalden', 'peasant', { description: "A Wolfenschiessen farmer who keeps his own counsel about the bath-house.", dialogueRoot: 'dlg.bad-wolfenschiessen' }),
  // ---- Luzern ----
  minor('npc.hans-vogt', 'Hans', 'Vogt', 'poi.luzern', 'luzern', 'merchant', { description: 'A Luzern cloth merchant trading both lake and Gotthard routes.' }),
  minor('npc.trudi-meier', 'Trudi', 'Meier', 'poi.luzern', 'luzern', 'innkeeper', { description: "Keeper of a Luzern quayside inn.", dialogueRoot: 'dlg.drache-pilatus' }),
  minor('npc.konrad-schmid', 'Konrad', 'Schmid', 'poi.luzern', 'luzern', 'boatman', { description: "A Luzern boatman working the Reuss outflow." }),
  minor('npc.werni-huber', 'Werni', 'Huber', 'poi.luzern', 'luzern', 'boatman', { description: 'A second Luzern ferryman, the Reuss bridge crossing his usual run.' }),
  minor('npc.ita-fischer', 'Ita', 'Fischer', 'poi.luzern', 'luzern', 'woman-peasant', { description: 'A Luzern market-stall keeper.' }),
  minor('npc.rudolf-baumann', 'Rudolf', 'Baumann', 'poi.luzern', 'habsburg', 'habsburg-sergeant', { schedule: guardSchedule(), description: "Sergeant of Luzern's Habsburg garrison." }),
  minor('npc.anton-weber', 'Anton', 'Weber', 'poi.luzern', 'habsburg', 'habsburg-footman', { schedule: guardSchedule(), description: "One of the garrison's footmen." }),
  minor('npc.balz-fischer', 'Balz', 'Fischer', 'poi.luzern', 'habsburg', 'toll-collector', { description: "Runs Luzern's bridge toll." }),
  // ---- Zug ----
  minor('npc.werni-arnold', 'Werni', 'Arnold', 'poi.zug', 'habsburg', 'merchant', { description: "A Zug merchant supplying the Habsburg garrison." }),
  minor('npc.peter-steiner', 'Peter', 'Steiner', 'poi.zug', 'habsburg', 'peasant', { description: 'A Zug townsman.' }),
  minor('npc.jakob-huber', 'Jakob', 'Huber', 'poi.zug', 'habsburg', 'habsburg-footman', { schedule: guardSchedule(), description: "One of Zug's garrison footmen." }),
  minor('npc.eberhard-krummenacher', 'Eberhard', 'Krummenacher', 'poi.zug', 'habsburg', 'habsburg-footman', { schedule: guardSchedule(), description: 'A second Zug garrison footman.' }),
  minor('npc.anton-vogt', 'Anton', 'Vogt', 'poi.zug', 'habsburg', 'habsburg-sergeant', { schedule: guardSchedule(), description: "Zug's sergeant of the watch." }),
  // ---- Einsiedeln ----
  minor('npc.bruder-niklaus', 'Bruder', 'Niklaus', 'poi.einsiedeln', 'einsiedeln', 'monk', { schedule: monkSchedule(), description: "An Einsiedeln brother of the infirmary garden." }),
  minor('npc.bruder-balz', 'Bruder', 'Balz', 'poi.einsiedeln', 'einsiedeln', 'monk', { schedule: monkSchedule(), description: "An Einsiedeln brother of the scriptorium." }),
  minor('npc.bruder-toni', 'Bruder', 'Toni', 'poi.einsiedeln', 'einsiedeln', 'abbey-man-at-arms', { schedule: guardSchedule(), description: "One of the abbey's own retainers." }),
  minor('npc.bruder-sepp', 'Bruder', 'Sepp', 'poi.einsiedeln', 'einsiedeln', 'abbey-man-at-arms', { schedule: guardSchedule(), description: "A second abbey man-at-arms, holding the gate." }),
  // ---- Gersau / Vitznau / Weggis (fishing shore) ----
  minor('npc.uli-fischer', 'Uli', 'Fischer', 'poi.gersau', 'none', 'fisher', { description: "A Gersau fisherman, proud of his little free village's independence.", dialogueRoot: 'dlg.fischer-gersau' }),
  minor('npc.verena-huber', 'Verena', 'Huber', 'poi.vitznau', 'luzern', 'fisher', { description: 'A Vitznau fisherwoman.' }),
  minor('npc.gion-planzer', 'Gion', 'Planzer', 'poi.weggis', 'luzern', 'peasant', { description: 'A Weggis vineyard worker.' }),
];

export const npcs: NpcDef[] = [...historicalCast, ...inventedCore, ...minorCast];

export function register(c: ContentRegistry): void {
  c.addNpcs(npcs);
}
