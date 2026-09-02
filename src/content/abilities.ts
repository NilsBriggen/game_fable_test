/**
 * abilities — content data owned by the combat builder. `CombatEffect` DSL (ARCHITECTURE.md §5.4): the engine
 * (`src/combat/engine.ts` — see `applyEffect`) genuinely interprets `effects[]` for every ability below —
 * status/removeStatus/push/pull/moraleCheck/heal/reload/rally/stance/line/cone/disengage/dash/stabilize all
 * execute exactly as written here, no per-id special-casing. `attackRoll: true` abilities (Attack, Aimed Shot,
 * Hook, Push of Pike, Riposte, Charge, Crossbow Snapshot) roll to hit against the wielder's ACTUAL equipped
 * weapon (dice/type/reach), so they carry no `damage` entry of their own — the weapon hit already is the
 * effect. Charge is the one exception: its `damage` entry is genuinely additional (couched-lance impact on
 * top of the weapon hit), which the engine's convention reads as bonus damage on a hit rather than a
 * replacement. A few mechanics still need engine-side data the DSL can't carry (a contested roll for Shove, the
 * cache/affects-line geometry for Roll Boulders, Herbalism-gated heal size for Bandage, un-Routing for Rally)
 * — `engine.ts`'s `executeAbility` documents exactly which. One def per id referenced by `perks.ts`
 * `grantsAbility`, plus the base action-economy abilities every combatant has. Every id below is cited by
 * BUILDER_RULES.md's fixed ability list.
 */
import type { ContentRegistry } from '@core/content';
import type { AbilityDef } from '@core/schemas';

