/** Effect DSL runner. ARCHITECTURE.md §5.4. Pure(ish) function over a `Runtime`. */
import type { Effect } from '@core/dsl';
import type { Runtime } from './runtime';

export async function runEffect(effect: Effect, rt: Runtime): Promise<void> {
  if ('setFlag' in effect) {
    const [k, v] = effect.setFlag;
    rt.setFlag(k, v);
    return;
  }
  if ('quest' in effect) {
    const [op, qid, stage] = effect.quest;
    await rt.questOp(op, qid, stage);
    return;
  }
  if ('setVar' in effect) {
    const [qid, k, v] = effect.setVar;
    rt.setVar(qid, k, v);
    return;
  }
  if ('rep' in effect) {
    const [faction, delta] = effect.rep;
    rt.changeRep(faction, delta, 'story');
    return;
  }
  if ('giveItem' in effect) {
    const [itemId, qty] = effect.giveItem;
    rt.giveItem(itemId, qty);
    return;
  }
  if ('takeItem' in effect) {
    const [itemId, qty] = effect.takeItem;
    rt.takeItem(itemId, qty);
    return;
  }
  if ('pfennig' in effect) {
    rt.addPfennig(effect.pfennig);
    return;
  }
  if ('skillXp' in effect) {
    const [skill, amount] = effect.skillXp;
    rt.skillXp(skill, amount);
    return;
  }
  if ('encounter' in effect) {
    const result = await rt.runEncounter(effect.encounter);
    rt.setVar('_system', 'lastCombat.outcome', result.outcome);
    rt.setVar('_system', 'lastCombat.dead', result.dead.length);
    rt.setVar('_system', 'lastCombat.downed', result.downed.length);
    return;
  }
  if ('teleport' in effect) {
    rt.teleport(effect.teleport);
    return;
  }
  if ('addCompanion' in effect) {
    rt.addCompanion(effect.addCompanion);
    return;
  }
  if ('removeCompanion' in effect) {
    rt.removeCompanion(effect.removeCompanion);
    return;
  }
  if ('cutscene' in effect) {
    await rt.runCutsceneById(effect.cutscene);
    return;
  }
  if ('advanceTime' in effect) {
    rt.advanceTime(effect.advanceTime);
    return;
  }
  if ('setChapter' in effect) {
    await rt.setChapterAsync(effect.setChapter);
    return;
  }
  if ('setTime' in effect) {
    const [y, m, d, h] = effect.setTime;
    rt.setTimeExact(y, m, d, h);
    return;
  }
  if ('toast' in effect) {
    rt.toast(effect.toast);
    return;
  }
  if ('journal' in effect) {
    rt.addJournalEntry(effect.journal);
    return;
  }
  if ('discover' in effect) {
    rt.discoverPoi(effect.discover);
    return;
  }
  if ('npcMove' in effect) {
    const [npcId, poiId] = effect.npcMove;
    rt.npcMove(npcId, poiId);
    return;
  }
  if ('npcRemove' in effect) {
    rt.npcRemove(effect.npcRemove);
    return;
  }
  if ('dialogue' in effect) {
    await rt.runDialogueById(effect.dialogue);
    return;
  }
  if ('rest' in effect) {
    rt.restParty(effect.rest);
    return;
  }
  if ('music' in effect) {
    rt.setMusic(effect.music);
    return;
  }
  if ('end' in effect) {
    rt.endAct(effect.end);
    return;
  }
  // Exhaustiveness guard: every Effect variant is handled above.
  const _exhaustive: never = effect;
  void _exhaustive;
}

export async function runEffects(effects: Effect[] | undefined, rt: Runtime): Promise<void> {
  if (!effects) return;
  for (const e of effects) await runEffect(e, rt);
}
