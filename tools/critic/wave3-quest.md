# Wave 3 — quest (+ act1-content) — critic score

Reference: Skyrim + KCD (quests with choices, factions with memory, grounded tone); LORE.md for act1-content
Harness run: 2026-09-02T18:25:55Z, renderer: `ANGLE / SwiftShader (software)`, scenarios: `dialogue-gessler-hat`
(one completed run; a first attempt was killed by my own 590 s wrapper before printing — the second run, 582 s, is the one reported)
Evidence read: `tools/harness/out/dialogue-gessler-hat.png`, `report.json` (errors=0, warnings=0, state=explore, content.quests=14,
dialogues=54, cutscenes=6, factions=11; drawCalls=5295/p95=5599 ms are world/exploration numbers on SwiftShader and not scored here);
`npx vitest run src/quest` → `Test Files 8 passed (8) / Tests 47 passed (47)`; `npx tsc --noEmit | grep quest|content/...` → no lines
(clean); `node tools/check-imports.mjs` → `imports ok`; walkthrough trace (below); 10 adversarial probes in
`<scratchpad>/probes/quest.probe.test.ts` (9 pass as written — several *document* defects — 1 fails on purpose: last-option walkthrough).

## Score: 5/10   (pass bar 8)  → FAIL (round 1/3)
- quest engine (vs Skyrim/KCD): **6/10**
- act1-content (vs LORE + KCD tone): **5/10**

## What the evidence shows

**Engine, verified**
- Every `QuestCondition` (19 variants) and `Effect` (26 variants) in `src/core/dsl.ts` has a branch in `conditions.ts` / `effects.ts`, with `never`
  exhaustiveness guards (`conditions.ts:51`, `effects.ts:119`). `timeOfDay:[22,4]` wraps midnight (probe 5: true at 23 and 2, false at 12 and 4).
- `checkAdvance` (`quests.ts:136`) only walks started, unfinished quests and only their current stage's `advanceWhen`; the frame tick fires it
  every 0.5 s (`index.ts:72`), plus on flag/var/rep/quest-op/POI/fast-travel/chapter events. Cost is fine.
- Dialogue: conditional root, `variants`, `showDisabled`, `{player}/{playerFamily}/{origin}/{time}` substitution, headless auto-pick with
  `console.info`, `checkOdds` on the view — all present and unit-tested. Reload-proof checks: probe 2a confirms `serialize → restore` replays the
  cached outcome (`_dialogue` pseudo-quest var `dlg.p:n=false`) with no re-roll.
- `runCutscene` requests `cutscene` then `explore`, camera rig `setMode('cutscene'/'follow')`, letterbox on/off, UI-optional (captions log).
- Reputation bands match §5.6 boundaries; `habsburg.hostileBelow=-40`; `isHostile` also honours a `hostile:<faction>` flag. Main-spine
  drift is 0 → −13 by the end of Chapter 1 (probe 6 rep dump) → Habsburg never accidentally hostile before Morgarten (−28 after).
- `serialize/restore` round-trips quests/rep/flags/journal/chapter (service.test + probe 2a). `setChapter` sets the clock to the §1 date,
  calls `party.applyChapter`, `exploration.populate`, emits `chapter-changed`, journals (service.test:126).
- Harness `dialogue-gessler-hat`: 0 console errors, 0 page errors, 0 unhandled rejections (main.ts pipes those into console errors).

**Engine, defective (found by reading and confirmed by probes)**
- **Stale `_system.lastCombat.outcome` advances a stage while its own fight is still running** (probe 7). The var is global and persists after
  the first win; `enterStage` sets `q.stage` *before* awaiting the `encounter` effect (`quests.ts:107-113`), and any `checkAdvance` tick
  during the awaited combat sees the *previous* fight's `'win'` and fires `advanceWhen` → `hohle-gasse`, `raid` and `battle` all advance
  to their aftermath (dialogue/cutscene, `complete`, next quest start) mid-combat in the real game. The walkthrough never sees it because
  the fake combat resolves synchronously and the scheduler is never ticked.
