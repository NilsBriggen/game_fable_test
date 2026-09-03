# Wave 3 — ui — critic score (round 3/3, final)

Reference: BG3 combat HUD clarity + Skyrim menus (RUBRIC.md row "ui")
Code reviewed: HEAD `36b14c3` ("Combat: stepAi advances to the next unit between turns (harness waitPlayerTurn)"). `src/ui/**` and `index.html` are byte-identical to `73afac2` (`git diff 73afac2..HEAD --stat -- src/ui index.html` → empty) and clean in the working tree; the only change since round 2 is the one-line engine seam fix I asked for (`engine.ts` `stepAi()`: `if (!u) { if (this.phase === 'active') this.advance(); return; }`). Round-2 verification of every fix (diffs `ef28447..ffa5ede`, `ffa5ede..df0e965`, `df0e965..73afac2`) therefore stands unchanged and is reproduced in the tables below.
Harness run (round 3): `combat-brunnen-quay-turn` captured by the integrator at `tools/harness/out/ui3/combat-brunnen-quay-turn/` (`generatedAt 2026-09-03T01:47:58Z`, `state: combat`, `pass: true`, `errors: []`, `warnings: []`, 440 draw calls, 1.39 M tris, 257 MB, `budget.noErrors: true`; only `frameP95` is red, which is SwiftShader). Round-2 captures `ui2/combat-brunnen-quay` (22:07Z), `ui2/dialogue-gessler-hat` (00:08Z), `ui2/combat-brunnen-quay-turn` (01:09Z) and round-1 `title` / `menu-inventory` / `menu-map` / `combat-morgarten-setup` stand — all `errors: []`, `warnings: []`. Renderer throughout: `Google Inc. (Google) / ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)` (SOFTWARE).
Checks (verbatim, re-run at `36b14c3`):
- `npx vitest run src/ui` → `Test Files  1 passed (1)` / `Tests  16 passed (16)`.
- `npx tsc --noEmit | grep -E 'src/ui|index.html'` → no lines.
- `node tools/check-imports.mjs` → `imports ok`.
- Critic probes `npx vitest run --config tools/critic/probes/ui/vitest.config.ts` → `Tests  29 passed (29)` (`tools/critic/probes/ui/helpers-edge.test.ts`: currency sign/fraction/non-finite, rotated-grid picking at yaw ±π/2, π, 0.3, 2.9 against the engine's `cellToWorldXZ` plus the 0.49/0.51 boundary, compass seam and single S chip, initiative chips with dead/routed/missing/duplicate ids, 7-slot save model with out-of-range/duplicate metas, hit-chance formatting bounds).
- Chromium cascade check (`/opt/pw-browsers/chromium`, page built from `ui.css` + `<div id="dialogue-root" hidden>`) → `{"dialogueDisplay":"none","dialogueRect":0,"hudDisplay":"none","elementAtBottomCentre":""}`.
- Banned-word grep over `src/ui/*.ts`, `ui.css`, `index.html` (`switzerland|swiss|canton|plate harness|handgun|wheellock|windlass|kapellbr|potato|tomato|maize|tobacco|chocolate|pike|musket|gunpowder`, case-insensitive) → only the `Canton` *type* annotations in `menus.ts`; no player-facing hit. "the Länder", "the Waldstätte", "Landsgemeinde", the §7 item names and the `Pfund ℔ · Schilling s · Pfennig d` legend are all in register.

## Score: 8/10   (pass bar 8)  → PASS (round 3/3)

6 → 7 → 8. The round-3 frame finally photographs the player-turn HUD, and it meets the BG3 clarity bar: on Kuoni Imhof's turn every element the rubric names is on screen, legible at 1080p, and nothing overlaps anything — turn order with the active chip ringed, action/bonus/reaction pips, movement in metres, hit chance with its Edge source named, formation status (none applicable here, code-verified), objectives, log, ability bar with hotkeys, End Turn and Flee. Every rubric 8-bar clause is now met on harness-captured evidence: every screen readable (title, inventory, map, dialogue, deploy, active combat), no overlapping text in any of the eight frames, hover previews in combat (the card's `vs Toll Collector (1d8): 91% hit — Edge: flanked` line is the same `previewAttack` path the mouse hover drives), map with markers, save/load with thumbnails. Zero console errors and zero page errors in every scenario that exercises the module. LORE compliance clean. The 22 round-1 defects I found in code (dialogue panel never hiding, combat panels never hiding, game-over soft-lock, hotkeys on the title screen, `[NN%]` without the skill, unreachable trade/rest, listener leaks, …) and the eight round-2 findings are all fixed and verified in the diff; the three probe-documented helper defects flipped. What separates this from a 9 is polish, not correctness: three of the eight ability icons are the same bare circle, the enemy inspect card and the reaction prompt are code-verified but never framed, and the settings panel still promises world-side changes the world module does not consume.

