/** quest.bad-zu-wolfenschiessen — the bath-house killing, told as a done thing to help conceal. LORE.md §6. */
import type { QuestDef } from '@core/schemas';

export const badZuWolfenschiessen: QuestDef = {
  id: 'quest.bad-zu-wolfenschiessen', title: 'Das Bad zu Wolfenschiessen', kind: 'side', chapter: 'ch1-1307',
  historical: 'legend', note: "The bailiff's man killed in the Wolfenschiessen bath-house is L tradition. LORE.md §6.",
  description: "A Wolfenschiessen farmer asks for help keeping quiet what happened to a bailiff's man in the bath-house.",
  stages: [
    {
      id: 'rumour', journal: 'Jost Durrer of Wolfenschiessen hints at a killing best kept quiet.',
      marker: 'poi.wolfenschiessen', objectiveText: 'Hear Jost out.',
      onEnter: [{ dialogue: 'dlg.bad-wolfenschiessen' }],
    },
    {
      id: 'help-hide', journal: 'A body wants a quiet grave before dawn.',
      marker: 'poi.wolfenschiessen', objectiveText: 'Help hide what happened.',
      onEnter: [{ dialogue: 'dlg.bad-wolfenschiessen-hide' }],
    },
    {
      id: 'resolution', journal: 'By first light, there is nothing left to find.',
      onEnter: [{ quest: ['complete', 'quest.bad-zu-wolfenschiessen'] }],
    },
  ],
  onStart: [{ toast: 'Quest started: Das Bad zu Wolfenschiessen' }],
};
