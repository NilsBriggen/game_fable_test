import { it } from 'vitest';
import { Box3, Vector3, SkinnedMesh, Mesh } from 'three';
import { spawnCharacter, updateCharacters } from '../../../../src/world/characters';

it('feet on the ground', async () => {
  const h = spawnCharacter('peasant', { seed: 3 });
  await new Promise((r) => setTimeout(r, 300));
  for (let i = 0; i < 10; i++) updateCharacters(1 / 60);
  h.object.updateMatrixWorld(true);
  const box = new Box3();
  h.object.traverse((o) => {
    const m = o as SkinnedMesh;
    if ((m as Mesh).isMesh) {
      if (m.isSkinnedMesh) { m.computeBoundingBox(); const b = new Box3(); m.boundingBox && b.copy(m.boundingBox); /* skinned bbox is in bind space */ }
      const g = (m as Mesh).geometry; g.computeBoundingBox(); const b = g.boundingBox!.clone().applyMatrix4(m.matrixWorld); box.union(b);
    }
  });
  const bones: string[] = [];
  h.object.traverse((o) => { if ((o as any).isBone && ['root', 'hips', 'foot.l', 'foot_l', 'DEF-foot.L'].some((n) => o.name.toLowerCase().includes(n.toLowerCase()))) { const p = new Vector3(); o.getWorldPosition(p); bones.push(`${o.name}=${p.y.toFixed(2)}`); } });
  console.log('rigged', h.rigged, 'bbox y', box.min.y.toFixed(2), box.max.y.toFixed(2), 'bones', bones.join(' '));
});
