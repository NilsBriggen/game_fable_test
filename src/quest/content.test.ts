import { describe, it, expect } from 'vitest';
import { ContentRegistry } from '@core/content';
import { register as registerFactions } from '@content/factions';
import { register as registerQuests } from '@content/quests/index';
import { register as registerDialogues } from '@content/dialogues/index';
import { register as registerCutscenes } from '@content/cutscenes/index';
import { register as registerSkills } from '@content/skills';
import { register as registerItems } from '@content/items';
import { register as registerAbilities } from '@content/abilities';
import { register as registerArchetypes } from '@content/archetypes';
import { register as registerGeography } from '@content/geography';
import { register as registerPois } from '@content/pois';
import { register as registerNpcs } from '@content/npcs';
import { register as registerEncounters } from '@content/encounters';

describe('ContentRegistry.validate() with the full game content', () => {
  it('reports zero problems across every content file (quest, dialogue, faction defs included)', () => {
    const c = new ContentRegistry();
    registerGeography(c);
    registerFactions(c);
    registerSkills(c);
    registerItems(c);
    registerAbilities(c);
    registerArchetypes(c);
    registerPois(c);
    registerNpcs(c);
    registerEncounters(c);
    registerQuests(c);
    registerDialogues(c);
    registerCutscenes(c);
    const problems = c.validate();
    if (problems.length) console.error(problems.join('\n'));
    expect(problems).toEqual([]);
  });
});
