# Wave 1 — party — critic score

Reference: Skyrim (learn-by-doing you can feel)
Harness run: 2026-09-02T12:51:17.157Z, renderer: Google Inc. (Google) / ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver) (SOFTWARE), scenarios: title
Evidence read:
- `npx vitest run src/party 2>&1 | tail -8` → `✓ src/party/party.test.ts (49 tests) 30ms` / `Test Files  1 passed (1)` / `Tests  49 passed (49)` / `Duration  917ms`.
- `npx tsc --noEmit 2>&1 | grep -E 'src/(party|content/(skills|perks|items|archetypes))'` → no output (zero type errors in the module and its four content files).
- `node tools/check-imports.mjs` → `imports ok`.
- `node tools/harness/run.mjs --scenario title 2>&1 | tail -4` → `PASS title  calls=103 tris=936313 p95=6110.0ms max=8920.4ms heap=46MB err=0 warn=0` / `1/1 passed`. `report.json`: `errors: []`, `warnings: []`. (Draw calls / frame time are the world builder's WIP terrain under SwiftShader — commit `0859f20` — not party's; party registers with zero console/page errors.)
- Round-1 scratch probes A–K re-run unchanged against commit `9e511d7` → `11 passed (11)` (all ten formerly-failing assertions now pass; probe output: `A … duplicates []`, `B ok false bread left 3`, `C schwert instances 3 qty [1,1,1]`, `D bolts on bow accepted false, crossbow in mainHand false`, `E` no throw, `F restHeal(8h, end 8) = 8`, `G defense 11 → 15`, `H events [[offHand,null],[mainHand,…]]`, `I party size 4`, `K langspiess in 1291: false`).
- Round-2 regression probes L–P (new scratch file): L/L2 found a regression (issue 1 below); M, M2, N, O, P informational.
- Pacing recomputed from the live `rules.xpToNext` (numbers below).
- Code read in full: `src/party/index.ts` (853 lines), `src/party/rules.ts`, `src/party/party.test.ts` (491 lines), `src/content/{items,perks}.ts` diffs, `src/core/services.ts` (`invalidate`, `character-level-up`, `DerivedStats.ammo`, `addMember: boolean`), `src/core/ecs.ts` (`isAlive`, `World.deserialize`), LORE §10.

## Score: 8/10   (pass bar 8)  → PASS (round 2/3)

Every one of the fifteen ranked issues from round 1 is fixed in the code, not just in the summary, and each fix is pinned by a test that was ported from my own reproduction (see the table). The progression loop is now something a player will feel: the first halberd level-up lands after three hits, the first perk about two-thirds of the way through Act 1, and the character-level toast has an event to hang on. The one thing holding this at 8 rather than 9 is a small regression introduced by the (correct) stricter ammo rule: the herder background — one of six starting choices — now starts with fifteen sling stones in the pack and none loaded, because `item.sling` never declared `weapon.ammo`. It is a one-line content fix and it is not covered by the kit test, which only asserts `mainHand || ranged`. Fix it in the next commit; it does not need a full round.

## Round 1 issues → status

