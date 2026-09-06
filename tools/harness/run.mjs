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
// Always use a private port with HMR/watch disabled so concurrent builders editing files cannot reload the page mid-scenario.

// A free ephemeral port from the OS (a random pick collided with another queued harness's server and
// the run silently attached to that server instead of its own).
async function freePort() { const net = await import('node:net'); return new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); }); }
const PORT = Number(opt('--port', 0)) || await freePort();
const URL_BASE = `http://127.0.0.1:${PORT}`;
const BUDGET = { drawCalls: 2000, triangles: 3_000_000, frameP95: 16.6, p95Ms: 16.6, heapMB: 512 };
// p95 is only enforced on real-GPU runs (--gpu) or when explicitly opted in;
// SwiftShader software timing must not fail the gate.
const ENFORCE_P95 = flag('--gpu') || process.env.HARNESS_ENFORCE_P95 === '1';
if (flag('--help') || flag('-h')) {
  console.log('Usage: node tools/harness/run.mjs [--preview] [--scenario id[,id]] [--out dir] [--gpu] [--port N] [--keep]');
  console.log('  p95 gate: enforced only with --gpu or HARNESS_ENFORCE_P95=1; software runs record p95warn instead of failing.');
  process.exit(0);
}

const scenarios = JSON.parse(await readFile(path.join(__dirname, 'scenarios.json'), 'utf8')).filter((s) => !ONLY || ONLY.includes(s.id));
await mkdir(OUT, { recursive: true });

// Serialise harness runs across concurrent builders: one run at a time (CPU is shared, SwiftShader is slow,
// and the out dir must not be clobbered). Lock = atomic mkdir; stale locks (> 45 min) are broken.
// Two run slots (a playthrough alongside a capture batch): SwiftShader frame times are not scored, and
// each run has its own server, port and --out, so the only shared resource is CPU.
const SLOTS = ['tools/harness/.lock', 'tools/harness/.lock2'].map((p) => path.join(root, p));
let LOCK = null;
const fs = await import('node:fs');
async function acquireLock() {
  const t0 = Date.now();
  while (true) {
    for (const slot of SLOTS) {
      try { fs.mkdirSync(slot); fs.writeFileSync(path.join(slot, 'pid'), String(process.pid)); LOCK = slot; startHeartbeat(); return; } catch {}
      try { const age = Date.now() - fs.statSync(slot).mtimeMs; if (age > 3 * 60 * 60 * 1000) fs.rmSync(slot, { recursive: true, force: true }); } catch {} // the heartbeat keeps a live run's slot fresh
    }
    if (Date.now() - t0 > 240 * 60 * 1000) { console.error('harness: could not acquire lock after 240 min'); process.exit(3); }
    if ((Date.now() - t0) % 60000 < 2500) console.log('harness: waiting for another run to finish…');
    await new Promise((r) => setTimeout(r, 2000));
  }
}
// a 40-min-per-scenario run used to lose its slot to the 45-min stale rule and a second run piled on
let lockHeartbeat = null;
function startHeartbeat() { lockHeartbeat = setInterval(() => { try { const now = new Date(); fs.utimesSync(LOCK, now, now); } catch {} }, 5 * 60 * 1000); lockHeartbeat.unref?.(); }
function releaseLock() { if (lockHeartbeat) clearInterval(lockHeartbeat); if (LOCK) { try { fs.rmSync(LOCK, { recursive: true, force: true }); } catch {} } }
await acquireLock();
for (const sig of ['exit', 'SIGINT', 'SIGTERM']) process.on(sig, () => { releaseLock(); if (sig !== 'exit') process.exit(130); });

async function waitHttp(url, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(url); if (r.ok) return true; } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

let server = null;
{
  const cmd = PREVIEW ? ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'] : ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'];
  server = spawn('npx', cmd, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1', HARNESS_NO_HMR: '1' } });
  server.stdout.on('data', () => {});
  server.stderr.on('data', (d) => process.stderr.write(`[vite] ${d}`));
  if (!(await waitHttp(URL_BASE, 60000))) { console.error('dev server did not start'); process.exit(2); }
}

const browserArgs = flag('--gpu')
  ? ['--ignore-gpu-blocklist', '--enable-gpu-rasterization']
  : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--enable-webgl', '--js-flags=--expose-gc'];
