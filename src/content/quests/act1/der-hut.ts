/** quest.der-hut — Chapter 1, "Der Hut auf der Stange", 1307. LORE.md §6. */
import type { QuestDef } from '@core/schemas';

export const derHut: QuestDef = {
  id: 'quest.der-hut', title: 'Der Hut auf der Stange', kind: 'main', chapter: 'ch1-1307',
  historical: 'legend', note: "Wholly L (Weisses Buch von Sarnen c. 1470 / Tschudi): the hat, the apple shot, the Tellsplatte leap, Gessler's death in the Hohle Gasse. The game dates it 1307 per Tschudi and says so in the journal (LORE.md §1: 'Weisses Buch gives no year'). LORE.md §1/§6.",
  description: "Sixteen years on: a Habsburg hat on a pole in Altdorf, a crossbowman who will not bow to it, and the storming of three strongholds before winter.",
  stages: [
    {
      id: 'travel-altdorf', journal: "Sixteen years since the Rütli. Word from Altdorf says a hat now sits on a pole by the lime tree, and every man is made to bow to it — though the tellers of Sarnen, setting this down long after, give no year for it.",
      marker: 'poi.altdorf', objectiveText: 'Make for Altdorf and see the hat for yourself.',
      advanceWhen: [{ cond: { discovered: 'poi.altdorf' }, to: 'altdorf-pole' }],
    },
    {
      id: 'altdorf-pole', journal: "Gessler's hat stands over the square, and Vogt-Schreiber Ludwig watches who bows to it.",
      marker: 'poi.altdorf', objectiveText: "Decide how to pass Gessler's hat.",
      onEnter: [{ dialogue: 'dlg.gessler-hat' }],
    },
    {
      id: 'apple-shot', journal: 'Wilhelm Tell refuses to bow. Gessler sets him a test: shoot an apple from his own son\'s head.',
      marker: 'poi.altdorf', objectiveText: 'Speak with Tell before the shot.',
      onEnter: [{ dialogue: 'dlg.wilhelm-tell' }],
    },
    {
      id: 'travel-tellsplatte', journal: 'Arrested regardless of the shot, Tell is carried toward Küssnacht by boat.',
      marker: 'poi.tellsplatte', objectiveText: 'Follow the boat down the Urnersee toward the Tellsplatte.',
      advanceWhen: [{ cond: { discovered: 'poi.tellsplatte' }, to: 'tellsplatte' }],
    },
    {
      id: 'tellsplatte', journal: 'A storm on the Urnersee gives Tell his chance.',
      marker: 'poi.tellsplatte', objectiveText: 'Witness the leap at the Tellsplatte.',
      onEnter: [{ cutscene: 'cs.tellsplatte' }],
    },
    {
      id: 'travel-hohle-gasse', journal: 'Word reaches you: Tell means to wait for Gessler in the sunken road toward Küssnacht.',
      marker: 'poi.hohle-gasse', objectiveText: 'Make for the Hohle Gasse.',
      advanceWhen: [{ cond: { discovered: 'poi.hohle-gasse' }, to: 'hohle-gasse' }],
    },
    {
      id: 'hohle-gasse', journal: 'Tell waits in the sunken road for Gessler. The party holds the road behind him.',
      marker: 'poi.hohle-gasse', objectiveText: "Hold the Hohle Gasse while Tell's shot resolves.",
      onEnter: [{ encounter: 'enc.hohle-gasse' }],
      advanceWhen: [
        { cond: { var: ['quest.der-hut', 'combat.outcome', 'win'] }, to: 'aftermath' },
        { cond: { var: ['quest.der-hut', 'combat.outcome', 'fled'] }, to: 'aftermath' },
        { cond: { var: ['quest.der-hut', 'combat.outcome', 'lose'] }, to: 'hohle-gasse-recover' },
      ],
    },
    {
      id: 'hohle-gasse-recover', journal: "The escort drives you back up the sunken road. Tell pulls back into the trees to wait for a second chance.",
      marker: 'poi.hohle-gasse', objectiveText: 'Regroup and hold the Hohle Gasse again.',
      onEnter: [{ quest: ['advance', 'quest.der-hut', 'hohle-gasse'] }],
    },
    {
      id: 'aftermath', journal: "Gessler is dead in the Hohle Gasse — as it is told in Uri.",
      marker: 'poi.hohle-gasse', objectiveText: "Decide what becomes of the Landvogt's escort.",
      onEnter: [{ dialogue: 'dlg.hohle-gasse-aftermath' }],
    },
    {
      id: 'burgenbruch', journal: 'Word goes out through the Länder: before spring, the strongholds at Zwing Uri, Rotzberg and Sarnen must fall.',
      objectiveText: 'See the Burgenbruch through.',
      onEnter: [{ quest: ['start', 'quest.burgenbruch'] }],
      advanceWhen: [{ cond: { questDone: 'quest.burgenbruch' }, to: 'epilogue' }],
    },
    {
      id: 'epilogue', journal: 'The bailiffs are gone from Uri, Schwyz and Unterwalden. Tell goes back to Bürglen and his crossbow.',
      onEnter: [
        { removeCompanion: 'npc.wilhelm-tell' },
        { quest: ['complete', 'quest.der-hut'] },
        { quest: ['start', 'quest.epilog-1308'] },
      ],
    },
  ],
  onStart: [{ toast: 'Quest started: Der Hut auf der Stange' }],
};
