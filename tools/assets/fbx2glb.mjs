#!/usr/bin/env node
/**
 * FBX → GLB converter using the bundled headless Chromium + three.js (FBXLoader, GLTFExporter).
 *
 *   node tools/assets/fbx2glb.mjs <in.fbx> <out.glb> [--tex 1024] [--scale 0.01] [--strip-anims] [--quality 0.85]
 *
 * Textures embedded in the FBX are downscaled to at most `--tex` px on the long side and re-encoded as JPEG
 * (PNG when they carry alpha), so a 40 MB Mixamo FBX becomes a ~2–4 MB GLB. Mixamo FBX files are in cm:
 * `--scale 0.01` (default) bakes them to metres. Bone names are kept verbatim (mixamorig:*).
 * No blender, no native binary: a tiny static server serves node_modules/three and the input file to a page.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const [inFile, outFile] = args.filter((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1].startsWith('--')));
if (!inFile || !outFile) { console.error('usage: fbx2glb.mjs <in.fbx> <out.glb> [--tex 1024] [--scale 0.01] [--strip-anims] [--quality 0.85]'); process.exit(2); }
const TEX = Number(opt('--tex', 1024));
const SCALE = Number(opt('--scale', 0.01));
const QUALITY = Number(opt('--quality', 0.85));
const STRIP_ANIMS = args.includes('--strip-anims');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const inAbs = path.resolve(inFile);

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  let file;
  if (url === '/input.fbx') file = inAbs;
  else if (url === '/') {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><html><head><script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script></head><body></body></html>');
    return;
  }
  else file = path.join(root, url);
  if (!file.startsWith(root) && file !== inAbs) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    const ct = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.fbx') ? 'application/octet-stream' : 'application/octet-stream';
    res.writeHead(200, { 'content-type': ct, 'access-control-allow-origin': '*' });
    res.end(data);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await chromium.launch({ headless: true, executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.error('[page]', m.text()); });
await page.goto(`http://127.0.0.1:${port}/`);
const result = await page.evaluate(async ({ TEX, SCALE, QUALITY, STRIP_ANIMS }) => {
  const THREE = await import('/node_modules/three/build/three.module.js');
  const { FBXLoader } = await import('/node_modules/three/examples/jsm/loaders/FBXLoader.js');
  const { GLTFExporter } = await import('/node_modules/three/examples/jsm/exporters/GLTFExporter.js');
  const loader = new FBXLoader();
  const obj = await loader.loadAsync('/input.fbx');
  obj.scale.setScalar(SCALE);
  obj.updateMatrixWorld(true);
  // FBXLoader resolves before its (embedded, blob-URL) images exist or have decoded; wait for them, up to 15 s
  const SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'specularMap', 'bumpMap', 'alphaMap'];
  const textures = new Set();
  obj.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) for (const m of (Array.isArray(o.material) ? o.material : [o.material])) for (const slot of SLOTS) if (m[slot]?.isTexture) textures.add(m[slot]); });
  const t0 = performance.now();
  while (performance.now() - t0 < 15000) {
    let ready = true;
    for (const t of textures) { const img = t.image; if (!img || (typeof img.complete === 'boolean' && !img.complete)) { ready = false; break; } }
    if (ready) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  // downscale textures (and force sRGB colour space on colour maps)
  const seen = new Set();
  let texCount = 0, meshCount = 0, tris = 0; const missing = []; const texInfo = [];
  obj.traverse((o) => {
    if (o.isMesh || o.isSkinnedMesh) {
      meshCount++;
      const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        for (const k of Object.keys(m)) { const v = m[k]; if (v && v.isTexture) texInfo.push(`${o.name}/${m.name}.${k}=${v.image ? (v.image.constructor?.name + ':' + (v.image.width || v.image.naturalWidth) + 'x' + (v.image.height || v.image.naturalHeight) + ':' + v.image.complete) : 'noimage'}`); }
        for (const slot of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'specularMap', 'bumpMap']) {
          const t = m[slot];
          if (!t || !t.image || seen.has(t)) continue;
          seen.add(t); texCount++;
          const img = t.image;
          const w = img.width || img.naturalWidth, h = img.height || img.naturalHeight;
          texInfo.push(`${m.name}.${slot}:${img.constructor?.name}:${w}x${h}:complete=${img.complete}:src=${String(img.src ?? '').slice(0, 40)}`);
          if (!w || !h) { m[slot] = null; missing.push(`${m.name}.${slot}`); continue; } // external file the FBX only references
          const s = Math.min(1, TEX / Math.max(w, h));
          if (s < 1) {
            const c = document.createElement('canvas'); c.width = Math.round(w * s); c.height = Math.round(h * s);
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            t.image = c; t.needsUpdate = true;
          }
          if (slot === 'map' || slot === 'emissiveMap') t.colorSpace = THREE.SRGBColorSpace;
        }
        // Phong from FBX → Standard for PBR; keep textures
        if (m.isMeshPhongMaterial) {
          const std = new THREE.MeshStandardMaterial({ map: m.map ?? null, normalMap: m.normalMap ?? null, color: m.color, roughness: 0.85, metalness: 0.0, transparent: m.transparent, alphaTest: m.alphaTest, side: m.side, name: m.name });
          if (m.emissiveMap) std.emissiveMap = m.emissiveMap;
          if (Array.isArray(o.material)) o.material[o.material.indexOf(m)] = std; else o.material = std;
        }
      }
      o.castShadow = true; o.receiveShadow = true;
    }
  });
  const animations = STRIP_ANIMS ? [] : (obj.animations || []);
  const exporter = new GLTFExporter();
  let buf;
  try {
    buf = await new Promise((resolve, reject) => exporter.parse(obj, (r) => resolve(r), (e) => reject(e), { binary: true, animations, onlyVisible: false, embedImages: true, maxTextureSize: TEX, includeCustomExtensions: false }));
  } catch (e) { throw new Error(`${e.message} | textures: ${texInfo.join(' | ')}`); }
  const bytes = new Uint8Array(buf);
  // chunked base64 so a 10 MB buffer does not blow the stack
  let b64 = ""; const CH = 30000; // multiple of 3 so chunked base64 concatenates cleanly
  for (let i = 0; i < bytes.length; i += CH) b64 += btoa(String.fromCharCode.apply(null, bytes.subarray(i, i + CH)));
  const bones = []; obj.traverse((o) => { if (o.isBone) bones.push(o.name); });
  return { b64, size: bytes.length, meshCount, tris: Math.round(tris), texCount, anims: animations.map((a) => `${a.name}:${a.duration.toFixed(2)}s`), bones: bones.slice(0, 6), boneCount: bones.length, missing };
}, { TEX, SCALE, QUALITY, STRIP_ANIMS });
fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
fs.writeFileSync(outFile, Buffer.from(result.b64, 'base64'));
console.log(`${path.basename(inFile)} → ${outFile}: ${(result.size / 1048576).toFixed(2)} MB, ${result.meshCount} meshes, ${result.tris} tris, ${result.texCount} textures, ${result.boneCount} bones (${result.bones.join(', ')}…), anims: ${result.anims.join(', ') || 'none'}${result.missing.length ? `; MISSING textures: ${result.missing.join(', ')}` : ''}`);
await browser.close();
server.close();
