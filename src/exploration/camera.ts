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

export class CameraRigImpl implements CameraRig {
  camera: PerspectiveCamera;
  private mode: 'follow' | 'free' | 'combat' | 'cutscene' = 'follow';
  private yaw = 0;
  private pitch = 0.28;
  private distance = DEFAULT_DISTANCE;
  private smoothedPos = new Vector3();
  private smoothedTarget = new Vector3();
  private initialized = false;

  private combatFocus: { x: number; y: number; z: number; distance: number; pitch: number; yaw: number } | null = null;

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

  focus(x: number, y: number, z: number, opts?: { distance?: number; pitch?: number; yaw?: number; instant?: boolean }): void {
    this.combatFocus = { x, y, z, distance: opts?.distance ?? 18, pitch: opts?.pitch ?? 0.6, yaw: opts?.yaw ?? this.yaw };
    if (opts?.instant) {
      const p = this.orbitPosition(x, y, z, this.combatFocus.distance, this.combatFocus.pitch, this.combatFocus.yaw);
      this.camera.position.copy(p);
      this.camera.lookAt(x, y, z);
      this.smoothedPos.copy(p);
      this.smoothedTarget.set(x, y, z);
    }
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
    if (this.mode === 'free' || this.mode === 'cutscene') return; // externally driven
    const damp = 1 - Math.pow(0.001, dt); // frame-rate-independent smoothing factor

    if (this.mode === 'combat' && this.combatFocus) {
      const f = this.combatFocus;
      const target = this.tmpTarget.set(f.x, f.y, f.z);
      const desired = this.orbitPosition(f.x, f.y, f.z, f.distance, f.pitch, f.yaw);
      const adjusted = this.collisionAdjust(target, desired);
      if (!this.initialized) { this.smoothedPos.copy(adjusted); this.smoothedTarget.copy(target); this.initialized = true; }
      this.smoothedPos.lerp(adjusted, damp);
      this.smoothedTarget.lerp(target, damp);
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
    this.camera.position.copy(this.smoothedPos);
    this.camera.lookAt(this.smoothedTarget);
  }
}
