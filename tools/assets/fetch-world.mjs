#!/usr/bin/env node
/**
 * Reproducible fetch + pack step for the world-look assets (ARCHITECTURE.md §0: CC0 assets may be
 * downloaded; provenance goes in tools/assets/world-manifest.json and public/assets/CREDITS-world.md).
 *
 *   node tools/assets/fetch-world.mjs [--force] [--only terrain|veg]
 *
 * What it does
 *  1. downloads the 1K-JPG zip of every ambientCG set and the 1k twig/leaf/blade maps of every
 *     Poly Haven plant set named in world-manifest.json, into a cache directory OUTSIDE the repo
 *     ($TMPDIR/eidgenossen-world-assets, or $WORLD_ASSET_CACHE),
 *  2. unzips the maps we use (Color / NormalGL / Roughness + AmbientOcclusion),
 *  3. uses the Playwright Chromium that is already a devDependency as a headless image pipeline (no
 *     new npm packages — BUILDER_RULES.md):
 *       - the nine terrain layers are stacked into one 512x(512*9) JPEG per map type, uploaded at
 *         runtime as a three.js DataArrayTexture, which is what keeps the terrain to ONE material;
 *       - the Poly Haven plant sheets are colour+alpha merged, split into connected alpha blobs
 *         (single sprigs / leaves / blades), and RE-COMPOSED into 256px atlas cells: a spruce spray,
 *         a fir comb, a larch spray, a pine tuft, two beech clusters, a bare twig, plus a grass /
 *         dry-grass / fern / herb ground-cover sheet. Cropping per blob is why one 1k source sheet
 *         can supply several believable card shapes instead of one flat rectangle of leaves.
 *     Only the Poly Haven *textures* are used. Their meshes are unusable here: fir_tree_01's glTF is
 *     7.0 M triangles behind a 478 MB buffer, i.e. more than twice the WHOLE frame budget for one tree.
 *  4. writes public/assets/CREDITS-world.md.
 *
 * Every source asset is CC0 1.0. No attribution is legally required; we record it anyway.
 */
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
// Downloaded zips are ~120 MB; keep them OUT of the repo (the integrator commits this tree).
const CACHE = process.env.WORLD_ASSET_CACHE || path.join(os.tmpdir(), 'eidgenossen-world-assets');
const FORCE = process.argv.includes('--force');
const ONLY = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;

const manifest = JSON.parse(await readFile(path.join(__dirname, 'world-manifest.json'), 'utf8'));
const SIZE = manifest.layerSize;
const CELL = manifest.foliageCell;
const ACG = manifest.sources.ambientcg;
const PH = manifest.sources.polyhaven;

await mkdir(CACHE, { recursive: true });
await mkdir(path.join(root, 'public/assets/textures/terrain'), { recursive: true });
await mkdir(path.join(root, 'public/assets/textures/vegetation'), { recursive: true });

function curl(url, out, minBytes = 20000) {
  if (existsSync(out) && !FORCE) { try { if (require$size(out) > minBytes) return out; } catch { /* refetch */ } }
  const r = spawnSync('curl', ['-sSL', '--fail', '--max-time', '300', '-o', out, url], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`download failed: ${url}`);
  return out;
}
function require$size(f) { return (spawnSync('stat', ['-c', '%s', f]).stdout || '0').toString().trim() | 0; }

/** ambientCG serves the zip behind a 302 to a CDN; curl -L follows it. */
function acgZip(assetName) {
  const zip = path.join(CACHE, `${assetName}_1K-JPG.zip`);
  if (existsSync(zip) && !FORCE && require$size(zip) > 100000) return zip;
  console.log(`  fetching ${assetName} …`);
  return curl(ACG.url.replace('{name}', assetName), zip, 100000);
}

/** Unzip only the maps we use; returns {color, normal, roughness, ao} absolute paths. */
async function acgExtract(assetName, zip) {
  const dir = path.join(CACHE, assetName);
  await mkdir(dir, { recursive: true });
  const wanted = ['_Color.jpg', '_NormalGL.jpg', '_Roughness.jpg', '_AmbientOcclusion.jpg'];
  spawnSync('unzip', ['-o', '-j', '-q', zip, ...wanted.map((w) => `*${w}`), '-d', dir], { stdio: 'inherit' });
  const f = (suffix) => {
    // sets come as <Asset>_1K-JPG_<Map>.jpg, older ones as <Asset>_1K_<Map>.jpg
    for (const stem of [`${assetName}_1K-JPG${suffix}`, `${assetName}_1K${suffix}`]) {
      const p = path.join(dir, stem);
      if (existsSync(p)) return p;
    }
    return null;
  };
  return { color: f('_Color.jpg'), normal: f('_NormalGL.jpg'), roughness: f('_Roughness.jpg'), ao: f('_AmbientOcclusion.jpg') };
}

/**
 * One Poly Haven model map at 1k. The download URL is NOT a template: the API's map key
 * ("Diffuse", "twig_diff", "leaves_alpha") and the file stem disagree per asset, so the file
 * index is fetched once per asset and the exact url read out of it. The index is cached with the
 * downloads, so a rebuild is offline.
 */
