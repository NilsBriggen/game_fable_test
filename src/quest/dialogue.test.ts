import { describe, it, expect, vi } from 'vitest';
import { runDialogue } from './dialogue';
import type { DialogueRuntime, DialogueUiHandle } from './dialogue';
import type { DialogueDef } from '@core/schemas';

interface Options {
  dialogues: Record<string, DialogueDef>;
  flags?: Record<string, unknown>;
  vars?: Record<string, Record<string, unknown>>;
  skillLevel?: number;
  skillAttrMod?: number;
  rolls?: number[]; // sequence of rollD20() results
  ui?: DialogueUiHandle;
}

function fakeRt(opts: Options): DialogueRuntime & { effectsLog: string[] } {
  const flags = opts.flags ?? {};
  const vars = opts.vars ?? {};
  const effectsLog: string[] = [];
  let rollIndex = 0;
  const rt: DialogueRuntime & { effectsLog: string[] } = {
    effectsLog,
    getFlag: (k) => flags[k],
    getStage: () => null, isStarted: () => false, isDone: () => false,
    getVar: (qid, k) => vars[qid]?.[k],
    getRep: () => 0, getChapter: () => 'prologue-1291', getOrigin: () => 'uri', isDiscovered: () => false,
    getPfennig: () => 0, getSkillLevel: () => opts.skillLevel ?? 0, hasItem: () => false, hasCompanion: () => false, getHour: () => 12,
    setFlag: (k, v) => { flags[k] = v; },
    questOp: async () => {},
    setVar: (qid, k, v) => { (vars[qid] ??= {})[k] = v; },
    changeRep: () => {},
    giveItem: () => {}, takeItem: () => {}, addPfennig: () => {}, skillXp: () => {},
    runEncounter: async () => ({ outcome: 'win', rounds: 1, downed: [], dead: [], xp: {}, loot: [], log: [] }),
    teleport: () => {}, addCompanion: () => {}, removeCompanion: () => {},
    runCutsceneById: async () => {},
    advanceTime: () => {}, setChapterAsync: async () => {}, setTimeExact: () => {},
    toast: (m) => effectsLog.push(`toast:${m}`),
    addJournalEntry: () => {}, discoverPoi: () => {}, npcMove: () => {}, npcRemove: () => {},
    runDialogueById: async () => {}, restParty: () => {}, setMusic: () => {}, endAct: () => {},
    getDialogueDef: (id) => opts.dialogues[id],
    npcDisplayName: (id) => (id === 'npc.werner-stauffacher' ? 'Werner Stauffacher' : undefined),
    npcPortrait: () => undefined,
    entityDisplayName: () => undefined,
    playerGivenName: () => 'Kuoni',
    playerFamilyName: () => 'Imhof',
    playerOriginLabel: () => 'Uri',
    timeLabel: () => '1 August 1291, 06:00',
    skillAttrMod: () => opts.skillAttrMod ?? 0,
    rollD20: () => (opts.rolls ? opts.rolls[Math.min(rollIndex++, opts.rolls.length - 1)] : 10),
    ui: () => opts.ui,
    emitDialogueEvent: () => {},
  };
  return rt;
}

