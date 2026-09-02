/** Condition DSL evaluator. ARCHITECTURE.md §5.4. Pure function over a `RuntimeReads`. */
import type { QuestCondition } from '@core/dsl';
import type { RuntimeReads } from './runtime';

export function evaluateCondition(cond: QuestCondition | undefined, rt: RuntimeReads): boolean {
  if (!cond) return true;
  if ('all' in cond) return cond.all.every((c) => evaluateCondition(c, rt));
  if ('any' in cond) return cond.any.some((c) => evaluateCondition(c, rt));
  if ('not' in cond) return !evaluateCondition(cond.not, rt);
  if ('flag' in cond) {
    const v = rt.getFlag(cond.flag);
    return 'eq' in cond ? v === cond.eq : !!v;
  }
  if ('questStage' in cond) {
    const [qid, stage] = cond.questStage;
    return rt.getStage(qid) === stage;
  }
  if ('questStarted' in cond) return rt.isStarted(cond.questStarted);
  if ('questDone' in cond) return rt.isDone(cond.questDone);
  if ('rep' in cond) {
    const [faction, op, value] = cond.rep;
    const v = rt.getRep(faction);
    return op === '>=' ? v >= value : v < value;
  }
  if ('skill' in cond) {
    const [skill, , value] = cond.skill;
    return rt.getSkillLevel(skill) >= value;
  }
  if ('hasItem' in cond) {
    const [itemId, qty] = cond.hasItem;
    return rt.hasItem(itemId, qty ?? 1);
  }
  if ('hasCompanion' in cond) return rt.hasCompanion(cond.hasCompanion);
  if ('chapter' in cond) return rt.getChapter() === cond.chapter;
  if ('timeOfDay' in cond) {
    const [lo, hi] = cond.timeOfDay;
    const h = rt.getHour();
    return lo <= hi ? h >= lo && h < hi : h >= lo || h < hi; // wraps past midnight
  }
  if ('var' in cond) {
    const [qid, key, value] = cond.var;
    return rt.getVar(qid, key) === value;
  }
  if ('origin' in cond) return rt.getOrigin() === cond.origin;
  if ('discovered' in cond) return rt.isDiscovered(cond.discovered);
  if ('pfennig' in cond) {
    const [, value] = cond.pfennig;
    return rt.getPfennig() >= value;
  }
  if ('nearPoi' in cond) {
    const [poiId, radiusM] = cond.nearPoi;
    const p = rt.playerPosition();
    const poi = rt.poiPosition(poiId);
    if (!p || !poi) return false;
    const dx = p.x - poi.x;
    const dz = p.z - poi.z;
    return dx * dx + dz * dz <= radiusM * radiusM;
  }
  if ('inRegion' in cond) {
    const p = rt.playerPosition();
    if (!p) return false;
    return rt.regionIdAt(p.x, p.z) === cond.inRegion;
  }
  if ('talkedTo' in cond) return !!rt.getFlag(`talked:${cond.talkedTo}`);
  // Exhaustiveness guard: every QuestCondition variant is handled above.
  const _exhaustive: never = cond;
  return _exhaustive;
}
