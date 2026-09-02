# Wave 3 — quest (+ act1-content) — critic score — round 2/3

Reference: Skyrim + KCD (quests with choices, factions with memory, grounded tone); LORE.md for act1-content
Code reviewed: working tree at `116a8f5` ("Quest: fix round 1 …, 60 tests").
Harness run: **no clean capture this round.** `node tools/harness/run.mjs --scenario dialogue-gessler-hat` (foreground, 600 000 ms) exceeded the
timeout with two builders rendering concurrently and was backgrounded (its output file is empty; 9 harness process(es) still alive at
write time). Meanwhile `tools/harness/out/` was overwritten at 19:29 by another builder's `free-altdorf` run, which itself died
("Target page … closed", `ERR_CONNECTION_REFUSED` on port 5543). The only module-specific harness evidence remains round 1's run on the
pre-fix code (0 console errors, 0 page errors, 0 warnings). Scored on tests/code/probes per the coordinator's instruction.
Evidence read: `npx vitest run src/quest` → `Test Files 8 passed (8) / Tests 60 passed (60)`; `npx tsc --noEmit | grep …` → no lines (clean);
`node tools/check-imports.mjs` → `imports ok`; full read of `src/quest/*.ts`, `src/content/{quests,dialogues,cutscenes}`, the 13 new tests,
`requests/quest-2.md`, `src/combat/engine.ts:118-137`; 11 adversarial probes in `<scratchpad>/probes/quest2.probe.test.ts` +
`quest3.probe.test.ts` (11/11 green — several print the defects below rather than assert against them).

## Score: 7/10   (pass bar 8)  → FAIL (round 2/3)
- quest engine (vs Skyrim/KCD): **7/10** (was 6)
- act1-content (vs LORE + KCD tone): **7/10** (was 5)

## Round-1 issues → status

