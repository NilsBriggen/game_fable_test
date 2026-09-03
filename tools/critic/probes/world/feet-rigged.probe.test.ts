import { it } from 'vitest';
import fs from 'node:fs';
import { Box3, Vector3, Mesh, SkinnedMesh, TextureLoader, Texture, Matrix4 } from 'three';
(TextureLoader.prototype as any).load = () => new Texture();

// shim fetch for the clip pack so the RIGGED path runs in node
(globalThis as any).fetch = async (url: string) => {
  const p = 'public/' + String(url).replace(/^\/?/, '');
  const buf = fs.readFileSync(p);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return { ok: true, arrayBuffer: async () => ab } as any;
};
const { spawnCharacter, updateCharacters } = await import('../../../../src/world/characters');

it('rigged feet on the ground', async () => {
  const h = spawnCharacter('peasant', { seed: 3 });
  await new Promise((r) => setTimeout(r, 1500));
  for (let i = 0; i < 30; i++) updateCharacters(1 / 60);
  h.object.updateMatrixWorld(true);
  const bones: string[] = [];
  h.object.traverse((o) => { if ((o as any).isBone) { const n = o.name.toLowerCase(); if (/root|hips|foot|toe/.test(n)) { const p = new Vector3(); o.getWorldPosition(p); bones.push(`${o.name}=${p.y.toFixed(2)}`); } } });
  // skinned bbox: transform each vertex by its skin — approximate via skeleton bone positions min y
  let minBone = Infinity; h.object.traverse((o) => { if ((o as any).isBone) { const p = new Vector3(); o.getWorldPosition(p); minBone = Math.min(minBone, p.y); } });
  console.log('rigged', h.rigged, 'minBoneY', minBone.toFixed(2), bones.join(' '));
});

it('rigged skinned-vertex extent', async () => {
  const h = spawnCharacter('militia-spear', { seed: 5 });
  await new Promise((r) => setTimeout(r, 800));
  for (let i = 0; i < 30; i++) updateCharacters(1 / 60);
  h.object.updateMatrixWorld(true);
  let minY = Infinity, maxY = -Infinity, n = 0;
  h.object.traverse((o) => {
    const m = o as SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    const g = m.geometry; const pos = g.attributes.position; const si = g.attributes.skinIndex; const sw = g.attributes.skinWeight;
    const sk = m.skeleton; sk.update();
    
    const tmp = new Vector3(), acc = new Vector3(), bm = new Matrix4();
    for (let i = 0; i < pos.count; i += 7) {
      acc.set(0, 0, 0);
      for (let k = 0; k < 4; k++) {
        const w = sw.getComponent(i, k); if (w === 0) continue;
        const bi = si.getComponent(i, k);
        bm.multiplyMatrices(sk.bones[bi].matrixWorld, sk.boneInverses[bi]);
        tmp.fromBufferAttribute(pos, i).applyMatrix4(m.bindMatrix).applyMatrix4(bm);
        acc.addScaledVector(tmp, w);
      }
      minY = Math.min(minY, acc.y); maxY = Math.max(maxY, acc.y); n++;
    }
  });
  console.log('skinned extent rigged', h.rigged, 'minY', minY.toFixed(2), 'maxY', maxY.toFixed(2), 'samples', n);
});
