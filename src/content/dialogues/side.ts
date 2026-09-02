/**
 * Side-quest dialogues, triggered by `quest.*` stage `onEnter: [{dialogue: '...'}]` effects
 * (see src/content/quests/side/*). Speakers are existing minor NPCs from src/content/npcs.ts whose own
 * descriptions already hook these plots (Wolfenschiessen's bath-house, Gersau's free-village toll fight,
 * a Gotthard muleteer's Schöllenen run). LORE.md §6/§8.
 */
import type { ContentRegistry } from '@core/content';
import type { DialogueDef } from '@core/schemas';

export const sideDialogues: DialogueDef[] = [
  // ---------------------------------------------------------------- Der Säumer
  {
    id: 'dlg.saeumer-escort', historical: 'invented', note: 'Side quest; Säumer cooperatives H, this escort is I. LORE.md §6.',
    root: 'offer',
    nodes: {
      offer: {
        speaker: 'npc.niklaus-planzer', text: 'The muleteer checks a last girth strap. "Salt and cloth for Ursern, over the Schöllenen — and the Teufelsbrücke\'s footing is treacherous since the spring melt. An extra pair of eyes wouldn\'t go amiss, {player}."',
        choices: [{ text: 'Lead the train through.', next: 'depart' }],
      },
      depart: { speaker: 'npc.niklaus-planzer', text: '"Good. Keep to the outside of the bends and mind the mules — they\'ll balk before you see the danger yourself, half the time."', end: true },
    },
  },
  {
    id: 'dlg.saeumer-crossing', historical: 'invented', note: "The Teufelsbrücke crossing hazard is I dressing on an H bridge (c. 1220-30). LORE.md §4/§6.", root: 'bridge',
    nodes: {
      bridge: {
        speaker: 'narrator', text: 'The Teufelsbrücke spans the gorge in a single narrow arch, spray from the falls slicking the timber underfoot. One mule already balks at the noise.',
        choices: [{ text: 'Lead the train across steadily.', check: { skill: 'athletics', dc: 13, fail: 'stumble' }, next: 'across' }],
      },
      across: { speaker: 'narrator', text: 'Every mule makes it across without losing its footing — a clean crossing, and Niklaus claps you on the shoulder for it.', effects: [{ setVar: ['quest.der-saeumer', 'crossing', 'clean'] }, { quest: ['advance', 'quest.der-saeumer', 'reward'] }], end: true },
      stumble: { speaker: 'narrator', text: 'A mule\'s load shifts badly on the narrow footing and a salt sack goes into the gorge before you can steady it — the rest make it across, at least.', effects: [{ setVar: ['quest.der-saeumer', 'crossing', 'rough'] }, { quest: ['advance', 'quest.der-saeumer', 'reward'] }], end: true },
    },
  },
  // ---------------------------------------------------------------- Alpstreit
  {
    id: 'dlg.alpstreit-dispute', historical: 'invented', note: 'The arbitration clause is H (Bundesbrief); this specific boundary dispute is I. LORE.md §6.',
    root: 'dispute',
    nodes: {
      dispute: {
        speaker: 'npc.melchior-arnold', text: 'The farmer points up-slope with his staff. "The Arth herders have moved their boundary stones again, {player} — a stone\'s throw further onto Schwyz grass every summer, and I\'m tired of arguing it myself."',
        choices: [{ text: 'Hear him out, and offer to arbitrate.', next: 'agree' }],
      },
      agree: { speaker: 'npc.melchior-arnold', text: '"The Bundesbrief itself says a quarrel among us goes to judgment before the sword. Let\'s see if that\'s more than ink."', effects: [{ quest: ['advance', 'quest.alpstreit', 'hearing'] }], end: true },
    },
  },
  {
    id: 'dlg.alpstreit-hearing', historical: 'invented', note: 'Applies the Bundesbrief\'s arbitration clause (H mechanic) to an I dispute. LORE.md §6.', root: 'hearing',
    nodes: {
      hearing: {
        speaker: 'narrator', text: 'Both sides lay their claims before you on the disputed slope — old boundary stones, half-remembered grazing rights, and no small amount of pride.',
        choices: [{ text: 'Weigh the claims fairly and rule.', check: { skill: 'speech', dc: 15, fail: 'ruling-rejected' }, next: 'ruling-accepted' }],
      },
      'ruling-accepted': { speaker: 'narrator', text: 'Your judgment — the boundary restored to the old stones, with both herds granted a fair week\'s grazing each on the disputed ground — satisfies neither side entirely, which the elders tell you is the surest sign of a fair ruling.', effects: [{ rep: ['schwyz', 8] }, { quest: ['advance', 'quest.alpstreit', 'ruling'] }], end: true },
      'ruling-rejected': { speaker: 'narrator', text: 'Your ruling satisfies no one, and the Arth herders mutter about moving the stones back the moment your back is turned. Still, blood was not drawn over it — for now.', effects: [{ rep: ['schwyz', 2] }, { quest: ['advance', 'quest.alpstreit', 'ruling'] }], end: true },
    },
  },
  // ---------------------------------------------------------------- Die Fischer von Gersau
  {
    id: 'dlg.fischer-gersau', historical: 'invented', note: "Gersau's free-village status is H (later a free republic); this toll dispute is I. LORE.md §3/§6.",
    root: 'trouble',
    nodes: {
      trouble: {
        speaker: 'npc.uli-fischer', text: '"We\'re a free village, {player}, answer to no lord — and still the Brunnen toll-men stop our fish carts on the shore road as if we owed them something." The fisherman spits into the lake for emphasis.',
        choices: [{ text: 'Offer to speak to the toll collector.', next: 'agree' }],
      },
      agree: { speaker: 'npc.uli-fischer', text: '"Bei Sankt Verena, someone finally willing to say something. His name\'s Konrad Niederberger — you\'ll find him at the Brunnen quay road, self-important as a bishop."', effects: [{ quest: ['advance', 'quest.fischer-von-gersau', 'confront'] }], end: true },
    },
  },
  {
    id: 'dlg.fischer-gersau-confront', historical: 'invented', note: 'I side-quest content; the Habsburg road-toll practice at Brunnen is H in kind. LORE.md §6.', root: 'confront',
    nodes: {
      confront: {
        speaker: 'narrator', text: 'The toll-man looks up from his ledger, unbothered. "Gersau pays the shore toll like everyone else who wants to keep their fish."',
        choices: [
          { text: '"Gersau owes no lord a toll, and you know it."', check: { skill: 'speech', dc: 14, fail: 'confront-fail' }, next: 'confront-success' },
          { text: 'Pay him off quietly (5 Pfennig) to leave Gersau be.', condition: { pfennig: ['>=', 5] }, effects: [{ pfennig: -5 }], next: 'confront-success' },
        ],
      },
      'confront-success': { speaker: 'narrator', text: 'He grumbles, but the fish carts roll past unmolested from that day on — a small victory, but Gersau will remember it.', effects: [{ rep: ['habsburg', -2] }, { quest: ['advance', 'quest.fischer-von-gersau', 'resolution'] }], end: true },
      'confront-fail': { speaker: 'narrator', text: '"Free village or not, the road\'s the bailiff\'s road." He won\'t budge — but he does agree, grudgingly, to stop harassing the smaller carts.', effects: [{ quest: ['advance', 'quest.fischer-von-gersau', 'resolution'] }], end: true },
    },
  },
  // ---------------------------------------------------------------- Der Drache vom Pilatus
  {
    id: 'dlg.drache-pilatus', historical: 'legend', note: "The Pilatus 'dragon' is explicitly folk legend told as a story, not a monster in play — a lammergeier and a smuggler. LORE.md §3/§6.",
    root: 'rumour',
    nodes: {
      rumour: {
        speaker: 'npc.trudi-meier', text: 'The innkeeper leans in, lowering her voice the way tavern-keepers do before the best gossip. "They say a dragon\'s been seen circling Pilatus again, {player} — a brother from the mountain swears he saw it stoop on a goat."',
        choices: [{ text: 'Offer to go look into it.', next: 'agree' }],
      },
      agree: { speaker: 'npc.trudi-meier', text: '"Bless you. Whatever it is, it\'s been unsettling the herders — and I\'d sleep easier not hearing about it over every cup I pour."', effects: [{ quest: ['advance', 'quest.drache-vom-pilatus', 'climb'] }], end: true },
    },
  },
  {
    id: 'dlg.drache-pilatus-truth', historical: 'legend', note: "The 'dragon' resolves to a lammergeier and a smuggler — explicitly no monster, per the task spec and LORE.md §6.", root: 'summit',
    nodes: {
      summit: {
        speaker: 'narrator', text: 'High on the Pilatus alp, the "dragon" reveals itself: a lammergeier, vast wingspan and all, stooping on goats same as any bearded vulture — and, tucked in a hollow below its favoured cliff, a smuggler\'s cache of untaxed salt.',
        choices: [{ text: 'Catch the smuggler quietly rather than raise an alarm.', check: { skill: 'stealth', dc: 13, fail: 'smuggler-flees' }, next: 'smuggler-caught' }],
      },
      'smuggler-caught': { speaker: 'narrator', text: 'The smuggler surrenders without a fight once he sees he\'s cornered — and hands over a share of the cache to keep the matter quiet.', effects: [{ giveItem: ['item.salt-sack', 1] }, { rep: ['luzern', 6] }, { quest: ['advance', 'quest.drache-vom-pilatus', 'resolution'] }], end: true },
      'smuggler-flees': { speaker: 'narrator', text: 'He bolts down a scree slope before you can close the distance — gone, but so is the mystery. A lammergeier, and a smuggler\'s empty cache. No dragon.', effects: [{ rep: ['luzern', 2] }, { quest: ['advance', 'quest.drache-vom-pilatus', 'resolution'] }], end: true },
    },
  },
  // ---------------------------------------------------------------- Schützenkönig
  {
    id: 'dlg.schuetzenkoenig-entry', historical: 'invented', note: 'Formal Schützenfest competitions are attested later; a crossbow contest here is I. LORE.md §6.',
    root: 'entry',
    nodes: {
      entry: {
        speaker: 'npc.burkhard-wyrsch', text: '"We\'re holding a shoot by the lime tree come market day, {player} — every man in Uri with a crossbow worth the name is entering. Care to put your aim where your boasting is?"',
        choices: [{ text: 'Enter the contest.', next: 'enter' }],
      },
      enter: { speaker: 'npc.burkhard-wyrsch', text: '"Good. The mark\'s at eighty paces, same distance they say Tell shot from — though nobody\'s foolish enough to put an apple on a head for this one."', effects: [{ quest: ['advance', 'quest.schuetzenkoenig', 'contest'] }], end: true },
    },
  },
  {
    id: 'dlg.schuetzenkoenig-contest', historical: 'invented', note: 'I side quest, no historical claim beyond the general plausibility of shooting contests. LORE.md §6.', root: 'shoot',
    nodes: {
      shoot: {
        speaker: 'narrator', text: 'The mark stands eighty paces off, ringed in chalk. A dozen Uri men have already tried and missed the centre.',
        choices: [{ text: 'Take your shot.', check: { skill: 'crossbow', dc: 16, fail: 'shoot-miss' }, next: 'shoot-hit' }],
      },
      'shoot-hit': { speaker: 'narrator', text: 'Dead centre — the crowd goes quiet a moment before it cheers. You are, for this market day at least, Schützenkönig.', effects: [{ pfennig: 15 }, { rep: ['uri', 8] }, { quest: ['advance', 'quest.schuetzenkoenig', 'prize'] }], end: true },
      'shoot-miss': { speaker: 'narrator', text: 'A good shot, but not the winning one — you place well enough to be remembered, if not crowned.', effects: [{ pfennig: 5 }, { rep: ['uri', 3] }, { quest: ['advance', 'quest.schuetzenkoenig', 'prize'] }], end: true },
    },
  },
  // ---------------------------------------------------------------- Das Bad zu Wolfenschiessen
  {
    id: 'dlg.bad-wolfenschiessen', historical: 'legend', note: "The bath-house killing of the bailiff's man at Wolfenschiessen is L tradition, told here as a done thing the party helps conceal. LORE.md §6.",
    root: 'rumour',
    nodes: {
      rumour: {
        speaker: 'npc.jost-durrer', text: 'Jost lowers his voice, though there\'s no one else in the yard. "You\'ll have heard, maybe, that the bailiff\'s man who troubled a certain house here won\'t be troubling anyone again. What you haven\'t heard is best kept that way, {player}."',
        choices: [{ text: '"I can keep a silence as well as anyone."', next: 'agree' }],
      },
      agree: { speaker: 'npc.jost-durrer', text: '"Then there\'s a body wants a quiet grave and a story wants a quiet ending, before some clerk from Landenberg\'s hill comes asking questions we\'d rather not answer."', effects: [{ quest: ['advance', 'quest.bad-zu-wolfenschiessen', 'help-hide'] }], end: true },
    },
  },
  {
    id: 'dlg.bad-wolfenschiessen-hide', historical: 'legend', note: 'I dressing on the L bath-house tradition. LORE.md §6.', root: 'hide',
    nodes: {
      hide: {
        speaker: 'narrator', text: 'Between the burial by lantern-light and the story the household will tell if anyone from Sarnen comes asking, there is a great deal that wants doing quietly before dawn.',
        choices: [{ text: 'See to it quietly.', check: { skill: 'stealth', dc: 12, fail: 'hide-messy' }, next: 'hide-clean' }],
      },
      'hide-clean': { speaker: 'narrator', text: 'By first light there is nothing left to find, and the household\'s story is straight enough to survive any clerk\'s questions.', effects: [{ rep: ['unterwalden', 6] }, { quest: ['advance', 'quest.bad-zu-wolfenschiessen', 'resolution'] }], end: true },
      'hide-messy': { speaker: 'narrator', text: 'It is done, but not so cleanly that a sharp-eyed clerk would find nothing at all — a risk the household will simply have to live with.', effects: [{ rep: ['unterwalden', 3] }, { quest: ['advance', 'quest.bad-zu-wolfenschiessen', 'resolution'] }], end: true },
    },
  },
];

export function register(c: ContentRegistry): void {
  c.addDialogues(sideDialogues);
}
