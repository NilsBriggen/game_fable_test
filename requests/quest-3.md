# quest-3: two more Morgarten flags for combat to read (letzi, recruits)

Follow-up to `requests/quest-2.md` (still open, `hunenberg-warning`). Fix round 2, critic issue 5:
`quest.muster-1315`'s letzi-craft and recruit checks (`src/content/dialogues/spine.ts`, `dlg.muster-letzi`
/ `dlg.muster-recruit`) now set two more flags for `enc.morgarten` to read at encounter-setup time, the
same way it should already read `hunenberg-warning`:

| Flag | Set when | LORE hook |
|---|---|---|
| `morgarten.letzi-improved` (boolean) | the craft check on the Sattel letzi succeeds (`letzi-strong` outcome) | An extra letzi segment/course of cover on the Confederate side of the grid — a defensive perk for the `hold the slope` opening turns, symmetrical with the existing `hunenberg-warning` (which *removes* a boulder cache when ignored; this *adds* something when earned). |
| `morgarten.recruits-strong` (boolean) | the leadership check on recruiting succeeds (`recruit-strong` outcome) | Two extra `militia-spear` allied units on the player's side of `enc.morgarten`'s `units` array — reads naturally as "the Schwyz contingent swelled past what the old counts allowed for" (the dialogue's own line) actually showing up on the field. |

Both flags are plain booleans on the shared quest-service flag store, read the same way as
`hunenberg-warning`: `ctx.services.get('quest').getFlag('morgarten.letzi-improved' | 'morgarten.recruits-strong')`.
Both are set well before `quest.morgarten` starts (during the preceding `quest.muster-1315`), so — like
`hunenberg-warning` — there's no ordering concern reading them at `enc.morgarten` build time.

Not asking for anything on `scouted`: that one now shows the column's size directly in
`dlg.muster-scout`'s own text and an explicit journal line, no encounter-content change needed.
