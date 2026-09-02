/** quest.marchenstreit — Chapter 2 opening: the Epiphany 1314 raid on Einsiedeln. LORE.md §6. */
import type { QuestDef } from '@core/schemas';

export const marchenstreit: QuestDef = {
  id: 'quest.marchenstreit', title: 'Marchenstreit', kind: 'main', chapter: 'ch2-1314',
  historical: true, note: 'The Marchenstreit escalation on the night of Epiphany 1314 — the raid on Einsiedeln abbey and the resulting excommunication — is H. LORE.md §1/§6.',
  description: 'On the night of the Epiphany, the old quarrel over the March pastures breaks into the open. Schwyz argues for raiding Einsiedeln abbey.',
  stages: [
    {
      id: 'epiphany-argument', journal: 'The night of the Heiligen Drei Könige, 1314: Konrad Ab Yberg and Werner Stauffacher argue in the Schwyz Landsgemeinde hall over the March pastures.',
      marker: 'poi.schwyz', objectiveText: 'Hear the argument and choose a side.',
      onEnter: [{ dialogue: 'dlg.marchenstreit-rat' }],
    },
    {
      id: 'travel-einsiedeln', journal: 'Word carries ahead of you, toward Einsiedeln.',
      marker: 'poi.einsiedeln', objectiveText: 'Make for Einsiedeln abbey.',
      advanceWhen: [
        { cond: { all: [{ nearPoi: ['poi.einsiedeln', 140] }, { var: ['quest.marchenstreit', 'restraint', false] }] }, to: 'raid' },
        { cond: { all: [{ nearPoi: ['poi.einsiedeln', 140] }, { var: ['quest.marchenstreit', 'restraint', true] }] }, to: 'speech-path' },
      ],
    },
    {
      id: 'raid', journal: 'The raiding party moves on Einsiedeln abbey before dawn — plunder, and monks dragged back to Schwyz.',
      marker: 'poi.einsiedeln', objectiveText: 'The raid on Einsiedeln abbey.',
      // Anselm (companion pool, LORE.md §5/§10) is torn on this raid; `dlg.bruder-anselm`'s
      // `conflicted` variant already assumes he is present for it. Critic wave3-quest.md #6/§6 step 10:
      // restraint decides whether he stays — a brutal raid he did not choose costs the party his company.
      // `removeCompanion` on someone who was never a member is a safe no-op, so this is unconditional.
      onEnter: [{ removeCompanion: 'npc.bruder-anselm' }, { encounter: 'enc.einsiedeln-gate' }, { rep: ['einsiedeln', -20] }],
      advanceWhen: [
        { cond: { var: ['quest.marchenstreit', 'combat.outcome', 'win'] }, to: 'aftermath' },
        { cond: { var: ['quest.marchenstreit', 'combat.outcome', 'fled'] }, to: 'aftermath' },
        { cond: { var: ['quest.marchenstreit', 'combat.outcome', 'lose'] }, to: 'aftermath' },
      ],
    },
    {
      id: 'speech-path', journal: 'You press for restraint. Abbot Johannes agrees to hear terms before Schwyz\'s men take matters further.',
      marker: 'poi.einsiedeln', objectiveText: 'Negotiate with Abbot Johannes.',
      onEnter: [{ dialogue: 'dlg.abt-johannes' }],
    },
    {
      id: 'aftermath', journal: 'Within weeks, word comes down from the bishop: the Confederates stand excommunicated over the abbey affair.',
      onEnter: [
        { quest: ['complete', 'quest.marchenstreit'] },
        { quest: ['start', 'quest.muster-1315'] },
      ],
    },
  ],
  onStart: [{ toast: 'Quest started: Marchenstreit' }],
};
