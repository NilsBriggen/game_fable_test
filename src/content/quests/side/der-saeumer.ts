/** quest.der-saeumer — escort a mule train through the Schöllenen. LORE.md §6. */
import type { QuestDef } from '@core/schemas';

export const derSaeumer: QuestDef = {
  id: 'quest.der-saeumer', title: 'Der Säumer', kind: 'side', chapter: 'ch1-1307',
  historical: 'invented', note: 'Säumer cooperatives of the Gotthard are H (14th c.); this specific escort is I. LORE.md §6.',
  description: 'Lead a Säumer mule train up the Gotthard road and through the Schöllenen gorge, past the treacherous footing of the Teufelsbrücke.',
  stages: [
    {
      id: 'offer', journal: 'Niklaus Planzer of Amsteg asks for an extra pair of eyes on the road to Ursern.',
      marker: 'poi.amsteg', objectiveText: 'Escort the mule train.',
      onEnter: [{ dialogue: 'dlg.saeumer-escort' }],
    },
    {
      id: 'schoellenen', journal: 'The road climbs into the Schöllenen gorge, toward the Teufelsbrücke.',
      marker: 'poi.teufelsbruecke', objectiveText: 'Lead the train to the Teufelsbrücke.',
      advanceWhen: [{ cond: { discovered: 'poi.teufelsbruecke' }, to: 'crossing' }],
    },
    {
      id: 'crossing', journal: "Spray from the falls slicks the bridge timber underfoot.",
      marker: 'poi.teufelsbruecke', objectiveText: 'Cross the Teufelsbrücke.',
      onEnter: [{ dialogue: 'dlg.saeumer-crossing' }],
    },
    {
      id: 'reward', journal: 'The train reaches Andermatt safe, more or less.',
      onEnter: [{ giveItem: ['item.pfennig-purse', 1] }, { rep: ['saeumer', 10] }, { quest: ['complete', 'quest.der-saeumer'] }],
    },
  ],
  onStart: [{ toast: 'Quest started: Der Säumer' }],
};
