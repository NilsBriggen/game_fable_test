#!/usr/bin/env node
/**
 * Reproducible asset fetch + convert for public/assets/**, driven by tools/assets/manifest.json.
 *   node tools/assets/fetch.mjs [--only textures|terrain|characters] [--force]
 * No new npm deps: downloads with global fetch, unzips with the `unzip` CLI, resizes/re-encodes JPEGs in
 * the Playwright Chromium the harness already uses, and re-packs the CC0 animation clips itself.
 * Writes public/assets/CREDITS-models.md (one row per committed file) at the end.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'tools/assets/manifest.json'), 'utf8'));
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const FORCE = args.includes('--force');
const CACHE = path.join(os.tmpdir(), 'eidgenossen-assets');
fs.mkdirSync(CACHE, { recursive: true });

const credits = []; // { file, source, author, licence, bytes }

function log(...m) { console.log('[assets]', ...m); }

async function download(url, name, init) {
  const file = path.join(CACHE, `${createHash('sha1').update(url + (init?.body ?? '')).digest('hex').slice(0, 12)}-${name}`);
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return file;
  log('GET', url.slice(0, 110));
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

function unzip(zip, dest, patterns = []) {
  fs.mkdirSync(dest, { recursive: true });
  execFileSync('unzip', ['-q', '-o', zip, ...patterns, '-d', dest], { stdio: 'inherit' });
  return dest;
}

// ---------------- image conversion (headless Chromium canvas) ----------------

let browser = null, page = null;
async function imagePage() {
  if (page) return page;
  const { chromium } = await import('playwright');
  const exe = process.env.HARNESS_CHROMIUM || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  browser = await chromium.launch(exe ? { executablePath: exe } : {});
  page = await browser.newPage();
  await page.setContent('<canvas id="c"></canvas>');
  return page;
}

/** Resize `src` to at most `size` px on its long edge and re-encode as JPEG at quality `q`. */
async function convertJpeg(src, dst, size, q) {
  const p = await imagePage();
  const data = 'data:image/jpeg;base64,' + fs.readFileSync(src).toString('base64');
  const out = await p.evaluate(async ([data, size, q]) => {
    const img = new Image();
    img.src = data;
    await img.decode();
    const s = Math.min(1, size / Math.max(img.width, img.height));
    const c = document.getElementById('c');
    c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', q);
  }, [data, size, q]);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, Buffer.from(out.slice(out.indexOf(',') + 1), 'base64'));
}

// ---------------- ambientCG materials ----------------

async function fetchTexture(entry) {
  const src = manifest.sources[entry.source];
  const url = src.urlTemplate.replace('{ASSET}', entry.asset);
  const profile = manifest.textureProfiles[entry.profile];
  const targetDir = path.join(root, entry.target);
  const done = Object.keys(profile).every((k) => fs.existsSync(path.join(targetDir, `${k}.jpg`)));
  if (done && !FORCE) { recordTexture(entry, url, src, profile); return; }
  const zip = await download(url, `${entry.asset}.zip`);
  const dir = unzip(zip, path.join(CACHE, entry.asset));
  for (const [out, spec] of Object.entries(profile)) {
    const file = fs.readdirSync(dir).find((f) => f.endsWith(`_${spec.src}.jpg`));
    if (!file) throw new Error(`${entry.asset}: no ${spec.src} map`);
    await convertJpeg(path.join(dir, file), path.join(targetDir, `${out}.jpg`), spec.size, spec.q);
  }
  recordTexture(entry, url, src, profile);
}

