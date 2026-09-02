# Critic rubric

The critic is a non-authoring agent. It never edits `src/`. It runs the harness, reads the screenshots and
`report.json`, reads the module's code and tests, and scores **1–10 against the named reference** for the module's
domain. It writes `tools/critic/wave<N>-<module>.md` using the template below.

## Pass bar (all three required)
1. Score ≥ 8/10 **on harness-captured evidence** (screenshots, draw calls, frame stats, test results). Verbal claims
   in a builder's report count for nothing.
2. Zero console errors and zero page errors in every harness scenario that exercises the module.
3. Content modules: full compliance with `LORE.md` — every named entity traces to §1–§7 or is registered in §10;
   no banned anachronism (§7) is player-facing.

Below the bar → ranked issue list (most damaging first, each with the evidence that shows it and a concrete fix).
The builder gets ≤ 3 fix rounds; after that the integrator escalates into `STATUS.json.escalations`.

## Reference and what "8" means per module

| Module | Reference | 8/10 means (browser-realistic) | 10/10 would be |
|---|---|---|---|
| world | Skyrim: legible landscape, landmarks visible from afar, the map is a place | The Vierwaldstättersee is recognisable from Seelisberg; each valley reads as a distinct region; forests/rock/snow read as such at exploration distance; day/night + weather visibly work; no pop-in storms; draw calls ≤ 1 200 with room for NPCs | Erosion-quality terrain, believable villages in the landscape, atmospheric scattering, seasonal change |
| save | (engineering) | Round-trip is lossless incl. RNG; ≤ 2 MB; migrations tested; autosave/quicksave work; corrupted data never crashes the game | Mid-combat save/restore proven by a harness scenario |
| party | Skyrim: learn-by-doing you can feel | Use-based XP with visible level-ups and perks; equipment changes visibly alter derived stats; items are the LORE §7 list and nothing else | Perk trees with meaningful trade-offs, encumbrance and fatigue that matter |
| exploration | Skyrim: discovery loop | 60+ POIs placed on real geography, discovery toasts + markers, NPCs with schedules in ≥ 6 settlements, interaction prompts, boats/fast travel, terrain-blocking mountains and open passes | Ambient life (herds, boats crossing), NPC chatter, hand-dressed settlements |
| combat | BG3: clarity of action economy, tactical depth without spells | Turn order bar, action/bonus/reaction/move pips, hit-chance %, Edge/Burden shown with sources, verticality and shove, opportunity attacks and brace reactions, morale that ends fights, Haufen formation that demonstrably matters (unit tests prove the bonuses), AI that flanks/charges/holds | Cinematic camera, environmental chain reactions, deterministic replay |
| quest | Skyrim + KCD: quests with choices, factions with memory | Stage machine with conditions, dialogue with skill checks and reputation consequences, journal, faction bands that gate content | Branching that changes later scenes, NPC memory of choices |
| ui | BG3 combat HUD clarity; Skyrim menus | Every screen readable at 1080p, no overlapping text, hover previews in combat, map with markers, save/load with thumbnails | Controller-friendly, animated transitions, portraits |
| act1-content | KCD tone; the LORE spine | Rütlischwur is a played scene with the charter's clauses; Gessler's hat is an encounter with choices; Morgarten is a set piece with rocks, letzi, Haufen, rout; names/places/dates per LORE | Every side quest ties into a historical mechanic (arbitration, alps, tolls) |

## Score sheet template

```
# Wave <N> — <module> — critic score

Reference: <Skyrim | BG3 | KCD | engineering>
Harness run: <timestamp>, renderer: <string>, scenarios: <ids>
Evidence read: <list of PNGs and report fields; tests run and results>

## Score: <n>/10   (pass bar 8)  → PASS | FAIL (round <k>/3)

## What the evidence shows (bullets, cite screenshot or number)

## Historical compliance (content modules)
- <entity> → LORE §<x> | §10 (invented) | VIOLATION

## Ranked issues (if FAIL, or notable even on PASS)
1. <issue> — evidence: <png/number> — fix: <concrete>
2. ...

## Explicitly out of reach for a browser engine (not counted against the score)
- ...
```