| # | Round-1 issue | Status | Verified by |
|---|---|---|---|
| 1 | XP constant ~60× too high | **Fixed** — `xpToNext = max(1, round(5 + 0.3·(l+1)^1.6))` (`rules.ts:24–26`) | recompute: 10→25 = 545 XP; pacing tests `party.test.ts:88–116` |
| 2 | Item instance ids collide after load | **Fixed** — `nextItemSeq` persisted on `PartyState`, owner dropped from id (`index.ts:30–41, 517–521`) | probe A (scratch + `party.test.ts:288–304`), ids `item-1…item-6` unique after `World.deserialize` |
| 3 | `derived()` cache stale, no invalidation hook | **Fixed** — public `invalidate(id?)` in core interface (`services.ts:294`), fingerprint check on every hit (`index.ts:680–698`), `invalidate()` on `'loaded'` clears the whole map | probe G, G2; `party.test.ts:355–386` |
| 4 | `removeItem` partial removal | **Fixed** — `countItem < qty → false` up front (`index.ts:562`); `equipped(slot,null)` on auto-unequip | probe B; `party.test.ts:306–311` |
| 5 | Ammo not matched, ranged weapon in two slots | **Fixed** — `slotCompatible('mainHand')` rejects ranged unless `thrown`; ammo must equal `ranged.weapon.ammo`; instance cleared from any other slot; mismatched ammo dropped on ranged swap (`index.ts:430–480`) | probe D; `party.test.ts:322–337`; probe M2 (ammo dropped when swapping bow→crossbow) — **but see issue 1 (sling)** |
| 6 | Rest heals 0 at endurance ≤ 9; morale not restored | **Fixed** — `max(1, 1+mod)` (`rules.ts:99–101`); `ch.morale = ch.moraleMax` in `rest()` | probe F; `party.test.ts:347–353` (F, F2) |
| 7 | No party cap | **Fixed** — cap 4, refuses entity without `Character`, returns `boolean` (`index.ts:238–249`, `services.ts:289`) | probe I; `party.test.ts:397–409` |
| 8 | `eraFrom` unenforced | **Fixed** — `CHAPTER_ORDER`, `chapter` on `PartyState`, `equip()` gated, authored kits bypass via `equipInternal(…, false)`; `langschwert` now `eraFrom: 'ch1-1307'` | probe K; `party.test.ts:411–427` (K, K2) |
| 9 | Anachronistic perk names | **Fixed** — Spiessstoss, Schnellschuss, Schwingerwurf, Plattenrock; Gürtelhaken-Drill at crossbow 75 (`historical: true`), Aimed Shot moved to 100 | `perks.ts:46, 140, 146, 152, 192, 226`; banned-word grep clean in all `name`/`description` fields |
| 10 | Nothing in LORE §10 | **Fixed** — 6 rows appended (lance, staff, footwear/leather cap, healing consumables, perk-name blanket row, renamed crossbow capstone) | LORE §10 read |
| 11 | Non-stackable `qty>1` → one instance | **Fixed** — one instance per unit; `qty<=0` clamped; unknown def warns (`index.ts:523–556`) | probe C; `party.test.ts:313–320` |
| 12 | Backgrounds grant no skills | **Fixed** — `BACKGROUND_SKILL_BONUS` +5/+5 (`index.ts:104–112`) | `party.test.ts:206–221` (all six) |
| 13 | `transfer` throws on dead entity | **Fixed** — `world.isAlive()` guard (`index.ts:586`) | probe E; `party.test.ts:339–345` |
| 14 | Stale/missing events | **Fixed** — recompute before `level-up`; `equipped(offHand,null)`; `hp-changed` on every `hpMax` change; `character-level-up` event in core | probe H; `party.test.ts:272–286, 388–395` |
| 15 | Thin tests | **Fixed** — 27 → 49, probes A–K ported | vitest run |
| minor | `capacityKg` resync, `grantSkillXp` guard, level-4 floor documented, `leadershipRadius` comment | **Fixed** (`index.ts:196–199, 316, 410–415, 787`) | code read |
| minor | dead `rules.speedM` helper | **Not fixed** (still duplicated inline at `index.ts:751`) | code read — cosmetic |

## What the evidence shows (bullets, cite screenshot or number)

