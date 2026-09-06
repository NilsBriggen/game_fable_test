#!/usr/bin/env node
/**
 * Voice asset pipeline (plan §1.3–§1.6). Offline synthesis only — no runtime cloud calls.
 *
 *   node tools/assets/fetch-voices.mjs --dry-run [--tier probe|hero|tier1|full] [--only en|de]
 *   node tools/assets/fetch-voices.mjs --tier probe --only en --probe-id <string-id> --provider openai|elevenlabs
 *   node tools/assets/fetch-voices.mjs --tier hero|tier1 [--only en|de] [--provider openai|elevenlabs] [--force]
 *
 * --dry-run prints per-speaker char subtotals + grand total + both-provider cost columns (no synthesis,
 * no spend). --tier probe synthesizes ONE line (< $0.05) and logs cost to tools/assets/voices-cost.log.
 * Bulk synthesis is BLOCKED until the probe numbers land.
 *
 * Text source: frozen tools/i18n/strings.{en,de}.json (same contract as check.test.ts).
 * Voice locales are en + de only: the gsw text locale falls back to the High German voice files at
 * runtime (voiceSink in src/ui/index.ts), so no gsw synthesis exists.
 * Output: public/assets/voices/<locale>/<slug>.opus + .mp3 (slug = lowercase, non-alnum → '-').
 * Provenance: public/assets/CREDITS-voices.md rows + tools/assets/voices-cost.log lines. Never print/log keys.
 *
 * Voices come from tools/assets/voices-manifest.json. Pitch suffixes (`+1st`/`-2st`) are rendered offline
 * via ffmpeg asetrate+aresample ($0) and recorded in the manifest row.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const TOOLS = path.join(root, 'tools/assets');
const I18N = path.join(root, 'tools/i18n');
const OUT = path.join(root, 'public/assets/voices');
const manifest = JSON.parse(fs.readFileSync(path.join(TOOLS, 'voices-manifest.json'), 'utf8'));
const COST_LOG = path.join(TOOLS, 'voices-cost.log');
const CREDITS = path.join(root, 'public/assets/CREDITS-voices.md');

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : true;
};
const DRY = args.includes('--dry-run');
const TIER = String(flag('tier', 'probe'));
const ONLY = String(flag('only', 'en'));
const PROVIDER = String(flag('provider', manifest.providerDefault ?? 'openai'));
const PROBE_ID = flag('probe-id', null);
const FORCE = args.includes('--force');

/** Player-agnostic file text: runtime keeps real names, audio stays generic. */
export const VOICE_TEXT_OVERRIDES = [
  [/\{playerFamily\}/g, ''],
  [/\{player\}/g, 'friend'],
  [/\{origin\}/g, 'Uri'],
  [/\{time\}/g, ''],
];
export function voiceText(raw) {
  let s = String(raw ?? '');
  for (const [re, rep] of VOICE_TEXT_OVERRIDES) s = s.replace(re, rep);
  return s.replace(/\s{2,}/g, ' ').trim();
}
export function slugify(id) {
  return id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
/** Speaker of a string id for dry-run grouping/costing (NOT the runtime voice — see §1.7). */
export function speakerOf(id, dlgSpeakerIndex) {
  if (id.startsWith('cs.')) return 'narrator';
  const principal = dlgSpeakerIndex ? dlgPrincipal(id) : undefined;
  if (principal) return principal;
  const m = /^dlg\.([a-z0-9-]+)\./.exec(id);
  if (m) console.log(`[voices:dry] WARN no principal for ${m[1]} — grouped as narrator for costing`);
  return 'narrator';
}
function loadStrings(locale) {
  return JSON.parse(fs.readFileSync(path.join(I18N, `strings.${locale}.json`), 'utf8'));
}
function tierIds(tier, table) {
  if (tier === 'probe' && PROBE_ID) return [String(PROBE_ID)];
  if (tier === 'probe') return [...(manifest.tiers.probe.ids ?? [])];
  const t = manifest.tiers[tier] ?? (tier === 'full' ? {} : undefined);
  if (!t) throw new Error(`unknown tier "${tier}" (probe|hero|tier1|full)`);
  if (tier === 'full') return Object.keys(table);
  // Dialogue ids match on the exact dialogue root (`dlg.<root>` segment); string ids that merely share
  // a name prefix (e.g. `dlg.abt-johannes-...` vs `dlg.abt-johannes`) must NOT leak in.
  const dlgRoots = new Set(t.dialogues ?? []);
  return Object.keys(table).filter((id) => {
    if ((t.prefixes ?? []).some((p) => id.startsWith(p))) return true;
    const m = /^dlg\.([a-z0-9-]+)\./.exec(id);
    return !!m && dlgRoots.has(`dlg.${m[1]}`);
  });
}
function costFor(chars, provider) {
  if (provider === 'elevenlabs') return (chars / 1000) * 0.1;
  // OpenAI gpt-audio-mini bills per audio token, not per char — dry-run $ needs real probe data.
  // Until recalibrated from voices-cost.log actuals, report chars only (null cost).
  return null;
}
function fmtCost(v) { return v === null ? 'n/a (see probe)' : `$${v.toFixed(2)}`; }
function openrouterKey() {
  const a = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.local/share/opencode/auth.json'), 'utf8'));
  return typeof a.openrouter === 'string' ? a.openrouter : a.openrouter.key;
}
async function synthOpenAI(text, voice, outWav, direction) {
  // OpenAI TTS via OpenRouter (plan §1.1): legacy /audio/speech is NOT exposed — the gpt-audio-mini
  // chat-completions audio modality is. Streamed (provider requirement), pcm16 out (streaming only
  // supports pcm16), ffmpeg wraps to wav. Voice map strips pitch suffixes (applied offline after).
  const base = voice.replace(/[+-]\d+st$/, '').toLowerCase();
  const dir = direction || voiceDirection(base);
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + openrouterKey(),
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost',
      'X-Title': 'eidgenossen-voices',
    },
    body: JSON.stringify({
      model: 'openai/gpt-audio-mini', stream: true,
      messages: [{ role: 'user', content: `Say aloud, ${dir}: ${text}` }],
      modalities: ['text', 'audio'], audio: { voice: base, format: 'pcm16' },
    }),
  });
  if (!res.ok) throw new Error(`openrouter tts ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const sse = await res.text();
  let b64 = '';
  for (const line of sse.split('\n')) {
    if (!line.startsWith('data:') || line.includes('[DONE]')) continue;
    try {
      const d = JSON.parse(line.slice(5)).choices?.[0]?.delta?.audio;
      if (d?.data) b64 += d.data;
    } catch { /* skip partial chunk */ }
  }
  if (!b64) throw new Error('openrouter tts: no audio data in stream');
  const pcm = Buffer.from(b64, 'base64');
  // gpt-audio pcm16 is 24 kHz mono s16le — containerize to wav via ffmpeg (sniffed downstream anyway).
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', 'pipe:0', outWav], { input: pcm });
}
/** Short delivery direction per OpenAI voice id (gpt-audio honors prose direction in the prompt). */
function voiceDirection(base) {
  const V = manifest.voiceDirections?.[base];
  if (V) return V;
  return 'in a clear, steady speaking voice';
}
async function synthEleven(text, voiceId, outWav) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error('ELEVENLABS_API_KEY is not set (Step 0 of plan §7.1/§1.2: probe OpenAI-only instead)');
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, model_id: manifest.elevenlabs.model, output_format: 'pcm_24000' }),
  });
  if (!res.ok) throw new Error(`elevenlabs ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const pcm = Buffer.from(await res.arrayBuffer());
  // pcm_24000 raw s16le mono → wav container via ffmpeg
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', 'pipe:0', outWav], { input: pcm });
}
function applyPitch(wav, voice) {
  const m = /([+-])(\d+)st$/.exec(voice);
  if (!m) return;
  const st = Number(m[2]) * (m[1] === '+' ? 1 : -1);
  const rate = Math.round(24000 * Math.pow(2, st / 12));
  const tmp = wav + '.pitch.wav';
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-af', `asetrate=${rate},aresample=24000`, tmp]);
  fs.renameSync(tmp, wav);
}

