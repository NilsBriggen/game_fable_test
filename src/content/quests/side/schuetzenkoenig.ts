/** quest.schuetzenkoenig — a crossbow contest at Altdorf. LORE.md §6. */
import type { QuestDef } from '@core/schemas';

export const schuetzenkoenig: QuestDef = {
  id: 'quest.schuetzenkoenig', title: 'Schützenkönig', kind: 'side', chapter: 'ch1-1307',
  historical: 'invented', note: 'Formal shooting-contest competitions are attested only later; this one is I. LORE.md §6.',
  description: 'A crossbow contest by the Altdorf lime tree, eighty paces — the same distance as the legend.',
  stages: [
    {
      id: 'offer', journal: 'Burkhard Wyrsch invites you to enter the Altdorf shooting contest.',
      marker: 'poi.altdorf', objectiveText: 'Enter the contest.',
      onEnter: [{ dialogue: 'dlg.schuetzenkoenig-entry' }],
      advanceWhen: [{ cond: { nearPoi: ['poi.altdorf', 160] }, to: 'contest' }],
    },
    {
      id: 'contest', journal: 'The mark stands eighty paces off, ringed in chalk.',
      marker: 'poi.altdorf', objectiveText: 'Take your shot.',
      onEnter: [{ dialogue: 'dlg.schuetzenkoenig-contest' }],
    },
    {
      id: 'prize', journal: 'The contest is decided — the board shows the heats, and your bolt among them.',
      onEnter: [{ quest: ['complete', 'quest.schuetzenkoenig'] }],
    },
  ],
  onStart: [{ toast: 'Quest started: Schützenkönig' }],
};
