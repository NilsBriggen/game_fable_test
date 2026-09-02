/**
 * skills — content data owned by the party builder. ARCHITECTURE.md §5.5: 19 use-based skills, 0–100,
 * governing attribute used by `party/rules.ts` for attack/defense math, group used by the character-sheet UI.
 */
import type { ContentRegistry } from '@core/content';
import type { SkillDef } from '@core/schemas';

export const skills: SkillDef[] = [
  // ---- weapon skills ----
  {
    id: 'halberd', name: 'Halberd', attribute: 'strength', group: 'weapon',
    description: 'The Sempach-style Halbarte: axe blade, spike and hook on a two-metre haft. The Confederates\' signature weapon.',
  },
  {
    id: 'spear', name: 'Spear', attribute: 'strength', group: 'weapon',
    description: 'The Spiess: every peasant\'s first weapon, thrust from behind a shield or braced against a charge.',
  },
  {
    id: 'sword', name: 'Sword', attribute: 'strength', group: 'weapon',
    description: 'Arming sword, longsword and messer — the freeman\'s and the knight\'s sidearm and duelling blade alike.',
  },
  {
    id: 'dagger', name: 'Dagger', attribute: 'agility', group: 'weapon',
    description: 'The Basler Dolch and its kin: a close, quick blade for the second line of defence.',
  },
  {
    id: 'axe-mace', name: 'Axe & Mace', attribute: 'strength', group: 'weapon',
    description: 'Woodsman\'s axes and the spiked Morgenstern club — blunt and hewing force against mail.',
  },
  {
    id: 'shield', name: 'Shield', attribute: 'strength', group: 'weapon',
    description: 'Heater shield and buckler: active blocking, shoving and covering a neighbour in the line.',
  },
  {
    id: 'crossbow', name: 'Crossbow', attribute: 'agility', group: 'weapon',
    description: 'The stirrup-and-belt-hook Armbrust, Tell\'s weapon: slow to load, deadly at range.',
  },
  {
    id: 'throwing', name: 'Throwing', attribute: 'agility', group: 'weapon',
    description: 'Sling stones and thrown hand axes, and the rolling of rocks and trunks from high ground.',
  },
  {
    id: 'unarmed', name: 'Unarmed', attribute: 'agility', group: 'weapon',
    description: 'Wrestling and the fist — the last resort, and how village Landsgemeinde disputes are settled short of blades.',
  },
  // ---- armour skills ----
  {
    id: 'armor-light', name: 'Light Armour', attribute: 'agility', group: 'armor',
    description: 'Wearing gambeson and leather without losing the wind or the reach to move.',
  },
  {
    id: 'armor-heavy', name: 'Heavy Armour', attribute: 'endurance', group: 'armor',
    description: 'Bearing mail and coat-of-plates: a knight\'s or a wealthy freeman\'s burden, carried without stumbling.',
  },
  // ---- body skills ----
  {
    id: 'athletics', name: 'Athletics', attribute: 'agility', group: 'body',
    description: 'Climbing the Axen path, swimming the Urnersee, keeping your feet on scree and ice.',
  },
  {
    id: 'stealth', name: 'Stealth', attribute: 'agility', group: 'body',
    description: 'Moving unseen and unheard — through a Habsburg camp, a sleeping village, or a monastery cloister.',
  },
  {
    id: 'alpine', name: 'Alpine Craft', attribute: 'wits', group: 'body',
    description: 'Reading weather off the Mythen, finding the pass under new snow, judging when a slope will slide.',
  },
  // ---- mind skills ----
  {
    id: 'leadership', name: 'Leadership', attribute: 'presence', group: 'mind',
    description: 'Holding a line\'s morale, rallying the Shaken, forming and keeping the Haufen.',
  },
  {
    id: 'speech', name: 'Speech', attribute: 'presence', group: 'mind',
    description: 'The Landsgemeinde voice: persuading an elder, talking down a bailiff\'s man, striking a bargain.',
  },
  {
    id: 'herbalism', name: 'Herbalism', attribute: 'wits', group: 'mind',
    description: 'Alpine herbs, bandaging and the rest-cure — the difference between a scratch and a lost limb.',
  },
  {
    id: 'craft', name: 'Craft', attribute: 'wits', group: 'mind',
    description: 'Repairing gear, fletching bolts and arrows, mending a letzi wall or a boat.',
  },
  {
    id: 'trade', name: 'Trade', attribute: 'wits', group: 'mind',
    description: 'Knowing what a thing is worth in Pfennig, from Säumer tolls to a Luzern market stall.',
  },
];

export function register(c: ContentRegistry): void {
  c.addSkills(skills);
}
