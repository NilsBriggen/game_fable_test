/** 4.1 combat-feel: camera shake decay math + focus tween — headless (three PerspectiveCamera
 *  and a stub world are enough; no DOM, no renderer). */
import { describe, it, expect } from 'vitest';
import { PerspectiveCamera } from 'three';
import { CameraRigImpl, easeOutCubic } from './camera';
import type { WorldService } from '@core/services';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRig = any;

function makeRig() {
  const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 1000);
  const world = { heightAt: () => 0 } as unknown as WorldService;
  const rig = new CameraRigImpl(camera, world, () => ({ x: 0, y: 0, z: 0, yaw: 0 }));
  return { rig, priv: rig as unknown as AnyRig, camera };
}

describe('shake (trauma-style)', () => {
  it('accumulates clamped to 1 and decays linearly to 0', () => {
    const { rig, priv } = makeRig();
    rig.shake(0.5);
    expect(rig.getTrauma()).toBeCloseTo(0.5, 6);
    rig.shake(5);
    expect(rig.getTrauma()).toBe(1);
    expect(priv.trauma).toBe(1);
  });

  it('decay math: trauma falls at a fixed rate per second of update()', () => {
    const { rig } = makeRig();
    rig.setMode('free'); // externally-driven path still decays shake, touches no camera math
    rig.shake(1.0);
    rig.update(0.25);
    expect(rig.getTrauma()).toBeLessThan(1.0);
    expect(rig.getTrauma()).toBeGreaterThan(0);
    rig.update(10);
    expect(rig.getTrauma()).toBe(0);
  });

  it('offset magnitude is trauma²·max and capped at ~0.35 m', () => {
    expect(CameraRigImpl.shakeOffset(1)).toBeCloseTo(0.35, 6);
    expect(CameraRigImpl.shakeOffset(0)).toBe(0);
    expect(CameraRigImpl.shakeOffset(0.5)).toBeCloseTo(0.0875, 6);
    expect(CameraRigImpl.shakeOffset(2)).toBeGreaterThan(0.35); // static helper is raw math…
    // …but shake() itself clamps trauma to 1, so live amplitude never exceeds the cap
    const { rig } = makeRig();
    rig.shake(99);
    expect(CameraRigImpl.shakeOffset(rig.getTrauma())).toBeLessThanOrEqual(0.35 + 1e-9);
  });

  it('non-positive shake amounts are ignored', () => {
    const { rig } = makeRig();
    rig.shake(0);
    rig.shake(-1);
    expect(rig.getTrauma()).toBe(0);
  });

  it('combat update() with trauma does not throw and keeps the camera finite', () => {
    const { rig, camera } = makeRig();
    rig.setMode('combat');
    rig.focus(0, 0, 0, { instant: true });
    rig.shake(0.6);
    for (let i = 0; i < 30; i++) rig.update(1 / 60);
    expect(Number.isFinite(camera.position.x)).toBe(true);
    expect(Number.isFinite(camera.position.y)).toBe(true);
    expect(Number.isFinite(camera.position.z)).toBe(true);
  });
});

describe('focus() tweens', () => {
  it('default (no duration) keeps snap-lerp behavior: combatFocus set immediately, no tween', () => {
    const { rig, priv } = makeRig();
    rig.focus(10, 2, 5, { distance: 20 });
    expect(priv.combatFocus).toMatchObject({ x: 10, y: 2, z: 5, distance: 20 });
    expect(priv.focusTween).toBeNull();
  });

  it('instant flag still snaps camera + smoothing state', () => {
    const { rig, priv, camera } = makeRig();
    rig.setMode('combat');
    rig.focus(10, 2, 5, { distance: 20, instant: true });
    expect(priv.focusTween).toBeNull();
    expect(camera.position.length()).toBeGreaterThan(0);
  });

  it('duration tween reaches the exact target and clears', () => {
    const { rig, priv } = makeRig();
    rig.setMode('combat');
    rig.focus(0, 0, 0, { instant: true });
    rig.focus(10, 4, 5, { distance: 24, pitch: 0.5, yaw: 1.0, duration: 1.0 });
    expect(priv.focusTween).not.toBeNull();
    for (let i = 0; i < 10; i++) rig.update(0.1);
    expect(priv.focusTween).toBeNull();
    expect(priv.combatFocus.x).toBeCloseTo(10, 6);
    expect(priv.combatFocus.y).toBeCloseTo(4, 6);
    expect(priv.combatFocus.z).toBeCloseTo(5, 6);
    expect(priv.combatFocus.distance).toBeCloseTo(24, 6);
    expect(priv.combatFocus.pitch).toBeCloseTo(0.5, 6);
  });

  it('mid-tween state follows ease-out cubic (fast start, settling end)', () => {
    const { rig, priv } = makeRig();
    rig.setMode('combat');
    rig.focus(0, 0, 0, { distance: 18, pitch: 0.6, yaw: 0, instant: true });
    rig.focus(100, 0, 0, { distance: 18, pitch: 0.6, yaw: 0, duration: 1.0 });
    rig.update(0.5);
    // easeOutCubic(0.5) = 0.875 → x should be at 87.5, well past linear halfway
    expect(priv.combatFocus.x).toBeCloseTo(100 * easeOutCubic(0.5), 4);
    expect(priv.combatFocus.x).toBeGreaterThan(50);
  });

  it('a new focus() replaces an in-flight tween', () => {
    const { rig, priv } = makeRig();
    rig.setMode('combat');
    rig.focus(0, 0, 0, { instant: true });
    rig.focus(100, 0, 0, { duration: 1.0 });
    rig.update(0.2);
    rig.focus(7, 0, 0, { duration: 0.4 });
    for (let i = 0; i < 10; i++) rig.update(0.1);
    expect(priv.focusTween).toBeNull();
    expect(priv.combatFocus.x).toBeCloseTo(7, 6);
  });
});
