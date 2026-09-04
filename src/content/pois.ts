/**
 * pois — content data owned by the exploration builder. ARCHITECTURE.md §3.3, §5.2; LORE.md §4 (mandated
 * list) plus invented minor POIs (LORE.md §10 row "exploration builder minor POIs"). Every gazetteer-based
 * POI id is `poi.<gazetteer id>` (LORE.md §4 / task spec) and reuses `src/content/gazetteer.ts` coordinates
 * verbatim — never hand-typed — and `src/content/geography.ts`'s `PLACE_REGION_ID` for its region, so POIs
 * can never drift from the shared map. `models` layouts are NOT baked in here: `src/exploration/layout.ts`
 * derives a procedural building layout from `kind` + `population` at populate() time (task spec).
 */
import type { ContentRegistry } from '@core/content';
import type { Historicity, PoiDef, PoiKind } from '@core/schemas';
import { PLACES } from './gazetteer';
import { PLACE_REGION_ID } from './geography';

type Pop = Record<string, number>;

const RADIUS_BY_KIND: Partial<Record<PoiKind, number>> = {
  village: 90, town: 160, castle: 90, church: 40, chapel: 35, monastery: 110, alp: 55, pass: 70, bridge: 45,
  meadow: 80, landmark: 50, camp: 40, ruin: 45, port: 70, viewpoint: 90, battlefield: 130, mill: 40, hut: 25,
  wall: 40, cross: 15,
};
const FASTTRAVEL_BY_KIND: Partial<Record<PoiKind, boolean>> = {
  village: true, town: true, castle: true, church: false, chapel: false, monastery: true, alp: true, pass: true,
  bridge: true, meadow: true, landmark: false, camp: false, ruin: false, port: true, viewpoint: true,
  battlefield: true, mill: false, hut: false, wall: true, cross: false,
};

interface Overrides {
  id?: string;
  name?: string;
  kind: PoiKind;
  discoverRadius?: number;
  fastTravel?: boolean;
  population?: Pop;
  historical: Historicity;
  note: string;
  description: string;
}

/** A POI at an existing `gazetteer.ts` place: coordinates and default name come straight from `PLACES`. */
function fromGazetteer(gazId: string, o: Overrides): PoiDef {
  const p = PLACES[gazId];
  if (!p) throw new Error(`pois: unknown gazetteer id "${gazId}"`);
  const region = PLACE_REGION_ID[gazId];
  if (!region) throw new Error(`pois: no region for gazetteer id "${gazId}"`);
  return {
    id: o.id ?? `poi.${gazId}`,
    name: o.name ?? p.name,
    region,
    x: p.x,
    z: p.z,
    kind: o.kind,
    discoverRadius: o.discoverRadius ?? RADIUS_BY_KIND[o.kind] ?? 60,
    fastTravel: o.fastTravel ?? FASTTRAVEL_BY_KIND[o.kind] ?? false,
    population: o.population,
    historical: o.historical,
    note: o.note,
    description: o.description,
  };
}

/** An invented POI with no gazetteer entry, offset from a real place so it still sits in that place's region. */
function invented(id: string, name: string, nearGazId: string, dx: number, dz: number, o: Overrides): PoiDef {
  const p = PLACES[nearGazId];
  if (!p) throw new Error(`pois: unknown gazetteer anchor "${nearGazId}"`);
  const region = PLACE_REGION_ID[nearGazId];
  if (!region) throw new Error(`pois: no region for gazetteer anchor "${nearGazId}"`);
  return {
    id, name, region, x: p.x + dx, z: p.z + dz, kind: o.kind,
    discoverRadius: o.discoverRadius ?? RADIUS_BY_KIND[o.kind] ?? 40,
    fastTravel: o.fastTravel ?? FASTTRAVEL_BY_KIND[o.kind] ?? false,
    population: o.population,
    historical: o.historical, note: o.note, description: o.description,
  };
}

// ==================================================================================================
// Mandated POIs — LORE.md §4. Every one of these carries the exact id the integrator/other builders
// (harness scenarios, dialogue/quest ids, encounter locations) already reference.
// ==================================================================================================

