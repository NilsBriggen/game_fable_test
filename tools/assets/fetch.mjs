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
  // ambientCG rate-limits bursts with 503s; back off and retry rather than failing the run.
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, init);
    if (res.ok) { fs.writeFileSync(file, Buffer.from(await res.arrayBuffer())); return file; }
    if (attempt >= 6) throw new Error(`${res.status} ${res.statusText} for ${url}`);
    const wait = 4000 * attempt;
    log(`  ${res.status}; retry ${attempt} in ${wait / 1000}s`);
    await new Promise((r) => setTimeout(r, wait));
  }
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

/** Resize `src` to at most `size` px on its long edge and re-encode as JPEG at quality `q`.
 *  `channel` (0/1/2) spreads one channel of a packed ORM/ARM map over RGB (→ a plain roughness map). */
async function convertJpeg(src, dst, size, q, channel = -1) {
  const p = await imagePage();
  const mime = src.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
  const data = `data:${mime};base64,` + fs.readFileSync(src).toString('base64');
  const out = await p.evaluate(async ([data, size, q, channel]) => {
    const img = new Image();
    img.src = data;
    await img.decode();
    const s = Math.min(1, size / Math.max(img.width, img.height));
    const c = document.getElementById('c');
    c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, c.width, c.height);
    if (channel >= 0) {
      const id = ctx.getImageData(0, 0, c.width, c.height);
      const d = id.data;
      for (let i = 0; i < d.length; i += 4) { const v = d[i + channel]; d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255; }
      ctx.putImageData(id, 0, 0);
    }
    return c.toDataURL('image/jpeg', q);
  }, [data, size, q, channel]);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, Buffer.from(out.slice(out.indexOf(',') + 1), 'base64'));
}

// ---------------- ambientCG materials ----------------

