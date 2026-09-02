#!/usr/bin/env node
/** Enforces ARCHITECTURE.md §0 import rules: feature modules may import only from @core, @content, three, their own dir. */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const modules = ['world', 'save', 'exploration', 'combat', 'party', 'quest', 'ui'];
let bad = 0;
async function walk(dir) { const out = []; for (const e of await readdir(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) out.push(...(await walk(p))); else if (/\.(ts|tsx)$/.test(e.name)) out.push(p); } return out; }
for (const m of modules) {
  const dir = path.join(root, 'src', m);
  let files = [];
  try { files = await walk(dir); } catch { continue; }
  for (const f of files) {
    const src = await readFile(f, 'utf8');
    for (const match of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const spec = match[1];
      if (spec.startsWith('.')) {
        const resolved = path.resolve(path.dirname(f), spec);
        if (!resolved.startsWith(dir) && !resolved.startsWith(path.join(root, 'src/core')) && !resolved.startsWith(path.join(root, 'src/content'))) { console.log(`${path.relative(root, f)}: illegal relative import ${spec}`); bad++; }
      } else if (!(spec.startsWith('@core') || spec.startsWith('@content') || spec === 'three' || spec.startsWith('three/') || spec.startsWith('vitest') || spec.startsWith('node:'))) {
        for (const other of modules) if (other !== m && (spec.includes(`/src/${other}/`) || spec.startsWith(`@${other}`))) { console.log(`${path.relative(root, f)}: cross-module import ${spec}`); bad++; }
      }
    }
  }
}
console.log(bad ? `${bad} import violations` : 'imports ok');
process.exit(bad ? 1 : 0);