const phIndexCache = new Map();
function phIndex(asset) {
  if (phIndexCache.has(asset)) return phIndexCache.get(asset);
  const f = path.join(CACHE, `ph-files-${asset}.json`);
  if (!existsSync(f) || FORCE) curl(`${PH.api}/files/${asset}`, f, 200);
  const d = JSON.parse(readFileSync(f, 'utf8'));
  phIndexCache.set(asset, d);
  return d;
}
function phMap(asset, map) {
  const node = phIndex(asset)[map]?.['1k'];
  if (!node) throw new Error(`poly haven: ${asset} has no map "${map}" (have: ${Object.keys(phIndex(asset)).join(', ')})`);
  const fmt = node.jpg ? 'jpg' : node.png ? 'png' : Object.keys(node)[0];
  const url = node[fmt].url;
  const out = path.join(CACHE, `${asset}_${map}_1k.${fmt}`);
  if (existsSync(out) && !FORCE && require$size(out) > 20000) return out;
  console.log(`  fetching ${asset} ${map} …`);
  return curl(url, out, 20000);
}
function phUrl(asset, map) { const n = phIndex(asset)[map]?.['1k']; return n ? (n.jpg ?? n.png ?? Object.values(n)[0]).url : ''; }

const layers = manifest.terrainLayers;
const veg = manifest.vegetation;
const foliage = manifest.foliage;

const doTerrain = !ONLY || ONLY === 'terrain';
const doVeg = !ONLY || ONLY === 'veg';

console.log(`fetching CC0 source sets …`);
const acgFiles = {};
for (const l of [...layers, ...veg]) {
  if (!doTerrain && layers.includes(l)) continue;
  if (!doVeg && veg.includes(l)) continue;
  acgFiles[l.asset] = await acgExtract(l.asset, acgZip(l.asset));
}
const phFiles = {};
if (doVeg) {
  for (const f of foliage) {
    phFiles[f.id] = { diff: phMap(f.asset, f.maps.diff), alpha: phMap(f.asset, f.maps.alpha) };
  }
}

// ---------------------------------------------------------------------------
// Image pipeline: Chromium canvas. Everything inside page.evaluate runs in the page.
// ---------------------------------------------------------------------------
const chromiumExe = process.env.HARNESS_CHROMIUM || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  ...(chromiumExe ? { executablePath: chromiumExe } : {}),
});
const page = await browser.newPage();
await page.goto('about:blank');
page.on('console', (m) => { if (m.type() === 'error') console.error('  [page]', m.text()); });

