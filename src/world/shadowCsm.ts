/**
 * Tiny registry so every material created anywhere in src/world (terrain, vegetation, props) can be
 * wired into the single CSM instance without every factory needing to import sky.ts directly.
 * sky.ts calls setActiveCsm() once, early, before any other material factory runs.
 */
import type { Material } from 'three';
import type { CSM } from 'three/examples/jsm/csm/CSM.js';

let activeCsm: CSM | null = null;
/** Camera position published by sky.ts each frame; vegetation.ts reads it for near-camera grass. */
const viewPos = { x: 0, y: 0, z: 0 };

export function setViewPosition(x: number, y: number, z: number): void { viewPos.x = x; viewPos.y = y; viewPos.z = z; }
export function getViewPosition(): { x: number; y: number; z: number } { return viewPos; }

export function setActiveCsm(csm: CSM | null): void {
  activeCsm = csm;
}

export function getActiveCsm(): CSM | null {
  return activeCsm;
}

/** Wraps the material's existing onBeforeCompile (if any) so CSM's cascade uniforms are applied too. */
export function registerCsmMaterial(material: Material): void {
  if (!activeCsm) return;
  const prev = (material as any).onBeforeCompile as ((shader: any, renderer: any) => void) | undefined;
  activeCsm.setupMaterial(material as any);
  const csmObc = (material as any).onBeforeCompile as (shader: any, renderer: any) => void;
  (material as any).onBeforeCompile = (shader: any, renderer: any) => {
    prev?.(shader, renderer);
    csmObc?.(shader, renderer);
  };
}
