# Wave 3 — quest (+ act1-content) — critic score — round 3/3 (final)

Reference: Skyrim + KCD (quests with choices, factions with memory, grounded tone); LORE.md for act1-content
Code reviewed: HEAD `f79e45e` ("Quest: fix round 2 — presence-gated arrival stages, show-before-effects dialogue with shared scene depth, Morgarten retry fresh checks, letzi/recruits/scouted consequences (66 tests)") plus the uncommitted `npcs.ts`/`pois.ts` wording fixes in the working tree.
Harness: skipped this round per the coordinator (world/exploration rendering). App-side numbers from the round-2 run stand: `dialogue-gessler-hat` — page errors 0, pageerror 0, warnings 0, `state: explore`, 678 draw calls, 115 MB heap; the only failure was the harness's own screenshot timeout under SwiftShader (since addressed by `705bfeb`: run lock + 180 s screenshot timeout).
Checks: `npx vitest run src/quest` → `Test Files 8 passed (8) / Tests 66 passed (66)`; `npx tsc --noEmit | grep 'src/(quest|content/(quests|dialogues|cutscenes|factions))'` → no lines; `node tools/check-imports.mjs` → `imports ok`.
Evidence read: full diff `116a8f5..HEAD` for `src/core/dsl.ts`, `src/quest/**`, `src/content/**`, `requests/quest-3.md`, `src/combat/engine.ts:118-152`, `src/exploration/poi.ts`; the 6 new tests; 9 adversarial probes in `<scratchpad>/probes/quest4.probe.test.ts` + `quest5.probe.test.ts` (round-2 probes 6/9/7/3b adapted to presence gates, plus a new gate-bypass probe).

## Score: 8/10   (pass bar 8)  → PASS
- quest engine (vs Skyrim/KCD): **8/10** (6 → 7 → 8)
- act1-content (vs LORE + KCD tone): **8/10** (5 → 7 → 8)

## Cumulative issue table