async function dataUrl(file) {
  const buf = await readFile(file);
  return `data:image/${file.endsWith('.png') ? 'png' : 'jpeg'};base64,${buf.toString('base64')}`;
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

/** ORM pack: R = ambient occlusion, G = roughness, B = 0.5 (spare). */
async function packOrm(list, quality) {
  const pairs = [];
  for (const l of list) {
    const f = acgFiles[l.asset];
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

// ---------------------------------------------------------------------------
// Foliage: blob-crop the Poly Haven sheets and re-compose them into atlas cells.
// ---------------------------------------------------------------------------

/** In-page helper source, injected once: merge colour+alpha, label alpha blobs, redraw them. */
const BLOB_LIB = /* js */ `
window.__load = async (u) => { const i = new Image(); i.src = u; await i.decode(); return i; };
/** colour jpg + alpha png -> one RGBA canvas at N x N */
window.__merge = async (diffUrl, alphaUrl, N) => {
  const c = document.createElement('canvas'); c.width = c.height = N;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(await window.__load(diffUrl), 0, 0, N, N);
  const a = document.createElement('canvas'); a.width = a.height = N;
  const actx = a.getContext('2d', { willReadFrequently: true });
  actx.drawImage(await window.__load(alphaUrl), 0, 0, N, N);
  const cd = ctx.getImageData(0, 0, N, N), ad = actx.getImageData(0, 0, N, N);
  for (let p = 0; p < N * N; p++) cd.data[p * 4 + 3] = ad.data[p * 4];
  ctx.putImageData(cd, 0, 0);
  return c;
};
/** connected components of alpha > thresh; returns [{x,y,w,h,area}] sorted by area desc */
window.__blobs = (canvas, thresh, minArea) => {
  const N = canvas.width;
  const d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, N, N).data;
  const lab = new Int32Array(N * N).fill(-1);
  const out = [];
  const stack = new Int32Array(N * N);
  for (let i = 0; i < N * N; i++) {
    if (lab[i] !== -1 || d[i * 4 + 3] <= thresh) continue;
    let sp = 0; stack[sp++] = i; lab[i] = out.length;
    let x0 = N, y0 = N, x1 = 0, y1 = 0, area = 0, sr = 0, sg = 0, sb = 0;
    while (sp > 0) {
      const q = stack[--sp];
      const qx = q % N, qy = (q / N) | 0;
      area++;
      sr += d[q * 4]; sg += d[q * 4 + 1]; sb += d[q * 4 + 2];
      if (qx < x0) x0 = qx; if (qx > x1) x1 = qx;
      if (qy < y0) y0 = qy; if (qy > y1) y1 = qy;
      // 8-connectivity: a needle sprig is thin and breaks apart under 4-connectivity
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = qx + dx, ny = qy + dy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const ni = ny * N + nx;
        if (lab[ni] === -1 && d[ni * 4 + 3] > thresh) { lab[ni] = out.length; stack[sp++] = ni; }
      }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    // Keep single sprigs/leaves/blades only: reject specks, and reject the huge merged mats some
    // sheets have in a corner (tree_small_02's filler slab would otherwise be the largest "leaf").
    // The fill test is loose because a grass blade is a thin diagonal: it covers a few percent of
    // its own bounding box and would fail any tighter threshold.
    if (area >= minArea && area <= N * N * 0.10 && bw <= N * 0.7 && bh <= N * 0.7 && area / (bw * bh) > 0.025) {
      const r = sr / area, g = sg / area, b = sb / area;
      out.push({ x: x0, y: y0, w: bw, h: bh, area, r, g, b, green: g / (1 + Math.max(r, b)) });
    }
    else { /* keep the label so we do not revisit it */ }
  }
  out.sort((a, b) => b.area - a.area);
  return out;
};
/** Blobs whose mean colour passes a test, largest first; falls back to all of them. */
window.__pick = (list, test) => { const r = list.filter(test); return r.length >= 2 ? r : list; };
/** deterministic PRNG so a rebuild is byte-identical */
window.__rng = (seed) => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };
/**
 * Draw one blob into ctx, its base at (bx, by), pointing "up" the card, rotated by rot,
 * scaled so its long axis is len px. A blob wider than tall is rotated 90 deg first so every
 * source sprig ends up growing along the card's v axis whatever way it lay on the sheet.
 */
window.__stamp = (ctx, src, b, bx, by, len, rot, flip, tint) => {
  const upright = b.h >= b.w;
  const long = upright ? b.h : b.w, short = upright ? b.w : b.h;
  const s = len / long;
  ctx.save();
  ctx.translate(bx, by);
  ctx.rotate(rot);
  if (flip) ctx.scale(-1, 1);
  ctx.scale(s, s);
  // put the blob's base (bottom of its long axis) at the origin, growing upward (-y)
  if (upright) ctx.drawImage(src, b.x, b.y, b.w, b.h, -b.w / 2, -b.h, b.w, b.h);
  else { ctx.rotate(-Math.PI / 2); ctx.drawImage(src, b.x, b.y, b.w, b.h, 0, -b.h / 2, b.w, b.h); }
  void short;
  ctx.restore();
  if (tint) {
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
  }
};
`;

async function buildFoliageAtlases(barkUrls) {
  const urls = {};
  for (const [id, f] of Object.entries(phFiles)) urls[id] = { diff: await dataUrl(f.diff), alpha: await dataUrl(f.alpha) };
  await page.addScriptTag({ content: BLOB_LIB });
  return page.evaluate(async ({ urls, CELL, cells, gcells, bark, barkPale }) => {
    const N = 1024;
    const src = {};
    for (const [id, u] of Object.entries(urls)) src[id] = await window.__merge(u.diff, u.alpha, N);
    const blobs = {};
    for (const id of Object.keys(src)) blobs[id] = window.__blobs(src[id], 96, 500);

    const sheet = (cols, rows) => {
      const c = document.createElement('canvas');
      c.width = cols * CELL; c.height = rows * CELL;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.clearRect(0, 0, c.width, c.height);
      return { c, x };
    };
    const cellCtx = (sh, gx, gy) => {
      const t = document.createElement('canvas');
      t.width = t.height = CELL;
      // 8 px inset: a leaf that touches the cell edge bleeds into the neighbouring cell once the
      // atlas is mipmapped, and a spruce card would pick up beech leaves at distance.
      const PAD = 8;
      return { t, ctx: t.getContext('2d', { willReadFrequently: true }), put: () => sh.x.drawImage(t, gx * CELL + PAD, gy * CELL + PAD, CELL - 2 * PAD, CELL - 2 * PAD) };
    };

    /** A conifer branch card: one long central spray plus side sprigs, base at bottom-centre. */
    const conifer = (ctx, list, seed, opts) => {
      const rnd = window.__rng(seed);
      const { srcCanvas, droop, sprigs, tint } = opts;
      // main axis
      ctx.strokeStyle = 'rgba(64,48,34,0.95)';
      ctx.lineWidth = CELL * 0.018;
      ctx.beginPath(); ctx.moveTo(CELL * 0.5, CELL); ctx.lineTo(CELL * 0.5, CELL * 0.08); ctx.stroke();
      for (let i = 0; i < sprigs; i++) {
        const t = i / (sprigs - 1 || 1);
        const b = list[Math.floor(rnd() * Math.min(list.length, 8))];
        const y = CELL * (0.97 - t * 0.9);
        const dir = i % 2 === 0 ? -1 : 1;
        const spread = (0.9 - t * 0.55);
        const rot = dir * (Math.PI * 0.5 - droop) * spread * (0.8 + rnd() * 0.4);
        const len = CELL * (0.30 + 0.22 * (1 - t)) * (0.8 + rnd() * 0.45);
        window.__stamp(ctx, srcCanvas, b, CELL * 0.5, y, len, rot, rnd() < 0.5, null);
      }
      // leader
      const lead = list[Math.floor(rnd() * Math.min(list.length, 4))];
      window.__stamp(ctx, srcCanvas, lead, CELL * 0.5, CELL * 0.30, CELL * 0.30, 0, false, null);
      if (tint) { ctx.save(); ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = tint; ctx.fillRect(0, 0, CELL, CELL); ctx.restore(); }
    };

    /** A broadleaf cluster: a short stem and many single leaves scattered over the upper card. */
    const cluster = (ctx, list, seed, opts) => {
      const rnd = window.__rng(seed);
      const { srcCanvas, count, tint, leafLen } = opts;
      ctx.strokeStyle = 'rgba(74,56,36,0.9)';
      ctx.lineWidth = CELL * 0.015;
      ctx.beginPath(); ctx.moveTo(CELL * 0.5, CELL); ctx.lineTo(CELL * 0.5, CELL * 0.35); ctx.stroke();
      for (let i = 0; i < 3; i++) {
        const a = (i - 1) * 0.5;
        ctx.beginPath(); ctx.moveTo(CELL * 0.5, CELL * (0.75 - i * 0.16));
        ctx.lineTo(CELL * (0.5 + Math.sin(a) * 0.4), CELL * (0.55 - i * 0.16)); ctx.stroke();
      }
      for (let i = 0; i < count; i++) {
        const b = list[Math.floor(rnd() * Math.min(list.length, 10))];
        const u = rnd(), v = rnd();
        const bx = CELL * (0.5 + (u - 0.5) * 0.92);
        const by = CELL * (0.95 - Math.pow(v, 0.75) * 0.88);
        const rot = (rnd() - 0.5) * 3.0;
        window.__stamp(ctx, srcCanvas, b, bx, by, CELL * leafLen * (0.7 + rnd() * 0.6), rot, rnd() < 0.5, null);
      }
      if (tint) { ctx.save(); ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = tint; ctx.fillRect(0, 0, CELL, CELL); ctx.restore(); }
    };

    /** A tuft: blades rising from the bottom edge. */
    const tuft = (ctx, list, seed, opts) => {
      const rnd = window.__rng(seed);
      const { srcCanvas, count, lenLo, lenHi, spread, tint } = opts;
      for (let i = 0; i < count; i++) {
        const b = list[Math.floor(rnd() * Math.min(list.length, 12))];
        const bx = CELL * (0.5 + (rnd() - 0.5) * spread);
        const rot = (rnd() - 0.5) * 0.9;
        window.__stamp(ctx, srcCanvas, b, bx, CELL * (0.99 - rnd() * 0.05), CELL * (lenLo + rnd() * (lenHi - lenLo)), rot, rnd() < 0.5, null);
      }
      if (tint) { ctx.save(); ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = tint; ctx.fillRect(0, 0, CELL, CELL); ctx.restore(); }
    };

    // -------- foliage sheet (4 x 3): sprigs, clusters, and the two trunk-bark tiles --------
    const fo = sheet(4, 3);
    const mk = (name, fn) => { const g = cells[name]; const cc = cellCtx(fo, g[0], g[1]); fn(cc.ctx); cc.put(); };
    // Mountain pine reuses the fir sprigs, shorter and darker: pine_tree_01's twig sheet is cones
    // and bark plates, and no colour test separates a grey bark plate from a needle comb reliably.
    // "green" alone is useless as a test: a grey bark plate has g/(1+max(r,b)) near 1 too, which is
    // how the pine cell ended up as a sheet of bark. Both tests need real saturation as well.
    const isFoliage = (b) => b.g > b.r * 1.04 && b.g > b.b * 1.12;
    const firB = window.__pick(blobs['conifer-sprig'], isFoliage);
    // shrub_01 carries green leaves, autumn leaves, a flower and a seed head on one sheet: split it
    // by mean hue so a summer beech is green and an autumn beech is not speckled with white flowers.
    const saturated = (b) => Math.max(b.r, b.g, b.b) - Math.min(b.r, b.g, b.b) > 22;   // drops the cream seed pods
    const leafGreen = window.__pick(blobs['broadleaf'], (b) => saturated(b) && b.g > b.r * 1.03 && b.g > b.b * 1.2);
    const leafAutumn = window.__pick(blobs['broadleaf'], (b) => saturated(b) && b.r > b.g * 1.12 && b.g > b.b * 1.1);
    const leafB = blobs['broadleaf-b'].length >= 4 ? blobs['broadleaf-b'] : null;
    mk('spruce', (c) => conifer(c, firB, 11, { srcCanvas: src['conifer-sprig'], droop: 0.62, sprigs: 13, tint: 'rgba(24,52,30,0.30)' }));
    mk('fir', (c) => conifer(c, firB, 23, { srcCanvas: src['conifer-sprig'], droop: 0.18, sprigs: 12, tint: 'rgba(38,70,48,0.20)' }));
    mk('larch', (c) => conifer(c, firB, 37, { srcCanvas: src['conifer-sprig'], droop: 0.35, sprigs: 11, tint: 'rgba(126,150,54,0.34)' }));
    mk('pine', (c) => conifer(c, firB, 51, { srcCanvas: src['conifer-sprig'], droop: 0.62, sprigs: 11, tint: 'rgba(40,62,36,0.34)' }));
    mk('beech', (c) => cluster(c, leafGreen, 67, { srcCanvas: src['broadleaf'], count: 34, leafLen: 0.28, tint: 'rgba(70,106,44,0.30)' }));
    mk('beechAutumn', (c) => cluster(c, leafAutumn, 67, { srcCanvas: src['broadleaf'], count: 34, leafLen: 0.28, tint: 'rgba(172,112,38,0.34)' }));
    mk('alder', (c) => cluster(c, leafB ?? leafGreen, 83, { srcCanvas: leafB ? src['broadleaf-b'] : src['broadleaf'], count: 30, leafLen: 0.24, tint: 'rgba(50,92,42,0.30)' }));
    mk('bare', (c) => conifer(c, firB, 97, { srcCanvas: src['conifer-sprig'], droop: 0.4, sprigs: 8, tint: 'rgba(96,74,50,0.72)' }));

    // Bark lives in the same sheet so trunk + foliage draw with ONE material. Each cell holds the
    // bark tile repeated 1x3 vertically, so a trunk UV'd once over the cell still shows bark at a
    // believable scale instead of one 15 m long stretched photograph.
    for (const [name, url] of [['bark', bark], ['barkPale', barkPale]]) {
      const g = cells[name];
      const img = await window.__load(url);
      // crop three horizontal bands out of the square source rather than squashing the whole
      // photograph into a 256x85 strip (which turned bark into featureless sand)
      const bh = Math.floor(img.height / 3);
      for (let r = 0; r < 3; r++) {
        fo.x.drawImage(img, 0, r * bh, img.width, bh, g[0] * CELL, g[1] * CELL + r * (CELL / 3), CELL, CELL / 3 + 1);
      }
    }

    // -------- ground-cover sheet (2 x 2) --------
    const gc = sheet(2, 2);
    const mg = (name, fn) => { const g = gcells[name]; const cc = cellCtx(gc, g[0], g[1]); fn(cc.ctx); cc.put(); };
    mg('grass', (c) => tuft(c, blobs['grass-blade'], 5, { srcCanvas: src['grass-blade'], count: 26, lenLo: 0.45, lenHi: 0.95, spread: 0.8, tint: 'rgba(72,104,42,0.18)' }));
    mg('grassDry', (c) => tuft(c, blobs['grass-dry'], 5, { srcCanvas: src['grass-dry'], count: 24, lenLo: 0.42, lenHi: 0.9, spread: 0.8, tint: 'rgba(158,140,74,0.22)' }));
    mg('fern', (c) => tuft(c, blobs['fern'], 13, { srcCanvas: src['fern'], count: 7, lenLo: 0.6, lenHi: 0.95, spread: 0.45, tint: 'rgba(48,86,36,0.2)' }));
    mg('herb', (c) => {
      tuft(c, blobs['grass-blade'], 29, { srcCanvas: src['grass-blade'], count: 9, lenLo: 0.3, lenHi: 0.55, spread: 0.7, tint: null });
      cluster(c, leafGreen, 31, { srcCanvas: src['broadleaf'], count: 11, leafLen: 0.2, tint: 'rgba(96,120,54,0.25)' });
    });

    return {
      foliage: fo.c.toDataURL('image/png'),
      ground: gc.c.toDataURL('image/png'),
      blobCounts: Object.fromEntries(Object.entries(blobs).map(([k, v]) => [k, v.length])),
    };
  }, { urls, CELL, cells: manifest.foliageAtlasCells, gcells: manifest.groundCoverAtlasCells, bark: barkUrls.bark, barkPale: barkUrls.barkPale });
}

// ---------------------------------------------------------------------------
// Rock scans: glTF -> vertex-cluster decimation -> a small JSON mesh
//
// Poly Haven's rock scans are photogrammetry at film resolution (measured: rock_09 6 k triangles,
// rock_07 14 k, boulder_01 ~70 k, and fir_tree_01 7.0 M behind a 478 MB buffer). The vegetation
// scatter puts hundreds of stones on screen, so the raw meshes are one to two orders of magnitude
// over budget. Clustering the vertices onto a coarse grid and averaging each cell keeps the
// silhouette and the scan UVs while landing at a few hundred triangles.
//
// The glTF is parsed by hand rather than with a loader: the only accessors needed are POSITION,
// TEXCOORD_0 and the indices, and pulling three typed-array views out of the .bin is less code than
// pulling in a parser would be — and this file may not add dependencies (BUILDER_RULES.md).
// ---------------------------------------------------------------------------

const GLTF_COMPONENT = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const GLTF_NUMCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function readAccessor(gltf, bin, index) {
  const acc = gltf.accessors[index];
  const view = gltf.bufferViews[acc.bufferView];
  const TA = GLTF_COMPONENT[acc.componentType];
  const n = GLTF_NUMCOMP[acc.type];
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const stride = view.byteStride ?? 0;
  const out = new Float32Array(acc.count * n);
  if (!stride || stride === TA.BYTES_PER_ELEMENT * n) {
    const src = new TA(bin.buffer, bin.byteOffset + base, acc.count * n);
    for (let i = 0; i < out.length; i++) out[i] = src[i];
  } else {
    for (let i = 0; i < acc.count; i++) {
      const src = new TA(bin.buffer, bin.byteOffset + base + i * stride, n);
      for (let k = 0; k < n; k++) out[i * n + k] = src[k];
    }
  }
  return out;
}

/** node -> 4x4 world matrix (column-major, glTF convention), following the scene hierarchy. */
function nodeMatrices(gltf) {
  const mul = (a, b) => {
    const o = new Float64Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      let v = 0;
      for (let k = 0; k < 4; k++) v += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = v;
    }
    return o;
  };
  const trs = (nd) => {
    if (nd.matrix) return Float64Array.from(nd.matrix);
    const [tx, ty, tz] = nd.translation ?? [0, 0, 0];
    const [qx, qy, qz, qw] = nd.rotation ?? [0, 0, 0, 1];
    const [sx, sy, sz] = nd.scale ?? [1, 1, 1];
    const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
    const xx = qx * x2, xy = qx * y2, xz = qx * z2, yy = qy * y2, yz = qy * z2, zz = qz * z2;
    const wx = qw * x2, wy = qw * y2, wz = qw * z2;
    return Float64Array.from([
      (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
      (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
      (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
      tx, ty, tz, 1,
    ]);
  };
  const out = new Map();
  const walk = (i, parent) => {
    const nd = gltf.nodes[i];
    const m = mul(parent, trs(nd));
    if (nd.mesh !== undefined) out.set(i, { mesh: nd.mesh, m });
    for (const c of nd.children ?? []) walk(c, m);
  };
  const identity = Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  for (const r of gltf.scenes?.[gltf.scene ?? 0]?.nodes ?? gltf.nodes.map((_, i) => i)) walk(r, identity);
  return out;
}

/** Cluster vertices onto a `res`^3 grid over the bbox; average per cell; rebuild the index. */
function decimate(pos, uv, idx, res) {
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    if (pos[i] < minX) minX = pos[i]; if (pos[i] > maxX) maxX = pos[i];
    if (pos[i + 1] < minY) minY = pos[i + 1]; if (pos[i + 1] > maxY) maxY = pos[i + 1];
    if (pos[i + 2] < minZ) minZ = pos[i + 2]; if (pos[i + 2] > maxZ) maxZ = pos[i + 2];
  }
  const sx = Math.max(1e-6, maxX - minX), sy = Math.max(1e-6, maxY - minY), sz = Math.max(1e-6, maxZ - minZ);
  const cell = new Map();
  const cellOf = new Int32Array(pos.length / 3);
  for (let v = 0; v < pos.length / 3; v++) {
    const cx = Math.min(res - 1, Math.floor(((pos[v * 3] - minX) / sx) * res));
    const cy = Math.min(res - 1, Math.floor(((pos[v * 3 + 1] - minY) / sy) * res));
    const cz = Math.min(res - 1, Math.floor(((pos[v * 3 + 2] - minZ) / sz) * res));
    const key = (cx * res + cy) * res + cz;
    let e = cell.get(key);
    if (!e) { e = { id: cell.size, x: 0, y: 0, z: 0, u: 0, w: 0, n: 0 }; cell.set(key, e); }
    e.x += pos[v * 3]; e.y += pos[v * 3 + 1]; e.z += pos[v * 3 + 2];
    if (uv) { e.u += uv[v * 2]; e.w += uv[v * 2 + 1]; }
    e.n++;
    cellOf[v] = e.id;
  }
  const nv = cell.size;
  const P = new Float32Array(nv * 3), U = new Float32Array(nv * 2);
  for (const e of cell.values()) {
    P[e.id * 3] = e.x / e.n; P[e.id * 3 + 1] = e.y / e.n; P[e.id * 3 + 2] = e.z / e.n;
    U[e.id * 2] = e.u / e.n; U[e.id * 2 + 1] = e.w / e.n;
  }
  const I = [];
  const seen = new Set();
  for (let t = 0; t < idx.length; t += 3) {
    const a = cellOf[idx[t]], b = cellOf[idx[t + 1]], c = cellOf[idx[t + 2]];
    if (a === b || b === c || a === c) continue;          // collapsed to an edge or a point
    const key = [a, b, c].sort((x, y) => x - y).join(',');
    if (seen.has(key)) continue;                           // two source faces landed on one cell triple
    seen.add(key);
    I.push(a, b, c);
  }
  // area-weighted vertex normals
  const N = new Float32Array(nv * 3);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const o of [a, b, c]) { N[o] += nx; N[o + 1] += ny; N[o + 2] += nz; }
  }
  for (let v = 0; v < nv; v++) {
    const l = Math.hypot(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]) || 1;
    N[v * 3] /= l; N[v * 3 + 1] /= l; N[v * 3 + 2] /= l;
  }
  return { P, N, U, I };
}

/** Normalise to unit height, centred on x/z, base at y = 0. */
function normaliseUpright(P) {
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < P.length; i += 3) {
    if (P[i] < minX) minX = P[i]; if (P[i] > maxX) maxX = P[i];
    if (P[i + 1] < minY) minY = P[i + 1]; if (P[i + 1] > maxY) maxY = P[i + 1];
    if (P[i + 2] < minZ) minZ = P[i + 2]; if (P[i + 2] > maxZ) maxZ = P[i + 2];
  }
  const h = Math.max(1e-6, maxY - minY);
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  for (let i = 0; i < P.length; i += 3) {
    P[i] = (P[i] - cx) / h;
    P[i + 1] = (P[i + 1] - minY) / h;
    P[i + 2] = (P[i + 2] - cz) / h;
  }
}

