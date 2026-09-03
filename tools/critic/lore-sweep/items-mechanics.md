# LORE sweep — items/archetypes/encounters/perks/abilities/skills

Audited: src/content/{items,archetypes,encounters,perks,abilities,skills}.ts against LORE.md §1,2,7,8,10.

No violations.

Notes (not violations, informational only): all weapons/armour trace to LORE §7's allowed list or its §10
register (item.lance, item.staff, footwear, healing consumables); era-gated items (item.langspiess
eraFrom ch2-1314, item.langschwert eraFrom ch1-1307) match §7's dating; windlass crossbow spanning is
explicitly excluded everywhere it's mentioned (items.ts:34, perks.ts:149, abilities.ts:38); no perk/ability
grants a supernatural effect; encounter `historical` flags (legend for Tell/Gessler beats, true for
Einsiedeln raid and Morgarten, invented for the generic Habsburg patrol) match §1/§6 status per event; no
banned terms (plate harness, handgonne, rapier, potato/tobacco/coffee, Landsknecht, pike square, etc.) found.