| Round | # | Issue | Status | Evidence |
|---|---|---|---|---|
| 1 | 1 | Stale `lastCombat.outcome` advances a stage mid-combat | Fixed (r2) | per-quest `combat.outcome` cleared before await; probe 5 (r2) |
| 1 | 2 | No arrival gates; nested chain; no `dialogue` state | **Fixed (r3)** | 13 `travel-*` stages now `{nearPoi:[poi, r]}` (`der-eid.ts:13,37`, `der-hut.ts:12,27,37`, `marchenstreit.ts:18-19`, `muster-1315.ts:12,27`, `morgarten.ts:12`, `brunnen-1315.ts:12`, both side quests); probe 6 (r3): after the sealing `der-hut` parks at `travel-altdorf` with the player at the Rütli; `discover()` of every POI changes nothing; walking to Altdorf unparks; every later gate parks until walked (`der-hut@travel-tellsplatte`, `@travel-hohle-gasse`, `muster@travel-sattel`, `morgarten@travel-morgarten`, `brunnen@travel-brunnen`). `runDialogue` requests `dialogue`/`explore`. See r3 #1 for the two gates a dialogue jumps past |
| 1 | 3 | Abt Johannes soft-lock | Fixed (r2) | last-enabled walkthrough test + probe 7a (r3) reach Brunnen by walking |
| 1 | 4 | Unhandled rejections; `services.get('combat')` | Fixed (r2) | probe 4 (r2) |
| 1 | 5 | Eight compliance violations | Fixed (r2); residual outside module **fixed (r3, working tree)** | `npcs.ts:112` → "a kinsman of Wilhelm Tell's"; `pois.ts:149` → "and his household" |
| 1 | 6 | Clock/journal date mismatches | **Fixed (r3)** | `setTime:[1315,11,15,6]` moved to `muster-1315.ready` (`muster-1315.ts:46`); probe 7b (r3): the battle stage line is now stamped 1315-11-15, Windisch 1308-05-01, Brunnen 1315-12-09 |
| 1 | 7 | Choices LORE says matter were inert | Fixed (r2); extended (r3) | `hunenberg-warning`, `morgarten.letzi-improved`, `morgarten.recruits-strong` all read by `combat/engine.ts:126-152` (cache dropped / extra letzi segment / two extra spears + captions); `scouted` now prints the column count and journals it (`spine.ts:190-210`) |
| 1 | 8 | Skill-check cache key | Fixed (r2) | probe 2 (r2) |
| 1 | 9 | Post-order events; `setChapter` guard; root fallback | Fixed (r2) | probes 3/8 (r2) |
| 1 | 10 | Stage-id contract with exploration; lose branches | Lose branches fixed (r2); exploration side **resolved (r3)** | `src/exploration/poi.ts` no longer hard-codes `TRIGGER_SEEDS`; generic `addEncounterTrigger()` documented as visual-only (`poi.ts:53-62`) — no double-start path remains |
| 2 | 1 | Gates were `discovered`, not "arrived" | **Fixed (r3)** | `QuestCondition` gains `nearPoi`/`inRegion`/`talkedTo` (`dsl.ts:33-38`), evaluator (`conditions.ts:50-64`), `RuntimeReads.playerPosition/poiPosition/regionIdAt` (`runtime.ts:25-30`, `index.ts:136-147`); 3 new condition tests; walkthrough drives the tick and moves the player (`walkthrough.test.ts:22-25,84-99`) |
| 2 | 2 | Node effects ran before the node was shown; dialogue nesting unguarded | **Fixed (r3)** | `dialogue.ts:163-178,197-200` show-then-effects; single `sceneDepth` + `drainDeferredIfOutermost()` shared by dialogues and cutscenes (`index.ts:321-360`); probe 9 (r3): "So sworn" #7, sealing caption #8, no Chapter 1 text until the player walks; probe 6 state sequence `cutscene > explore > dialogue > explore > dialogue > explore > cutscene > explore > dialogue > explore > dialogue > cutscene > explore > explore` — the one scene opened inside another is `cs.apfelschuss` from Tell's *end* node after `ui.hide()` (the scene's own continuation, panel already closed; not a defect) |
| 2 | 3 | Morgarten retry replayed a frozen hub | **Fixed (r3)** | `clearVarPrefix('_dialogue','dlg.muster-'/'dlg.heinrich-von-hunenberg')`, `silentJournal` on the restarted hub, one re-entry line (`index.ts:63-80`, `quests.ts:18-20,94,118,146-152`); probe 7b (r3): muster cache 0 keys at fail time, 3 fresh keys after the second pass; the only duplicated journal lines are `quest.morgarten`'s own two stage lines (the second battle) — acceptable |
| 2 | 4 | `chapterSet` not restored | **Fixed (r3)** | `index.ts:396-399`; probe 3b (r3): `restore → setChapter(same)` → `populateCalls []` |
| 2 | 5 | `letzi`/`recruits`/`scouted` cosmetic | **Fixed (r3)** | flags set (`spine.ts:171,182`), consumed by combat (`engine.ts:139-152`), `requests/quest-3.md` filed; scout text/journal carry the count |
| 2 | 6 | Integrator: exploration ids/wording; harness out-dir clobbering | Resolved | `poi.ts` rewrite; `npcs.ts`/`pois.ts` wording; `705bfeb` harness lock |
| 3 | 1 | **Two `travel-*` gates are bypassed by dialogue jumps** | Open — 3-line content fix | probe 10 (r3): with the player standing at the Hohle Gasse, `dlg.marchenstreit-rat`/`dlg.konrad-ab-yberg` choices advance straight to `raid`/`speech-path` (`spine.ts:155-156`, `named-cast.ts:215-216`), so `travel-einsiedeln` is never entered and `enc.einsiedeln-gate` fires 5 km from the abbey (`nearPoi einsiedeln@140` evaluates `false` there); likewise `dlg.muster-recruit` advances to `scout-zug` (`spine.ts:181-182`), skipping `travel-zug`. The walkthrough test walks the POIs in story order and so never sees it. Fix: retarget those four `advance` effects to `travel-einsiedeln` / `travel-zug` (the `restraint` var already routes the gate). Burgenbruch's three castle stages have markers but no travel gates (dialogue-resolved set pieces at the council site) — acceptable, note only |

