# Wave 3 — ui — critic score (round 2/3)

Reference: BG3 combat HUD clarity + Skyrim menus (RUBRIC.md row "ui")
Code reviewed: HEAD `73afac2` (fix commits `77e2e7b` "UI fix round 1 (integrator)", `df0e965` "Flee button placement, closeAll before load, game-over panel restored", `73afac2` "legible initiative chips, styled Flee confirm, no empty preview rule, autosave never overwritten manually; harness waitPlayerTurn scenario"); `src/ui/**`, `index.html` clean in the working tree (dirty files are `src/world/*` WIP by the world builder). Diffs `ef28447..ffa5ede`, `ffa5ede..df0e965` and `df0e965..73afac2` read in full for `src/ui/{index,combatUi,dialogueUi,helpers,menus}.ts`, `ui.css`, `src/core/{context,services}.ts`, `src/quest/dialogue.ts`, `src/exploration/interact.ts`, `src/combat/render.ts` (241 insertions / 51 deletions).
Harness run (round 2, `--out tools/harness/out/ui2/<id>`, one at a time behind the lock): `combat-brunnen-quay` (22:07:48Z, `state: combat`, 352 calls, 6.04 M tris, 315 MB, `errors: []`, `warnings: []`; harness `pass:false` only on the *world's* triangle budget 6.0 M > 3.0 M and SwiftShader p95 — `noErrors: true`); `dialogue-gessler-hat` (00:08:49Z, `state: dialogue`, 413 calls, 5.17 M tris, 236 MB, `errors: []`, `warnings: []`; harness `pass:false` again only on the world's triangle budget and SwiftShader p95 13.6 s — `noErrors: true`); `combat-brunnen-quay-turn` (01:09:06Z, `state: combat`, 378 calls, 3.88 M tris, 262 MB, `errors: []`, `warnings: []`; `pass:false` only on the world's triangle budget and SwiftShader p95 — `noErrors: true`; first attempt at 23:57Z was killed while queued behind two other builders' runs, relaunched once). Round-1 captures of `title`, `menu-inventory`, `menu-map` (20:45–20:58Z) stand — no code touching those screens changed except the purse legend and the save-slot styling (both verified in code). Renderer: SwiftShader (SOFTWARE).
Checks (verbatim, re-run at `73afac2`):
- `npx vitest run src/ui` → `Test Files  1 passed (1)` / `Tests  16 passed (16)`.
- `npx tsc --noEmit | grep -E 'src/ui|index.html'` → no lines.
- `node tools/check-imports.mjs` → `imports ok` (at `73afac2`; the transient `src/world/models.test.ts` violation seen at `3072208` is gone).
- Critic probes `npx vitest run --config tools/critic/probes/ui/vitest.config.ts` → first run `3 failed | 26 passed` — exactly the three tests named `DEFECT:` (−0 d, NaN d, double S chip), i.e. the defects are gone; inverted to `FIXED r2:` assertions → `Tests  29 passed (29)`.
- Chromium cascade check re-run against the new `ui.css` (`<div id="dialogue-root" hidden>`): `{"dialogueDisplay":"none","dialogueRect":0,"hudDisplay":"none","elementAtBottomCentre":""}` (round 1: `flex`, 197 px, `#dialogue-root` under the cursor).
- Banned-word grep over `src/ui/*.ts`, `ui.css`, `index.html`: still only the `Canton` type annotations; the new strings ("The field is lost", "Your company lies in the mud. The chroniclers will not record their names.", "Flee the field? …", "Rest at the inn", "Trade at the market", "Take the boat", purse legend "Pfund ℔ · Schilling s · Pfennig d") are clean.

## Score: 7/10   (pass bar 8)  → FAIL (round 2/3) — one narrowly-scoped fix round left

Round 1 → 2: 6 → 7. Every round-1 issue (18), every interim finding (3) and every round-2 finding (5) is fixed in code at `73afac2` and verified against the diff (tables below); the Chromium cascade check returns `display:none` for the hidden dialogue root; the three defect probes flipped; `src/ui` tests, tsc, imports and the 29 probes are green; four round-2 harness frames report `errors: []`, `warnings: []`; the dialogue frame confirms the skip-hint fix and the new `waitPlayerTurn` frame confirms the initiative strip is now legible. **One thing keeps it under 8, and it is the rubric's own condition — score on harness-captured evidence**: the player-turn half of the BG3 reference (unit card with HP/morale/status/defense/weapon, AP pips, `Move x/y m`, hit % with named Edge/Burden sources, formation chip, ability bar with 1-9 hotkeys, End Turn, Flee, reaction prompt, enemy inspect card) has still never been photographed, because both Brunnen scenarios stop on a between-turns seam (`activeUnit: null`) that the new `waitPlayerTurn` loop cannot get past — `stepAi()` is a no-op with no active unit. This is a combat-engine/harness seam, not a UI defect; the UI code for all of it is present and reads the right fields (`combatUi.ts:117-231`). There is no other open item above "minor".

