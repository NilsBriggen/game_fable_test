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
        choices: [
          { text: 'Lead the train through.', next: 'depart' },
          { text: '"The pass is no place for me this season."', end: true },
        ],
      },
      depart: { speaker: 'npc.niklaus-planzer', text: '"Good. Keep to the outside of the bends and mind the mules — they\'ll balk before you see the danger yourself, half the time."', effects: [{ quest: ['start', 'quest.der-saeumer'] }], end: true },
    },
  },
  {
    id: 'dlg.saeumer-crossing', historical: 'invented', note: "The Teufelsbrücke crossing hazard is I dressing on an H bridge (c. 1220-30). LORE.md §4/§6.", root: 'bridge',
    nodes: {
      bridge: {
        speaker: 'narrator', text: 'The Teufelsbrücke spans the gorge in a single narrow arch, spray from the falls slicking the timber underfoot. One mule already balks at the noise.',
        choices: [
          { text: 'Lead the train across steadily.', check: { skill: 'athletics', dc: 13, fail: 'stumble' }, next: 'across' },
          { text: 'Unload the worst mule and lead it across empty — safer, at the cost of a day.', effects: [{ advanceTime: 6 }], next: 'across' },
          { text: 'Risk it: drive the laden train straight across the arch.', check: { skill: 'athletics', dc: 15, fail: 'ledge-fight' }, next: 'across' },
        ],
      },
      across: { speaker: 'narrator', text: 'Every mule makes it across without losing its footing — a clean crossing, and Niklaus claps you on the shoulder for it.', effects: [{ setVar: ['quest.der-saeumer', 'crossing', 'clean'] }, { quest: ['advance', 'quest.der-saeumer', 'reward-clean'] }], end: true },
      stumble: { speaker: 'narrator', text: 'A mule\'s load shifts badly on the narrow footing and a salt sack goes into the gorge before you can steady it — the rest make it across, at least.', effects: [{ setVar: ['quest.der-saeumer', 'crossing', 'rough'] }, { quest: ['advance', 'quest.der-saeumer', 'reward-rough'] }], end: true },
      'ledge-fight': {
        speaker: 'narrator', text: 'The driven mules panic mid-arch — the train jams against the parapet with the gorge yawning below, and a sack is already half over the edge.',
        choices: [
          { text: 'Throw your weight against the jammed mule and heave it clear.', check: { skill: 'athletics', dc: 13, fail: 'ledge-loss' }, next: 'ledge-held' },
          { text: 'Cut the worst load loose and save the train.', next: 'ledge-loss' },
        ],
      },
      'ledge-held': { speaker: 'narrator', text: 'You haul the beast back onto its feet by main force and the train steadies — shaken, but with every load still on its back. Niklaus stares, then laughs with relief.', effects: [{ skillXp: ['athletics', 10] }, { setVar: ['quest.der-saeumer', 'crossing', 'clean'] }, { quest: ['advance', 'quest.der-saeumer', 'reward-clean'] }], end: true },
      'ledge-loss': { speaker: 'narrator', text: 'A mule goes over with half its salt before you can hold it — the rest bawl and steady, but the gorge keeps its toll. Niklaus marks the loss in his tally without a word.', effects: [{ setVar: ['quest.der-saeumer', 'crossing', 'rough'] }, { quest: ['advance', 'quest.der-saeumer', 'reward-rough'] }], end: true },
    },
  },
  // ---------------------------------------------------------------- Alpstreit
  {
    id: 'dlg.alpstreit-dispute', historical: 'invented', note: 'The arbitration clause is H (Bundesbrief); this specific boundary dispute is I. LORE.md §6.',
    root: 'dispute',
    nodes: {
      dispute: {
        speaker: 'npc.melchior-arnold', text: 'The farmer points up-slope with his staff. "The Arth herders have moved their boundary stones again, {player} — a stone\'s throw further onto Schwyz grass every summer, and I\'m tired of arguing it myself."',
        choices: [
          { text: 'Hear him out, and offer to arbitrate.', next: 'agree' },
          { text: '"Boundary stones are the Landsgemeinde\'s business, not mine."', end: true },
        ],
      },
      agree: { speaker: 'npc.melchior-arnold', text: '"The Bundesbrief itself says a quarrel among us goes to judgment before the sword. Let\'s see if that\'s more than ink."', effects: [{ quest: ['start', 'quest.alpstreit'] }], end: true },
    },
  },
  {
    id: 'dlg.alpstreit-inspect', historical: 'invented', note: 'Observing the moved stones on the alp is I dressing on attested boundary practice (annual beating of the bounds). LORE.md §6.', root: 'slope',
    nodes: {
      slope: {
        speaker: 'narrator', text: 'Up on the slope the cut turf tells its own story: three stones sit fresh-turned, their grass lips still green underneath, a stone\'s throw down-hill from the weathered sockets where they stood for years.',
        choices: [
          { text: 'Kneel and read the turf and sockets closely.', check: { skill: 'alpine', dc: 12, fail: 'glance' }, next: 'keen-eyed' },
          { text: 'Walk the line of the stones and take their measure by eye.', next: 'glance' },
        ],
      },
      'keen-eyed': { speaker: 'narrator', text: 'No mistaking it: the Arth herders have shifted the marks onto Schwyz grass, fresh earth under each one. When you rule, you will rule knowing exactly what was done.', effects: [{ setVar: ['quest.alpstreit', 'inspected', 'keen'] }, { skillXp: ['alpine', 10] }, { quest: ['advance', 'quest.alpstreit', 'hearing'] }], end: true },
      glance: { speaker: 'narrator', text: 'The stones stand where the herders say they stood — or near enough that your eye cannot prove otherwise. You will have to rule on the claims alone.', effects: [{ setVar: ['quest.alpstreit', 'inspected', 'glance'] }, { quest: ['advance', 'quest.alpstreit', 'hearing'] }], end: true },
    },
  },
  {
    id: 'dlg.alpstreit-hearing', historical: 'invented', note: 'Applies the Bundesbrief\'s arbitration clause (H mechanic) to an I dispute. LORE.md §6.', root: 'hearing',
    nodes: {
      hearing: {
        speaker: 'narrator', text: 'Both sides lay their claims before you at the letzi — old boundary stones, half-remembered grazing rights, and no small amount of pride.',
        variants: [
          { condition: { var: ['quest.alpstreit', 'inspected', 'keen'] }, text: 'Both sides lay their claims before you at the letzi — and you carry the fresh-turned turf of the slope in your memory as they speak, old sockets against new stones.' },
        ],
        choices: [
          { text: 'Weigh the claims fairly and rule.', check: { skill: 'speech', dc: 15, fail: 'ruling-rejected' }, next: 'ruling-accepted' },
          { text: 'Divide the disputed ground by the old stones and have done.', next: 'ruling-rejected' },
        ],
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
        choices: [
          { text: 'Offer to speak to the toll collector.', next: 'agree' },
          { text: '"Toll-men and fish carts are none of my affair."', end: true },
        ],
      },
      agree: { speaker: 'npc.uli-fischer', text: '"Bei Sankt Verena, someone finally willing to say something. His name\'s Konrad Niederberger — you\'ll find him at the Brunnen quay road, self-important as a bishop."', effects: [{ quest: ['start', 'quest.fischer-von-gersau'] }], end: true },
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
          { text: 'Leave him to his ledger — for now.', next: 'confront-fail' },
        ],
      },
      'confront-success': { speaker: 'narrator', text: 'He grumbles, but the fish carts roll past unmolested from that day on — a small victory, but Gersau will remember it.', effects: [{ rep: ['habsburg', -2] }, { setVar: ['quest.fischer-von-gersau', 'toll', 'beaten'] }, { quest: ['advance', 'quest.fischer-von-gersau', 'freedom'] }], end: true },
      'confront-fail': { speaker: 'narrator', text: '"Free village or not, the road\'s the bailiff\'s road." He won\'t budge — but he does agree, grudgingly, to stop harassing the smaller carts.', effects: [{ setVar: ['quest.fischer-von-gersau', 'toll', 'standing'] }, { quest: ['advance', 'quest.fischer-von-gersau', 'tribute'] }], end: true },
    },
  },
  {
    id: 'dlg.fischer-gersau-return', historical: 'invented', note: 'Return-to-Uli beat; the toll-man Konrad Niederberger is himself an I NPC. LORE.md §6.', root: [
      { condition: { var: ['quest.fischer-von-gersau', 'toll', 'beaten'] }, node: 'freedom' },
      { condition: { var: ['quest.fischer-von-gersau', 'toll', 'standing'] }, node: 'tribute' },
    ],
    nodes: {
      freedom: { speaker: 'npc.uli-fischer', text: '"Unmolested, you say? Bei Sankt Verena, that is the first good news these nets have heard all year. Konrad will think twice before he stops a Gersau cart again — and so will the next toll-man who takes his seat."', effects: [{ rep: ['schwyz', 4] }, { quest: ['complete', 'quest.fischer-von-gersau'] }], end: true },
      tribute: { speaker: 'npc.uli-fischer', text: '"So the toll stands, and we pay for the road we always walked free. Aye — but the small carts pass, and Konrad knows Gersau watches him now. It is not freedom, {player}, but it is not nothing either."', effects: [{ setFlag: ['gersau-toll-owed', true] }, { rep: ['schwyz', 2] }, { quest: ['complete', 'quest.fischer-von-gersau'] }], end: true },
    },
  },
  // ---------------------------------------------------------------- Der Drache vom Pilatus
  {
    id: 'dlg.drache-pilatus', historical: 'legend', note: "The Pilatus 'dragon' is explicitly folk legend told as a story, not a monster in play — a lammergeier and a smuggler. LORE.md §3/§6.",
    root: 'rumour',
    nodes: {
      rumour: {
        speaker: 'npc.trudi-meier', text: 'The innkeeper leans in, lowering her voice the way tavern-keepers do before the best gossip. "They say a dragon\'s been seen circling Pilatus again, {player} — a brother from the mountain swears he saw it stoop on a goat."',
        choices: [
          { text: 'Offer to go look into it.', next: 'agree' },
          { text: '"Dragons keep to their mountains, and I to my road."', end: true },
        ],
      },
      agree: { speaker: 'npc.trudi-meier', text: '"Bless you. Whatever it is, it\'s been unsettling the herders — and I\'d sleep easier not hearing about it over every cup I pour. A brother of Engelberg who drinks here says the mountain keeps old bones; ask after him if the trail runs cold."', effects: [{ quest: ['start', 'quest.drache-vom-pilatus'] }], end: true },
    },
  },
  {
    id: 'dlg.drache-pilatus-truth', historical: 'legend', note: "The 'dragon' resolves to a lammergeier and a smuggler — explicitly no monster, per the task spec and LORE.md §6.", root: 'summit',
    nodes: {
      summit: {
        speaker: 'narrator', text: 'High on the Pilatus alp, the "dragon" reveals itself: a lammergeier, vast wingspan and all, stooping on goats same as any bearded vulture — and, tucked in a hollow below its favoured cliff, a smuggler\'s cache of untaxed salt.',
        choices: [
          { text: 'Catch the smuggler quietly rather than raise an alarm.', check: { skill: 'stealth', dc: 13, fail: 'smuggler-flees' }, next: 'smuggler-caught' },
          { text: 'Mark the cache and climb back down to report it.', next: 'smuggler-flees' },
        ],
      },
      'smuggler-caught': { speaker: 'narrator', text: 'The smuggler surrenders without a fight once he sees he\'s cornered — and to keep the matter quiet he shows you where the salt is stacked, sack upon sack, under a weighed-down hide.', effects: [{ discover: 'poi.fraekmuentegg' }, { setVar: ['quest.drache-vom-pilatus', 'cache', 'marked'] }, { rep: ['luzern', 4] }, { skillXp: ['stealth', 10] }], end: true },
      'smuggler-flees': { speaker: 'narrator', text: 'He bolts down a scree slope before you can close the distance — gone, but in his hurry he drops the hide that covered the cache: salt sacks stacked in the hollow, plain as day. No dragon — but a smuggler\'s store worth hauling.', effects: [{ discover: 'poi.fraekmuentegg' }, { setVar: ['quest.drache-vom-pilatus', 'cache', 'marked'] }, { rep: ['luzern', 2] }], end: true },
    },
  },
  {
    id: 'dlg.drache-pilatus-cache', historical: 'legend', note: "The salt cache is the smuggler's store from the summit scene — untaxed Gotthard salt (H trade), opened as a discovered cache beat. LORE.md §6.", root: 'cache',
    nodes: {
      cache: {
        speaker: 'narrator', text: 'The cache lies where the smuggler left it: sacks of white salt under a weighed hide, more than one man could carry in a season — untaxed, and worth a small fortune on the Luzern market.',
        choices: [
          { text: 'Haul a sack down to Luzern and hand the rest to the herders.', next: 'share' },
          { text: 'Take what you can carry and leave no trace of the rest.', check: { skill: 'stealth', dc: 12, fail: 'share' }, next: 'quiet' },
        ],
      },
      share: { speaker: 'narrator', text: 'You shoulder a sack for the road and leave the herders grinning over the rest — Trudi will hear how the "dragon\'s hoard" fed half the alp.', effects: [{ giveItem: ['item.salt-sack', 1] }, { rep: ['luzern', 2] }, { quest: ['advance', 'quest.drache-vom-pilatus', 'resolution'] }], end: true },
      quiet: { speaker: 'narrator', text: 'You take a full sack and sweep the hollow clean behind you — none will ever know how much salt the "dragon" was sitting on.', effects: [{ giveItem: ['item.salt-sack', 1] }, { skillXp: ['stealth', 10] }, { quest: ['advance', 'quest.drache-vom-pilatus', 'resolution'] }], end: true },
    },
  },
  // ---------------------------------------------------------------- Schützenkönig
  {
    id: 'dlg.schuetzenkoenig-entry', historical: 'invented', note: 'Formal Schützenfest competitions are attested later; a crossbow contest here is I. LORE.md §6.',
    root: 'entry',
    nodes: {
      entry: {
        speaker: 'npc.burkhard-wyrsch', text: '"We\'re holding a shoot by the lime tree come market day, {player} — every man in Uri with a crossbow worth the name is entering. Let\'s see if your aim matches your talk."',
        choices: [
          { text: 'Enter the contest.', next: 'enter' },
          { text: '"My bolt is spoken for elsewhere, Burkhard."', end: true },
        ],
      },
      enter: { speaker: 'npc.burkhard-wyrsch', text: '"Good. The mark\'s at eighty paces, same distance they say Tell shot from — though nobody\'s foolish enough to put an apple on a head for this one."', effects: [{ quest: ['start', 'quest.schuetzenkoenig'] }], end: true },
    },
  },
  {
    id: 'dlg.schuetzenkoenig-contest', historical: 'invented', note: 'I side quest, no historical claim beyond the general plausibility of shooting contests. LORE.md §6.', root: 'heats',
    nodes: {
      heats: {
        speaker: 'narrator', text: 'The mark stands eighty paces off, ringed in chalk. The early heats are already decided: old Sepp shot wide of the outer ring, young Ruedi split the inner chalk, and Burkhard himself holds the lead with a bolt a finger\'s breadth from the centre.',
        choices: [
          { text: 'Step up for the last heat.', next: 'shoot' },
          { text: 'Ask Burkhard how the others fared before you shoot.', next: 'talk' },
        ],
      },
      talk: {
        speaker: 'npc.burkhard-wyrsch', text: '"Sepp\'s bolt went wide as a barn door — the years have him. Ruedi\'s sits on the inner chalk, and mine\'s a finger from the centre. Beat mine, {player}, and the crown is yours; match Ruedi\'s and you place second."',
        choices: [
          { text: 'Take your shot.', next: 'shoot' },
        ],
      },
      shoot: {
        speaker: 'narrator', text: 'The crowd hushes. Ruedi\'s inner-ring bolt and Burkhard\'s near-centre shot stand chalked on the board — yours is the last bolt of the day.',
        choices: [
          { text: 'Aim for the crown — Burkhard\'s mark or nothing.', check: { skill: 'crossbow', dc: 18, fail: 'shoot-beaten' }, next: 'shoot-crown' },
          { text: 'Shoot steadily for a good placing.', check: { skill: 'crossbow', dc: 13, fail: 'shoot-last' }, next: 'shoot-placed' },
        ],
      },
      'shoot-crown': { speaker: 'narrator', text: 'Dead centre — inside even Burkhard\'s mark. The crowd goes quiet a moment before it cheers. You are, for this market day at least, Schützenkönig.', effects: [{ pfennig: 15 }, { rep: ['uri', 8] }, { setVar: ['quest.schuetzenkoenig', 'placing', 'crown'] }, { quest: ['advance', 'quest.schuetzenkoenig', 'prize'] }], end: true },
      'shoot-placed': { speaker: 'narrator', text: 'A fair bolt on the inner chalk — good enough to stand beside Ruedi\'s, though Burkhard\'s mark holds the day. Second place, and no shame in it.', effects: [{ pfennig: 8 }, { rep: ['uri', 5] }, { setVar: ['quest.schuetzenkoenig', 'placing', 'placed'] }, { quest: ['advance', 'quest.schuetzenkoenig', 'prize'] }], end: true },
      'shoot-beaten': { speaker: 'narrator', text: 'Your bolt flies true but wide of Burkhard\'s mark — third, behind him and Ruedi. Burkhard keeps the crown, and tells you so with a grin.', effects: [{ pfennig: 5 }, { rep: ['uri', 3] }, { setVar: ['quest.schuetzenkoenig', 'placing', 'beaten'] }, { quest: ['advance', 'quest.schuetzenkoenig', 'prize'] }], end: true },
      'shoot-last': { speaker: 'narrator', text: 'The bolt strays wide as Sepp\'s — last of the heats. The crowd is kind about it, which somehow stings worse.', effects: [{ rep: ['uri', 1] }, { setVar: ['quest.schuetzenkoenig', 'placing', 'last'] }, { quest: ['advance', 'quest.schuetzenkoenig', 'prize'] }], end: true },
    },
  },
  // ---------------------------------------------------------------- Das Bad zu Wolfenschiessen
  {
    id: 'dlg.bad-wolfenschiessen', historical: 'legend', note: "The bath-house killing of the bailiff's man at Wolfenschiessen is L tradition, told here as a done thing the party helps conceal. LORE.md §6.",
    root: 'rumour',
    nodes: {
      rumour: {
        speaker: 'npc.jost-durrer', text: 'Jost lowers his voice, though there\'s no one else in the yard. "You\'ll have heard, maybe, that the bailiff\'s man who troubled a certain house here won\'t be troubling anyone again. What you haven\'t heard is best kept that way, {player}."',
        choices: [
          { text: '"I can keep a silence as well as anyone."', next: 'agree' },
          { text: '"I want no part in buried secrets, Jost."', end: true },
        ],
      },
      agree: { speaker: 'npc.jost-durrer', text: '"Then there\'s a body wants a quiet grave and a story wants a quiet ending, before some clerk from Landenberg\'s hill comes asking questions we\'d rather not answer."', effects: [{ quest: ['start', 'quest.bad-zu-wolfenschiessen'] }], end: true },
    },
  },
  {
    id: 'dlg.bad-wolfenschiessen-hide', historical: 'legend', note: 'I dressing on the L bath-house tradition. LORE.md §6.', root: 'hide',
    nodes: {
      hide: {
        speaker: 'narrator', text: 'Between the burial by lantern-light and the story the household will tell if anyone from Sarnen comes asking, there is a great deal that wants doing quietly before dawn — and the sky is already paling in the east.',
        choices: [
          { text: 'Work through the night without rest.', check: { skill: 'stealth', dc: 12, fail: 'hide-messy' }, next: 'hide-clean' },
          { text: 'Do the plain work and leave the fine details be.', next: 'hide-messy' },
        ],
      },
      'hide-clean': { speaker: 'narrator', text: 'By first light there is nothing left to find, and the household\'s story is straight enough to survive any clerk\'s questions.', effects: [{ advanceTime: 4 }, { rep: ['unterwalden', 6] }, { setVar: ['quest.bad-zu-wolfenschiessen', 'haste', 'dawn-met'] }, { quest: ['advance', 'quest.bad-zu-wolfenschiessen', 'quiet'] }], end: true },
      'hide-messy': { speaker: 'narrator', text: 'It is done, but not so cleanly that a sharp-eyed clerk would find nothing at all — a risk the household will simply have to live with.', effects: [{ advanceTime: 4 }, { rep: ['unterwalden', 3] }, { setVar: ['quest.bad-zu-wolfenschiessen', 'haste', 'slow'] }, { quest: ['advance', 'quest.bad-zu-wolfenschiessen', 'exposed'] }], end: true },
    },
  },
  {
    id: 'dlg.bad-wolfenschiessen-clerk', historical: 'legend', note: 'The clerk from Landenberg\'s hill is the Vogt-Schreiber apparatus (LORE.md §5) come asking after I sloppiness. LORE.md §6.', root: 'warning',
    nodes: {
      warning: {
        speaker: 'npc.jost-durrer', text: 'Jost finds you before you leave the yard, his face grey in the morning light. "That was too slow, {player} — a rider from Sarnen passed at prime and asked after strangers on the road. Some clerk of Landenberg\'s will be at our door before the week is out, mark me."',
        choices: [
          { text: '"Then we hold to the story, every word of it."', next: 'oath' },
          { text: '"Deny everything, and deny knowing me."', next: 'cold' },
        ],
      },
      oath: { speaker: 'npc.jost-durrer', text: '"Aye. The bath-house was quiet, the night was quiet, and no stranger passed this way. Say it often enough and even you will believe it."', effects: [{ rep: ['unterwalden', 2] }, { rep: ['habsburg', -2] }, { quest: ['complete', 'quest.bad-zu-wolfenschiessen'] }], end: true },
      cold: { speaker: 'npc.jost-durrer', text: 'He nods slowly, and something cools between you. "As you say. Strangers pass, strangers go — that will be our story about you, too."', effects: [{ rep: ['habsburg', 2] }, { quest: ['complete', 'quest.bad-zu-wolfenschiessen'] }], end: true },
    },
  },
];

export function register(c: ContentRegistry): void {
  c.addDialogues(sideDialogues);
}
