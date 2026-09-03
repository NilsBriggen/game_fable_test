# Lore sweep — src/content/npcs.ts & src/content/factions.ts

Audited against LORE.md §1,2,5,7,8,10. `factions.ts` is clean (all H/I statuses,
hostility sets, and material/terminology checks match §2 and §7). One concrete
issue found in `npcs.ts`.

| file:line | class | LORE § | problem | fix |
|---|---|---|---|---|
| src/content/npcs.ts:393 | (a) | §3 (`uri-gotthard` row) | `npc.bruder-gion`, the Gotthard-hospice monk, is faction `'einsiedeln'`, but §3 states Andermatt/Ursern (the valley the hospice sits in) is "a separate valley community under the **Disentis** abbey," and the region's owner column is `uri` — Einsiedeln abbey (Schwyz side, far from the Gotthard) has no attested link to the hospice anywhere in LORE.md. | Change faction to `'uri'` (matching the region owner column) or `'none'`, not `'einsiedeln'`. |

No other violations found: all H/L/I `historical` flags on the named cast (§5) match LORE's
per-entry status exactly (Stauffacher name-H/role-L, Fürst/Melchtal/Tell/Gessler/Landenberg/
Hünenberg L, Attinghausen/Leopold I/Abt Johannes/Winterthur H, Ab Yberg family-H/individual-I),
Leopold I's birth year (1290) is historically correct, chapter-gating matches the file's own
§5/§1 restrictions (Gessler/Landenberg/Tell ch1 only; Leopold/Hünenberg/Winterthur ch2 only),
all equipment ids are period items per §7, no banned anachronisms ("canton" in speech,
"Switzerland", gunpowder, windlass crossbow, Kapellbrücke) appear in either file, and all
invented minor NPCs default to `historical: 'invented'` with Alemannic names per §8, consistent
with the §10 register row covering them.
