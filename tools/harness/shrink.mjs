import { chromium } from 'playwright';
import fs from 'node:fs';
const [,, ...files] = process.argv;
const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage();
for (const f of files) {
  const b64 = fs.readFileSync(f).toString('base64');
  const out = await page.evaluate(async (src) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + src; await img.decode();
    const w = 1280, h = Math.round(img.height * 1280 / img.width);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/jpeg', 0.82).split(',')[1];
  }, b64);
  const dst = '/tmp/claude-0/shots/' + f.split('/').pop().replace('.png', '.jpg');
  fs.writeFileSync(dst, Buffer.from(out, 'base64'));
  console.log(dst, fs.statSync(dst).size);
}
await browser.close();