- **`encounter` with no combat service throws and the promise is dropped** (probe 4): `runEncounter` uses `services.get` (`index.ts:159`),
  `QuestService.start/advance/complete` are `void this.questOp(...)` (`index.ts:260-263`) and `checkAdvance` does `void this.advance` — one
  unhandled rejection per call, quest left on the encounter stage forever.
- **Skill-check cache keyed `dialogueId:nodeId`, not per choice, and never cleared** (probe 2b): in `dlg.zwing-uri-stealth:gate` the stealth
  and speech choices share one cached result; in `dlg.generic.toll-collector:talk` one roll decides every toll-collector in the game for the
  rest of the save. Reload-proofing is right; the key is wrong.
- **Whole Act 1 executes as one nested promise chain.** No stage has a location/arrival gate except `fluelen-news` and `der-saeumer`/
  `drache` — every other stage's `onEnter` fires its dialogue/cutscene/encounter the instant the stage is entered. With a real UI the
  Gessler-hat dialogue opens *inside* `cs.bundesbrief-sealing` before its final `fade:'black'` step (`cutscenes/index.ts:43`), camera
  still on the Rütli, and every subsequent `runCutscene` requests `explore` while an outer cutscene is still open (probe 8 request-state
  sequence: `cutscene > explore > cutscene > cutscene > cutscene > explore > explore > explore …`). The walkthrough test proves this:
  two player actions (`discover('poi.altdorf')`, `runDialogue('dlg.walter-fuerst')`) complete all eight main quests. That is a script, not
  a Skyrim/KCD quest line.
- **Event order is post-order**: `quest-advanced` is emitted after `enterStage` resolves (`quests.ts:99-100`), so `quest.der-eid:ruetli-oath`
  arrives at trace index 18 after `complete:quest.der-eid` at index 2 (probe 8). State is correct; every listener (HUD objective, journal
  toasts, save thumbnails) sees stages in the wrong order. Not benign.
- `setChapter` has no idempotence guard: called twice with the same chapter it re-populates the world and duplicates the chapter journal
  entry (probe 3). `main.ts:115+118` already calls `setChapter('prologue-1291')` then `ex.populate(chapter)` — populate runs twice on new game.
- Conditional-root fallback picks the *last* entry when nothing matches (`dialogue.ts:58`): Arnold von Melchtal, spawned in all chapters, says
  "…enough reason for Morgarten" in 1291 (probe 8b).
- `runDialogue` never requests the `dialogue` game state (only cutscenes request state); the §4 state machine's `explore ⇄ dialogue` is
  never entered by this module — the clock keeps running during dialogue.
- Cross-module: `src/exploration/poi.ts:24-28` gates the five Act-1 encounter triggers on stage ids `escort-brunnen`,
  `quest.der-hut-auf-der-stange/square-confrontation`, `hohle-gasse-ambush`, `abbey-gate` — none of which this builder defined (`escort`,
  `quest.der-hut/hohle-gasse`, `raid`). Only `quest.morgarten/battle` matches, and that one would *double-start* `enc.morgarten` (stage stays
  `battle` during the quest-fired combat). Nothing in `main.ts` consumes `encounter-trigger` today, so it is latent, but the ids must agree.
- Lose paths: `der-eid.escort`, `der-hut.hohle-gasse`, `morgarten.battle` only advance on `win`/`fled`; a `lose` leaves the quest stuck with no
  `fail`, no retry. Morgarten lost = Act 1 cannot end.

**Walkthrough test judgement** — `walkthrough.test.ts` uses "always pick the first enabled choice" (`ScriptedUiService` default) and asserts
`hunenberg-warning === true` *because* it was default-picked. It exercises connectivity, not choices. The **last-option** run (probe 6)
soft-locks: `dlg.abt-johannes.negotiate` choice "Say nothing, and let the men behind you speak instead" (`named-cast.ts:175`) is `end:true` with
no effects, and `quest.marchenstreit.speech-path` has no `advanceWhen` → `quest.muster-1315/morgarten/brunnen-1315` never start.

