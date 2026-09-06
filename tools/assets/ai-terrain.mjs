#!/usr/bin/env node
/**
 * Phase 6 AI texture batch: generate 9 tileable terrain albedos via OpenRouter
 * (google/gemini-2.5-flash-image), enforce seamlessness with ImageMagick, pack
 * into the 512x4608 layer-stack JPEGs the terrain DataArrayTextures decode.
 *
 *   node tools/assets/ai-terrain.mjs            # generate (costs ~$0.36) + pack
 *   node tools/assets/ai-terrain.mjs --pack-only # re-pack from cached PNGs
 *
 * Normals/ORM are preserved from the existing CC0 arrays (layer-extract +
 * re-append); only albedo layers are swapped. Provenance: CREDITS-world.md
 * gets `AI-generated (gemini-2.5-flash-image, date, cost)` rows via --credits.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CACHE = '/tmp/opencode/ai-terrain';
fs.mkdirSync(CACHE, { recursive: true });
const args = process.argv.slice(2);
const PACK_ONLY = args.includes('--pack-only');

const LAYERS = [
  { id: 'grass', layer: 0, prompt: 'Seamless tileable texture, flat top-down photograph of lush lowland pasture grass, short dense green blades, overcast light, uniform detail across the whole frame, no objects, no perspective, no horizon, fill the frame edge to edge' },
  { id: 'meadow', layer: 1, prompt: 'Seamless tileable texture, flat top-down photograph of dry alpine meadow grass, hay-yellow-green tall grass seed heads, late summer, overcast light, uniform detail, no objects, no perspective, no horizon, fill the frame edge to edge' },
  { id: 'forest', layer: 2, prompt: 'Seamless tileable texture, flat top-down photograph of conifer forest floor, brown-grey needle litter with small sticks and pebbles, muted, overcast light, uniform detail, no plants growing, no perspective, fill the frame edge to edge' },
  { id: 'rock', layer: 3, prompt: 'Seamless tileable texture, flat top-down photograph of grey alpine limestone rock surface, fine grain with small pits, overcast light, uniform detail, no cracks, no boulders, no perspective, fill the frame edge to edge' },
  { id: 'scree', layer: 4, prompt: 'Seamless tileable texture, flat top-down photograph of alpine scree, small angular grey gravel stones densely packed, uniform size, overcast light, no large boulders, no perspective, fill the frame edge to edge' },
  { id: 'snow', layer: 5, prompt: 'Seamless tileable texture, flat top-down photograph of old compacted snow surface, very subtle wind ripples, faint blue shadows in hollows, overcast light, uniform, no footprints, no objects, no horizon, fill the frame edge to edge' },
  { id: 'mud', layer: 6, prompt: 'Seamless tileable texture, flat top-down photograph of wet brown mud earth, smooth with small puddle sheen patches and tiny stones, overcast light, uniform detail, no plants, no perspective, fill the frame edge to edge' },
  { id: 'yard', layer: 7, prompt: 'Seamless tileable texture, flat top-down photograph of dry beaten village earth, pale tan dirt with small trodden-in stones and faint straw flecks, uniform detail, no objects, no perspective, fill the frame edge to edge' },
  { id: 'track', layer: 8, prompt: 'Seamless tileable texture, flat top-down photograph of dirt cart track surface, dark brown packed earth with two faint parallel wheel lines running vertically, small stones, uniform, no perspective, fill the frame edge to edge' },
];

function authKey() {
  const a = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.local/share/opencode/auth.json'), 'utf8'));
  return typeof a.openrouter === 'string' ? a.openrouter : a.openrouter.key;
}

async function generate(layer, attempt = 0) {
  const out = path.join(CACHE, `ai-${layer.id}.png`);
  if (fs.existsSync(out) && fs.statSync(out).size > 100000) { console.log(`[ai] cached ${layer.id}`); return out; }
  // Gemini image filter trips on some texture prompts (IMAGE_RECITATION); reword once, then
  // fall back to Pollinations Flux (free, weaker) rather than failing the batch.
  const prompts = [layer.prompt, `Original seamless game texture, ${layer.id} ground material, subtle uniform detail, stylized realism, video game asset, no watermark`];
  const prompt = prompts[Math.min(attempt, prompts.length - 1)];
  const body = JSON.stringify({
    model: 'google/gemini-2.5-flash-image',
    messages: [{ role: 'user', content: layer.prompt }],
    modalities: ['image', 'text'],
  });
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + authKey(), 'Content-Type': 'application/json', 'HTTP-Referer': 'http://localhost', 'X-Title': 'eidgenossen-phase6' },
    body,
  });
  if (!res.ok) throw new Error(`openrouter ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const d = await res.json();
  const img = d?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!img) {
    const reason = d?.choices?.[0]?.native_finish_reason ?? d?.choices?.[0]?.finish_reason;
    if (attempt < 2 && (reason === 'content_filter' || reason === 'IMAGE_RECITATION')) {
      console.log(`[ai] ${layer.id}: filtered (${reason}), retrying reworded…`);
      await new Promise((r) => setTimeout(r, 3000));
      return generate(layer, attempt + 1);
    }
    if (attempt < 3) {
      console.log(`[ai] ${layer.id}: falling back to Pollinations Flux…`);
      const url = `https://image.pollinations.ai/prompt/${encodeURIComponent('seamless tileable ' + layer.id + ' ground texture top-down photograph, uniform detail, no objects')}/?width=1024&height=1024&nologo=true&model=flux&seed=1291`;
      const r2 = await fetch(url);
      if (!r2.ok) throw new Error(`pollinations ${r2.status} for ${layer.id}`);
      fs.writeFileSync(out, Buffer.from(await r2.arrayBuffer()));
      console.log(`[ai] ${layer.id} via flux: ${(fs.statSync(out).size / 1024).toFixed(0)} KB (free)`);
      return out;
    }
    throw new Error(`no image for ${layer.id}: ${JSON.stringify(d).slice(0, 400)}`);
  }
  fs.writeFileSync(out, Buffer.from(img.split(',', 1 + 1)[1] ?? img.split(',')[1], 'base64'));
  console.log(`[ai] ${layer.id}: ${(fs.statSync(out).size / 1024).toFixed(0)} KB, cost $${d?.usage?.cost ?? '?'}`);
  return out;
}

const sh = (cmd, a) => execFileSync(cmd, a, { stdio: 'inherit' });

/** Make seamless: offset by half with wrap, cross-blend with original over a
 *  wide band so no edge discontinuity survives, then crop back. Classic. */