## What the round-3 frame shows (`ui3/combat-brunnen-quay-turn.png`, Kuoni Imhof's turn, round 2, 0 errors)

- **Initiative strip** (top-centre, parchment panel): five 64 px chips — S "Säumer of th…", **K "Kuoni Imhof" ringed gold** (active), T "The elder's man", H "Habsburg Fo…", T "Toll Collector"; player chips green, Habsburg red; names in ink, readable. Truncation only on the two longest names.
- **Unit card** (bottom-left, 280 px): "Kuoni Imhof" with a green *player* badge; `Defense 11 · Spiess (1d8, reach 2)`; HP bar 32/32 (red) and morale bar 42/42 (blue) with numerals; four stance buttons with **Neutral** highlighted; `Action ● Bonus ● Reaction ●` pips all filled; `Move 9.0/9.0m`; the preview rule `vs Toll Collector (1d8): **91% hit**` with `Edge: flanked` beneath — hit chance with a named Edge source, exactly the BG3 idiom. Status chips and the formation chip are absent because Kuoni has no status and no adjacent polearm (`combatUi.ts:172-179` render them when present; the Morgarten Haufen case is unit-tested in the combat module).
- **Ability bar** (bottom-centre): eight 48 px slots with hotkey numerals 1–8 in the corner; tooltips (name, cost, range, description) appear on hover (`combatUi.ts:199-213`). Icons are ink-line glyphs; slots 3, 4 and 6 are the same bare circle — see polish item 1.
- **End Turn (Space)** and **Flee** bottom-right, side by side (`.cbt-end-turn` right 14 px, `.cbt-flee` right 190 px); Flee opens the parchment `showConfirm`.
- **Objectives** top-left ("⚑ Defeat all enemies"), **Log** top-right ending in "Kuoni Imhof's turn." — twelve lines at 12 px, all legible.
- Layout: the four corner panels and the bottom bar leave the whole centre of the frame — the grid, the units and their floating HP/morale sprites — unobstructed; nothing overlaps. The floating world (no ground under the quay, house and pier in mid-air) is the world-look builder's WIP terrain material, not the overlay, and does not affect the HUD judgement.

## Earlier evidence (unchanged, summarised)

- `title.png`: heading over the live lake, four parchment buttons, Continue disabled without a save.
- `menu-inventory.png`: tabs, 7 equipment slots, pack rows with kg and `s d`, totals line (now with the `Pfund ℔ · Schilling s · Pfennig d` legend, code-verified); real §7 kit.
- `menu-map.png`: shaded heightmap, lakes, roads, 14 region labels, discovered-POI icon, player arrow.
- `dialogue-gessler-hat.png` (r1 and r2): letterbox, panel, 16 px narration, numbered gold choices; the skip hint now disappears once choices are up; `[Skill NN%]` code-verified (this node has no check).
- `combat-morgarten-setup.png`: deploy banner with nine unit chips and Confirm; objectives now shown in deploy (code-verified).
- `ui2/combat-brunnen-quay.png`, `ui2/combat-brunnen-quay-turn.png`: initiative/objectives/log; the r2 frame proved the chip-name legibility fix; both stopped on the between-turns seam that `36b14c3` closes.

## Cumulative issues → status (all verified in the diff; line refs at `73afac2` = HEAD for `src/ui`)

