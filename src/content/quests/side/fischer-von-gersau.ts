/** quest.fischer-von-gersau — Gersau's free village against a Habsburg toll. LORE.md §6. */
import type { QuestDef } from '@core/schemas';

export const fischerVonGersau: QuestDef = {
  id: 'quest.fischer-von-gersau', title: 'Die Fischer von Gersau', kind: 'side', chapter: 'ch1-1307',
  historical: 'invented', note: "Gersau's free-village status is H (later a free republic); this specific toll dispute is I. LORE.md §3/§6.",
  description: "Gersau's fishermen answer to no lord, yet the Brunnen toll-men stop their fish carts on the shore road all the same.",
  stages: [
    {
      id: 'trouble', journal: 'Uli Fischer of Gersau complains of Habsburg toll-men harassing the fish carts.',
      marker: 'poi.gersau', objectiveText: 'Hear Uli Fischer out.',
      onEnter: [{ dialogue: 'dlg.fischer-gersau' }, { quest: ['advance', 'quest.fischer-von-gersau', 'confront'] }],
    },
    {
      id: 'confront', journal: 'The toll-man Konrad Niederberger holds the Brunnen quay road.',
      marker: 'poi.brunnen', objectiveText: 'Confront the toll collector.',
      onEnter: [{ dialogue: 'dlg.fischer-gersau-confront' }],
    },
    {
      id: 'freedom', journal: "The toll-man yielded: Gersau's fish carts pass the Brunnen quay unmolested, and Konrad counts the smaller carts twice before he troubles them again.",
      marker: 'poi.gersau', objectiveText: 'Bring the news back to Uli.',
      onEnter: [{ dialogue: 'dlg.fischer-gersau-return' }],
    },
    {
      id: 'tribute', journal: "The toll stands, grudgingly softened for the smaller carts. Uli will want to hear how it went — and what it will cost Gersau.",
      marker: 'poi.gersau', objectiveText: 'Bring the news back to Uli.',
      onEnter: [{ dialogue: 'dlg.fischer-gersau-return' }],
    },
  ],
  onStart: [{ toast: 'Quest started: Die Fischer von Gersau' }],
};