## Historical compliance (content modules)
Entities: every named person/place/event maps —
- Werner Stauffacher, Walter Fürst, Arnold von Melchtal, Wilhelm Tell, Hermann Gessler, Beringer von Landenberg → §5 (L) ✓; Werner von
  Attinghausen, Leopold I, Abt Johannes, Konrad Ab Yberg, Johannes of Winterthur → §5 (H) ✓; Heinrich von Hünenberg → §5 (L) ✓;
  companions, Eberhard von Mülinen, Vogt-Schreiber Ludwig → §5/§10 ✓; Niklaus Planzer, Melchior Arnold, Uli Fischer, Trudi Meier, Burkhard
  Wyrsch, Jost Durrer → `npcs.ts` (I) registered in §10 ✓; Johann Parricida, Rudolf I, Albrecht I → §1 ✓; Frau Gertrud (`named-cast.ts:25`,
  `pois.ts:149`) → **not in LORE; Schiller's name for Stauffacher's wife — §9 says Schiller for shape only, never facts** (minor).
- Places: Flüelen, Altdorf, Rütli, Brunnen, Steinen, Tellsplatte, Küssnacht, Hohle Gasse, Zwing Uri, Rotzberg, Sarnen/Landenberg, Einsiedeln,
  Sattel letzi, Zug, Ägeri, Morgarten/Figlenfluh, Windisch, Speyer, Amsteg, Schöllenen/Teufelsbrücke, Gersau, Pilatus, Wolfenschiessen → §1/§3/§4 ✓.
- Dates: Rudolf † 15 Jul 1291 → §1 ✓; Bundesbrief "first days of August" → §1 ✓; 1307 → §1 (Tschudi) ✓; 1 May 1308 Windisch → §1 ✓;
  Epiphany 1314 → §1 ✓; 15 Nov 1315 → §1 ✓; 9 Dec 1315 → §1 ✓.
- Bundesbrief clauses (`dlg.ruetli-oath` clause1-3, `cs.bundesbrief-sealing`): mutual aid ✓, arbitration ✓, renewal of older alliance ✓ (journal
  only, `cutscenes/index.ts:36`), date ✓. "No foreign judges" is rendered only as "not of the land and dwelling among us" (`spine.ts:23`,
  `cutscenes/index.ts:32`) — the charter's **"nor one who has bought his office"** half is missing → **incomplete**.
- Legend framing: apple shot, Tellsplatte, Hohle Gasse, Burgenbruch journals carry "as it is told"/"told in Sarnen" ✓; 1291/1314/1315 journals
  are stated as history ✓. But LORE §1 mandates the journal say the tellers of Sarnen **"give no year"** for 1307 — `der-hut.ts:6` claims it
  does; grep of `src/content/{quests,dialogues,cutscenes}` finds it nowhere (only `pois.ts:189`) → **VIOLATION**.
- Morgarten: Leopold is a named knight who routs, `enc.morgarten` objective is rout, `cs.morgarten-aftermath` has him escape ✓; quest cannot
  kill him ✓. But the player *can lose* Morgarten and the quest simply hangs (no `lose` branch) — the historical outcome is not protected, it
  is just un-progressable.
- **VIOLATIONS, player-facing**
  1. `named-cast.ts:58` — Walter Fürst: "My son-in-law keeps his own counsel…" — LORE §5 explicitly: "Tell's father-in-law (per Schiller — L²;
     **we keep it as 'kinsman'**)". Direct breach of an instruction. (`npcs.ts:112` description repeats it.)
  2. `named-cast.ts:328` — Ritter Eberhard: "**plate** glinting under a surcoat" in 1315 — §7 bans plate harness player-facing (coat of
     plates is the allowed term).
  3. `named-cast.ts:213` — Hünenberg arrow: "am Tag St. Otmars … on St Otmar's day". The tradition reads "am Tag **vor** St. Otmar"; St Otmar
     is 16 Nov, the battle 15 Nov — as written the warning names the wrong day.
  4. Missing "give no year" journal statement (above).
  5. `epilog-1308.ts:13-14` — Albrecht's murder (1 May 1308) is journaled while the clock still reads May 1307 (`advanceTime: 6` hours then
     `setChapter ch2-1314`); `morgarten.ts:10` "15 November, 1315" and `cs.pakt-von-brunnen` "ninth of December" are journaled with the clock at
     **6 Jan 1314 18:00** (no `setTime` anywhere in `src/content`). Journal timestamps contradict their own text.
  6. `spine.ts:31` / `named-cast.ts:33` — Stauffacher "presses his seal-ring into the warm wax himself… a Vogt's clerk came asking after my
     seal-ring… who signed first". §1: sealed with the **seals of Uri, Schwyz and Nidwalden** — communal Länder seals, not personal rings.
  7. Bundesbrief "bought office" clause omitted (above).
  8. `named-cast.ts:25` "Frau Gertrud" (Schiller).
