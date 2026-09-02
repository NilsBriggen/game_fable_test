import { describe, it, expect, vi } from 'vitest';
import { runEffect, runEffects } from './effects';
import type { Runtime } from './runtime';

function fakeRuntime(overrides: Partial<Runtime> = {}): Runtime & { calls: string[] } {
  const calls: string[] = [];
  const base: Runtime = {
    getFlag: () => undefined, getStage: () => null, isStarted: () => false, isDone: () => false,
    getVar: () => undefined, getRep: () => 0, getChapter: () => 'prologue-1291', getOrigin: () => null,
    isDiscovered: () => false, getPfennig: () => 0, getSkillLevel: () => 0, hasItem: () => false,
    hasCompanion: () => false, getHour: () => 12,
    playerPosition: () => null, poiPosition: () => null, regionIdAt: () => null,
    setFlag: (k, v) => calls.push(`setFlag:${k}=${v}`),
    questOp: async (op, qid, stage) => { calls.push(`questOp:${op}:${qid}:${stage ?? ''}`); },
    setVar: (qid, k, v) => calls.push(`setVar:${qid}:${k}=${v}`),
    changeRep: (f, d) => calls.push(`changeRep:${f}:${d}`),
    giveItem: (id, qty) => calls.push(`giveItem:${id}:${qty}`),
    takeItem: (id, qty) => calls.push(`takeItem:${id}:${qty}`),
    addPfennig: (d) => calls.push(`addPfennig:${d}`),
    skillXp: (s, a) => calls.push(`skillXp:${s}:${a}`),
    runEncounter: async (id) => { calls.push(`runEncounter:${id}`); return { outcome: 'win', rounds: 3, downed: [], dead: [1, 2], xp: {}, loot: [], log: [] }; },
    teleport: (id) => calls.push(`teleport:${id}`),
    addCompanion: (id) => calls.push(`addCompanion:${id}`),
    removeCompanion: (id) => calls.push(`removeCompanion:${id}`),
    runCutsceneById: async (id) => { calls.push(`cutscene:${id}`); },
    advanceTime: (h) => calls.push(`advanceTime:${h}`),
    setChapterAsync: async (c) => { calls.push(`setChapter:${c}`); },
    setTimeExact: (y, m, d) => calls.push(`setTime:${y}-${m}-${d}`),
    toast: (m) => calls.push(`toast:${m}`),
    addJournalEntry: (t) => calls.push(`journal:${t}`),
    discoverPoi: (id) => calls.push(`discover:${id}`),
    npcMove: (n, p) => calls.push(`npcMove:${n}->${p}`),
    npcRemove: (n) => calls.push(`npcRemove:${n}`),
    runDialogueById: async (id) => { calls.push(`dialogue:${id}`); },
    restParty: (h) => calls.push(`rest:${h}`),
    setMusic: (id) => calls.push(`music:${id}`),
    endAct: (id) => calls.push(`end:${id}`),
    ...overrides,
  };
  return Object.assign(base, { calls });
}

describe('runEffect / runEffects', () => {
  it('dispatches every Effect variant to the matching Runtime method', async () => {
    const rt = fakeRuntime();
    await runEffects([
      { setFlag: ['f1', true] },
      { quest: ['advance', 'quest.a', 'stage2'] },
      { setVar: ['quest.a', 'k', 1] },
      { rep: ['uri', 5] },
      { giveItem: ['item.bread', 2] },
      { takeItem: ['item.bread', 1] },
      { pfennig: 10 },
      { skillXp: ['speech', 20] },
      { teleport: 'poi.altdorf' },
      { addCompanion: 'npc.jost-imhof' },
      { removeCompanion: 'npc.jost-imhof' },
      { advanceTime: 2 },
      { setTime: [1307, 5, 10, 7] },
      { toast: 'hello' },
      { journal: 'entry text' },
      { discover: 'poi.ruetli' },
      { npcMove: ['npc.x', 'poi.y'] },
      { npcRemove: 'npc.x' },
      { rest: 8 },
      { music: 'theme.altdorf' },
      { end: 'act1' },
    ], rt);
    expect(rt.calls).toEqual([
      'setFlag:f1=true',
      'questOp:advance:quest.a:stage2',
      'setVar:quest.a:k=1',
      'changeRep:uri:5',
      'giveItem:item.bread:2',
      'takeItem:item.bread:1',
      'addPfennig:10',
      'skillXp:speech:20',
      'teleport:poi.altdorf',
      'addCompanion:npc.jost-imhof',
      'removeCompanion:npc.jost-imhof',
      'advanceTime:2',
      'setTime:1307-5-10',
      'toast:hello',
      'journal:entry text',
      'discover:poi.ruetli',
      'npcMove:npc.x->poi.y',
      'npcRemove:npc.x',
      'rest:8',
      'music:theme.altdorf',
      'end:act1',
    ]);
  });

  it('encounter awaits combat and stores the outcome under the _system pseudo-quest', async () => {
    const rt = fakeRuntime();
    await runEffect({ encounter: 'enc.brunnen-quay' }, rt);
    expect(rt.calls).toContain('runEncounter:enc.brunnen-quay');
  });

  it('encounter effect records vars via setVar with the resolved outcome', async () => {
    const setVar = vi.fn();
    const rt = fakeRuntime({ setVar });
    await runEffect({ encounter: 'enc.hohle-gasse' }, rt);
    expect(setVar).toHaveBeenCalledWith('_system', 'lastCombat.outcome', 'win');
  });

  it('critic wave3-quest.md #1: clears the outcome var BEFORE awaiting combat, keyed per quest — a stage watching for a win cannot see a stale value from a still-running fight', async () => {
    let resolveCombat!: (r: { outcome: string }) => void;
    const pending = new Promise((resolve) => { resolveCombat = resolve as never; });
    const rt = fakeRuntime({
      // Simulate a *previous* fight's leftover 'win' already sitting in this quest's slot.
      getVar: (qid, k) => (qid === 'quest.x' && k === 'combat.outcome' ? 'win' : undefined),
      runEncounter: async () => { await pending; return { outcome: 'win', rounds: 1, downed: [], dead: [], xp: {}, loot: [], log: [] }; },
    });
    const p = runEffect({ encounter: 'enc.hohle-gasse' }, rt, 'quest.x');
    // While the new fight is still in flight, the effect must already have cleared the slot.
    await Promise.resolve(); // let the synchronous prefix of runEffect run
    expect(rt.calls.filter((c) => c.startsWith('setVar:quest.x:combat.outcome'))[0]).toBe('setVar:quest.x:combat.outcome=undefined');
    resolveCombat({ outcome: 'win' });
    await p;
    expect(rt.calls).toContain('setVar:quest.x:combat.outcome=win');
  });

  it('encounter keys the outcome by the current questId, not a single global slot', async () => {
    const rt = fakeRuntime();
    await runEffect({ encounter: 'enc.brunnen-quay' }, rt, 'quest.der-eid');
    expect(rt.calls).toContain('setVar:quest.der-eid:combat.outcome=win');
  });

  it('dialogue and cutscene effects await their runtime hooks', async () => {
    const rt = fakeRuntime();
    await runEffect({ dialogue: 'dlg.ruetli-oath' }, rt);
    await runEffect({ cutscene: 'cs.bundesbrief-sealing' }, rt);
    expect(rt.calls).toEqual(['dialogue:dlg.ruetli-oath', 'cutscene:cs.bundesbrief-sealing']);
  });

  it('runEffects on undefined is a no-op', async () => {
    const rt = fakeRuntime();
    await runEffects(undefined, rt);
    expect(rt.calls).toEqual([]);
  });
});