## What the evidence shows (round 3)
- **It is a quest line now.** Both chapter seams park on presence (the round-1/2 blocker), 11 of 13 travel gates are proven to hold until the player is physically there, discovery alone moves nothing, and the on-screen order at the Rütli is right. The two remaining bypasses (r3 #1) are content routing, not engine, and are a trivial retarget.
- Engine: DSL now 22 conditions / 26 effects, exhaustively switched; `talkedTo` set from the root speaker at dialogue open (`dialogue.ts:142-146`); scene-depth deferral proven for both scene kinds; retry loop proven with fresh rolls; restore semantics proven.
- Choice → state: hat (4 outcomes, 2 NPCs remember), Tell companion in/out, Anselm lost on a raid, Hünenberg/letzi/recruits change the Morgarten grid and units, scout count in journal, reputation drift −28 Habsburg by Act end. "Factions with memory" is met at the 8 bar; a 10 would have the Einsiedeln abbot or Habsburg guards read the raid/restraint back.

## Historical compliance (round 3, itemised)
- Named persons/places/dates: unchanged from rounds 1–2, all → §1/§3/§4/§5 or §10 ✓.
- Bundesbrief clauses: mutual aid ✓; no foreign **nor bought** judge (`spine.ts:23`, `cutscenes/index.ts:32,36`) ✓; arbitration ✓; older alliance renewed ✓; first days of August ✓; sealed with the Länder's seals (`spine.ts:31`, `named-cast.ts:33`) ✓.
- Legend framing: "as it is told"/"told in Sarnen" ✓; "the tellers of Sarnen … give no year" (`der-hut.ts:10`) ✓; 1291/1308/1314/1315 as history, now correctly clock-stamped ✓.
- Morgarten: Leopold routs and escapes; cannot be killed; loss → fail → muster retry ✓.
- Fixed wording present: kinsman (`named-cast.ts:58`, `npcs.ts:112`), coat of plates (`:347`), "am Tag vor St. Otmar" (`:232`), Gertrud gone (`:25`, `pois.ts:149`), "History may prove" gone ✓.
- Banned-word grep (Switzerland/Swiss/canton/plate/windlass/gun/potato/chocolate/tobacco/okay/guys/hello/flag/cross) over every player-facing string in `dialogues/quests/cutscenes/quest/index.ts`: **clean** ✓. No residuals anywhere in `src/content`.

## Tone (KCD bar)
Works: "It is the Länder's." / "The wind is worse than the range." / Fürst "a bent knee costs less than a broken one" / new Burgenbruch delegation report (`spine.ts:99-100`) — three concrete beats, "the servant girl's part in it is already half a song" / new guard line "the Landvogt keeps a list of names like yours, and mine goes on it too if I let you linger" (`generic.ts:97`) / Arnold 1291 "driving a few goats down off the Melchtal alp before the weather turns" (`named-cast.ts:81`). Weak: "a full two files of spears more than the last muster mustered" (`spine.ts:182`, the muster/mustered echo); "some two thousand men" (`spine.ts:191`) — chroniclers give Leopold 2 000–9 000, so it is inside the range, fine.

## Ranked issues (for integration; none blocks the pass)
1. Retarget the four dialogue `advance` effects so `travel-einsiedeln` / `travel-zug` are actually entered (r3 #1 above); add a walkthrough assertion that `marchenstreit` parks at `travel-einsiedeln` after the Schwyz argument and `muster-1315` at `travel-zug` after recruiting.
2. Optional: gate Burgenbruch's castle stages on `nearPoi` of their markers so the three set pieces are played at Zwing Uri / Rotzberg / Landenberg rather than at the council.
3. Optional: `silentJournal` for the restarted `quest.morgarten` too, or reword its second-pass stage lines.
4. Exploration/UI: `nearPoi` gates only re-evaluate on the 0.5 s tick or on quest events — fine, but the HUD objective should not lag more than that; confirm once the UI module lands.

## Explicitly out of reach for a browser engine (not counted)
- Voice, facial animation, cinematic dialogue camera; the harness PNG shows the world, not the stub dialogue panel.
- SwiftShader draw-call/frame budgets (world/exploration's domain).
