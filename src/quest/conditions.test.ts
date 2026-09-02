import { describe, it, expect } from 'vitest';
import { evaluateCondition } from './conditions';
import type { RuntimeReads } from './runtime';

function fakeReads(overrides: Partial<RuntimeReads> = {}): RuntimeReads {
  return {
    getFlag: () => undefined,
    getStage: () => null,
    isStarted: () => false,
    isDone: () => false,
    getVar: () => undefined,
    getRep: () => 0,
    getChapter: () => 'prologue-1291',
    getOrigin: () => 'uri',
    isDiscovered: () => false,
    getPfennig: () => 0,
    getSkillLevel: () => 0,
    hasItem: () => false,
    hasCompanion: () => false,
    getHour: () => 12,
    ...overrides,
  };
}

describe('evaluateCondition', () => {
  it('undefined condition is always true', () => {
    expect(evaluateCondition(undefined, fakeReads())).toBe(true);
  });

  it('all / any / not compose', () => {
    const rt = fakeReads({ getFlag: (k) => (k === 'a' ? true : undefined) });
    expect(evaluateCondition({ all: [{ flag: 'a' }, { not: { flag: 'b' } }] }, rt)).toBe(true);
    expect(evaluateCondition({ all: [{ flag: 'a' }, { flag: 'b' }] }, rt)).toBe(false);
    expect(evaluateCondition({ any: [{ flag: 'b' }, { flag: 'a' }] }, rt)).toBe(true);
    expect(evaluateCondition({ not: { flag: 'a' } }, rt)).toBe(false);
  });

  it('flag: truthy check and explicit eq', () => {
    const rt = fakeReads({ getFlag: (k) => (k === 'x' ? 'y' : undefined) });
    expect(evaluateCondition({ flag: 'x' }, rt)).toBe(true);
    expect(evaluateCondition({ flag: 'x', eq: 'y' }, rt)).toBe(true);
    expect(evaluateCondition({ flag: 'x', eq: 'z' }, rt)).toBe(false);
    expect(evaluateCondition({ flag: 'missing' }, rt)).toBe(false);
  });

  it('questStage / questStarted / questDone', () => {
    const rt = fakeReads({ getStage: (id) => (id === 'quest.a' ? 'stage1' : null), isStarted: (id) => id === 'quest.a', isDone: (id) => id === 'quest.b' });
    expect(evaluateCondition({ questStage: ['quest.a', 'stage1'] }, rt)).toBe(true);
    expect(evaluateCondition({ questStage: ['quest.a', 'stage2'] }, rt)).toBe(false);
    expect(evaluateCondition({ questStarted: 'quest.a' }, rt)).toBe(true);
    expect(evaluateCondition({ questStarted: 'quest.c' }, rt)).toBe(false);
    expect(evaluateCondition({ questDone: 'quest.b' }, rt)).toBe(true);
  });

  it('rep with >= and <', () => {
    const rt = fakeReads({ getRep: () => -50 });
    expect(evaluateCondition({ rep: ['habsburg', '>=', -60] }, rt)).toBe(true);
    expect(evaluateCondition({ rep: ['habsburg', '>=', -40] }, rt)).toBe(false);
    expect(evaluateCondition({ rep: ['habsburg', '<', -40] }, rt)).toBe(true);
  });

  it('skill, hasItem, hasCompanion, pfennig', () => {
    const rt = fakeReads({ getSkillLevel: () => 30, hasItem: (id, qty) => id === 'item.spiess' && qty <= 2, hasCompanion: (id) => id === 'npc.jost-imhof', getPfennig: () => 15 });
    expect(evaluateCondition({ skill: ['spear', '>=', 25] }, rt)).toBe(true);
    expect(evaluateCondition({ skill: ['spear', '>=', 35] }, rt)).toBe(false);
    expect(evaluateCondition({ hasItem: ['item.spiess', 2] }, rt)).toBe(true);
    expect(evaluateCondition({ hasItem: ['item.spiess'] }, rt)).toBe(true);
    expect(evaluateCondition({ hasCompanion: 'npc.jost-imhof' }, rt)).toBe(true);
    expect(evaluateCondition({ hasCompanion: 'npc.wilhelm-tell' }, rt)).toBe(false);
    expect(evaluateCondition({ pfennig: ['>=', 10] }, rt)).toBe(true);
    expect(evaluateCondition({ pfennig: ['>=', 20] }, rt)).toBe(false);
  });

  it('chapter, origin, discovered, timeOfDay (incl. wrap)', () => {
    const rt = fakeReads({ getChapter: () => 'ch1-1307', getOrigin: () => 'schwyz', isDiscovered: (id) => id === 'poi.ruetli', getHour: () => 23 });
    expect(evaluateCondition({ chapter: 'ch1-1307' }, rt)).toBe(true);
    expect(evaluateCondition({ chapter: 'ch2-1314' }, rt)).toBe(false);
    expect(evaluateCondition({ origin: 'schwyz' }, rt)).toBe(true);
    expect(evaluateCondition({ origin: 'uri' }, rt)).toBe(false);
    expect(evaluateCondition({ discovered: 'poi.ruetli' }, rt)).toBe(true);
    expect(evaluateCondition({ discovered: 'poi.altdorf' }, rt)).toBe(false);
    expect(evaluateCondition({ timeOfDay: [22, 6] }, rt)).toBe(true); // wraps past midnight, hour=23
    expect(evaluateCondition({ timeOfDay: [6, 18] }, rt)).toBe(false);
  });

  it('var compares by strict equality', () => {
    const rt = fakeReads({ getVar: (qid, k) => (qid === 'quest.a' && k === 'x' ? 3 : undefined) });
    expect(evaluateCondition({ var: ['quest.a', 'x', 3] }, rt)).toBe(true);
    expect(evaluateCondition({ var: ['quest.a', 'x', 4] }, rt)).toBe(false);
  });
});