const mandated: PoiDef[] = [
  fromGazetteer('ruetli', {
    kind: 'meadow', historical: true, fastTravel: true, discoverRadius: 100,
    note: 'The Rütli meadow is a real place above the Urnersee; the oath sworn there is L (Weisses Buch von Sarnen). See LORE.md §1/§6.',
    description: 'A quiet lakeside meadow below the Seelisberg, reachable only by boat or steep path — where three men of three valleys are said to have sworn their oath.',
  }),
  fromGazetteer('altdorf', {
    kind: 'village', historical: true, discoverRadius: 160,
    population: { peasant: 6, 'woman-peasant': 3, elder: 2, merchant: 1, innkeeper: 1, child: 2, 'militia-spear': 2, 'bailiff-guard': 2 },
    note: 'Altdorf as Uri\'s Landsgemeinde seat is H; the pole, the hat and the apple-shot are L (Weisses Buch/Tschudi). See LORE.md §1/§6.',
    description: 'Uri\'s market village beneath the lime tree, where the Landsgemeinde meets — and where, sixteen years on, a bailiff\'s hat sits on a pole in the square.',
  }),
  fromGazetteer('buerglen', {
    kind: 'village', historical: true,
    population: { peasant: 5, 'woman-peasant': 2, herder: 2, child: 2, monk: 1 },
    note: 'Bürglen as an Uri village is H; its association with Wilhelm Tell\'s household is L. See LORE.md §5.',
    description: 'A Schächental-mouth village of Uri at the foot of the valley — home, tradition says, to Wilhelm Tell.',
  }),
  fromGazetteer('fluelen', {
    kind: 'port', historical: true, discoverRadius: 110,
    population: { boatman: 3, peasant: 3, fisher: 2, 'toll-collector': 1 },
    note: 'Flüelen was the Urnersee\'s working port for Gotthard-bound goods; the Prologue opens here. See LORE.md §6.',
    description: 'The Urnersee\'s southern quay, where Säumer cargo comes off the boats for the Gotthard road — and where news from the north arrives first.',
  }),
  fromGazetteer('tellsplatte', {
    kind: 'landmark', historical: 'legend', fastTravel: true,
    note: 'A chapel at the Tellsplatte is attested from the 16th c.; the leap itself is L. See LORE.md §1/§6.',
    description: 'A slab of rock jutting from the Axen shore where, tradition holds, Tell sprang free of Gessler\'s storm-bound boat.',
  }),
  fromGazetteer('hohle-gasse', {
    kind: 'landmark', historical: 'legend', fastTravel: true, discoverRadius: 80,
    note: 'The sunken road toward Küssnacht is a real terrain feature; Gessler\'s death there is L. See LORE.md §1/§6.',
    description: 'A narrow sunken lane cut into the hillside above Küssnacht — good ground for an ambush, tradition says, and Gessler took it.',
  }),
  fromGazetteer('kuessnacht', {
    kind: 'village', historical: true,
    population: { peasant: 5, 'woman-peasant': 2, 'bailiff-guard': 2, 'toll-collector': 1, child: 1 },
    note: 'Küssnacht was a Habsburg-administered village on the Vierwaldstättersee shore. See LORE.md §2/§3.',
    description: 'A Habsburg village on the lake\'s Rigi-flank shore, its toll road the fastest way from Arth to Luzern.',
  }),
  fromGazetteer('gesslerburg', {
    kind: 'castle', historical: true,
    population: { 'habsburg-footman': 2, 'habsburg-sergeant': 1 },
    note: 'Gesslerburg is a real ruined castle at Küssnacht; the association with a Landvogt named Gessler is L (no such Vogt is attested). See LORE.md §2.',
    description: 'A Habsburg stronghold above Küssnacht, seat — tradition insists — of the Landvogt whose hat sits on the pole at Altdorf.',
  }),
  fromGazetteer('zwing-uri', {
    kind: 'castle', historical: 'legend',
    population: { 'habsburg-footman': 2 },
    note: 'Zwing Uri, a half-built Habsburg fortress near Amsteg meant to overawe the Reuss valley, is L (Weisses Buch tradition). See LORE.md §1/§4.',
    description: 'Scaffolding and half-raised stone astride the Reuss narrows — a fortress the Habsburg bailiffs are building to keep Uri in its place.',
  }),
  fromGazetteer('attinghausen', {
    kind: 'castle', historical: true,
    population: { peasant: 2, 'militia-spear': 2, elder: 1 },
    note: 'Attinghausen castle, seat of the Freiherren von Attinghausen, is H. See LORE.md §2/§5.',
    description: 'The stone seat of the Freiherren von Attinghausen, Uri\'s leading family and its Landammann\'s household.',
  }),
  fromGazetteer('schwyz', {
    kind: 'village', historical: true, discoverRadius: 170,
    population: { peasant: 6, 'woman-peasant': 3, elder: 2, merchant: 1, innkeeper: 1, child: 2, 'militia-halberd': 2 },
    note: 'Schwyz, under the two Mythen, is Land Schwyz\'s Landsgemeinde seat and the canton the Confederacy is later named for. See LORE.md §2/§3.',
    description: 'The Talschaft\'s seat under the twin peaks of the Mythen — Werner Stauffacher\'s canton, and the most outspoken of the three against the bailiffs.',
  }),
  fromGazetteer('steinen', {
    kind: 'village', historical: true,
    population: { peasant: 5, 'woman-peasant': 2, herder: 2, child: 1 },
    note: 'Steinen as a Schwyz village is H; the tradition that Werner Stauffacher\'s house stood here is L. See LORE.md §2/§5.',
    description: 'A farming village on the Steiner Aa — home, tradition holds, to Werner Stauffacher and his household.',
  }),
  fromGazetteer('brunnen', {
    kind: 'port', historical: true, discoverRadius: 120,
    population: { boatman: 2, 'toll-collector': 1, peasant: 2, fisher: 2 },
    note: 'Brunnen\'s quay is where the 1315 Pact renewing the Bundesbrief was sealed; combat here is the Prologue\'s tutorial fight. See LORE.md §1/§6.',
    description: 'The Muota\'s mouth on the Urnersee, a lake-crossing quay for Schwyz — and, four years hence, where the renewed Bund will be sealed.',
  }),
  fromGazetteer('sattel-letzi', {
    kind: 'wall', historical: true, discoverRadius: 80,
    note: 'Letzi walls (defensive earth-and-stone barriers across a valley) are attested for Schwyz. See LORE.md §3.',
    description: 'A stone-and-timber letzi wall thrown across the Schornen valley floor, Schwyz\'s prepared line against a column from Ägeri.',
  }),
  fromGazetteer('morgarten', {
    kind: 'battlefield', historical: true, discoverRadius: 160,
    note: 'The Battle of Morgarten, 15 November 1315, is attested by Johannes of Winterthur among others. See LORE.md §1.',
    description: 'The narrow shelf between the Ägerisee shore and the Figlenfluh slope — ground the Confederates chose, and where a Habsburg column will be broken.',
  }),
  fromGazetteer('einsiedeln', {
    kind: 'monastery', historical: true, discoverRadius: 140,
    population: { monk: 6, peasant: 2 },
    note: 'Einsiedeln abbey under Abbot Johannes von Schwanden (1298–1327) is H; the Marchenstreit raid of 1314 is H. See LORE.md §1/§2.',
    description: 'A Benedictine abbey in the Alptal, landholder of the disputed March pastures Schwyz and the abbey both claim.',
  }),
  fromGazetteer('stans', {
    kind: 'village', historical: true, discoverRadius: 140,
    population: { peasant: 5, 'woman-peasant': 3, elder: 1, merchant: 1, child: 2 },
    note: 'Stans, Nidwalden\'s seat, is H. See LORE.md §2/§3.',
    description: 'Nidwalden\'s market village under the Stanserhorn — Arnold von Melchtal\'s canton.',
  }),
  fromGazetteer('rotzberg', {
    kind: 'castle', historical: true,
    population: { 'habsburg-footman': 2 },
    note: 'Rotzberg castle is H; its storming during the Burgenbruch (a servant girl lets down a rope) is L. See LORE.md §1/§4.',
    description: 'A Habsburg garrison keep on a wooded knoll above Stans — held, tradition says, by too small a watch on the wrong night.',
  }),
  fromGazetteer('sarnen', {
    kind: 'village', historical: true, discoverRadius: 150,
    population: { peasant: 5, 'woman-peasant': 3, elder: 1, merchant: 1, child: 2 },
    note: 'Sarnen, Obwalden\'s seat and home of the Weisses Buch tradition itself, is H. See LORE.md §2/§3/§9.',
    description: 'Obwalden\'s village on the Sarnersee — the place whose old people, the journal says, "give no year" for what happened here.',
  }),
  fromGazetteer('landenberg', {
    kind: 'castle', historical: true,
    population: { 'habsburg-footman': 2, 'habsburg-sergeant': 1 },
    note: 'The Landenberg hill and its castle are H; the bailiff Beringer von Landenberg is L. See LORE.md §2/§5.',
    description: 'A bailiff\'s castle on the hill above Sarnen, seat of the Landvogt the New Year\'s gift procession is said to have unseated.',
  }),
  fromGazetteer('melchtal', {
    kind: 'alp', historical: 'legend',
    population: { herder: 2 },
    note: 'Melchtal as an Obwalden alp hamlet is a real place; its association with Arnold von Melchtal\'s family is L. See LORE.md §5.',
    description: 'A high alp hamlet above Kerns — home, tradition says, to old Heinrich von Melchtal and his son Arnold.',
  }),
  fromGazetteer('luzern', {
    kind: 'town', historical: true, discoverRadius: 220,
    population: { merchant: 4, boatman: 3, innkeeper: 2, peasant: 4, 'habsburg-footman': 3, 'toll-collector': 2, child: 3 },
    note: 'Luzern, bought by Habsburg from Murbach abbey in 1291, is H. See LORE.md §2/§3.',
    description: 'A walled Habsburg trading town at the Reuss outflow, guilds and garrison living uneasily side by side.',
  }),
  fromGazetteer('zug', {
    kind: 'town', historical: true, discoverRadius: 190,
    population: { merchant: 2, peasant: 4, 'habsburg-footman': 4, 'habsburg-sergeant': 1, child: 2 },
    note: 'Zug, a Habsburg town, is H; it is Duke Leopold\'s 1315 staging point for Morgarten. See LORE.md §2/§3.',
    description: 'A walled Habsburg town on the Zugersee\'s north shore — and, come November 1315, a duke\'s marshalling yard.',
  }),
  fromGazetteer('teufelsbruecke', {
    kind: 'bridge', historical: true, discoverRadius: 60,
    note: 'The Teufelsbrücke bridging the Schöllenen gorge (c. 1220–1230) is H, the engineering feat that opened the Gotthard route. See LORE.md §1.',
    description: 'A single stone span thrown across the Schöllenen\'s roaring narrows — without it, there is no Gotthard road at all.',
  }),
  fromGazetteer('andermatt', {
    kind: 'village', historical: true,
    population: { peasant: 3, herder: 2, saeumer: 2, child: 1 },
    note: 'Andermatt (Ursern), a separate valley community under Disentis abbey\'s advocacy, is H. See LORE.md §3.',
    description: 'The Ursern valley\'s village, a high way-station on the Gotthard road under Disentis abbey\'s distant lordship.',
  }),
  fromGazetteer('gotthard', {
    kind: 'pass', historical: true, discoverRadius: 100,
    population: { monk: 2, saeumer: 1 },
    note: 'A hospice at the Gotthard pass is attested from the 13th century. See LORE.md §3.',
    description: 'The bare saddle at the roof of the Reuss valley, its hospice the last shelter before the Ticino side.',
  }),
  fromGazetteer('seelisberg', {
    kind: 'viewpoint', historical: true, discoverRadius: 110,
    note: 'Seelisberg, the terrace above the Rütli, is a real place. See LORE.md §3.',
    description: 'A high terrace above the Rütli meadow, the whole Urnersee laid out below.',
  }),
  fromGazetteer('pilatus', {
    kind: 'alp', historical: true,
    population: { herder: 1, monk: 1 },
    note: 'Pilatus is a real peak; the "dragon" a Luzern monk tells of is explicitly folk legend, not a monster in play. See LORE.md §6 (Der Drache vom Pilatus).',
    description: 'A jagged peak above the Luzern basin, its upper alp grazed by herders who swap dragon stories for the fireside.',
  }),
  fromGazetteer('rigi', {
    kind: 'alp', historical: true,
    population: { herder: 1 },
    note: 'The Rigi and its Alpwirtschaft huts are real. See LORE.md §3.',
    description: 'A broad-shouldered alp above the lake, cattle grazing where the Küssnacht and Arth sides meet.',
  }),
  fromGazetteer('muotathal', {
    kind: 'village', historical: true,
    population: { peasant: 4, herder: 2, child: 1 },
    note: 'Muotathal, in its own side valley toward the closed Pragel, is H. See LORE.md §3.',
    description: 'A farming village up the Muota valley, the Pragel pass closed above it most of the year.',
  }),
];

