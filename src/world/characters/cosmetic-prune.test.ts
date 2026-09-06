/** Cosmetic-mesh pruning for downloaded bodies (tri-budget: the Erika eyelash mesh alone is
 *  37 710 verts / 2.1 MB per instance in the Altdorf crowd scenes). Pure three.js Object3D
 *  manipulation — no loader, no DOM — so it runs in node tests. */
import { describe, expect, it } from 'vitest';
import { Group, Mesh, BufferGeometry } from 'three';
import { pruneCosmeticMeshes } from '../characterAssets';

function fakeMesh(name: string): Mesh {
  const m = new Mesh(new BufferGeometry(), undefined as never);
  m.name = name;
  return m;
}

describe('pruneCosmeticMeshes', () => {
  it('removes the Erika eyelash mesh and keeps body/clothes/eyes', () => {
    const root = new Group();
    const keep = ['Erika_Archer_Body_Mesh', 'Erika_Archer_Clothes_Mesh', 'Erika_Archer_Eyes_Mesh'];
    for (const n of [...keep, 'Erika_Archer_Eyelashes_Mesh']) root.add(fakeMesh(n));
    const pruned = pruneCosmeticMeshes(root);
    expect(pruned).toEqual(['Erika_Archer_Eyelashes_Mesh']);
    const names = root.children.map((c) => c.name).sort();
    expect(names).toEqual([...keep].sort());
  });

  it('is a no-op on a template with no cosmetic meshes', () => {
    const root = new Group();
    root.add(fakeMesh('peasant-torso'));
    expect(pruneCosmeticMeshes(root)).toEqual([]);
    expect(root.children).toHaveLength(1);
  });
});
