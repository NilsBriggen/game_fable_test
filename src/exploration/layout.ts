/**
 * Procedural settlement layout generator. Pure data (no Three.js): `generateLayout()` turns a POI's
 * `kind` + `population` into a list of `PlacedModel`s (model id already registered in `world/models.ts`,
 * local xz offset from the POI centre, yaw, optional variant/scale). `src/exploration/index.ts` turns
 * these into real `Object3D`s via `WorldService.spawnModel`, placed on `heightAt` at render time — this
 * module never touches height directly beyond the `heightAt`/`isWater` probe used to keep buildings off
 * water and off steep ground (task spec: "never places a model on water").
 */
import type { PlacedModel, PoiKind } from '@core/schemas';
import { Rng, hashString } from '@core/rng';
import { SPACING } from './colliders';

export interface HeightProbe {
  heightAt(x: number, z: number): number;
  isWater(x: number, z: number): boolean;
}

export interface LayoutInput {
  id: string;
  kind: PoiKind;
  x: number;
  z: number;
  /** yaw (radians) the settlement should face — toward its road/approach. Default 0 (+z / south). */
  yaw?: number;
  population?: Record<string, number>;
}

const MAX_SLOPE_DY = 1.6; // ≈ 28° over a 3 m probe step: buildings must not sit on ground the player cannot walk (40°)

function isGentle(x: number, z: number, probe: HeightProbe, maxDy = MAX_SLOPE_DY): boolean {
  const h0 = probe.heightAt(x, z);
  const h1 = probe.heightAt(x + 3, z);
  const h2 = probe.heightAt(x, z + 3);
  return Math.abs(h1 - h0) < maxDy && Math.abs(h2 - h0) < maxDy;
}

class Builder {
  readonly out: PlacedModel[] = [];
  /** camps may use ground up to ~40° */
  steepOk = false;
  constructor(private cx: number, private cz: number, private probe: HeightProbe, private allowWater = false) {}

  private overlaps(modelId: string, x: number, z: number): boolean {
    const r = SPACING[modelId] ?? 0;
    if (r === 0) return false;
    for (const m of this.out) {
      const o = SPACING[m.modelId] ?? 0;
      if (o === 0) continue;
      if (Math.hypot(m.x - x, m.z - z) < r + o) return true;
    }
    return false;
  }

  /** Place one model at a local offset from the settlement centre. The spot is rejected if it is on water,
   *  too steep, or overlapping an already-placed footprint; then the offset is rotated around the centre
   *  (±30°, ±60°, ±90°) and shrunk before giving up. Returns false when nothing fits (caller skips). */
  add(modelId: string, dx: number, dz: number, opts: { yaw?: number; scale?: number; variant?: string } = {}): boolean {
    if (this.allowWater) {
      this.out.push({ modelId, x: this.cx + dx, z: this.cz + dz, yaw: opts.yaw, scale: opts.scale, variant: opts.variant });
      return true;
    }
    const baseAngle = Math.atan2(dx, dz), baseR = Math.hypot(dx, dz);
    for (let shrink = 1; shrink >= 0.55; shrink -= 0.15) {
      for (const da of [0, 0.52, -0.52, 1.05, -1.05, 1.57, -1.57]) {
        const a = baseAngle + da, r = baseR * shrink;
        const x = this.cx + Math.sin(a) * r, z = this.cz + Math.cos(a) * r;
        if (this.probe.isWater(x, z) || !isGentle(x, z, this.probe, this.steepOk ? 2.5 : MAX_SLOPE_DY) || this.overlaps(modelId, x, z)) continue;
        this.out.push({ modelId, x, z, yaw: opts.yaw, scale: opts.scale, variant: opts.variant });
        return true;
      }
      if (baseR === 0) break;
    }
    return false;
  }

  /** Largest radius (≤ max) around the centre that is dry and gentle in all 8 compass directions. */
  dryRadius(max: number): number {
    let r = max;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      let d = 0;
      while (d < max && !this.probe.isWater(this.cx + Math.sin(a) * (d + 6), this.cz + Math.cos(a) * (d + 6))) d += 6;
      r = Math.min(r, d);
    }
    return r;
  }
}

function popTotal(pop?: Record<string, number>): number {
  if (!pop) return 0;
  return Object.values(pop).reduce((a, b) => a + b, 0);
}

