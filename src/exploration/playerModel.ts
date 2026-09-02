/**
 * The player's own `char.player` model: registered here (before combat's generic humanoid registration —
 * module order in main.ts is world → save → party → exploration → combat, and `ModelLibrary.register`
 * is first-registration-wins) so the player reads distinctly from the archetype cast: undyed wool
 * (unbleached, undyed cloth was the cheapest and commonest tone) and a Säumer hood, per the task spec.
 * Exposes named limb pivots in `userData.limbs` so `player.ts` can drive a simple procedural walk cycle.
 */
import {
  CapsuleGeometry, ConeGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, Object3D, SphereGeometry,
} from 'three';

export interface PlayerLimbs {
  leftArm: Object3D;
  rightArm: Object3D;
  leftLeg: Object3D;
  rightLeg: Object3D;
}

const WOOL = 0xcbb98f; // undyed/unbleached wool
const WOOL_DARK = 0x9c8f6f;
const SKIN = 0xd9b088;

export function buildPlayerModel(): Object3D {
  const g = new Group();
  g.name = 'char.player';

  const clothMat = new MeshStandardMaterial({ color: WOOL, roughness: 0.9, metalness: 0 });
  const hoodMat = new MeshStandardMaterial({ color: WOOL_DARK, roughness: 0.95, metalness: 0 });
  const skinMat = new MeshStandardMaterial({ color: SKIN, roughness: 0.9, metalness: 0 });

  const torso = new Mesh(new CapsuleGeometry(0.22, 0.55, 4, 8), clothMat);
  torso.position.y = 1.0;
  torso.castShadow = true;
  g.add(torso);

  const head = new Mesh(new SphereGeometry(0.15, 10, 8), skinMat);
  head.position.y = 1.55;
  head.castShadow = true;
  g.add(head);

  // Säumer hood: a soft peaked cone sitting over the head, brim skimming the brow.
  const hood = new Mesh(new ConeGeometry(0.2, 0.32, 10, 1, true), hoodMat);
  hood.position.y = 1.66;
  hood.castShadow = true;
  g.add(hood);
  const brim = new Mesh(new CylinderGeometry(0.19, 0.19, 0.04, 10), hoodMat);
  brim.position.y = 1.53;
  g.add(brim);

  // Limbs: each is a pivot Group at the joint with the mesh offset below/along it, so rotating the
  // pivot swings the limb like a real joint rather than orbiting the model's origin.
  const armGeo = new CylinderGeometry(0.045, 0.05, 0.5, 6);
  const legGeo = new CylinderGeometry(0.07, 0.06, 0.6, 6);

  function limb(geo: CylinderGeometry, mat: MeshStandardMaterial, x: number, pivotY: number, length: number): Object3D {
    const pivot = new Group();
    pivot.position.set(x, pivotY, 0);
    const mesh = new Mesh(geo, mat);
    mesh.position.y = -length / 2;
    mesh.castShadow = true;
    pivot.add(mesh);
    return pivot;
  }

  const leftArm = limb(armGeo, clothMat, -0.26, 1.28, 0.5);
  const rightArm = limb(armGeo, clothMat, 0.26, 1.28, 0.5);
  const leftLeg = limb(legGeo, hoodMat, -0.1, 0.72, 0.6);
  const rightLeg = limb(legGeo, hoodMat, 0.1, 0.72, 0.6);
  g.add(leftArm, rightArm, leftLeg, rightLeg);

  const limbs: PlayerLimbs = { leftArm, rightArm, leftLeg, rightLeg };
  g.userData.limbs = limbs;
  g.userData.walkPhase = 0;
  return g;
}

/** Procedural walk cycle: swings arms/legs opposite each other, amplitude scaled by horizontal speed
 *  (m/s), phase advanced by dt. `speed` 0 settles the limbs back toward rest. */
export function animateWalkCycle(model: Object3D, speed: number, dt: number): void {
  const limbs = model.userData.limbs as PlayerLimbs | undefined;
  if (!limbs) return;
  const cadence = 2.2; // strides/sec at ~jog speed
  model.userData.walkPhase = ((model.userData.walkPhase as number) ?? 0) + dt * cadence * Math.max(0.15, speed / 4);
  const phase = model.userData.walkPhase as number;
  const amp = Math.min(1, speed / 4.5) * 0.6;
  const swing = Math.sin(phase * Math.PI * 2) * amp;
  limbs.leftLeg.rotation.x = swing;
  limbs.rightLeg.rotation.x = -swing;
  limbs.leftArm.rotation.x = -swing * 0.8;
  limbs.rightArm.rotation.x = swing * 0.8;
}
