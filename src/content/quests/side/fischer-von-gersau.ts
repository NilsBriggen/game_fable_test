/** quest.fischer-von-gersau — Gersau's free village against a Habsburg toll. LORE.md §6. */
import type { QuestDef } from '@core/schemas';

export const fischerVonGersau: QuestDef = {
  id: 'quest.fischer-von-gersau', title: 'Die Fischer von Gersau', kind: 'side', chapter: 'ch1-1307',
  historical: 'invented', note: "Gersau's free-village status is H (later a free republic); this specific toll dispute is I. LORE.md §3/§6.",
  description: "Gersau's fishermen answer to no lord, yet the Brunnen toll-men stop their fish carts on the shore road all the same.",
  stages: [
    {
      id: 'toll-trouble', journal: 'Uli Fischer of Gersau complains of Habsburg toll-men harassing the fish carts.',
      marker: 'poi.gersau', objectiveText: 'Hear Uli Fischer out.',
      onEnter: [{ dialogue: 'dlg.fischer-gersau' }],
    },
    {
      id: 'confront', journal: 'The toll-man Konrad Niederberger holds the Brunnen quay road.',
      marker: 'poi.brunnen', objectiveText: 'Confront the toll collector.',
      onEnter: [{ dialogue: 'dlg.fischer-gersau-confront' }],
    },
    {
      id: 'resolution', journal: "Gersau's fish carts pass unmolested — for now.",
      onEnter: [{ quest: ['complete', 'quest.fischer-von-gersau'] }],
    },
  ],
  onStart: [{ toast: 'Quest started: Die Fischer von Gersau' }],
};
