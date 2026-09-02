/** quest.der-eid — Prologue, August 1291. LORE.md §6 "Der Eid". */
import type { QuestDef } from '@core/schemas';

export const derEid: QuestDef = {
  id: 'quest.der-eid', title: 'Der Eid', kind: 'main', chapter: 'prologue-1291',
  historical: 'legend', note: "The Bundesbrief and its sealing are H (early Aug 1291); the Rütlischwur staging is L (Tschudi). LORE.md §1/§6.",
  description: "News of King Rudolf's death reaches the Waldstätte. Carry word, escort an elder to the meeting, and stand witness as the Bundesbrief is sealed.",
  stages: [
    {
      id: 'fluelen-news', journal: 'Flüelen, dawn: a Säumer boat brings word that King Rudolf of Habsburg is dead.',
      marker: 'poi.altdorf', objectiveText: 'Learn the news at Flüelen, then make for Altdorf.',
      onEnter: [{ cutscene: 'cs.intro-1291' }],
      advanceWhen: [{ cond: { discovered: 'poi.altdorf' }, to: 'altdorf-message' }],
    },
    {
      id: 'altdorf-message', journal: 'The Landsgemeinde is called at Altdorf. Walter Fürst asks you to carry word to Freiherr Werner von Attinghausen.',
      marker: 'poi.altdorf', objectiveText: 'Find Walter Fürst at Altdorf and carry his message.',
    },
    {
      id: 'escort', journal: 'A boat carries the elder toward Steinen and the meeting place — but the Brunnen quay road is not always safe for Habsburg toll-men to travel unchallenged, nor for those who cross them.',
      marker: 'poi.brunnen', objectiveText: 'Escort the elder past the Brunnen quay.',
      onEnter: [{ encounter: 'enc.brunnen-quay' }],
      advanceWhen: [
        { cond: { var: ['quest.der-eid', 'combat.outcome', 'win'] }, to: 'travel-ruetli' },
        { cond: { var: ['quest.der-eid', 'combat.outcome', 'fled'] }, to: 'travel-ruetli' },
        { cond: { var: ['quest.der-eid', 'combat.outcome', 'lose'] }, to: 'escort-recover' },
      ],
    },
    {
      id: 'escort-recover', journal: "The toll-men beat you back from the quay. The elder's boat pulls off to a hidden inlet to wait out the hour — you will have to try the quay again.",
      marker: 'poi.brunnen', objectiveText: 'Regroup and try the Brunnen quay again.',
      onEnter: [{ quest: ['advance', 'quest.der-eid', 'escort'] }],
    },
    {
      id: 'travel-ruetli', journal: 'Word passes quietly: gather at the Rütli meadow after dark.',
      marker: 'poi.ruetli', objectiveText: 'Make for the Rütli meadow.',
      advanceWhen: [{ cond: { discovered: 'poi.ruetli' }, to: 'ruetli-oath' }],
    },
    {
      id: 'ruetli-oath', journal: 'Night falls on the Rütli meadow. Werner Stauffacher, Walter Fürst and Arnold von Melchtal — and their witnesses — gather to swear.',
      marker: 'poi.ruetli', objectiveText: 'Speak the oath at the Rütli.',
      onEnter: [{ dialogue: 'dlg.ruetli-oath' }],
    },
    {
      id: 'sealing', journal: 'The letter is drawn up to be sealed.',
      marker: 'poi.ruetli', objectiveText: 'Witness the sealing of the Bundesbrief.',
      onEnter: [{ cutscene: 'cs.bundesbrief-sealing' }],
    },
  ],
  onStart: [{ toast: 'Quest started: Der Eid' }],
  onComplete: [{ toast: 'The Bundesbrief is sealed. Sixteen years pass...' }],
};