| # | Round-1 issue | Status | Evidence |
|---|---|---|---|
| 1 | Stale `lastCombat.outcome` advances a stage mid-combat | **Fixed** | `effects.ts:236-247` clears `<quest>.combat.*` + `_system` before awaiting; probe 5: `quest.b` stays on `fight` under `tick(0.5)` until the pending fight resolves; no content stage gates on `_system` any more (probe 5b) |
| 2 | No arrival gates; nested cutscene/dialogue chain; no `dialogue` state | **Partial** | `travel-*` stages added to every spine quest; `cutsceneDepth` + deferred queue (`index.ts:300-328`); `runDialogue` requests `dialogue`/`explore` (`dialogue.ts:135,215`). **But** (a) gates are `{discovered}`, a persistent one-time flag — Altdorf is discovered in the prologue, so `der-hut.travel-altdorf` passes instantly in every playthrough: probe 6 shows Chapter 1 running `travel-altdorf → altdorf-pole → apple-shot → cs.apfelschuss` straight out of the sealing cutscene, player still at the Rütli, halting only at `travel-tellsplatte`; any POI the player explored earlier (Skyrim behaviour) kills that later gate too. (b) The deferred queue guards cutscene nesting only; node `effects` run *before* the node's text is shown (`dialogue.ts:151-160`), so `dlg.ruetli-oath.close` fires the sealing cutscene, the chapter change, the hat dialogue, Tell and the apple-shot cutscene and only then displays "So sworn" — probe 9 UI order: sealing caption #7, hat #9, Tell #10, **"So sworn" #15**; state sequence `dialogue > cutscene > explore > dialogue > dialogue > cutscene > explore > explore > explore > explore` |
| 3 | Abt Johannes "say nothing" soft-lock | **Fixed** | `named-cast.ts:194` advances to `raid`; last-enabled walkthrough test + probe 7a reach Brunnen (`combat.calls` includes `enc.einsiedeln-gate`) |
| 4 | Unhandled rejections; `services.get('combat')` | **Fixed** | `index.ts:172-179` default win + warn; `.catch` on `start/advance/complete/fail` (`index.ts:279-282`) and `checkAdvance` (`quests.ts:151`); probe 4: 0 rejections, quest reaches `s2` |
| 5 | Eight compliance violations | **Fixed in this module** | see audit below. Residual **outside** the module: `src/content/npcs.ts:112` "Wilhelm Tell's father-in-law", `src/content/pois.ts:149` "his wife Gertrud" (exploration builder's descriptions; player-facing if the UI shows them) — integrator item |
| 6 | Clock/journal date mismatches | **Mostly fixed** | `setTime` before the Windisch, Morgarten-aftermath and Brunnen journal effects (probe 7b timestamps 1308-05-01, 1315-11-15). Residual: `morgarten.ts` stage `battle`'s own journal "15 November, 1315…" is still stamped at the clock's **1314-01-06** (the `setTime` lives in the aftermath cutscene, after the stage line) |
| 7 | Choices LORE says matter were inert | **Fixed** | `hunenberg-warning` consumed by `combat/engine.ts:126-135` (two caches dropped, caption); Anselm `removeCompanion` on `raid` (`marchenstreit.ts:29`); Tell `addCompanion` in `cs.tellsplatte`, removed at `der-hut.epilogue` (probe 8: party 1→2→1); `gessler-hat-choice` written for all four outcomes and read back by Fürst (`named-cast.ts:61-62`) and Attinghausen (`:161-163`) — probe 1 prints both lines |
| 8 | Skill-check cache key | **Fixed** | `dialogue.ts:57-59` `dialogue:node:choice[:speaker]`; probe 2: `dlg.p:n:0` and `dlg.p:n:1` independent; restore replays |
| 9 | Post-order events; `setChapter` guard; root fallback | **Fixed** | `quests.ts:106-109` pre-order (probe 8 index check); `index.ts:337` idempotent (probe 3: one `populate`); `dialogue.ts:74-82` warns and ends; Arnold has a 1291 node (probe 8 prints it). Note: `chapterSet` is not serialized, so after `restore()` a `setChapter(sameChapter)` re-populates once (probe 3b) — decide whether save/load relies on that |
| 10 | Stage-id contract with exploration; lose branches | **Half** | Lose branches added (`escort-recover`, `hohle-gasse-recover`, `carried-off` → fail → retry from the muster hub; probe 7b: Morgarten lost once, fought twice, Brunnen reached). Exploration ids: builder filed `requests/quest-2.md` (correct and clear); `src/exploration/poi.ts:24-28` unchanged, so the latent `enc.morgarten` double-fire remains an integrator item |

## What the evidence shows (round 2)
- Engine coverage unchanged and complete (19 conditions / 26 effects with `never` guards); 13 new tests are real regression tests for #1, #2, #4, #7/#8, #9 and the Morgarten retry.
- "Is it a quest *line* now?" — **between beats, mostly yes**: after Fürst the prologue parks at `travel-ruetli` with objective "Make for the Rütli meadow." and nothing fires (probe 6); Chapter 1 parks at `travel-tellsplatte`, `travel-hohle-gasse`; Chapter 2 at `travel-einsiedeln`, `travel-sattel`, `travel-zug`, `travel-morgarten`, `travel-brunnen`. **At the two chapter seams, no**: the sealing → 1307 hat → apple shot chain still plays as one nested block at the Rütli (issue 2a/2b above), which is the mandated Chapter 1 opening beat.
- Player agency now leaves state: four hat outcomes as a flag with two NPCs reacting; Tell as a Chapter 1 companion; Anselm lost on a raid; Hünenberg changes the battlefield. Still cosmetic (grep of `src/` outside their own dialogues is empty): `letzi`, `recruits`, `scouted`, `restraint`, `negotiated`, `gessler-hostile`, `gessler.defied`, `anselm.conflicted`.
- Morgarten retry (probe 7b): works, but replays the whole muster hub verbatim — 8 duplicated journal lines, and because `reset()` clears quest vars but not the `_dialogue` cache, every muster check replays its cached result, so "better prepared" cannot change the letzi/recruit/scout outcomes.

## Historical compliance (round 2, itemised)
- All named persons/places/dates trace to §1/§3/§4/§5 or §10 (unchanged list from round 1) ✓.
- Bundesbrief: mutual aid ✓; "no judge … not of the land … **nor one who has bought his office**" (`spine.ts:23`, `cutscenes/index.ts:32,36`) ✓; arbitration ✓; older alliance renewed (journal) ✓; first days of August ✓; sealed with **the seal of Schwyz / "which Land sealed first"** (`spine.ts:31`, `named-cast.ts:33`) ✓.
- Legend framing: "as it is told"/"told in Sarnen" on all L beats ✓; **"the tellers of Sarnen … give no year for it"** in `der-hut.ts:10` ✓; 1291/1308/1314/1315 as history ✓.
- Morgarten: Leopold routs and escapes; quest cannot kill him; a loss now fails and retries rather than hangs ✓.
- Fixed lines: `named-cast.ts:58` "My kinsman" ✓; `:347` "a coat of plates" ✓; `:232` "am Tag vor St. Otmar … the day before St Otmar's" ✓; `:25` "My own household" (Gertrud gone) ✓; `:159` "Which of us is right, the years ahead will show" ✓; `side.ts:112` idiom replaced ✓.
- Banned-word grep (Switzerland/Swiss/canton/plate/windlass/gun/potato/chocolate/tobacco/okay/guys/hello/flag/cross) over all player-facing strings: **clean** ✓.
- Residual (outside module): `npcs.ts:112` father-in-law; `pois.ts:149` Gertrud.

## Tone (KCD bar)
Improved. Still works: "The wind is worse than the range." / "It is the Länder's." New lines that land: Fürst "a bent knee costs less than a broken one" (`named-cast.ts:61`); Attinghausen "The Vogt will remember it, and so will I." (`:163`). Weak: Arnold's 1291 narrator preface "not yet grown into the man Uri and Schwyz will one day call kinsman of the sworn" (`:81`) — foreshadowing in the narrator's voice, not period; `spine.ts:99` delegated-Burgenbruch one-liner unchanged; `generic.ts:97` stock guard line unchanged.

## Ranked issues (round 2)
1. **Arrival gates are `discovered`, not "arrived"** — evidence: probe 6 (Chapter 1 runs to `travel-tellsplatte` with no travel); `der-hut.ts:13`, every `travel-*` stage — fix: add a presence condition to the DSL (`{nearPoi: [PoiId, radiusM]}` or `{inRegion: id}`; `RuntimeReads.distanceToPoi()` via `exploration.poiPosition` + the player `Transform` the module already reads) and use it on every `travel-*` stage; needs a one-line `core/dsl.ts` addition — integrator sign-off. Until then at minimum gate `travel-altdorf` on `{all:[{chapter:'ch1-1307'},{flag:'ch1.arrived-altdorf'}]}` set from a `region-entered` listener.
2. **Node effects run before the node is shown; dialogue nesting unguarded** — evidence: probe 9 order — fix: in `dialogue.ts` show the node (or at least emit it) *before* running `node.effects`, and apply the same depth/deferred-queue treatment to `runDialogue` that `runCutscene` has (`dialogueDepth`, drain after the outermost dialogue exits) so a `{quest:…}`/`{cutscene:…}` effect never opens a scene on top of an open dialogue.
3. **Morgarten retry replays a frozen hub** — fix: on `quest-failed('quest.morgarten')` also delete `_dialogue` keys prefixed `dlg.muster-` and `dlg.heinrich-von-hunenberg`, and skip the muster stage journals on re-entry (or add a single "you ride the muster year again" entry); move `setTime:[1315,11,15]` to `muster-1315.ready` so the battle stage journal is dated correctly.
4. Persist `chapterSet` (or derive it from `chapter`) in `serialize/restore` if save/load must not re-populate; otherwise document it.
5. Make `letzi`/`recruits`/`scouted` matter (a caption/objective or an `enc.morgarten` tweak like the Hünenberg one) or drop the checks — cosmetic dice rolls read as fake agency.
6. Integrator: `src/exploration/poi.ts:24-28` per `requests/quest-2.md`; `npcs.ts:112` / `pois.ts:149` wording.

## Explicitly out of reach for a browser engine (not counted)
- Voice, facial animation, cinematic dialogue camera; the harness PNG shows the world, not the stub dialogue panel.
- SwiftShader draw-call/frame budgets (world/exploration's domain).