- Register (§8): "Ammann", "Herr Vogt", "Freiherr", "Bruder", "Vater Abt", "Bei Sankt Verena" all used correctly ✓; no "Switzerland/Swiss/
  canton/okay/guys/hello/gun/potato/chocolate/tobacco/windlass/flag/cross" in any player-facing string (grep) ✓.

## Writing vs KCD tone
Works:
- `spine.ts:31` "Now it is not one man's word, or three. It is the Länder's."
- `named-cast.ts:97` Tell: "Then stand where I can see you and say nothing more. The wind is worse than the range."
- `named-cast.ts:142` Attinghausen: "Then the question is not whether Vienna forgets us — it is whether we let it."
Doesn't:
- `side.ts:112` "Care to put your aim where your boasting is?" — a modern idiom riff ("put your money where your mouth is").
- `named-cast.ts:147` "History may prove either of us right — I only hope it is not too costly finding out." — a 14th-c. Landammann
  invoking abstract "History"; reads as a screenwriter's line.
- `spine.ts:99` "Your companions carry it off cleanly — word comes back within days that all three have fallen with barely a scratch between
  them." — three mandated set pieces resolved in one flat narrator sentence; `generic.ts:97` "Move along, if you know what's good for you" is
  the stock fantasy guard.

## Choice consequence — what actually changes state
Changes state: bow (habsburg +8/uri −8) vs walk past (speech DC14 / 20 Pf bribe / `enc.altdorf-square` fight) vs watch (nothing); porters freed
(uri +5) vs looted (purse, habsburg −3); Burgenbruch which-castle (`chosen` var, rep 4–8 by check) vs delegate (leadership DC14, rep 5/2);
Marchenstreit raid (einsiedeln −20, `enc.einsiedeln-gate`) vs restraint (abbot speech DC16 → einsiedeln +10 / dead end); side quests (rep,
`item.salt-sack`, `item.pfennig-purse`, pfennig). Gessler's own dialogue sets `gessler.defied` (consumed only by itself).
**Cosmetic (set but never read anywhere outside the dialogue that sets them, grep of `src/` excluding content/dialogues):** `hunenberg-warning`
(§6 step 11 says "fewer boulder caches" — `enc.morgarten` never reads it), `letzi` strong/weak, `recruits`, `scouted`, `restraint`,
`negotiated`, `crossing`, `apfelschuss-done`, `anselm.conflicted` (§6 step 10: restraint decides "whether Bruder Anselm stays" — no
`removeCompanion` exists in content), `stauffacher.summoned`, `furst.message-taken`, `intro.rudolf-news`. Tell is never `addCompanion`ed
although §5 and two `hasCompanion:'npc.wilhelm-tell'` variants assume it. The §6 step-2 speech tutorial (deliver the message to Attinghausen) is
bypassed: accepting Fürst's message advances straight to `escort` (+ combat), and `dlg.werner-von-attinghausen.receive-news` is only rooted on the
`altdorf-message` stage. "Factions with memory": no NPC line anywhere reads the bow/loot/raid decisions back to the player.

## Ranked issues
1. **Stale `lastCombat.outcome` advances encounter stages mid-combat** — evidence: probe 7 (`quest.b` = `after` while `enc.b` unresolved);
   `quests.ts:107-113`, `index.ts:72-78` — fix: clear `_system.lastCombat.*` in `runEffect('encounter')` *before* awaiting `runEncounter`, and/or
   store the outcome per quest (`setVar(questId,'combat.outcome')`) via a `{encounter: id, into?: [QuestId, key]}` form; add a test with a
   pending combat + `tick(0.5)`.