export const abilities: AbilityDef[] = [
  {
    id: 'ability.attack', name: 'Attack', cost: { action: true }, target: 'enemy', range: 'weapon', attackRoll: true,
    effects: [],
    description: 'A weapon attack with whatever is in hand — melee reach or a loaded ranged weapon.',
    historical: true, note: 'The default action of every fighting man of the period; no special technique implied.',
  },
  {
    id: 'ability.aimed-shot', name: 'Aimed Shot', cost: { action: true, noMove: true }, requires: { ranged: true, loaded: true },
    target: 'enemy', range: 'weapon', attackRoll: true,
    effects: [],
    description: 'A steadied shot, feet planted and both hands on the stock — Tell\'s own method with the Armbrust.',
    historical: true, note: 'A braced, deliberate shot trades all movement for accuracy with any period stirrup crossbow.',
  },
  {
    id: 'ability.reload', name: 'Reload', cost: { bonus: true }, requires: { ranged: true, notStatus: 'loaded' },
    target: 'self', range: 0, attackRoll: false,
    effects: [{ reload: 1 }],
    description: 'Span the crossbow by stirrup and belt hook. The actual cost steps with equipment: reload-1 (bonus), reload-2 (full action), and the crossbow-75 perk drills it one rung faster.',
    historical: true, note: 'The stirrup-and-belt-hook span (no windlass, per LORE §7) is the Act-1 Armbrust\'s real reloading method.',
  },
  {
    id: 'ability.shove', name: 'Shove', cost: { bonus: true }, target: 'enemy', range: 1, attackRoll: false,
    effects: [{ push: { cells: 1 } }],
    description: 'A contested shove (strength vs. agility): push the target one cell — off a ledge, into water, or into a comrade.',
    historical: true, note: 'Shoving a man off his footing on broken Alpine or lakeshore ground needs no special weapon.',
  },
  {
    id: 'ability.disengage', name: 'Disengage', cost: { action: true }, target: 'self', range: 0,
    effects: [{ disengage: true }],
    description: 'Break contact deliberately — no opportunity attack follows you out of reach this turn.',
    historical: true, note: 'Ordered withdrawal under an unbroken guard is standard period fighting sense, not a special trick.',
  },
  {
    id: 'ability.dash', name: 'Dash', cost: { action: true }, target: 'self', range: 0,
    effects: [{ dash: true }],
    description: 'Break into a run, doubling this turn\'s movement.',
    historical: true, note: 'No mechanic beyond running; every militia levy could sprint across a field.',
  },
  {
    id: 'ability.bandage', name: 'Bandage', cost: { bonus: true }, target: 'ally', range: 1,
    effects: [{ stabilize: true }, { heal: '1d4' }],
    description: 'Bind a wound with linen strips: stabilises a Down ally, or heals a standing one — more with Herbalism ≥ 25.',
    historical: true, note: 'Linen dressing was the basic period first aid, home-made or from a barber-surgeon (LORE §7).',
  },
  {
    id: 'ability.haul-out', name: 'Haul Out', cost: { bonus: true }, target: 'ally', range: 1,
    effects: [{ removeStatus: 'drowning' }],
    description: 'Grab a drowning comrade by strap or collar and drag them clear of the water before mail and plate take them under.',
    historical: true, note: 'A drowning man weighed down by armour cannot swim himself out (LORE §1) — only a comrade pulling him clear saves him.',
  },
  {
    id: 'ability.rally', name: 'Rally', cost: { action: true }, requires: { skill: 'leadership' }, target: 'cell', range: 3,
    effects: [{ rally: { radius: 3 } }],
    description: 'A commander\'s shout in a 3-cell radius: clears Shaken and steadies morale.',
    historical: true, note: 'Communally elected captains (Hauptleute) holding a line together by voice is chronicled Confederate practice.',
  },
  {
    id: 'ability.brace', name: 'Brace', cost: { bonus: true }, requires: { weaponProperty: 'brace' }, target: 'self', range: 0,
    effects: [{ stance: 'braced' }],
    description: 'Set the spear or halberd butt and stand ready: a free attack with Edge against anything that charges into your reach.',
    historical: true, note: 'Bracing a spear against cavalry is the Spiess\'s and Halbarte\'s whole reason for being in the levy.',
  },
  {
    id: 'ability.charge', name: 'Charge', cost: { action: true }, requires: { mounted: true, minChargeCells: 3 }, target: 'enemy', range: 'weapon',
    attackRoll: true, effects: [{ damage: { dice: '1d8', type: 'thrust', bonus: 'none' } }],
    description: 'A mounted charge: a genuine run-up of at least 3 cells in a straight line, ending adjacent to the target, for +1d8 lance-impact damage and a morale check on the target — exactly what the Haufen is built to break.',
    historical: true, note: 'Habsburg knightly cavalry at Morgarten relied on the couched-lance charge that the terrain and the Haufen defeated.',
  },
  {
    id: 'ability.roll-boulders', name: 'Roll Boulders', cost: { action: true }, requires: { terrainFeature: ['boulder-cache', 'trunk-cache'] },
    target: 'line', range: 3, attackRoll: false,
    effects: [{ damage: { dice: '2d10', type: 'blunt' } }, { status: { id: 'prone', turns: 1 } }, { moraleCheck: { dc: 14 } }],
    description: 'Loose a cached boulder or trunk down the slope onto the road below — Morgarten\'s opening blow. The engine applies these effects to every unit standing on the feature\'s authored affects-line, not a generic line drawn from the caster.',
    historical: true, note: 'Johannes of Winterthur and the founding tradition both describe rocks and tree trunks rolled onto the Habsburg column from the Figlenfluh above Morgarten.',
  },
  {
    id: 'ability.hook', name: 'Hook', cost: { action: true }, requires: { weaponProperty: 'hook' }, target: 'enemy', range: 'weapon',
    attackRoll: true, effects: [{ pull: { cells: 1 } }],
    description: 'The halberd\'s back-spike drags a mounted foe from the saddle on a hit.',
    historical: true, note: 'Chroniclers of Morgarten describe halberds hooking and pulling riders down; see perk.halberd-25.',
  },
  {
    id: 'ability.wall-of-iron', name: 'Wall of Iron', cost: { bonus: true }, requires: { weaponProperty: 'brace' }, target: 'self', range: 0,
    effects: [{ status: { id: 'wall-of-iron', turns: 99 } }],
    description: 'Anchor the line: while active, your Brace reaction also covers two adjacent allies\' cells.',
    historical: true, note: 'Waldstätte tactics relied on an unbroken hedge of spear points, each man covering his neighbour; see perk.spear-50.',
  },
  {
    id: 'ability.push-of-pike', name: 'Push of Pike', cost: { action: true }, requires: { weaponProperty: 'brace', status: 'braced' },
    target: 'enemy', range: 'weapon', attackRoll: true,
    effects: [{ push: { cells: 1 } }],
    description: 'A braced hit shoves an entire file back and checks its charge.',
    historical: true, note: 'Massed spear formations of the period are chronicled physically shoving an opposing line; see perk.spear-75.',
  },
  {
    id: 'ability.shield-wall', name: 'Shield Wall', cost: { bonus: true }, requires: { shield: true }, target: 'self', range: 0,
    effects: [{ cone: { cells: 1, effect: { status: { id: 'shield-wall', turns: 1 } } } }],
    description: 'Lock shields with the men on either side: you and adjacent allies gain +1 Defense this round.',
    historical: true, note: 'Shield-wall tactics are attested wherever medieval freemen fought shoulder to shoulder; see perk.shield-75.',
  },
  {
    id: 'ability.second-wind', name: 'Verschnaufen', cost: { bonus: true }, target: 'self', range: 0,
    effects: [{ heal: '1d6' }, { removeStatus: 'shaken' }],
    description: 'Catch your breath and steady your nerve — only with no enemy adjacent (this is a pause between clashes, not something you can do mid-melee): heal and shake off Shaken. (Content id stays `ability.second-wind` — perk.athletics-75 grants it by id.)',
    historical: true, note: 'Renamed from the borrowed 5e "Second Wind": this is a physically ordinary breather, not a magical fighter feature. Habsburg chroniclers remark on the stamina of Waldstätte militia, men used to a working life in the mountains; see perk.athletics-75.',
  },
  {
    id: 'ability.war-cry', name: 'War Cry', cost: {}, target: 'cone', range: 3, attackRoll: false,
    effects: [{ cone: { cells: 3, effect: { status: { id: 'war-cry', turns: 2 } } } } ],
    description: 'A free shout that steadies nerves the length of the line, granting Edge on the next morale check to everyone who hears it.',
    historical: true, note: 'Pre-firearm battle lines were held together by voice, not silence; see perk.leadership-25.',
  },
  {
    id: 'ability.riposte', name: 'Riposte', cost: { reaction: true }, requires: { weaponSkill: 'sword' }, target: 'enemy', range: 'weapon',
    attackRoll: true, reactionTrigger: 'leave-reach', effects: [],
    description: 'A parried blow answered at once: your opportunity attack lands for full weight (automatic substitute for a plain opportunity attack — see engine.ts resolveOpportunityAttack).',
    historical: true, note: 'Arming-sword fencing of the period already pairs a parry with an immediate counter-thrust; see perk.sword-50.',
  },
  {
    id: 'ability.disarm', name: 'Disarm', cost: { action: true }, requires: { weaponSkill: 'dagger' }, target: 'enemy', range: 1,
    attackRoll: true, effects: [{ status: { id: 'disarmed', turns: 2 } }],
    description: 'A quick twist of the wrist strips a weapon from a grip.',
    historical: true, note: 'The Swiss dagger\'s cross-guard was also a grappling tool for trapping and twisting a weapon hand; see perk.dagger-50.',
  },
  {
    id: 'ability.crossbow-snapshot', name: 'Schnellschuss', cost: { bonus: true }, requires: { ranged: true, loaded: true },
    target: 'enemy', range: 'weapon', attackRoll: true, effects: [],
    description: 'Loose the instant a target appears, without lowering the weapon first — a second shot this turn, or the reflex behind the Cover Fire reaction on a target that just came into range.',
    historical: true, note: 'The light hunting Armbrust of this period could be brought to bear quickly in a practised hand; see perk.crossbow-50.',
  },
  {
    id: 'ability.mountain-stride', name: 'Mountain Stride', cost: { bonus: true }, target: 'self', range: 0,
    effects: [{ status: { id: 'mountain-stride', turns: 1 } }],
    description: 'Cross steep or snow-choked ground at a pace that would exhaust a lowlander: ignore difficult terrain this turn.',
    historical: true, note: 'Local Alpine terrain knowledge — used again at Morgarten to strike from ground the column could not use; see perk.alpine-50.',
  },
  {
    id: 'ability.sure-foot', name: 'Sure Foot', cost: { bonus: true }, target: 'self', range: 0,
    effects: [{ status: { id: 'sure-footed', turns: 2 } }],
    description: 'Scree, ice and a narrow ledge hold no fear: immune to falling Prone from a slope or a failed shove this round.',
    historical: true, note: 'Alpine villagers lived and worked on terrain that killed careless outsiders; see perk.athletics-25.',
  },
  {
    id: 'ability.bandage-quick', name: 'Quick Bandage', cost: {}, target: 'ally', range: 1,
    effects: [{ stabilize: true }, { heal: '1d4' }],
    description: 'A field dressing applied without wasted motion — free action, once per turn.',
    historical: true, note: 'Speed mattered as much as skill in period battlefield first aid; see perk.herbalism-25.',
  },
  {
    id: 'ability.rally-bonus', name: 'Rally (bonus)', cost: { bonus: true }, requires: { skill: 'leadership' }, target: 'cell', range: 3,
    effects: [{ rally: { radius: 3 } }],
    description: 'A sworn brother-in-arms rallies the Shaken as easily as drawing breath — Rally costs only a bonus action.',
    historical: 'invented', note: 'A builder-invented mechanic (not itself attested tradition, unlike the Bundesbrief it is modelled on): sworn confederates rallying one another under fire, cast as a bonus-action Rally; see perk.leadership-50.',
  },
];

export function register(c: ContentRegistry): void {
  c.addAbilities(abilities);
}
