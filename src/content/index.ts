/**
 * Content aggregation. Each builder fills in its own file(s) and its own `register*` call below stays as written.
 * Files export `registerX(c)` functions; keep this file's shape — the integrator owns it.
 */
import type { ContentRegistry } from '@core/content';
import * as geography from './geography';
import * as skills from './skills';
import * as perks from './perks';
import * as items from './items';
import * as abilities from './abilities';
import * as archetypes from './archetypes';
import * as encounters from './encounters';
import * as pois from './pois';
import * as npcs from './npcs';
import * as factions from './factions';
import * as strings from './strings';
import * as quests from './quests';
import * as dialogues from './dialogues';
import * as cutscenes from './cutscenes';

type Reg = { register?: (c: ContentRegistry) => void };
const mods: Reg[] = [geography, factions, skills, perks, items, abilities, archetypes, pois, npcs, encounters, quests, dialogues, cutscenes, strings];

export function loadContent(c: ContentRegistry): void {
  for (const m of mods) m.register?.(c);
}
