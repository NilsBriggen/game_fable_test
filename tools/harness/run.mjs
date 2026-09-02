#!/usr/bin/env node
/**
 * Verification harness. ARCHITECTURE.md §8.
 * node tools/harness/run.mjs [--preview] [--scenario id[,id]] [--out dir] [--gpu] [--keep]
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const PREVIEW = flag('--preview');
const OUT = path.resolve(root, opt('--out', 'tools/harness/out'));
const ONLY = opt('--scenario', null)?.split(',');
const PORT = PREVIEW ? 4173 : 5173;
const URL_BASE = `http://127.0.0.1:${PORT}`;
const BUDGET = { drawCalls: 2000, triangles: 3_000_000, frameP95: 16.6, heapMB: 512 };

const scenarios = JSON.parse(await readFile(path.join(__dirname, 'scenarios.json'), 'utf8')).filter((s) => !ONLY || ONLY.includes(s.id));
await mkdir(OUT, { recursive: true });

async function waitHttp(url, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(url); if (r.ok) return true; } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

let server = null;
const alreadyUp = await waitHttp(URL_BASE, 500);
if (!alreadyUp) {
  const cmd = PREVIEW ? ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'] : ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'];
  server = spawn('npx', cmd, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1' } });
  server.stdout.on('data', () => {});
  server.stderr.on('data', (d) => process.stderr.write(`[vite] ${d}`));
  if (!(await waitHttp(URL_BASE, 60000))) { console.error('dev server did not start'); process.exit(2); }
}

const browserArgs = flag('--gpu')
  ? ['--ignore-gpu-blocklist', '--enable-gpu-rasterization']
  : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--enable-webgl'];
const executablePath = process.env.HARNESS_CHROMIUM || (await import('node:fs')).existsSync('/opt/pw-browsers/chromium') ? (process.env.HARNESS_CHROMIUM || '/opt/pw-browsers/chromium') : undefined;
const browser = await chromium.launch({ headless: true, args: browserArgs, ...(executablePath ? { executablePath } : {}) });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

const report = { generatedAt: new Date().toISOString(), mode: PREVIEW ? 'preview(build)' : 'dev', renderer: null, budgets: BUDGET, scenarios: [] };
await page.goto(`${URL_BASE}/?harness=1`, { waitUntil: 'load' });
try {
  await page.waitForFunction(() => window.__harness && window.__harness.ready, null, { timeout: 60000 });
  await page.evaluate(() => window.__harness.ready);
} catch (e) {
  console.error('harness never became ready:', e.message);
}
report.renderer = await page.evaluate(() => window.__harness?.stats().renderer ?? 'unknown');
report.software = /swiftshader|llvmpipe|software/i.test(report.renderer || '');
console.log(`renderer: ${report.renderer}${report.software ? '  (SOFTWARE — frame times are an upper bound)' : ''}`);

function pct(arr, p) { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; }

for (const sc of scenarios) {
  const entry = { id: sc.id, description: sc.description, ok: true, skipped: null, errors: [], warnings: [], screenshot: null };
  const errBefore = consoleErrors.length, pageErrBefore = pageErrors.length;
  const t0 = Date.now();
  try {
    const res = await page.evaluate(async (id) => {
      const h = window.__harness;
      const before = { e: h.console.errors.length, w: h.console.warnings.length };
      const r = await h.loadScenario(id);
      await h.screenshotReady();
      const st = h.stats();
      return { r, st, errors: h.console.errors.slice(before.e), warnings: h.console.warnings.slice(before.w) };
    }, sc.id);
    entry.skipped = res.r.skipped ?? null;
    const fm = res.st.frameMs;
    Object.assign(entry, {
      drawCalls: res.st.drawCalls, triangles: res.st.triangles, geometries: res.st.geometries, textures: res.st.textures, programs: res.st.programs,
      heapMB: res.st.heapMB, entities: res.st.entities, chunksLoaded: res.st.chunksLoaded, instances: res.st.instances, state: res.st.state,
      frame: { p50: pct(fm, 0.5), p95: pct(fm, 0.95), max: fm.length ? Math.max(...fm) : null, samples: fm.length }, hitches: res.st.hitches, flyoverHitches: res.st.flyoverHitches,
      content: res.st.content,
    });
    entry.errors.push(...res.errors);
    entry.warnings.push(...res.warnings);
    const file = path.join(OUT, `${sc.id}.png`);
    await page.screenshot({ path: file, fullPage: false });
    entry.screenshot = path.relative(root, file);
  } catch (e) {
    entry.ok = false;
    entry.errors.push(`harness: ${e.message}`);
  }
  entry.errors.push(...consoleErrors.slice(errBefore), ...pageErrors.slice(pageErrBefore));
  entry.durationMs = Date.now() - t0;
  entry.budget = {
    drawCalls: entry.drawCalls == null || entry.drawCalls <= BUDGET.drawCalls,
    triangles: entry.triangles == null || entry.triangles <= BUDGET.triangles,
    heap: entry.heapMB == null || entry.heapMB <= BUDGET.heapMB,
    frameP95: entry.frame?.p95 == null || entry.frame.p95 <= BUDGET.frameP95,
    noErrors: entry.errors.length === 0,
  };
  entry.pass = entry.ok && entry.budget.drawCalls && entry.budget.triangles && entry.budget.heap && entry.budget.noErrors;
  report.scenarios.push(entry);
  console.log(`${entry.pass ? 'PASS' : 'FAIL'} ${sc.id.padEnd(28)} calls=${entry.drawCalls ?? '-'} tris=${entry.triangles ?? '-'} p95=${entry.frame?.p95?.toFixed(1) ?? '-'}ms max=${entry.frame?.max?.toFixed(1) ?? '-'}ms heap=${entry.heapMB ?? '-'}MB err=${entry.errors.length} warn=${entry.warnings.length}${entry.skipped ? `  [${entry.skipped}]` : ''}`);
  for (const e of entry.errors) console.log(`    ERROR: ${e.split('\n')[0].slice(0, 300)}`);
}

await browser.close();
if (server && !flag('--keep')) server.kill();

report.summary = {
  total: report.scenarios.length,
  passed: report.scenarios.filter((s) => s.pass).length,
  errors: report.scenarios.reduce((n, s) => n + s.errors.length, 0),
  warnings: report.scenarios.reduce((n, s) => n + s.warnings.length, 0),
  maxDrawCalls: Math.max(0, ...report.scenarios.map((s) => s.drawCalls ?? 0)),
  worstP95: Math.max(0, ...report.scenarios.map((s) => s.frame?.p95 ?? 0)),
};
await writeFile(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
const md = [
  `# Harness report — ${report.generatedAt}`, ``,
  `Mode: ${report.mode}. Renderer: \`${report.renderer}\`${report.software ? ' **(software renderer: frame times are an upper bound, not the hardware target)**' : ''}.`, ``,
  `| scenario | pass | draw calls | tris | p50 ms | p95 ms | max ms | hitches | heap MB | errors | warnings | note |`,
  `|---|---|---|---|---|---|---|---|---|---|---|---|`,
  ...report.scenarios.map((s) => `| ${s.id} | ${s.pass ? '✅' : '❌'} | ${s.drawCalls ?? '-'} | ${s.triangles ?? '-'} | ${s.frame?.p50?.toFixed(1) ?? '-'} | ${s.frame?.p95?.toFixed(1) ?? '-'} | ${s.frame?.max?.toFixed(1) ?? '-'} | ${s.hitches ?? '-'} | ${s.heapMB ?? '-'} | ${s.errors.length} | ${s.warnings.length} | ${s.skipped ?? ''} |`),
  ``,
  `Passed ${report.summary.passed}/${report.summary.total}. Screenshots in \`${path.relative(root, OUT)}/\`.`,
  ``,
  ...report.scenarios.flatMap((s) => (s.errors.length || s.warnings.length ? [`## ${s.id}`, ...s.errors.map((e) => `- ERROR: ${e.split('\n')[0]}`), ...s.warnings.slice(0, 10).map((w) => `- warn: ${w.split('\n')[0]}`), ``] : [])),
];
await writeFile(path.join(OUT, 'report.md'), md.join('\n'));
console.log(`\n${report.summary.passed}/${report.summary.total} passed; report: ${path.relative(root, OUT)}/report.md`);
process.exit(report.summary.passed === report.summary.total ? 0 : 1);
