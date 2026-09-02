/** quest.morgarten — 15 November 1315, the battle. LORE.md §6. */
import type { QuestDef } from '@core/schemas';

export const morgarten: QuestDef = {
  id: 'quest.morgarten', title: 'Morgarten', kind: 'main', chapter: 'ch2-1314',
  historical: true, note: 'Battle of Morgarten, 15 Nov 1315: Duke Leopold I\'s column ambushed between the Ägerisee and the Figlenfluh slope; rocks and halberds against cramped cavalry; Leopold escapes. LORE.md §1/§6.',
  description: "Duke Leopold's column marches from Zug along the Ägerisee toward Schwyz. The Confederates hold the slope above the road.",
  stages: [
    {
      id: 'travel-morgarten', journal: 'The muster marches for the Morgarten slope, above the road from Ägeri.',
      marker: 'poi.morgarten', objectiveText: 'Take position on the Morgarten slope.',
      advanceWhen: [{ cond: { discovered: 'poi.morgarten' }, to: 'battle' }],
    },
    {
      id: 'battle', journal: '15 November, 1315. The column comes on between the lake and the slope, and the boulder caches wait above the road.',
      marker: 'poi.morgarten', objectiveText: 'Hold the slope, then rout the column at Morgarten.',
      onEnter: [{ encounter: 'enc.morgarten' }],
      advanceWhen: [
        { cond: { var: ['quest.morgarten', 'combat.outcome', 'win'] }, to: 'aftermath' },
        { cond: { var: ['quest.morgarten', 'combat.outcome', 'fled'] }, to: 'aftermath' },
        { cond: { var: ['quest.morgarten', 'combat.outcome', 'lose'] }, to: 'carried-off' },
      ],
    },
    {
      // Critic wave3-quest.md #9: a lost Morgarten cannot just hang — but it also cannot simply be
      // re-fought on the spot (the historical ambush depends on the muster-year's preparations). Failing
      // here fails quest.morgarten outright; the `quest-failed` listener in QuestServiceImpl (index.ts)
      // resets and restarts quest.muster-1315 so the player genuinely goes back through the letzi/
      // recruit/scout/Hünenberg hub — not an instant retry — before the column is faced again.
      id: 'carried-off', journal: 'The line breaks and you are carried off the field, bleeding, as the column presses on toward Schwyz. It will have to be faced again — and better prepared.',
      onEnter: [{ quest: ['fail', 'quest.morgarten'] }],
    },
    {
      id: 'aftermath', journal: 'The column is broken. Leopold is away toward Zug before the rout is done.',
      onEnter: [{ cutscene: 'cs.morgarten-aftermath' }],
    },
  ],
  onStart: [{ toast: 'Quest started: Morgarten' }],
};
