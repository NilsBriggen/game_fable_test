/** quest.morgarten — 15 November 1315, the battle. LORE.md §6. */
import type { QuestDef } from '@core/schemas';

export const morgarten: QuestDef = {
  id: 'quest.morgarten', title: 'Morgarten', kind: 'main', chapter: 'ch2-1314',
  historical: true, note: 'Battle of Morgarten, 15 Nov 1315: Duke Leopold I\'s column ambushed between the Ägerisee and the Figlenfluh slope; rocks and halberds against cramped cavalry; Leopold escapes. LORE.md §1/§6.',
  description: "Duke Leopold's column marches from Zug along the Ägerisee toward Schwyz. The Confederates hold the slope above the road.",
  stages: [
    {
      id: 'battle', journal: '15 November, 1315. The column comes on between the lake and the slope, and the boulder caches wait above the road.',
      marker: 'poi.morgarten', objectiveText: 'Hold the slope, then rout the column at Morgarten.',
      onEnter: [{ encounter: 'enc.morgarten' }],
      advanceWhen: [
        { cond: { var: ['_system', 'lastCombat.outcome', 'win'] }, to: 'aftermath' },
        { cond: { var: ['_system', 'lastCombat.outcome', 'fled'] }, to: 'aftermath' },
      ],
    },
    {
      id: 'aftermath', journal: 'The column is broken. Leopold is away toward Zug before the rout is done.',
      onEnter: [{ cutscene: 'cs.morgarten-aftermath' }],
    },
  ],
  onStart: [{ toast: 'Quest started: Morgarten' }],
};
