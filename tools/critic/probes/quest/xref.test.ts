/**
 * Critic probe — cross-references quest/dialogue/cutscene content ids that
 * `ContentRegistry.validate()` (src/core/content.ts) does NOT check: `Effect`/`QuestCondition`
 * payload ids (quest ids in {quest:...}/{questStage}/{questStarted}/{questDone}/{var}, dialogue
 * ids in {dialogue}/cutscene-step.dialogue, cutscene ids in {cutscene}, poi ids in
 * {teleport}/{npcMove}/{nearPoi}/{discover}/stage.marker, npc ids in
 * {addCompanion}/{removeCompanion}/{npcMove}/{npcRemove}/{hasCompanion}/{talkedTo}, item ids in
 * {giveItem}/{takeItem}/{hasItem}) against the real content registry. Also flags dialogue nodes
 * whose *every* choice is conditioned (no unconditional escape) as a "possible dead end" — real
 * reachability of that state is a separate, deeper check; this is a cheap first pass.
 */
import { describe, it, expect } from 'vitest';
import { ContentRegistry } from '@core/content';
import type { Effect, QuestCondition } from '@core/dsl';
import type { DialogueDef, QuestDef, CutsceneDef } from '@core/schemas';
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

function makeContent(): ContentRegistry {
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
  return c;
}

function walkEffects(effects: Effect[] | undefined, cb: (e: Effect) => void): void {
  for (const e of effects ?? []) cb(e);
}
function walkCondition(cond: QuestCondition | undefined, cb: (c: QuestCondition) => void): void {
  if (!cond) return;
  cb(cond);
  if ('all' in cond) for (const c of cond.all) walkCondition(c, cb);
  if ('any' in cond) for (const c of cond.any) walkCondition(c, cb);
  if ('not' in cond) walkCondition(cond.not, cb);
}

