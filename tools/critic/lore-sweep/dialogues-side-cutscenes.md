# Lore sweep — side.ts, generic.ts, cutscenes/index.ts

Scope: src/content/dialogues/side.ts, src/content/dialogues/generic.ts, src/content/cutscenes/index.ts
Checked against LORE.md §1, §2, §5, §6, §7, §8, §10.

No violations.

Notes (not violations, verified clean):
- historical flags (true/'legend'/'invented') on every dialogue and cutscene entry match LORE §1/§6 status per event (Bundesbrief/Morgarten/Brunnen = H; Tell/Gessler/apple-shot/Tellsplatte/Wolfenschiessen/Pilatus-dragon = L; side-quest plots = I).
- Speaker NPC ids/names (Niklaus Planzer, Melchior Arnold, Uli Fischer, Trudi Meier, Burkhard Wyrsch, Jost Durrer, Konrad Niederberger) all match LORE §10's register and exist in npcs.ts.
- No banned anachronisms found ("Switzerland", "canton", "Swiss" as identity, potato/maize/tomato/tobacco/chocolate) in any speech or caption text.
- cutscene dates/order (Aug 1291 → 1307 → 15 Nov 1315 → 9 Dec 1315) and setTime calls match §1 timeline and §6 spine order.
- Currency, food, and material-culture references (Pfennig, Zürich Pfund, Alpkäse) match §7.
- Forms of address and oaths ("Ammann", "Landvogt", "Bei Sankt Verena") match §8.
