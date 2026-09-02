# quest-1: side-quest giver NPCs need `dialogueRoot` wiring (not a core change; informational)

**What:** The six side quests (LORE.md §6) each have a natural "giver" NPC already present in
`src/content/npcs.ts`, and a `dlg.*` dialogue in `src/content/dialogues/side.ts` written to start that
quest on its first node:

| Quest | Giver NPC (already in npcs.ts) | Opening dialogue |
|---|---|---|
| `quest.der-saeumer` | `npc.niklaus-planzer` (poi.amsteg) | `dlg.saeumer-escort` |
| `quest.alpstreit` | `npc.melchior-arnold` (poi.sattel) | `dlg.alpstreit-dispute` |
| `quest.fischer-von-gersau` | `npc.uli-fischer` (poi.gersau) | `dlg.fischer-gersau` |
| `quest.drache-vom-pilatus` | `npc.trudi-meier` (poi.luzern) | `dlg.drache-pilatus` |
| `quest.schuetzenkoenig` | `npc.burkhard-wyrsch` (poi.altdorf) | `dlg.schuetzenkoenig-entry` |
| `quest.bad-zu-wolfenschiessen` | `npc.jost-durrer` (poi.wolfenschiessen) | `dlg.bad-wolfenschiessen` |

None of these NPCs carry a `dialogueRoot` (only the named/historical cast does, per `npcs.ts`'s own
header comment). Without it, a player walking up and pressing "talk" on e.g. Niklaus Planzer gets
whatever the exploration module's generic/archetype fallback does, not the quest offer — and nothing in
the game currently calls `quest.start('quest.der-saeumer')` etc. at all, so these six side quests are
fully authored (content validates, each quest's stage chain is complete and was spot-checked the same
way the Act 1 walkthrough test exercises the main spine) but not yet reachable in normal play.

**Why:** `src/content/npcs.ts` is owned by the exploration builder, not the quest builder — outside my
edit paths per `tools/BUILDER_RULES.md`. Wiring `dialogueRoot: 'dlg.<opening>'` onto these six NPC defs
(table above) is a one-line addition per NPC and would make all six side quests playable via ordinary
NPC interaction, exactly like the Act 1 spine's named-cast dialogues already are.

**Proposed diff (for the exploration builder / integrator):** in `src/content/npcs.ts`, add to each of
the six `minor(...)` calls listed above an options field `dialogueRoot: '<opening dialogue id from the
table>'` (the `minor()` helper already threads `dialogueRoot` through if given — confirm and add if not).

Not blocking: the quest content itself is complete and content-validated regardless of this wiring; the
harness's own scenarios don't currently exercise any of these six side quests, only `dlg.gessler-hat`.
