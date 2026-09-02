#!/usr/bin/env node
/**
 * Reproducible fetch + pack step for the world-look assets (ARCHITECTURE.md §0: CC0 assets may be
 * downloaded; provenance goes in public/assets/CREDITS-world.md).
 *
 *   node tools/assets/fetch-world.mjs [--force]
 *
 * What it does
 *  1. downloads the 1K-JPG zip of every ambientCG set named in world-manifest.json into a cache
 *     directory OUTSIDE the repo ($TMPDIR/eidgenossen-world-assets, or $WORLD_ASSET_CACHE),
 *  2. unzips the three maps we actually use (Color / NormalGL / Roughness + AmbientOcclusion),
 *  3. uses the Playwright Chromium that is already a devDependency of this repo as a headless image
 *     pipeline (no new npm packages — BUILDER_RULES.md): each map is drawn into a 512x512 tile and the
 *     eight terrain layers are stacked vertically into one 512x4096 JPEG. The runtime loads that one
 *     file per map type and uploads it as a three.js DataArrayTexture (8 layers), which is what keeps
 *     the terrain to ONE material with ≤12 texture units.
 *  4. writes public/assets/CREDITS-world.md.
 *
 * Every source asset is CC0 1.0 (ambientCG). No attribution is legally required; we record it anyway.
 */
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
// Downloaded zips are ~90 MB; keep them OUT of the repo (the integrator commits this tree).
// Override with WORLD_ASSET_CACHE=<dir> to pin a stable location.
const CACHE = process.env.WORLD_ASSET_CACHE || path.join(os.tmpdir(), 'eidgenossen-world-assets');
const FORCE = process.argv.includes('--force');

const manifest = JSON.parse(await readFile(path.join(__dirname, 'world-manifest.json'), 'utf8'));
const SIZE = manifest.layerSize;
const SRC = manifest.sources.ambientcg;

await mkdir(CACHE, { recursive: true });
await mkdir(path.join(root, 'public/assets/textures/terrain'), { recursive: true });
await mkdir(path.join(root, 'public/assets/textures/vegetation'), { recursive: true });

/** ambientCG serves the zip behind a 302 to a CDN; curl -L follows it. */
async function download(assetName) {
  const zip = path.join(CACHE, `${assetName}_1K-JPG.zip`);
  if (existsSync(zip) && !FORCE && (await stat(zip)).size > 100000) return zip;
  const url = SRC.url.replace('{name}', assetName);
  console.log(`  fetching ${assetName} …`);
  const r = spawnSync('curl', ['-sSL', '--fail', '--max-time', '300', '-o', zip, url], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`download failed for ${assetName}`);
  return zip;
}

/** Unzip only the maps we use; returns {color, normal, roughness, ao} absolute paths. */
async function extract(assetName, zip) {
  const dir = path.join(CACHE, assetName);
  await mkdir(dir, { recursive: true });
  const wanted = ['_Color.jpg', '_NormalGL.jpg', '_Roughness.jpg', '_AmbientOcclusion.jpg'];
  const patterns = wanted.map((w) => `*${w}`);
  spawnSync('unzip', ['-o', '-j', '-q', zip, ...patterns, '-d', dir], { stdio: 'inherit' });
  const f = (suffix) => {
    const p = path.join(dir, `${assetName}_1K-JPG${suffix}`);
    return existsSync(p) ? p : null;
  };
  return { color: f('_Color.jpg'), normal: f('_NormalGL.jpg'), roughness: f('_Roughness.jpg'), ao: f('_AmbientOcclusion.jpg') };
}

const layers = manifest.terrainLayers;
const veg = manifest.vegetation;

console.log(`fetching ${layers.length + veg.length} CC0 sets from ${SRC.homepage} …`);
const files = {};
for (const l of [...layers, ...veg]) {
  const zip = await download(l.asset);
  files[l.asset] = await extract(l.asset, zip);
}

// ---------------------------------------------------------------------------
// Image pipeline: Chromium canvas. Everything below runs inside the page.
// ---------------------------------------------------------------------------
const chromiumExe = process.env.HARNESS_CHROMIUM || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  ...(chromiumExe ? { executablePath: chromiumExe } : {}),
});
const page = await browser.newPage();
await page.goto('about:blank');

