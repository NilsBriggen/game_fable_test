/** quest.epilog-1308 — Chapter 1 epilogue: Albrecht's murder, and the leap to 1314. LORE.md §6. */
import type { QuestDef } from '@core/schemas';

export const epilog1308: QuestDef = {
  id: 'quest.epilog-1308', title: 'News from Windisch', kind: 'main', chapter: 'ch1-1307',
  historical: true, note: 'King Albrecht I was murdered near Windisch on 1 May 1308 by his nephew Johann "Parricida" of Swabia. LORE.md §1/§6.',
  description: 'Word arrives from the Aargau: King Albrecht I is dead, murdered by his own nephew. Habsburg pressure on the Länder pauses.',
  stages: [
    {
      // Critic wave3-quest.md #5: the stage's own `journal` line is recorded (with the clock's *current*
      // game time as its timestamp) before `onEnter` runs — so a precisely-dated claim ("1 May 1308")
      // belongs in an explicit `{journal}` effect placed *after* `{setTime}`, not in this field. This one
      // stays a plain, time-independent line.
      id: 'news', journal: 'A rider comes in from the Aargau, road-worn and grim-faced.',
      objectiveText: 'Hear the news.',
      onEnter: [
        { setTime: [1308, 5, 1, 9] },
        { journal: 'A rider brings word from the Aargau: on the first of May, King Albrecht I is murdered near Windisch by his nephew, Johann of Swabia, whom the chroniclers will call "Parricida". For a while, at least, Vienna has other cares than the Waldstätte.' },
        { setChapter: 'ch2-1314' },
        { quest: ['complete', 'quest.epilog-1308'] },
        { quest: ['start', 'quest.marchenstreit'] },
      ],
    },
  ],
  onStart: [{ toast: 'News reaches the valleys: King Albrecht I is dead.' }],
};
