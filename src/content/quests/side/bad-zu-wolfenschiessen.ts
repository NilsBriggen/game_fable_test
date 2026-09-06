/** quest.bad-zu-wolfenschiessen — the bath-house killing, told as a done thing to help conceal. LORE.md §6. */
import type { QuestDef } from '@core/schemas';

export const badZuWolfenschiessen: QuestDef = {
  id: 'quest.bad-zu-wolfenschiessen', title: 'Das Bad zu Wolfenschiessen', kind: 'side', chapter: 'ch1-1307',
  historical: 'legend', note: "The bailiff's man killed in the Wolfenschiessen bath-house is L tradition. LORE.md §6.",
  description: "A Wolfenschiessen farmer asks for help keeping quiet what happened to a bailiff's man in the bath-house.",
  stages: [
    {
      id: 'offer', journal: 'Jost Durrer of Wolfenschiessen hints at a killing best kept quiet.',
      marker: 'poi.wolfenschiessen', objectiveText: 'Hear Jost out.',
      onEnter: [{ dialogue: 'dlg.bad-wolfenschiessen' }, { quest: ['advance', 'quest.bad-zu-wolfenschiessen', 'help-hide'] }],
    },
    {
      id: 'help-hide', journal: 'A body wants a quiet grave before dawn.',
      marker: 'poi.wolfenschiessen', objectiveText: 'Help hide what happened before first light.',
      onEnter: [{ dialogue: 'dlg.bad-wolfenschiessen-hide' }],
      advanceWhen: [
        { cond: { var: ['quest.bad-zu-wolfenschiessen', 'haste', 'dawn-met'] }, to: 'quiet' },
        { cond: { var: ['quest.bad-zu-wolfenschiessen', 'haste', 'slow'] }, to: 'exposed' },
      ],
    },
    {
      id: 'quiet', journal: 'By first light, there is nothing left to find.',
      onEnter: [{ quest: ['complete', 'quest.bad-zu-wolfenschiessen'] }],
    },
    {
      id: 'exposed', journal: 'The work was too slow, or too sloppy — a clerk from Sarnen will come asking, sooner or later.',
      onEnter: [{ setFlag: ['wolfenschiessen-clerk-coming', true] }, { dialogue: 'dlg.bad-wolfenschiessen-clerk' }],
    },
  ],
  onStart: [{ toast: 'Quest started: Das Bad zu Wolfenschiessen' }],
};
