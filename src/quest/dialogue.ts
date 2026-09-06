/**
 * Dialogue runner. ARCHITECTURE.md §5.6. Node graph walk: variant text, conditional choices, rolled
 * skill checks (deterministic across reloads — the roll is cached in quest vars under the pseudo-quest
 * id `_dialogue`, keyed `dialogueId:nodeId:choiceIndex[:speakerEntity]` — see `checkKey`),
 * `{player}`/`{playerFamily}`/`{origin}`/`{time}` substitution. Requests the `dialogue` game state on
 * entry and `explore` on exit (ARCHITECTURE.md §4), always, even on an early return. When no UI is
 * registered, the runner auto-picks the first enabled choice after logging the node text with
 * `console.info`, so quests can be driven headless (harness, tests).
 */
import type { EntityId } from '@core/ecs';
import type { DialogueChoice, DialogueDef, DialogueNode } from '@core/schemas';
import type { DialogueNodeView, DialogueOutcome } from '@core/services';
import type { Runtime } from './runtime';
import { evaluateCondition } from './conditions';
import { runEffect, runEffects } from './effects';

export interface DialogueUiHandle {
  show(node: DialogueNodeView): Promise<number>;
  hide(): void;
  /** Set by the UI's hide() when the player dismisses the panel mid-conversation (pause menu, Esc,
   *  scenario teardown) rather than picking a choice. The runner checks it after every awaited show()
   *  so a forced close reads as neutral cancellation — no node/choice effects run for the dismissed
   *  node, and the outcome reports cancelled:true. Defaults to false when unset. */
  wasDismissed?(): boolean;
}

export interface DialogueRuntime extends Runtime {
  getDialogueDef(id: string): DialogueDef | undefined;
  /** 4.3 i18n: display-time locale lookup — `t(id)` resolves through the active locale with en fallback. */
  t(id: string): string;
  npcDisplayName(id: string): string | undefined;
  npcPortrait(id: string): string | undefined;
  entityDisplayName(entity: EntityId): string | undefined;
  playerGivenName(): string;
  playerFamilyName(): string;
  playerOriginLabel(): string;
  timeLabel(): string;
  skillAttrMod(skill: string): number;
  rollD20(): number;
  ui(): DialogueUiHandle | undefined;
  emitDialogueEvent(event: 'dialogue-started' | 'dialogue-ended', id: string): void;
  /** ARCHITECTURE.md §4 state machine: dialogue runs in the `dialogue` state, camera framing the speaker. */
  requestState(state: string): void;
}

const CHECK_VARS_QUEST = '_dialogue';

export function computeCheckOdds(check: { skill: string; dc: number }, rt: DialogueRuntime): number {
  const bonus = Math.floor(rt.getSkillLevel(check.skill) / 10) + rt.skillAttrMod(check.skill);
  let successes = 0;
  for (let d = 1; d <= 20; d++) if (d + bonus >= check.dc) successes++;
  return Math.round((successes / 20) * 100);
}

/**
 * Cache key for a rolled choice: `dialogueId:nodeId:choiceIndex`, plus the talking entity when known.
 * Critic wave3-quest.md #7/#8: keying only by `dialogueId:nodeId` let two different checks *on the same
 * node* (e.g. a stealth choice and a speech choice) share one cached result, and let one generic-NPC
 * roll (e.g. `dlg.generic.toll-collector`) decide the outcome for every instance of that archetype in
 * the game. `choiceIndex` fixes the first; folding in `speakerEntity` (when the dialogue was opened
 * against a specific world entity, as exploration does for generic crowd NPCs) fixes the second, since
 * two different toll-collectors are two different entities.
 */
function checkKey(dialogueId: string, nodeId: string, choiceIndex: number, speakerEntity?: EntityId): string {
  return speakerEntity !== undefined ? `${dialogueId}:${nodeId}:${choiceIndex}:${speakerEntity}` : `${dialogueId}:${nodeId}:${choiceIndex}`;
}

