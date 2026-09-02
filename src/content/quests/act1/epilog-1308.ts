/** quest.epilog-1308 — Chapter 1 epilogue: Albrecht's murder, and the leap to 1314. LORE.md §6. */
import type { QuestDef } from '@core/schemas';

export const epilog1308: QuestDef = {
  id: 'quest.epilog-1308', title: 'News from Windisch', kind: 'main', chapter: 'ch1-1307',
  historical: true, note: 'King Albrecht I was murdered near Windisch on 1 May 1308 by his nephew Johann "Parricida" of Swabia. LORE.md §1/§6.',
  description: 'Word arrives from the Aargau: King Albrecht I is dead, murdered by his own nephew. Habsburg pressure on the Länder pauses.',
  stages: [
    {
      id: 'news', journal: 'A rider brings word from the Aargau: King Albrecht I is murdered near Windisch by his nephew, Johann of Swabia, whom the chroniclers will call "Parricida". For a while, at least, Vienna has other cares than the Waldstätte.',
      objectiveText: 'Hear the news.',
      onEnter: [
        { advanceTime: 6 },
        { setChapter: 'ch2-1314' },
        { quest: ['complete', 'quest.epilog-1308'] },
        { quest: ['start', 'quest.marchenstreit'] },
      ],
    },
  ],
  onStart: [{ toast: 'News reaches the valleys: King Albrecht I is dead.' }],
};