async function buildRockMesh(spec, targetTris) {
  const idx = phIndex(spec.asset);
  const g = idx.gltf?.['1k']?.gltf;
  if (!g) throw new Error(`no 1k glTF for ${spec.asset}`);
  const dir = path.join(CACHE, `gltf-${spec.asset}`);
  await mkdir(dir, { recursive: true });
  const gltfFile = path.join(dir, 'model.gltf');
  if (!existsSync(gltfFile) || FORCE) curl(g.url, gltfFile, 500);
  const gltf = JSON.parse(readFileSync(gltfFile, 'utf8'));
  const binName = gltf.buffers[0].uri;
  const binEntry = Object.entries(g.include ?? {}).find(([k]) => k.endsWith(binName));
  if (!binEntry) throw new Error(`${spec.asset}: no .bin in the file index`);
  const binFile = path.join(dir, 'model.bin');
  if (!existsSync(binFile) || FORCE) curl(binEntry[1].url, binFile, 1000);
  const bin = readFileSync(binFile);

  const pos = [], uv = [], ind = [];
  let base = 0;
  for (const { mesh, m } of nodeMatrices(gltf).values()) {
    for (const prim of gltf.meshes[mesh].primitives) {
      if (prim.attributes.POSITION === undefined || prim.indices === undefined) continue;
      const p = readAccessor(gltf, bin, prim.attributes.POSITION);
      const t = prim.attributes.TEXCOORD_0 !== undefined ? readAccessor(gltf, bin, prim.attributes.TEXCOORD_0) : null;
      const i = readAccessor(gltf, bin, prim.indices);
      for (let v = 0; v < p.length; v += 3) {
        const x = p[v], y = p[v + 1], z = p[v + 2];
        pos.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]);
      }
      for (let v = 0; v < p.length / 3; v++) { uv.push(t ? t[v * 2] : 0, t ? t[v * 2 + 1] : 0); }
      for (let k = 0; k < i.length; k++) ind.push(base + i[k]);
      base += p.length / 3;
    }
  }
  const P0 = Float32Array.from(pos), U0 = Float32Array.from(uv), I0 = Uint32Array.from(ind);
  // pick the coarsest grid that still clears the triangle target — the mesh is a closed blob, so
  // triangle count grows roughly as res^2
  let best = null;
  for (let res = 5; res <= 26; res++) {
    const d = decimate(P0, U0, I0, res);
    const tris = d.I.length / 3;
    if (!best || Math.abs(tris - targetTris) < Math.abs(best.tris - targetTris)) best = { ...d, tris, res };
    if (tris > targetTris * 1.6) break;
  }
  normaliseUpright(best.P);
  console.log(`  ${spec.id}: ${I0.length / 3} tris -> ${best.tris} (grid ${best.res}^3)`);
  return {
    positions: Array.from(best.P, (v) => Math.round(v * 10000) / 10000),
    normals: Array.from(best.N, (v) => Math.round(v * 1000) / 1000),
    uvs: Array.from(best.U, (v) => Math.round(v * 10000) / 10000),
    indices: Array.from(best.I),
    source: `${spec.asset} (Poly Haven, ${spec.licence})`,
    sourceTris: I0.length / 3,
  };
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
const sizes = {};
if (doTerrain) {
  console.log(`packing ${layers.length} terrain layers …`);
  sizes.albedo = await writeDataUrl(manifest.outputs.terrainAlbedoArray, await packArray('albedo', layers.map((l) => acgFiles[l.asset].color), Q.albedo));
  sizes.normal = await writeDataUrl(manifest.outputs.terrainNormalArray, await packArray('normal', layers.map((l) => acgFiles[l.asset].normal), Q.normal));
  sizes.orm = await writeDataUrl(manifest.outputs.terrainOrmArray, await packOrm(layers, Q.orm));
}
if (doVeg) {
  console.log('packing bark …');
  const bark = veg.find((v) => v.id === 'bark-conifer');
  const barkPale = veg.find((v) => v.id === 'bark-broadleaf');
  sizes.bark = await writeDataUrl(manifest.outputs.barkAlbedo, await packSingle(acgFiles[bark.asset].color, 512, 0.9));
  sizes.barkN = await writeDataUrl(manifest.outputs.barkNormal, await packSingle(acgFiles[bark.asset].normal, 512, 0.92));
  sizes.barkPale = await writeDataUrl(manifest.outputs.barkPaleAlbedo, await packSingle(acgFiles[barkPale.asset].color, 512, 0.9));
  sizes.barkPaleN = await writeDataUrl(manifest.outputs.barkPaleNormal, await packSingle(acgFiles[barkPale.asset].normal, 512, 0.92));

  console.log('decimating rock scans …');
  await mkdir(path.join(root, 'public/assets/models/vegetation'), { recursive: true });
  for (const spec of manifest.rocks) {
    const target = manifest.decimation.targetTris[spec.id];
    const mesh = await buildRockMesh(spec, target);
    const rel = `public/assets/models/vegetation/${spec.id}.json`;
    await writeFile(path.join(root, rel), JSON.stringify(mesh));
    console.log(`  wrote ${rel}  (${Math.round((await stat(path.join(root, rel))).size / 1024)} kB)`);
  }
  {
    const rt = manifest.rockTexture;
    sizes.rockDiff = await writeDataUrl('public/assets/models/vegetation/rock-scan-diff.jpg', await packSingle(phMap(rt.asset, rt.maps.diff), 512, 0.9));
    sizes.rockNor = await writeDataUrl('public/assets/models/vegetation/rock-scan-nor.jpg', await packSingle(phMap(rt.asset, rt.maps.nor), 512, 0.92));
  }

  console.log('composing foliage cut-outs …');
  const atlases = await buildFoliageAtlases({
    bark: await dataUrl(acgFiles[bark.asset].color),
    barkPale: await dataUrl(acgFiles[barkPale.asset].color),
  });
  console.log('  alpha blobs found:', JSON.stringify(atlases.blobCounts));
  sizes.foliage = await writeDataUrl(manifest.outputs.foliageAtlas, atlases.foliage);
  sizes.ground = await writeDataUrl(manifest.outputs.groundCoverAtlas, atlases.ground);
}

