# quest-2: canonical encounter → quest/stage map, and a var for the Morgarten cache count

**Do not edit `src/exploration`** — this is a request for the exploration builder / integrator, not
something I'm allowed to touch. Two asks below.

## 1. Canonical `(encounterId → questId, stageId)` map

Fix round 1, critic issue 10 (`tools/critic/wave3-quest.md`): `src/exploration/poi.ts` currently gates
its five Act-1 `EncounterTrigger`s on stage ids (`escort-brunnen`, `quest.der-hut-auf-der-stange/
square-confrontation`, `hohle-gasse-ambush`, `abbey-gate`) that don't match anything `src/quest` defines.
The quest module fires all five of these encounters itself, directly, via `{encounter: id}` effects on
the owning quest stage's `onEnter` — so an exploration `EncounterTrigger` covering the same encounter id
would **double-invoke `combat.start()`** if it also calls into combat. The canonical ids, current as of
this fix round (travel/arrival stages were added around each of these — the encounter-firing stage id
itself did not change):

| Encounter | Owning quest | Stage that fires it (`onEnter: [{encounter: '<id>'}]`) |
|---|---|---|
| `enc.brunnen-quay` | `quest.der-eid` | `escort` |
| `enc.altdorf-square` | *(fired from `dlg.gessler-hat`'s `confronted → fight` choice, not a quest-stage `onEnter` directly)* | reached only when `quest.der-hut` is on stage `altdorf-pole` |
| `enc.hohle-gasse` | `quest.der-hut` | `hohle-gasse` |
| `enc.einsiedeln-gate` | `quest.marchenstreit` | `raid` |
| `enc.morgarten` | `quest.morgarten` | `battle` |

**Recommendation:** either (a) remove these five `EncounterTrigger`s from `pois.ts`/wherever they're
placed and let the quest module's own `{encounter}` effect be the sole trigger (simplest, no
double-fire risk), or (b) if a *visual* proximity trigger is still wanted (e.g. to auto-turn the camera,
play ambient audio), gate it on `condition: {questStage: [questId, stageId]}` from the table above **and**
make sure it does not itself call `CombatService.start` — the quest module already does.

## 2. `hunenberg-warning` — Morgarten needs to read it

Fix round 1, critic issue 7: `quest.muster-1315`'s `hunenberg` stage (`src/content/quests/act1/
muster-1315.ts`, via `dlg.heinrich-von-hunenberg` in `src/content/dialogues/named-cast.ts`) now sets a
global flag via `{setFlag: ['hunenberg-warning', true | false]}` depending on whether the player trusts
Heinrich von Hünenberg's warning arrow. LORE.md §6 step 11 says distrusting it should mean "fewer boulder
caches" at Morgarten. `enc.morgarten` (owned by the combat/content builder, not me) does not currently
read this flag at all.

**Ask:** when building/tuning `enc.morgarten`'s `terrainFeatures` (`boulder-cache` kind) or its
`scripted` events, read `quest.getFlag('hunenberg-warning')` (via `ctx.services.get('quest')`) at
encounter-setup time and reduce the boulder-cache count (or their `uses`) when it is `false`. The flag is
a plain boolean, already set well before `quest.morgarten` starts (it's set during the preceding
`quest.muster-1315`), so it will always be defined by the time `enc.morgarten` is built — no ordering
concern on your end.
