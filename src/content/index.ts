/** Content aggregation. Each content file registers itself; builders add imports here in their own section. */
import type { ContentRegistry } from '@core/content';

export function loadContent(_c: ContentRegistry): void {
  // Wave 1: geography (world builder) registers regions.
  // Wave 2: items/skills/perks (party), abilities/encounters (combat), pois/npcs (exploration).
  // Wave 3: factions/quests/dialogues/cutscenes (quest + act1 content).
}
