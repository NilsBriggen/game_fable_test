# art-2 — drive `CharacterHandle` animations from combat's renderer

> **Status: applied.** The integrator wired this in `src/combat/render.ts` (a `CharacterHandle` per unit,
> `play()` on attack/shoot/hit/down/dead/brace/flee/cheer, idle at turn start) and added `seed` to
> `WorldService.spawnModel`'s options; `src/world/models.ts` now forwards that seed into the character
> factory, so an NPC keeps its look across the 300 m freeze. Kept for the record.

**From:** asset & character art builder · **To:** combat builder / integrator
**File:** `src/combat/render.ts` (not mine to edit) · **API:** `WorldService.spawnCharacter` (`src/core/services.ts`)

## What I need

Combat currently builds unit meshes with `world.spawnModel(u.modelId, { variant })`. Those characters are
already animated (they idle, and they walk when combat moves them), but they cannot swing, flinch or fall
because nobody calls `play()`. Please spawn them through `spawnCharacter` instead and keep the handle:

```ts
const h = world.spawnCharacter?.(u.modelId, { variant: u.mounted ? 'mounted' : undefined, seed: u.entityId });
// h.object goes into the scene exactly where the spawnModel() object went today
```

`spawnCharacter` is optional on the service; when it is absent keep the current `spawnModel` path.
Store the handle beside the mesh in the unit view. Then, on these events:

| combat event | call | notes |
|---|---|---|
| attack resolves (melee) | `await h.play('attack')` | one-shot, resolves when the swing ends — await it before applying the hit visual if you want the numbers to land on contact |
| attack resolves (crossbow) | `await h.play('shoot')` then `h.play('reload')` | `shoot`/`reload` fall back to a throw/use gesture for non-crossbow units |
| unit takes damage but survives | `h.play('hit')` | one-shot, returns to whatever it was doing |
| unit braces / holds the line (spear brace, shield block) | `h.play('brace')` | looping; call `h.play('idle')` to leave it |
| unit is downed (0 HP, not dead) | `h.play('down')` | one-shot, clamps on the last frame |
| unit dies | `h.play('dead')` | holds the death pose indefinitely |
| unit routs / flees | `h.play('flee')` | looping run |
| morale break → cheering victors | `h.play('cheer')` | looping |
| per frame | `h.update(dt)` **not needed** | the world module already ticks every character each frame |
| unit removed from the field | `h.dispose()` | drops the handle and its skeleton |

Movement needs nothing: the character measures how far its owner moved it each frame and blends
idle → walk → run itself. If combat prefers to be explicit, call `h.setSpeed(metresPerSecond)` — the first
`setSpeed` call switches that character to explicit mode permanently.

## Why

Every clip already exists in the pack and is mapped per weapon class (`clipFor` in `src/world/characters.ts`
documents the reuse). Without these calls the tactical layer reads as statues sliding between cells; with
them a Habsburg footman visibly chops, flinches and falls. No change is needed on my side.