await browser.close();

// ---------------------------------------------------------------------------
const rows = [];
if (doTerrain) {
  for (const [out, key] of [[manifest.outputs.terrainAlbedoArray, 'albedo'], [manifest.outputs.terrainNormalArray, 'normal'], [manifest.outputs.terrainOrmArray, 'orm']]) {
    for (const l of layers) rows.push([`${out} #L${l.layer} (${l.id})`, ACG.url.replace('{name}', l.asset), l.author, l.licence, `${sizes[key]} kB (whole array)`]);
  }
}
if (doVeg) {
  const b = veg.find((v) => v.id === 'bark-conifer'), bp = veg.find((v) => v.id === 'bark-broadleaf');
  rows.push([manifest.outputs.barkAlbedo, ACG.url.replace('{name}', b.asset), b.author, b.licence, `${sizes.bark} kB`]);
  rows.push([manifest.outputs.barkNormal, ACG.url.replace('{name}', b.asset), b.author, b.licence, `${sizes.barkN} kB`]);
  rows.push([manifest.outputs.barkPaleAlbedo, ACG.url.replace('{name}', bp.asset), bp.author, bp.licence, `${sizes.barkPale} kB`]);
  rows.push([manifest.outputs.barkPaleNormal, ACG.url.replace('{name}', bp.asset), bp.author, bp.licence, `${sizes.barkPaleN} kB`]);
  for (const spec of manifest.rocks) {
    rows.push([`public/assets/models/vegetation/${spec.id}.json`, phIndex(spec.asset).gltf['1k'].gltf.url, spec.author, spec.licence, `decimated to ~${manifest.decimation.targetTris[spec.id]} tris`]);
  }
  {
    const rt = manifest.rockTexture;
    rows.push(['public/assets/models/vegetation/rock-scan-diff.jpg', phUrl(rt.asset, rt.maps.diff), rt.author, rt.licence, `${sizes.rockDiff} kB`]);
    rows.push(['public/assets/models/vegetation/rock-scan-nor.jpg', phUrl(rt.asset, rt.maps.nor), rt.author, rt.licence, `${sizes.rockNor} kB`]);
  }
  for (const f of foliage) {
    const u = phUrl(f.asset, f.maps.diff);
    rows.push([`${manifest.outputs.foliageAtlas} / ${manifest.outputs.groundCoverAtlas} (${f.id})`, u, f.author, f.licence, `${sizes.foliage} / ${sizes.ground} kB`]);
  }
}
const credits = [
  '# Credits — world look (terrain, vegetation, sky, water)',
  '',
  'Every source file below is **CC0 1.0 Universal (public domain dedication)**, from',
  `**${ACG.author}** (${ACG.homepage}) and **${PH.author}** (${PH.homepage}).`,
  'Fetched and packed reproducibly by `node tools/assets/fetch-world.mjs` from `tools/assets/world-manifest.json`.',
  '',
  `The three terrain files are 512×${SIZE * layers.length} JPEGs holding ${layers.length} 512² layers each, uploaded as three.js \`DataArrayTexture\`s.`,
  'The foliage / ground-cover sheets are RGBA PNGs whose cells are **re-composed** from the source',
  'photographs: each Poly Haven plant texture is split into its connected alpha blobs (one needle',
  'sprig, one leaf, one grass blade) and those blobs are re-stamped into a branch spray, a leaf',
  'cluster or a tuft.',
  '',
  'Poly Haven’s rock *meshes* are used, but only after decimation: the raw scans measured here are',
  '`rock_09` 12.4 k triangles, `rock_07` 14.8 k and `boulder_01` 66.1 k, against a scatter that puts',
  'hundreds of stones on screen, so `fetch-world.mjs` clusters their vertices onto a coarse grid and',
  'writes 260–640 triangle JSON meshes. The *tree* meshes are not used at any resolution:',
  '`fir_tree_01`’s 1k glTF is 7.0 M triangles behind a 478 MB buffer — more than twice the whole',
  'frame budget for one tree — so the trees are generated from the twig cut-outs instead.',
  '',
  '| File | Source URL | Author | Licence | Size |',
  '|---|---|---|---|---|',
  ...rows.map((r) => `| \`${r[0]}\` | ${r[1]} | ${r[2]} | ${r[3]} | ${r[4]} |`),
  '',
  '## Generated at runtime (no external file)',
  '',
  '| Asset | Where | Why not downloaded |',
  '|---|---|---|',
  '| Sky, clouds, stars, moon | `src/world/sky.ts` (Preetham `three/addons/objects/Sky.js` + canvas cloud/star/moon sprites) | a baked HDRI cannot follow the 06:00/12:00/19:00/23:00 game clock at 47° N; the sun/moon path, haze colour, exposure and the water reflection are all evaluated from the live solar elevation instead |',
  '| Tree meshes, LODs and billboard impostors | `src/world/treeGeometry.ts`, `src/world/look/impostor.ts` | see above: the only CC0 conifer meshes available are film-resolution. The geometry is generated per species with 3 LODs, and the far billboard is painted from the SAME foliage cells the near mesh uses, so a forest does not change colour when it crosses the LOD line |',
  '| Terrain splat mask, macro-variation noise, near-field detail, water ripple normals | `src/world/look/splat.ts`, `src/world/textures.ts`, `src/world/terrainMaterial.ts` | derived from the height model / procedural; nothing to download |',
  '| Lake shore-distance atlas, foam mask | `src/world/water.ts` | baked from the gazetteer lake polygons at load; a downloadable texture could not know where the shore is |',
  '| Parchment map sheet (paper, hillshade, ink work, hachures) | `src/world/map.ts` | drawn to a canvas from the live height model so the chart always matches the terrain the seed produced |',
  '',
].join('\n');
await writeFile(path.join(root, 'public/assets/CREDITS-world.md'), credits);
console.log('  wrote public/assets/CREDITS-world.md');
console.log('done.');