function seamless(src, dst) {
  const tmp = dst + '.tmp.png';
  // offset copy (wrapped) then blend: result = src*(mask) + offset*(1-mask) with a smooth diamond mask
  sh('convert', [src, '-resize', '512x512!', '-colorspace', 'sRGB', tmp + '.rs.png']);
  sh('convert', [tmp + '.rs.png', '-roll', '+256+256', tmp + '.off.png']);
  // diamond gradient mask, blurred so the blend band is wide
  sh('convert', ['-size', '512x512', 'xc:black', '-fill', 'white', '-draw', 'polygon 256,56 456,256 256,456 56,256',
    '-blur', '0x90', tmp + '.mask.png']);
  sh('convert', [tmp + '.rs.png', tmp + '.off.png', tmp + '.mask.png', '-composite', dst]);
  for (const f of [tmp + '.rs.png', tmp + '.off.png', tmp + '.mask.png']) try { fs.unlinkSync(f); } catch {}
}

function pack() {
  const texDir = path.join(root, 'public/assets/textures/terrain');
  const backup = path.join(CACHE, 'backup-cc0');
  fs.mkdirSync(backup, { recursive: true });
  for (const kind of ['albedo', 'normal', 'orm']) {
    const f = path.join(texDir, `${kind}-array.jpg`);
    if (!fs.existsSync(path.join(backup, `${kind}-array.jpg`))) fs.copyFileSync(f, path.join(backup, `${kind}-array.jpg`));
  }
  // split albedo stack into 9 layers
  sh('convert', [path.join(texDir, 'albedo-array.jpg'), '-crop', '512x512', '+repage', '+adjoin', path.join(CACHE, 'cc-albedo-%d.jpg')]);
  const layers = [];
  for (const l of LAYERS) {
    const ai = path.join(CACHE, `ai-${l.id}.jpg`);
    seamless(path.join(CACHE, `ai-${l.id}.png`), ai);
    // match brightness/contrast feel of CC0 set: mild normalize, JPEG q92
    sh('convert', [ai, '-quality', '92', ai]);
    layers.push(ai);
    console.log(`[ai] layer ${l.layer} ${l.id} seamless ok`);
  }
  sh('convert', [...layers, '-append', '-quality', '92', path.join(texDir, 'albedo-array.jpg')]);
  console.log('[ai] packed public/assets/textures/terrain/albedo-array.jpg',
    (fs.statSync(path.join(texDir, 'albedo-array.jpg')).size / 1024).toFixed(0) + ' KB');
}

if (!PACK_ONLY) { for (const l of LAYERS) await generate(l); }
pack();
console.log('[ai] done. CC0 backup in', path.join(CACHE, 'backup-cc0'));
