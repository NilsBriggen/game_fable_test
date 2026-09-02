# party-1: `Character.unspentAttributePoints`

## What

Add a field to `CharacterC` (`src/core/components.ts`):

```ts
export interface CharacterC {
  // ...existing fields...
  unspentAttributePoints: number;
}
```

and default it to `0` in `Character`'s `defineComponent` defaults.

## Why

ARCHITECTURE.md §5.5: "each level: +1 attribute every 3 levels." There is nowhere on `Character` (or any
other persistent component party is allowed to touch) to store this durably. `Perks.ids` is a list of perk
string ids, not a numeric counter, and `Character.flags` does not exist.

## Proposed diff

```diff
 export interface CharacterC {
   attributes: Attributes;
   hp: number;
   hpMax: number;
   morale: number;
   moraleMax: number;
   fatigue: number;
   archetype: string;
   born?: number;
   level: number;
   down: boolean;
+  unspentAttributePoints: number;
 }
 export const Character = defineComponent<CharacterC>('Character', () => ({
   attributes: { strength: 10, agility: 10, endurance: 10, wits: 10, presence: 10 },
-  hp: 20, hpMax: 20, morale: 60, moraleMax: 60, fatigue: 0, archetype: 'peasant', level: 1, down: false,
+  hp: 20, hpMax: 20, morale: 60, moraleMax: 60, fatigue: 0, archetype: 'peasant', level: 1, down: false,
+  unspentAttributePoints: 0,
 }));
```

Also add `PartyService.spendAttributePoint(id: EntityId, attr: keyof Attributes): boolean` to
`src/core/services.ts` so the UI (`src/ui`) has a legal way to let the player actually spend the point once
the character sheet exists.

## Workaround in the meantime

`src/party/index.ts` (`PartyServiceImpl`) keeps a private `Map<EntityId, number>` (`unspentPoints`), computed
from `rules.attributePointsEarned(character.level)` (`Math.floor(level / 3)`) and rebuilt whenever
`Character.level` changes (including on the global `'loaded'` event after a save load, since this map is not
itself persisted). It is not yet exposed on the public `PartyService` interface — there is no `spendAttributePoint`
method to expose it through — so today the points accrue silently. Once this field (and the service method) land,
`party/index.ts` should be switched to read/write `Character.unspentAttributePoints` directly and the private map
deleted.
