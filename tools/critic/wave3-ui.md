# Wave 3 — ui — critic score (round 2/3)

Reference: BG3 combat HUD clarity + Skyrim menus (RUBRIC.md row "ui")
Code reviewed: HEAD `ffa5ede` (fix commit `77e2e7b`, "UI fix round 1 (integrator)"); `src/ui/**`, `index.html` clean in the working tree (dirty files are `src/world/*` WIP by the world builder). Diff `ef28447..HEAD` read in full for `src/ui/{index,combatUi,dialogueUi,helpers,menus}.ts`, `ui.css`, `src/core/{context,services}.ts`, `src/quest/dialogue.ts`, `src/exploration/interact.ts`, `src/combat/render.ts` (241 insertions / 51 deletions).
Harness run (round 2, `--out tools/harness/out/ui2/<id>`, one at a time behind the lock): BRUNNEN_LINE DIALOGUE_LINE Round-1 captures of `title`, `menu-inventory`, `menu-map` (20:45–20:58Z) stand — no code touching those screens changed except the purse legend and the save-slot styling (both verified in code). Renderer: SwiftShader (SOFTWARE).
Checks (verbatim, at HEAD):
- `npx vitest run src/ui` → `Test Files  1 passed (1)` / `Tests  16 passed (16)`.
- `npx tsc --noEmit | grep -E 'src/ui|index.html'` → no lines.
- `node tools/check-imports.mjs` → `imports ok`.
- Critic probes `npx vitest run --config tools/critic/probes/ui/vitest.config.ts` → first run `3 failed | 26 passed` — exactly the three tests named `DEFECT:` (−0 d, NaN d, double S chip), i.e. the defects are gone; inverted to `FIXED r2:` assertions → `Tests  29 passed (29)`.
- Chromium cascade check re-run against the new `ui.css` (`<div id="dialogue-root" hidden>`): `{"dialogueDisplay":"none","dialogueRect":0,"hudDisplay":"none","elementAtBottomCentre":""}` (round 1: `flex`, 197 px, `#dialogue-root` under the cursor).
- Banned-word grep over `src/ui/*.ts`, `ui.css`, `index.html`: still only the `Canton` type annotations; the new strings ("The field is lost", "Your company lies in the mud. The chroniclers will not record their names.", "Flee the field? …", "Rest at the inn", "Trade at the market", "Take the boat", purse legend "Pfund ℔ · Schilling s · Pfennig d") are clean.

## Score: SCORE_LINE

SUMMARY_BLOCK

## Round-1 issues → status