function resolveCheck(
  dialogueId: string, nodeId: string, choiceIndex: number, check: { skill: string; dc: number }, rt: DialogueRuntime, speakerEntity?: EntityId,
): boolean {
  const key = checkKey(dialogueId, nodeId, choiceIndex, speakerEntity);
  const cached = rt.getVar(CHECK_VARS_QUEST, key);
  // A quest retry that explicitly clears this dialogue's cached rolls (machine.clearVarPrefix, e.g.
  // the Morgarten muster-hub retry) allows a fresh roll below; otherwise a cached result stands, so
  // outcomes stay deterministic across save/load.
  if (typeof cached === 'boolean') return cached;
  const bonus = Math.floor(rt.getSkillLevel(check.skill) / 10) + rt.skillAttrMod(check.skill);
  const roll = rt.rollD20();
  const success = roll + bonus >= check.dc;
  rt.setVar(CHECK_VARS_QUEST, key, success);
  return success;
}

function resolveRoot(def: DialogueDef, rt: DialogueRuntime, dialogueId: string): string {
  if (typeof def.root === 'string') return def.root;
  for (const entry of def.root) if (evaluateCondition(entry.condition, rt)) return entry.node;
  // Critic wave3-quest.md #9: silently falling back to the *last* listed entry made an unrelated
  // chapter's node play (e.g. Arnold von Melchtal's ch2 line in the 1291 prologue). Warn and end
  // instead — a missing root condition is a content bug that should be visible, not papered over.
  console.warn(`[dialogue] ${dialogueId}: no root condition matched and no fallback node is defined`);
  return '';
}

function resolveText(dialogueId: string, nodeId: string, node: DialogueNode, rt: DialogueRuntime): string {
  // 4.3 i18n: display-time lookup — content defs stay en-only; the active locale resolves here.
  // IDs are stable (see src/core/i18n.ts); the runner asks rt.t() (backed by the shared catalog),
  // which falls back to en and then to the id itself. Tests inject the catalog semantics through
  // their fake rt.t, so no direct `strings` import is needed here (and headless fakes can resolve
  // def text directly).
  const base = `dlg.${dialogueId.replace(/^dlg\./, '')}.node.${nodeId}`;
  if (node.variants) {
    for (let i = 0; i < node.variants.length; i++) {
      if (evaluateCondition(node.variants[i].condition, rt)) {
        const hit = rt.t(`${base}.variant.${i}`);
        return hit === `${base}.variant.${i}` ? node.variants[i].text : hit;
      }
    }
  }
  const hit = rt.t(`${base}.text`);
  return hit === `${base}.text` ? node.text : hit;
}

function resolveChoiceText(dialogueId: string, nodeId: string, index: number, fallback: string, rt: DialogueRuntime): string {
  const base = `dlg.${dialogueId.replace(/^dlg\./, '')}.node.${nodeId}`;
  const hit = rt.t(`${base}.choice.${index}`);
  return hit === `${base}.choice.${index}` ? fallback : hit;
}

function substitute(text: string, rt: DialogueRuntime): string {
  return text
    .replace(/\{player\}/g, rt.playerGivenName())
    .replace(/\{playerFamily\}/g, rt.playerFamilyName())
    .replace(/\{origin\}/g, rt.playerOriginLabel())
    .replace(/\{time\}/g, rt.timeLabel());
}

function resolveSpeakerName(node: DialogueNode, rt: DialogueRuntime, speakerEntity?: EntityId): string {
  if (node.speaker === 'player') return `${rt.playerGivenName()} ${rt.playerFamilyName()}`;
  if (speakerEntity !== undefined) {
    const n = rt.entityDisplayName(speakerEntity);
    if (n) return n;
  }
  if (node.speaker === 'narrator') return '';
  return rt.npcDisplayName(node.speaker) ?? node.speaker;
}

function resolveSpeakerPortrait(node: DialogueNode, rt: DialogueRuntime): string | undefined {
  if (node.speaker === 'player' || node.speaker === 'narrator') return undefined;
  return rt.npcPortrait(node.speaker);
}

