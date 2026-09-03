#!/usr/bin/env node
/**
 * Reproducible fetch for every character-art asset (tools/assets/characters-manifest.json):
 *   node tools/assets/fetch-characters.mjs [--force] [--only textures|models|clips]
 *
 *  - `textures`: Poly Haven CC0 JPEG maps for the procedural fallback body, re-encoded with the bundled
 *    Chromium (public/assets/characters/textures/**).
 *  - `models`: Mixamo characters (FBX with embedded textures, from the GbotHQ/mixamo-characters Hugging Face
 *    dataset) converted to GLB by tools/assets/fbx2glb.mjs (public/assets/characters/models/*.glb, cm → m,
 *    textures downscaled per the manifest's `tex`).
 *  - `clips`: Mixamo animation clips as bones-only GLBs (Leeoo/mixamo-rigs-clips), copied verbatim
 *    (public/assets/characters/clips/*.glb).
 * Every file gets its size recorded back into the manifest and a row in public/assets/CREDITS-characters.md
 * with URL, author and licence as found at the source.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifestPath = path.join(root, 'tools/assets/characters-manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const ONLY = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const CACHE = path.join(os.tmpdir(), 'eidgenossen-assets');
fs.mkdirSync(CACHE, { recursive: true });

const log = (...m) => console.log('[characters]', ...m);

async function download(url, name) {
  const file = path.join(CACHE, name);
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return file;
  log('GET', url);
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url);
    if (res.ok) { fs.writeFileSync(file, Buffer.from(await res.arrayBuffer())); return file; }
    if (attempt >= 5) throw new Error(`${res.status} ${res.statusText} for ${url}`);
    await new Promise((r) => setTimeout(r, 3000 * attempt));
  }
}

let browser = null, page = null;
async function canvasPage() {
  if (page) return page;
  const { chromium } = await import('playwright');
  const exe = process.env.HARNESS_CHROMIUM || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  browser = await chromium.launch(exe ? { executablePath: exe } : {});
  page = await browser.newPage();
  await page.setContent('<canvas id="c"></canvas>');
  return page;
}

/** Resize to at most `size` px on the long edge and re-encode as JPEG at quality `q`. */
async function convertJpeg(src, dst, size, q) {
  const p = await canvasPage();
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

const credits = [];   // { file, note, url, author, licence, bytes }
const rel = (abs) => path.relative(path.join(root, 'public'), abs);

// ---------------- textures (procedural fallback body) ----------------
if (!ONLY || ONLY === 'textures') {
  for (const entry of manifest.textures) {
    const src = manifest.sources[entry.source];
    entry.files = {}; entry.sizes = {};
    for (const [out, spec] of Object.entries(manifest.profile)) {
      if (entry.maps && !entry.maps.includes(out)) continue;
      const abs = path.join(root, entry.target, `${out}.jpg`);
      if (!fs.existsSync(abs) || FORCE) {
        const url = src.fileTemplate.replace(/\{ASSET\}/g, entry.asset).replace('{MAP}', spec.map);
        const file = await download(url, `${entry.asset}_${spec.map}_1k.jpg`);
        await convertJpeg(file, abs, spec.size, spec.q);
      }
      entry.files[out] = rel(abs);
      entry.sizes[out] = fs.statSync(abs).size;
    }
  }
}
for (const entry of manifest.textures) for (const [out, f] of Object.entries(entry.files ?? {})) {
  credits.push({ file: f, note: `${entry.asset} ${manifest.profile[out].map} (${manifest.profile[out].size} px)`, url: entry.url, author: entry.author, licence: entry.licence, bytes: entry.sizes[out] });
}
if (browser) { await browser.close(); browser = null; page = null; }

// ---------------- Mixamo characters (FBX → GLB) ----------------
if (!ONLY || ONLY === 'models') {
  const src = manifest.sources.mixamoCharacters;
  for (const m of manifest.models) {
    const abs = path.join(root, 'public/assets/characters/models', `${m.id}.glb`);
    if (!fs.existsSync(abs) || FORCE) {
      const url = src.fileTemplate.replace('{NAME}', encodeURIComponent(m.name));
      const fbx = await download(url, `${m.name.replace(/[^\w]+/g, '_')}.fbx`);
      log('convert', m.name, '→', rel(abs), `(tex ${m.tex})`);
      execFileSync('node', [path.join(root, 'tools/assets/fbx2glb.mjs'), fbx, abs, '--tex', String(m.tex), '--strip-anims'], { stdio: 'inherit' });
    }
    m.file = rel(abs); m.size = fs.statSync(abs).size;
  }
}
for (const m of manifest.models) if (m.file) credits.push({ file: m.file, note: `Mixamo character "${m.name}" (FBX → GLB, textures ≤ ${m.tex} px): ${m.use}`, url: manifest.sources.mixamoCharacters.fileTemplate.replace('{NAME}', encodeURIComponent(m.name)), author: m.author ?? manifest.sources.mixamoCharacters.author, licence: manifest.sources.mixamoCharacters.licence, bytes: m.size });

// ---------------- Mixamo clips (bones-only GLB) ----------------
if (!ONLY || ONLY === 'clips') {
  const src = manifest.sources.mixamoClips;
  manifest.clips.sizes = {};
  for (const c of manifest.clips.names) {
    const abs = path.join(root, 'public/assets/characters/clips', `${c}.glb`);
    if (!fs.existsSync(abs) || FORCE) {
      const file = await download(src.fileTemplate.replace('{CLIP}', c), `clip_${c}.glb`);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.copyFileSync(file, abs);
    }
    manifest.clips.sizes[c] = fs.statSync(abs).size;
  }
}
for (const [c, bytes] of Object.entries(manifest.clips.sizes ?? {})) credits.push({ file: `assets/characters/clips/${c}.glb`, note: `Mixamo clip "${c}" (bones only)`, url: manifest.sources.mixamoClips.fileTemplate.replace('{CLIP}', c), author: manifest.sources.mixamoClips.author, licence: manifest.sources.mixamoClips.licence, bytes });

// ---------------- credited-only entries (fetched by tools/assets/fetch.mjs) ----------------
for (const entry of manifest.credited ?? []) {
  for (const f of entry.files) {
    const abs = path.join(root, f);
    credits.push({ file: f.replace(/^public\//, ''), note: entry.use.split(',')[0], url: entry.url, author: entry.author, licence: entry.licence, bytes: fs.existsSync(abs) ? fs.statSync(abs).size : 0 });
  }
}

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

const kb = (b) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(2)} MB` : `${Math.round(b / 1024)} KB`);
const total = credits.reduce((a, c) => a + c.bytes, 0);
const rows = credits.sort((a, b) => a.file.localeCompare(b.file))
  .map((c) => `| \`${c.file}\` | ${c.note} | [${new URL(c.url).host}](${c.url}) | ${c.author} | ${c.licence} | ${kb(c.bytes)} |`);
const md = `# Character art credits

Every file under \`public/assets/characters/\` is listed here with its source URL, author and licence **as found at
the source**. Regenerate with \`node tools/assets/fetch-characters.mjs\` (manifest: \`tools/assets/characters-manifest.json\`);
the KayKit clip pack comes from \`node tools/assets/fetch.mjs --only characters\`.

Total committed bytes: **${kb(total)}** in ${credits.length} files.

| File | Content | Source | Author | Licence | Size |
|---|---|---|---|---|---|
${rows.join('\n')}

## Licence notes

* **Mixamo characters and clips** (Adobe Mixamo, redistributed through the two Hugging Face datasets named in
  the URLs). Adobe's Mixamo terms allow using the characters and animations in games; the datasets carry no
  licence file of their own — recorded here as "Adobe Mixamo terms (via Hugging Face dataset)". The FBX files
  are converted to GLB (cm → m, Phong → PBR, textures downscaled) by \`tools/assets/fbx2glb.mjs\`; clip GLBs are
  copied verbatim. The owner accepted these terms explicitly (integrator message, wave 2).
* **Poly Haven** textures are CC0 1.0. They dress the procedural fallback body (\`src/world/characters/body.ts\`)
  that is used when a character's GLB is missing or fails to load, and the procedural weapons, shields and
  horse that are attached to the Mixamo bodies.
* **KayKit** Rig_Medium clips (CC0 1.0) drive that procedural fallback.
`;
fs.writeFileSync(path.join(root, 'public/assets/CREDITS-characters.md'), md);
log(`done: ${credits.length} files, ${kb(total)}`);