**Exactly what remains for round 3 (pass on completion):**
1. One harness frame on a player-controlled turn. Cheapest fix (combat owner, one line): in `engine.ts` `stepAi()`, replace `if (!u) return;` with `if (!u) { this.advance(); return; }` — `advance()` then picks the next unit, stops on Kuoni with `phase:'active'` and emits the view the HUD needs; the existing `combat-brunnen-quay-turn` scenario will capture it unchanged. (Alternative, harness-only: have `waitPlayerTurn` submit a real command that calls `advance()` when `activeUnit` is null.) Then re-run `combat-brunnen-quay-turn` and hover-check nothing else; the frame must show the unit card (status chips, `Defense N · weapon`), AP pips, `Move`, `vs <enemy>: NN% hit — Edge: …; Burden: …`, ability bar with hotkey numbers, End Turn and Flee.
2. Nothing else. (Minor items below are recorded, not gating.)

## Round-1 issues → status

| # | Issue (round 1) | Status | Verified at |
|---|---|---|---|
| 1 | Dialogue panel never hides (`display:flex` beats `[hidden]`) | **Fixed** | `ui.css:144` `#dialogue-root[hidden]{display:none!important}`; `dialogueUi.ts:133` `clear(panelRoot)`; Chromium check `display:none`, rect 0 |
| 2 | Combat panels never hide after a fight | **Fixed** | `index.ts:119` `combat.on('end') → hideAfterResult()`; `combatUi.ts:478-483` hides every panel, keeps the result card, `hideAll()` if none; Continue → `hideAll()` (`combatUi.ts:315`); Objectives/Log hide in `ended` (`combatUi.ts:236,249`) |
| 3 | Game-over soft-lock | **Fixed** | `index.ts:149-165` panel "The field is lost" with Load/Title on `to==='gameover'`; Escape list includes `gameover` (`index.ts:136`) |
| 4 | Hotkeys on title/creation; dialogue keys under Pause | **Fixed** | `index.ts:140` gate `['explore','dialogue','cutscene','paused']`; `dialogueUi.ts:19,107` `menuOpen()` predicate wired from `index.ts:19` |
| 5 | `[65%]` without skill name | **Fixed** | `quest/dialogue.ts:187,237-239` `hint: skillLabel(skill)`; `dialogueUi.ts:84-86` `formatCheckOdds(c.hint ?? 'Check', odds)`, hints on enabled choices |
| 6 | Trade/Rest unreachable | **Fixed** | `interact.ts:59-62` routes `trade`/`rest`; `spawnTradeAndRest` (`interact.ts:99-115`) called from `exploration/index.ts:88` — bed at every `population.innkeeper` POI, stall at merchant/town POIs |
| 7 | `dialogue.show` listener/promise leak | **Fixed** | `dialogueUi.ts:27,40-41,116-120,132` `cleanupCurrent` run at `show()` start and in `hide()`; previous promise resolved |
| 8 | No status/defense/weapon; no enemy inspect | **Fixed** | `combatUi.ts:172-179` status chips + `Defense N · weapon (dice, reach)`; `renderTargetCard` (`combatUi.ts:383-399`) HP/morale/defense/weapon/mounted/status/Haufen at the cursor |
| 9 | No Flee | **Fixed** | `combatUi.ts:39` Flee button, shown on the player's turn (`combatUi.ts:332`); `.cbt-flee { position:absolute; bottom:14px; right:190px }` (`ui.css:263`, added in `df0e965` after my interim note) |
| 10 | Objectives hidden in deploy | **Fixed** | `combatUi.ts:236` hides only in `ended` |
| 11 | Settings inert | **Partly fixed (rest not counted)** | `context.ts:26-37,72-83` `loadSettings`/`saveSettings`/`applySettings` (localStorage, render scale via `gfx.renderScale` + `resize()`), `menus.ts:519-526` call it; no `onSettings` consumer yet (world: shadow/view distance/quality pending — coordinator says so) |
| 12 | `℔ s d` unexplained; −0 d; NaN d | **Fixed** | `menus.ts:269` purse legend; `helpers.ts:17-20` finite guard + `trunc` before sign; probes |
| 13 | Save/Load polish | **Fixed** (one nit, r2 #5) | `menus.ts:480-486` `.readonly` + tooltips, Delete hidden on 0/6, footer "F5 quicksave · F9 quickload" (`menus.ts:490`) |
| 14 | Double S chip | **Fixed** | `helpers.ts:55`; probe |
| 15 | Mousemove rebuilds the unit card | **Fixed** (cosmetic nit, r2 #4) | `combatUi.ts:369-381` `updatePreviewOnly` replaces only `.cbt-preview` |
| 16 | `#combat-debug-overlay` | **Fixed** | `render.ts:177` opt-in `?combatdebug=1` only; CSS rule removed |
| 17 | Dead helpers / routed not dimmed | **Fixed** | `combatUi.ts:117` uses `buildInitiativeChips` (routed → `.down`); `formatCheckOdds` now used; `cellToWorldXZ` still test-only (fine) |
| 18 | Small things | **Fixed except creation preview** | 4 dots (`menus.ts:134`); skip hint hidden on finish (`dialogueUi.ts:74`); Pause sub-menus return to Pause (`index.ts:27,37,56-63`); load path uses `closeAll()` (`menus.ts:498`, `index.ts:34`) so no Pause modal survives a load; creation preview still not from `party.derived` (admitted) |

## What the round-2 evidence shows

- **Combat, active phase** (`ui2/combat-brunnen-quay.png`, after the scenario's `auto:4` script, round 5, 0 errors). What the frame shows: the **initiative strip** top-centre (three chips K / H / T — Kuoni green, Habsburg Footman and Toll Collector red, the active one gold-ringed), the **Objectives** panel top-left ("⚑ Defeat all enemies"), the **Log** panel top-right with the last twelve lines legible at 12 px ("Habsburg Footman attacks Kuoni Imhof: hit." / "Kuoni Imhof morale check (damage): routed." / "Round 5 begins." / "Kuoni Imhof's turn." / "Kuoni Imhof flees."). Parchment/ink consistent with the menus; panels sit clear of the 3D focus (the grid is centre-screen; nothing overlaps). Two things the frame does **not** show: (a) the **unit card, AP pips, hit % with Edge/Burden, ability bar, End Turn and Flee** — the `auto:4` script stops after the routed player's forced flee, between turns (`activeUnit` null → `renderUnitCard`/`renderAbilityBar` hide by design, `combatUi.ts:123,196`), so the scenario as written can never frame the player-turn HUD; and (b) the world under the fight — the terrain material is still the world builder's WIP (sky-blue ground, quay house and pier floating), which also explains the 6.0 M-triangle budget miss (`triangles:false` is the world's, not the overlay's). **Legibility defect visible in this frame**: the initiative chips' name labels (`.cbt-chip .nm`, 9 px, `color: var(--parchment)` with a black text-shadow, `ui.css:232`) are parchment-on-parchment inside the `.eid-panel` strip — "Kuoni Im…", "Habsburg…", "Toll Coll…" are barely readable at 1080p; the rule was written for a dark strip. Also 44 px chips truncate every name.

- **Dialogue** (`ui2/dialogue-gessler-hat.png`, round 2, 0 errors): letterbox on, the parchment panel bottom-centre with the narration at 16 px and three numbered gold choices, exactly as in round 1 — and the "click / Enter to continue" hint is now gone once the choices are up (fix 18, `dialogueUi.ts:74`). The hat on its pole is in frame above the panel; the panel covers nothing that matters. The scene behind it is now the art builders' new characters and the WIP terrain (near-black ground at 11:00 — world's problem, not the overlay's). No skill-check choice exists on this node, so `[Skill NN%]` is still unexercised by a harness frame; it is verified in code (`quest/dialogue.ts:187`, `dialogueUi.ts:84-86`) and by the `formatCheckOdds` unit test.
- **Combat, `waitPlayerTurn` scenario** (`ui2/combat-brunnen-quay-turn.png`, round 2 of the fight, 0 errors). **Initiative strip now legible**: five 64 px chips in ink — "Säumer of th…", "Kuoni Imhof", "The elder's man", "Habsburg Fo…", "Toll Collector" — green/red side dots; r2-1 confirmed on evidence. Objectives and Log as before, the Log now showing a rich round ("Säumer of the boat attacks Toll Collector: critical hit." / "Toll Collector takes 10 thrust damage."). **Still no unit card, AP pips, hit %, ability bar, End Turn or Flee** — and this time it is diagnosable from the code: `cmdAuto` (`engine.ts:1213-1229`) runs `advance()` until `round >= autoStopRound` and returns *between turns* with `activeUnitId === null` (`engine.ts:378-379`); the harness's new loop (`main.ts:300-309`) then calls `combat.stepAi()`, which returns immediately when there is no active unit (`stepAi(): const u = …; if (!u) return;`) — so nothing ever advances to Kuoni's turn, the loop spins its 60 frames and the screenshot is taken on the same seam as before. In real play this seam does not exist (`advance()` runs to the next player-controlled unit and emits `phase:'active'` with that unit, `engine.ts:394-397`), so the card/ability bar will show; but the rubric scores frames, and there is still none. No gold "active" ring is visible on any chip, consistent with `activeUnit: null`.

## Interim findings (reported to the coordinator mid-round) → status at `df0e965`

| # | Finding | Status | Verified at |
|---|---|---|---|
| i1 | Flee button had no CSS rule → rendered at the screen's top-left corner | **Fixed** | `ui.css:263` `.cbt-flee { position:absolute; bottom:14px; right:190px }` — sits left of End Turn (`right:14px`) |
| i2 | Load-from-Pause left the Pause modal over the loaded game (regression from the return-to-Pause fix) | **Fixed** | `MenuApi.closeAll()` (`menus.ts:22`, `index.ts:34`: clears `#menu-root`, resets `openedFromPause`/`currentMenu`); `onSlotClick` load path calls it (`menus.ts:498`); game-over Title button also `closeAll()` first (`index.ts:163`) |
| i3 | Game-over → Load → close left a blank screen | **Fixed** | `closeMenu()` calls `showGameOver()` when `ctx.state.state === 'gameover'` (`index.ts:60-61`); panel builder hoisted to `showGameOver()` (`index.ts:154-166`) |

## Round-2 findings (from the Brunnen frame and the fix diff) → status at `73afac2`

| # | Finding | Status | Verified at |
|---|---|---|---|
| r2-1 | Initiative chip names parchment-on-parchment, 9 px, 44 px chips | **Fixed** | `ui.css:225,232` — `.cbt-chip` 64 px, `.nm { color: var(--ink); font-size: 10px; max-width: 64px; ellipsis }` — see `ui2/combat-brunnen-quay-turn.png` below |
| r2-2 | Player-turn HUD never captured (`auto:4` stops between turns) | **Not yet effective** — see the frame below and round-3 item 1 | new scenario `combat-brunnen-quay-turn` (`scenarios.json:262-271`: `auto:1` + `waitPlayerTurn`); `main.ts:300-309` loops on `combat.stepAi()`, which is a no-op while `activeUnitId` is null (`engine.ts` `stepAi`: `if (!u) return;`) — and `cmdAuto` always leaves it null |
| r2-3 | Flee used `window.confirm` | **Fixed** | `combatUi.ts:40` `showConfirm(mount, …, 'Flee', 'Stay')` |
| r2-4 | Empty dashed `.cbt-preview` rule | **Fixed** | `combatUi.ts:381` `if (!node.hasChildNodes()) { existing?.remove(); return; }` |
| r2-5 | Save mode could overwrite the autosave | **Fixed** | `menus.ts:481` `disabledForSave = mode==='save' && (slot.readOnlySave \|\| slot.slot === 0)` |

## Remaining (minor; not counted against the bar)

1. Settings: `quality`, `shadowRes`, `viewDistance`, `masterVolume`, `invertY` are persisted and applied to nothing (no `ctx.onSettings` subscriber anywhere) — flagged by the coordinator as pending for the world module.
2. Creation preview (HP/Defense/Morale) still UI-side arithmetic, not `party.derived` (admitted).
3. Trade stalls use `MERCHANT_STOCK` (`menus.ts:606`) for every settlement — the stall entity carries `data.merchant = poi.id` but `renderTrade` never reads it. Content-side later.
4. Inventory modal is 80 vh of mostly empty parchment for a five-item pack (Skyrim keeps the world visible on one side) — cosmetic.

## Historical compliance
Clean (see banned-word grep). New strings are in register: "The field is lost", "the party scatters", "Rest at the inn", "Take the boat".

## Explicitly out of reach for a browser engine (not counted)
- SwiftShader frame times; procedural portraits; heightmap map; world-side consumption of shadow/view-distance settings (pending, per coordinator).
