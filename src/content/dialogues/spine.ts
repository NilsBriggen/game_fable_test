/**
 * Act 1 main-quest spine dialogues — triggered directly by `quest.*` stage `onEnter: [{dialogue: '...'}]`
 * effects (see src/content/quests/act1/*), not by an NPC's own `dialogueRoot`. LORE.md §6/§8.
 */
import type { ContentRegistry } from '@core/content';
import type { DialogueDef } from '@core/schemas';

export const spineDialogues: DialogueDef[] = [
  // ---------------------------------------------------------------- Prologue: the oath itself
  {
    id: 'dlg.ruetli-oath', historical: 'legend', note: "The Rütlischwur is L (Tschudi's dramatisation); the clauses paraphrased are H (Bundesbrief text). LORE.md §1/§6.",
    root: 'call',
    nodes: {
      call: {
        speaker: 'npc.werner-stauffacher', text: 'Torches on the meadow, and the men of three valleys standing in a ring. "Let it be spoken plainly, so none can say after that they did not know the terms." He nods to you. "Speak it, {player} of {origin}, for all to hear."',
        choices: [{ text: 'Speak the oath.', next: 'clause1' }],
      },
      clause1: {
        speaker: 'player', text: '"I swear: that Uri, Schwyz and Unterwalden shall stand by one another with aid, counsel and every kindness — within the valleys and without — against any man who does violence or wrong to one of us, or to our goods."',
        choices: [{ text: '(continue)', next: 'clause2' }],
      },
      clause2: {
        speaker: 'player', text: '"I swear further: that we shall accept no judge in these matters who is not himself of the land and dwelling among us, nor one who has bought his office — no stranger, and no man\'s purse, sent to rule where it does not belong."',
        choices: [{ text: '(continue)', next: 'clause3' }],
      },
      clause3: {
        speaker: 'player', text: '"And where any quarrel rises among us, it shall be laid before the most prudent among the sworn, and settled by their judgment — the sword kept sheathed until judgment fails."',
        choices: [{ text: '(continue)', next: 'close' }],
      },
      close: {
        speaker: 'npc.werner-stauffacher', text: '"So sworn." He sets Schwyz\'s own seal to the warm wax — not his ring, the Land\'s — and Uri and Unterwalden\'s witnesses ready theirs beside it. "Now it is not one man\'s word, or three. It is the Länder\'s."',
        effects: [{ quest: ['advance', 'quest.der-eid', 'sealing'] }],
        end: true,
      },
    },
  },
  // ---------------------------------------------------------------- Chapter 1: the hat
  {
    id: 'dlg.gessler-hat', historical: 'legend', note: "The hat on the pole is L (Weisses Buch von Sarnen). LORE.md §1/§6.",
    root: 'pole',
    nodes: {
      pole: {
        speaker: 'narrator', text: "By the lime tree in Altdorf's square, a pole stands hung with a Habsburg hat, and Vogt-Schreiber Ludwig loiters near it with a ledger, watching who bows and who does not.",
        choices: [
          { text: 'Bow to the hat, as the proclamation demands.', effects: [{ rep: ['habsburg', 8] }, { rep: ['uri', -8] }, { toast: 'You bow to the hat. Word of it will travel.' }], next: 'bowed' },
          { text: 'Walk past without bowing.', next: 'confronted' },
          { text: 'Hang back at the square\'s edge and watch.', next: 'watch-tell' },
        ],
      },
      bowed: { speaker: 'narrator', text: 'The clerk marks something in his ledger and loses interest in you at once. Around the square, a few Uri faces turn away.', effects: [{ setFlag: ['gessler-hat-choice', 'bowed'] }, { quest: ['advance', 'quest.der-hut', 'apple-shot'] }], end: true },
      confronted: {
        speaker: 'npc.vogt-schreiber-ludwig', text: '"You. Yes, you — I watched you walk right past the Landvogt\'s hat as if it were a scarecrow." He raises two fingers, and men-at-arms drift closer. "Explain yourself, or don\'t."',
        choices: [
          { text: '"It was an honest oversight, Schreiber."', check: { skill: 'speech', dc: 14, fail: 'fight' }, next: 'released' },
          { text: `Offer him twenty Pfennig to forget he saw you.`, condition: { pfennig: ['>=', 20] }, effects: [{ pfennig: -20 }], next: 'released' },
          { text: 'Put a hand to your weapon instead.', next: 'fight' },
        ],
      },
      released: { speaker: 'npc.vogt-schreiber-ludwig', text: '"Mind the pole next time." He waves the guards back, disappointed.', effects: [{ setFlag: ['gessler-hat-choice', 'walked-past'] }, { quest: ['advance', 'quest.der-hut', 'apple-shot'] }], end: true },
      fight: { speaker: 'narrator', text: 'The guards close in before you can say another word.', effects: [{ encounter: 'enc.altdorf-square' }], next: 'after-fight' },
      'after-fight': { speaker: 'narrator', text: 'The square empties around the fight\'s aftermath — word of it will reach the Vogt within the hour, one way or another.', effects: [{ setFlag: ['gessler-hat-choice', 'fought'] }, { quest: ['advance', 'quest.der-hut', 'apple-shot'] }], end: true },
      'watch-tell': {
        speaker: 'narrator', text: 'A crossbowman in worn hunting leathers walks past the pole without so much as a glance at it. The guards are on him in a breath. "Wilhelm Tell of Bürglen does not bow to a hat on a stick," he says, loud enough for the square to hear.',
        effects: [{ setFlag: ['gessler-hat-choice', 'watched'] }, { quest: ['advance', 'quest.der-hut', 'apple-shot'] }],
        end: true,
      },
    },
  },
  {
    id: 'dlg.hohle-gasse-aftermath', historical: 'legend', note: 'The Hohle Gasse ambush is L; the escort peasants and looting choice are I dressing on an L event. LORE.md §1/§6.',
    root: 'after',
    nodes: {
      after: {
        speaker: 'narrator', text: "Gessler is down in the sunken road, and his escort — men-at-arms and a few pressed porters both — throw down what they carry.",
        choices: [
          { text: 'Let the frightened porters go.', effects: [{ rep: ['uri', 5] }, { toast: 'The porters scatter, thanking no one in particular.' }], next: 'freed' },
          { text: 'Take what they carry first.', effects: [{ giveItem: ['item.pfennig-purse', 1] }, { rep: ['habsburg', -3] }], next: 'looted' },
        ],
      },
      freed: { speaker: 'narrator', text: 'As it is told in Uri: the Landvogt\'s men who lived that day never forgot who let them walk home.', effects: [{ quest: ['advance', 'quest.der-hut', 'burgenbruch'] }], end: true },
      looted: { speaker: 'narrator', text: 'A grim harvest, but a harvest. Gessler\'s purse is heavier than his reputation deserved.', effects: [{ quest: ['advance', 'quest.der-hut', 'burgenbruch'] }], end: true },
    },
  },
  // ---------------------------------------------------------------- Burgenbruch
  {
    id: 'dlg.burgenbruch-council', historical: 'legend', note: 'The three-castle Burgenbruch is L, "told in Sarnen". LORE.md §1/§6.',
    root: 'council',
    nodes: {
      council: {
        speaker: 'narrator', text: "Word goes round the valleys: before spring, Zwing Uri, Rotzberg and Landenberg's hill at Sarnen must all fall. \"One of us should see it done with our own hands,\" someone says. \"The rest can be trusted to good men.\"",
        choices: [
          { text: 'Storm Zwing Uri yourself.', effects: [{ setVar: ['quest.burgenbruch', 'chosen', 'zwing-uri'] }, { quest: ['advance', 'quest.burgenbruch', 'zwing-uri'] }], end: true },
          { text: 'Climb Rotzberg by rope, yourself, by night.', effects: [{ setVar: ['quest.burgenbruch', 'chosen', 'rotzberg'] }, { quest: ['advance', 'quest.burgenbruch', 'rotzberg'] }], end: true },
          { text: 'Join the New Year\'s gift procession into Sarnen yourself.', effects: [{ setVar: ['quest.burgenbruch', 'chosen', 'sarnen'] }, { quest: ['advance', 'quest.burgenbruch', 'sarnen'] }], end: true },
          { text: 'Send trusted companions to all three, and command from Altdorf.', check: { skill: 'leadership', dc: 14, fail: 'council-fail' }, next: 'delegated-success' },
        ],
      },
      'delegated-success': {
        speaker: 'narrator',
        text: 'Word comes back within days, each messenger arriving grinning and travel-worn. At Zwing Uri, the labourers\' file carried its hidden halberds through the unfinished gate and the half-built keep surrendered before dawn. At Rotzberg, a rope dropped from a high window let the climbers over the wall while the garrison slept, and the servant girl\'s part in it is already half a song. At Sarnen, the New Year\'s gift baskets opened on Landenberg\'s own doorstep, and the hill was taken before he found his sword. All three, and barely a scratch between the lot of them.',
        effects: [{ rep: ['uri', 5] }, { rep: ['unterwalden', 5] }, { quest: ['advance', 'quest.burgenbruch', 'aftermath'] }],
        end: true,
      },
      'council-fail': {
        speaker: 'narrator', text: 'It is done, but not cleanly — Rotzberg\'s garrison gets a warning shout off before the rope party is inside, and there is a wound or two to show for it by the time word reaches you.',
        effects: [{ rep: ['unterwalden', 2] }, { quest: ['advance', 'quest.burgenbruch', 'aftermath'] }],
        end: true,
      },
    },
  },
  {
    id: 'dlg.zwing-uri-stealth', historical: 'legend', note: "Zwing Uri's storming is L, part of the Burgenbruch. Half-built fortress per LORE.md §4.", root: 'gate',
    nodes: {
      gate: {
        speaker: 'narrator', text: "Zwing Uri stands half-built above Amsteg, timber scaffolding still up one wall. A file of labourers carries stone in through the unfinished gate every morning — no one looks twice at another back bent under a load.",
        choices: [
          { text: 'Walk in among the labourers.', check: { skill: 'stealth', dc: 13, fail: 'noticed' }, next: 'inside' },
          { text: 'Talk your way past the gate guard instead.', check: { skill: 'speech', dc: 13, fail: 'noticed' }, next: 'inside' },
        ],
      },
      inside: { speaker: 'narrator', text: 'Once inside, the half-finished walls give you every advantage — the garrison surrenders the half-built keep without much of a fight once they see how many of "the labourers" have thrown down their sacks for weapons.', effects: [{ rep: ['uri', 8] }, { giveItem: ['item.pfennig-purse', 1] }, { quest: ['advance', 'quest.burgenbruch', 'aftermath'] }], end: true },
      noticed: { speaker: 'narrator', text: 'A guard\'s eyes narrow at you a beat too long — but by the time he calls out, you and enough others are already past him. Zwing Uri falls, messier than it might have, but it falls.', effects: [{ rep: ['uri', 4] }, { quest: ['advance', 'quest.burgenbruch', 'aftermath'] }], end: true },
    },
  },
  {
    id: 'dlg.rotzberg-climb', historical: 'legend', note: "Rotzberg's storming (a servant girl's rope) is L. LORE.md §1/§4.", root: 'wall',
    nodes: {
      wall: {
        speaker: 'narrator', text: 'Under Rotzberg\'s wall at night, a rope drops from a high window — a servant girl\'s doing, so the story goes, for love of one of the men below. Climbing it in the dark, in silence, is another matter entirely.',
        choices: [{ text: 'Climb.', check: { skill: 'athletics', dc: 14, fail: 'slip' }, next: 'top' }],
      },
      top: { speaker: 'narrator', text: 'You are over the wall and among the sleeping garrison before a single man wakes. Rotzberg falls before dawn, as the tellers of Sarnen have it.', effects: [{ rep: ['unterwalden', 8] }, { quest: ['advance', 'quest.burgenbruch', 'aftermath'] }], end: true },
      slip: { speaker: 'narrator', text: 'Your boot scrapes stone loud enough to wake a light sleeper below — the fight that follows is short but not silent. Rotzberg falls all the same, by morning.', effects: [{ rep: ['unterwalden', 4] }, { quest: ['advance', 'quest.burgenbruch', 'aftermath'] }], end: true },
    },
  },
  {
    id: 'dlg.sarnen-procession', historical: 'legend', note: "Landenberg's New Year's-gift ruse is L. LORE.md §1/§4.", root: 'gift',
    nodes: {
      gift: {
        speaker: 'narrator', text: "New Year's morning: Sarnen's men form a procession up to Landenberg's hill bearing gift baskets for the bailiff — hams, cheeses, and, hidden under the linen, halberds broken down to fit.",
        choices: [{ text: 'Carry a basket in and keep your face pleasant.', check: { skill: 'speech', dc: 13, fail: 'suspicious' }, next: 'inside' }],
      },
      inside: { speaker: 'narrator', text: 'Landenberg accepts his gifts with a bailiff\'s customary graciousness, never once suspecting the linen. When the baskets open, the hill is yours before he finds his sword.', effects: [{ rep: ['unterwalden', 8] }, { quest: ['advance', 'quest.burgenbruch', 'aftermath'] }], end: true },
      suspicious: { speaker: 'narrator', text: 'A guard eyes your basket a moment too long — but the halberds are already coming out from under the linen by the time he decides to say something.', effects: [{ rep: ['unterwalden', 4] }, { quest: ['advance', 'quest.burgenbruch', 'aftermath'] }], end: true },
    },
  },
  // ---------------------------------------------------------------- Chapter 2: Marchenstreit
  {
    id: 'dlg.marchenstreit-rat', historical: true, note: 'The Marchenstreit and its Epiphany 1314 escalation are H; the specific argument staged here is I dressing. LORE.md §1/§6.',
    root: 'argue',
    nodes: {
      argue: {
        speaker: 'npc.konrad-ab-yberg', text: '"Enough of the abbot\'s Latin," Konrad says, over the noise of the Landsgemeinde hall on the night of the Epiphany. "Schwyz men have grazed the March since before that abbey had a roof. Stauffacher, I say we take back what is ours tonight."',
        variants: [{ condition: { hasCompanion: 'npc.bruder-anselm' }, text: '"Enough of the abbot\'s Latin," Konrad says — and does not fail to notice Bruder Anselm at your shoulder. "No offence meant to your brother there. But Schwyz men have grazed the March since before that abbey had a roof, and I say we take it back tonight."' }],
        choices: [
          { text: 'Back the raid on Einsiedeln.', effects: [{ setVar: ['quest.marchenstreit', 'restraint', false] }, { quest: ['advance', 'quest.marchenstreit', 'raid'] }], end: true },
          { text: 'Urge restraint — let Stauffacher and the abbot talk first.', effects: [{ setVar: ['quest.marchenstreit', 'restraint', true] }, { quest: ['advance', 'quest.marchenstreit', 'speech-path'] }], end: true },
        ],
      },
    },
  },
  // ---------------------------------------------------------------- Muster year, 1314-15
  {
    id: 'dlg.muster-letzi', historical: true, note: 'The Sattel letzi wall is H (letzi walls attested for Schwyz); the craft check dressing is I. LORE.md §3.',
    root: 'work',
    nodes: {
      work: {
        speaker: 'narrator', text: 'The letzi wall at Sattel wants raising before the snow makes the work impossible — stone and timber both, and not enough hands who know how to lay either properly.',
        choices: [{ text: 'Set to work on the wall.', check: { skill: 'craft', dc: 14, fail: 'letzi-weak' }, next: 'letzi-strong' }],
      },
      'letzi-strong': { speaker: 'narrator', text: 'By the time the first snow falls, the letzi stands higher and thicker than anyone hoped, a full extra course of stone and timber run the length of the Schornen valley floor — a real wall, not a gesture of one.', effects: [{ setVar: ['quest.muster-1315', 'letzi', 'strong'] }, { setFlag: ['morgarten.letzi-improved', true] }, { quest: ['advance', 'quest.muster-1315', 'recruit'] }], end: true },
      'letzi-weak': { speaker: 'narrator', text: 'The wall goes up, serviceable if unlovely — it will hold, though it will not impress anyone who has seen a proper fortification.', effects: [{ setVar: ['quest.muster-1315', 'letzi', 'weak'] }, { quest: ['advance', 'quest.muster-1315', 'recruit'] }], end: true },
    },
  },
  {
    id: 'dlg.muster-recruit', historical: true, note: 'The 1314-15 muster is H in outline; the specific recruiting round is I dressing. LORE.md §1/§6.', root: 'call',
    nodes: {
      call: {
        speaker: 'narrator', text: 'Every valley must send men, and every man sent must be fed, armed, and, ideally, willing. Walking the Landsgemeinde meadows to talk farmers into halberds is its own kind of work.',
        choices: [{ text: 'Make the rounds and recruit.', check: { skill: 'leadership', dc: 14, fail: 'recruit-thin' }, next: 'recruit-strong' }],
      },
      'recruit-strong': { speaker: 'narrator', text: 'More men answer the call than the Ammann dared hope — the Schwyz contingent alone swells past what the old counts allowed for, a full two files of spears more than the last muster mustered.', effects: [{ setVar: ['quest.muster-1315', 'recruits', 'strong'] }, { setFlag: ['morgarten.recruits-strong', true] }, { quest: ['advance', 'quest.muster-1315', 'scout-zug'] }], end: true },
      'recruit-thin': { speaker: 'narrator', text: 'You get enough men to matter, though not so many that anyone feels easy about the odds. It will have to do.', effects: [{ setVar: ['quest.muster-1315', 'recruits', 'thin'] }, { quest: ['advance', 'quest.muster-1315', 'scout-zug'] }], end: true },
    },
  },
  {
    id: 'dlg.muster-scout', historical: true, note: "Leopold's staging camp at Zug before Morgarten is H. LORE.md §3.", root: 'scout',
    nodes: {
      scout: {
        speaker: 'narrator', text: "Zug's streets are thick with Habsburg banners and unfamiliar accents — Duke Leopold's column musters here before it moves, tent-rows enough to count from the hillside if a man is patient and unseen.",
        choices: [{ text: 'Scout the camp.', check: { skill: 'stealth', dc: 15, fail: 'scout-caught' }, next: 'scout-clean' }],
      },
      'scout-clean': {
        speaker: 'narrator', text: 'From the hillside above the camp you count it properly and slip out again unseen: knights foremost, then rank on rank of footmen and crossbowmen, then a baggage train long enough that its tail is still making camp when its head has already struck tents — by your best count, some two thousand men, and no mistaking the size of it.',
        effects: [
          { setVar: ['quest.muster-1315', 'scouted', true] },
          { journal: "Your scout's count, brought back to the letzi: some two thousand men in Leopold's column, knights foremost." },
          { quest: ['advance', 'quest.muster-1315', 'hunenberg'] },
        ],
        end: true,
      },
      'scout-caught': {
        speaker: 'narrator', text: "A sentry's eyes catch yours a moment too long — you get clear of Zug at a dead run before you can count past the knights and the first ranks of footmen. Enough to know it is no small column; not enough to put a firm number to it.",
        effects: [
          { setVar: ['quest.muster-1315', 'scouted', 'partial'] },
          { journal: "Your scout's count is incomplete — knights and footmen in some strength, the rest guessed at rather than counted." },
          { quest: ['advance', 'quest.muster-1315', 'hunenberg'] },
        ],
        end: true,
      },
    },
  },
];

export function register(c: ContentRegistry): void {
  c.addDialogues(spineDialogues);
}
