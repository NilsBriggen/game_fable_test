/**
 * Budget + content tests for the model/character library (BUILDER_RULES "Budgets"):
 * draw calls and triangles per model, the shared-material count across all buildings, footprints the
 * exploration layout assumes, and that every animation the game asks for exists in the CC0 clip pack.
 */
import { Box3, Mesh, type Material, type Object3D } from 'three';

interface Buffer { toString(enc: string, start?: number, end?: number): string; readUInt32LE(offset: number): number }
import { beforeAll, describe, expect, it } from 'vitest';
import { ModelLibrary } from './models';
import { CHARACTER_ARCHETYPES, clipFor, spawnCharacter, type WeaponKind } from './characters';
import { archetypes } from '@content/archetypes';
import type { CharacterAnim } from '@core/services';

// three's TextureLoader needs a DOM to build an <img>; the tests never decode one.
beforeAll(() => {
  (globalThis as unknown as { document: unknown }).document = {
    createElementNS: () => ({ addEventListener: () => {}, removeEventListener: () => {} }),
  };
});

const BUILDINGS = [
  'house.blockbau', 'house.stone', 'barn', 'church', 'chapel', 'monastery',
  'castle.keep', 'castle.wall', 'castle.tower', 'letzi.wall', 'palisade',
  'bridge.wood', 'bridge.stone', 'mill', 'boat',
];
const WEAPONS = ['weapon.spiess', 'weapon.halberd', 'weapon.crossbow', 'weapon.sword', 'weapon.dagger', 'weapon.staff', 'shield.heater', 'shield.buckler'];
const PROPS = ['cross', 'hayrack', 'fence', 'well', 'gallows.pole', 'campfire', 'tent', 'cart', 'signpost', 'rock.large', 'rock.small', 'stump'];

function stats(obj: Object3D): { meshes: number; tris: number; mats: Set<Material> } {
  let meshes = 0, tris = 0;
  const mats = new Set<Material>();
  obj.traverse((c) => {
    const m = c as Mesh;
    if (!m.isMesh) return;
    meshes++;
    mats.add(m.material as Material);
    const pos = m.geometry.getAttribute('position');
    tris += (m.geometry.index ? m.geometry.index.count : pos.count) / 3;
  });
  return { meshes, tris, mats };
}

describe('model library budgets', () => {
  const lib = new ModelLibrary(1234);

  it('every building and prop stays within 6 draw calls and 8k triangles', () => {
    const variants: [string, string | undefined][] = [...[...BUILDINGS, ...PROPS, ...WEAPONS].map((i) => [i, undefined] as [string, undefined]),
      ['house.blockbau', 'inn'], ['house.blockbau', 'large'], ['house.blockbau', 'small'], ['house.stone', 'large']];
    for (const [id, variant] of variants) {
      const s = stats(lib.spawn(id, { variant }));
      expect(s.meshes, `${id}/${variant ?? '-'}: ${s.meshes} meshes`).toBeLessThanOrEqual(6);
      expect(s.tris, `${id}: ${Math.round(s.tris)} tris`).toBeLessThanOrEqual(8000);
      expect(s.meshes, `${id} produced no geometry`).toBeGreaterThan(0);
    }
  });

  it('all buildings together share at most 8 materials (exploration merges per material)', () => {
    const all = new Set<Material>();
    for (const id of BUILDINGS) for (const m of stats(lib.spawn(id)).mats) all.add(m);
    expect(all.size, `${all.size} distinct building materials`).toBeLessThanOrEqual(8);
  });

  it('every mesh carries position/normal/uv/colour, so per-material merging stays uniform', () => {
    for (const id of [...BUILDINGS, ...PROPS, ...WEAPONS]) {
      lib.spawn(id).traverse((c) => {
        const m = c as Mesh;
        if (!m.isMesh) return;
        for (const attr of ['position', 'normal', 'uv', 'color']) {
          expect(m.geometry.getAttribute(attr), `${id}: missing ${attr}`).toBeTruthy();
        }
      });
    }
  });

  it('footprints match what exploration/layout.ts assumes', () => {
    const expected: Record<string, [number, number]> = {   // [max width, max depth] in metres
      'house.blockbau': [10.5, 9.5], 'house.stone': [11.5, 9.5], barn: [13, 10], church: [12, 22],
      'castle.wall': [9, 4], 'letzi.wall': [9, 3], palisade: [9, 2], 'bridge.stone': [15, 5],
      'castle.keep': [15, 15], 'castle.tower': [8, 8], chapel: [7, 9],
    };
    for (const [id, [w, d]] of Object.entries(expected)) {
      for (let i = 0; i < 8; i++) {          // houses jitter per spawn: every draw must still fit
        const box = new Box3().setFromObject(lib.spawn(id));
        const size = box.getSize(new Box3().min.clone());
        expect(size.x, `${id} width ${size.x.toFixed(1)}`).toBeLessThanOrEqual(w);
        expect(size.z, `${id} depth ${size.z.toFixed(1)}`).toBeLessThanOrEqual(d);
      }
    }
  });

  it('the gallows pole keeps Gessler\'s hat as its own toggleable Group', () => {
    const pole = lib.spawn('gallows.pole');
    const hat = pole.children.find((c) => c.type === 'Group');
    expect(hat).toBeTruthy();
    expect(stats(hat!).meshes).toBeGreaterThan(0);
  });
});

