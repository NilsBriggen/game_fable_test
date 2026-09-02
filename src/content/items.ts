/**
 * items — content data owned by the party builder. LORE.md §7 is the only allowed material culture for Act 1;
 * every entry here stays inside that list (or is a plain, period-plausible consumable/tool). Values are in
 * Pfennig, medieval price ratios (bread cheap, a mail shirt a small fortune). See ARCHITECTURE.md §3.3.
 */
import type { ContentRegistry } from '@core/content';
import type { ItemDef } from '@core/schemas';

export const items: ItemDef[] = [
  // ==================== WEAPONS ====================
  {
    id: 'item.halbarte', name: 'Halbarte', kind: 'weapon', weightKg: 2.2, value: 200,
    weapon: { skill: 'halberd', hands: 2, reach: 2, damage: '1d10', damageType: 'cut', properties: ['brace', 'reach', 'hook', 'heavy'] },
    description: 'Axe blade, back-spike and top point on a two-metre haft — the weapon Morgarten was won with.',
    historical: true, note: 'Attested in Confederate use from the early 14th c.; the "Sempach" halberd form is the classic Waldstätte pattern.',
  },
  {
    id: 'item.spiess', name: 'Spiess', kind: 'weapon', weightKg: 1.8, value: 40,
    weapon: { skill: 'spear', hands: 1, reach: 2, damage: '1d8', damageType: 'thrust', properties: ['brace', 'reach'] },
    description: 'A plain 2.5–3 m ash spear, thrust one-handed from behind a shield — the first weapon any Waldstätte man learns.',
    historical: true, note: 'The universal peasant militia weapon of the period; cheap, simple to make and to teach.',
  },
  {
    id: 'item.langspiess', name: 'Langspiess', kind: 'weapon', weightKg: 3.5, value: 60,
    weapon: { skill: 'spear', hands: 2, reach: 3, damage: '1d10', damageType: 'thrust', properties: ['brace', 'reach', 'two-handed'] },
    eraFrom: 'ch2-1314',
    description: 'A 4–5.5 m training pike used to drill the Haufen block; too long and unwieldy for open skirmishing.',
    historical: true, note: 'The long pike proper is a 15th-c. development; it appears here only as a drilled training weapon late in Chapter 2, per LORE.md §7.',
  },
  {
    id: 'item.armbrust', name: 'Armbrust', kind: 'weapon', weightKg: 3.5, value: 400,
    weapon: { skill: 'crossbow', hands: 2, reach: 1, damage: '1d10', damageType: 'thrust', properties: ['reload-1'], range: { short: 12, long: 24 }, ammo: 'item.bolzen' },
    description: 'A stirrup-and-belt-hook crossbow — the weapon of Wilhelm Tell\'s tradition. Slow to span, deadly at range.',
    historical: true, note: 'Simple stirrup-spanned crossbows were common by 1300; the windlass span is a 15th-c. refinement, deliberately excluded here.',
  },
  {
    id: 'item.hunting-bow', name: 'Hunting bow', kind: 'weapon', weightKg: 1.0, value: 120,
    weapon: { skill: 'crossbow', hands: 2, reach: 1, damage: '1d6', damageType: 'thrust', properties: ['reload-1'], range: { short: 10, long: 20 }, ammo: 'item.arrows' },
    description: 'A plain hunting self-bow, kept by herders and foresters for deer and boar.',
    historical: true, note: 'Bows were hunting tools in the Alpine cantons; the crossbow, not the longbow, was the region\'s war missile weapon.',
  },
  {
    id: 'item.morgenstern', name: 'Morgenstern', kind: 'weapon', weightKg: 2.0, value: 90,
    weapon: { skill: 'axe-mace', hands: 1, reach: 1, damage: '1d8', damageType: 'blunt', properties: ['heavy'] },
    description: 'A spiked wooden club — the "morning star" of every militia levy that could not afford steel.',
    historical: true, note: 'Attested for Swiss peasant militias from the 14th–15th centuries; Morgarten tradition includes it.',
  },
  {
    id: 'item.schwert', name: 'Schwert', kind: 'weapon', weightKg: 1.2, value: 300,
    weapon: { skill: 'sword', hands: 1, reach: 1, damage: '1d8', damageType: 'cut', properties: ['versatile'] },
    description: 'A one-handed arming sword — a freeman\'s mark of standing as much as a weapon.',
    historical: true, note: 'The standard knightly and wealthy-freeman sidearm of the period.',
  },
  {
    id: 'item.langschwert', name: 'Langschwert', kind: 'weapon', weightKg: 1.8, value: 450,
    weapon: { skill: 'sword', hands: 2, reach: 1, damage: '1d10', damageType: 'cut', properties: ['two-handed'] },
    description: 'A two-handed longsword, its cruciform hilt long enough for a second hand on the grip.',
    historical: true, note: 'Longswords proper appear from c. 1300 — early but correct for Chapter 1 (1307) onward.',
  },
  {
    id: 'item.messer', name: 'Messer', kind: 'weapon', weightKg: 0.9, value: 80,
    weapon: { skill: 'sword', hands: 1, reach: 1, damage: '1d6', damageType: 'cut', properties: ['finesse'] },
    description: 'A single-edged Bauernwehr knife-sword, legally a "knife" and so worn by men forbidden a true sword.',
    historical: true, note: 'The Messer\'s single-edged, knife-derived construction let commoners carry a real sidearm within local weapon laws.',
  },
  {
    id: 'item.schweizerdolch', name: 'Schweizerdolch', kind: 'weapon', weightKg: 0.4, value: 60,
    weapon: { skill: 'dagger', hands: 1, reach: 1, damage: '1d4', damageType: 'thrust', properties: ['finesse'] },
    description: 'A Basler-pattern dagger with a triangular blade — everyone\'s last-resort sidearm.',
    historical: true, note: 'The Swiss dagger form begins as the "Basler Dolch" around 1300, per LORE.md §7.',
  },
  {
    id: 'item.axe', name: 'Axe', kind: 'weapon', weightKg: 1.1, value: 50,
    weapon: { skill: 'axe-mace', hands: 1, reach: 1, damage: '1d8', damageType: 'cut', properties: [] },
    description: 'A woodsman\'s felling axe, just as at home splitting a shield as a log.',
    historical: true, note: 'Standard peasant kit; axes are among the commonest militia weapons of the period.',
  },
  {
    id: 'item.dreschflegel', name: 'Flegel', kind: 'weapon', weightKg: 1.5, value: 40,
    weapon: { skill: 'axe-mace', hands: 1, reach: 1, damage: '1d8', damageType: 'blunt', properties: [] },
    description: 'A threshing flail turned to war — swung from the hip, awkward to parry.',
    historical: true, note: 'Flails are attested as improvised and dedicated peasant militia weapons across medieval Europe, the Confederacy included.',
  },
  {
    id: 'item.sling', name: 'Sling', kind: 'weapon', weightKg: 0.2, value: 5,
    weapon: { skill: 'throwing', hands: 1, reach: 1, damage: '1d4', damageType: 'blunt', properties: ['thrown'], range: { short: 6, long: 12 } },
    description: 'A braided leather sling, loaded with river stones — a shepherd boy\'s hunting tool.',
    historical: true, note: 'Universal, ancient, and still a real peasant weapon in the 14th century.',
  },
  {
    id: 'item.staff', name: 'Staff', kind: 'weapon', weightKg: 1.3, value: 8,
    weapon: { skill: 'axe-mace', hands: 2, reach: 1, damage: '1d6', damageType: 'blunt', properties: ['versatile'] },
    description: 'A stout walking staff — a herder\'s stick on the alp, a boat hook on the lake, a weapon in a pinch.',
    historical: true, note: 'Quarterstaffs and herding staffs are ordinary rural tool-weapons with no anachronism to flag.',
  },
  {
    id: 'item.lance', name: 'Lance', kind: 'weapon', weightKg: 3.0, value: 350,
    weapon: { skill: 'spear', hands: 1, reach: 2, damage: '1d12', damageType: 'thrust', properties: ['reach', 'heavy'] },
    requires: { skill: 'spear', level: 25 },
    description: 'A mounted knight\'s couched lance — Habsburg cavalry kit, not a Waldstätte weapon.',
    historical: true, note: 'Standard Habsburg knightly equipment at Morgarten; restricted in practice to mounted enemy units and rare NPC use.',
  },

  // ==================== ARMOUR ====================
  {
    id: 'item.gambeson', name: 'Gambeson', kind: 'armor', weightKg: 4.0, value: 80,
    armor: { slot: 'body', soak: { cut: 2, thrust: 1, blunt: 1 }, skill: 'armor-light' },
    description: 'A quilted linen coat stuffed with tow — the commonest body armour in the Waldstätte.',
    historical: true, note: 'Standard militia armour across the Confederacy; often the only armour a peasant fighter owned.',
  },
  {
    id: 'item.mail-shirt', name: 'Panzerhemd', kind: 'armor', weightKg: 11.0, value: 1500,
    armor: { slot: 'body', soak: { cut: 4, thrust: 2, blunt: 1 }, skill: 'armor-heavy', speedPenaltyM: -1.5 },
    description: 'A riveted mail shirt — rare and costly among the Confederates, common Habsburg knightly kit.',
    historical: true, note: 'Mail was expensive; the Confederates "rarely have more than gambeson and Eisenhut" per LORE.md §7, unlike Habsburg knights.',
  },
  {
    id: 'item.coat-of-plates', name: 'Coat of plates', kind: 'armor', weightKg: 9.0, value: 2200,
    armor: { slot: 'body', soak: { cut: 4, thrust: 4, blunt: 2 }, skill: 'armor-heavy', speedPenaltyM: -3 },
    description: 'Steel plates riveted inside a leather or cloth coat, worn over mail by the wealthiest knights.',
    historical: true, note: 'Coat-of-plates armour is attested knightly equipment of this exact period, worn by Habsburg men-at-arms.',
  },
  {
    id: 'item.eisenhut', name: 'Eisenhut', kind: 'armor', weightKg: 1.5, value: 60,
    armor: { slot: 'head', soak: { cut: 2, thrust: 1, blunt: 1 }, skill: 'armor-light' },
    description: 'A simple iron kettle hat with a broad brim — the Confederate militia\'s standard headgear.',
    historical: true, note: 'The kettle hat is the archetypal Waldstätte helmet of LORE.md §7.',
  },
  {
    id: 'item.bascinet', name: 'Bascinet', kind: 'armor', weightKg: 2.2, value: 800,
    armor: { slot: 'head', soak: { cut: 2, thrust: 2, blunt: 2 }, skill: 'armor-heavy' },
    description: 'An early close-fitting bascinet helm, snug over a mail coif — knightly headgear.',
    historical: true, note: 'The early bascinet form is correct for 1300–1315, before later visored developments.',
  },
  {
    id: 'item.leather-cap', name: 'Leather cap', kind: 'armor', weightKg: 0.4, value: 15,
    armor: { slot: 'head', soak: { cut: 1, thrust: 0, blunt: 1 }, skill: 'armor-light' },
    description: 'A boiled-leather skullcap, better than nothing and all most villagers could afford.',
    historical: true, note: 'Cuir-bouilli leather caps were common cheap protection throughout medieval Europe.',
  },
  {
    id: 'item.heater-shield', name: 'Heater shield', kind: 'shield', weightKg: 4.0, value: 150,
    armor: { slot: 'offHand', soak: { cut: 0, thrust: 0, blunt: 0 }, defense: 2, skill: 'shield' },
    description: 'A tapering "heater"-shaped shield, strapped to the forearm — standard freeman\'s and knight\'s defence.',
    historical: true, note: 'The heater shield form was current across Europe, including the Confederacy, by 1300.',
  },
  {
    id: 'item.buckler', name: 'Buckler', kind: 'shield', weightKg: 1.0, value: 60,
    armor: { slot: 'offHand', soak: { cut: 0, thrust: 0, blunt: 0 }, defense: 1, skill: 'shield' },
    description: 'A small fist-shield, quick to punch and parry with alongside a sword or messer.',
    historical: true, note: 'Bucklers paired with sword or messer are attested sidearm kit throughout the period.',
  },
  {
    id: 'item.wooden-shoes', name: 'Wooden shoes', kind: 'armor', weightKg: 0.8, value: 20,
    armor: { slot: 'feet', soak: { cut: 0, thrust: 0, blunt: 1 } },
    description: 'Carved wooden clogs — cheap, cold-proof, and murder on a long march.',
    historical: true, note: 'Wooden-soled footwear was common poor and rural footwear across medieval Europe.',
  },
  {
    id: 'item.leather-boots', name: 'Leather boots', kind: 'armor', weightKg: 1.0, value: 80,
    armor: { slot: 'feet', soak: { cut: 0, thrust: 0, blunt: 1 } },
    description: 'Turn-welted leather boots, the standard footwear of anyone who could afford a cobbler.',
    historical: true, note: 'Ordinary medieval leather footwear construction, unremarkable and correct for the period.',
  },
  {
    id: 'item.hobnailed-boots', name: 'Hobnailed boots', kind: 'armor', weightKg: 1.3, value: 150,
    armor: { slot: 'feet', soak: { cut: 0, thrust: 0, blunt: 1 } },
    description: 'Leather boots studded with iron hobnails for grip on ice, scree and wet rock.',
    historical: true, note: 'Hobnailed footwear is attested Alpine practical gear for exactly the terrain the Waldstätte live on.',
  },

  // ==================== AMMUNITION ====================
  {
    id: 'item.bolzen', name: 'Bolzen', kind: 'ammo', weightKg: 0.05, value: 3,
    description: 'A stack of short, heavy crossbow bolts, iron-tipped.',
    historical: true, note: 'Standard crossbow ammunition of the period.',
  },
  {
    id: 'item.arrows', name: 'Arrows', kind: 'ammo', weightKg: 0.03, value: 2,
    description: 'A bundle of fletched hunting arrows.',
    historical: true, note: 'Plain hunting-bow arrows; unremarkable period equipment.',
  },
  {
    id: 'item.sling-stones', name: 'Sling stones', kind: 'ammo', weightKg: 0.1, value: 1,
    description: 'A pouch of smooth river stones, sized for a sling.',
    historical: true, note: 'Sling ammunition needed no manufacture, which is precisely why the weapon stayed in use.',
  },

  // ==================== CONSUMABLES ====================
  {
    id: 'item.bread', name: 'Bread', kind: 'consumable', weightKg: 0.5, value: 2,
    description: 'A dense loaf of rye bread, a day\'s ration.',
    historical: true, note: 'Rye and spelt bread were the Alpine staple grain food of the period.',
  },
  {
    id: 'item.alpkaese', name: 'Alpkäse', kind: 'consumable', weightKg: 0.5, value: 8,
    description: 'A wedge of hard alp cheese, aged in the Sennhütte over summer.',
    historical: true, note: 'Hard Alpine cheese-making (the Sbrinz-type tradition) is well attested for this period, per LORE.md §7.',
  },
  {
    id: 'item.dried-meat', name: 'Dried meat', kind: 'consumable', weightKg: 0.4, value: 10,
    description: 'Strips of salted, wind-dried meat, kept for travel.',
    historical: true, note: 'Salting and air-drying was the standard meat preservation of the period.',
  },
  {
    id: 'item.wine', name: 'Wine', kind: 'consumable', weightKg: 1.0, value: 6,
    description: 'A skin of thin red wine from the Luzern shore vineyards.',
    historical: true, note: 'Vineyards along the lower lake shore (Luzern side) are attested for the period, per LORE.md §7.',
  },
  {
    id: 'item.milk', name: 'Milk', kind: 'consumable', weightKg: 1.0, value: 2,
    description: 'A skin of fresh alp milk.',
    historical: true, note: 'A staple of the Alpwirtschaft summer economy.',
  },
  {
    id: 'item.bandage', name: 'Bandage', kind: 'consumable', weightKg: 0.2, value: 5,
    consumable: { effect: { heal: '1d6' }, uses: 1 },
    description: 'Clean linen strips for binding a wound — heals 1d6 out of combat, or stabilises a Down ally in the field.',
    historical: true, note: 'Linen dressing was the basic first aid of the period, home-made or from a barber-surgeon.',
  },
  {
    id: 'item.herbs', name: 'Herbs', kind: 'consumable', weightKg: 0.2, value: 8,
    consumable: { effect: { heal: '1d2' }, uses: 1 },
    description: 'A pouch of dried arnica, yarrow and St John\'s wort.',
    historical: true, note: 'Alpine herbal remedies used for wounds and fever were ordinary household medicine, not magic.',
  },
  {
    id: 'item.salve', name: 'Salve', kind: 'consumable', weightKg: 0.2, value: 15,
    consumable: { effect: { heal: '1d4' }, uses: 1 },
    description: 'A pot of rendered-fat wound salve, worked with healing herbs.',
    historical: true, note: 'Fat-and-herb salves were the standard wound dressing of medieval field medicine.',
  },

  // ==================== TOOLS & MISC ====================
  {
    id: 'item.rope', name: 'Rope', kind: 'tool', weightKg: 3.0, value: 15,
    description: 'Ten metres of hemp rope — for climbing, hauling, or going over a castle wall by night.',
    historical: true, note: 'Ordinary hemp rope, unremarkable period equipment used in the Rotzberg tradition (Burgenbruch).',
  },
  {
    id: 'item.torch', name: 'Torch', kind: 'tool', weightKg: 0.6, value: 3,
    description: 'A pitch-soaked cloth-and-wood torch.',
    historical: true, note: 'Standard period lighting.',
  },
  {
    id: 'item.flint', name: 'Flint and steel', kind: 'tool', weightKg: 0.1, value: 2,
    description: 'A fire-steel and flint in a small tin.',
    historical: true, note: 'The universal period fire-starting kit.',
  },
  {
    id: 'item.fishing-line', name: 'Fishing line', kind: 'tool', weightKg: 0.3, value: 5,
    description: 'Braided horsehair line with a bone hook, wound on a wooden spool.',
    historical: true, note: 'Lake Lucerne fishing communities (Gersau, Weggis) are attested for the period.',
  },
  {
    id: 'item.mule-tack', name: 'Mule tack', kind: 'tool', weightKg: 4.0, value: 40,
    description: 'A pack saddle and harness sized for a Gotthard mule train.',
    historical: true, note: 'Standard Säumer cooperative equipment for working the Gotthard route.',
  },
  {
    id: 'item.salt-sack', name: 'Sack of salt', kind: 'tool', weightKg: 8.0, value: 60,
    description: 'A sealed sack of salt, one of the staple goods carried north over the Gotthard.',
    historical: true, note: 'Salt was a principal Gotthard trade good the Säumer cooperatives moved north from Italy.',
  },
  {
    id: 'item.cloth-bale', name: 'Bale of cloth', kind: 'tool', weightKg: 6.0, value: 90,
    description: 'A bolt of woven cloth, bound for a Luzern or Zürich market.',
    historical: true, note: 'Cloth was a standard Gotthard trade commodity moving in both directions with the Säumer.',
  },
  {
    id: 'item.pfennig-purse', name: 'Pfennig purse', kind: 'misc', weightKg: 0.1, value: 5,
    description: 'A worn leather purse for Zürcher Pfennig coin — the money itself is tracked separately.',
    historical: true, note: 'The Zürich mint\'s Pfennig was the common small coin of the region; see LORE.md §7.',
  },
  {
    id: 'item.hammer', name: "Smith's hammer", kind: 'tool', weightKg: 1.5, value: 30,
    description: 'A hand hammer for rough field repairs to gear, gates and letzi timber.',
    historical: true, note: 'Ordinary smithing tool; village smiths were essential rural craftsmen.',
  },
  {
    id: 'item.psalter', name: 'Psalter', kind: 'book', weightKg: 0.5, value: 40,
    description: 'A small hand-copied psalter, its pages worn soft with reading.',
    historical: true, note: 'Devotional books were owned by literate laypeople and novices connected to a monastery or abbey.',
  },
  {
    id: 'item.bundesbrief-copy', name: 'Copy of the Bundesbrief', kind: 'book', weightKg: 0.1, value: 0,
    description: 'A hand-copied leaf of the Latin charter sealed at the Rütli — mutual aid, no foreign judges, arbitration.',
    historical: true, note: 'The Bundesbrief text (Bundesbriefmuseum Schwyz) is the game\'s canonical source; see LORE.md §9.',
  },
  {
    id: 'item.gessler-hut', name: "Gessler's hat", kind: 'misc', weightKg: 0.3, value: 0,
    description: 'A Habsburg lord\'s hat, set on a pole in the Altdorf square to be bowed to as if it were the Vogt himself.',
    historical: 'legend', note: 'The pole and the hat are central to the Tell tradition as recorded in the Weisses Buch von Sarnen; see LORE.md §6.',
  },
];

export function register(c: ContentRegistry): void {
  c.addItems(items);
}
