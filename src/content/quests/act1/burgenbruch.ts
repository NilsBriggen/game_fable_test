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
      // Critic wave3-quest.md round 3 #2: gate the set piece on actually being at the castle — a
      // choice to "storm Zwing Uri yourself" must not resolve the fight before the player has walked
      // there, same as every other travel-* gate in the spine.
      id: 'travel-zwing-uri', journal: 'You set out for Zwing Uri, half-built above Amsteg.',
      marker: 'poi.zwing-uri', objectiveText: 'Make for Zwing Uri.',
      advanceWhen: [{ cond: { nearPoi: ['poi.zwing-uri', 90] }, to: 'zwing-uri' }],
    },
    {
      id: 'zwing-uri', journal: 'Zwing Uri stands half-built above Amsteg, ready to be taken.',
      marker: 'poi.zwing-uri', objectiveText: 'Take Zwing Uri.',
      onEnter: [{ dialogue: 'dlg.zwing-uri-stealth' }],
    },
    {
      id: 'travel-rotzberg', journal: 'You set out for Rotzberg, above Stans, to climb its wall by night.',
      marker: 'poi.rotzberg', objectiveText: 'Make for Rotzberg.',
      advanceWhen: [{ cond: { nearPoi: ['poi.rotzberg', 90] }, to: 'rotzberg' }],
    },
    {
      id: 'rotzberg', journal: 'Rotzberg\'s wall rises above you in the dark.',
      marker: 'poi.rotzberg', objectiveText: 'Take Rotzberg.',
      onEnter: [{ dialogue: 'dlg.rotzberg-climb' }],
    },
    {
      id: 'travel-sarnen', journal: "You set out to join the New Year's gift procession into Sarnen, weapons hidden in the baskets.",
      marker: 'poi.landenberg', objectiveText: 'Make for Landenberg\'s hill at Sarnen.',
      advanceWhen: [{ cond: { nearPoi: ['poi.landenberg', 90] }, to: 'sarnen' }],
    },
    {
      id: 'sarnen', journal: "The gift procession forms up below Landenberg's hill.",
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
  onStart: [{ toast: 'Quest started: Burgenbruch' }, { music: 'music.explore' }],
};