// ==================================================================================================
// Additional gazetteer places — real toponyms not singled out in LORE §4 but part of the same map;
// this is what pushes the exploration target of ≈60 POIs into a genuinely walkable, densely-named world.
// ==================================================================================================

const extra: PoiDef[] = [
  fromGazetteer('treib', { kind: 'port', historical: true, population: { boatman: 1, fisher: 1 }, note: 'Treib is the historic Urnersee ferry landing opposite the Axen shore.', description: 'A small ferry landing on the Urnersee\'s western shore, opposite the Rütli.' }),
  fromGazetteer('bauen', { kind: 'village', historical: true, population: { peasant: 2, fisher: 1 }, note: 'Bauen is a real lakeside hamlet on the Urnersee.', description: 'A handful of houses clinging to a narrow shelf between the lake and the cliffs.' }),
  fromGazetteer('isleten', { kind: 'hut', historical: true, note: 'Isleten is a real hamlet on the Urnersee shore below the Isenthal.', description: 'A single boat-landing hamlet at the mouth of the Isenthal.' }),
  fromGazetteer('sisikon', { kind: 'village', historical: true, population: { peasant: 2, fisher: 1 }, note: 'Sisikon is a real Axen-shore village.', description: 'A shore village on the Axen path between Flüelen and Brunnen.' }),
  fromGazetteer('erstfeld', { kind: 'village', historical: true, population: { peasant: 3, herder: 1, child: 1 }, note: 'Erstfeld is a real Reusstal village on the Gotthard road.', description: 'A farming village where the Reuss valley widens south of Altdorf.' }),
  fromGazetteer('silenen', { kind: 'village', historical: true, population: { peasant: 2, saeumer: 1 }, note: 'Silenen is a real Reusstal village on the Gotthard road.', description: 'A way-station village on the mule track south toward Amsteg.' }),
  fromGazetteer('amsteg', { kind: 'village', historical: true, population: { saeumer: 2, peasant: 2 }, note: 'Amsteg is a real Reusstal village where the Kerstelenbach joins the Reuss.', description: 'A Säumer stopover at the foot of the climb toward the Schöllenen.' }),
  fromGazetteer('goeschenen', { kind: 'village', historical: true, population: { saeumer: 1, peasant: 2 }, note: 'Göschenen is the real village at the north foot of the Schöllenen gorge.', description: 'The last village before the Schöllenen\'s narrows swallow the road.' }),
  fromGazetteer('hospental', { kind: 'village', historical: true, population: { peasant: 2, saeumer: 1 }, note: 'Hospental is a real Ursern village on the pass approach.', description: 'A high Ursern village where the Gotthard and Furka roads part.' }),
  fromGazetteer('spiringen', { kind: 'village', historical: true, population: { herder: 2, peasant: 1 }, note: 'Spiringen is a real Schächental village.', description: 'A Schächental farming village on the road toward the Klausen.' }),
  fromGazetteer('unterschaechen', { kind: 'village', historical: true, population: { herder: 2 }, note: 'Unterschächen is a real upper-Schächental village.', description: 'The last proper village before the Schächental narrows toward the Klausen.' }),
  fromGazetteer('klausenpass', { kind: 'pass', historical: true, note: 'The Klausenpass is a real, winter-closed pass toward Glarus.', description: 'A high pass toward Glarus, closed by snow most of the year.' }),
  fromGazetteer('urnerboden', { kind: 'alp', historical: true, population: { herder: 2 }, note: 'Urnerboden is a real, named Alpwirtschaft alp; LORE.md §4 names it as a candidate.', description: 'A broad high alp on the Uri side of the Klausen, grazed every summer.' }),
  fromGazetteer('ibach', { kind: 'meadow', historical: true, note: 'The Ibach meadow near Schwyz is a real Landsgemeinde ground.', description: 'An open meadow outside Schwyz where the Landsgemeinde sometimes gathers.' }),
  fromGazetteer('seewen', { kind: 'village', historical: true, population: { peasant: 2 }, note: 'Seewen is a real Schwyz-basin village.', description: 'A farming village on the road between Schwyz and Steinen.' }),
  fromGazetteer('lauerz', { kind: 'village', historical: true, population: { fisher: 1, peasant: 1 }, note: 'Lauerz is a real village on its own small lake.', description: 'A fishing village on the shore of the little Lauerzersee.' }),
  fromGazetteer('stoos', { kind: 'alp', historical: true, population: { herder: 1 }, note: 'Stoos is a real high alp above the Muotatal.', description: 'A cattle alp on the shoulder between Schwyz and the Muotatal.' }),
  fromGazetteer('gersau', { kind: 'village', historical: true, population: { fisher: 2, peasant: 2 }, note: 'Gersau, later a tiny free republic, is a real lake-shore village; a side quest touches its Habsburg toll dispute.', description: 'A shore village pinched between the lake and the Rigi\'s flank, more independent-minded than most.' }),
  fromGazetteer('vitznau', { kind: 'village', historical: true, population: { fisher: 1, peasant: 1 }, note: 'Vitznau is a real Luzern-basin shore village.', description: 'A quiet shore village at the foot of the Rigi.' }),
  fromGazetteer('weggis', { kind: 'village', historical: true, population: { fisher: 1, peasant: 2 }, note: 'Weggis is a real Luzern-basin shore village.', description: 'A vineyard-terraced village on the sheltered north shore.' }),
  fromGazetteer('arth', { kind: 'village', historical: true, population: { peasant: 2, merchant: 1 }, note: 'Arth is a real village at the Zugersee\'s southern tip.', description: 'A road-junction village where the Schwyz, Zug and Küssnacht routes meet.' }),
  fromGazetteer('goldau', { kind: 'village', historical: true, population: { peasant: 2 }, note: 'Goldau is a real village; the famous 1806 rockslide has not yet happened in this era. See LORE.md §1.', description: 'A quiet farming hamlet below the Rossberg — nothing has fallen on it yet.' }),
  fromGazetteer('steinerberg', { kind: 'village', historical: true, population: { herder: 1, peasant: 1 }, note: 'Steinerberg is a real hillside village above Steinen.', description: 'A scattering of farms on the slope above Steinen.' }),
  fromGazetteer('sattel', { kind: 'village', historical: true, population: { peasant: 2, herder: 1 }, note: 'Sattel is a real village on the Morgarten road.', description: 'A saddle-village on the road from Steinen toward Ägeri — and toward Morgarten.' }),
  fromGazetteer('oberaegeri', { kind: 'village', historical: true, population: { peasant: 2, herder: 1 }, note: 'Oberägeri is a real village on the Ägerisee.', description: 'A farming village on the Ägerisee\'s upper shore.' }),
  fromGazetteer('unteraegeri', { kind: 'village', historical: true, population: { peasant: 2 }, note: 'Unterägeri is a real village on the Ägerisee.', description: 'A lower-shore village on the road toward Zug.' }),
  fromGazetteer('baar', { kind: 'village', historical: true, population: { peasant: 2, merchant: 1 }, note: 'Baar is a real village between Zug and the Ägeri valley.', description: 'A village on the Lorze between Zug and the Ägeri road.' }),
  fromGazetteer('rothenthurm', { kind: 'village', historical: true, population: { peasant: 1, herder: 1 }, note: 'Rothenthurm sits on the real, historic Rothenthurm marsh en route to Einsiedeln.', description: 'A marsh-edge waypoint on the road from Schwyz to Einsiedeln.' }),
  fromGazetteer('alptal', { kind: 'alp', historical: true, population: { herder: 2 }, note: 'The Alptal is the real, disputed March pasture at the heart of the Marchenstreit. See LORE.md §1.', description: 'The disputed alp valley Schwyz and Einsiedeln abbey both claim as pasture.' }),
  fromGazetteer('immensee', { kind: 'village', historical: true, population: { peasant: 2, fisher: 1 }, note: 'Immensee is a real village on the Küssnachtersee.', description: 'A shore village on the little Küssnachtersee, along the Hohle Gasse road.' }),
  fromGazetteer('meggen', { kind: 'village', historical: true, population: { peasant: 2, fisher: 1 }, note: 'Meggen is a real Luzern-basin village.', description: 'A shore village between Küssnacht and Luzern.' }),
  fromGazetteer('kriens', { kind: 'village', historical: true, population: { peasant: 3, child: 1 }, note: 'Kriens is a real village at the foot of Pilatus.', description: 'A village at Pilatus\'s foot, just outside Luzern\'s walls.' }),
  fromGazetteer('horw', { kind: 'village', historical: true, population: { peasant: 2, fisher: 1 }, note: 'Horw is a real Luzern-basin shore village.', description: 'A shore village south of Luzern on the road to Stansstad.' }),
  fromGazetteer('hergiswil', { kind: 'village', historical: true, population: { peasant: 2, fisher: 1 }, note: 'Hergiswil is a real village on the Alpnachersee.', description: 'A shore village where the Alpnachersee narrows toward Stansstad.' }),
  fromGazetteer('fraekmuentegg', { kind: 'alp', historical: true, population: { herder: 1 }, note: 'Fräkmüntegg is a real, named alp on the Pilatus flank; LORE.md §4 names it as a candidate.', description: 'A shelf-alp on Pilatus\'s lower flank, grazed through the summer.' }),
  fromGazetteer('alpnachstad', { kind: 'port', historical: true, population: { boatman: 1, fisher: 1 }, note: 'Alpnachstad is the real Alpnachersee landing for Sarnen-bound traffic.', description: 'The Alpnachersee\'s landing stage, goods carted on from here toward Sarnen.' }),
  fromGazetteer('alpnach', { kind: 'village', historical: true, population: { peasant: 3 }, note: 'Alpnach is a real Obwalden village.', description: 'A farming village between Alpnachstad and Sarnen.' }),
  fromGazetteer('kerns', { kind: 'village', historical: true, population: { peasant: 2, herder: 1 }, note: 'Kerns is a real Obwalden village.', description: 'A village on the road from Sarnen up toward Melchtal.' }),
  fromGazetteer('stansstad', { kind: 'port', historical: true, population: { boatman: 1, fisher: 1 }, note: 'Stansstad is the real Nidwalden lake landing.', description: 'Nidwalden\'s lake landing, boats out to Luzern and the Bürgenstock shore.' }),
  fromGazetteer('ennetbuergen', { kind: 'village', historical: true, population: { peasant: 2, fisher: 1 }, note: 'Ennetbürgen is a real Nidwalden shore village.', description: 'A shore village between Stansstad and Buochs.' }),
  fromGazetteer('buochs', { kind: 'village', historical: true, population: { peasant: 2, fisher: 1 }, note: 'Buochs is a real Nidwalden shore village.', description: 'A shore village on the road to Beckenried.' }),
  fromGazetteer('beckenried', { kind: 'village', historical: true, population: { peasant: 2, fisher: 1 }, note: 'Beckenried is a real Nidwalden shore village.', description: 'A shore village facing the Gersau basin across the water.' }),
  fromGazetteer('emmetten', { kind: 'village', historical: true, population: { herder: 2 }, note: 'Emmetten is a real hillside village above the lake.', description: 'A hillside village on the road up toward the Klewenalp.' }),
  fromGazetteer('klewenalp', { kind: 'alp', historical: true, population: { herder: 1 }, note: 'Klewenalp is a real, named alp; LORE.md §4 names it as a candidate.', description: 'A high alp above Emmetten with a long view down the lake.' }),
  fromGazetteer('wolfenschiessen', { kind: 'village', historical: true, population: { peasant: 2, herder: 1 }, note: 'Wolfenschiessen is a real village; the bath-house killing of a bailiff\'s man there is L (side quest Das Bad zu Wolfenschiessen). See LORE.md §6.', description: 'A quiet village on the Engelberger Aa — quieter still, some say, since the bailiff\'s man stopped coming round.' }),
  fromGazetteer('engelberg', { kind: 'monastery', historical: true, population: { monk: 5 }, note: 'Engelberg abbey (Benedictine) is H; companion Bruder Anselm is described as "of Engelberg" (LORE.md §5).', description: 'A Benedictine abbey deep in its own high valley — home, before the road, to the companion Bruder Anselm.' }),
  fromGazetteer('buergenstock', { kind: 'viewpoint', historical: true, note: 'The Bürgenstock ridge is a real viewpoint above the lake.', description: 'A long wooded ridge with a sheer drop to the lake far below.' }),
  fromGazetteer('stanserhorn', { kind: 'landmark', historical: true, fastTravel: false, discoverRadius: 200, note: 'The Stanserhorn is a real peak above Stans; LORE.md §3 lists its height as a visual anchor.', description: 'A steep summit above Stans, one of the region\'s named skyline peaks.' }),
  fromGazetteer('urirotstock', { kind: 'landmark', historical: true, fastTravel: false, discoverRadius: 220, note: 'The Urirotstock is a real high peak; LORE.md §3 lists it among visual-anchor peaks.', description: 'A high, glacier-streaked ridge closing off the head of the Isenthal — impassable, and simply there to be seen.' }),
  fromGazetteer('fronalpstock', { kind: 'landmark', historical: true, fastTravel: false, discoverRadius: 180, note: 'The Fronalpstock is a real peak above Schwyz; LORE.md §3 lists it as a visual anchor.', description: 'A ridge above Schwyz, the two Mythen rising just beyond it.' }),
  fromGazetteer('grosser-mythen', { kind: 'landmark', historical: true, fastTravel: true, discoverRadius: 160, note: 'The Grosser Mythen is Schwyz\'s iconic double peak; LORE.md §3 lists it as a visual anchor.', description: 'The taller of Schwyz\'s two iconic peaks, visible from half the map.' }),
  fromGazetteer('rossberg', { kind: 'landmark', historical: true, fastTravel: false, discoverRadius: 180, note: 'The Rossberg is a real ridge above Goldau; LORE.md §3 lists it as a visual anchor (pre-1806 rockslide).', description: 'A long wooded ridge above Goldau and Arth, its slopes still forested and stable in this era.' }),
  fromGazetteer('bristen', { kind: 'landmark', historical: true, fastTravel: false, discoverRadius: 220, note: 'The Bristen is a real high peak above Amsteg; LORE.md §3 lists it as a visual anchor.', description: 'A pyramidal peak towering over the Reuss valley near Amsteg.' }),
];

