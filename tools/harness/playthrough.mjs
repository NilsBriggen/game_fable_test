#!/usr/bin/env node
/**
 * Final-gate driver: runs the Act 1 playthrough headlessly (Rütlischwur → Morgarten → Brunnen) with the UI on,
 * screenshots every beat and every dialogue, and writes a report. ARCHITECTURE.md §8 / task step 5.
 * node tools/harness/playthrough.mjs [--pick first|last|random] [--out dir] [--port N]
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const PICK = opt('--pick', 'first');
const OUT = path.resolve(root, opt('--out', `tools/harness/out/playthrough-${PICK}`));
const PORT = Number(opt('--port', 0)) || 5800 + Math.floor(Math.random() * 300);
const URL_BASE = `http://127.0.0.1:${PORT}`;
await mkdir(OUT, { recursive: true });

// same lock as run.mjs
const LOCK = path.join(root, 'tools/harness/.lock');
const t0 = Date.now();
while (true) {
  try { fs.mkdirSync(LOCK); fs.writeFileSync(path.join(LOCK, 'pid'), String(process.pid)); break; } catch {}
  try { if (Date.now() - fs.statSync(LOCK).mtimeMs > 45 * 60 * 1000) { fs.rmSync(LOCK, { recursive: true, force: true }); continue; } } catch { continue; }
  if (Date.now() - t0 > 240 * 60 * 1000) { console.error("playthrough: lock timeout"); process.exit(3); }
  await new Promise((r) => setTimeout(r, 2000));
}
const release = () => { try { fs.rmSync(LOCK, { recursive: true, force: true }); } catch {} };
for (const sig of ['exit', 'SIGINT', 'SIGTERM']) process.on(sig, () => { release(); if (sig !== 'exit') process.exit(130); });

async function waitHttp(url, ms) { const s = Date.now(); while (Date.now() - s < ms) { try { if ((await fetch(url)).ok) return true; } catch {} await new Promise((r) => setTimeout(r, 300)); } return false; }
const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: root, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, NO_COLOR: '1', HARNESS_NO_HMR: '1' } });
server.stderr.on('data', (d) => process.stderr.write(`[vite] ${d}`));
if (!(await waitHttp(URL_BASE, 60000))) { console.error('dev server did not start'); process.exit(2); }

const executablePath = process.env.HARNESS_CHROMIUM || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--enable-webgl'], ...(executablePath ? { executablePath } : {}) });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(180000);
const pageErrors = []; page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
const consoleErrors = []; page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('response', (r) => { if (r.status() >= 400) consoleErrors.push(`HTTP ${r.status()} ${r.url()}`); });
const shots = [];
await page.exposeFunction('__shot', async (name) => {
  const file = path.join(OUT, `${name}.png`);
  try { await page.screenshot({ path: file, timeout: 180000 }); shots.push(path.relative(root, file)); } catch (e) { shots.push(`FAILED ${name}: ${e.message}`); }
});
await page.goto(`${URL_BASE}/?harness=1`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__harness && window.__harness.ready, null, { timeout: 120000 });
await page.evaluate(() => window.__harness.ready);
console.log(`renderer: ${await page.evaluate(() => window.__harness.stats().renderer)}`);

const started = Date.now();
const result = await page.evaluate(async (pick) => {
  const h = window.__harness;
  const before = { e: h.console.errors.length, w: h.console.warnings.length };
  const r = await h.runAct1Playthrough({ pick, screenshot: (name) => window.__shot(name), maxSecondsPerBeat: 150 });
  const st = h.stats();
  return { ...r, errors: h.console.errors.slice(before.e), warnings: h.console.warnings.slice(before.w), drawCalls: st.drawCalls, heapMB: st.heapMB, state: st.state };
}, PICK);
const report = { generatedAt: new Date().toISOString(), pick: PICK, durationSec: Math.round((Date.now() - started) / 1000), ...result, pageErrors, consoleErrorsFromBrowser: consoleErrors, screenshots: shots };
report.completed = result.log.every((b) => b.ok);
await writeFile(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
const md = [
  `# Act 1 playthrough — pick=${PICK} — ${report.generatedAt}`, ``,
  `Completed: **${report.completed ? 'YES' : 'NO'}** in ${report.durationSec}s. Final chapter: ${result.chapter}. Party: ${result.party}. Journal entries: ${result.journal}. Errors: ${result.errors.length + pageErrors.length}. Warnings: ${result.warnings.length}.`, ``,
  `| beat | ok | s | stage | dialogues so far | fights so far | note |`, `|---|---|---|---|---|---|---|`,
  ...result.log.map((b) => `| ${b.beat} | ${b.ok ? '✅' : '❌'} | ${b.seconds} | ${b.stage ?? ''} | ${b.dialogues} | ${b.fights} | ${b.note ?? ''} |`),
  ``, `Reputation: ${result.reputation.map(([f, v]) => `${f} ${v}`).join(', ')}`, ``,
  ...(result.errors.length ? ['## Errors', ...result.errors.map((e) => `- ${e.split('\n')[0]}`)] : []),
  ...(result.warnings.length ? ['## Warnings (first 20)', ...result.warnings.slice(0, 20).map((e) => `- ${e.split('\n')[0]}`)] : []),
  ``, `Screenshots: ${shots.length} in \`${path.relative(root, OUT)}/\``,
];
await writeFile(path.join(OUT, 'report.md'), md.join('\n'));
console.log(md.join('\n'));
await browser.close(); server.kill();
process.exit(report.completed && result.errors.length + pageErrors.length === 0 ? 0 : 1);
