/**
 * dialogues for the named/historical cast — `dlg.<npc-slug>`, matching `NpcDef.dialogueRoot` exactly as
 * set in src/content/npcs.ts. Root varies by chapter (and, for a few, by the current main-quest stage) so
 * the same NPC has something different to say in 1291, 1307 and 1314. LORE.md §5/§8: period register
 * ("Ammann", "Herr Vogt", "Freiherr", "Bruder", "Bei Sankt Verena!"), no anachronism.
 */
import type { ContentRegistry } from '@core/content';
import type { DialogueDef } from '@core/schemas';

export const namedCastDialogues: DialogueDef[] = [
  // ---------------------------------------------------------------- Werner Stauffacher
  {
    id: 'dlg.werner-stauffacher', historical: 'legend', note: 'L role (Tschudi/Weisses Buch); name H. LORE.md §5.',
    root: [
      { condition: { chapter: 'ch2-1314' }, node: 'ch2' },
      { condition: { chapter: 'ch1-1307' }, node: 'ch1' },
      { condition: { chapter: 'prologue-1291' }, node: 'prologue' },
    ],
    nodes: {
      prologue: {
        speaker: 'npc.werner-stauffacher', text: 'A freeman of Steinen you find sharpening a scythe. "News from Altdorf, {player}? Then it is true — the King is dead, and the Länder must look to themselves."',
        choices: [{ text: 'The Landsgemeinde is called. You are asked to come.', effects: [{ setFlag: ['stauffacher.summoned', true] }], end: true }, { text: 'Just passing through, Ammann.', end: true }],
      },
      ch1: {
        speaker: 'npc.werner-stauffacher', text: 'Sixteen years since the Rütli, {player}, and still that hat sits on its pole. Frau Gertrud tells me I brood on it too much.',
        choices: [
          { text: 'What will Schwyz do about it?', next: 'ch1-resolve' },
          { text: 'How fares your house at Steinen?', next: 'ch1-house' },
          { text: 'Bei Sankt Verena, Ammann.', end: true },
        ],
      },
      'ch1-resolve': { speaker: 'npc.werner-stauffacher', text: 'What we swore on the Rütli, we hold to. When Uri and Unterwalden move, Schwyz will not be found wanting.', next: undefined, end: true },
      'ch1-house': { speaker: 'npc.werner-stauffacher', text: 'Well enough — though a Vogt\'s clerk came asking after my seal-ring again. They do not forget who signed first.', end: true },
      ch2: {
        speaker: 'npc.werner-stauffacher', text: 'Grey in the beard now, {player} of {origin}, and still they call me Ammann. Leopold musters at Zug — I feel it in my knees before I hear it from the scouts.',
        variants: [{ condition: { questStarted: 'quest.morgarten' }, text: 'Hold the slope when the day comes, {player}. I mean to command from the Haufen\'s front rank, not behind it.' }],
        choices: [{ text: 'We will hold, Ammann.', effects: [{ rep: ['schwyz', 2] }], end: true }, { text: 'How do the preparations go?', next: 'ch2-prep' }],
      },
      'ch2-prep': { speaker: 'npc.werner-stauffacher', text: 'The letzi at Sattel wants stone yet, and every third man still fights with a scythe re-hafted for war. We will manage. We always have.', end: true },
    },
  },
  // ---------------------------------------------------------------- Walter Fürst
  {
    id: 'dlg.walter-fuerst', historical: 'legend', note: 'L throughout. LORE.md §5.',
    root: [
      { condition: { all: [{ chapter: 'prologue-1291' }, { questStage: ['quest.der-eid', 'altdorf-message'] }] }, node: 'message' },
      { condition: { chapter: 'prologue-1291' }, node: 'prologue-other' },
      { condition: { chapter: 'ch1-1307' }, node: 'ch1' },
      { condition: { chapter: 'ch2-1314' }, node: 'ch2' },
    ],
    nodes: {
      message: {
        speaker: 'npc.walter-fuerst', text: 'You\'ll be the one from Flüelen with word of the King\'s death, then. Good. Freiherr von Attinghausen must hear it before the rumour beats you there — and there\'s a boat leaving for Steinen besides, if you\'re minded to see this through.',
        choices: [{ text: '"I\'ll carry it to him myself, Herr Fürst."', effects: [{ setFlag: ['furst.message-taken', true] }, { skillXp: ['speech', 10] }, { quest: ['advance', 'quest.der-eid', 'escort'] }], end: true }],
      },
      'prologue-other': { speaker: 'npc.walter-fuerst', text: 'Altdorf is astir since the news came down from Flüelen. Find the Freiherr, if you\'ve not already — he\'ll want to hear it plainly, not third-hand.', end: true },
      ch1: {
        speaker: 'npc.walter-fuerst', text: 'My son-in-law keeps his own counsel about that hat on the pole, {player}. I worry for him more than he lets on.',
        variants: [{ condition: { questStage: ['quest.der-hut', 'altdorf-pole'] }, text: 'Mind how you pass the square today, {player}. The Vogt\'s men are watching close, and I\'d rather not visit you in the tower.' }],
        end: true,
      },
      ch2: { speaker: 'npc.walter-fuerst', text: 'I am too old for the letzi wall now, but my grandsons are not, and neither are you. Bei Sankt Verena, watch yourself at Sattel.', end: true },
    },
  },
  // ---------------------------------------------------------------- Arnold von Melchtal
  {
    id: 'dlg.arnold-von-melchtal', historical: 'legend', note: 'Wholly L. LORE.md §5.',
    root: [
      { condition: { chapter: 'ch1-1307' }, node: 'ch1' },
      { condition: { chapter: 'ch2-1314' }, node: 'ch2' },
    ],
    nodes: {
      ch1: {
        speaker: 'npc.arnold-von-melchtal', text: 'My father cannot see the alp he tended his whole life, {player}, because a bailiff\'s man took his eyes for it. Tell me I am wrong to want the Vogt gone.',
        variants: [{ condition: { hasCompanion: 'npc.wilhelm-tell' }, text: 'You keep good company these days — a man who puts a bolt exactly where he means to.' }],
        choices: [{ text: 'You are not wrong, Arnold.', effects: [{ rep: ['unterwalden', 3] }], end: true }, { text: 'Vengeance is a heavy thing to carry.', end: true }],
      },
      ch2: { speaker: 'npc.arnold-von-melchtal', text: 'My halberd is sharp and my father still cannot see me carry it. That will have to be enough reason for Morgarten.', end: true },
    },
  },
  // ---------------------------------------------------------------- Wilhelm Tell
  {
    id: 'dlg.wilhelm-tell', historical: 'legend', note: 'Entirely L; central Tell tradition. Chapter-1-only NPC. LORE.md §5.',
    root: [
      { condition: { questStage: ['quest.der-hut', 'apple-shot'] }, node: 'steady' },
      { condition: { hasCompanion: 'npc.wilhelm-tell' }, node: 'companion' },
      { condition: { chapter: 'ch1-1307' }, node: 'general' },
    ],
    nodes: {
      steady: {
        speaker: 'npc.wilhelm-tell', text: 'They\'ve set my boy against the tree, {player}, an apple on his crown, and Gessler counting the paces off himself. Say something useful or say nothing at all.',
        choices: [
          { text: '"Your hand is steadier than any man\'s in Uri. Trust it."', effects: [{ rep: ['uri', 2] }], next: 'steady-thanks' },
          { text: '"I could not watch this."', next: 'steady-grim' },
        ],
      },
      'steady-thanks': { speaker: 'npc.wilhelm-tell', text: 'Then stand where I can see you and say nothing more. The wind is worse than the range.', effects: [{ cutscene: 'cs.apfelschuss' }], end: true },
      'steady-grim': { speaker: 'npc.wilhelm-tell', text: 'Watch or not, it happens the same. Stand back, then, and let me work.', effects: [{ cutscene: 'cs.apfelschuss' }], end: true },
      companion: { speaker: 'npc.wilhelm-tell', text: 'Every crossing on this lake, I know its temper, {player}. Say the word if you need a bolt loosed instead of a boat rowed.', end: true },
      general: { speaker: 'npc.wilhelm-tell', text: 'Bürglen keeps me fed on venison and lets me be, mostly. That hat on the Altdorf pole is the Vogt\'s idea of a joke, and a poor one.', end: true },
    },
  },
  // ---------------------------------------------------------------- Hermann Gessler
  {
    id: 'dlg.hermann-gessler', historical: 'legend', note: 'No such Vogt is attested; entirely L (Weisses Buch). Chapter-1-only. LORE.md §5.',
    root: 'ch1',
    nodes: {
      ch1: {
        speaker: 'npc.hermann-gessler', text: 'The Landvogt looks you over the way a toll-man weighs a sack. "You\'ve not bowed to my hat, I think. Careless, or deliberate?"',
        choices: [
          { text: '"An oversight, Herr Vogt. It won\'t happen again."', condition: { not: { flag: 'gessler.defied' } }, effects: [{ rep: ['habsburg', 5] }, { rep: ['uri', -5] }], end: true },
          { text: '"I answer to the Landsgemeinde, not to a pole."', check: { skill: 'speech', dc: 16, fail: 'gessler-angry' }, next: 'gessler-impressed', effects: [{ setFlag: ['gessler.defied', true] }] },
          { text: 'Say nothing and hold his gaze.', effects: [{ setFlag: ['gessler.defied', true] }], next: 'gessler-angry' },
        ],
      },
      'gessler-impressed': { speaker: 'npc.hermann-gessler', text: '"Bold words for a valley man." He does not smile. "Mind they do not outlive their welcome — the hat stays on the pole regardless." He waves you on.', end: true },
      'gessler-angry': { speaker: 'npc.hermann-gessler', text: '"Insolence, from a Waldstätte peasant." He signals his guards forward. "We will discuss this properly."', effects: [{ setVar: ['quest.der-hut', 'gessler-hostile', true] }], end: true },
    },
  },
  // ---------------------------------------------------------------- Beringer von Landenberg
  {
    id: 'dlg.beringer-von-landenberg', historical: 'legend', note: 'L (Weisses Buch); Landenberg hill/castle H. LORE.md §5.',
    root: 'ch1',
    nodes: {
      ch1: {
        speaker: 'npc.beringer-von-landenberg', text: '"Sarnen pays its dues on time, which is more than I can say for half this valley." The bailiff studies you. "What brings a stranger to my hill?"',
        choices: [{ text: '"Just passing, Herr Vogt."', end: true }, { text: '"Curiosity about your New Year custom, Herr Vogt."', condition: { questStarted: 'quest.burgenbruch' }, effects: [{ skillXp: ['speech', 5] }], end: true }],
      },
    },
  },
  // ---------------------------------------------------------------- Werner von Attinghausen
  {
    id: 'dlg.werner-von-attinghausen', historical: true, note: 'H: Landammann of Uri c. 1294–1321. LORE.md §5.',
    root: [
      { condition: { all: [{ chapter: 'prologue-1291' }, { questStage: ['quest.der-eid', 'altdorf-message'] }] }, node: 'receive-news' },
      { condition: { chapter: 'prologue-1291' }, node: 'prologue-other' },
      { condition: { chapter: 'ch1-1307' }, node: 'ch1' },
      { condition: { chapter: 'ch2-1314' }, node: 'ch2' },
    ],
    nodes: {
      'receive-news': {
        speaker: 'npc.werner-von-attinghausen', text: 'The Freiherr receives you in his hall without ceremony. "King Rudolf dead, you say. Then the question is not whether Vienna forgets us — it is whether we let it."',
        choices: [{ text: '"Walter Fürst says there will be a meeting."', next: 'meeting' }],
      },
      meeting: { speaker: 'npc.werner-von-attinghausen', text: 'There will be. Steinen, or near it — word will reach you. Go carefully, and go quietly; not every ear on the road loves us.', end: true },
      'prologue-other': { speaker: 'npc.werner-von-attinghausen', text: 'Uri answers to no bailiff while I hold the Landammann\'s staff, {player}. That much I intend to keep true.', end: true },
      ch1: { speaker: 'npc.werner-von-attinghausen', text: 'I counsel patience where Werner Stauffacher counsels the sword, {player}. History may prove either of us right — I only hope it is not too costly finding out.', end: true },
      ch2: { speaker: 'npc.werner-von-attinghausen', text: 'I am too old now for the letzi wall, but Uri\'s men march regardless, and my blessing goes with them, for what an old man\'s blessing is worth.', end: true },
    },
  },
  // ---------------------------------------------------------------- Duke Leopold I
  {
    id: 'dlg.leopold-i', historical: true, note: 'H: commanded the Habsburg force at Morgarten. Chapter-2-only. LORE.md §5.',
    root: 'ch2',
    nodes: {
      ch2: {
        speaker: 'npc.leopold-i', text: 'Seen at a distance across the muster ground at Zug, the Duke does not look your way. His captains do the speaking for him — you are not meant to be this close.',
        end: true,
      },
    },
  },
  // ---------------------------------------------------------------- Abt Johannes
  {
    id: 'dlg.abt-johannes', historical: true, note: 'H: Abbot of Einsiedeln 1298–1327. Chapters ch1/ch2 only. LORE.md §5.',
    root: [
      { condition: { all: [{ chapter: 'ch2-1314' }, { questStage: ['quest.marchenstreit', 'speech-path'] }] }, node: 'negotiate' },
      { condition: { chapter: 'ch2-1314' }, node: 'ch2-other' },
      { condition: { chapter: 'ch1-1307' }, node: 'ch1' },
    ],
    nodes: {
      negotiate: {
        speaker: 'npc.abt-johannes', text: '"Vater Abt" is a courtesy you still extend me, I notice, even with Schwyz men at my gate.' + ' The March pastures are the abbey\'s by charter, {player} — I did not invent that title, only inherited it.',
        choices: [
          { text: '"Charters can be read more than one way, Vater Abt."', check: { skill: 'speech', dc: 16, fail: 'negotiate-fail' }, next: 'negotiate-success' },
          { text: 'Say nothing, and let the men behind you speak instead.', end: true },
        ],
      },
      'negotiate-success': { speaker: 'npc.abt-johannes', text: 'You argue like a man who has read the Bundesbrief\'s own clause on arbitration. Very well — I will not bar the gate, but this is not forgiveness, only patience.', effects: [{ rep: ['einsiedeln', 10] }, { setVar: ['quest.marchenstreit', 'negotiated', true] }, { quest: ['advance', 'quest.marchenstreit', 'aftermath'] }], end: true },
      'negotiate-fail': { speaker: 'npc.abt-johannes', text: 'Pretty words do not return grazing rights, {player}. Stand aside, or stand against us — the choice is not really mine to make gentle.', effects: [{ quest: ['advance', 'quest.marchenstreit', 'aftermath'] }], end: true },
      'ch2-other': { speaker: 'npc.abt-johannes', text: 'We are excommunicate by our own bishop\'s word, {player}, and Schwyz still grazes where it pleases. I pray the arbitration your Bundesbrief promises is not only ink.', end: true },
      ch1: { speaker: 'npc.abt-johannes', text: 'The abbey keeps its accounts of the March pastures carefully, {player}, charter by charter, since before your grandfather\'s grandfather. Schwyz keeps its own count of grievances just as carefully.', end: true },
    },
  },
  // ---------------------------------------------------------------- Konrad Ab Yberg
  {
    id: 'dlg.konrad-ab-yberg', historical: 'legend', note: 'Family H, individual/role I. LORE.md §5.',
    root: [
      { condition: { all: [{ chapter: 'ch2-1314' }, { questStage: ['quest.marchenstreit', 'epiphany-argument'] }] }, node: 'argue' },
      { condition: { chapter: 'ch2-1314' }, node: 'ch2-other' },
      { condition: { any: [{ chapter: 'prologue-1291' }, { chapter: 'ch1-1307' }] }, node: 'other' },
    ],
    nodes: {
      argue: {
        speaker: 'npc.konrad-ab-yberg', text: '"Enough charters, enough monks reading us Latin about pastures we\'ve grazed since before their abbey stood." Konrad\'s fist is white on his staff. "Stauffacher, I say we take back what is ours tonight, Epiphany or no."',
        choices: [
          { text: 'Back the raid on Einsiedeln.', effects: [{ setVar: ['quest.marchenstreit', 'restraint', false] }, { quest: ['advance', 'quest.marchenstreit', 'raid'] }], end: true },
          { text: 'Urge restraint — let Stauffacher negotiate first.', effects: [{ setVar: ['quest.marchenstreit', 'restraint', true] }, { quest: ['advance', 'quest.marchenstreit', 'speech-path'] }], end: true },
        ],
      },
      'ch2-other': { speaker: 'npc.konrad-ab-yberg', text: 'The abbot\'s monks still hold pasture that fed my grandfather\'s cattle, {player}. I have not changed my mind about it.', end: true },
      other: { speaker: 'npc.konrad-ab-yberg', text: 'A Schwyz man of the Landsgemeinde, not given to soft words. You\'ll hear plenty from him once the March pastures come up again.', end: true },
    },
  },
  // ---------------------------------------------------------------- Heinrich von Hünenberg
  {
    id: 'dlg.heinrich-von-hunenberg', historical: 'legend', note: 'L tradition (warning arrow); family name H (Zug district). Chapter-2-only. LORE.md §5.',
    root: [
      { condition: { questStage: ['quest.muster-1315', 'hunenberg'] }, node: 'warning' },
      { condition: { chapter: 'ch2-1314' }, node: 'idle' },
    ],
    nodes: {
      warning: {
        speaker: 'narrator', text: 'An arrow thuds into the letzi post at dawn, a scrap of parchment bound to the shaft. In Heinrich von Hünenberg\'s hand, unsigned but unmistakable: "Hütet euch am Morgarten, am Tag St. Otmars." Beware at Morgarten, on St Otmar\'s day.',
        choices: [
          { text: 'Trust the warning — prepare the ambush at Morgarten in earnest.', effects: [{ setFlag: ['hunenberg-warning', true] }, { rep: ['habsburg', 2] }, { quest: ['advance', 'quest.muster-1315', 'ready'] }], end: true },
          { text: 'Distrust it — it could as easily be a trap.', effects: [{ setFlag: ['hunenberg-warning', false] }, { quest: ['advance', 'quest.muster-1315', 'ready'] }], end: true },
        ],
      },
      idle: { speaker: 'npc.heinrich-von-hunenberg', text: 'A Zug knight, seen only from a wary distance — no words pass between you.', end: true },
    },
  },
  // ---------------------------------------------------------------- Johannes of Winterthur
  {
    id: 'dlg.johannes-von-winterthur', historical: true, note: "H: the future chronicler's father served on the Austrian side at Morgarten; cameo, chapter-2-only. LORE.md §5.", root: 'ch2',
    nodes: {
      ch2: {
        speaker: 'npc.johannes-von-winterthur', text: 'A boy of about fourteen, out of place among his father\'s retinue, watches the Waldstätte lines with plain curiosity rather than fear. "Is it true you fight without knights?" he asks. "My father says that\'s no way to make war at all."',
        choices: [{ text: '"Watch closely, then, and remember it."', end: true }],
      },
    },
  },
  // ---------------------------------------------------------------- Jost Imhof (companion)
  {
    id: 'dlg.jost-imhof', historical: 'invented', note: 'Companion pool. LORE.md §5/§10.',
    root: [
      { condition: { hasCompanion: 'npc.jost-imhof' }, node: 'companion' },
      { condition: { not: { hasCompanion: 'npc.jost-imhof' } }, node: 'recruit' },
    ],
    nodes: {
      recruit: {
        speaker: 'npc.jost-imhof', text: 'A Flüelen muleteer coiling a lead-rope. "You look like you\'re headed somewhere further than the market, {player}. I know the Gotthard road better than my own father\'s face — for a fair cut, I\'ll come along."',
        choices: [
          { text: 'Take him on.', condition: { not: { hasCompanion: 'npc.jost-imhof' } }, effects: [{ addCompanion: 'npc.jost-imhof' }, { toast: 'Jost Imhof joins the party.' }], end: true },
          { text: 'Not now, Jost.', end: true },
        ],
      },
      companion: { speaker: 'npc.jost-imhof', text: 'Keep to the outside of the switchbacks and mind the scree after rain, {player} — that\'s the whole of the Gotthard\'s wisdom, really.', end: true },
    },
  },
  // ---------------------------------------------------------------- Mechthild Schorno (companion)
  {
    id: 'dlg.mechthild-schorno', historical: 'invented', note: 'Companion pool. LORE.md §5/§10.',
    root: [
      { condition: { hasCompanion: 'npc.mechthild-schorno' }, node: 'companion' },
      { condition: { not: { hasCompanion: 'npc.mechthild-schorno' } }, node: 'recruit' },
    ],
    nodes: {
      recruit: {
        speaker: 'npc.mechthild-schorno', text: 'Sorting arnica and yarrow into bundles by her door. "Herbs won\'t close a halberd wound, but they\'ll keep a bandaged one from turning. If your road looks like it needs a healer, {player}, I\'ll come."',
        choices: [
          { text: 'We could use you.', condition: { not: { hasCompanion: 'npc.mechthild-schorno' } }, effects: [{ addCompanion: 'npc.mechthild-schorno' }, { toast: 'Mechthild Schorno joins the party.' }], end: true },
          { text: 'Some other time.', end: true },
        ],
      },
      companion: { speaker: 'npc.mechthild-schorno', text: 'Sit still and let me look at that before it festers, {player}. Bei Sankt Verena, you men never mention the wounds that matter.', end: true },
    },
  },
  // ---------------------------------------------------------------- Heini Odermatt (companion)
  {
    id: 'dlg.heini-odermatt', historical: 'invented', note: 'Companion pool, morale-system teaching case. LORE.md §5/§10.',
    root: [
      { condition: { hasCompanion: 'npc.heini-odermatt' }, node: 'companion' },
      { condition: { not: { hasCompanion: 'npc.heini-odermatt' } }, node: 'recruit' },
    ],
    nodes: {
      recruit: {
        speaker: 'npc.heini-odermatt', text: 'A mountain of a man leaning on a halberd taller than himself. "I\'m not much for standing my ground alone, {player}, truth told — but shout at my back when the line wavers and I\'ll hold it all day."',
        choices: [
          { text: 'Join us, Heini.', condition: { not: { hasCompanion: 'npc.heini-odermatt' } }, effects: [{ addCompanion: 'npc.heini-odermatt' }, { toast: 'Heini Odermatt joins the party.' }], end: true },
          { text: 'Maybe later.', end: true },
        ],
      },
      companion: { speaker: 'npc.heini-odermatt', text: 'Just don\'t leave me alone on a flank, {player}. A man my size falls twice as hard when his nerve goes.', end: true },
    },
  },
  // ---------------------------------------------------------------- Bruder Anselm (companion)
  {
    id: 'dlg.bruder-anselm', historical: 'invented', note: 'Companion pool. LORE.md §5/§10.',
    root: [
      { condition: { all: [{ chapter: 'ch2-1314' }, { questStage: ['quest.marchenstreit', 'epiphany-argument'] }] }, node: 'conflicted' },
      { condition: { hasCompanion: 'npc.bruder-anselm' }, node: 'companion' },
      { condition: { not: { hasCompanion: 'npc.bruder-anselm' } }, node: 'recruit' },
    ],
    nodes: {
      recruit: {
        speaker: 'npc.bruder-anselm', text: 'A lay brother with ink-stained fingers, restless in his habit. "Engelberg feeds and clothes me, {player}, and asks in return that I stay put. I am beginning to think I was made for the road instead."',
        choices: [
          { text: 'Come with us, Bruder.', condition: { not: { hasCompanion: 'npc.bruder-anselm' } }, effects: [{ addCompanion: 'npc.bruder-anselm' }, { toast: 'Bruder Anselm joins the party.' }], end: true },
          { text: 'Stay with your books for now.', end: true },
        ],
      },
      companion: { speaker: 'npc.bruder-anselm', text: 'I can read you any charter you like, {player}, in the original Latin or plain speech — a useful thing to have along, whatever else I am.', end: true },
      conflicted: { speaker: 'npc.bruder-anselm', text: 'They are monks, {player}, whatever quarrel Schwyz has with their abbot. I will stand with you tonight, but do not ask me to enjoy it.', effects: [{ setFlag: ['anselm.conflicted', true] }], end: true },
    },
  },
  // ---------------------------------------------------------------- Ueli Zgraggen (companion)
  {
    id: 'dlg.ueli-zgraggen', historical: 'invented', note: 'Companion pool. LORE.md §5/§10.',
    root: [
      { condition: { hasCompanion: 'npc.ueli-zgraggen' }, node: 'companion' },
      { condition: { not: { hasCompanion: 'npc.ueli-zgraggen' } }, node: 'recruit' },
    ],
    nodes: {
      recruit: {
        speaker: 'npc.ueli-zgraggen', text: 'Leaning against the tavern wall, a Habsburg-pattern shield still on his back though the surcoat is long gone. "I know how their sergeants think, {player}, because I used to be paid to think that way myself. Worth something to you?"',
        choices: [
          { text: 'It is. Come along.', condition: { not: { hasCompanion: 'npc.ueli-zgraggen' } }, effects: [{ addCompanion: 'npc.ueli-zgraggen' }, { toast: 'Ueli Zgraggen joins the party.' }], end: true },
          { text: 'Not today.', end: true },
        ],
      },
      companion: { speaker: 'npc.ueli-zgraggen', text: 'A shield wall holds only as long as the man on the end of it, {player}. Watch the flanks — I learned that lesson from the wrong side of it once.', end: true },
    },
  },
  // ---------------------------------------------------------------- Ritter Eberhard von Mülinen
  {
    id: 'dlg.ritter-eberhard-von-mulinen', historical: 'invented', note: 'Antagonist lieutenant; Mülinen family H, individual I. Chapter-2-only. LORE.md §5/§10.', root: 'ch2',
    nodes: {
      ch2: { speaker: 'npc.ritter-eberhard-von-mulinen', text: 'An Aargau knight in the Duke\'s column, plate glinting under a surcoat, eyes the Waldstätte men on the ridgeline the way a hawk eyes a field of mice. He does not speak to peasants.', end: true },
    },
  },
  // ---------------------------------------------------------------- Vogt-Schreiber Ludwig
  {
    id: 'dlg.vogt-schreiber-ludwig', historical: 'invented', note: 'Antagonist lieutenant, wholly I. Chapter-1-only. LORE.md §5/§10.', root: 'ch1',
    nodes: {
      ch1: {
        speaker: 'npc.vogt-schreiber-ludwig', text: 'Gessler\'s clerk squints up from his ledger. "Toll\'s two Pfennig for the bridge, or twenty if you\'d rather I mark you down as one of the hat\'s enemies. Your choice, freely given."',
        choices: [
          { text: 'Pay the two Pfennig.', condition: { pfennig: ['>=', 2] }, effects: [{ pfennig: -2 }], end: true },
          { text: '"Write down what you like, Schreiber."', effects: [{ rep: ['habsburg', -3] }], end: true },
        ],
      },
    },
  },
];

export function register(c: ContentRegistry): void {
  c.addDialogues(namedCastDialogues);
}