/** village: 6–14 `house.blockbau` around a church/chapel + well, fences, hayracks, a cross (task spec). */
function layoutVillage(b: Builder, rng: Rng, yaw: number, pop?: Record<string, number>): void {
  const houses = Math.max(6, Math.min(14, Math.round(3 + popTotal(pop) * 0.8)));
  b.add('well', 0, 0);
  const big = popTotal(pop) >= 9;
  b.add(big ? 'church' : 'chapel', 0, -21, { yaw: yaw + Math.PI }); // 21 m: the well's roof clears the church tower's base
  // ring 0 has five slots (the sixth, behind the church at (0,-21), stays open); the rest go to ring 1
  const ring0 = Math.min(5, houses);
  for (let i = 0; i < houses; i++) {
    const ring = i < ring0 ? 0 : 1;
    const idxInRing = ring === 0 ? i : i - ring0;
    const ringCount = ring === 0 ? ring0 : houses - ring0;
    const angle = ring === 0
      ? Math.PI * 0.2 + (idxInRing / ring0) * Math.PI * 1.6 + rng.next() * 0.2   // 36°..324°, never straight behind the church
      : (idxInRing / Math.max(1, ringCount)) * Math.PI * 2 + rng.next() * 0.3;
    const radius = 24 + ring * 16 + rng.next() * 4;
    const dx = Math.sin(angle) * radius, dz = Math.cos(angle) * radius;
    b.add('house.blockbau', dx, dz, { yaw: -angle + Math.PI, variant: i === 0 ? 'inn' : undefined });
    if (rng.next() < 0.6) b.add('fence', dx + Math.cos(angle) * 5, dz - Math.sin(angle) * 5, { yaw: -angle });
    if (rng.next() < 0.4) b.add('hayrack', dx - Math.sin(angle) * 6, dz - Math.cos(angle) * 6);
  }
  b.add('cross', Math.sin(yaw) * 30, Math.cos(yaw) * 30, { yaw });
}

/** town (Luzern/Zug): `house.stone` rows, `castle.wall` perimeter with a gate, a church (task spec). */
function layoutTown(b: Builder, rng: Rng, yaw: number, pop?: Record<string, number>): void {
  const half = Math.max(30, Math.min(55, b.dryRadius(60) - 8));
  const houses = Math.max(8, Math.min(20, Math.round(6 + popTotal(pop)), Math.floor((half * 2 - 20) / 11) * 3));
  b.add(houses >= 14 ? 'church' : 'chapel', 0, -8);
  b.add('well', 14, 10);
  const rows = 3;
  let placed = 0;
  for (let r = 0; r < rows && placed < houses; r++) {
    const rowZ = -half * 0.55 + r * (half * 0.36);
    const perRow = Math.ceil((houses - placed) / (rows - r));
    for (let i = 0; i < perRow && placed < houses; i++, placed++) {
      const dx = (i - (perRow - 1) / 2) * 11;
      b.add('house.stone', dx, rowZ + (rng.next() - 0.5) * 2, { yaw: Math.PI });
    }
  }
  // wall perimeter: a rough square sized to the dry land, with a gate gap facing yaw
  const segLen = 8;
  for (const side of ['n', 's', 'e', 'w'] as const) {
    const isGateSide = (side === 'n' && Math.cos(yaw) > 0.5) || (side === 's' && Math.cos(yaw) < -0.5)
      || (side === 'e' && Math.sin(yaw) > 0.5) || (side === 'w' && Math.sin(yaw) < -0.5);
    const count = Math.floor((half * 2) / segLen);
    for (let i = 0; i < count; i++) {
      if (isGateSide && Math.abs(i - count / 2) < 1) continue; // gate gap
      const t = -half + i * segLen + segLen / 2;
      let dx = 0, dz = 0, wallYaw = 0;
      if (side === 'n') { dx = t; dz = -half; wallYaw = 0; }
      else if (side === 's') { dx = t; dz = half; wallYaw = 0; }
      else if (side === 'e') { dx = half; dz = t; wallYaw = Math.PI / 2; }
      else { dx = -half; dz = t; wallYaw = Math.PI / 2; }
      b.add('castle.wall', dx, dz, { yaw: wallYaw });
    }
  }
  void rng;
}

/** castle: keep + wall + towers on the pad (task spec). */
function layoutCastle(b: Builder, yaw: number): void {
  b.add('castle.keep', 0, 0, { yaw });
  const half = 16;
  for (const [dx, dz] of [[half, half], [-half, half], [half, -half], [-half, -half]] as [number, number][]) {
    b.add('castle.tower', dx, dz);
  }
  for (const [dx, dz, wallYaw] of [[0, half, 0], [0, -half, 0], [half, 0, Math.PI / 2], [-half, 0, Math.PI / 2]] as [number, number, number][]) {
    b.add('castle.wall', dx, dz, { yaw: wallYaw, scale: 1.6 });
  }
}

/** monastery: `monastery` model (already church + cloister) + a wall segment for enclosure (task spec). */
function layoutMonastery(b: Builder, yaw: number): void {
  b.add('monastery', 0, 0, { yaw });
  b.add('well', 8, 14);
  b.add('cross', 0, -22, { yaw });
}

