#!/usr/bin/env node
/**
 * Measures the mean *linear* albedo of every downloaded prop texture:
 *   node tools/assets/albedo.mjs
 * The renderer multiplies `map * vertexColor`, so a painted tint only lands on the intended tone if it
 * is multiplied by ~0.8/albedo. Those are the gains in `TINT_GAIN` (src/world/models.ts) and the four
 * `SkinBuilder.gain` values in src/world/characters.ts — re-run this if a texture is ever swapped.
 */
import fs from 'node:fs';
import { chromium } from 'playwright';
const exe = process.env.HARNESS_CHROMIUM || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const b = await chromium.launch(exe ? { executablePath: exe } : {});
const p = await b.newPage();
await p.setContent('<canvas id="c" width="64" height="64"></canvas>');
const ids = ['wool', 'leather', 'iron', 'chainmail', 'wood-log', 'wood-plank', 'shingle', 'stone-block', 'drystone', 'plaster', 'thatch', 'rock'];
for (const id of ids) {
  const data = 'data:image/jpeg;base64,' + fs.readFileSync(`public/assets/textures/props/${id}/diff.jpg`).toString('base64');
  const m = await p.evaluate(async (d) => {
    const img = new Image(); img.src = d; await img.decode();
    const c = document.getElementById('c'); const x = c.getContext('2d');
    x.drawImage(img, 0, 0, 64, 64);
    const px = x.getImageData(0, 0, 64, 64).data;
    let r = 0, g = 0, bl = 0;
    for (let i = 0; i < px.length; i += 4) { r += px[i]; g += px[i + 1]; bl += px[i + 2]; }
    const n = px.length / 4;
    const srgb = [r / n / 255, g / n / 255, bl / n / 255];
    const lin = (v) => (v < 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    return { srgb: srgb.map((v) => +v.toFixed(3)), linear: srgb.map((v) => +lin(v).toFixed(3)) };
  }, data);
  console.log(id.padEnd(12), 'sRGB', m.srgb.join(','), ' linear', m.linear.join(','), ' gain→1.0:', (1 / Math.max(0.02, (m.linear[0] + m.linear[1] + m.linear[2]) / 3)).toFixed(2));
}
await b.close();