- Pacing from the live curve: `xpToNext` 0→5, 10→19, 15→30, 20→44, 24→57, 25→60, 50→167, 75→311, 99→480. Cumulative 10→25 = **545 XP**, 15→25 = 429, 20→25 = 251, 25→50 = 2 699, 50→75 = 5 838, 75→100 = 9 845, 10→100 = 18 927 per skill. At 7 XP per halberd hit: first level-up after **3 hits**, first perk after **78 hits** ≈ 8–13 fights (43–65 XP/fight) — the first perk lands two-thirds through a 12-fight Act 1, and a Schwyz-origin halberdier (start 15) or a Uri hunter (crossbow 20 with the new background bonus) gets there in 4–7 fights. Skyrim-comparable. The 25→50 stretch (40–60 fights) belongs to Act 2, 50→75 to Act 3 — the ^1.6 shape still slows hard, as §5.5 asks.
- A pacing test now pins the constant from both sides (`400 < Σ(10..24) < 700`, `xpToNext(10) < 30`, `xpToNext(0) ≥ 1`) and an end-to-end test grants 13 × 43 XP and asserts ≥ 8 `level-up` events and `perk.halberd-25` available (`party.test.ts:88–116`). Round 1's blind spot (a test deriving its grant from `xpToNext` itself) is closed.
- Save/load: `PartyState { formation, nextItemSeq, chapter }` is a persisted component on the player; the test serialises, `World.deserialize`s into a fresh service, fires `'loaded'` and adds an item — ids stay unique (`party.test.ts:288–304`). Before a player exists, `fallbackState` supplies the counter and is copied onto the player at creation, so NPC items minted earlier do not collide either (probe L2: herder archetype gets `item-6…item-9` after the player's `item-1…item-5`).
- Derived stats: the fingerprint covers attributes, level, fatigue, down, equipment map, perk ids, item defId×qty and skill levels — everything `derived()` reads. 2 000 `derived()` calls on a fully-kitted militia cost 16.9 ms (probe P), so the fingerprint is not a performance concern. `DerivedStats.ammo` is populated: a hunter reports `{ defId: 'item.arrows', qty: 20 }` (probe M).
- Equipment: bolts refused on a bow, bow refused in `mainHand`, arrows accepted; swapping bow → crossbow drops the now-mismatched arrows with an `equipped('ammo', null)` event (probe M2). Two-hander clears the buckler *and* announces it (probe H).
- Party: cap at 4 with `boolean` return; `rest()` heals an endurance-9 elder and resets morale; `transfer` returns `false` on a destroyed entity and on an unknown id.
- Events: `character-level-up` fires with `(level, attributePointsGained)`; `hp-changed` follows every `hpMax` change.
- Harness: party registers error-free (`err=0 warn=0`). The 6.1 s p95 and 103 draw calls belong to the world builder's in-progress terrain and are not scored here.

## Historical compliance (content modules)

**Items (49)** — unchanged from round 1 except `item.langschwert` now `eraFrom: 'ch1-1307'` (matches its own note and LORE §7 "from c. 1300"); `item.langspiess` `eraFrom: 'ch2-1314'` is now enforced by `equip()` (probe K). Full per-item mapping stands as in round 1: 13 weapons + 7 armour pieces + money + food rows → LORE §7 (H); `item.lance`, `item.staff`, leather cap / three footwear items, bandage / herbs / salve → **now registered in §10** ✓; `item.bundesbrief-copy` → §6/§9, `item.gessler-hut` → §6 (`'legend'`) ✓; rope/torch/flint/fishing-line/hammer mundane ✓; Säumer goods → §2/§10 ✓. No banned anachronism player-facing ✓. Prices/weights unchanged, plausible ✓.

**Perks (52) — renamed entries re-audited:**
- `perk.spear-75` **Spiessstoss** ✓ — period German for the spear-thrust; note keeps the "massed formations shove" justification.
- `perk.crossbow-50` **Schnellschuss** ✓ — plain German "quick shot"; `grantsAbility: 'ability.crossbow-snapshot'` id unchanged (internal, fine).
- `perk.crossbow-75` **Gürtelhaken-Drill** ✓ — belt-hook + stirrup spanning is exactly LORE §7's Act-1 Armbrust; `historical: true` is correct; registered in §10 ✓. The word "windlass" now appears only in `item.armbrust`'s dev-facing `note` (as the thing excluded) ✓.
- `perk.crossbow-100` **Aimed Shot** ✓ (moved from 75; no anachronism). Design note, not compliance: §5.3 lists *Aimed shot* as a base ranged action, so a level-100 capstone that merely grants it would be hollow — see issue 3.
- `perk.unarmed-75` **Schwingerwurf** ✓ — Schwingen is the attested Alpine wrestling tradition (§8 register: Alemannic).
- `perk.armor-heavy-50` **Plattenrock** ✓ — the coat-of-plates' own German name; "plate" no longer stands alone.
- All other 46 perks unchanged: Hook / Wall of Iron / Eidgenoss → §5.5; the rest → §10 blanket row ✓. Every perk has `historical` + `note` (test `party.test.ts:48–58`).
- Nit: five `note` fields now carry changelog text ("critic fix round 1, issue 9 …"). Notes are dev-facing, so not a compliance problem, but the note's job is the period justification; the changelog belongs in git.

**LORE §10 rows (6 appended)** — each names the id(s), what, "party builder", and a justification that matches the `note` fields; the lance row correctly restricts it to Habsburg kit; the crossbow row documents the rename. Append-only respected ✓.

**Archetypes (23), Skills (19)** — unchanged, compliant as in round 1.

## Ranked issues (if FAIL, or notable even on PASS)

1. **Regression: sling stones can no longer be equipped — the herder starts with no ammo loaded.** The new ammo rule (`index.ts:445–450`) requires `rangedDef.weapon.ammo === def.id`, but `item.sling` (`items.ts:86–87`) declares `properties: ['thrown']`, `range`, and **no `ammo`**. `createPlayer('herder')` therefore ends with `Equipment { mainHand, ranged }`, `derived().ammo === null` and 15 stones sitting in the pack (probe L); the `herder` archetype loses its `ammo` slot the same way (probe L2). The kit test passes because it only asserts `eq.mainHand || eq.ranged` (`party.test.ts:186–192`). — evidence: probe L/L2 output above. — fix: add `ammo: 'item.sling-stones'` to `item.sling`'s `WeaponDef` (one line; §3.3 allows `ammo?` on any weapon), and tighten the kit test to assert every slot named in `STARTING_KITS[background].equip` is populated after `createPlayer` (and the same for each archetype's `equipment` map after `createCharacter`) — that would have caught this and will catch the next content/rule mismatch.

