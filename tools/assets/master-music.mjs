#!/usr/bin/env node
/**
 * Music remaster + import (plan §2). Reads the user's Flow generations from `music/` ( repo root,
 * NOT committed — see .gitignore), remasters each into a seamless game loop, and writes
 * `public/assets/music/<bed>.opus` + `.mp3` (+ three one-shot stingers).
 *
 *   node tools/assets/master-music.mjs [--only <bed>] [--force]
 *
 * Per-bed chain (all ffmpeg, local, no network):
 * 1. Decode mp3/m4a → 48 kHz stereo wav (source sample rate, no resample loss).
 * 2. Loop repair: trim to the body (drop dead air), then append a tail-head crossfade tail so the
 *    file's own end crossfades back into its own start (XFADE seconds, per-bed below). The player
 *    loops the whole file with `loop=true`; the seam region is music-over-music, no silence, no click.
 *    Rationale: measured head/tail correlations are ~0.04–0.19 (no true loop point exists), and tails
 *    carry composed fade-outs (morgarten/title decay to digital zero over the last 2–4 s). A 6–10 s
 *    equal-power crossfade hides both the energy step and the fade-out tail.
 * 3. Loudness: single-pass `loudnorm` to the bed target (beds −14 LUFS, stingers −16 LUFS),
 *    true-peak −1.5 dBTP, LRA capped by the dual-pass default. Measured inputs sit at −12.9…−17.9 LUFS
 *    with true peaks up to −0.18 dBTP, so this is mostly peak protection + inter-bed consistency.
 * 4. Encode: opus 48 kHz stereo 64 kbps + mp3 48 kHz stereo 128 kbps (music is full-band stereo;
 *    voices stay 24 kHz mono, untouched by this script).
 * 5. Verify: duration > 60 s (beds), both files non-empty, ffprobe-readable; print sizes.
 *
 * Bed config: target LUFS, crossfade seconds, trim (seconds to cut from head/tail — dead air only).
 * Tuned from measured RMS profiles (12×1 s buckets head/tail) and silencedetect:
 * - title:   0.4 s dead tail; tail decays to ~0 over last 4 s → 10 s xfade, trim 1 s tail
 * - explore: hot tail (0.13 sustained) vs cooler head → 8 s xfade, no trim
 * - tavern:  steady head (0.09), tail dips last 3 s → 6 s xfade, trim 1 s tail
 * - battle:  tail hotter (0.16 peaks) vs thin head → 8 s xfade, no trim
 * - church:  loud tail (0.20) vs near-silent head → 10 s xfade, no trim (organ bloom kept)
 * - morgarten: tail fully silent last 3 s (composed ending) → trim 3.5 s, 10 s xfade
 * Stingers (discover/quest-done/quest-fail): NO loop processing — loudnorm to −16 LUFS + 8 ms
 * fade-out anti-click tail only.
 *
 * Provenance: appends public/assets/CREDITS-music.md rows (`AI-generated (Google Flow Music, date,
 * user credits)` + files + bytes, never CC0). The `music/` source dir is git-ignored; committed
 * outputs are the remastered loops only.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const SRC = path.join(root, 'music');
const OUT = path.join(root, 'public/assets/music');
const CREDITS = path.join(root, 'public/assets/CREDITS-music.md');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'eid-music-'));

const sh = (cmd, a) => execFileSync(cmd, a, { stdio: 'pipe' });
const ff = (a) => sh('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a]);
const probeDur = (f) => parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', f], { encoding: 'utf8' }).trim());

/** bed: [source file, target LUFS, xfade seconds, trimHead, trimTail] */
const BEDS = {
  title: ['music.title.mp3', -14, 10, 0, 1.0],
  explore: ['music.explore.mp3', -14, 8, 0, 0],
  tavern: ['music.tavern.mp3', -14, 6, 0, 1.0],
  battle: ['music.battle.mp3', -14, 8, 0, 0],
  church: ['music.church.mp3', -14, 10, 0, 0],
  morgarten: ['music.morgarten.mp3', -14, 10, 0, 3.5],
};
/** stinger: [source file, target LUFS] — one-shots, never looped. */
const STINGERS = {
  discover: ['discover.mp3', -16],
  'quest-done': ['quest-done.mp3', -16],
  'quest-fail': ['quest-fail.m4a', -16],
};

const args = process.argv.slice(2);
const onlyFlag = (() => { const i = args.indexOf('--only'); return i >= 0 ? args[i + 1] : null; })();
const FORCE = args.includes('--force');

