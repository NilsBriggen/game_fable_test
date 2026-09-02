/**
 * Player controller: WASD + mouse-look third-person movement against the terrain heightfield + simple
 * prop colliders. ARCHITECTURE.md §5.2 / task spec: capsule (r 0.4, h 1.8), walk 1.8 / jog 4.0 (default) /
 * sprint 6.5 m/s (fatigue drain), slopes > 40° unwalkable, jump 1.2 m, gravity, swimming (slow 1.2 m/s,
 * fatigue drain, surface at `heightAt` — the world service already returns lake level there). Character
 * yaw follows the camera (classic third-person: mouse turns you, A/D strafe).
 */
import type { World, EntityId } from '@core/ecs';
import { Transform, Character, Velocity } from '@core/components';
import type { WorldService } from '@core/services';
import { clamp } from '@core/math';
import type { CameraRigImpl } from './camera';
import { resolveCollisions, type Collider } from './colliders';

export const PLAYER_RADIUS = 0.4;
export const PLAYER_HEIGHT = 1.8;
const WALK = 1.8, JOG = 4.0, SPRINT = 6.5, SWIM = 1.2;
const GRAVITY = 22;
const JUMP_HEIGHT = 1.2;
const MAX_SLOPE_RAD = (40 * Math.PI) / 180;
const SPRINT_FATIGUE_PER_SEC = 6;
const SWIM_FATIGUE_PER_SEC = 3;

export class PlayerController {
  private keys = new Set<string>();
  private pointerLocked = false;
  private enabled = true;
  private wantJump = false;

  constructor(private canvas: HTMLCanvasElement, private cameraRig: CameraRigImpl) {
    this.bind();
  }

  setControlEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.keys.clear();
  }

  private bind(): void {
    // Defensive: harness/headless environments still have `window`/`document`, but never fire these
    // events — listeners just sit idle, which is exactly the desired no-input behaviour there.
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'Space') this.wantJump = true;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    this.canvas.addEventListener('click', () => {
      try { this.canvas.requestPointerLock?.(); } catch { /* not available headless — fine */ }
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked || !this.enabled) return;
      this.cameraRig.addYawPitch(-e.movementX * 0.0025, -e.movementY * 0.0022);
    });
    window.addEventListener('wheel', (e) => {
      if (this.cameraRig.getMode() !== 'follow') return;
      this.cameraRig.adjustDistance(Math.sign(e.deltaY) * 0.6);
    }, { passive: true });
  }

  currentSpeedTier(): 'walk' | 'jog' | 'sprint' {
    if (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) return 'sprint';
    if (this.keys.has('AltLeft') || this.keys.has('ControlLeft')) return 'walk';
    return 'jog';
  }

  moveInput(): { x: number; z: number } {
    let mx = 0, mz = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) mz -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) mz += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) mx -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) mx += 1;
    const len = Math.hypot(mx, mz);
    return len > 0 ? { x: mx / len, z: mz / len } : { x: 0, z: 0 };
  }

  /** Advances the player entity's Transform/Velocity by one frame. Returns the resulting horizontal
   *  speed (m/s) so the render system can drive the walk-cycle animation. */
  update(dt: number, world: World, worldService: WorldService, playerId: EntityId, colliders: Collider[]): number {
    const t = world.get(playerId, Transform);
    if (!t) return 0;
    const vel = world.get(playerId, Velocity) ?? world.add(playerId, Velocity, {});
    const character = world.get(playerId, Character);
    const yaw = this.cameraRig.getYaw();
    t.yaw = yaw;

    const jumpRequested = this.wantJump;
    this.wantJump = false;

    if (!this.enabled) {
      // Frozen during dialogue/combat/cutscene: still settle vertically so the player doesn't float if a
      // scene starts mid-air, but no horizontal input and no jump.
      this.integrateVertical(t, vel, worldService, dt, false);
      return 0;
    }

    const input = this.moveInput();
    const swimming = worldService.isWater(t.x, t.z);
    const tier = this.currentSpeedTier();
    let speed = tier === 'sprint' ? SPRINT : tier === 'walk' ? WALK : JOG;
    if (swimming) speed = SWIM;

    if (character) {
      if (tier === 'sprint' && (input.x !== 0 || input.z !== 0)) {
        character.fatigue = clamp(character.fatigue + SPRINT_FATIGUE_PER_SEC * dt, 0, 100);
        if (character.fatigue >= 100) speed = JOG; // too tired to keep sprinting
      }
      if (swimming) character.fatigue = clamp(character.fatigue + SWIM_FATIGUE_PER_SEC * dt, 0, 100);
    }

    const x0 = t.x, z0 = t.z;
    if (input.x !== 0 || input.z !== 0) {
      const forward = { x: Math.sin(yaw), z: -Math.cos(yaw) };
      const right = { x: Math.cos(yaw), z: Math.sin(yaw) };
      const dx = (forward.x * -input.z + right.x * input.x) * speed * dt;
      const dz = (forward.z * -input.z + right.z * input.x) * speed * dt;
      this.tryMove(t, worldService, dx, 0);
      this.tryMove(t, worldService, 0, dz);
    }

    resolveCollisions(t, colliders, PLAYER_RADIUS);
    this.integrateVertical(t, vel, worldService, dt, jumpRequested && !swimming);
    // Actual planar speed achieved this frame (post slope-rejection/collision), for the walk-cycle —
    // more faithful than the requested speed when a step was blocked.
    vel.vx = dt > 0 ? (t.x - x0) / dt : 0;
    vel.vz = dt > 0 ? (t.z - z0) / dt : 0;
    return Math.hypot(vel.vx, vel.vz);
  }

  /** Attempt a single-axis step, sliding along the surface instead of climbing anything > 40° (task
   *  spec) — tried per-axis so a diagonal move against a steep slope still lets the player slide along
   *  the one axis that stays walkable, rather than freezing outright. */
  private tryMove(t: { x: number; y: number; z: number }, worldService: WorldService, dx: number, dz: number): void {
    if (dx === 0 && dz === 0) return;
    const nx = t.x + dx, nz = t.z + dz;
    if (worldService.slopeAt(nx, nz) > MAX_SLOPE_RAD) return; // slide back: reject this axis' step
    t.x = nx;
    t.z = nz;
  }

  private integrateVertical(
    t: { x: number; y: number; z: number },
    vel: { vx: number; vy: number; vz: number; grounded: boolean },
    worldService: WorldService,
    dt: number,
    jumpRequested: boolean,
  ): void {
    const swimming = worldService.isWater(t.x, t.z);
    const ground = worldService.heightAt(t.x, t.z);
    if (swimming) {
      // Surface swimming: `heightAt` already returns the local lake's own level in water, so we float
      // right at it rather than sinking to the lakebed.
      t.y = ground;
      vel.vy = 0;
      vel.grounded = true;
      return;
    }
    if (jumpRequested && vel.grounded) {
      vel.vy = Math.sqrt(2 * GRAVITY * JUMP_HEIGHT);
      vel.grounded = false;
    }
    vel.vy -= GRAVITY * dt;
    const candidateY = t.y + vel.vy * dt;
    if (candidateY <= ground) {
      t.y = ground;
      vel.vy = 0;
      vel.grounded = true;
    } else {
      t.y = candidateY;
      vel.grounded = false;
    }
  }
}