2. **Act 1 has no arrival gates; nested cutscene/dialogue/state chain** — evidence: walkthrough completes on two player actions; probe 8
   request-state sequence — fix: give every travel beat an `advanceWhen: [{cond:{discovered|regionEntered|nearPoi}}]` stage (e.g. `der-hut`:
   `travel-altdorf` → `altdorf-pole`; `tellsplatte`, `hohle-gasse`, `zug`, `sattel`, `brunnen`), run `onEnter` effects that follow a
   `setChapter`/`cutscene` on the next tick rather than inline, and have `runDialogue` request the `dialogue` state.
3. **Last-option soft-lock at Abt Johannes** — evidence: probe 6 (`quest.marchenstreit=speech-path`, active objective "Negotiate with Abbot
   Johannes.") — fix: `named-cast.ts:175` choice → `effects:[{quest:['advance','quest.marchenstreit','raid']}]` (the men behind you speak =
   the raid happens) or give `speech-path` an `advanceWhen`; add a "last option everywhere" walkthrough variant to `walkthrough.test.ts`.
4. **Unhandled rejections from fire-and-forget quest ops** — evidence: probe 4 — fix: `runEncounter` → `tryGet('combat')`, resolve
   `{outcome:'win'…}` with a `console.warn` when absent; wrap `void this.questOp` in `.catch(e => console.error('[quest]', e))`.
5. **Compliance violations** — `named-cast.ts:58` son-in-law → "kinsman"; `:328` "plate" → "coat of plates"; `:213` "am Tag vor St. Otmar…
   the day before St Otmar's"; add the "give no year" line to `der-hut.ts` `altdorf-pole` journal; add "nor one who has bought his office" to
   `spine.ts:23` and `cutscenes/index.ts:32`; `spine.ts:31` seal-ring → "the seal of Schwyz"; drop "Frau Gertrud" (`named-cast.ts:25`).
6. **Clock/journal date mismatches** — fix: `epilog-1308.ts` `onEnter: [{setTime:[1308,5,1,9]}, …]`; `muster-1315.ready` `{setTime:[1315,11,15,6]}`
   before starting `quest.morgarten`; `brunnen-1315.pact` `{setTime:[1315,12,9,10]}`.
7. **Choices that LORE says matter are inert** — fix: have `enc.morgarten` (or a `scripted` hook) read `hunenberg-warning`/`letzi` to remove a
   cache / lower the letzi cover; `restraint:false` + `anselm.conflicted` → `{removeCompanion:'npc.bruder-anselm'}` in `raid.onEnter` guarded by
   `hasCompanion`; add `addCompanion:'npc.wilhelm-tell'` on `cs.tellsplatte` and `removeCompanion` at `der-hut.epilogue`; at least one NPC
   variant that reads `gessler-hat` outcome back (store it as a flag — probe 1 shows no flag is written).
8. **Skill-check cache key** — fix: key `dialogueId:nodeId:choiceIndex`, and for `dlg.generic.*` (many NPC instances) include `speakerEntity`
   or skip caching; clear cached checks on `dialogue-ended` unless a save happened mid-dialogue.
9. **Post-order `quest-advanced` + no `setChapter` guard + root fallback** — fix: emit `quest-advanced` right after `q.stage = stageId` and
   before `runEffects(onEnter)`; early-return in `setChapter` when `chapter === this.chapterId` (and drop the duplicate `ex.populate` in
   `main.ts:118`); make `resolveRoot` return `''` (warn) instead of the last entry, add a `prologue` node for Arnold.
10. **Stage-id contract with exploration** — fix: agree ids with `src/exploration/poi.ts:24-28` (`escort`, `quest.der-hut`, `hohle-gasse`,
   `raid`) and make the trigger *replace* the `onEnter` encounter, not duplicate it; add `lose` → `fail`/retry branches on the three
   main-spine fights.

## Explicitly out of reach for a browser engine (not counted against the score)
- Voice, facial animation and camera staging for dialogue; the harness screenshot shows the world, not the dialogue panel (UI is a stub).
- SwiftShader draw-call/frame budgets in `report.json` (world/exploration's problem, not scored here).
