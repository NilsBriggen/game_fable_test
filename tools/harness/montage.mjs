// Tiles PNG/JPEG files side by side into one JPEG (evidence sheets): node tools/harness/montage.mjs out.jpg a.png b.png …
import { chromium } from 'playwright';
import fs from 'node:fs';
const [,, out, ...files] = process.argv;
const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage();
const srcs = files.map((f) => `data:image/${f.endsWith('.jpg') ? 'jpeg' : 'png'};base64,` + fs.readFileSync(f).toString('base64'));
const b64 = await page.evaluate(async (srcs) => {
  const imgs = await Promise.all(srcs.map(async (s) => { const i = new Image(); i.src = s; await i.decode(); return i; }));
  const h = Math.min(720, ...imgs.map((i) => i.height));
  const ws = imgs.map((i) => Math.round(i.width * h / i.height));
  const c = document.createElement('canvas'); c.width = ws.reduce((a, b) => a + b, 0); c.height = h;
  const g = c.getContext('2d'); let x = 0;
  imgs.forEach((im, k) => { g.drawImage(im, x, 0, ws[k], h); x += ws[k]; });
  return c.toDataURL('image/jpeg', 0.82).split(',')[1];
}, srcs);
fs.writeFileSync(out, Buffer.from(b64, 'base64'));
console.log(out, fs.statSync(out).size);
await browser.close();
