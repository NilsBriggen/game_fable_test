# Lore sweep — named-cast.ts / spine.ts

| file:line | class | LORE § | problem | fix |
|---|---|---|---|---|
| src/content/dialogues/named-cast.ts:157 | (a) | §5 (`npc.werner-von-attinghausen` row: "Landammann of Uri c. 1294–1321") | In the `prologue-other` node, gated to `chapter: 'prologue-1291'` (Aug 1291), Attinghausen says "while I hold the Landammann's staff" — three years before LORE's own start date for that office. | Reword the 1291 line to speak as Freiherr only (drop the Landammann-staff claim), or gate the line to ch1/ch2 where the title is valid. |

No other concrete violations found: naming (Landvogt/Vogt/Freiherr/Ammann/Bruder/Vater Abt), places, quest-spine order, and all L-flagged legend content (Tell, Gessler, Landenberg, Burgenbruch, Hünenberg arrow) carry correct `historical: 'legend'` file-level flags and in-world "as it is told" framing where prose states outcomes. No anachronistic vocabulary, items, or "Switzerland/canton/Swiss" usage found in either file.