function recordTexture(entry, url, src, profile) {
  for (const out of Object.keys(profile)) {
    const rel = path.join(entry.target, `${out}.jpg`).replace(/^public\//, '');
    const abs = path.join(root, entry.target, `${out}.jpg`);
    credits.push({ file: rel, url, author: src.author, licence: src.licence, bytes: fs.statSync(abs).size, note: `${entry.asset} ${out}` });
  }
}

// ---------------- itch.io free-download flow ----------------

async function itchDownload(it) {
  const base = `https://${it.user}.itch.io`;
  const page = await (await fetch(`${base}/${it.slug}`)).text();
  const token = /csrf_token" value="([^"]*)"/.exec(page)?.[1];
  if (!token) throw new Error('itch: no csrf token');
  const cookies = 'itchio_token=1';
  const post = async (url, tok) => {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-requested-with': 'XMLHttpRequest', cookie: cookies },
      body: new URLSearchParams({ csrf_token: tok }).toString(),
    });
    return r.json();
  };
  // The page's own token is bound to the session cookie itch sets; fetch keeps none, so redo the handshake
  // with a cookie jar of our own.
  const jar = new Map();
  const withJar = async (url, init = {}) => {
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const r = await fetch(url, { ...init, headers: { ...(init.headers || {}), ...(cookie ? { cookie } : {}) }, redirect: 'follow' });
    for (const c of r.headers.getSetCookie?.() ?? []) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i), kv.slice(i + 1)); }
    return r;
  };
  const html = await (await withJar(`${base}/${it.slug}`)).text();
  const tok = /csrf_token" value="([^"]*)"/.exec(html)?.[1];
  const dl = await (await withJar(`${base}/${it.slug}/download_url`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-requested-with': 'XMLHttpRequest' },
    body: new URLSearchParams({ csrf_token: tok }).toString(),
  })).json();
  const dlHtml = await (await withJar(dl.url)).text();
  const tok2 = /csrf_token" value="([^"]*)"/.exec(dlHtml)?.[1];
  const file = await (await withJar(`${base}/${it.slug}/file/${it.upload}?source=game_download`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-requested-with': 'XMLHttpRequest' },
    body: new URLSearchParams({ csrf_token: tok2 }).toString(),
  })).json();
  void post;
  return { url: file.url, page: `${base}/${it.slug}` };
}

// ---------------- GLB clip extraction → .anims.bin ----------------

function readGlb(file) {
  const buf = fs.readFileSync(file);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const binStart = 20 + jsonLen + 8;
  return { json, bin: buf.subarray(binStart) };
}

const COMP = { 5120: [Int8Array, 1], 5121: [Uint8Array, 1], 5122: [Int16Array, 2], 5123: [Uint16Array, 2], 5125: [Uint32Array, 4], 5126: [Float32Array, 4] };
const NUM = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

function accessor(glb, i) {
  const a = glb.json.accessors[i];
  const bv = glb.json.bufferViews[a.bufferView];
  const [Type, size] = COMP[a.componentType];
  const n = NUM[a.type];
  const start = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const out = new Float32Array(a.count * n);
  const view = new Type(glb.bin.buffer, glb.bin.byteOffset + start, a.count * n);
  const norm = a.normalized ? { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }[a.componentType] : 0;
  for (let k = 0; k < out.length; k++) out[k] = norm ? Math.max(-1, view[k] / norm) : view[k];
  void size;
  return out;
}

/** World-space bind translation of every node, from the file's own rest transforms. */
function bindWorld(json) {
  const out = {};
  const mul = (a, b) => { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; };
  const trs = (n) => {
    if (n.matrix) return n.matrix;
    const t = n.translation || [0, 0, 0], [x, y, z, w] = n.rotation || [0, 0, 0, 1], s = n.scale || [1, 1, 1];
    const x2 = x + x, y2 = y + y, z2 = z + z, xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
    return [(1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0, (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
      (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0, t[0], t[1], t[2], 1];
  };
  const walk = (i, parent) => {
    const m = mul(parent, trs(json.nodes[i]));
    if (json.nodes[i].name) out[json.nodes[i].name] = [m[12], m[13], m[14]];
    for (const c of json.nodes[i].children || []) walk(c, m);
  };
  for (const s of json.scenes[0].nodes) walk(s, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  return out;
}

const ROOT_POS_BONES = new Set(['root', 'hips']);

function packAnims(entry, dir) {
  const floats = [];
  const push = (arr) => { const off = floats.length; for (const v of arr) floats.push(v); return { off, len: arr.length }; };
  const clips = [];
  let bones = null, bind = null;
  for (const cf of entry.clipFiles) {
    const glb = readGlb(path.join(dir, cf.file));
    if (!bones) {
      bind = bindWorld(glb.json);
      bones = glb.json.nodes.filter((n) => n.mesh === undefined && n.name && bind[n.name]).map((n) => n.name);
    }
    for (const name of cf.clips) {
      const anim = glb.json.animations.find((a) => a.name === name);
      if (!anim) { console.warn('[assets] missing clip', name, 'in', cf.file); continue; }
      const tracks = [];
      let duration = 0;
      for (const ch of anim.channels) {
        const bone = glb.json.nodes[ch.target.node].name;
        const path_ = ch.target.path;
        if (path_ === 'scale') continue;
        if (path_ === 'translation' && !ROOT_POS_BONES.has(bone)) continue;
        const s = anim.samplers[ch.sampler];
        if (s.interpolation && s.interpolation !== 'LINEAR') console.warn('[assets]', name, bone, 'interpolation', s.interpolation);
        const times = accessor(glb, s.input);
        const values = accessor(glb, s.output);
        duration = Math.max(duration, times[times.length - 1]);
        tracks.push({ bone, path: path_ === 'rotation' ? 'quaternion' : 'position', times: push(times), values: push(values) });
      }
      clips.push({ name, duration, tracks });
    }
  }
  const header = Buffer.from(JSON.stringify({ bones, bind, clips }), 'utf8');
  const data = Buffer.from(new Float32Array(floats).buffer);
  const out = Buffer.alloc(8 + header.length + data.length);
  out.write('EANM', 0, 'ascii');
  out.writeUInt32LE(header.length, 4);
  header.copy(out, 8);
  data.copy(out, 8 + header.length);
  return out;
}

async function fetchCharacters(entry) {
  const src = manifest.sources[entry.source];
  const { url, page: pageUrl } = await itchDownload(entry.itch);
  const zip = await download(url, entry.itch.file);
  const dir = unzip(zip, path.join(CACHE, entry.id));
  const inner = fs.readdirSync(dir).find((f) => fs.statSync(path.join(dir, f)).isDirectory());
  const base = path.join(dir, inner);
  const bin = packAnims(entry, base);
  const target = path.join(root, entry.target);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bin);
  credits.push({ file: entry.target.replace(/^public\//, ''), url: pageUrl, author: src.author, licence: src.licence, bytes: bin.length, note: 'Rig_Medium animation clips, re-packed' });
  if (entry.licenceFile) {
    const lt = path.join(root, entry.licenceFile.target);
    fs.mkdirSync(path.dirname(lt), { recursive: true });
    fs.copyFileSync(path.join(base, entry.licenceFile.file), lt);
    credits.push({ file: entry.licenceFile.target.replace(/^public\//, ''), url: pageUrl, author: src.author, licence: src.licence, bytes: fs.statSync(lt).size, note: 'upstream licence text' });
  }
}

// ---------------- credits ----------------

function writeCredits() {
  const kb = (b) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(2)} MB` : `${Math.round(b / 1024)} KB`);
  const total = credits.reduce((a, c) => a + c.bytes, 0);
  const rows = credits.sort((a, b) => a.file.localeCompare(b.file))
    .map((c) => `| \`${c.file}\` | ${c.note} | [${new URL(c.url).host}](${c.url}) | ${c.author} | ${c.licence} | ${kb(c.bytes)} |`);
  const md = `# Model / texture credits

All third-party assets below are CC0 1.0 (public domain dedication) — no attribution is legally required;
it is given anyway. Regenerate this file and every asset with \`node tools/assets/fetch.mjs\`
(manifest: \`tools/assets/manifest.json\`).

Total committed asset bytes: **${kb(total)}** in ${credits.length} files.

| File | Content | Source | Author | Licence | Size |
|---|---|---|---|---|---|
${rows.join('\n')}

## Not downloaded, and why

* **Buildings and props are procedural geometry** (\`src/world/models.ts\`) textured with the CC0 PBR
  materials above. Exploration merges every settlement mesh by *material instance*
  (\`src/exploration/settlements.ts\`), and \`WorldService.spawnModel\` is synchronous, so a streamed GLB
  cannot be part of that bake; procedural geometry also keeps the metre footprints \`src/exploration/layout.ts\`
  assumes. KayKit's Medieval Builder Pack (CC0, downloaded and inspected) is hex-tile stylised and does not
  match the PBR/painterly target.
* **Character meshes are procedural too**, skinned to a period-proportioned skeleton; only the *animation*
  is third-party (KayKit, CC0). Rigged CC0 humans that exist (KayKit Adventurers, Quaternius) are toon-
  proportioned fantasy archetypes — wrong silhouettes for 1291–1315 Alemannic dress.
`;
  fs.writeFileSync(path.join(root, 'public/assets/CREDITS-models.md'), md);
  log('credits →', 'public/assets/CREDITS-models.md', kb(total));
}

// ---------------- main ----------------

try {
  if (!only || only === 'textures') for (const t of manifest.textures) await fetchTexture(t);
  if (only === 'terrain') for (const t of manifest.terrain) await fetchTexture(t); // skipped by default: see manifest note
  if (!only || only === 'characters') for (const c of manifest.characters) await fetchCharacters(c);
  if (!only) writeCredits();
  else log('partial run: CREDITS-models.md not rewritten');
} finally {
  await browser?.close();
}
log('done');