/** alp: 1–3 huts (task spec). */
function layoutAlp(b: Builder, rng: Rng, pop?: Record<string, number>): void {
  const huts = Math.max(1, Math.min(3, Math.round(popTotal(pop) / 2) || 1));
  for (let i = 0; i < huts; i++) {
    const a = (i / huts) * Math.PI * 2;
    b.add('house.blockbau', Math.sin(a) * 10, Math.cos(a) * 10, { variant: 'small' });
    if (rng.next() < 0.7) b.add('hayrack', Math.sin(a) * 14, Math.cos(a) * 14);
  }
}

/** pass: hospice + cross (task spec). */
function layoutPass(b: Builder, yaw: number): void {
  b.add('house.stone', 0, 0, { yaw, variant: 'large' });
  b.add('cross', 10, -10, { yaw });
}

/** bridge: `bridge.stone` across the gorge at the road's yaw (task spec). */
function layoutBridge(b: Builder, yaw: number): void {
  b.add('bridge.stone', 0, 0, { yaw: yaw + Math.PI / 2 });
}

/** port: boats and a quay (task spec) — boats sit on/near the water so they skip the dry-spot check. */
function layoutPort(b: Builder, out: Builder, rng: Rng, yaw: number, pop?: Record<string, number>): void {
  const boats = Math.max(2, Math.min(5, Math.round((pop?.boatman ?? 0) + (pop?.fisher ?? 0) + 1)));
  for (let i = 0; i < boats; i++) {
    const dx = (i - (boats - 1) / 2) * 4 + Math.sin(yaw + Math.PI / 2) * 10;
    const dz = (i - (boats - 1) / 2) * 1 + Math.cos(yaw + Math.PI / 2) * 10;
    out.add('boat', dx, dz, { yaw: yaw + rng.next() * 0.3 });
  }
  // the quay hut goes on the landward side: try successively further from the water
  const inland = yaw - Math.PI / 2;
  let placed = false;
  for (let d = 12; d <= 48 && !placed; d += 12) placed = b.add('house.blockbau', Math.sin(inland) * d - 6, Math.cos(inland) * d + 4, { yaw, variant: 'small' });
  for (let d = 10; d <= 40; d += 10) if (b.add('cross', Math.sin(inland) * d + 10, Math.cos(inland) * d - 4, { yaw })) break;
}

function layoutSingle(b: Builder, modelId: string, opts: { yaw?: number; variant?: string } = {}): void {
  b.add(modelId, 0, 0, opts);
}

function layoutCamp(b: Builder): void {
  b.steepOk = true; // camps sit on scree and forest slopes
  b.add('campfire', 0, 0);
  b.add('tent', 6, 2, { yaw: 0.4 });
  b.steepOk = false;
}

function layoutWall(b: Builder, yaw: number): void {
  const perp = yaw + Math.PI / 2;
  for (let i = -1; i <= 1; i++) {
    b.add('letzi.wall', Math.sin(perp) * i * 8, Math.cos(perp) * i * 8, { yaw: perp });
  }
}

function layoutRuin(b: Builder): void {
  b.add('castle.wall', 0, 0, { scale: 0.7 });
  b.add('rock.small', 4, 2);
  b.add('rock.small', -3, -2);
}

/** Generate a settlement's static prop layout. Deterministic per POI id (seeded RNG) so the same POI
 *  always lays out identically across a session and across test runs. */
export function generateLayout(input: LayoutInput, probe: HeightProbe): PlacedModel[] {
  const rng = new Rng(hashString(input.id));
  const yaw = input.yaw ?? 0;
  const b = new Builder(input.x, input.z, probe);
  const water = new Builder(input.x, input.z, probe, true);
  switch (input.kind) {
    case 'village': layoutVillage(b, rng, yaw, input.population); break;
    case 'town': layoutTown(b, rng, yaw, input.population); break;
    case 'castle': layoutCastle(b, yaw); break;
    case 'monastery': layoutMonastery(b, yaw); break;
    case 'alp': layoutAlp(b, rng, input.population); break;
    case 'pass': layoutPass(b, yaw); break;
    case 'bridge': layoutBridge(b, yaw); break;
    case 'port': layoutPort(b, water, rng, yaw, input.population); break;
    case 'camp': layoutCamp(b); break;
    case 'wall': layoutWall(b, yaw); break;
    case 'ruin': layoutRuin(b); break;
    case 'mill': layoutSingle(b, 'mill', { yaw }); break;
    case 'hut': layoutSingle(b, 'house.blockbau', { yaw, variant: 'small' }); break;
    case 'cross': layoutSingle(b, 'cross', { yaw }); break;
    case 'church': layoutSingle(b, 'church', { yaw }); break;
    case 'chapel': layoutSingle(b, 'chapel', { yaw }); break;
    // landmark / viewpoint / battlefield / meadow: natural sites, no built layout (task spec only asks
    // for a layout on settlement-shaped kinds).
    default: break;
  }
  return [...b.out, ...water.out];
}