interface ShownChoice { c: DialogueChoice; enabled: boolean; originalIndex: number }

function buildChoiceViews(node: DialogueNode, rt: DialogueRuntime): ShownChoice[] {
  const out: ShownChoice[] = [];
  (node.choices ?? []).forEach((c, originalIndex) => {
    const enabled = evaluateCondition(c.condition, rt);
    if (enabled || c.showDisabled) out.push({ c, enabled, originalIndex });
  });
  return out;
}

export async function runDialogue(
  dialogueId: string, rt: DialogueRuntime, speakerEntity?: EntityId, questId?: string,
): Promise<DialogueOutcome> {
  const def = rt.getDialogueDef(dialogueId);
  if (!def) {
    console.warn(`[dialogue] unknown dialogue "${dialogueId}"`);
    return { ended: true, cancelled: false, lastNode: '', effectsRun: 0 };
  }
  // ARCHITECTURE.md §4: explore ⇄ dialogue. Always paired with requestState('explore') below, however
  // the loop exits (normal end, missing node, disabled pick) — see the `finally`.
  rt.requestState('dialogue');
  rt.emitDialogueEvent('dialogue-started', dialogueId);
  let nodeId = resolveRoot(def, rt, dialogueId);
  let lastNode = nodeId;
  let effectsRun = 0;
  const ui = rt.ui();

  // Critic wave3-quest.md round 2 #? / talkedTo: the root's speaker is who this dialogue "belongs to" —
  // mark the NPC as spoken-to as soon as their dialogue actually opens (before any node runs), so a
  // `{talkedTo: npcId}` gate elsewhere becomes true the moment the conversation happens, not after.
  const rootSpeaker = def.nodes[nodeId]?.speaker;
  if (rootSpeaker && rootSpeaker !== 'player' && rootSpeaker !== 'narrator') rt.setFlag(`talked:${rootSpeaker}`, true);

  // Neutral cancellation: the UI's hide() may resolve a pending show() with a stale index (the DOM
  // panel resolves 0 on teardown). If the panel reports it was dismissed rather than answered, treat
  // the conversation as cancelled — skip the dismissed node's effects and choice routing entirely.
  // Callers (main.ts scenario teardown drains a multi-node dialogue with repeated hide() calls) see
  // outcome.cancelled rather than silently stepping the story forward one node per hide().
  function dismissedByUi(ui: DialogueUiHandle | undefined): boolean {
    try {
      return ui?.wasDismissed?.() === true;
    } catch {
      return false;
    }
  }

  try {
  while (true) {
    const node = def.nodes[nodeId];
    if (!node) {
      if (nodeId) console.warn(`[dialogue] ${dialogueId}: missing node "${nodeId}"`);
      break;
    }
    lastNode = nodeId;
    const text = substitute(resolveText(dialogueId, nodeId, node, rt), rt);
    const speakerName = resolveSpeakerName(node, rt, speakerEntity);
    const speakerPortrait = resolveSpeakerPortrait(node, rt);
    // §1.7 voice line id: stable string-catalog id for this node (same scheme as resolveText).
    const voiceId = `dlg.${dialogueId.replace(/^dlg\./, '')}.node.${nodeId}`;

    // Critic wave3-quest.md round 2 #2: show the node BEFORE running its effects — a node's own
    // `effects` (e.g. `{cutscene:...}`, `{quest:['advance',...]}`) must never race ahead of the text
    // that motivates them. `runEffects` is itself scene-depth-guarded (see index.ts) so anything it
    // triggers is deferred until this whole dialogue call returns, not just until this node.
    if (node.end || !node.choices || node.choices.length === 0) {
      if (ui) {
        await ui.show({ speakerName, speakerPortrait, text, choices: [], voiceId });
        if (dismissedByUi(ui)) return { ended: false, cancelled: true, lastNode, effectsRun };
        ui.hide();
      } else {
        console.info(`[dialogue:${dialogueId}] ${speakerName ? `${speakerName}: ` : ''}${text}`);
      }
      if (node.effects) {
        const immediate = node.effects.filter((e) => !('dialogue' in e) && !('cutscene' in e) && !('encounter' in e) && !('quest' in e));
        const nested = node.effects.filter((e) => ('dialogue' in e) || ('cutscene' in e) || ('encounter' in e) || ('quest' in e));
        for (const e of immediate) { await runEffect(e, rt, questId); effectsRun++; }
        if (nested.length) { await runEffects(nested, rt, questId); effectsRun += nested.length; }
      }
      if (!node.end && node.next) {
        nodeId = node.next;
        continue;
      }
      break;
    }

    const shown = buildChoiceViews(node, rt);
    if (shown.length > 0 && !shown.some((sc) => sc.enabled)) {
      // every choice gated off: never hand the UI a dead end — show the line, run the node's effects, end
      console.warn(`[dialogue:${dialogueId}] node "${nodeId}" has no enabled choice; ending`);
      if (ui) { await ui.show({ speakerName, speakerPortrait, text, choices: [], voiceId }); ui.hide(); }
      if (node.effects) { await runEffects(node.effects, rt, questId); effectsRun += node.effects.length; }
      break;
    }
    const views = shown.map(({ c, enabled, originalIndex }) => ({
      text: resolveChoiceText(dialogueId, nodeId, originalIndex, c.text, rt),
      enabled,
      checkOdds: c.check ? computeCheckOdds(c.check, rt) : undefined,
      hint: c.check ? skillLabel(c.check.skill) : undefined,
    }));

    let picked: number;
    if (ui) {
      picked = await ui.show({ speakerName, speakerPortrait, text, choices: views, voiceId });
      if (dismissedByUi(ui)) return { ended: false, cancelled: true, lastNode, effectsRun };
    } else {
      console.info(`[dialogue:${dialogueId}] ${speakerName ? `${speakerName}: ` : ''}${text}`);
      const firstEnabled = shown.findIndex((s) => s.enabled);
      picked = firstEnabled >= 0 ? firstEnabled : 0;
    }
    if (node.effects) {
      const immediate = node.effects.filter((e) => !('dialogue' in e) && !('cutscene' in e) && !('encounter' in e) && !('quest' in e));
      const nested = node.effects.filter((e) => ('dialogue' in e) || ('cutscene' in e) || ('encounter' in e) || ('quest' in e));
      for (const e of immediate) { await runEffect(e, rt, questId); effectsRun++; }
      if (nested.length) { await runEffects(nested, rt, questId); effectsRun += nested.length; }
    }
    const chosen = shown[Math.max(0, Math.min(picked, shown.length - 1))];
    if (!chosen || !chosen.enabled) break;

    if (chosen.c.effects) {
      const immediate = chosen.c.effects.filter((e) => !('dialogue' in e) && !('cutscene' in e) && !('encounter' in e) && !('quest' in e));
      const nested = chosen.c.effects.filter((e) => ('dialogue' in e) || ('cutscene' in e) || ('encounter' in e) || ('quest' in e));
      for (const e of immediate) { await runEffect(e, rt, questId); effectsRun++; }
      if (nested.length) { await runEffects(nested, rt, questId); effectsRun += nested.length; }
    }
    if (chosen.c.check) {
      const success = resolveCheck(dialogueId, nodeId, chosen.originalIndex, chosen.c.check, rt, speakerEntity);
      if (success) {
        if (chosen.c.next) {
          nodeId = chosen.c.next;
          continue;
        }
        break;
      }
      nodeId = chosen.c.check.fail;
      continue;
    }
    if (chosen.c.end) break;
    if (chosen.c.next) {
      nodeId = chosen.c.next;
      continue;
    }
    break;
  }
  } finally {
    rt.emitDialogueEvent('dialogue-ended', dialogueId);
    rt.requestState('explore');
  }

  return { ended: true, cancelled: false, lastNode, effectsRun };
}

/** 'speech' → 'Speech', 'axe-mace' → 'Axe & Mace' for the [Skill NN%] label. */
function skillLabel(skill: string): string {
  return skill.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' & ');
}
