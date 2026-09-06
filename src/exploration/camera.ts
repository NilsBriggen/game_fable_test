/**
 * `CameraRig` (core/services.ts): third-person orbit-follow (default), `free` (harness/flyover), `combat`
 * (orbit around a focus point handed off by the combat module), `cutscene` (external control, this rig
 * just stops touching the camera). ARCHITECTURE.md §5.2: "Orbit follow, collision-adjusted; default
 * distance 6 m." Smooth-damped so slope noise in `heightAt` doesn't read as jitter.
 */
import { PerspectiveCamera, Vector3 } from 'three';
import type { CameraRig, WorldService } from '@core/services';
import { clamp } from '@core/math';

const EYE_HEIGHT = 1.55;
const DEFAULT_DISTANCE = 6;
const MIN_PITCH = -0.15; // looking slightly up at the player from below is as low as we go
const MAX_PITCH = 1.15; // near-overhead

/** full focus state (also the tween endpoints) */
interface FocusPoint { x: number; y: number; z: number; distance: number; pitch: number; yaw: number }
/** tween easing over normalized t in [0,1]; defaults to ease-out cubic */
export type FocusEase = (t: number) => number;
export const easeOutCubic: FocusEase = (t) => 1 - Math.pow(1 - t, 3);
export const linearEase: FocusEase = (t) => t;

/** trauma-style shake tuning: amplitude = trauma² · MAX, trauma decays linearly, hard-capped */
const SHAKE_DECAY = 1.6; // trauma units per second
const SHAKE_MAX_M = 0.35;

export class CameraRigImpl implements CameraRig {
  camera: PerspectiveCamera;
  private mode: 'follow' | 'free' | 'combat' | 'cutscene' = 'follow';
  private yaw = 0;
  private pitch = 0.28;
  private distance = DEFAULT_DISTANCE;
  private smoothedPos = new Vector3();
  private smoothedTarget = new Vector3();
  private initialized = false;

  private combatFocus: FocusPoint | null = null;
  /** active time-based focus tween (event-time allocation only; update() just mutates combatFocus) */
  private focusTween: { t: number; dur: number; ease: (t: number) => number; from: FocusPoint; to: FocusPoint } | null = null;
  /** trauma-style shake state: 0..1, decays linearly, applied as a capped positional offset */
  private trauma = 0;
  private elapsed = 0;

  constructor(camera: PerspectiveCamera, private world: WorldService, private getPlayerPos: () => { x: number; y: number; z: number; yaw: number } | null) {
    this.camera = camera;
  }

  setMode(mode: 'follow' | 'free' | 'combat' | 'cutscene'): void {
    this.mode = mode;
  }
  getMode(): string {
    return this.mode;
  }

  /** Mouse-look input (radians), called by the player controller — not part of the public CameraRig
   *  interface (input plumbing is exploration-internal), but this concrete class exposes it. */
  addYawPitch(dyaw: number, dpitch: number): void {
    this.yaw += dyaw;
    this.pitch = clamp(this.pitch + dpitch, MIN_PITCH, MAX_PITCH);
  }
  getYaw(): number {
    return this.yaw;
  }
  setYaw(y: number): void {
    this.yaw = y;
  }
  adjustDistance(delta: number): void {
    this.distance = clamp(this.distance + delta, 2.5, 14);
  }

  setFree(pos: [number, number, number], lookAt: [number, number, number]): void {
    this.mode = 'free';
    this.camera.position.set(...pos);
    this.camera.lookAt(...lookAt);
    this.smoothedPos.set(...pos);
    this.smoothedTarget.set(...lookAt);
  }