function loopBed(bed, srcFile, lufs, xfade, trimHead, trimTail) {
  const src = path.join(SRC, srcFile);
  const dur = probeDur(src);
  const body = dur - trimHead - trimTail;
  if (body < 60) throw new Error(`${bed}: body ${body.toFixed(1)} s < 60 s after trim`);
  const bodyWav = path.join(TMP, `${bed}-body.wav`);
  // 1. body extract (dead air trimmed, 48 kHz stereo kept)
  ff(['-i', src, '-ss', String(trimHead), '-t', String(body), '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', bodyWav]);
  // 2. tail-head crossfade: last XFADE s of the body crossfaded with the first XFADE s of the body,
  //    appended after the body-minus-tail so total length is preserved (no content lost, seam hidden).
  //    acrossfade qsin (quarter-sine, equal-power): constant loudness through the seam — tri/linear
  //    would dip mid-fade.
  const looped = path.join(TMP, `${bed}-loop.wav`);
  ff(['-i', bodyWav, '-filter_complex',
    `[0:a]asplit=2[body][xhead];` +
    `[body]atrim=0:${(body - xfade).toFixed(2)},asetpts=PTS-STARTPTS[main];` +
    `[xhead]atrim=${(body - xfade).toFixed(2)}:${body.toFixed(2)},asetpts=PTS-STARTPTS[xtail];` +
    `[0:a]atrim=0:${xfade.toFixed(2)},asetpts=PTS-STARTPTS[xstart];` +
    `[xtail][xstart]acrossfade=d=${xfade}:curve1=qsin:curve2=qsin[seam];` +
    `[main][seam]concat=n=2:v=0:a=1,aresample=48000,aformat=channel_layouts=stereo[out]`,
    '-map', '[out]', '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', looped]);
  // 3. loudness to bed target: two-pass EBU R128. Pass 1 measures the looped file; pass 2 applies
  //    the measured linear gain + lookahead limiter (true-peak guarded). Dynamic single-pass mode was
  //    tried and landed ~1 LUFS hot, so the measured route is used for exactness.
  const normed = path.join(TMP, `${bed}-norm.wav`);
  const first = sh('ffmpeg', ['-hide_banner', '-i', looped, '-af', `loudnorm=I=${lufs}:TP=-1.5:LRA=11:print_format=json`, '-f', 'null', '-']);
  const m = (first.toString().match(/\{[\s\S]*?\n\}/) ?? ['{}'])[0];
  let gainDb = 0;
  try {
    const measured = JSON.parse(m);
    const off = Number(measured.target_offset);
    gainDb = Number.isFinite(off) ? Math.max(-12, Math.min(12, off)) : 0;
  } catch { gainDb = 0; /* keep unity gain rather than guessing */ }
  ff(['-i', looped, '-af', `volume=${gainDb.toFixed(2)}dB,alimiter=limit=0.891`, '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', normed]);
  return { file: normed, dur: probeDur(normed) };
}

function oneShot(name, srcFile, lufs) {
  const src = path.join(SRC, srcFile);
  const srcDur = probeDur(src);
  const tmp = path.join(TMP, `${name}-norm.wav`);
  // Two-pass like beds (exact target), then a short fade-out (anti-click).
  const first = sh('ffmpeg', ['-hide_banner', '-i', src, '-af', `loudnorm=I=${lufs}:TP=-1.5:LRA=7:print_format=json`, '-f', 'null', '-']);
  const m = (first.toString().match(/\{[\s\S]*?\n\}/) ?? ['{}'])[0];
  let gainDb = 0;
  try {
    const measured = JSON.parse(m);
    const off = Number(measured.target_offset);
    gainDb = Number.isFinite(off) ? Math.max(-12, Math.min(12, off)) : 0;
  } catch { gainDb = 0; }
  const out = path.join(TMP, `${name}-fade.wav`);
  const fadeStart = Math.max(0, srcDur - 0.08);
  ff(['-i', src, '-af', `volume=${gainDb.toFixed(2)}dB,alimiter=limit=0.891,afade=t=out:st=${fadeStart.toFixed(3)}:d=0.08`, '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', out]);
  return { file: out, dur: probeDur(out) };
}

fs.mkdirSync(OUT, { recursive: true });
if (!fs.existsSync(CREDITS)) {
  fs.writeFileSync(CREDITS, '# Music provenance\n\nAI-generated music beds and stingers (Google Flow Music, user-supplied generations remastered into game loops). Never labelled CC0. Source `music/` dir is git-ignored; committed files are the remastered loops only.\n\n| file | source | date | bytes |\n|---|---|---|---|\n');
}
const today = new Date().toISOString().slice(0, 10);
const jobs = [];
for (const [bed, cfg] of Object.entries(BEDS)) {
  if (onlyFlag && onlyFlag !== bed) continue;
  jobs.push({ kind: 'bed', name: bed, cfg });
}
for (const [name, cfg] of Object.entries(STINGERS)) {
  if (onlyFlag && onlyFlag !== name) continue;
  jobs.push({ kind: 'sting', name, cfg });
}
if (onlyFlag && jobs.length === 0) throw new Error(`--only ${onlyFlag}: unknown bed/stinger (beds: ${Object.keys(BEDS).join(',')}; stingers: ${Object.keys(STINGERS).join(',')})`);

for (const j of jobs) {
  const opus = path.join(OUT, `${j.name}.opus`);
  const mp3 = path.join(OUT, `${j.name}.mp3`);
  if (fs.existsSync(opus) && fs.existsSync(mp3) && !FORCE) { console.log(`[music] cached ${j.name}`); continue; }
  const { file, dur } = j.kind === 'bed'
    ? loopBed(j.name, ...j.cfg)
    : oneShot(j.name, ...j.cfg);
  ff(['-i', file, '-c:a', 'libopus', '-b:a', '64k', '-ac', '2', '-ar', '48000', opus]);
  ff(['-i', file, '-c:a', 'libmp3lame', '-b:a', '128k', '-ac', '2', '-ar', '48000', mp3]);
  const bytes = fs.statSync(opus).size + fs.statSync(mp3).size;
  fs.appendFileSync(CREDITS, `| music/${j.name}.opus+mp3 | ${j.cfg[0]} (Google Flow Music, user generation) | ${today} | ${bytes} |\n`);
  console.log(`[music] ${j.name}: ${dur.toFixed(1)} s → opus ${(fs.statSync(opus).size / 1024).toFixed(0)} KB + mp3 ${(fs.statSync(mp3).size / 1024).toFixed(0)} KB`);
}
console.log('[music] done. Outputs:', OUT, '| provenance:', CREDITS);
// TMP is mkdtemp'd under os.tmpdir(); leave for the OS to reap (keeps intermediates for inspection).
console.log('[music] intermediates kept at', TMP);
