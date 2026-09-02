/**
 * Cutscene runner. ARCHITECTURE.md §5.6 / §4 (`UiService.cutscene`, `CameraRig`). Drives
 * letterbox/fade/caption, camera via the exploration camera rig in 'cutscene' mode, time/weather via
 * world, nested dialogue steps and effects; requests the `cutscene` game state and returns to `explore`.
 * All UI/camera calls are optional — when absent (headless), captions log via `console.info`.
 */
import type { CutsceneDef, CutsceneStep } from '@core/schemas';
import type { Runtime } from './runtime';
import { runEffects } from './effects';

export interface CutsceneUiHandle {
  letterbox(on: boolean): void;
  caption(text: string, seconds: number): Promise<void>;
  fade(to: 'black' | 'clear', ms: number): Promise<void>;
}

export interface CameraRigHandle {
  setMode(mode: 'follow' | 'free' | 'combat' | 'cutscene'): void;
  setFree(pos: [number, number, number], lookAt: [number, number, number]): void;
}

export interface CutsceneRuntime extends Runtime {
  getCutsceneDef(id: string): CutsceneDef | undefined;
  cutsceneUi(): CutsceneUiHandle | undefined;
  cameraRig(): CameraRigHandle | undefined;
  setWorldTime(hour: number): void;
  setWorldWeather(w: string): void;
  requestState(state: string): void;
}

async function runStep(id: string, step: CutsceneStep, rt: CutsceneRuntime, questId?: string): Promise<void> {
  const ui = rt.cutsceneUi();
  const rig = rt.cameraRig();
  if (step.time !== undefined) rt.setWorldTime(step.time);
  if (step.weather) rt.setWorldWeather(step.weather);
  if (step.letterbox !== undefined) ui?.letterbox(step.letterbox);
  if (step.camera) rig?.setFree(step.camera.pos, step.camera.lookAt);
  if (step.fade) {
    if (ui) await ui.fade(step.fade, (step.seconds ?? 1) * 1000);
  }
  if (step.caption) {
    if (ui) await ui.caption(step.caption, step.seconds ?? 3);
    else console.info(`[cutscene:${id}] ${step.caption}`);
  }
  // Critic wave3-quest.md #2: a cutscene step must never itself pop a dialogue open — content should
  // not use this field for Act 1; kept only so a future scripted conversation *inside* a scene (both
  // parties already framed by the cutscene camera) has a place to hook in without a schema change.
  if (step.dialogue) await rt.runDialogueById(step.dialogue, questId);
  if (step.effects) await runEffects(step.effects, rt, questId);
}

/**
 * Runs a cutscene's steps to completion (camera/letterbox/captions/effects), then returns to `explore`.
 * `questId`, when known, is threaded into every step's effects so nested `{encounter}`/`{quest}` calls
 * key their state correctly (see effects.ts). `QuestServiceImpl.runCutscene` wraps this call with the
 * cutscene-nesting guard (critic wave3-quest.md #2): any `{quest: [...]}` effect run from inside a
 * cutscene's steps is deferred until *this* cutscene (and any cutscene it is itself nested under) has
 * fully finished all of its own steps — so a follow-on quest's dialogue can never open mid-scene.
 */
export async function runCutscene(cutsceneId: string, rt: CutsceneRuntime, questId?: string): Promise<void> {
  const def = rt.getCutsceneDef(cutsceneId);
  if (!def) {
    console.warn(`[cutscene] unknown cutscene "${cutsceneId}"`);
    return;
  }
  rt.requestState('cutscene');
  const rig = rt.cameraRig();
  const ui = rt.cutsceneUi();
  rig?.setMode('cutscene');
  ui?.letterbox(true);
  try {
    for (const step of def.steps) await runStep(cutsceneId, step, rt, questId);
  } finally {
    ui?.letterbox(false);
    rig?.setMode('follow');
    rt.requestState('explore');
  }
}