const en = loadStrings('en');
const locales = ONLY.split(',').map((s) => s.trim()).filter(Boolean);
// Tier catalog always counts EN ids (dry-run); synthesis reads the target locale's overlay text.
const ids = tierIds(TIER, en);

// Best-effort speaker index for dry-run grouping: `cs.*` → narrator (all cutscene captions are
// chronicle voice); `dlg.*` → the dialogue's principal speaker from sceneVoiceSets; unknown dlg roots
// fall back to narrator and are flagged for the Tier 0 gate report (bulk synthesis resolves the real
// per-node speaker at runtime wiring time — see §1.7, not here).
const dlgRoot = {};
for (const [scene, set] of Object.entries(manifest.sceneVoiceSets ?? {})) dlgRoot[scene] = set[0];
for (const [scene, principal] of Object.entries(manifest.scenePrincipals ?? {})) {
  if (!dlgRoot[scene]) dlgRoot[scene] = principal;
}
// Dialogue-root match (exact segment) → principal speaker, for dry-run grouping of dlg.* string ids.
function dlgPrincipal(id) {
  const m = /^dlg\.([a-z0-9-]+)\./.exec(id);
  if (!m) return undefined;
  return dlgRoot[`dlg.${m[1]}`];
}

if (DRY) {
  const perSpeaker = new Map();
  let total = 0;
  for (const id of ids) {
    const sp = speakerOf(id, dlgRoot);
    const n = voiceText(en[id] ?? '').length;
    total += n;
    perSpeaker.set(sp, (perSpeaker.get(sp) ?? 0) + n);
    if (!(id in en)) console.log(`[voices:dry] WARN unknown id ${id}`);
  }
  console.log(`[voices:dry] tier=${TIER} locales=${locales.join(',')} ids=${ids.length}`);
  for (const [sp, n] of [...perSpeaker.entries()].sort((a, b) => b[1] - a[1])) console.log(`[voices:dry]   ${sp}: ${n} chars`);
  console.log(`[voices:dry] total(en): ${total} chars`);
  for (const loc of locales) {
    const f = manifest.overheadFactor;
    const o = costFor(total, 'openai'), e = costFor(total, 'elevenlabs');
    console.log(`[voices:dry] ${loc}: openai ${fmtCost(o === null ? null : o * f)} / elevenlabs ${fmtCost(e * f)} (×${f} overhead)`);
  }
  // Scene uniqueness gate: every scene's speaker set must render to distinct voice IDs.
  let gateOk = true;
  for (const [scene, set] of Object.entries(manifest.sceneVoiceSets ?? {})) {
    const rendered = new Set(set.map((sp) => `${PROVIDER}:${(manifest.voices[sp] ?? {})[PROVIDER === 'elevenlabs' ? 'elevenlabs' : 'openai'] ?? sp}`));
    if (rendered.size < set.length) { gateOk = false; console.log(`[voices:dry] SCENE-GATE FAIL ${scene}: ${set.join(',')}`); }
  }
  console.log(`[voices:dry] scene-gate: ${gateOk ? 'ok' : 'FAIL'}`);
  process.exit(gateOk ? 0 : 1);
}

