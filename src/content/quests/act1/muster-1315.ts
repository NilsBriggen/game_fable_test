/** quest.muster-1315 — the year of preparation before Morgarten. LORE.md §6. */
import type { QuestDef } from '@core/schemas';

export const muster1315: QuestDef = {
  id: 'quest.muster-1315', title: 'Das Jahr der Rüstung', kind: 'main', chapter: 'ch2-1314',
  historical: true, note: 'The year of preparation between the excommunication and Morgarten (Nov 1315), the Sattel letzi, and Leopold\'s Zug muster are H in outline; the Hünenberg warning-arrow is L tradition. LORE.md §1/§5/§6.',
  description: 'A year of readiness: strengthen the letzi at Sattel, recruit, scout Leopold\'s muster at Zug, and weigh the Hünenberg warning.',
  stages: [
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
      id: 'scout-zug', journal: "Duke Leopold's column musters at Zug — someone must see how many they are.",
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
      onEnter: [
        { quest: ['complete', 'quest.muster-1315'] },
        { quest: ['start', 'quest.morgarten'] },
      ],
    },
  ],
  onStart: [{ toast: 'Quest started: Das Jahr der Rüstung' }],
};