describe('runDialogue', () => {
  it('substitutes {player}/{playerFamily}/{origin}/{time}', async () => {
    const dialogues: Record<string, DialogueDef> = {
      'dlg.test': {
        id: 'dlg.test', historical: 'invented', note: 'x', root: 'greet',
        nodes: { greet: { speaker: 'narrator', text: 'Hail, {player} {playerFamily} of {origin}! It is {time}.' } },
      },
    };
    let shown = '';
    const ui: DialogueUiHandle = { show: async (n) => { shown = n.text; return 0; }, hide: () => {} };
    const rt = fakeRt({ dialogues, ui });
    await runDialogue('dlg.test', rt);
    expect(shown).toBe('Hail, Kuoni Imhof of Uri! It is 1 August 1291, 06:00.');
  });

  it('resolves a conditional root, first match wins', async () => {
    const dialogues: Record<string, DialogueDef> = {
      'dlg.test': {
        id: 'dlg.test', historical: 'invented', note: 'x',
        root: [{ condition: { flag: 'seenA' }, node: 'a' }, { condition: { flag: 'seenB' }, node: 'b' }],
        nodes: { a: { speaker: 'narrator', text: 'A' }, b: { speaker: 'narrator', text: 'B' } },
      },
    };
    let shown = '';
    const ui: DialogueUiHandle = { show: async (n) => { shown = n.text; return 0; }, hide: () => {} };
    const rt = fakeRt({ dialogues, flags: { seenB: true }, ui });
    await runDialogue('dlg.test', rt);
    expect(shown).toBe('B');
  });

  it('resolves variant text by first matching condition, falling back to node.text', async () => {
    const dialogues: Record<string, DialogueDef> = {
      'dlg.test': {
        id: 'dlg.test', historical: 'invented', note: 'x', root: 'n',
        nodes: {
          n: {
            speaker: 'narrator', text: 'default text',
            variants: [{ condition: { chapter: 'ch1-1307' }, text: 'chapter one text' }],
          },
        },
      },
    };
    let shown = '';
    const ui: DialogueUiHandle = { show: async (n) => { shown = n.text; return 0; }, hide: () => {} };
    const rt = fakeRt({ dialogues, ui });
    await runDialogue('dlg.test', rt); // chapter defaults to prologue-1291 in the fake -> no variant match
    expect(shown).toBe('default text');
  });

  it('filters choices by condition, showing disabled ones only when showDisabled is set', async () => {
    const dialogues: Record<string, DialogueDef> = {
      'dlg.test': {
        id: 'dlg.test', historical: 'invented', note: 'x', root: 'n',
        nodes: {
          n: {
            speaker: 'narrator', text: 'Choose.',
            choices: [
              { text: 'hidden (no showDisabled)', condition: { flag: 'nope' }, end: true },
              { text: 'shown but disabled', condition: { flag: 'nope' }, showDisabled: true, end: true },
              { text: 'always shown', end: true },
            ],
          },
        },
      },
    };
    let seenChoices: { text: string; enabled: boolean }[] = [];
    const ui: DialogueUiHandle = { show: async (n) => { seenChoices = n.choices; return n.choices.findIndex((c) => c.enabled); }, hide: () => {} };
    const rt = fakeRt({ dialogues, ui });
    await runDialogue('dlg.test', rt);
    expect(seenChoices.map((c) => c.text)).toEqual(['shown but disabled', 'always shown']);
    expect(seenChoices[0].enabled).toBe(false);
    expect(seenChoices[1].enabled).toBe(true);
  });

  it('speech checks are deterministic across a simulated reload via persisted vars', async () => {
    const dialogues: Record<string, DialogueDef> = {
      'dlg.test': {
        id: 'dlg.test', historical: 'invented', note: 'x', root: 'n',
        nodes: {
          n: { speaker: 'narrator', text: 'Persuade?', choices: [{ text: 'Try', check: { skill: 'speech', dc: 15, fail: 'fail' }, next: 'success' }] },
          success: { speaker: 'narrator', text: 'It worked.', end: true },
          fail: { speaker: 'narrator', text: 'It failed.', end: true },
        },
      },
    };
    const sharedVars: Record<string, Record<string, unknown>> = {};
    const ui: DialogueUiHandle = { show: async (n) => (n.choices.length ? 0 : 0), hide: () => {} };
    const rolls = [15]; // 15 + 0 attrMod + floor(0/10) skill bonus = 15 >= dc 15 -> success
    const rt1 = fakeRt({ dialogues, ui, vars: sharedVars, rolls, skillLevel: 0, skillAttrMod: 0 });
    let seenText1 = '';
    ui.show = async (n) => { seenText1 = n.text; return 0; };
    await runDialogue('dlg.test', rt1);
    expect(seenText1).toBe('It worked.');

    // "reload": fresh runtime sharing the same persisted vars, rolls would now fail (2) if re-rolled
    const rt2 = fakeRt({ dialogues, ui, vars: sharedVars, rolls: [2], skillLevel: 0, skillAttrMod: 0 });
    let seenText2 = '';
    ui.show = async (n) => { seenText2 = n.text; return 0; };
    await runDialogue('dlg.test', rt2);
    expect(seenText2).toBe('It worked.'); // cached success, not re-rolled
  });

  it('auto-picks the first enabled choice when no UI is registered (headless)', async () => {
    const dialogues: Record<string, DialogueDef> = {
      'dlg.test': {
        id: 'dlg.test', historical: 'invented', note: 'x', root: 'n',
        nodes: {
          n: {
            speaker: 'narrator', text: 'Pick one.',
            choices: [
              { text: 'disabled', condition: { flag: 'nope' }, showDisabled: true, effects: [{ toast: 'should not run' }], end: true },
              { text: 'enabled', effects: [{ toast: 'ran' }], end: true },
            ],
          },
        },
      },
    };
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const rt = fakeRt({ dialogues });
    const outcome = await runDialogue('dlg.test', rt);
    expect(rt.effectsLog).toEqual(['toast:ran']);
    expect(outcome.lastNode).toBe('n');
    expect(infoSpy).toHaveBeenCalled();
    infoSpy.mockRestore();
  });

  it('an unknown dialogue id logs a warning and returns a closed outcome', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rt = fakeRt({ dialogues: {} });
    const outcome = await runDialogue('dlg.missing', rt);
    expect(outcome.ended).toBe(true);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
