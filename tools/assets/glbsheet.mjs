#!/usr/bin/env node
/**
 * Render a GLB (optionally driving it with an animation GLB whose clip targets the same bone names) to a PNG,
 * using the bundled headless Chromium + three.js. Evidence tool for converted characters.
 *
 *   node tools/assets/glbsheet.mjs <model.glb> <out.png> [--anim clip.glb] [--t 0.6] [--dist 3.2] [--yaw 0.6] [--size 900x1100]
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const pos = args.filter((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1].startsWith('--')));
const [modelFile, outFile] = pos;
if (!modelFile || !outFile) { console.error('usage: glbsheet.mjs <model.glb> <out.png> [--anim clip.glb] [--t 0.6] [--dist 3.2] [--yaw 0.6] [--size WxH]'); process.exit(2); }
const ANIM = opt('--anim', null);
const T = Number(opt('--t', 0.6));
const DIST = Number(opt('--dist', 3.2));
const YAW = Number(opt('--yaw', 0.6));
const [W, H] = String(opt('--size', '900x1100')).split('x').map(Number);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const files = { '/model.glb': path.resolve(modelFile), ...(ANIM ? { '/anim.glb': path.resolve(ANIM) } : {}) };

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><html><head><script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script><style>body{margin:0;background:#88a}</style></head><body></body></html>'); return; }
  const file = files[url] ?? path.join(root, url);
  fs.readFile(file, (err, data) => { if (err) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' }); res.end(data); });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const browser = await chromium.launch({ headless: true, executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('console', (m) => { if (m.type() === 'error') console.error('[page]', m.text()); });
await page.goto(`http://127.0.0.1:${port}/`);
const info = await page.evaluate(async ({ ANIM, T, DIST, YAW, W, H }) => {
  const THREE = await import('three');
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(W, H); renderer.shadowMap.enabled = true; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  document.body.appendChild(renderer.domElement);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x8890a8);
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.6); sun.position.set(3, 6, 4); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x6a5a40, 1.1));
  const ground = new THREE.Mesh(new THREE.CircleGeometry(3, 48), new THREE.MeshStandardMaterial({ color: 0x8a7a5a, roughness: 1 })); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync('/model.glb');
  const model = gltf.scene; scene.add(model);
  model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const norm = (n) => n.replace(/[:\s]/g, '');
  let clipName = null, tracks = 0, bound = 0;
  if (ANIM) {
    const a = await loader.loadAsync('/anim.glb');
    const clip = a.animations[0];
    clipName = clip.name; tracks = clip.tracks.length;
    // bone-name lookup ignoring the ':' the exporter strips; rotation tracks only, hips position scaled by hip height
    const bones = new Map(); model.traverse((o) => { if (o.isBone) bones.set(norm(o.name), o); });
    let srcHipY = 1; a.scene.traverse((o) => { if (o.isBone && /Hips$/.test(norm(o.name))) srcHipY = o.position.y || 1; });
    let dstHipY = 1; model.traverse((o) => { if (o.isBone && /Hips$/.test(norm(o.name))) dstHipY = o.position.y || 1; });
    const scale = dstHipY / srcHipY;
    const kept = [];
    for (const t of clip.tracks) {
      const [nodeName, prop] = t.name.split('.');
      const b = bones.get(norm(nodeName)); if (!b) continue;
      if (prop === 'quaternion') { kept.push(new THREE.QuaternionKeyframeTrack(`${b.uuid}.quaternion`, t.times, t.values)); bound++; }
      else if (prop === 'position' && /Hips$/.test(norm(nodeName))) { kept.push(new THREE.VectorKeyframeTrack(`${b.uuid}.position`, t.times, Float32Array.from(t.values, (v) => v * scale))); bound++; }
    }
    const mixer = new THREE.AnimationMixer(model);
    const action = mixer.clipAction(new THREE.AnimationClip(clip.name, clip.duration, kept)); action.play(); mixer.update(T);
  }
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model); const c = box.getCenter(new THREE.Vector3()); const hgt = box.max.y - box.min.y;
  const cam = new THREE.PerspectiveCamera(32, W / H, 0.1, 100);
  cam.position.set(c.x + Math.sin(YAW) * DIST, c.y + hgt * 0.15, c.z + Math.cos(YAW) * DIST); cam.lookAt(c.x, c.y, c.z);
  renderer.render(scene, cam);
  await new Promise((r) => setTimeout(r, 50));
  return { height: hgt.toFixed(2), minY: box.min.y.toFixed(2), clipName, tracks, bound };
}, { ANIM, T, DIST, YAW, W, H });
await page.screenshot({ path: outFile });
console.log(`${path.basename(modelFile)} → ${outFile}: height ${info.height} m, minY ${info.minY}${info.clipName ? `, clip ${info.clipName} (${info.bound}/${info.tracks} tracks bound)` : ''}`);
await browser.close();
server.close();