2. **`bumpSkillLevel` still emits `level-up` before the character level is recomputed.** Issue 14's reordering was applied to `grantSkillXp` (`index.ts:325–327`) but `applyChapter` → `bumpSkillLevel` (`index.ts:343–356`) emits first and `recomputeCharacterLevel` runs after the loop (`index.ts:775`). Probe N happened not to change the character level, so no stale value surfaced, but a chapter bump that crosses a level boundary would. — fix: move `this.recomputeCharacterLevel(id)` inside `applyChapter` to before the `for … bumpSkillLevel` emits — simplest is to have `bumpSkillLevel` collect events and let `applyChapter` recompute, then emit.

3. **Crossbow capstone/75 mechanics are hollow in Act 1.** `Gürtelhaken-Drill` gives `reloadStep: -1` "a bonus action instead of a full one", but every Act 1 crossbow is already `reload-1` (bonus action); and `Aimed Shot` at 100 grants an ability §5.3 treats as a base ranged action. Neither is a compliance problem; both are perks the player will take and feel nothing. — fix (content, no rules change): describe `reloadStep: -1` as stepping the ladder *full → bonus → free* ("the belt-hook Armbrust reloads as a free action once per turn") and tell the combat builder so; make the 100 capstone a real upgrade — e.g. Aimed Shot no longer forfeits movement, or grants double Edge — and rename accordingly ("Tells Auge" would be on-lore).

4. **`addItem` with an unknown `defId` still creates a phantom item after warning** (`index.ts:527–528`; probe O: `item.does-not-exist` ×2 lands in the inventory and `countItem` reports 2). A misspelt quest reward would ship a nameless, weightless item. — fix: after the warning `return { instanceId: '', defId, qty: 0 }` without touching the inventory, or throw in dev builds.

5. **`addItem`'s era-gate warning goes to `console.warn`** (`index.ts:531–533`). The harness counts console warnings (`warn=0` is part of the pass line); a quest that legitimately grants Chapter-2 loot early (the Langspiess "training item") will turn a scenario yellow. — fix: downgrade to `console.debug`, or emit an `item-added` with a flag and let UI toast it.

Minor / notable on PASS:
- `rules.speedM` is still dead code duplicated inline (`index.ts:751`); delete it.
- The fingerprint makes the cache almost redundant (it re-reads everything each call). That is fine — 16.9 ms / 2 000 calls — but it means `invalidate()` is now belt-and-braces; keep the public hook (combat may edit `Combatant` status effects that a future fingerprint should include), just document that it is optional.
- A save written by the round-1 build (`PartyState` without `nextItemSeq`) would load with `nextItemSeq = 1` from defaults; ids do not collide only because the old format was `item-<owner>-<n>`. Pre-release, so not counted; the save module's migration list is the place if it ever matters.
- Two `console.warn` paths and no `console.error` in the module ✓.
- Untracked `debug3.mjs`, `debug_harness.mjs`, `debug_harness2.mjs` in the repo root are not party's (world builder's scratch) — for the integrator.

## Explicitly out of reach for a browser engine (not counted against the score)
- Rendering of the character/inventory/perk screens is Wave 3 (`ui`); their absence is not penalised. The harness `title` scenario proves error-free registration only; there is still no screenshot of a level-up toast or a stat delta — the score rests on unit-test and probe evidence, which is the best available until Wave 3.
- Fatigue is stored, drained by `rest()` and now part of the derived fingerprint, but nothing consumes it (marching/combat fatigue gain is exploration/combat work); the 10/10 "encumbrance and fatigue that matter" waits on those modules.
- Companion ageing across time-skips (`born` stored; `applyChapter` bumps skills, computes no age) needs the quest builder's chapter ids — `CHAPTER_ORDER` in party is the first place those ids are written down; the quest builder must adopt the same strings (`prologue-1291`, `ch1-1307`, `ch2-1314`) or era gating silently degrades to "always allowed" (`chapterIndex` treats unknown ids as latest).
