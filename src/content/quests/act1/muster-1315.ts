/** quest.muster-1315 — the year of preparation before Morgarten. LORE.md §6. */
import type { QuestDef } from '@core/schemas';

export const muster1315: QuestDef = {
  id: 'quest.muster-1315', title: 'Das Jahr der Rüstung', kind: 'main', chapter: 'ch2-1314',
  historical: true, note: 'The year of preparation between the excommunication and Morgarten (Nov 1315), the Sattel letzi, and Leopold\'s Zug muster are H in outline; the Hünenberg warning-arrow is L tradition. LORE.md §1/§5/§6.',
  description: 'A year of readiness: strengthen the letzi at Sattel, recruit, scout Leopold\'s muster at Zug, and weigh the Hünenberg warning.',
  stages: [
    {
      id: 'travel-sattel', journal: 'A year of readiness begins. The letzi at Sattel needs raising before the work becomes impossible in the snow.',
      marker: 'poi.sattel-letzi', objectiveText: 'Make for the letzi at Sattel.',
      advanceWhen: [
        { cond: { all: [{ nearPoi: ['poi.sattel-letzi', 80] }, { flag: 'morgarten.retry' }] }, to: 'sattel-retry' },
        { cond: { nearPoi: ['poi.sattel-letzi', 80] }, to: 'letzi-craft' },
      ],
    },
    {
      // 3.1: retry-only beat. Unreachable on the first pass (`morgarten.retry` is unset);
      // on the retry the silent start suppresses this journal line and the handler's
      // summary line covers it. Fires on arrival (advanceWhen), not at quest start.
      id: 'sattel-retry', journal: 'Carried off once at Morgarten, you gather what is left and ready the muster again.',
      marker: 'poi.sattel-letzi', objectiveText: 'Speak with the survivors at Sattel.',
      onEnter: [{ dialogue: 'dlg.muster-retry' }],
    },
    {
      id: 'letzi-craft', journal: 'The letzi wall at Sattel must be raised before the snow makes the work impossible.',
      marker: 'poi.sattel-letzi', objectiveText: 'Strengthen the letzi at Sattel.',
      onEnter: [{ dialogue: 'dlg.muster-letzi' }],
    },
    {
      id: 'recruit', journal: 'Every valley must send men to the muster.',
      marker: 'poi.schwyz', objectiveText: 'Recruit for the muster.',
      onEnter: [{ dialogue: 'dlg.muster-recruit' }],
    },
    {
      id: 'travel-zug', journal: "Word says Duke Leopold's column is mustering at Zug — someone must see how many they are.",
      marker: 'poi.zug', objectiveText: 'Make for Zug.',
      advanceWhen: [{ cond: { nearPoi: ['poi.zug', 190] }, to: 'scout-zug' }],
    },
    {
      id: 'scout-zug', journal: "Duke Leopold's column musters at Zug.",
      marker: 'poi.zug', objectiveText: 'Scout the Habsburg muster at Zug.',
      onEnter: [{ dialogue: 'dlg.muster-scout' }],
    },
    {
      id: 'hunenberg', journal: 'An unsigned arrow strikes the letzi post at dawn, a warning bound to the shaft.',
      marker: 'poi.sattel-letzi', objectiveText: "Decide whether to trust Hünenberg's warning.",
      onEnter: [{ dialogue: 'dlg.heinrich-von-hunenberg' }],
    },
    {
      id: 'ready', journal: 'The muster is as ready as it will ever be. Word comes that Leopold\'s column has begun to move.',
      // Critic wave3-quest.md round 2 #3: setTime here, BEFORE quest.morgarten starts — quest.morgarten's
      // own 'battle' stage journals "15 November, 1315" as its *stage-level* journal text, which is
      // recorded before that stage's own onEnter runs (see quests.ts enterStage), so setting the date
      // there would be too late. Setting it here means the clock is already 15 Nov by the time it matters.
      onEnter: [
        { setFlag: ['morgarten.retry', false] },
        { setTime: [1315, 11, 15, 6] },
        { quest: ['complete', 'quest.muster-1315'] },
        { quest: ['start', 'quest.morgarten'] },
      ],
    },
  ],
  onStart: [{ toast: 'Quest started: Das Jahr der Rüstung' }, { music: 'music.explore' }],
};