async function fetchTexture(entry) {
  const src = manifest.sources[entry.source];
  const profile = manifest.textureProfiles[entry.profile];
  const targetDir = path.join(root, entry.target);
  const done = Object.keys(profile).every((k) => fs.existsSync(path.join(targetDir, `${k}.jpg`)));
  // Poly Haven serves one JPEG per map (no archive); ambientCG serves a zip of the whole set.
  const perMap = src.kind === 'files';
  const url = perMap ? src.homeTemplate.replace(/{ASSET}/g, entry.asset) : src.urlTemplate.replace('{ASSET}', entry.asset);
  if (done && !FORCE) { recordTexture(entry, url, src, profile); return; }
  if (perMap) {
    for (const [out, spec] of Object.entries(profile)) {
      const mapName = (src.maps ?? {})[out] ?? spec.src;
      const fileUrl = src.urlTemplate.replace(/{ASSET}/g, entry.asset).replace('{MAP}', mapName);
      const got = await download(fileUrl, `${entry.asset}-${out}.jpg`);
      await convertJpeg(got, path.join(targetDir, `${out}.jpg`), spec.size, spec.q);
    }
  } else {
    const zip = await download(url, `${entry.asset}.zip`);
    const dir = unzip(zip, path.join(CACHE, entry.asset));
    for (const [out, spec] of Object.entries(profile)) {
      const file = fs.readdirSync(dir).find((f) => f.endsWith(`_${spec.src}.jpg`));
      if (!file) throw new Error(`${entry.asset}: no ${spec.src} map`);
      await convertJpeg(path.join(dir, file), path.join(targetDir, `${out}.jpg`), spec.size, spec.q);
    }
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

/** Rest-pose skeleton: parent index + local translation/rotation, in file order. */
function restSkeleton(json, bones) {
  const idx = new Map(bones.map((b, i) => [b, i]));
  const parent = new Map();
  json.nodes.forEach((n, i) => { for (const c of n.children || []) parent.set(c, i); });
  return bones.map((name) => {
    const i = json.nodes.findIndex((n) => n.name === name);
    const n = json.nodes[i];
    const p = parent.has(i) ? json.nodes[parent.get(i)].name : null;
    return { name, parent: p !== null && idx.has(p) ? idx.get(p) : -1, t: n.translation || [0, 0, 0], r: n.rotation || [0, 0, 0, 1] };
  });
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
  let bones = null, bind = null, skeleton = null;
  for (const cf of entry.clipFiles) {
    const glb = readGlb(path.join(dir, cf.file));
    if (!bones) {
      bind = bindWorld(glb.json);
      bones = glb.json.nodes.filter((n) => n.mesh === undefined && n.name && bind[n.name]).map((n) => n.name);
      skeleton = restSkeleton(glb.json, bones);
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
  const json = JSON.stringify({ bones, bind, skeleton, clips });
  // pad the header so the float payload starts 4-byte aligned (a Float32Array view needs that)
  const header = Buffer.from(json + ' '.repeat((4 - ((8 + Buffer.byteLength(json)) % 4)) % 4), 'utf8');
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
  const target0 = path.join(root, entry.target);
  // The itch.io download flow needs a live session; when the packed clip file is already committed
  // (and no --force), record its provenance from the manifest and skip the network entirely, so
  // `node tools/assets/fetch.mjs` can still regenerate CREDITS-models.md offline.
  if (fs.existsSync(target0) && !FORCE) {
    const pageUrl0 = `https://${entry.itch.user}.itch.io/${entry.itch.slug}`;
    credits.push({ file: entry.target.replace(/^public\//, ''), url: pageUrl0, author: src.author, licence: src.licence, bytes: fs.statSync(target0).size, note: 'Rig_Medium animation clips, re-packed' });
    if (entry.licenceFile && fs.existsSync(path.join(root, entry.licenceFile.target))) {
      const lt0 = path.join(root, entry.licenceFile.target);
      credits.push({ file: entry.licenceFile.target.replace(/^public\//, ''), url: pageUrl0, author: src.author, licence: src.licence, bytes: fs.statSync(lt0).size, note: 'upstream licence text' });
    }
    log('characters: already committed, skipping download');
    return;
  }
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

// ---------------- model kits → EKIT (src/world/assets.ts `loadPackedKit`) ----------------

/** Reads a .gltf (JSON + external .bin buffers, or a .glb) into {json, buffers[]}. */
function readGltf(file) {
  if (file.endsWith('.glb')) { const g = readGlb(file); return { json: g.json, buffers: [g.bin] }; }
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  const buffers = (json.buffers || []).map((b) => fs.readFileSync(path.join(path.dirname(file), decodeURIComponent(b.uri))));
  return { json, buffers };
}

function gltfAccessor(g, i) {
  const a = g.json.accessors[i];
  const bv = g.json.bufferViews[a.bufferView];
  const [Type] = COMP[a.componentType];
  const n = NUM[a.type];
  const buf = g.buffers[bv.buffer ?? 0];
  const start = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const stride = bv.byteStride ? bv.byteStride / Type.BYTES_PER_ELEMENT : n;
  const out = new Float32Array(a.count * n);
  const view = new Type(buf.buffer, buf.byteOffset + start, (a.count - 1) * stride + n);
  const norm = a.normalized ? { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }[a.componentType] : 0;
  for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) { const v = view[k * stride + c]; out[k * n + c] = norm ? Math.max(-1, v / norm) : v; }
  return out;
}

const M4 = {
  mul(a, b) { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; },
  trs(n) {
    if (n.matrix) return n.matrix;
    const t = n.translation || [0, 0, 0], [x, y, z, w] = n.rotation || [0, 0, 0, 1], s = n.scale || [1, 1, 1];
    const x2 = x + x, y2 = y + y, z2 = z + z, xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
    return [(1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0, (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
      (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0, t[0], t[1], t[2], 1];
  },
  point(m, x, y, z) { return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]]; },
  dir(m, x, y, z) { const v = [m[0] * x + m[4] * y + m[8] * z, m[1] * x + m[5] * y + m[9] * z, m[2] * x + m[6] * y + m[10] * z]; const l = Math.hypot(...v) || 1; return v.map((c) => c / l); },
};

/**
 * Collects every primitive of a glTF scene as {mat, pos, nor, uv, idx} in world space (node transforms
 * baked), keyed by the material name → our material id through `matMap` (a function).
 */
function gltfParts(g, matMap) {
  const parts = [];
  const walk = (i, parent) => {
    const n = g.json.nodes[i];
    const m = M4.mul(parent, M4.trs(n));
    if (n.mesh !== undefined) {
      for (const p of g.json.meshes[n.mesh].primitives) {
        if ((p.mode ?? 4) !== 4) continue;
        const matName = p.material !== undefined ? g.json.materials[p.material].name : 'default';
        const mat = matMap(matName, p.material);
        if (!mat) continue;
        const pos = gltfAccessor(g, p.attributes.POSITION);
        const nor = p.attributes.NORMAL !== undefined ? gltfAccessor(g, p.attributes.NORMAL) : null;
        const uv = p.attributes.TEXCOORD_0 !== undefined ? gltfAccessor(g, p.attributes.TEXCOORD_0) : new Float32Array((pos.length / 3) * 2);
        const idx = p.indices !== undefined ? gltfAccessor(g, p.indices) : Float32Array.from({ length: pos.length / 3 }, (_, k) => k);
        const wpos = new Float32Array(pos.length), wnor = new Float32Array(pos.length);
        for (let k = 0; k < pos.length; k += 3) {
          const q = M4.point(m, pos[k], pos[k + 1], pos[k + 2]); wpos[k] = q[0]; wpos[k + 1] = q[1]; wpos[k + 2] = q[2];
          if (nor) { const d = M4.dir(m, nor[k], nor[k + 1], nor[k + 2]); wnor[k] = d[0]; wnor[k + 1] = d[1]; wnor[k + 2] = d[2]; }
        }
        parts.push({ mat, pos: wpos, nor: nor ? wnor : null, uv, idx });
      }
    }
    for (const c of n.children || []) walk(c, m);
  };
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const s of g.json.scenes[g.json.scene ?? 0].nodes) walk(s, I);
  return parts;
}

/** Flat normals for a part that has none (indexed → per-face, re-expanded). */
function flatNormals(part) {
  const { pos, idx } = part;
  const n = new Float32Array(pos.length);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const i of [a, b, c]) { n[i] += nx; n[i + 1] += ny; n[i + 2] += nz; }
  }
  for (let i = 0; i < n.length; i += 3) { const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1; n[i] /= l; n[i + 1] /= l; n[i + 2] /= l; }
  return n;
}

/** Packs {name → parts[]} into the EKIT container: 'EKIT', u32 header length, JSON header, float32 payload. */
function packKit(pieces) {
  const floats = [];
  const push = (arr) => { const off = floats.length; for (const v of arr) floats.push(v); return { off, len: arr.length }; };
  const header = { pieces: {} };
  let totalTris = 0;
  for (const [name, parts] of Object.entries(pieces)) {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    let tris = 0;
    const out = [];
    for (const p of parts) {
      for (let k = 0; k < p.pos.length; k += 3) for (let c = 0; c < 3; c++) { min[c] = Math.min(min[c], p.pos[k + c]); max[c] = Math.max(max[c], p.pos[k + c]); }
      tris += p.idx.length / 3;
      out.push({ mat: p.mat, pos: push(p.pos), nor: push(p.nor ?? flatNormals(p)), uv: push(p.uv), idx: push(p.idx) });
    }
    totalTris += tris;
    header.pieces[name] = { min: min.map((v) => +v.toFixed(4)), max: max.map((v) => +v.toFixed(4)), tris, parts: out };
  }
  const json = JSON.stringify(header);
  const head = Buffer.from(json + ' '.repeat((4 - ((8 + Buffer.byteLength(json)) % 4)) % 4), 'utf8');
  const data = Buffer.from(new Float32Array(floats).buffer);
  const buf = Buffer.alloc(8 + head.length + data.length);
  buf.write('EKIT', 0, 'ascii');
  buf.writeUInt32LE(head.length, 4);
  head.copy(buf, 8);
  data.copy(buf, 8 + head.length);
  return { buf, totalTris };
}

async function fetchKitTextures(entry, dir, src, pageUrl) {
  for (const [matId, maps] of Object.entries(entry.textures)) {
    for (const [out, spec] of Object.entries(maps)) {
      const [file, channel] = Array.isArray(spec) ? spec : [spec, -1];
      const dst = path.join(root, entry.textureTarget, matId, `${out}.jpg`);
      if (!fs.existsSync(dst) || FORCE) await convertJpeg(path.join(dir, file), dst, entry.textureSize, entry.q ?? 0.85, channel);
      credits.push({ file: path.relative(path.join(root, 'public'), dst), url: pageUrl, author: src.author, licence: src.licence, bytes: fs.statSync(dst).size, note: `${entry.id} ${file} → ${out}` });
    }
  }
}

async function fetchGltfZipKit(entry) {
  const src = manifest.sources[entry.source];
  const target = path.join(root, entry.target);
  const zip = await download(entry.url, `${entry.id}.zip`);
  const dir = path.join(unzip(zip, path.join(CACHE, entry.id)), entry.dir ?? '');
  const pieces = {};
  const matMap = (name) => entry.materials[name] ?? null;
  for (const name of entry.pieces) {
    const parts = gltfParts(readGltf(path.join(dir, `${name}.gltf`)), matMap);
    if (!parts.length) throw new Error(`${entry.id}: ${name} has no usable primitives`);
    pieces[name] = parts;
  }
  const { buf, totalTris } = packKit(pieces);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, buf);
  log(`${entry.id}: ${entry.pieces.length} pieces, ${totalTris} tris → ${entry.target} (${Math.round(buf.length / 1024)} KB)`);
  credits.push({ file: entry.target.replace(/^public\//, ''), url: entry.page, author: src.author, licence: src.licence, bytes: buf.length, note: `${entry.pieces.length} MegaKit pieces, re-packed (EKIT)` });
  await fetchKitTextures(entry, dir, src, entry.page);
}

async function fetchPolyhavenModel(entry) {
  const src = manifest.sources[entry.source];
  const target = path.join(root, entry.target);
  const page = src.homeTemplate.replace(/{ASSET}/g, entry.id);
  const info = await (await fetch(src.apiInfo.replace(/{ASSET}/g, entry.id))).json();
  const author = Object.keys(info.authors || {}).join(', ') || src.author;
  const files = await (await fetch(src.apiFiles.replace(/{ASSET}/g, entry.id))).json();
  const g = files.gltf[entry.res ?? '1k'].gltf;
  const dir = path.join(CACHE, `ph-${entry.id}`);
  fs.mkdirSync(path.join(dir, 'textures'), { recursive: true });
  const gltfFile = await download(g.url, `${entry.id}.gltf`);
  fs.copyFileSync(gltfFile, path.join(dir, `${entry.id}.gltf`));
  for (const [rel, spec] of Object.entries(g.include)) {
    const got = await download(spec.url, path.basename(rel));
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.copyFileSync(got, path.join(dir, rel));
  }
  const gl = readGltf(path.join(dir, `${entry.id}.gltf`));
  // one material id per glTF material: ph-<id> for the first, ph-<id>-<n> for the rest
  const matIds = (gl.json.materials || []).map((m, i) => (i === 0 ? `ph-${entry.id}` : `ph-${entry.id}-${i}`));
  const parts = gltfParts(gl, (_name, i) => (i === undefined ? `ph-${entry.id}` : matIds[i]));
  const { buf, totalTris } = packKit({ [entry.id]: parts });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, buf);
  log(`${entry.id}: ${totalTris} tris → ${entry.target} (${Math.round(buf.length / 1024)} KB)`);
  credits.push({ file: entry.target.replace(/^public\//, ''), url: page, author, licence: src.licence, bytes: buf.length, note: `${entry.id} (${entry.res ?? '1k'} glTF), re-packed (EKIT)` });
  // textures per material: diff / nor (glTF +Y) / rough (from the packed ARM's G channel, or a rough map)
  (gl.json.materials || []).forEach((m, i) => {
    const imgUri = (texIdx) => (texIdx === undefined ? null : decodeURIComponent(gl.json.images[gl.json.textures[texIdx].source].uri));
    const pbr = m.pbrMetallicRoughness || {};
    const maps = { diff: imgUri(pbr.baseColorTexture?.index), nor: imgUri(m.normalTexture?.index), rough: imgUri(pbr.metallicRoughnessTexture?.index) };
    for (const [out, uri] of Object.entries(maps)) {
      if (!uri) continue;
      const dst = path.join(root, entry.textureTarget, matIds[i], `${out}.jpg`);
      const channel = out === 'rough' ? 1 : -1;     // glTF packs roughness in G of the MR/ARM map
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      credits.push({ file: path.relative(path.join(root, 'public'), dst), url: page, author, licence: src.licence, bytes: 0, note: `${entry.id} ${path.basename(uri)} → ${out}`, convert: [path.join(dir, uri), dst, entry.textureSize, entry.q ?? 0.85, channel] });
    }
  });
  for (const c of credits) if (c.convert) {
    if (!fs.existsSync(c.convert[1]) || FORCE) await convertJpeg(...c.convert);
    c.bytes = fs.statSync(c.convert[1]).size;
    delete c.convert;
  }
}

async function fetchModels() {
  for (const entry of manifest.models || []) {
    if (entry.kind === 'gltf-zip') await fetchGltfZipKit(entry);
    else if (entry.kind === 'polyhaven') await fetchPolyhavenModel(entry);
    else throw new Error(`unknown model kind ${entry.kind}`);
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

* **Alpine buildings are procedural geometry** (\`src/world/models/*\`) textured with the CC0 PBR
  materials above: the Blockbau log house, Stadel, Spycher, Romanesque church, castle and letzi have no
  CC0 counterpart. The **town house, the village tavern, the wagon and the crates are composed from the
  Quaternius Medieval Village MegaKit** (\`assets/models/buildings/megakit.bin\`, 48 of its 176 glTF pieces
  re-packed) and **small props are Poly Haven scans** (\`assets/models/props/*.bin\`). Both are loaded once at
  boot and composed *synchronously* into the same per-material batches as the procedural geometry, so
  exploration's per-POI merge (\`src/exploration/settlements.ts\`) still sees one mesh per material.
  Not used: the kit's high-poly stone corners/door frames (2–3k tris each), Poly Haven's barrels set, basket,
  stump and spinning wheel (0.6–1.4 MB of geometry each — too heavy for dressing), and KayKit's Medieval
  Builder Pack (hex-tile stylised).
* **Character meshes are procedural too** (\`src/world/characters.ts\`), skinned to a skeleton retargeted to
  adult human proportions; only the *animation* is third-party (KayKit Rig_Medium, CC0), re-packed to the
  31 clips the game maps onto \`CharacterAnim\`. Rigged CC0 humans that exist (KayKit Adventurers,
  Quaternius) are toon-proportioned fantasy archetypes — wrong silhouettes for 1291–1315 Alemannic dress,
  and none of them ship kettle hats, gambesons, monks' habits or a red-white-red surcoat.
`;
  fs.writeFileSync(path.join(root, 'public/assets/CREDITS-models.md'), md);
  log('credits →', 'public/assets/CREDITS-models.md', kb(total));
}

// ---------------- main ----------------

try {
  if (!only || only === 'textures') for (const t of manifest.textures) await fetchTexture(t);
  if (only === 'terrain') for (const t of manifest.terrain) await fetchTexture(t); // skipped by default: see manifest note
  if (!only || only === 'characters') for (const c of manifest.characters) await fetchCharacters(c);
  if (!only || only === 'models') await fetchModels();
  if (!only) writeCredits();
  else log('partial run: CREDITS-models.md not rewritten');
} finally {
  await browser?.close();
}
log('done');
