import { it } from 'vitest';
import fs from 'node:fs';
(globalThis as any).fetch = async (url: string) => {
  const p = 'public/' + String(url).replace(/^\/?/, '');
  console.log('fetch shim', url, fs.existsSync(p));
  const buf = fs.readFileSync(p);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return { ok: true, arrayBuffer: async () => ab } as any;
};
const { loadRigAnims } = await import('../../../../src/world/assets');
it('loads the pack', async () => {
  try { const a = await loadRigAnims(); console.log('anims', a ? `${a.skeleton.length} bones, ${a.clips.length} clips, bind.hips=${JSON.stringify(a.bind.hips)}` : null); }
  catch (e) { console.log('threw', String(e)); }
});
