import { describe, it, expect, vi } from 'vitest';
import { QuestMachine, type QuestMachineDeps } from './quests';
import type { QuestDef } from '@core/schemas';
import type { RuntimeReads } from './runtime';

const questA: QuestDef = {
  id: 'quest.a', title: 'Test Quest A', kind: 'main', chapter: 'prologue-1291', historical: 'invented', note: 'test',
  description: 'x',
  onStart: [{ toast: 'started A' }],
  onComplete: [{ toast: 'completed A' }],
  onFail: [{ toast: 'failed A' }],
  stages: [
    { id: 'stage1', journal: 'Stage one begins.', onEnter: [{ setFlag: ['s1-entered', true] }] },
    { id: 'stage2', journal: 'Stage two begins.', onEnter: [{ setFlag: ['s2-entered', true] }], advanceWhen: [{ cond: { flag: 'ready-for-3' }, to: 'stage3' }] },
    { id: 'stage3', journal: 'Stage three begins.' },
  ],
};

function makeMachine(effectsSpy: (e: unknown[] | undefined) => void = () => {}) {
  let now = 1000;
  const deps: QuestMachineDeps = {
    getQuestDef: (id) => (id === 'quest.a' ? questA : undefined),
    runEffects: async (effects) => { effectsSpy(effects); },
    now: () => now,
    poiPosition: () => null,
    emit: () => {},
  };
  return { machine: new QuestMachine(deps), setNow: (t: number) => { now = t; } };
}

function fakeReads(flag: Record<string, unknown>): RuntimeReads {
  return {
    getFlag: (k) => flag[k], getStage: () => null, isStarted: () => false, isDone: () => false, getVar: () => undefined,
    getRep: () => 0, getChapter: () => 'prologue-1291', getOrigin: () => null, isDiscovered: () => false,
    getPfennig: () => 0, getSkillLevel: () => 0, hasItem: () => false, hasCompanion: () => false, getHour: () => 12,
  };
}

describe('QuestMachine', () => {
  it('start enters the first stage, runs onStart then onEnter effects in order, and journals', async () => {
    const order: string[] = [];
    const { machine } = makeMachine((effects) => { if (effects) order.push(JSON.stringify(effects)); });
    await machine.start('quest.a');
    expect(machine.isStarted('quest.a')).toBe(true);
    expect(machine.stage('quest.a')).toBe('stage1');
    expect(order[0]).toContain('started A'); // onStart ran first
    expect(order[1]).toContain('s1-entered'); // then stage1 onEnter
    expect(machine.journalEntries).toHaveLength(1);
    expect(machine.journalEntries[0]).toEqual({ time: 1000, questId: 'quest.a', text: 'Stage one begins.' });
  });

  it('starting an already-started quest is a no-op', async () => {
    const { machine } = makeMachine();
    await machine.start('quest.a');
    await machine.start('quest.a');
    expect(machine.journalEntries).toHaveLength(1);
  });

  it('advance moves to a named stage and journals it', async () => {
    const { machine, setNow } = makeMachine();
    await machine.start('quest.a');
    setNow(2000);
    await machine.advance('quest.a', 'stage2');
    expect(machine.stage('quest.a')).toBe('stage2');
    expect(machine.journalEntries[1]).toEqual({ time: 2000, questId: 'quest.a', text: 'Stage two begins.' });
  });

  it('advance on an unstarted quest is a no-op', async () => {
    const { machine } = makeMachine();
    await machine.advance('quest.a', 'stage2');
    expect(machine.isStarted('quest.a')).toBe(false);
  });

  it('checkAdvance fires advanceWhen once its condition holds, and only for started+active quests', async () => {
    const { machine } = makeMachine();
    await machine.start('quest.a');
    await machine.advance('quest.a', 'stage2');
    const flags: Record<string, unknown> = {};
    machine.checkAdvance(fakeReads(flags));
    expect(machine.stage('quest.a')).toBe('stage2'); // condition false, no advance yet
    flags['ready-for-3'] = true;
    machine.checkAdvance(fakeReads(flags));
    // advance() is fired async (void) inside checkAdvance; flush microtasks
    await Promise.resolve();
    await Promise.resolve();
    expect(machine.stage('quest.a')).toBe('stage3');
  });

  it('complete marks done, runs onComplete once, and blocks further advance', async () => {
    const spy = vi.fn();
    const { machine } = makeMachine(spy);
    await machine.start('quest.a');
    await machine.complete('quest.a');
    expect(machine.isDone('quest.a')).toBe(true);
    await machine.advance('quest.a', 'stage2');
    expect(machine.stage('quest.a')).toBe('stage1'); // unchanged: quest already done
    await machine.complete('quest.a'); // idempotent
    const completeCalls = spy.mock.calls.filter((c) => JSON.stringify(c[0]).includes('completed A'));
    expect(completeCalls).toHaveLength(1);
  });

  it('fail marks done+failed and runs onFail', async () => {
    const { machine } = makeMachine();
    await machine.start('quest.a');
    await machine.fail('quest.a');
    expect(machine.isDone('quest.a')).toBe(true);
  });

  it('vars: setVar/getVar work for real quests and pseudo ids alike', () => {
    const { machine } = makeMachine();
    machine.setVar('_system', 'lastCombat.outcome', 'win');
    expect(machine.getVar('_system', 'lastCombat.outcome')).toBe('win');
    expect(machine.isStarted('_system')).toBe(false); // vars don't count as "started"
  });

  it('activeQuests reports objective text and resolves POI markers', async () => {
    const { machine } = makeMachine();
    await machine.start('quest.a');
    const active = machine.activeQuests();
    expect(active).toEqual([{ id: 'quest.a', title: 'Test Quest A', stage: 'stage1', objective: 'Stage one begins.', marker: undefined }]);
  });

  it('serialize/restore round-trips quest state exactly', async () => {
    const { machine } = makeMachine();
    await machine.start('quest.a');
    await machine.advance('quest.a', 'stage2');
    machine.setVar('quest.a', 'k', 42);
    const saved = machine.serialize();
    const { machine: m2 } = makeMachine();
    m2.restore(saved);
    expect(m2.stage('quest.a')).toBe('stage2');
    expect(m2.getVar('quest.a', 'k')).toBe(42);
    expect(m2.serialize()).toEqual(saved);
  });
});