// ---- synthesis ----
if (TIER !== 'probe' && PROVIDER === 'elevenlabs' && !process.env.ELEVENLABS_API_KEY) {
  throw new Error('bulk ElevenLabs synthesis needs ELEVENLABS_API_KEY (plan §1.2 Step 0); use --provider openai');
}
fs.mkdirSync(OUT, { recursive: true });
if (!fs.existsSync(CREDITS)) {
  fs.writeFileSync(CREDITS, '# Voice provenance\n\nAI-generated voice files. Never labelled CC0. Placeholder policy: `{player}`→`friend`, `{playerFamily}`/`{time}`→dropped, `{origin}`→`Uri` (runtime text keeps real names).\n\n| file | voice | model | date | cost | bytes |\n|---|---|---|---|---|---|\n');
}
for (const locale of locales) {
  const table = locale === 'en' ? en : loadStrings(locale);
  const dir = path.join(OUT, locale);
  fs.mkdirSync(dir, { recursive: true });
  for (const id of tierIds(TIER, table)) {
    const text = voiceText(table[id] ?? en[id] ?? '');
    if (!text) { console.log(`[voices] skip ${id} (empty)`); continue; }
    const slug = slugify(id);
    const opus = path.join(dir, `${slug}.opus`);
    const mp3 = path.join(dir, `${slug}.mp3`);
    if (fs.existsSync(opus) && fs.existsSync(mp3) && !FORCE) { console.log(`[voices] cached ${locale}/${slug}`); continue; }
    const sp = speakerOf(id, dlgRoot);
    const v = manifest.voices[sp] ?? manifest.voices[sp?.startsWith('npc.') ? 'en_male' : 'narrator'] ?? manifest.voices.narrator;
    const voiceName = PROVIDER === 'elevenlabs' ? v.elevenlabs : v.openai;
    const tmp = path.join(os.tmpdir(), `eid-voice-${slug}.wav`);
    if (PROVIDER === 'elevenlabs') await synthEleven(text, voiceName, tmp);
    else await synthOpenAI(text, voiceName, tmp);
    applyPitch(tmp, voiceName);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', tmp, '-c:a', 'libopus', '-b:a', '24k', '-ac', '1', '-ar', '24000', opus]);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', tmp, '-c:a', 'libmp3lame', '-b:a', '48k', '-ac', '1', '-ar', '24000', mp3]);
    try { fs.unlinkSync(tmp); } catch { /* keep outputs */ }
    const bytes = fs.statSync(opus).size + fs.statSync(mp3).size;
    const row = `| voices/${locale}/${slug}.opus+mp3 | ${sp} (${voiceName}) | ${PROVIDER}/${PROVIDER === 'elevenlabs' ? manifest.elevenlabs.model : manifest.openai.model} | ${new Date().toISOString().slice(0, 10)} | see voices-cost.log | ${bytes} |\n`;
    fs.appendFileSync(CREDITS, row);
    const unit = PROVIDER === 'elevenlabs' ? 0.1 / 1000 : null;
    const costStr = unit === null ? 'cost=see-dashboard' : `cost=$${(text.length * unit).toFixed(4)}`;
    fs.appendFileSync(COST_LOG, `${new Date().toISOString()} tier=${TIER} locale=${locale} id=${id} chars=${text.length} provider=${PROVIDER} voice=${voiceName} ${costStr}\n`);
    console.log(`[voices] ${locale}/${slug}: ${text.length} chars → ${(bytes / 1024).toFixed(0)} KB`);
  }
}
console.log('[voices] done. Provenance:', CREDITS, '| spend:', COST_LOG);
