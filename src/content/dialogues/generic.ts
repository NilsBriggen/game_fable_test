/**
 * Generic archetype dialogues — `dlg.generic.<archetype>`, for the unnamed crowd NPCs exploration spawns
 * per settlement (ARCHITECTURE.md §5.2). `speaker: 'narrator'` throughout: the runner resolves the shown
 * speaker name from the talking entity's own `Name` component (passed as `runDialogue`'s `speakerEntity`),
 * not from this def, so one dialogue def serves every instance of the archetype across the map. Speech
 * checks DC 10–18 per the task spec; LORE.md §8 register throughout.
 */
import type { ContentRegistry } from '@core/content';
import type { DialogueDef } from '@core/schemas';

export const genericDialogues: DialogueDef[] = [
  {
    id: 'dlg.generic.peasant', historical: 'invented', note: 'Generic crowd archetype flavor. LORE.md §8.',
    root: 'talk',
    nodes: {
      talk: {
        speaker: 'narrator', text: 'A field-worker straightens up from the furrow, glad of the excuse to rest a moment. "Fair day for it, or fair enough. What brings you off the road?"',
        choices: [
          { text: 'Ask after the local news.', next: 'news' },
          { text: 'Bid them good day and move on.', end: true },
        ],
      },
      news: { speaker: 'narrator', text: '"Nothing much changes here — the bailiff\'s toll, the weather, and whose cow got into whose barley. You\'d know more from the tavern than from me."', end: true },
    },
  },
  {
    id: 'dlg.generic.innkeeper', historical: 'invented', note: 'Generic crowd archetype flavor, with a simple trade hook. LORE.md §8.',
    root: 'talk',
    nodes: {
      talk: {
        speaker: 'narrator', text: '"Sit, if you\'re paying — stand if you\'re only asking questions." The innkeeper wipes a cup that was already clean. "Bread\'s two Pfennig, and worth every Haller of it, if I do say so."',
        choices: [
          { text: 'Buy bread (2 Pfennig).', condition: { pfennig: ['>=', 2] }, effects: [{ pfennig: -2 }, { giveItem: ['item.bread', 1] }, { toast: 'You buy a loaf of bread.' }], next: 'thanks' },
          { text: 'Ask what people are saying.', next: 'gossip' },
          { text: 'Nothing today.', end: true },
        ],
      },
      thanks: { speaker: 'narrator', text: '"Mind the crust — baked this morning, still has some bite to it."', end: true },
      gossip: { speaker: 'narrator', text: '"Same as always — tolls too high, harvest too thin, and the bailiff\'s men drinking on credit they never mean to settle."', end: true },
    },
  },
  {
    id: 'dlg.generic.priest', historical: 'invented', note: 'Generic crowd archetype flavor, a village priest figure. LORE.md §8.',
    root: 'talk',
    nodes: {
      talk: {
        speaker: 'narrator', text: '"Bei Sankt Verena, a new face at Mass." The priest folds his hands. "Are you come for confession, for counsel, or only out of the rain?"',
        choices: [
          { text: 'Ask for a blessing on the road ahead.', effects: [{ toast: 'A blessing for the road, at least, costs nothing.' }], end: true },
          { text: 'Just passing, Father.', end: true },
        ],
      },
    },
  },
  {
    id: 'dlg.generic.boatman', historical: 'invented', note: 'Generic crowd archetype flavor, with a fast-travel hook. LORE.md §8.',
    root: 'talk',
    nodes: {
      talk: {
        speaker: 'narrator', text: '"Crossing, or just admiring the boat?" The boatman rests an oar across his knees. "I know this lake\'s temper better than my own wife\'s — say the word and I\'ll row you across."',
        choices: [
          { text: 'Cross to Brunnen.', effects: [{ teleport: 'poi.brunnen' }], end: true },
          { text: 'Cross to Flüelen.', effects: [{ teleport: 'poi.fluelen' }], end: true },
          { text: 'Not today.', end: true },
        ],
      },
    },
  },
  {
    id: 'dlg.generic.saeumer', historical: 'invented', note: 'Generic crowd archetype flavor. LORE.md §2/§8.', root: 'talk',
    nodes: {
      talk: {
        speaker: 'narrator', text: 'A muleteer checks a girth strap without looking up. "Gotthard road\'s clear as far as Amsteg, muddy past it. Mind the tolls — they multiply the higher you climb."',
        choices: [{ text: 'Ask about the Säumergenossenschaft.', next: 'coop' }, { text: 'Safe travels.', end: true }],
      },
      coop: { speaker: 'narrator', text: '"We look after our own on that road — share the tolls, share the losses when a mule goes over the edge. It\'s the only way the pass gets crossed at all, some seasons."', end: true },
    },
  },
  {
    id: 'dlg.generic.monk', historical: 'invented', note: 'Generic crowd archetype flavor. LORE.md §8.', root: 'talk',
    nodes: {
      talk: {
        speaker: 'narrator', text: '"Pax vobiscum." The brother inclines his head. "We keep the hours here whatever the valley below is arguing about this week."',
        choices: [{ text: 'Ask about the abbey\'s business.', next: 'business' }, { text: 'God keep you, Bruder.', end: true }],
      },
      business: { speaker: 'narrator', text: '"Charters, mostly — who owns what pasture, what forest, what right of way. Dull work, until someone decides it isn\'t."', end: true },
    },
  },
  {
    id: 'dlg.generic.habsburg-guard', historical: 'invented', note: 'Generic crowd archetype flavor; hostile when the player\'s standing with Habsburg is low. LORE.md §8.',
    root: [
      { condition: { rep: ['habsburg', '<', -40] }, node: 'hostile' },
      { condition: { rep: ['habsburg', '<', 0] }, node: 'wary' },
      { condition: { rep: ['habsburg', '>=', 0] }, node: 'neutral' },
    ],
    nodes: {
      hostile: { speaker: 'narrator', text: '"You." The guardsman\'s hand does not leave his sword hilt. "The Landvogt has a name for people like you. Move along, if you know what\'s good for you."', end: true },
      wary: { speaker: 'narrator', text: '"State your business." The guard looks you over the way a man looks over a debt he suspects won\'t be paid.', choices: [{ text: '"Just passing through."', end: true }], },
      neutral: { speaker: 'narrator', text: '"Keep the peace and you\'ll have no trouble from me." The Habsburg guard nods you past his post.', end: true },
    },
  },
  {
    id: 'dlg.generic.toll-collector', historical: 'invented', note: 'Generic crowd archetype flavor; toll collectors are attested for bridges and roads under Habsburg administration. LORE.md §8.',
    root: 'talk',
    nodes: {
      talk: {
        speaker: 'narrator', text: '"Toll\'s due, unless you fancy fording upstream instead." The collector holds out an open palm without much hope of refusal.',
        choices: [
          { text: 'Pay the toll (1 Pfennig).', condition: { pfennig: ['>=', 1] }, effects: [{ pfennig: -1 }], end: true },
          { text: '"I\'ll ford it myself, thank you."', check: { skill: 'speech', dc: 12, fail: 'toll-refused' }, end: true },
        ],
      },
      'toll-refused': { speaker: 'narrator', text: '"No coin, no crossing." He plants himself squarely in your path until you produce it.', end: true },
    },
  },
  {
    id: 'dlg.generic.herder', historical: 'invented', note: 'Generic crowd archetype flavor. LORE.md §8.', root: 'talk',
    nodes: {
      talk: {
        speaker: 'narrator', text: 'A herder leans on a staff, watching cattle pick their way up a slope. "Good grazing this year, God willing it stays that way. You\'re not from these parts, by your boots."',
        choices: [{ text: 'Ask about the alps nearby.', next: 'alps' }, { text: 'Good day to you.', end: true }],
      },
      alps: { speaker: 'narrator', text: '"Higher up, the grass is better but the weather turns without warning. Mind the mist if you go — a man can walk off an edge he never saw."', end: true },
    },
  },
  {
    id: 'dlg.generic.child', historical: 'invented', note: 'Generic crowd archetype flavor, present for colour only — never a combatant. LORE.md §8.', root: 'talk',
    nodes: {
      talk: {
        speaker: 'narrator', text: 'A child stares up at you, more curious about your weapon than your errand. "Are you a soldier? Have you killed anyone? Mother says I\'m not to ask that."',
        choices: [{ text: 'Smile and say nothing.', end: true }, { text: '"Go on home now."', end: true }],
      },
    },
  },
  {
    id: 'dlg.generic.merchant', historical: 'invented', note: 'Generic crowd archetype flavor. LORE.md §7/§8.', root: 'talk',
    nodes: {
      talk: {
        speaker: 'narrator', text: '"Cloth, salt, a little cheese if you\'ve the coin for Alpkäse — I carry what sells between here and Luzern." The trader eyes your purse rather than your face.',
        choices: [{ text: 'Ask about prices on the road.', next: 'prices' }, { text: 'Not buying today.', end: true }],
      },
      prices: { speaker: 'narrator', text: '"Higher past every toll station, naturally. A Zürich Pfund buys less at Küssnacht than it does at Schwyz — the bailiffs see to that."', end: true },
    },
  },
  {
    id: 'dlg.generic.elder', historical: 'invented', note: 'Generic crowd archetype flavor, a Landsgemeinde figure. LORE.md §8.', root: 'talk',
    nodes: {
      talk: {
        speaker: 'narrator', text: 'An old man of the Landsgemeinde nods slowly at you. "I\'ve sat through more meadow-meetings than I care to count. Ask an old man\'s opinion and you\'ll get one, free of charge."',
        choices: [{ text: 'Ask for his opinion.', next: 'opinion' }, { text: 'Some other time, Ammann.', end: true }],
      },
      opinion: { speaker: 'narrator', text: '"Things were simpler before the bailiffs, and harder before that, and simpler still before the harder times. An old man\'s memory smooths a great deal, mind you."', end: true },
    },
  },
];

export function register(c: ContentRegistry): void {
  c.addDialogues(genericDialogues);
}
