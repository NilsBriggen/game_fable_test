/** quest.brunnen-1315 — 9 December 1315, the Pact of Brunnen. Act 1 epilogue. LORE.md §6. */
import type { QuestDef } from '@core/schemas';

export const brunnen1315: QuestDef = {
  id: 'quest.brunnen-1315', title: 'Der Pakt von Brunnen', kind: 'main', chapter: 'ch2-1314',
  historical: true, note: 'The Pact of Brunnen (9 Dec 1315) renewed the Bundesbrief in German. LORE.md §1/§6.',
  description: 'At Brunnen, the Bundesbrief is renewed — this time in German. Act 1 ends here.',
  stages: [
    {
      id: 'travel-brunnen', journal: 'Word goes out to gather at Brunnen for the renewal of the covenant.',
      marker: 'poi.brunnen', objectiveText: 'Make for Brunnen.',
      advanceWhen: [{ cond: { nearPoi: ['poi.brunnen', 120] }, to: 'pact' }],
    },
    {
      id: 'pact', journal: 'The quay at Brunnen fills for the renewal of the covenant.',
      marker: 'poi.brunnen', objectiveText: 'Attend the Pact of Brunnen.',
      onEnter: [{ cutscene: 'cs.pakt-von-brunnen' }],
    },
  ],
  onStart: [{ toast: 'Quest started: Der Pakt von Brunnen' }],
  onComplete: [{ toast: 'Act One is complete.' }],
};