const executablePath = process.env.HARNESS_CHROMIUM || (await import('node:fs')).existsSync('/opt/pw-browsers/chromium') ? (process.env.HARNESS_CHROMIUM || '/opt/pw-browsers/chromium') : undefined;
const browser = await chromium.launch({ headless: true, args: browserArgs, ...(executablePath ? { executablePath } : {}) });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(180000);
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('response', (r) => { if (r.status() >= 400) consoleErrors.push(`HTTP ${r.status()} ${r.url()}`); });

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
      drawCalls: res.st.drawCalls, triangles: res.st.triangles, split: res.st.split ?? null, ground: res.st.ground ?? null, mem: res.st.mem ?? null, geometries: res.st.geometries, textures: res.st.textures, programs: res.st.programs,
      heapMB: res.st.heapMB, entities: res.st.entities, chunksLoaded: res.st.chunksLoaded, instances: res.st.instances, state: res.st.state,
      frame: { p50: pct(fm, 0.5), p95: pct(fm, 0.95), max: fm.length ? Math.max(...fm) : null, samples: fm.length }, hitches: res.st.hitches, flyoverHitches: res.st.flyoverHitches,
      content: res.st.content,
      // 5.0 instrumentation passthrough: GPU probe p95, computed frame p95, load-time marks.
      gpuP95: res.st.gpuP95 ?? null, frameP95: res.st.frameP95 ?? null, loadMarks: res.st.loadMarks ?? null,
    });
    entry.errors.push(...res.errors);
    entry.warnings.push(...res.warnings);
    const file = path.join(OUT, `${sc.id}.png`);
    await page.screenshot({ path: file, fullPage: false, timeout: 180000 });
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
  // p95 value (mirrored for report consumers) + gated enforcement.
  entry.p95 = entry.frame?.p95 ?? null;
  entry.budget.p95 = entry.p95 == null || entry.p95 <= BUDGET.p95Ms;
  entry.p95warn = null;
  const p95ok = ENFORCE_P95 ? entry.budget.p95 : true;
  entry.budget.p95ok = p95ok;
  if (!ENFORCE_P95 && report.software && !entry.budget.p95) entry.p95warn = 'p95 over budget (software renderer): recorded, not failing';
  entry.pass = entry.ok && entry.budget.drawCalls && entry.budget.triangles && entry.budget.heap && entry.budget.noErrors && p95ok;
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
  p95Enforced: ENFORCE_P95,
};
// Asset-weight snapshot of the production bundle (dev mode has no dist/).
report.assetWeight = null;
report.assetNote = null;
{
  const distAssets = path.join(root, 'dist', 'assets');
  try {
    const names = fs.readdirSync(distAssets);
    const w = {};
    for (const n of names) { try { w[n] = fs.statSync(path.join(distAssets, n)).size; } catch {} }
    report.assetWeight = w;
  } catch { report.assetWeight = null; report.assetNote = 'dist/ absent (dev mode): asset weights unavailable'; }
}
await writeFile(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
const md = [
  `# Harness report — ${report.generatedAt}`, ``,
  `Mode: ${report.mode}. Renderer: \`${report.renderer}\`${report.software ? ' **(software renderer: frame times are an upper bound, not the hardware target)**' : ''}.`, ``,
  `| scenario | pass | draw calls | tris | p50 ms | p95 ms | max ms | hitches | heap MB | errors | warnings | note |`,
  `|---|---|---|---|---|---|---|---|---|---|---|---|`,
  ...report.scenarios.map((s) => `| ${s.id} | ${s.pass ? '✅' : '❌'} | ${s.drawCalls ?? '-'} | ${s.triangles ?? '-'} | ${s.frame?.p50?.toFixed(1) ?? '-'} | ${s.frame?.p95?.toFixed(1) ?? '-'} | ${s.frame?.max?.toFixed(1) ?? '-'} | ${s.hitches ?? '-'} | ${s.heapMB ?? '-'} | ${s.errors.length} | ${s.warnings.length} | ${[s.skipped, s.p95warn].filter(Boolean).join('; ') ?? ''} |`),
  ``,
  `Passed ${report.summary.passed}/${report.summary.total}. Screenshots in \`${path.relative(root, OUT)}/\`.`,
  ``,
  `p95 budget ${BUDGET.p95Ms} ms — ${report.summary.p95Enforced ? 'ENFORCED (worst p95 ' + (report.summary.worstP95?.toFixed?.(1) ?? report.summary.worstP95) + ' ms)' : 'recorded only (software renderer); set --gpu or HARNESS_ENFORCE_P95=1 to enforce'}.`,
  `Assets: ${report.assetWeight ? Object.entries(report.assetWeight).map(([k, v]) => `${k}=${(v / 1048576).toFixed(2)}MB`).join(', ') : report.assetNote ?? 'n/a'}.`,
  `Load marks (boot/newGame/stream ms, GPU p95 ms): ${report.scenarios.map((s) => `${s.id} boot=${s.loadMarks?.bootMs?.toFixed?.(0) ?? s.loadMarks?.bootMs ?? '-'} newGame=${s.loadMarks?.newGameMs?.toFixed?.(0) ?? s.loadMarks?.newGameMs ?? '-'} stream=${s.loadMarks?.streamMs?.toFixed?.(0) ?? s.loadMarks?.streamMs ?? '-'} gpuP95=${s.gpuP95?.toFixed?.(2) ?? s.gpuP95 ?? '-'}`).join(' | ')}.`,
  ``,
  ...report.scenarios.flatMap((s) => (s.errors.length || s.warnings.length ? [`## ${s.id}`, ...s.errors.map((e) => `- ERROR: ${e.split('\n')[0]}`), ...s.warnings.slice(0, 10).map((w) => `- warn: ${w.split('\n')[0]}`), ``] : [])),
];
await writeFile(path.join(OUT, 'report.md'), md.join('\n'));
console.log(`\n${report.summary.passed}/${report.summary.total} passed; report: ${path.relative(root, OUT)}/report.md`);
process.exit(report.summary.passed === report.summary.total ? 0 : 1);