// ==================================================================================================
// Invented (I) minor POIs — LORE.md §4: "named alp huts using real alp names where possible... wayside
// crosses, charcoal burners' camps, a hermit's cell, fishermen's huts, mills, a quarry, shepherds'
// shelters, ruins of the old Habsburg toll station." Placed near a real gazetteer place, offset so they
// still fall inside that place's region. See LORE.md §10 for the register row.
// ==================================================================================================

const invented_: PoiDef[] = [
  invented('poi.aegerisee-shore', 'Ägerisee south shore', 'morgarten', -120, -140, {
    kind: 'landmark', historical: true,
    note: 'The Ägerisee\'s south shore is a real place named in LORE.md §4\'s mandated POI list.',
    description: 'The reedy south shore of the Ägerisee, in view of the road Leopold\'s column will take in 1315.',
  }),
  invented('poi.alp-bannalp', 'Alp Bannalp', 'wolfenschiessen', 900, -650, {
    kind: 'alp', historical: 'invented',
    population: { herder: 2 },
    note: 'Bannalp is a real Nidwalden alp name (LORE.md §4 names it as a candidate); this specific hut and its exact position are the builder\'s invention.',
    description: 'A high grazing alp above Wolfenschiessen, its two herders\' hut roofed in split shingle.',
  }),
  invented('poi.wegkreuz-axenweg', 'Wegkreuz at the Axenweg', 'sisikon', 138, -202, { // offsets from Sisikon: (307,193), a flat bench on the rerouted shore path
    kind: 'cross', historical: 'invented',
    note: 'A wayside cross on a lake-shore footpath — LORE.md §4\'s explicitly invented minor-POI category; no specific attested cross is claimed.',
    description: 'A weathered wooden wayside cross where the shore path narrows above the water.',
  }),
  invented('poi.wegkreuz-gotthardweg', 'Wegkreuz on the Gotthard road', 'silenen', 260, 380, {
    kind: 'cross', historical: 'invented',
    note: 'A wayside cross on the mule track — LORE.md §4\'s invented minor-POI category.',
    description: 'A roadside cross where Säumer trains stop to say a word before the climb toward Amsteg.',
  }),
  invented('poi.kohlerplatz-schaechental', 'Köhlerplatz, Schächental', 'unterschaechen', -320, 260, {
    kind: 'camp', historical: 'invented',
    population: { peasant: 1 },
    note: 'A charcoal burners\' camp — LORE.md §4\'s invented minor-POI category; charcoal-burning itself is period-standard forest industry.',
    description: 'A charcoal burner\'s smouldering earth-covered mound and lean-to, tended day and night.',
  }),
  invented('poi.kohlerplatz-melchtal', 'Köhlerplatz, Melchtal', 'melchtal', -280, -340, {
    kind: 'camp', historical: 'invented',
    population: { peasant: 1 },
    note: 'A charcoal burners\' camp — LORE.md §4\'s invented minor-POI category.',
    description: 'A second charcoal camp working the Melchtal\'s lower slopes.',
  }),
  invented('poi.klausnerzelle', 'Hermit\'s cell', 'bauen', -60, 140, {
    kind: 'hut', historical: 'invented',
    population: { monk: 1 },
    note: 'A hermit\'s cell above the lake — LORE.md §4\'s invented minor-POI category; lay hermits (Klausner) attached to no house were an attested medieval phenomenon in general, if not this specific man.',
    description: 'A one-room stone cell cut into the cliff above the shore, home to a solitary Klausner.',
  }),
  invented('poi.fischerhuetten-gersau', "Fishermen's huts", 'gersau', 100, 18, {
    kind: 'hut', historical: 'invented',
    population: { fisher: 2 },
    note: "Fishermen's huts — LORE.md §4's invented minor-POI category; lake-shore fishing is independently attested for Gersau.",
    description: 'A row of net-drying racks and low huts where Gersau\'s fishermen keep their gear.',
  }),
  invented('poi.muehle-sarneraa', 'Mühle an der Sarner Aa', 'alpnach', 340, -420, {
    kind: 'mill', historical: 'invented',
    population: { peasant: 1 },
    note: 'A water mill on the Sarner Aa — LORE.md §4\'s invented minor-POI category; water-milling was universal period technology.',
    description: 'A creaking wheel and millhouse on the Sarner Aa, grinding grain for the Alpnach villages.',
  }),
  invented('poi.steinbruch-axen', 'Steinbruch am Axen', 'sisikon', 284, 204, {
    kind: 'camp', historical: 'invented',
    population: { peasant: 1 },
    note: 'A stone quarry on the Axen cliffs — LORE.md §4\'s invented minor-POI category (schema has no dedicated "quarry" kind, so this is a `camp`).',
    description: 'A scar of pale rock on the Axen cliff face where quarrymen cut building stone.',
  }),
  invented('poi.alte-zollstatt', 'Ruin of the old toll station', 'amsteg', -260, 340, {
    kind: 'ruin', historical: 'invented',
    note: 'A ruined pre-Zwing-Uri Habsburg toll post — LORE.md §4\'s invented minor-POI category; road tolls on this route are independently attested (LORE.md §5–6).',
    description: 'Collapsed timber and a fire-scarred hearth — an older Habsburg toll post, abandoned before Zwing Uri was begun.',
  }),
];

export const pois: PoiDef[] = [...mandated, ...extra, ...invented_];

export function register(c: ContentRegistry): void {
  c.addPois(pois);
}
