/**
 * perks — content data owned by the party builder. ARCHITECTURE.md §5.5: perks unlock at skill levels
 * 25/50/75(/100). `modifiers` are flat numbers read by `party/rules.ts` (`derived()`) and by combat's rules;
 * `grantsAbility` names an ability id the combat builder defines (see BUILDER_RULES task for the fixed list).
 * Every perk is a *mechanic*; `note` gives the period justification.
 */
import type { ContentRegistry } from '@core/content';
import type { PerkDef } from '@core/schemas';

export const perks: PerkDef[] = [
  // ================= HALBERD =================
  {
    id: 'perk.halberd-25', name: 'Hook', skill: 'halberd', level: 25,
    description: 'The halberd\'s back-spike can drag a mounted foe from the saddle: on a hit, pull the target 1 cell toward you.',
    grantsAbility: 'ability.hook',
    historical: true, note: 'Chroniclers of Morgarten describe halberds used to hook and pull riders from their horses.',
  },
  {
    id: 'perk.halberd-50', name: 'Breite Schneide', skill: 'halberd', level: 50,
    description: 'A trained eye finds the gap in mail at the shoulder or neck; the halberd\'s broad axe blade opens it wide.',
    modifiers: { critRange: 1 },
    historical: true, note: 'The Sempach-pattern halberd head combined axe, spike and hook for exactly this work against armoured men.',
  },
  {
    id: 'perk.halberd-75', name: 'Rider-Breaker', skill: 'halberd', level: 75,
    description: 'Years on the Letzi lines teach where to strike a charging horseman; your attacks against mounted enemies bite deeper.',
    modifiers: { 'attack.halberd': 2, vsMountedEdge: 1 },
    historical: true, note: 'Johannes of Winterthur\'s account of Morgarten describes halberds breaking the Habsburg cavalry once it was stopped in the defile.',
  },

  // ================= SPEAR =================
  {
    id: 'perk.spear-25', name: 'Bracing Drill', skill: 'spear', level: 25,
    description: 'Drilled bracing against a charge: your Brace reaction covers one additional cell of frontage.',
    modifiers: { braceCells: 1 },
    historical: true, note: 'The Spiess was the universal peasant weapon precisely because bracing it against cavalry needed little training.',
  },
  {
    id: 'perk.spear-50', name: 'Wall of Iron', skill: 'spear', level: 50,
    description: 'A steady spear-hand anchors the line: your Brace reaction now covers two adjacent allies\' cells as well as your own.',
    modifiers: { braceCells: 1 },
    grantsAbility: 'ability.wall-of-iron',
    historical: true, note: 'Waldstätte tactics relied on unbroken hedges of spear points; a steady man in the line covered his neighbours.',
  },
  {
    id: 'perk.spear-75', name: 'Push of Pike', skill: 'spear', level: 75,
    description: 'A shove behind the point can stagger an entire file: a braced hit may push the target 1 cell and check its charge.',
    grantsAbility: 'ability.push-of-pike',
    historical: true, note: 'Massed spear formations of the period are described as physically shoving an opposing line, not only stabbing at it.',
  },

  // ================= SWORD =================
  {
    id: 'perk.sword-25', name: 'Quick Guard', skill: 'sword', level: 25,
    description: 'A swordsman\'s footwork keeps a guard open even mid-attack.',
    modifiers: { defense: 1 },
    historical: true, note: 'Fencing masters of the following century (e.g. Talhoffer) codify guard-and-recover footwork already practised informally in 1300.',
  },
  {
    id: 'perk.sword-50', name: 'Riposte', skill: 'sword', level: 50,
    description: 'A parried blow is answered at once: when you would take an opportunity attack with a sword, you may instead riposte for full damage.',
    grantsAbility: 'ability.riposte',
    historical: true, note: 'Arming-sword fencing of the period already pairs a parry with an immediate counter-thrust.',
  },
  {
    id: 'perk.sword-75', name: 'Doppelhieb', skill: 'sword', level: 75,
    description: 'A twinned cut finds the seam between plates of mail.',
    modifiers: { critRange: 1 },
    historical: true, note: 'The longsword, in use from c. 1300, was built for exactly this kind of edge-work against mail and gambeson.',
  },

  // ================= DAGGER =================
  {
    id: 'perk.dagger-25', name: 'Vitals Strike', skill: 'dagger', level: 25,
    description: 'A short blade knows where to go at close quarters.',
    modifiers: { critRange: 1 },
    historical: true, note: 'The Basler Dolch\'s triangular blade was purpose-built for thrusting into the gaps of an opponent\'s armour.',
  },
  {
    id: 'perk.dagger-50', name: 'Disarm', skill: 'dagger', level: 50,
    description: 'A quick twist of the wrist can strip a weapon from a grip.',
    grantsAbility: 'ability.disarm',
    historical: true, note: 'The Swiss dagger form was also a grappling tool, its cross-guard used to trap and twist an opponent\'s weapon hand.',
  },
  {
    id: 'perk.dagger-75', name: 'Second Blade', skill: 'dagger', level: 75,
    description: 'A dagger held ready in the off hand strikes as naturally as the main weapon.',
    modifiers: { 'attack.dagger': 2 },
    historical: true, note: 'Every fighting man of the era carried a Messer or dagger as an everyday sidearm; using it well needed no special gear.',
  },

  // ================= AXE & MACE =================
  {
    id: 'perk.axe-mace-25', name: 'Hooking Blow', skill: 'axe-mace', level: 25,
    description: 'The axe\'s beard can catch a shield rim and pull it wide.',
    modifiers: { 'attack.axe-mace': 1 },
    historical: true, note: 'Woodsman\'s axes doubled as war axes for peasant militia throughout the Confederacy.',
  },
  {
    id: 'perk.axe-mace-50', name: 'Armour Splitter', skill: 'axe-mace', level: 50,
    description: 'A spiked Morgenstern head finds the rivets and links a blade would skate off.',
    modifiers: { ignoreSoak: 1 },
    historical: true, note: 'The Morgenstern is attested for Swiss militias from the 14th–15th centuries as a crude but effective mail-breaker.',
  },
  {
    id: 'perk.axe-mace-75', name: 'Morgenstern Fury', skill: 'axe-mace', level: 75,
    description: 'Full-swing blows land with terrible weight.',
    modifiers: { critRange: 1 },
    historical: true, note: 'Contemporary illustrations show the spiked club swung two-handed, relying on raw impact.',
  },

  // ================= SHIELD =================
  {
    id: 'perk.shield-25', name: 'Steady Arm', skill: 'shield', level: 25,
    description: 'A well-braced shield arm holds its line under pressure.',
    modifiers: { defense: 1 },
    historical: true, note: 'Heater shields were standard freeman\'s kit, strapped to the forearm for exactly this steadiness.',
  },
  {
    id: 'perk.shield-50', name: 'Deep Block', skill: 'shield', level: 50,
    description: 'A shield turned at the last instant soaks more of a blow.',
    modifiers: { shieldBlockBonus: 2 },
    historical: true, note: 'The heater shield\'s curved face was designed to deflect, not merely stop, a strike.',
  },
  {
    id: 'perk.shield-75', name: 'Shield Wall', skill: 'shield', level: 75,
    description: 'Locking shields with the men on either side turns a line into a wall.',
    grantsAbility: 'ability.shield-wall',
    historical: true, note: 'Shield-wall tactics are attested across medieval Europe wherever freemen fought in the line rather than alone.',
  },

  // ================= CROSSBOW =================
  {
    id: 'perk.crossbow-25', name: 'Steady Stock', skill: 'crossbow', level: 25,
    description: 'A crossbow held against a braced shoulder shoots truer.',
    modifiers: { 'attack.crossbow': 1 },
    historical: true, note: 'The stirrup-and-belt-hook crossbow of this period was already a mechanically consistent weapon in trained hands.',
  },
  {
    id: 'perk.crossbow-50', name: 'Snapshot', skill: 'crossbow', level: 50,
    description: 'A crossbowman who never fully lowers the weapon can loose the instant a target appears.',
    grantsAbility: 'ability.crossbow-snapshot',
    historical: true, note: 'Tell\'s crossbow, like the hunting Armbrust of the period, was light enough to bring to bear quickly.',
  },
  {
    id: 'perk.crossbow-75', name: 'Aimed Shot', skill: 'crossbow', level: 75,
    description: 'Taking the turn to aim, without moving, all but guarantees the bolt goes where it is meant to.',
    grantsAbility: 'ability.aimed-shot',
    historical: true, note: 'Hunting and target crossbows of the era were prized for accuracy at the cost of a slow reload — the trade this ability models.',
  },
  {
    id: 'perk.crossbow-100', name: 'Windlass Drill', skill: 'crossbow', level: 100,
    description: 'Drilled reloading with a windlass span turns the heaviest crossbow\'s reload into a single practised motion (a bonus action instead of a full one). The stirrup-and-belt-hook Armbrust of Act 1 needs no windlass at all — this perk unlocks only in acts after 1400, when the heavier windlass crossbow appears.',
    modifiers: { reloadStep: -1 },
    historical: 'legend', note: 'Windlass-spanned crossbows are a 15th-century development; keeping this capstone dormant in 1291–1315 avoids the anachronism while rewarding a maxed skill.',
  },

  // ================= THROWING =================
  {
    id: 'perk.throwing-25', name: 'True Aim', skill: 'throwing', level: 25,
    description: 'A practised throwing arm rarely goes wide.',
    modifiers: { 'attack.throwing': 1 },
    historical: true, note: 'Sling stones were common peasant hunting and militia practice throughout the Alps.',
  },
  {
    id: 'perk.throwing-50', name: 'Boulder Sense', skill: 'throwing', level: 50,
    description: 'Knowing exactly when to loose a rock or trunk down a slope onto a bunched column below.',
    modifiers: { 'attack.throwing': 1, critRange: 1 },
    historical: true, note: 'The Morgarten ambush\'s opening blow was rocks and tree trunks rolled from the Figlenfluh onto the road below.',
  },
  {
    id: 'perk.throwing-75', name: 'Sling Master', skill: 'throwing', level: 75,
    description: 'A sling in a master\'s hand is nearly as fast and far-reaching as a bow.',
    modifiers: { 'attack.throwing': 2 },
    historical: true, note: 'Slings remained a serious peasant weapon into the 14th century, cheap and needing no smith.',
  },

  // ================= UNARMED =================
  {
    id: 'perk.unarmed-25', name: 'Wrestler\'s Grip', skill: 'unarmed', level: 25,
    description: 'A firm grip turns a scuffle into a fight you control.',
    modifiers: { 'attack.unarmed': 1 },
    historical: true, note: 'Wrestling (Schwingen\'s medieval ancestor) was both sport and a real dispute-settling tool in village life.',
  },
  {
    id: 'perk.unarmed-50', name: 'Iron Fist', skill: 'unarmed', level: 50,
    description: 'A blow that lands square can drop a man where he stands.',
    modifiers: { critRange: 1 },
    historical: true, note: 'Alpine herders and Säumer were proverbially strong-armed men; brawls at markets and fairs are attested in period court records.',
  },
  {
    id: 'perk.unarmed-75', name: 'Takedown', skill: 'unarmed', level: 75,
    description: 'A grappling throw puts an armed opponent flat on their back.',
    modifiers: { 'attack.unarmed': 2, proneOnCrit: 1 },
    historical: true, note: 'Village wrestling technique translated directly to unarming and downing an armed man at close range.',
  },

  // ================= LIGHT ARMOUR =================
  {
    id: 'perk.armor-light-25', name: 'Light Step', skill: 'armor-light', level: 25,
    description: 'Gambeson and leather worn well cost you almost nothing in speed.',
    modifiers: { speedM: 0.5 },
    historical: true, note: 'The quilted Gambeson was worn by most Confederate militia precisely because it barely hindered movement.',
  },
  {
    id: 'perk.armor-light-50', name: 'Second Skin', skill: 'armor-light', level: 50,
    description: 'Padding worn long enough turns into real protection against a cutting edge.',
    modifiers: { 'soak.cut': 1 },
    historical: true, note: 'A well-made gambeson alone could turn a glancing sword cut; it was standard under-armour for a reason.',
  },
  {
    id: 'perk.armor-light-75', name: 'Nimble Guard', skill: 'armor-light', level: 75,
    description: 'Unencumbered footwork keeps a guard where heavier men cannot.',
    modifiers: { defense: 1 },
    historical: true, note: 'Confederates at Morgarten and Sempach are chronicled as out-manoeuvring heavily armoured knights on broken ground.',
  },

  // ================= HEAVY ARMOUR =================
  {
    id: 'perk.armor-heavy-25', name: 'Broad Shoulders', skill: 'armor-heavy', level: 25,
    description: 'Years under mail build the frame to carry more besides.',
    modifiers: { carryKg: 5 },
    historical: true, note: 'A Habsburg knight\'s mail shirt alone weighed 10–12 kg; men-at-arms trained specifically to bear that load all day.',
  },
  {
    id: 'perk.armor-heavy-50', name: 'Plate Sense', skill: 'armor-heavy', level: 50,
    description: 'Knowing how to angle a coat-of-plates turns aside even a heavy blow.',
    modifiers: { 'soak.blunt': 1 },
    historical: true, note: 'The coat-of-plates (worn over mail by wealthier Habsburg knights) was specifically developed to spread blunt impact.',
  },
  {
    id: 'perk.armor-heavy-75', name: 'Iron Constitution', skill: 'armor-heavy', level: 75,
    description: 'A body long since hardened to the weight moves almost as if unarmoured.',
    modifiers: { speedM: 0.5 },
    historical: true, note: 'Trained men-at-arms of the period could still run and vault in full mail, as chroniclers note with some surprise.',
  },

  // ================= ATHLETICS =================
  {
    id: 'perk.athletics-25', name: 'Sure Foot', skill: 'athletics', level: 25,
    description: 'Scree, ice and a narrow ledge hold no fear for a sure-footed climber.',
    grantsAbility: 'ability.sure-foot',
    historical: true, note: 'Alpine villagers of Uri, Schwyz and Unterwalden lived and worked on terrain that killed careless outsiders.',
  },
  {
    id: 'perk.athletics-50', name: 'Mountaineer', skill: 'athletics', level: 50,
    description: 'A pack that would break another man\'s back rides easily on trained shoulders.',
    modifiers: { carryKg: 5 },
    historical: true, note: 'Alp herders regularly carried heavy loads of cheese and gear up and down the Alpwirtschaft trails.',
  },
  {
    id: 'perk.athletics-75', name: 'Second Wind', skill: 'athletics', level: 75,
    description: 'A trained body finds a second reserve of strength when the fight is not yet over.',
    grantsAbility: 'ability.second-wind',
    historical: true, note: 'The physical stamina of Waldstätte militia — men used to a working life in the mountains — is remarked on by Habsburg chroniclers.',
  },

  // ================= LEADERSHIP =================
  {
    id: 'perk.leadership-25', name: 'War Cry', skill: 'leadership', level: 25,
    description: 'A shout at the right moment steadies nerves the length of the line.',
    grantsAbility: 'ability.war-cry',
    historical: true, note: 'The free shout to bolster morale reflects how pre-firearm battle lines were actually held together — by voice, not silence.',
  },
  {
    id: 'perk.leadership-50', name: 'Eidgenoss', skill: 'leadership', level: 50,
    description: 'A sworn brother-in-arms rallies the Shaken as easily as drawing breath — Rally becomes a bonus action.',
    modifiers: { rallyBonusAction: 1 },
    grantsAbility: 'ability.rally-bonus',
    historical: 'legend', note: 'The Bundesbrief\'s oath of mutual aid is the game\'s model for this perk\'s name: sworn confederates rallying one another under fire.',
  },
  {
    id: 'perk.leadership-75', name: 'Iron Discipline', skill: 'leadership', level: 75,
    description: 'Under a steady commander, a unit\'s nerve simply runs deeper.',
    modifiers: { morale: 5 },
    historical: true, note: 'Contemporary accounts credit disciplined, commune-elected captains (Hauptleute) for the Confederates\' unusual battlefield cohesion.',
  },

  // ================= STEALTH =================
  {
    id: 'perk.stealth-25', name: 'Soft Tread', skill: 'stealth', level: 25,
    description: 'Moving without a sound over leaf-litter, snow or straw.',
    modifiers: { stealthMod: 1 },
    historical: true, note: 'The Burgenbruch storming of Rotzberg (as the Weisses Buch tells it) depended on men crossing a sleeping castle unheard.',
  },
  {
    id: 'perk.stealth-50', name: "Shadow's Path", skill: 'stealth', level: 50,
    description: 'Reading a room or a camp well enough to cross it seen by no one.',
    modifiers: { stealthMod: 2 },
    historical: true, note: 'Zwing Uri (as the founding tradition tells it) was infiltrated by men posing as labourers rather than stormed outright.',
  },

  // ================= SPEECH =================
  {
    id: 'perk.speech-25', name: 'Persuasive Tongue', skill: 'speech', level: 25,
    description: 'Knowing the right form of address turns aside a Herr Vogt\'s temper.',
    modifiers: { speechMod: 1 },
    historical: true, note: 'Address and rhetoric mattered enormously in a Landsgemeinde culture built on public speech and consent.',
  },
  {
    id: 'perk.speech-50', name: 'Silver Tongue', skill: 'speech', level: 50,
    description: 'A practised speaker can talk a hostile room into agreement.',
    modifiers: { speechMod: 2 },
    historical: true, note: 'The Bundesbrief\'s own arbitration clause presumes disputes are settled by speech among equals before they reach blows.',
  },

  // ================= HERBALISM =================
  {
    id: 'perk.herbalism-25', name: 'Quick Bandage', skill: 'herbalism', level: 25,
    description: 'A field dressing applied fast, without wasted motion.',
    grantsAbility: 'ability.bandage-quick',
    historical: true, note: 'Herbal poultices and linen dressings were the standard battlefield first aid of the period; speed mattered as much as skill.',
  },
  {
    id: 'perk.herbalism-50', name: 'Alpine Remedies', skill: 'herbalism', level: 50,
    description: 'Knowing which alpine herb draws out a fever or closes a wound.',
    modifiers: { healBonus: 2 },
    historical: true, note: 'Alpine herb-lore (arnica, yarrow, St John\'s wort) was practical household medicine in the Waldstätte, not folk superstition.',
  },

  // ================= CRAFT =================
  {
    id: 'perk.craft-25', name: 'Steady Hands', skill: 'craft', level: 25,
    description: 'Mending a strap, a haft or a hull without a proper forge to hand.',
    modifiers: { repairBonus: 1 },
    historical: true, note: 'Rural households of the period were largely self-sufficient in basic repair; a smith was for the work that truly needed one.',
  },
  {
    id: 'perk.craft-50', name: "Fletcher's Eye", skill: 'craft', level: 50,
    description: 'Bolts and arrows fletched true, and a letzi wall built to actually hold.',
    modifiers: { repairBonus: 2 },
    historical: true, note: 'The letzi walls at Sattel and elsewhere were community-built and -maintained defensive works, not the work of specialists alone.',
  },

  // ================= TRADE =================
  {
    id: 'perk.trade-25', name: 'Fair Dealing', skill: 'trade', level: 25,
    description: 'Knowing a fair Pfennig price keeps merchants from cheating you.',
    modifiers: { priceMod: -5 },
    historical: true, note: 'The Gotthard Säumer economy ran on exact, well-understood tariffs; a muleteer who did not know prices did not stay in business.',
  },
  {
    id: 'perk.trade-50', name: "Gotthard Ledger", skill: 'trade', level: 50,
    description: 'A trader\'s memory for prices across every market from Luzern to the Reuss valley.',
    modifiers: { priceMod: -10 },
    historical: true, note: 'Säumer cooperatives kept careful account of tolls and goods prices along the whole Gotthard route.',
  },

  // ================= ALPINE CRAFT =================
  {
    id: 'perk.alpine-25', name: 'Weatherwise', skill: 'alpine', level: 25,
    description: 'Reading cloud and wind off the Mythen before a storm breaks.',
    modifiers: { alpineHazardMod: 1 },
    historical: true, note: 'Alpine communities depended on accurate weather-reading for the Alpwirtschaft transhumance cycle; misreading it was fatal.',
  },
  {
    id: 'perk.alpine-50', name: 'Mountain Stride', skill: 'alpine', level: 50,
    description: 'Crossing steep or snow-choked ground at a pace that would exhaust a lowlander.',
    grantsAbility: 'ability.mountain-stride',
    historical: true, note: 'The Confederates\' local knowledge of Alpine terrain — used again at Morgarten to strike from ground the Habsburg column could not use — is a constant theme in the chronicles.',
  },
];

export function register(c: ContentRegistry): void {
  c.addPerks(perks);
}