  focus(x: number, y: number, z: number, opts?: { distance?: number; pitch?: number; yaw?: number; instant?: boolean; duration?: number; ease?: FocusEase }): void {
    const target: FocusPoint = { x, y, z, distance: opts?.distance ?? 18, pitch: opts?.pitch ?? 0.6, yaw: opts?.yaw ?? this.yaw };
    if (opts?.instant) {
      this.focusTween = null;
      this.combatFocus = target;
      const p = this.orbitPosition(x, y, z, target.distance, target.pitch, target.yaw);
      this.camera.position.copy(p);
      this.camera.lookAt(x, y, z);
      this.smoothedPos.copy(p);
      this.smoothedTarget.set(x, y, z);
      return;
    }
    const dur = opts?.duration ?? 0;
    if (dur > 0) {
      const from = this.combatFocus ? { ...this.combatFocus } : { x, y, z, distance: target.distance, pitch: target.pitch, yaw: this.yaw };
      this.focusTween = { t: 0, dur, ease: opts?.ease ?? easeOutCubic, from, to: target };
      this.combatFocus = { ...from };
    } else {
      this.focusTween = null;
      this.combatFocus = target;
    }
  }

  /** trauma-style hit: accumulates (clamped to 1), decays in update(); offset applied before lookAt.
   *  allocation-free, capped amplitude ~0.35 m. Call from combat-feel paths with a damage-proportional amount. */
  shake(amount: number): void {
    if (!(amount > 0)) return;
    this.trauma = Math.min(1, this.trauma + amount);
  }
  /** headless-testable shake math: current capped offset magnitude for a given trauma (no camera involved) */
  static shakeOffset(trauma: number): number {
    return trauma * trauma * SHAKE_MAX_M;
  }
  getTrauma(): number {
    return this.trauma;
  }

  private readonly tmpOrbit = new Vector3();
  private readonly tmpTarget = new Vector3();
  /** allocation-free (called every frame): the result is a shared scratch vector, consume it before the next call */
  private orbitPosition(x: number, y: number, z: number, distance: number, pitch: number, yaw: number): Vector3 {
    const horiz = distance * Math.cos(pitch);
    return this.tmpOrbit.set(x - Math.sin(yaw) * horiz, y + distance * Math.sin(pitch), z + Math.cos(yaw) * horiz);
  }

  /** Pull the camera in along its own line back toward the target until it's not embedded in terrain
   *  (task spec: "collision-adjusted against terrain via heightAt"). Cheap ray-march, ≤ 12 samples. */
  private colliders: { x: number; z: number; radius: number; height?: number }[] = [];
  /** settlement building footprints the boom must not pass through (bughunt exploration #3) */
  setColliders(c: { x: number; z: number; radius: number; height?: number }[]): void { this.colliders = c; }
  private readonly tmpDir = new Vector3();
  private readonly tmpOut = new Vector3();
  private readonly tmpShake = new Vector3();
  private collisionAdjust(target: Vector3, desired: Vector3): Vector3 {
    const dir = this.tmpDir.copy(desired).sub(target);
    const fullDist = dir.length();
    if (fullDist < 0.01) return desired;
    dir.normalize();
    let bestT = fullDist;
    const steps = 12;
    for (let i = 1; i <= steps; i++) {
      const t = (fullDist * i) / steps;
      const px = target.x + dir.x * t, pz = target.z + dir.z * t;
      const py = target.y + dir.y * t;
      const ground = this.world.heightAt(px, pz) + 0.35;
      let blocked = py < ground;
      if (!blocked && py < ground + 9) {
        // inside a building footprint (buildings are ~4–9 m tall): stop the boom before the wall
        for (const c of this.colliders) {
          const dx = px - c.x, dz = pz - c.z;
          if (py >= ground + (c.height ?? 9)) continue;   // a well or a cross: the boom passes over it
          if (dx * dx + dz * dz < (c.radius + 0.4) * (c.radius + 0.4)) { blocked = true; break; }
        }
      }
      if (blocked) {
        bestT = Math.max(0.6, (fullDist * (i - 1)) / steps);
        break;
      }
    }
    return this.tmpOut.copy(target).addScaledVector(dir, bestT);
  }

