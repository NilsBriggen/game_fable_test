/**
 * Dialogue runner. ARCHITECTURE.md §5.6. Node graph walk: variant text, conditional choices, rolled
 * skill checks (deterministic across reloads — the roll is cached in quest vars under the pseudo-quest
 * id `_dialogue`, keyed `dialogueId:nodeId`), `{player}`/`{playerFamily}`/`{origin}`/`{time}` substitution.
 * When no UI is registered, the runner auto-picks the first enabled choice after logging the node text
 * with `console.info`, so quests can be driven headless (harness, tests).
 */
import type { EntityId } from '@core/ecs';
import type { DialogueChoice, DialogueDef, DialogueNode } from '@core/schemas';
import type { DialogueNodeView, DialogueOutcome } from '@core/services';
import type { Runtime } from './runtime';
import { evaluateCondition } from './conditions';
import { runEffects } from './effects';

export interface DialogueUiHandle {
  show(node: DialogueNodeView): Promise<number>;
  hide(): void;
}

export interface DialogueRuntime extends Runtime {
  getDialogueDef(id: string): DialogueDef | undefined;
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
}

const CHECK_VARS_QUEST = '_dialogue';

export function computeCheckOdds(check: { skill: string; dc: number }, rt: DialogueRuntime): number {
  const bonus = Math.floor(rt.getSkillLevel(check.skill) / 10) + rt.skillAttrMod(check.skill);
  let successes = 0;
  for (let d = 1; d <= 20; d++) if (d + bonus >= check.dc) successes++;
  return Math.round((successes / 20) * 100);
}

function resolveCheck(dialogueId: string, nodeId: string, check: { skill: string; dc: number }, rt: DialogueRuntime): boolean {
  const key = `${dialogueId}:${nodeId}`;
  const cached = rt.getVar(CHECK_VARS_QUEST, key);
  if (typeof cached === 'boolean') return cached;
  const bonus = Math.floor(rt.getSkillLevel(check.skill) / 10) + rt.skillAttrMod(check.skill);
  const roll = rt.rollD20();
  const success = roll + bonus >= check.dc;
  rt.setVar(CHECK_VARS_QUEST, key, success);
  return success;
}

function resolveRoot(def: DialogueDef, rt: DialogueRuntime): string {
  if (typeof def.root === 'string') return def.root;
  for (const entry of def.root) if (evaluateCondition(entry.condition, rt)) return entry.node;
  return def.root.length ? def.root[def.root.length - 1].node : '';
}

function resolveText(node: DialogueNode, rt: DialogueRuntime): string {
  if (node.variants) {
    for (const v of node.variants) if (evaluateCondition(v.condition, rt)) return v.text;
  }
  return node.text;
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

interface ShownChoice { c: DialogueChoice; enabled: boolean }

function buildChoiceViews(node: DialogueNode, dialogueId: string, rt: DialogueRuntime): ShownChoice[] {
  const out: ShownChoice[] = [];
  for (const c of node.choices ?? []) {
    const enabled = evaluateCondition(c.condition, rt);
    if (enabled || c.showDisabled) out.push({ c, enabled });
  }
  return out;
}

export async function runDialogue(dialogueId: string, rt: DialogueRuntime, speakerEntity?: EntityId): Promise<DialogueOutcome> {
  const def = rt.getDialogueDef(dialogueId);
  if (!def) {
    console.warn(`[dialogue] unknown dialogue "${dialogueId}"`);
    return { ended: true, lastNode: '', effectsRun: 0 };
  }
  rt.emitDialogueEvent('dialogue-started', dialogueId);
  let nodeId = resolveRoot(def, rt);
  let lastNode = nodeId;
  let effectsRun = 0;
  const ui = rt.ui();

  while (true) {
    const node = def.nodes[nodeId];
    if (!node) {
      console.warn(`[dialogue] ${dialogueId}: missing node "${nodeId}"`);
      break;
    }
    lastNode = nodeId;
    const text = substitute(resolveText(node, rt), rt);
    if (node.effects) {
      await runEffects(node.effects, rt);
      effectsRun += node.effects.length;
    }
    const speakerName = resolveSpeakerName(node, rt, speakerEntity);
    const speakerPortrait = resolveSpeakerPortrait(node, rt);

    if (node.end || !node.choices || node.choices.length === 0) {
      if (ui) {
        await ui.show({ speakerName, speakerPortrait, text, choices: [] });
        ui.hide();
      } else {
        console.info(`[dialogue:${dialogueId}] ${speakerName ? `${speakerName}: ` : ''}${text}`);
      }
      if (!node.end && node.next) {
        nodeId = node.next;
        continue;
      }
      break;
    }

    const shown = buildChoiceViews(node, dialogueId, rt);
    const views = shown.map(({ c, enabled }) => ({
      text: c.text,
      enabled,
      checkOdds: c.check ? computeCheckOdds(c.check, rt) : undefined,
    }));

    let picked: number;
    if (ui) {
      picked = await ui.show({ speakerName, speakerPortrait, text, choices: views });
    } else {
      console.info(`[dialogue:${dialogueId}] ${speakerName ? `${speakerName}: ` : ''}${text}`);
      const firstEnabled = shown.findIndex((s) => s.enabled);
      picked = firstEnabled >= 0 ? firstEnabled : 0;
    }
    const chosen = shown[Math.max(0, Math.min(picked, shown.length - 1))];
    if (!chosen || !chosen.enabled) break;

    if (chosen.c.effects) {
      await runEffects(chosen.c.effects, rt);
      effectsRun += chosen.c.effects.length;
    }
    if (chosen.c.check) {
      const success = resolveCheck(dialogueId, nodeId, chosen.c.check, rt);
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

  rt.emitDialogueEvent('dialogue-ended', dialogueId);
  return { ended: true, lastNode, effectsRun };
}
