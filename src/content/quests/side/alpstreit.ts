/** quest.alpstreit — arbitrate an alp boundary dispute using the Bundesbrief's arbitration clause. LORE.md §6. */
import type { QuestDef } from '@core/schemas';

export const alpstreit: QuestDef = {
  id: 'quest.alpstreit', title: 'Alpstreit', kind: 'side', chapter: 'ch1-1307',
  historical: 'invented', note: "Puts the Bundesbrief's arbitration clause (H) to work on an invented boundary dispute. LORE.md §6.",
  description: 'A Sattel farmer asks you to arbitrate a boundary dispute with the Arth herders — the Bundesbrief promises judgment before the sword.',
  stages: [
    {
      id: 'dispute', journal: 'Melchior Arnold of Sattel complains that the Arth herders keep moving the boundary stones.',
      marker: 'poi.sattel', objectiveText: 'Hear the dispute.',
      onEnter: [{ dialogue: 'dlg.alpstreit-dispute' }],
    },
    {
      id: 'hearing', journal: 'Both sides lay their claims before you on the disputed slope.',
      marker: 'poi.sattel', objectiveText: 'Arbitrate the dispute.',
      onEnter: [{ dialogue: 'dlg.alpstreit-hearing' }],
    },
    {
      id: 'ruling', journal: 'The boundary is settled — for now.',
      onEnter: [{ quest: ['complete', 'quest.alpstreit'] }],
    },
  ],
  onStart: [{ toast: 'Quest started: Alpstreit' }],
};
