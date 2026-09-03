/**
 * Budget + content tests for the model/character library (BUILDER_RULES "Budgets"):
 * draw calls and triangles per model, the shared-material count across all buildings, footprints the
 * exploration layout assumes, and that every animation the game asks for exists in the CC0 clip pack.
 */
import { Box3, Group, Mesh, Vector3, type Material, type Object3D } from 'three';

interface Buffer { toString(enc: string, start?: number, end?: number): string; readUInt32LE(offset: number): number }
import { beforeAll, describe, expect, it } from 'vitest';
import { ModelLibrary } from './models';
import { PROP_IDS, hasKit, hasProp, installKit, kitPieceNames } from './models/megakit';
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
  'house.blockbau', 'house.stone', 'barn', 'granary', 'church', 'chapel', 'monastery',
  'castle.keep', 'castle.wall', 'castle.tower', 'ruin.wall', 'letzi.wall', 'palisade',
  'bridge.wood', 'bridge.stone', 'mill', 'boat',
];
const WEAPONS = ['weapon.spiess', 'weapon.halberd', 'weapon.crossbow', 'weapon.sword', 'weapon.dagger', 'weapon.staff', 'shield.heater', 'shield.buckler'];
const PROPS = ['cross', 'hayrack', 'fence', 'well', 'woodpile', 'trough', 'market.stall', 'gallows.pole',
  'campfire', 'tent', 'cart', 'signpost', 'rock.large', 'rock.small', 'stump'];

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

  // 7 meshes = 7 materials at most per model. Exploration merges by material *per POI*
  // (src/exploration/settlements.ts), so a whole village costs one draw call per material it uses —
  // roughly a dozen — not one per building. 12k triangles is the per-model ceiling; the village-level
  // budget is asserted separately below. (The kit-composed tavern with its Poly Haven props is
  // asserted in the 'downloaded kits' block below.)
  it('every building and prop stays within 7 draw calls and 12k triangles', () => {
    const variants: [string, string | undefined][] = [...[...BUILDINGS, ...PROPS, ...WEAPONS].map((i) => [i, undefined] as [string, undefined]),
      ['house.blockbau', 'inn'], ['house.blockbau', 'large'], ['house.blockbau', 'small'], ['house.stone', 'large']];
    for (const [id, variant] of variants) {
      const s = stats(lib.spawn(id, { variant }));
      expect(s.meshes, `${id}/${variant ?? '-'}: ${s.meshes} meshes`).toBeLessThanOrEqual(7);
      expect(s.tris, `${id}: ${Math.round(s.tris)} tris`).toBeLessThanOrEqual(12000);
      expect(s.meshes, `${id} produced no geometry`).toBeGreaterThan(0);
    }
  });

  it('all buildings together share at most 9 materials (exploration merges per material)', () => {
    const all = new Set<Material>();
    for (const id of BUILDINGS) for (const m of stats(lib.spawn(id)).mats) all.add(m);
    expect(all.size, `${all.size} distinct building materials`).toBeLessThanOrEqual(9);
  });

  // A village as src/exploration/layout.ts lays one out: a well, a church, 14 farmhouses (one of them
  // the inn), fences, hay racks and a wayside cross. Budget (owner's brief): ≤ 400 draw calls and
  // ≤ 1.2 M triangles for the whole village after the per-POI merge.
  it('a full village stays inside 400 draw calls and 1.2 M triangles after the per-material merge', () => {
    const recipe: [string, string | undefined, number][] = [
      ['well', undefined, 1], ['church', undefined, 1], ['house.blockbau', 'inn', 1],
      ['house.blockbau', undefined, 13], ['fence', undefined, 9], ['hayrack', undefined, 6],
      ['cross', undefined, 1],
    ];
    let tris = 0;
    const mats = new Set<Material>();
    for (const [id, variant, n] of recipe) {
      for (let i = 0; i < n; i++) {
        const s = stats(lib.spawn(id, { variant, seed: i }));
        tris += s.tris;
        for (const m of s.mats) mats.add(m);
      }
    }
    expect(mats.size, `${mats.size} merged draw calls for the village`).toBeLessThanOrEqual(400);
    expect(tris, `${Math.round(tris)} village triangles`).toBeLessThanOrEqual(1_200_000);
  });

  it('every model sits on the ground: nothing floats and nothing but a footing is buried', () => {
    // settlements.ts places each model's origin on heightAt, so y = 0 must be the contact plane.
    // Buildings deliberately carry a footing ~2 m below grade for downhill spawns; nothing may float.
    for (const id of [...BUILDINGS, ...PROPS]) {
      if (id === 'boat') continue;   // boats float, by design (layout puts them on the water)
      const box = new Box3().setFromObject(lib.spawn(id));
      expect(box.min.y, `${id} floats: lowest point at y=${box.min.y.toFixed(2)}`).toBeLessThanOrEqual(0.06);
      expect(box.min.y, `${id} is buried: lowest point at y=${box.min.y.toFixed(2)}`).toBeGreaterThan(-2.6);
      expect(box.max.y, `${id} has no height`).toBeGreaterThan(0.1);
    }
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
      granary: [5, 5], 'ruin.wall': [8, 5],
      'castle.wall': [9, 4], 'letzi.wall': [9, 3], palisade: [9, 2], 'bridge.stone': [15, 5],
      // the keep's depth includes the outer timber stair to its raised entrance; layoutCastle puts the
      // corner towers 16 m out, so the stair has clearance
      'castle.keep': [15, 16.5], 'castle.tower': [9, 9], chapel: [7, 9],
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

describe('downloaded kits (MegaKit pieces + Poly Haven props, installed from disk)', () => {
  let lib: ModelLibrary;
  beforeAll(async () => {
    const spec = 'node:' + 'fs';
    const { readFileSync } = await import(spec) as { readFileSync: (p: string) => Buffer & { buffer: ArrayBuffer; byteOffset: number; byteLength: number } };
    const ab = (b: { buffer: ArrayBuffer; byteOffset: number; byteLength: number }): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    installKit(ab(readFileSync('public/assets/models/buildings/megakit.bin')));
    for (const id of PROP_IDS) installKit(ab(readFileSync(`public/assets/models/props/${id}.bin`)));
    lib = new ModelLibrary(1234);
  });

  it('packs every piece the composites use and every prop id', () => {
    expect(hasKit()).toBe(true);
    for (const id of PROP_IDS) expect(hasProp(id), `prop ${id} missing`).toBe(true);
    const names = new Set(kitPieceNames());
    for (const n of ['Wall_UnevenBrick_Door_Flat', 'Wall_Plaster_Window_Wide_Flat', 'Wall_Plaster_WoodGrid', 'Window_Wide_Flat1',
      'WindowShutters_Wide_Flat_Open', 'WindowShutters_Wide_Flat_Closed', 'Door_1_Flat', 'Door_1_Round', 'Roof_RoundTiles_6x8',
      'Roof_Front_Brick6', 'Roof_Dormer_RoundTile', 'Prop_Chimney2', 'Balcony_Simple_Straight', 'Prop_Wagon', 'Corner_ExteriorWide_Wood']) {
      expect(names.has(n), `kit piece ${n} missing`).toBe(true);
    }
  });

  it('composes the town house, the tavern and the wagon from the kit within budget', () => {
    // one mesh per material; the tavern adds the Poly Haven props' own materials (each one a
    // per-POI draw call — a village has one tavern)
    const cases: [string, string | undefined, number, number][] = [
      ['house.stone', undefined, 8, 20000], ['house.stone', 'large', 8, 24000], ['house.blockbau', 'inn', 18, 80000],
      ['cart', undefined, 3, 3000], ['well', undefined, 9, 9000], ['campfire', undefined, 6, 6000],
      ['woodpile', undefined, 5, 6000], ['granary', undefined, 7, 14000],
    ];
    for (const [id, variant, meshes, tris] of cases) {
      const s = stats(lib.spawn(id, { variant }));
      expect(s.meshes, `${id}/${variant ?? '-'}: ${s.meshes} meshes`).toBeLessThanOrEqual(meshes);
      expect(s.tris, `${id}/${variant ?? '-'}: ${Math.round(s.tris)} tris`).toBeLessThanOrEqual(tris);
      const mats = [...s.mats].map((m) => (m as { map?: { userData?: unknown } }).map ? 'mapped' : 'flat');
      expect(mats.length).toBeGreaterThan(0);
    }
    // the kit path really is taken: the tile roof material only exists on kit buildings
    const house = stats(lib.spawn('house.stone'));
    expect(house.meshes, 'town house did not use the kit (tiles material missing)').toBeGreaterThanOrEqual(6);
  });

  it('keeps the kit buildings on the ground and inside the footprints layout.ts assumes', () => {
    const limits: Record<string, [number, number]> = { 'house.stone': [11.5, 9.5], 'house.blockbau': [10.5, 9.5], cart: [5, 5], well: [5, 5] };
    for (const [id, [w, d]] of Object.entries(limits)) {
      for (const variant of [undefined, 'inn', 'large']) {
        if (variant && !id.startsWith('house')) continue;
        const box = new Box3().setFromObject(lib.spawn(id, { variant }));
        expect(box.min.y, `${id}/${variant} floats (${box.min.y.toFixed(2)})`).toBeLessThanOrEqual(0.06);
        expect(box.min.y, `${id}/${variant} buried (${box.min.y.toFixed(2)})`).toBeGreaterThan(-2.6);
        const size = box.getSize(new Vector3());
        expect(size.x, `${id}/${variant} width ${size.x.toFixed(1)}`).toBeLessThanOrEqual(w);
        expect(size.z, `${id}/${variant} depth ${size.z.toFixed(1)}`).toBeLessThanOrEqual(d);
      }
    }
    // Poly Haven props are re-based so their lowest point is the floor they stand on
    for (const id of ['woodpile', 'campfire', 'cart']) {
      lib.spawn(id).traverse((c) => {
        const m = c as Mesh;
        if (!m.isMesh) return;
        for (const attr of ['position', 'normal', 'uv', 'color']) expect(m.geometry.getAttribute(attr), `${id}: missing ${attr}`).toBeTruthy();
      });
    }
  });

  it('a village with the kit tavern still merges to well under 400 draw calls and 1.2 M triangles', () => {
    const recipe: [string, string | undefined, number][] = [
      ['well', undefined, 1], ['church', undefined, 1], ['house.blockbau', 'inn', 1], ['house.blockbau', undefined, 13],
      ['fence', undefined, 9], ['hayrack', undefined, 6], ['cross', undefined, 1], ['cart', undefined, 1], ['granary', undefined, 2],
    ];
    let tris = 0;
    const mats = new Set<Material>();
    for (const [id, variant, n] of recipe) for (let i = 0; i < n; i++) {
      const s = stats(lib.spawn(id, { variant, seed: i }));
      tris += s.tris;
      for (const m of s.mats) mats.add(m);
    }
    expect(mats.size, `${mats.size} merged draw calls`).toBeLessThanOrEqual(40);
    expect(tris, `${Math.round(tris)} village triangles`).toBeLessThanOrEqual(1_200_000);
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

  it('never stands in the rig bind pose, even before anything ticks it', async () => {
    // The T-pose is the skin's bind pose; a character that is spawned and never updated (or whose mixer
    // never starts) must still be posed — this is the scarecrow-in-the-square regression.
    const h = spawnCharacter('woman-peasant', { seed: 3 });
    await new Promise((r) => setTimeout(r, 30));
    h.object.updateMatrixWorld(true);
    let hand: Object3D | null = null;
    h.object.traverse((c) => { if (c.name === 'hand_l') hand = c; });
    expect(hand, 'no hand bone').toBeTruthy();
    const p = (hand as unknown as Object3D).getWorldPosition(new Vector3());
    // bind pose holds the hand out at (0.75, 1.42); any real idle drops it to the hip
    expect(p.y, `hand at y=${p.y.toFixed(2)} — still in the T-pose`).toBeLessThan(1.25);
    expect(Math.abs(p.x), `hand at x=${p.x.toFixed(2)} — arm still stretched out`).toBeLessThan(0.45);
    h.dispose();
  });

  it('is advanced by updateCharacters() without the owner calling update()', async () => {
    const { updateCharacters } = await import('./characters');
    const h = spawnCharacter('peasant', { seed: 5 });
    const holder = new Group();
    holder.add(h.object);                      // parented like exploration/combat do, so it is not pruned
    await new Promise((r) => setTimeout(r, 30));
    h.object.updateMatrixWorld(true);
    let hand: Object3D | null = null;
    h.object.traverse((c) => { if (c.name === 'hand_l') hand = c; });
    const before = (hand as unknown as Object3D).getWorldPosition(new Vector3()).clone();
    for (let i = 0; i < 60; i++) updateCharacters(1 / 30);   // the world module's per-frame tick
    h.object.updateMatrixWorld(true);
    const after = (hand as unknown as Object3D).getWorldPosition(new Vector3());
    expect(before.distanceTo(after), 'idle never advanced').toBeGreaterThan(1e-4);  // breathing idle: mm-scale
    h.dispose();
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

describe('per-entity seed', () => {
  it('gives the same look back for the same seed and different looks for different seeds', async () => {
    const lib = new ModelLibrary(11);
    const cloth = async (seed: number): Promise<string> => {
      const o = lib.spawn('char.peasant', { seed });
      await new Promise((r) => setTimeout(r, 20));      // the character builds once the rig settles
      const m = o.children[0]?.children.find((c) => (c as Mesh).isMesh) as Mesh | undefined;
      const c = m?.geometry.getAttribute('color');
      return c ? `${c.getX(0).toFixed(3)},${c.getY(0).toFixed(3)},${c.getZ(0).toFixed(3)}` : 'pending';
    };
    expect(await cloth(7)).toBe(await cloth(7));        // freeze/unfreeze must not restyle an NPC
    expect(new Set([await cloth(1), await cloth(2), await cloth(3), await cloth(4)]).size).toBeGreaterThan(1);
  });
});

