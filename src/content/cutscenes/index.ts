/**
 * cutscenes — ARCHITECTURE.md §3.3/§5.6, LORE.md §6. The six mandated Act 1 set-piece cutscenes. Each
 * embeds the `Effect`s that drive the quest spine onward (advance/complete/start, chapter changes, the
 * final `end: 'act1'`) so a quest stage's `onEnter: [{cutscene: '...'}]` is enough to carry the story.
 */
import type { ContentRegistry } from '@core/content';
import type { CutsceneDef } from '@core/schemas';

export const cutscenes: CutsceneDef[] = [
  {
    id: 'cs.intro-1291', historical: 'legend',
    note: "Rudolf I's death (15 Jul 1291, H) reaching the Waldstätte by word of mouth within days is the game's dramatised opening; the exact boatman and words are I. LORE.md §1/§6.",
    steps: [
      { camera: { pos: [420, 25, 1550], lookAt: [270, 2, 1483] }, time: 6, weather: 'overcast', letterbox: true },
      { caption: 'Flüelen, on the Urnersee — the first days of August, 1291.', seconds: 4 },
      { caption: '"The King is dead!" a boatman cries, still standing in the prow. "Rudolf of Habsburg — dead at Speyer!"', seconds: 5 },
      {
        effects: [
          { journal: 'News reaches Flüelen: King Rudolf of Habsburg is dead. The valley talk turns at once to the bailiffs, and to what comes after him.' },
          { setFlag: ['intro.rudolf-news', true] },
        ],
      },
      { fade: 'clear', seconds: 1 },
    ],
  },
  {
    id: 'cs.bundesbrief-sealing', historical: 'legend',
    note: 'The Bundesbrief and its clauses (mutual aid, no foreign judges, arbitration) are H, sealed in early August 1291; the night torchlit Rütli scene and its staging are L/I. LORE.md §1/§6.',
    steps: [
      { camera: { pos: [-150, 15, -140], lookAt: [-186, 10, -74] }, time: 22, weather: 'clear', letterbox: true },
      { caption: 'By torchlight on the Rütli meadow, the men set their seals to the letter.', seconds: 5 },
      { caption: 'In time the clerks will render its sense in German: mutual aid against any who does violence within the valleys; no judge who is not of the land and dwelling in it; disputes settled by the sworn among them.', seconds: 6 },
      {
        effects: [
          { giveItem: ['item.bundesbrief-copy', 1] },
          { journal: 'The letter was sealed in the first days of August: mutual aid, no foreign judges, arbitration between the Länder — renewing, so the old men said, an alliance older still.' },
          { rep: ['uri', 5] }, { rep: ['schwyz', 5] }, { rep: ['unterwalden', 5] },
          { setChapter: 'ch1-1307' },
          { quest: ['complete', 'quest.der-eid'] },
          { quest: ['start', 'quest.der-hut'] },
        ],
      },
      { fade: 'black', seconds: 2 },
    ],
  },
  {
    id: 'cs.apfelschuss', historical: 'legend',
    note: "Tell's apple shot at Altdorf is L (Weisses Buch von Sarnen, c. 1470); no contemporary source names Gessler. LORE.md §1/§6.",
    steps: [
      { camera: { pos: [590, 15, 2040], lookAt: [574, 9, 2051] }, time: 11, weather: 'clear', letterbox: true },
      { caption: 'They set the boy against the lime tree, an apple on his head, eighty paces off.', seconds: 5 },
      { caption: 'Tell nocks a second bolt in his belt before he raises the first. Gessler asks him why. "Had I struck my son," Tell says, "the second was for you."', seconds: 6 },
      {
        effects: [
          { setFlag: ['apfelschuss-done', true] },
          { rep: ['habsburg', -10] },
          { journal: 'As it is told in Uri: the shaft cleaved the apple clean, and the boy never flinched.' },
          { quest: ['advance', 'quest.der-hut', 'tellsplatte'] },
        ],
      },
      { fade: 'clear', seconds: 1 },
    ],
  },
  {
    id: 'cs.tellsplatte', historical: 'legend',
    note: "Tell's leap at the Tellsplatte is L; a chapel there is attested only from the 16th c. LORE.md §1/§4/§6.",
    steps: [
      { camera: { pos: [230, 20, 720], lookAt: [203, 2, 692] }, weather: 'rain', time: 15, letterbox: true },
      { caption: "A squall comes down off the Axen as Gessler's boat carries Tell, bound, toward Küssnacht.", seconds: 5 },
      { caption: "The boatmen beg for the prisoner's hand at the tiller — none other knows this water in a storm. Freed to steer, Tell leaps for the flat rock and kicks the boat back into the waves.", seconds: 6 },
      {
        effects: [
          { journal: "As it is told: Tell sprang from the boat at the flat rock below Sisikon and was gone into the Axen woods before Gessler's men could land." },
          { quest: ['advance', 'quest.der-hut', 'hohle-gasse'] },
        ],
      },
      { fade: 'clear', seconds: 1 },
    ],
  },
  {
    id: 'cs.morgarten-aftermath', historical: true,
    note: 'The rout at Morgarten (15 Nov 1315) and Duke Leopold escaping the field are H (Johannes of Winterthur). LORE.md §1/§6.',
    steps: [
      { camera: { pos: [400, 40, -3200], lookAt: [338, 10, -3336] }, time: 9, weather: 'snow', letterbox: true },
      { caption: 'The column breaks against the slope and the lake takes the rest. Duke Leopold is away toward Zug before the rout is done.', seconds: 6 },
      {
        effects: [
          { journal: '15 November, 1315: the column from Zug is broken between the lake and the Figlenfluh, as the chroniclers will tell it within a generation.' },
          { rep: ['habsburg', -15] },
          { quest: ['complete', 'quest.morgarten'] },
          { quest: ['start', 'quest.brunnen-1315'] },
        ],
      },
      { fade: 'clear', seconds: 1 },
    ],
  },
  {
    id: 'cs.pakt-von-brunnen', historical: true,
    note: 'The Pact of Brunnen (9 Dec 1315), renewing the Bundesbrief in German, is H. LORE.md §1/§6.',
    steps: [
      { camera: { pos: [0, 15, -780], lookAt: [-68, 2, -741] }, time: 10, weather: 'clear', letterbox: true },
      { caption: 'At Brunnen, on the ninth of December, the Bundesbrief is read again — this time in German, for every man on the quay to understand.', seconds: 6 },
      {
        effects: [
          { journal: "The Pact of Brunnen renews the covenant of 1291 in the German tongue. Here, for now, the tale of the Eidgenossen's first years ends." },
          { quest: ['complete', 'quest.brunnen-1315'] },
          { end: 'act1' },
        ],
      },
      { fade: 'black', seconds: 2 },
    ],
  },
];

export function register(c: ContentRegistry): void {
  c.addCutscenes(cutscenes);
}
