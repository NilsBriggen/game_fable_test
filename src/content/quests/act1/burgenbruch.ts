/**
 * quest.burgenbruch — the storming of Zwing Uri, Rotzberg and Sarnen/Landenberg. Started by
 * quest.der-hut's 'burgenbruch' stage; the player plays at least one set piece and may delegate the
 * rest to companions via a leadership check. LORE.md §6.
 */
import type { QuestDef } from '@core/schemas';

export const burgenbruch: QuestDef = {
  id: 'quest.burgenbruch', title: 'Burgenbruch', kind: 'main', chapter: 'ch1-1307',
  historical: 'legend', note: 'Wholly L (Weisses Buch von Sarnen); "told in Sarnen" per the tradition itself. LORE.md §1/§6.',
  description: 'Three strongholds must fall before spring: half-built Zwing Uri, Rotzberg above Stans, and Landenberg\'s hill at Sarnen.',
  stages: [
    {
      id: 'choose', journal: 'Three strongholds await: Zwing Uri by the Gotthard road, Rotzberg above Stans, and Landenberg\'s hill at Sarnen.',
      objectiveText: 'Storm at least one stronghold yourself, or send trusted companions to the rest.',
      onEnter: [{ dialogue: 'dlg.burgenbruch-council' }],
    },
    {
      id: 'zwing-uri', journal: 'You make for Zwing Uri, half-built above Amsteg, to take it yourself.',
      marker: 'poi.zwing-uri', objectiveText: 'Take Zwing Uri.',
      onEnter: [{ dialogue: 'dlg.zwing-uri-stealth' }],
    },
    {
      id: 'rotzberg', journal: 'You make for Rotzberg, above Stans, to climb its wall by night.',
      marker: 'poi.rotzberg', objectiveText: 'Take Rotzberg.',
      onEnter: [{ dialogue: 'dlg.rotzberg-climb' }],
    },
    {
      id: 'sarnen', journal: "You join the New Year's gift procession into Sarnen, weapons hidden in the baskets.",
      marker: 'poi.landenberg', objectiveText: "Take Landenberg's hill at Sarnen.",
      onEnter: [{ dialogue: 'dlg.sarnen-procession' }],
    },
    {
      id: 'aftermath', journal: 'By spring, all three strongholds have fallen — told in Sarnen ever after as the Burgenbruch.',
      onEnter: [
        { rep: ['uri', 2] }, { rep: ['unterwalden', 2] },
        { quest: ['complete', 'quest.burgenbruch'] },
      ],
    },
  ],
  onStart: [{ toast: 'Quest started: Burgenbruch' }],
};