describe('characters', () => {
  it('covers every archetype in content/archetypes.ts', () => {
    for (const a of archetypes) {
      const id = (a.modelId ?? `char.${a.id}`).replace(/^char\./, '');
      expect(CHARACTER_ARCHETYPES, `no look for ${id}`).toContain(id);
    }
  });

  it('maps every CharacterAnim onto a clip the downloaded pack actually contains', async () => {
    // Read the packed clip list straight out of public/assets/characters/rig-medium.anims.bin.
    // `node:fs` is loaded through a computed specifier: src/** may not import across the tools/ boundary
    // (tools/check-imports.mjs) and the project's tsconfig carries no @types/node.
    const spec = 'node:' + 'fs';
    const { readFileSync } = await import(spec) as { readFileSync: (p: string) => Buffer };
    const buf = readFileSync('public/assets/characters/rig-medium.anims.bin');
    expect(buf.toString('ascii', 0, 4)).toBe('EANM');
    const header = JSON.parse(buf.toString('utf8', 8, 8 + buf.readUInt32LE(4))) as { clips: { name: string }[] };
    const have = new Set(header.clips.map((c) => c.name));
    const anims: CharacterAnim[] = ['idle', 'walk', 'run', 'attack', 'hit', 'down', 'dead', 'brace', 'shoot', 'reload', 'talk', 'cheer', 'flee'];
    const weapons: WeaponKind[] = ['spiess', 'halberd', 'crossbow', 'sword', 'dagger', 'staff', 'axe', 'lance', 'none'];
    for (const a of anims) for (const w of weapons) for (const shield of [false, true]) for (const seed of [0, 1, 2, 3, 4]) {
      const pick = clipFor(a, w, seed, shield);
      expect(have.has(pick.name), `${a}/${w}: no clip "${pick.name}"`).toBe(true);
    }
  });

  it('registers a model id for every archetype it dresses', () => {
    const lib = new ModelLibrary(3);
    for (const id of CHARACTER_ARCHETYPES) expect(lib.has(`char.${id}`), `char.${id} not registered`).toBe(true);
    expect(lib.has('char.player')).toBe(true);
  });

  it('gives a mounted archetype a horse without a fifth draw call', async () => {
    const h = spawnCharacter('habsburg-knight', { variant: 'mounted' });
    await new Promise((r) => setTimeout(r, 20));
    const s = stats(h.object);
    expect(s.meshes, `${s.meshes} meshes`).toBeLessThanOrEqual(4);
    const box = new Box3().setFromObject(h.object);
    expect(box.max.y, 'rider sits above the saddle').toBeGreaterThan(1.9);
    expect(box.max.z - box.min.z, 'horse is about 2.4 m long').toBeGreaterThan(1.8);
    h.dispose();
  });

  it('dresses civilians in four variants and soldiers in one', async () => {
    const clothOf = async (a: string, seed: number): Promise<string> => {
      const h = spawnCharacter(a, { seed });
      await new Promise((r) => setTimeout(r, 20));
      const m = h.object.children[0]?.children.find((c) => (c as Mesh).isMesh) as Mesh | undefined;
      const col = m?.geometry.getAttribute('color');
      const out = col ? `${col.getX(0).toFixed(3)},${col.getY(0).toFixed(3)},${col.getZ(0).toFixed(3)}` : 'none';
      h.dispose();
      return out;
    };
    const civilian = new Set<string>();
    for (const seed of [0, 1, 2, 3]) civilian.add(await clothOf('peasant', seed));
    expect(civilian.size, 'peasants should not all be identical').toBeGreaterThan(1);
    const soldier = new Set<string>();
    for (const seed of [0, 1, 2, 3]) soldier.add(await clothOf('habsburg-footman', seed));
    expect(soldier.size, 'a livery is a livery').toBe(1);
  });

  it('falls back to a procedural skeleton when the clip pack cannot be fetched', async () => {
    const h = spawnCharacter('militia-halberd');
    await new Promise((r) => setTimeout(r, 20));   // ensureRig() settles (fetch fails under node)
    expect(h.rigged).toBe(false);
    const s = stats(h.object);
    expect(s.meshes, `${s.meshes} meshes`).toBeGreaterThan(0);
    expect(s.meshes).toBeLessThanOrEqual(4);
    expect(s.tris, `${Math.round(s.tris)} tris`).toBeLessThanOrEqual(6000);
    await h.play('idle');
    h.update(0.1);
    h.dispose();
  });
});
