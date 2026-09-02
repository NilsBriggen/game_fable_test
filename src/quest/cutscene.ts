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

async function runStep(id: string, step: CutsceneStep, rt: CutsceneRuntime): Promise<void> {
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
  if (step.dialogue) await rt.runDialogueById(step.dialogue);
  if (step.effects) await runEffects(step.effects, rt);
}

export async function runCutscene(cutsceneId: string, rt: CutsceneRuntime): Promise<void> {
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
  for (const step of def.steps) await runStep(cutsceneId, step, rt);
  ui?.letterbox(false);
  rig?.setMode('follow');
  rt.requestState('explore');
}