  update(dt: number): void {
    if (this.mode === 'free' || this.mode === 'cutscene') { this.decayShake(dt); return; } // externally driven
    this.elapsed += dt;
    this.stepFocusTween(dt);
    this.decayShake(dt);
    const damp = 1 - Math.pow(0.001, dt); // frame-rate-independent smoothing factor

    if (this.mode === 'combat' && this.combatFocus) {
      const f = this.combatFocus;
      const target = this.tmpTarget.set(f.x, f.y, f.z);
      const desired = this.orbitPosition(f.x, f.y, f.z, f.distance, f.pitch, f.yaw);
      const adjusted = this.collisionAdjust(target, desired);
      if (!this.initialized) { this.smoothedPos.copy(adjusted); this.smoothedTarget.copy(target); this.initialized = true; }
      this.smoothedPos.lerp(adjusted, damp);
      this.smoothedTarget.lerp(target, damp);
      this.applyShake(this.smoothedPos);
      this.camera.position.copy(this.smoothedPos);
      this.camera.lookAt(this.smoothedTarget);
      return;
    }

    // follow
    const p = this.getPlayerPos();
    if (!p) return;
    const target = this.tmpTarget.set(p.x, p.y + EYE_HEIGHT, p.z);
    const desired = this.orbitPosition(p.x, p.y + EYE_HEIGHT, p.z, this.distance, this.pitch, this.yaw);
    const adjusted = this.collisionAdjust(target, desired);
    if (!this.initialized) { this.smoothedPos.copy(adjusted); this.smoothedTarget.copy(target); this.initialized = true; }
    this.smoothedPos.lerp(adjusted, damp);
    this.smoothedTarget.lerp(target, damp);
    this.applyShake(this.smoothedPos);
    this.camera.position.copy(this.smoothedPos);
    this.camera.lookAt(this.smoothedTarget);
  }

  /** advance the focus tween (event-time allocation only; this just mutates the existing combatFocus in place) */
  private stepFocusTween(dt: number): void {
    const tw = this.focusTween;
    const f = this.combatFocus;
    if (!tw || !f) return;
    tw.t += dt;
    const k = tw.ease(Math.max(0, Math.min(1, tw.t / tw.dur)));
    f.x = tw.from.x + (tw.to.x - tw.from.x) * k;
    f.y = tw.from.y + (tw.to.y - tw.from.y) * k;
    f.z = tw.from.z + (tw.to.z - tw.from.z) * k;
    f.distance = tw.from.distance + (tw.to.distance - tw.from.distance) * k;
    f.pitch = tw.from.pitch + (tw.to.pitch - tw.from.pitch) * k;
    // shortest-arc yaw: focus yaw stays in (-pi, pi] of desired so the orbit never spins the long way
    let dy = (tw.to.yaw - tw.from.yaw) % (Math.PI * 2);
    if (dy > Math.PI) dy -= Math.PI * 2;
    if (dy < -Math.PI) dy += Math.PI * 2;
    f.yaw = tw.from.yaw + dy * k;
    if (tw.t + 1e-6 >= tw.dur) { f.x = tw.to.x; f.y = tw.to.y; f.z = tw.to.z; f.distance = tw.to.distance; f.pitch = tw.to.pitch; f.yaw = tw.to.yaw; this.focusTween = null; }
  }

  private decayShake(dt: number): void {
    if (this.trauma > 0) this.trauma = Math.max(0, this.trauma - SHAKE_DECAY * dt);
  }

  /** decaying trauma-style positional offset, applied before lookAt; deterministic sinusoid mix so no
   *  per-frame RNG allocation — uses only the scratch tmpShake vector, capped at ~0.35 m. */
  private applyShake(pos: Vector3): void {
    if (this.trauma <= 0) return;
    const amp = this.trauma * this.trauma * SHAKE_MAX_M;
    const t = this.elapsed * 61;
    this.tmpShake.set(Math.sin(t * 1.1) + 0.5 * Math.sin(t * 2.3), 0.7 * Math.sin(t * 1.7 + 1.3), Math.cos(t * 0.9) + 0.5 * Math.cos(t * 1.9));
    pos.addScaledVector(this.tmpShake, amp * 0.5);
  }
}