| # | Issue (round 1) | Status | Verified at |
|---|---|---|---|
| 1 | Dialogue panel never hides (`display:flex` beats `[hidden]`) | **Fixed** | `ui.css:144` `#dialogue-root[hidden]{display:none!important}`; `dialogueUi.ts:133` `clear(panelRoot)`; Chromium check `display:none`, rect 0 |
| 2 | Combat panels never hide after a fight | **Fixed** | `index.ts:119` `combat.on('end') → hideAfterResult()`; `combatUi.ts:478-483` hides every panel, keeps the result card, `hideAll()` if none; Continue → `hideAll()` (`combatUi.ts:315`); Objectives/Log hide in `ended` (`combatUi.ts:236,249`) |
| 3 | Game-over soft-lock | **Fixed** (one gap, r2 #2) | `index.ts:149-165` panel "The field is lost" with Load/Title on `to==='gameover'`; Escape list includes `gameover` (`index.ts:136`) |
| 4 | Hotkeys on title/creation; dialogue keys under Pause | **Fixed** | `index.ts:140` gate `['explore','dialogue','cutscene','paused']`; `dialogueUi.ts:19,107` `menuOpen()` predicate wired from `index.ts:19` |
| 5 | `[65%]` without skill name | **Fixed** | `quest/dialogue.ts:187,237-239` `hint: skillLabel(skill)`; `dialogueUi.ts:84-86` `formatCheckOdds(c.hint ?? 'Check', odds)`, hints on enabled choices |
| 6 | Trade/Rest unreachable | **Fixed** | `interact.ts:59-62` routes `trade`/`rest`; `spawnTradeAndRest` (`interact.ts:99-115`) called from `exploration/index.ts:88` — bed at every `population.innkeeper` POI, stall at merchant/town POIs |
| 7 | `dialogue.show` listener/promise leak | **Fixed** | `dialogueUi.ts:27,40-41,116-120,132` `cleanupCurrent` run at `show()` start and in `hide()`; previous promise resolved |
| 8 | No status/defense/weapon; no enemy inspect | **Fixed** | `combatUi.ts:172-179` status chips + `Defense N · weapon (dice, reach)`; `renderTargetCard` (`combatUi.ts:383-399`) HP/morale/defense/weapon/mounted/status/Haufen at the cursor |
| 9 | No Flee | **Fixed (layout wrong, r2 #1)** | `combatUi.ts:39` Flee button, shown on the player's turn (`combatUi.ts:332`) |
| 10 | Objectives hidden in deploy | **Fixed** | `combatUi.ts:236` hides only in `ended` |
| 11 | Settings inert | **Partly fixed (rest not counted)** | `context.ts:26-37,72-83` `loadSettings`/`saveSettings`/`applySettings` (localStorage, render scale via `gfx.renderScale` + `resize()`), `menus.ts:519-526` call it; no `onSettings` consumer yet (world: shadow/view distance/quality pending — coordinator says so) |
| 12 | `℔ s d` unexplained; −0 d; NaN d | **Fixed** | `menus.ts:269` purse legend; `helpers.ts:17-20` finite guard + `trunc` before sign; probes |
| 13 | Save/Load polish | **Fixed** (one nit, r2 #5) | `menus.ts:480-486` `.readonly` + tooltips, Delete hidden on 0/6, footer "F5 quicksave · F9 quickload" (`menus.ts:490`) |
| 14 | Double S chip | **Fixed** | `helpers.ts:55`; probe |
| 15 | Mousemove rebuilds the unit card | **Fixed** (cosmetic nit, r2 #4) | `combatUi.ts:369-381` `updatePreviewOnly` replaces only `.cbt-preview` |
| 16 | `#combat-debug-overlay` | **Fixed** | `render.ts:177` opt-in `?combatdebug=1` only; CSS rule removed |
| 17 | Dead helpers / routed not dimmed | **Fixed** | `combatUi.ts:117` uses `buildInitiativeChips` (routed → `.down`); `formatCheckOdds` now used; `cellToWorldXZ` still test-only (fine) |
| 18 | Small things | **Fixed except creation preview** | 4 dots (`menus.ts:134`); skip hint hidden on finish (`dialogueUi.ts:74`); Pause sub-menus return to Pause (`index.ts:27,37,56-60`) — but see r2 #3; creation preview still not from `party.derived` (admitted) |

## What the round-2 evidence shows

BRUNNEN_BLOCK

DIALOGUE_BLOCK

## New / remaining issues (ranked)

1. **Flee button renders in the top-left corner of the screen, not beside End Turn.** `combatUi.ts:39` gives it class `eid-btn cbt-flee`, but `ui.css` has no `.cbt-flee` rule (only `.cbt-end-turn { position:absolute; bottom:14px; right:14px }`, `ui.css:262`). It is the only in-flow child of `#combat-root` (fixed, inset 0), so it lands at (0,0) above the initiative strip's left edge. — evidence: BRUNNEN_FLEE — fix: `.cbt-flee { position:absolute; bottom:14px; right:150px; }` (or wrap End Turn + Flee in one bottom-right flex row). Also use the in-game `showConfirm` instead of `window.confirm` (`combatUi.ts:39`): the native dialog is off-style and blocks the frame loop.
2. **Load-from-Pause leaves the Pause menu on screen after the load (regression from fix 18).** `menus.ts:497-499` (`onSlotClick`, load mode) calls `api.closeMenu()` then `save.load(slot)`; `closeMenu` now sees `openedFromPause` and re-opens Pause (`index.ts:56-58`) *before* the load transitions `paused → loading → explore`; nothing in the state listener (`index.ts:152-168`) closes a `pause` menu on `loading`/`explore`, so the loaded game runs under the pause modal until the player presses Escape. Same path from Pause → Title → (state listener re-renders title, fine). — fix: in `ctx.state.onChange`, `if (to === 'loading' && currentMenu) { clear(menuRoot); currentMenu = null; openedFromPause = false; }`, or have `onSlotClick` close without the return-to-pause.
3. **Game-over → Load → close returns to a blank screen.** The panel hides itself before `openMenu('load')` (`index.ts:159`); closing the Load modal in state `gameover` clears `#menu-root` and nothing re-shows the game-over panel (`index.ts:63-72` handles only paused/title/creation). Escape then opens Pause (whose Resume also does nothing here). — fix: in `closeMenu`, `else if (ctx.state.state === 'gameover') gameOverRoot.style.display = ''`.
4. **Empty dashed preview line.** `updatePreviewOnly` (`combatUi.ts:374-380`) always inserts a `.cbt-preview` node even when there is no nearest enemy and no hover line — `.cbt-preview` carries `border-top:1px dashed` (`ui.css:246`), so an empty dashed rule appears under the AP row. — fix: skip/remove the node when all three children are null.
5. **Save mode still writes to slot 0.** `readonly` styling now covers 0 and 6, but `disabledForSave` is still `slot.readOnlySave` (quicksave only, `menus.ts:479`), so a click on the autosave slot in Save mode overwrites the autosave after the confirm. — fix: `disabledForSave = mode==='save' && (slot.readOnlySave || slot.kind==='autosave')`.
6. Settings: `quality`, `shadowRes`, `viewDistance`, `masterVolume`, `invertY` are persisted and applied to nothing (no `ctx.onSettings` subscriber anywhere) — the coordinator has flagged this as pending for the world module; not counted.
7. Creation preview (HP/Defense/Morale) still UI-side arithmetic, not `party.derived` (admitted; minor).
8. Trade stalls use `MERCHANT_STOCK` (`menus.ts:606`) for every settlement — the stall entity carries `data.merchant = poi.id` but `renderTrade` never reads it, so Luzern and a mountain hamlet sell the same eight items. Minor; content-side later.

## Historical compliance
Clean (see banned-word grep). New strings are in register: "The field is lost", "the party scatters", "Rest at the inn", "Take the boat".

## Explicitly out of reach for a browser engine (not counted)
- SwiftShader frame times; procedural portraits; heightmap map; world-side consumption of shadow/view-distance settings (pending, per coordinator).
