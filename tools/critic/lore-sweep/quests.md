# Quest-file lore audit

Scope: all .ts under src/content/quests/ (act1/*, side/*, index.ts), checked against LORE.md §1, §2, §5, §6, §8, §10.

No violations.

Notes (not violations, verified against LORE before excluding):
- `quest.der-eid` fusing the 1291 Bundesbrief sealing with the Rütli oath by the three L figures is LORE
  §6 Prologue's own mandated staging (`der-eid.ts:35-48`), registered in §10 "Time-skip structure".
- `quest.drache-vom-pilatus` uses innkeeper Trudi Meier, not the "monk" of §6's one-line side-quest list,
  but §10's register line explicitly names Trudi Meier as the sanctioned reuse for this quest.
- All 8 main + 6 side quests' `historical` flags (true/'legend'/'invented') match §1/§6's H/L/I status per
  event, and every `chapter` field matches §1's date bands and §6's chapter grouping.
- `setTime` calls (`epilog-1308.ts:17` → 1 May 1308; `muster-1315.ts:46` → 15 Nov 1315) match §1 exactly.
- No banned anachronisms (§7 list, "canton" in NPC speech) found in any journal/objective string.
