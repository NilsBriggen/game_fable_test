/** quest.alpstreit — arbitrate an alp boundary dispute using the Bundesbrief's arbitration clause. LORE.md §6. */
import type { QuestDef } from '@core/schemas';

export const alpstreit: QuestDef = {
  id: 'quest.alpstreit', title: 'Alpstreit', kind: 'side', chapter: 'ch1-1307',
  historical: 'invented', note: "Puts the Bundesbrief's arbitration clause (H) to work on an invented boundary dispute. LORE.md §6.",
  description: 'A Sattel farmer asks you to arbitrate a boundary dispute with the Arth herders — the Bundesbrief promises judgment before the sword.',
  stages: [
    {
      id: 'offer', journal: 'Melchior Arnold of Sattel complains that the Arth herders keep moving the boundary stones.',
      marker: 'poi.sattel', objectiveText: 'Hear the dispute.',
      onEnter: [{ dialogue: 'dlg.alpstreit-dispute' }, { quest: ['advance', 'quest.alpstreit', 'inspect'] }],
    },
    {
      id: 'inspect', journal: 'Walk the disputed slope above Sattel and see the moved stones with your own eyes before you rule.',
      marker: 'poi.steinerberg', objectiveText: 'Inspect the disputed slope.',
      advanceWhen: [{ cond: { nearPoi: ['poi.steinerberg', 120] }, to: 'examine' }],
    },
    {
      id: 'examine', journal: 'The cut turf and fresh-turned earth on the slope tell their own story.',
      marker: 'poi.steinerberg', objectiveText: 'Read the marks on the slope.',
      onEnter: [{ dialogue: 'dlg.alpstreit-inspect' }],
    },
    {
      id: 'hearing', journal: 'Both sides lay their claims before you at the Sattel letzi.',
      marker: 'poi.sattel-letzi', objectiveText: 'Arbitrate the dispute.',
      onEnter: [{ dialogue: 'dlg.alpstreit-hearing' }],
    },
    {
      id: 'ruling', journal: 'The boundary is settled — for now.',
      onEnter: [{ quest: ['complete', 'quest.alpstreit'] }],
    },
  ],
  onStart: [{ toast: 'Quest started: Alpstreit' }],
};
