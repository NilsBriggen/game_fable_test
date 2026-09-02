/** quest.drache-vom-pilatus — a "dragon" that is a lammergeier and a smuggler. LORE.md §6. */
import type { QuestDef } from '@core/schemas';

export const dracheVomPilatus: QuestDef = {
  id: 'quest.drache-vom-pilatus', title: 'Der Drache vom Pilatus', kind: 'side', chapter: 'ch1-1307',
  historical: 'legend', note: 'Pilatus dragon lore is explicitly folk legend told as a story, never a monster in play. LORE.md §3/§6.',
  description: 'An innkeeper in Luzern asks you to look into rumours of a "dragon" seen circling Pilatus.',
  stages: [
    {
      id: 'rumour', journal: 'Trudi Meier of Luzern relays a rumour of a dragon over Pilatus.',
      marker: 'poi.luzern', objectiveText: 'Hear the rumour.',
      onEnter: [{ dialogue: 'dlg.drache-pilatus' }],
    },
    {
      id: 'climb', journal: 'The alp of Pilatus rises above the Luzern basin.',
      marker: 'poi.pilatus', objectiveText: 'Climb toward Pilatus.',
      advanceWhen: [{ cond: { nearPoi: ['poi.pilatus', 55] }, to: 'truth' }],
    },
    {
      id: 'truth', journal: 'Something large circles the high cliffs.',
      marker: 'poi.pilatus', objectiveText: 'Find the truth of the "dragon".',
      onEnter: [{ dialogue: 'dlg.drache-pilatus-truth' }],
    },
    {
      id: 'resolution', journal: 'No dragon — a lammergeier, and a smuggler\'s cache.',
      onEnter: [{ quest: ['complete', 'quest.drache-vom-pilatus'] }],
    },
  ],
  onStart: [{ toast: 'Quest started: Der Drache vom Pilatus' }],
};