/** Read a local file into a data: URL so the page can decode it without a server. */
async function dataUrl(file) {
  const buf = await readFile(file);
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

async function packArray(kind, sources, quality) {
  const urls = [];
  for (const s of sources) urls.push(s ? await dataUrl(s) : null);
  return page.evaluate(async ({ urls, SIZE, kind, quality }) => {
    const canvas = document.createElement('canvas');
    canvas.width = SIZE; canvas.height = SIZE * urls.length;
    const ctx = canvas.getContext('2d');
    for (let i = 0; i < urls.length; i++) {
      const y = i * SIZE;
      if (!urls[i]) {
        // missing map: neutral fill (flat normal / mid roughness / mid grey)
        ctx.fillStyle = kind === 'normal' ? 'rgb(128,128,255)' : kind === 'orm' ? 'rgb(255,180,128)' : 'rgb(128,128,128)';
        ctx.fillRect(0, y, SIZE, SIZE);
        continue;
      }
      const img = new Image();
      img.src = urls[i];
      await img.decode();
      ctx.drawImage(img, 0, y, SIZE, SIZE);
    }
    return canvas.toDataURL('image/jpeg', quality);
  }, { urls, SIZE, kind, quality });
}

/** ORM pack: R = ambient occlusion, G = roughness, B = 0.5 (spare). One draw per channel via composite. */
async function packOrm(layers, quality) {
  const pairs = [];
  for (const l of layers) {
    const f = files[l.asset];
    pairs.push({ ao: f.ao ? await dataUrl(f.ao) : null, rough: f.roughness ? await dataUrl(f.roughness) : null });
  }
  return page.evaluate(async ({ pairs, SIZE, quality }) => {
    const tile = document.createElement('canvas');
    tile.width = tile.height = SIZE;
    const tctx = tile.getContext('2d', { willReadFrequently: true });
    const out = document.createElement('canvas');
    out.width = SIZE; out.height = SIZE * pairs.length;
    const octx = out.getContext('2d');
    const load = async (u) => { const i = new Image(); i.src = u; await i.decode(); return i; };
    for (let i = 0; i < pairs.length; i++) {
      const { ao, rough } = pairs[i];
      const aoData = ao ? (tctx.clearRect(0, 0, SIZE, SIZE), tctx.drawImage(await load(ao), 0, 0, SIZE, SIZE), tctx.getImageData(0, 0, SIZE, SIZE)) : null;
      const rData = rough ? (tctx.clearRect(0, 0, SIZE, SIZE), tctx.drawImage(await load(rough), 0, 0, SIZE, SIZE), tctx.getImageData(0, 0, SIZE, SIZE)) : null;
      const merged = tctx.createImageData(SIZE, SIZE);
      for (let p = 0; p < SIZE * SIZE; p++) {
        merged.data[p * 4] = aoData ? aoData.data[p * 4] : 255;
        merged.data[p * 4 + 1] = rData ? rData.data[p * 4] : 200;
        merged.data[p * 4 + 2] = 128;
        merged.data[p * 4 + 3] = 255;
      }
      tctx.putImageData(merged, 0, 0);
      octx.drawImage(tile, 0, i * SIZE);
    }
    return out.toDataURL('image/jpeg', quality);
  }, { pairs, SIZE, quality });
}

async function packSingle(file, size, quality) {
  const u = await dataUrl(file);
  return page.evaluate(async ({ u, size, quality }) => {
    const img = new Image();
    img.src = u;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = c.height = size;
    c.getContext('2d').drawImage(img, 0, 0, size, size);
    return c.toDataURL('image/jpeg', quality);
  }, { u, size, quality });
}

async function writeDataUrl(rel, dataurl) {
  const file = path.join(root, rel);
  const b64 = dataurl.slice(dataurl.indexOf(',') + 1);
  await writeFile(file, Buffer.from(b64, 'base64'));
  const kb = Math.round((await stat(file)).size / 1024);
  console.log(`  wrote ${rel}  (${kb} kB)`);
  return kb;
}

const Q = manifest.jpegQuality;
console.log('packing terrain arrays …');
const sizes = {};
sizes.albedo = await writeDataUrl(manifest.outputs.terrainAlbedoArray, await packArray('albedo', layers.map((l) => files[l.asset].color), Q.albedo));
sizes.normal = await writeDataUrl(manifest.outputs.terrainNormalArray, await packArray('normal', layers.map((l) => files[l.asset].normal), Q.normal));
sizes.orm = await writeDataUrl(manifest.outputs.terrainOrmArray, await packOrm(layers, Q.orm));

console.log('packing vegetation textures …');
const bark = veg[0];
sizes.bark = await writeDataUrl(manifest.outputs.barkAlbedo, await packSingle(files[bark.asset].color, 256, 0.9));
sizes.barkN = await writeDataUrl(manifest.outputs.barkNormal, await packSingle(files[bark.asset].normal, 256, 0.92));

await browser.close();

// ---------------------------------------------------------------------------
const credits = [
  '# Credits — world look (terrain, vegetation, sky, water)',
  '',
  'Owned by the *world-look* builder. Everything listed here is **CC0 1.0 Universal** (public domain',
  'dedication): no attribution is legally required, we record it anyway. Fetched and packed reproducibly',
  'by `node tools/assets/fetch-world.mjs` from `tools/assets/world-manifest.json`.',
  '',
  '## Source sets',
  '',
  `Source: **${SRC.author}** — ${SRC.homepage} — licence: **${SRC.licence}**.`,
  'Downloaded as `<Name>_1K-JPG.zip`; we keep only Color, NormalGL, Roughness and AmbientOcclusion.',
  '',
  '| Terrain layer | ambientCG set | used for |',
  '|---|---|---|',
  ...layers.map((l) => `| ${l.layer} \`${l.id}\` | [${l.asset}](https://ambientcg.com/view?id=${l.asset}) | ${l.note} |`),
  ...veg.map((l) => `| vegetation \`${l.id}\` | [${l.asset}](https://ambientcg.com/view?id=${l.asset}) | ${l.note} |`),
  '',
  '## Packed runtime files',
  '',
  '| File | Contents | Size |',
  '|---|---|---|',
  `| \`${manifest.outputs.terrainAlbedoArray}\` | ${SIZE}×${SIZE * layers.length} JPEG — 8 albedo layers stacked, uploaded as a \`DataArrayTexture\` | ${sizes.albedo} kB |`,
  `| \`${manifest.outputs.terrainNormalArray}\` | same layout, OpenGL-convention tangent-space normals | ${sizes.normal} kB |`,
  `| \`${manifest.outputs.terrainOrmArray}\` | same layout; R = ambient occlusion, G = roughness, B = unused | ${sizes.orm} kB |`,
  `| \`${manifest.outputs.barkAlbedo}\` | 256² conifer bark albedo | ${sizes.bark} kB |`,
  `| \`${manifest.outputs.barkNormal}\` | 256² conifer bark normal | ${sizes.barkN} kB |`,
  '',
  '## Not downloaded, and why',
  '',
  '* **Sky HDRI (Poly Haven).** A baked HDRI cannot follow the game clock: the harness alone needs 06:00',
  '  dawn, noon, 19:00 dusk and 23:00 night at 47° N. The sky stays the analytic Preetham model',
  '  (`three/addons/objects/Sky.js`) driven by a real solar-position calculation, and `src/world/sky.ts`',
  '  renders a PMREM environment map **from that sky** every time the sun moves — so the image-based',
  '  lighting and the water reflections are the live sky, which a static HDRI could not give us.',
  '* **Quaternius / Poly Haven tree models.** Trees are built procedurally in `src/world/treeGeometry.ts`',
  '  (bark-textured trunk + branch whorls + alpha-tested needle sprays with a generated needle texture,',
  '  3 LODs + a billboard impostor). A downloaded GLB would be one fixed mesh at one LOD with its own',
  '  material; the procedural generator gives per-species silhouettes, the LOD chain the 1.5 M-triangle',
  '  budget needs, and species variation from one shared material.',
  '* **Alpha cut-out foliage/grass atlases.** Generated on a canvas at load time (`src/world/textures.ts`)',
  '  so the needle/leaf/blade colour follows the season tint instead of being baked.',
  '',
].join('\n');
await writeFile(path.join(root, 'public/assets/CREDITS-world.md'), credits);
console.log('  wrote public/assets/CREDITS-world.md');
console.log('done.');