describe('quest/dialogue/cutscene content id cross-references (beyond ContentRegistry.validate())', () => {
  const c = makeContent();
  expect(c.validate()).toEqual([]); // sanity: the checks validate() *does* run must already be clean

  const problems: string[] = [];

  function checkEffect(e: Effect, where: string): void {
    if ('quest' in e && !c.quests.has(e.quest[1])) problems.push(`${where}: effect quest op references unknown quest "${e.quest[1]}"`);
    if ('setVar' in e && !c.quests.has(e.setVar[0]) && e.setVar[0] !== '_system' && e.setVar[0] !== '_dialogue') problems.push(`${where}: setVar references unknown quest "${e.setVar[0]}"`);
    if ('dialogue' in e && !c.dialogues.has(e.dialogue)) problems.push(`${where}: effect references unknown dialogue "${e.dialogue}"`);
    if ('cutscene' in e && !c.cutscenes.has(e.cutscene)) problems.push(`${where}: effect references unknown cutscene "${e.cutscene}"`);
    if ('teleport' in e && !c.pois.has(e.teleport)) problems.push(`${where}: teleport references unknown poi "${e.teleport}"`);
    if ('discover' in e && !c.pois.has(e.discover)) problems.push(`${where}: discover references unknown poi "${e.discover}"`);
    if ('npcMove' in e) {
      const [npc, poi] = e.npcMove;
      if (!c.npcs.has(npc)) problems.push(`${where}: npcMove references unknown npc "${npc}"`);
      if (!c.pois.has(poi)) problems.push(`${where}: npcMove references unknown poi "${poi}"`);
    }
    if ('npcRemove' in e && !c.npcs.has(e.npcRemove)) problems.push(`${where}: npcRemove references unknown npc "${e.npcRemove}"`);
    if ('addCompanion' in e && !c.npcs.has(e.addCompanion)) problems.push(`${where}: addCompanion references unknown npc "${e.addCompanion}"`);
    if ('removeCompanion' in e && !c.npcs.has(e.removeCompanion)) problems.push(`${where}: removeCompanion references unknown npc "${e.removeCompanion}"`);
    if ('giveItem' in e && !c.items.has(e.giveItem[0])) problems.push(`${where}: giveItem references unknown item "${e.giveItem[0]}"`);
    if ('takeItem' in e && !c.items.has(e.takeItem[0])) problems.push(`${where}: takeItem references unknown item "${e.takeItem[0]}"`);
    if ('rep' in e && !c.factions.has(e.rep[0])) problems.push(`${where}: rep references unknown faction "${e.rep[0]}"`);
    if ('skillXp' in e && !c.skills.has(e.skillXp[0])) problems.push(`${where}: skillXp references unknown skill "${e.skillXp[0]}"`);
    if ('encounter' in e && !c.encounters.has(e.encounter)) problems.push(`${where}: encounter references unknown encounter "${e.encounter}"`);
  }

  function checkCondition(cond: QuestCondition, where: string): void {
    if ('questStage' in cond && !c.quests.has(cond.questStage[0])) problems.push(`${where}: questStage references unknown quest "${cond.questStage[0]}"`);
    if ('questStarted' in cond && !c.quests.has(cond.questStarted)) problems.push(`${where}: questStarted references unknown quest "${cond.questStarted}"`);
    if ('questDone' in cond && !c.quests.has(cond.questDone)) problems.push(`${where}: questDone references unknown quest "${cond.questDone}"`);
    if ('var' in cond && !c.quests.has(cond.var[0]) && cond.var[0] !== '_system' && cond.var[0] !== '_dialogue') problems.push(`${where}: var references unknown quest "${cond.var[0]}"`);
    if ('hasItem' in cond && !c.items.has(cond.hasItem[0])) problems.push(`${where}: hasItem references unknown item "${cond.hasItem[0]}"`);
    if ('hasCompanion' in cond && !c.npcs.has(cond.hasCompanion)) problems.push(`${where}: hasCompanion references unknown npc "${cond.hasCompanion}"`);
    if ('nearPoi' in cond && !c.pois.has(cond.nearPoi[0])) problems.push(`${where}: nearPoi references unknown poi "${cond.nearPoi[0]}"`);
    if ('rep' in cond && !c.factions.has(cond.rep[0])) problems.push(`${where}: rep condition references unknown faction "${cond.rep[0]}"`);
    if ('skill' in cond && !c.skills.has(cond.skill[0])) problems.push(`${where}: skill condition references unknown skill "${cond.skill[0]}"`);
    if ('talkedTo' in cond && !c.npcs.has(cond.talkedTo)) problems.push(`${where}: talkedTo references unknown npc "${cond.talkedTo}"`);
    if ('inRegion' in cond && !c.regions.has(cond.inRegion)) problems.push(`${where}: inRegion references unknown region "${cond.inRegion}"`);
  }

  // ---- quests ----
  for (const q of c.quests.values() as Iterable<QuestDef>) {
    walkEffects(q.onStart, (e) => checkEffect(e, `quest ${q.id} onStart`));
    walkEffects(q.onComplete, (e) => checkEffect(e, `quest ${q.id} onComplete`));
    walkEffects(q.onFail, (e) => checkEffect(e, `quest ${q.id} onFail`));
    for (const s of q.stages) {
      walkEffects(s.onEnter, (e) => checkEffect(e, `quest ${q.id} stage ${s.id} onEnter`));
      if (typeof s.marker === 'string' && !c.pois.has(s.marker)) problems.push(`quest ${q.id} stage ${s.id}: marker references unknown poi "${s.marker}"`);
      for (const a of s.advanceWhen ?? []) walkCondition(a.cond, (cc) => checkCondition(cc, `quest ${q.id} stage ${s.id} advanceWhen->${a.to}`));
    }
  }

  // ---- dialogues ----
  for (const d of c.dialogues.values() as Iterable<DialogueDef>) {
    if (typeof d.root !== 'string') for (const r of d.root) walkCondition(r.condition, (cc) => checkCondition(cc, `dialogue ${d.id} root condition`));
    for (const [nid, n] of Object.entries(d.nodes)) {
      walkEffects(n.effects, (e) => checkEffect(e, `dialogue ${d.id} node ${nid} effects`));
      for (const v of n.variants ?? []) walkCondition(v.condition, (cc) => checkCondition(cc, `dialogue ${d.id} node ${nid} variant condition`));
      for (const [ci, ch] of (n.choices ?? []).entries()) {
        walkCondition(ch.condition, (cc) => checkCondition(cc, `dialogue ${d.id} node ${nid} choice[${ci}] condition`));
        walkEffects(ch.effects, (e) => checkEffect(e, `dialogue ${d.id} node ${nid} choice[${ci}] effects`));
        if (ch.check && !d.nodes[ch.check.fail]) problems.push(`dialogue ${d.id} node ${nid} choice[${ci}]: check.fail references missing node "${ch.check.fail}" (should be caught by validate() too)`);
      }
      // Dead-end heuristic: every choice on this node is conditioned (none unconditional and none
      // `showDisabled`-free-fallback) — flag for manual review, not a hard failure by itself.
      if (n.choices && n.choices.length > 0) {
        const allConditioned = n.choices.every((ch) => !!ch.condition);
        if (allConditioned) problems.push(`WARN dialogue ${d.id} node ${nid}: every choice is conditioned — no guaranteed-enabled fallback (verify at least one condition is always satisfiable)`);
      }
    }
  }

  // ---- cutscenes ----
  for (const cs of c.cutscenes.values() as Iterable<CutsceneDef>) {
    for (const [i, step] of cs.steps.entries()) {
      if (step.dialogue && !c.dialogues.has(step.dialogue)) problems.push(`cutscene ${cs.id} step[${i}]: dialogue references unknown dialogue "${step.dialogue}"`);
      walkEffects(step.effects, (e) => checkEffect(e, `cutscene ${cs.id} step[${i}] effects`));
    }
  }

  const hard = problems.filter((p) => !p.startsWith('WARN'));
  const warn = problems.filter((p) => p.startsWith('WARN'));

  it('has no dangling cross-references beyond what ContentRegistry.validate() already covers', () => {
    if (hard.length) console.error(hard.join('\n'));
    expect(hard).toEqual([]);
  });

  it('reports dead-end-heuristic warnings for manual review (not a failure)', () => {
    if (warn.length) console.log(warn.join('\n'));
    expect(true).toBe(true);
  });
});