| Round | # | Issue | Status | Verified at |
|---|---|---|---|---|
| 1 | 1 | Dialogue panel never hides (`display:flex` beats `[hidden]`) | Fixed | `ui.css:144`; `dialogueUi.ts:133`; Chromium check `display:none` |
| 1 | 2 | Combat panels never hide after a fight | Fixed | `index.ts:119` `on('end')→hideAfterResult()`; `combatUi.ts:478-483`; Continue → `hideAll()` |
| 1 | 3 | Game-over soft-lock | Fixed | `index.ts:154-166` `showGameOver()`; Escape list includes `gameover` |
| 1 | 4 | Hotkeys on title/creation; dialogue keys under Pause | Fixed | `index.ts:140` state gate; `dialogueUi.ts:107` `menuOpen()` |
| 1 | 5 | `[65%]` without skill name | Fixed | `quest/dialogue.ts:187,237-239`; `dialogueUi.ts:84-86` `formatCheckOdds` |
| 1 | 6 | Trade/Rest unreachable | Fixed | `interact.ts:59-62`, `spawnTradeAndRest` from `exploration/index.ts:88` |
| 1 | 7 | `dialogue.show` listener/promise leak | Fixed | `dialogueUi.ts:27,40-41,116-120,132` `cleanupCurrent` |
| 1 | 8 | No status/defense/weapon; no enemy inspect | Fixed | `combatUi.ts:172-179`; `renderTargetCard` `combatUi.ts:383-399`; `Defense 11 · Spiess (1d8, reach 2)` in the r3 frame |
| 1 | 9 | No Flee | Fixed | `combatUi.ts:39-40` + `ui.css:263`; in the r3 frame beside End Turn |
| 1 | 10 | Objectives hidden in deploy | Fixed | `combatUi.ts:236` |
| 1 | 11 | Settings inert | Partly (UI side done) | `context.ts:26-37,72-83` persist + render scale; world consumption pending (not counted) |
| 1 | 12 | `℔ s d` unexplained; −0 d; NaN d | Fixed | `menus.ts:269`; `helpers.ts:17-20`; probes |
| 1 | 13 | Save/Load polish | Fixed | `menus.ts:480-490` readonly styling, Delete hidden on 0/6, F5/F9 footer; Save refuses slot 0 (`menus.ts:481`) |
| 1 | 14 | Double S chip | Fixed | `helpers.ts:55`; probe |
| 1 | 15 | Mousemove rebuilds the unit card | Fixed | `combatUi.ts:369-381` `updatePreviewOnly`; empty node removed (`:381`) |
| 1 | 16 | `#combat-debug-overlay` | Fixed | `render.ts:177` opt-in only; CSS rule removed |
| 1 | 17 | Dead helpers / routed not dimmed | Fixed | `combatUi.ts:117` `buildInitiativeChips` |
| 1 | 18 | Small things | Fixed except creation preview | 4 dots; skip hint; Pause sub-menus return to Pause; `closeAll()` before load |
| 2 | i1 | Flee at the screen corner (no CSS) | Fixed | `ui.css:263` |
| 2 | i2 | Load-from-Pause left the Pause modal | Fixed | `MenuApi.closeAll()` `index.ts:34`, `menus.ts:498` |
| 2 | i3 | Game-over → Load → close blank | Fixed | `index.ts:60-61` |
| 2 | r2-1 | Initiative names parchment-on-parchment | Fixed | `ui.css:225,232`; r2/r3 frames |
| 2 | r2-2 | Player-turn HUD never captured | **Fixed (r3)** | `engine.ts` `stepAi()` advances between turns; `ui3/combat-brunnen-quay-turn.png` |
| 2 | r2-3 | Flee used `window.confirm` | Fixed | `combatUi.ts:40` `showConfirm` |
| 2 | r2-4 | Empty dashed `.cbt-preview` | Fixed | `combatUi.ts:381` |
| 2 | r2-5 | Save could overwrite the autosave | Fixed | `menus.ts:481` |

## Polish for a 9 (not gating; recorded for the backlog)

1. **Ability icons**: `abilityIcon()` falls back to the same bare circle for three of Kuoni's eight abilities (slots 3, 4, 6 in the r3 frame) — the bar reads by hotkey number only. Draw one glyph per ability family (`icons.ts`) so the bar reads at a glance like BG3's.
2. **Enemy inspect card and reaction prompt** are code-verified (`combatUi.ts:383-399`, `:277-292`) but never framed; a hover step or a `reaction`-phase scenario would close that.
3. **Floating unit sprites** (HP/morale bars over each figure, from the combat renderer) are ~4 px tall at this camera distance — the HUD card carries the numbers, but a tap on the sprite scale would help the overview.
4. Settings: `quality`, `shadowRes`, `viewDistance`, `masterVolume`, `invertY` persisted and applied to nothing (no `ctx.onSettings` subscriber) — world module's side.
5. Creation preview (HP/Defense/Morale) still UI-side arithmetic, not `party.derived`.
6. Trade stalls all sell `MERCHANT_STOCK` (`menus.ts:606`); `data.merchant` is carried but unread.
7. Inventory modal is 80 vh of mostly empty parchment for a five-item pack.

## Historical compliance
Clean — no banned word is player-facing; register per LORE §7–§8 throughout ("the Länder", "the Waldstätte", Halbarte/Spiess/Gambeson, Pfund/Schilling/Pfennig, "The field is lost", "Rest at the inn", "Take the boat").

## Explicitly out of reach for a browser engine (not counted)
- SwiftShader frame times (p95 3.5 s here; the DOM overlay is not the cost).
- Procedural silhouette portraits, heightmap map, no controller support / animated transitions — the rubric's 10/10 items, not expected at this stage.
- The missing ground in every combat frame — the world-look builder's in-progress terrain material.
