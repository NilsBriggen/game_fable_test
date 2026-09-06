# Eidgenossen — Voices, Music & Visual Polish Plan

Scope: pre-generated neural voices (OpenAI / ElevenLabs) + Google Flow music (user-owned 10,000 credits) +
targeted visual upgrades. This plan replaces all prior wave/overhaul material — nothing outside these three
tracks is in scope. Plan only; no source, asset, or config edits are authorized by this file.

## 0. Ground truth (verified against source)

- Voices: NONE exist. `src/ui/audio.ts:12` states "No samples, no voice". Zero `speechSynthesis` hits in `src/`.
  Dialogue = text typewriter (`src/ui/dialogueUi.ts:11`, 16 ms/char) + SVG silhouette / staged PNG fallback
  (`portraitUrl`, `public/assets/portraits/candidate-*.png` staged but unwired — no NPC sets `portrait`).
  Barks = HUD text toasts (`src/exploration/npc.ts` bark tables). Cutscenes = text captions
  (`src/ui/cutsceneUi.ts`: `letterbox` / `caption` / `fade` / `title`).
- Music/SFX: 100% procedural WebAudio (`src/ui/audio.ts`, 408 lines, lazy AudioContext on first gesture, no-op
  without WebAudio). 6 step-sequenced monophonic beds (`MusicId`: `title/tavern/church/explore/battle/morgarten`,
  Dorian on D / Mixolydian on G, invented phrases, music bus −6 dB under SFX) + 4 filtered-noise ambience beds
  (`AmbienceId`: `lake/mountain/village/church` + `none`). `masterVolume` → perceptual quadratic `volumeToGain`
  (tested in `src/ui/audio.test.ts`). Wiring in `src/ui/index.ts:79-191` (gesture unlock, button clicks, 0.5 s
  region-ambience poll by POI kind, combat battle bed + hit/clash/twang/fanfare/lament, quest fanfare/lament,
  `{music}` DSL drives the bus via `src/quest/index.ts:270-274`).
- Text source: 508 string IDs in `tools/i18n/strings.en.json` (+ `strings.de/gsw.json` overlays, `check.test.ts`
  enforces 100% ID coverage + placeholder-set equality). Speakers used in content
  (`src/content/dialogues/{named-cast,spine,side,generic}.ts`): `narrator` (majority of all lines incl. every
  generic beat + every `cs.*` caption), `player`, `npc.werner-stauffacher`, `npc.walter-fuerst`,
  `npc.werner-von-attinghausen`, `npc.arnold-von-melchtal`, `npc.wilhelm-tell`, `npc.hermann-gessler`,
  `npc.beringer-von-landenberg`, `npc.abt-johannes`, `npc.konrad-ab-yberg`, `npc.vogt-schreiber-ludwig`,
  `npc.heinrich-von-hunenberg` (1 line), `npc.johannes-von-winterthur` (boy, 1 line), `npc.leopold-i`
  (1 line, distant), companions `npc.jost-imhof` / `npc.mechthild-schorno` / `npc.heini-odermatt` /
  `npc.bruder-anselm` / `npc.ueli-zgraggen`, `npc.ritter-eberhard-von-mulinen` (silent beat), side NPCs
  `npc.niklaus-planzer` / `npc.melchior-arnold` / `npc.uli-fischer` / `npc.trudi-meier` /
  `npc.burkhard-wyrsch` / `npc.jost-durrer`.
- Budgets (hard): ≤2000 draw calls / ≤3M tris / ≤512 MB heap, zero browser errors+warnings,
  p95 ≤16.6 ms enforced only with `--gpu`/`HARNESS_ENFORCE_P95=1`. Build base `'./'` (itch.io sub-path, offline).
- Conventions: import rule (own files + `@core/*` + `@content/*` + `three` only; cross-feature via
  `ctx.services`); asset rule (manifest → fetcher → CREDITS row → wire with fallback; fallback proven by
  deleting the file); LORE gate (`LORE.md` §§1/7/8/10) on every new voice/music/visual; no score inflation.

## 1. Voices — OpenAI / ElevenLabs pre-generated files (user decision: option C)

No runtime cloud calls, no `speechSynthesis`, no recorded actors in v1. All synthesis offline at build time;
the game plays committed `.opus` + `.mp3` files with silent-text fallback.

### 1.1 Providers & pricing (verified 2026-09-06, re-verify at synthesis time)

- OpenAI `tts-1` (default for bulk): **$15/1M chars**, 9 fixed voices
  (Alloy, Ash, Coral, Echo, Fable, Nova, Onyx, Sage, Shimmer), 4,096 chars/request, MP3/Opus/AAC/FLAC/WAV/PCM,
  streaming. Called through the EXISTING OpenRouter key (`~/.local/share/opencode/auth.json`,
  OpenAI-compatible `POST /audio/speech`, pay-per-use, no new subscription) — never print/log the key
  (same rule as `tools/assets/ai-terrain.mjs` `authKey()`). Spaces/punctuation billed; failed requests free.
- OpenAI `gpt-4o-mini-tts` (only if `tts-1` sounds too flat at the Tier 0 listening gate): ~**$0.015/min**,
  13 voices (+Ballad, Verse, Marin, Cedar), natural-language prosody instructions, 2,000-token input limit.
- ElevenLabs Multilingual v2 (hero A/B only, needs user-supplied `ELEVENLABS_API_KEY` env, never logged):
  **$0.10/1K chars** ($100/1M, ~6.7× OpenAI), 29 languages, 10k chars/request, unlimited custom voices + v3
  audio tags. Free 10k chars covers the probe (non-commercial); Starter $5 minimum for commercial use.
  Flash/Turbo $0.05/1K is banned for final lines (lower quality).
- Recommendation: OpenAI `tts-1` for ALL committed lines (cheapest, no new key); ElevenLabs only for a
  hero-line A/B if the user supplies a key. Tier 2 bulk provider decided at the Tier 1 gate from real numbers.

### 1.2 Step 0 — key check (implementer, zero spend, blocks nothing)

Check `ELEVENLABS_API_KEY` presence. Present → probe BOTH providers. Absent → probe OpenAI-only, note
ElevenLabs A/B as deferred, proceed — never block Tier 0 on a missing key.

### 1.3 Cost probe FIRST (one line, < $0.05, blocks ALL bulk)

1. Probe line: `cs.intro-1291.shot.2.caption` — `"The King is dead!" a boatman cries, still standing in the
   prow. "Rudolf of Habsburg — dead at Speyer!"` (~105 chars; distinct minor voice, good audition).
2. Exact commands: `node tools/assets/fetch-voices.mjs --tier probe --only en
   --probe-id cs.intro-1291.shot.2.caption --provider openai` then (key present only) the same with
   `--provider elevenlabs`. Record per run in `tools/assets/voices-cost.log`: input chars (with/without
   spaces), cost, output bytes + duration, voice ID, model + snapshot/date.
3. Extrapolate: `total_cost = total_chars × unit_price × 1.75` (regen overhead). `total_chars` comes from
   `fetch-voices.mjs --dry-run --tier <t> --only <locale>`, which MUST print per-speaker char subtotals
   (grouped by `speaker:`) + grand total + both-provider cost columns. Pre-dry-run estimate (508 IDs,
   ~150 chars avg ⇒ ~76k chars EN; ×3 locales ≈ 230k): OpenAI full ≈ $3.50 (≈ $6 w/ overhead); ElevenLabs
   full ≈ $23 (≈ $40 w/ overhead); Tier 0 (~30 lines ≈ 4.5k chars): OpenAI ≈ $0.07 / ElevenLabs ≈ $0.45.
   Estimates only — dry-run numbers rule. Per-character cost = same formula on that speaker's subtotal.
4. NEVER voiced/counted: barks (`npc.ts` toast tables), combat callouts, choice-button labels.

### 1.4 Voice cast (distinctness is FREE — TTS bills per character, never reuse a hero voice)

| Speaker key | OpenAI `tts-1` (committed) | ElevenLabs A/B | Direction |
|---|---|---|---|
| narrator (chronicle + ALL `generic.ts` + ALL `cs.*` captions) | Onyx | Adam, deep/slow | Warm parchment, unhurried |
| player (oath lines) | Echo | Josh, young earnest | Earnest, unpolished |
| npc.werner-stauffacher | Fable | Arnold, gravelled | Measured, weighty |
| npc.walter-fuerst + npc.werner-von-attinghausen (share OK, never share a scene) | Sage | Sam, older warm | Tired, dry humour |
| npc.arnold-von-melchtal (young, fiery) | Echo +1 st (distinct render from player) | young male premade | Hot-headed, faster |
| npc.wilhelm-tell | Ash | Antoni, reserved low | Flat, dangerous calm |
| npc.hermann-gessler | Onyx −2 st (distinct FILE from narrator) | Clyde-style custom `Gessler` | Cold, clipped |
| npc.beringer-von-landenberg | Sage −1 st | `Landenberg` custom, nasal older | Impatient bureaucrat |
| npc.vogt-schreiber-ludwig | Alloy | `Ludwig` custom, thin nasal | Officious clerk |
| npc.abt-johannes | Fable −1 st | `Abt` custom, resonant | Chant-trained, patient |
| npc.konrad-ab-yberg + npc.leopold-i + npc.heinrich-von-hunenberg + npc.ritter-eberhard-von-mulinen (officer block, 1-liner heavies) | Nova | `Officer` custom | Crisp, Swabian-cold |
| npc.johannes-von-winterthur (boy, 14) | Coral +2 st | young-teen premade | Curious, unguarded |
| Companions jost-imhof / heini-odermatt / ueli-zgraggen / bruder-anselm | Echo −1 / Ash −1 / Nova −1 / Sage plain | distinct premades | Working men; Anselm softer |
| npc.mechthild-schorno / npc.trudi-meier + minor women | Coral / Shimmer; minors share Coral plain | Elli + Bella / Domi | Plain working women |
| Side men niklaus-planzer / melchior-arnold / uli-fischer / burkhard-wyrsch / jost-durrer | rotate Ash/Echo/Sage plain (never pitched hero variants) | shared `en_male` | Plain valley men; Durrer low/slow |

Pitch variants via offline `ffmpeg asetrate+aresample` ($0), semitone value recorded in the manifest row.
Uniqueness gate: `--dry-run` FAILS if any scene's speaker set collapses to one rendered voice
(gessler-hat: Ludwig + guards + Tell + narrator must all differ). Same voice IDs speak `de` text;
  `gsw` has no voice files by decision (2026-09-06): the gsw text locale falls back to the High German
  voice files at runtime (voiceSink in `src/ui/index.ts` maps `gsw` → `de` for audio only; text stays Alemannic).

### 1.5 Scope ladder (confirmed: Tier 0 = en, Tier 1 adds de; gsw uses de voices, no gsw files)

- Tier `probe`: single line, both providers (or OpenAI-only), extrapolation table. Blocks all bulk.
- Tier 0 (`en`, commit, ~30 lines, ~2–4 MB): all 11 `cs.*.shot.*.caption` + `dlg.gessler-hat` + `dlg.ruetli-oath`.
- Tier 1 (`en`+`de`, commit, ~180 lines): Tier 0 + `dlg.wilhelm-tell`, `dlg.werner-stauffacher`,
  `dlg.walter-fuerst`, `dlg.hermann-gessler`, `dlg.abt-johannes` (text only, NOT choice labels).
  `de` text from `tools/i18n/strings.de.json` (same IDs, placeholder equality enforced).
- Tier 2 (full 508 IDs × `en`+`de`): ship as `voices-full.zip` release artifact, NOT committed.
  No gsw voice files exist — the gsw text locale plays the `de` files (voiceSink maps `gsw` → `de`).
- Text source is always the frozen strings files; placeholder policy for files is player-agnostic
  (`{player}`→`friend`, `{playerFamily}`/`{time}`→dropped, `{origin}`→`Uri` via `VOICE_TEXT_OVERRIDES`;
  runtime text keeps real names). Documented in `CREDITS-voices.md` header.

### 1.6 Pipeline

New `tools/assets/voices-manifest.json` (`version`, `provider`, per-role voice map, `openaiFallback`,
tiers, `audio: { opus: "libopus 24k mono 24kHz", mp3: "48k mono" }`) + new `tools/assets/fetch-voices.mjs`
(`--dry-run`, `--tier probe|hero|tier1|full`, `--only en|de`, `--provider elevenlabs|openai`,
`--probe-id`, `--force`). Per ID: catalog text → strip/override placeholders → synthesize
(ElevenLabs `/v1/text-to-speech/<voice-id>` or OpenAI `/audio/speech` via OpenRouter key) → `ffmpeg` to
`public/assets/voices/<locale>/<slug>.opus` + `.mp3` (slug = lowercase, non-alnum → `-`) → append
`CREDITS-voices.md` row (`AI-generated (<model>/<voice>, date, $x.xx)` + files + bytes, never CC0) +
`voices-cost.log` line. Toolchain needs `ffmpeg` only; verify from script header; no new npm runtime deps.

### 1.7 Runtime wiring (implementer executes)

Extend `AudioEngine` (`src/ui/audio.ts`) with a 2-element `HTMLAudioElement` pool:
`playVoice(locale, id)`, `stopVoice()` — voice bus at 0 dB over the −6 dB music bus, `masterVolume` applies,
no new gain staging. Add `voicesEnabled: boolean` (default true) to `Settings` (`src/core/context.ts`,
integrator-owned) + panel toggle reusing the `masterVolume` row pattern (`src/ui/menus.ts:581-642`); extend
`UiService.audio` (`src/core/services.ts:449-454`, integrator-owned, smallest-request rule). Wire:
`dialogueUi.show()` plays the node voice, `hide()/pick()` stops it; `cutsceneUi.caption()` plays the caption;
barks/combat untouched. Unlock-gated like music (no autoplay violation); prefetch next-node audio on `show()`.
Budgets: Tier 0/1 committed only (single-digit MB); streaming `<audio>`, no WebAudio decode, heap unchanged;
zero runtime network except same-origin file fetches. Fallback (missing file / 404 / disabled / no WebAudio =
silent, text remains) proven by deleting one committed file and playing that node headless.

### 1.8 Voice validation per tier

Stub-context unit tests (`audio.test.ts` style): `playVoice/stopVoice` never throw without files, missing-file
silent, `stopVoice` on hide, placeholder-strip test. Headless `dialogue-gessler-hat` with voices forced on:
zero errors/warnings. Manual listening gate on Tier 0 ONLY (voices audibly distinct per scene, LORE register,
no artifacts) before Tier 1. `STATUS.json` evidence, no scoreless claims.

## 2. Music — Google Flow (user-owned 10,000 credits; procedural bus stays as fallback)

Flow tracks UPGRADE individual beds; missing file = procedural bed (never silence-by-error).
`--dry-run` for music = list beds + durations + credit estimate, no generation.

### 2.1 Copy-paste Flow prompts (paste as-is; ~60–90 s seamless loops; acoustic/folk, no vocals)

Master each to −14 LUFS, export WAV → `ffmpeg` to `public/assets/music/<bed>.opus` (48k stereo, 64 kbps) +
`.mp3`; `CREDITS-music.md` rows (`AI-generated (Google Flow Music, date, credits spent)`).
Credit plan: 6 beds + 3 stingers ≈ 9 generations; at ~100–200 credits/generation this leaves room for 2–3
retakes per bed — REJECT duds fast (first 10 s tell). Generation order by play frequency
(`explore` → `tavern` → `battle` → `title` → `church` → `morgarten`) so a shortfall still covers common paths;
stingers last, only if all beds accepted.

1. `music.explore` — "Open walking theme for Alpine valleys, nyckelharpa-ish bowed melody over plucked psaltery
   and soft frame-drum, D-Dorian / G-Mixolydian shifts, 90 BPM, overcast light with sun-breaks, hopeful but
   restrained, seamless loop, no vocals."
2. `music.tavern` — "Rowdy-but-warm medieval tavern dance, schalmei shawm melody over hurdy-gurdy drone and
   frame-drum, G-Mixolydian, 120 BPM, wooden-room reverb, seamless loop, no vocals, no modern instruments."
3. `music.battle` — "Pre-firearm battle surge, massed frame-drums and war-horns over low bowed strings, shouted
   Germanic chorus hits (non-lexical 'hey/ho', no words), D minor/Dorian, 140 BPM building from 100, mud and
   breath-fog urgency, seamless loop, no modern percussion, no electric."
4. `music.title` — "Slow cinematic Alpine overture, solo alphorn over low strings and distant chapel bell,
   D-Dorian, 60 BPM, misty dawn over a mountain lake, sparse, reverent, no percussion for 30 s then soft
   frame-drum enters, seamless loop, no vocals, no synth pads, acoustic only."
5. `music.church` — "Medieval monastic interior, male choir chant fragment in Latin psalm tone alternating with
   portative organ, stone-church reverb 3 s, D-Dorian, 70 BPM, solemn, sparse, seamless loop, no modern harmony."
6. `music.morgarten` — "Winter-ambush lament march, solo shawm lament over muffled drums and low strings, snow
   and iron, D-Dorian, 80 BPM, grief under discipline, final 8 bars lift to defiant major-tinged cadence,
   seamless loop, no vocals."
7. Stingers, one-shots 2–4 s (optional): `discover` (hammered dulcimer, bright), `quest-done` (seal-stamp +
   string lift), `quest-fail` (low bell toll ×2).

### 2.2 Music wiring (implementer executes)

Extend `AudioEngine` with `playMusicTrack(bed)`; keep `playMusic(bed)` as fallback: file exists →
`<audio>` loop at music-bus level (−6 dB under SFX, `masterVolume` applies), else existing step-sequencer bed.
`stopMusic()` stops both. Crossfade 1.5 s between beds (kills current hard cuts). Procedural combat layer
(drum + low-string ostinato gain from the existing combat event stream) plays UNDER the Flow
`battle`/`morgarten` loop when present. Night variant: `explore` −3 semitones + lowpass after 22 h (clock read,
no new state). Bark earcon: 180 ms soft blip under toast, rate-limited 45 s. Each with a stub-context unit
test. Validation: each bed with/without file (fallback proof by rename), headless scenario with music forced:
zero errors/warnings. `STATUS.json` evidence.

## 3. Visual headroom (each inside budgets, LORE-gated, no new npm runtime deps)

1. IBL/PMREM ambient (`src/world/sky.ts`, `src/core/graphics.ts`): 64px PMREM from the live sky dome on
   `setWeather`/`setTimeOfDay` (throttled 2 s), `scene.environment` only. Gate: `free-pilatus-luzern` +
   `sarnen-night-rain` captures show lifted shadow-side detail, calls/tris unchanged.
2. Post chain (integrator approval per `docs/PHASES.md` §2.0 — `three/addons` `EffectComposer` only, no new
   package): FXAA + grade LUT + vignette/grain + restrained bloom, behind `Settings` toggle (default on high,
   off low). Gate: `title` + `altdorf-square-noon` side-by-side, p95 recorded `--gpu`, disables cleanly.
3. GPU precipitation (`src/world/sky.ts`): single `Points` shader from `WEATHER.particles` + wind uniform,
   replacing 1400 CPU points. Gate: `sarnen-night-rain` cost bounded, zero per-frame allocs.
4. High-only planar water reflection (`src/world/water.ts`): 0.5× mirror target on `quality==='high'`, lakes
   only; medium/low keep the Fresnel/glitter path. Gate: lake vista captures, heap delta recorded.
5. Wet sheen (`src/world/models/kit.ts` params only): `roughness` −0.25 + `envMapIntensity` +0.5 when
   `WEATHER.wetness>0.5`, no new materials. Gate: `sarnen-night-rain` roof/cobble specular read.
6. Impostor repaint (`src/world/look/impostor.ts`): rebake cells from the same foliage cells after the albedo
   swap (no LOD colour pop). Gate: 60/250 m tier walk captures, Sarnen slope within tri budget.
7. Character gaps (largest per `docs/PHASES.md` B1): 2–3 male civilian bodies ≤8k tris + 1–2 women
   (Mixamo-via-HF, `tools/assets/fbx2glb.mjs` cm→m, textures ≤512px), child/monk/rider procedural upgrades,
   Habsburg livery cloth tint, crowd LOD/impostors; keep `spawnCharacter` handle contract (no double-tick,
   dispose pooled, late-async guard). Gate: `combat-brunnen-quay[-turn]` + `combat-morgarten-setup` +
   dialogue captures, `CREDITS-characters.md` rows, heap-after-eviction measured.
8. Portraits wired (`src/content/npcs.ts` only): assign `candidate-woman`/`candidate-bearded-man` keys to 2–4
   matching NPCs (Trudi/Mechthild-type + bearded elder), keep SVG fallback + `CREDITS` rows (AI-painted,
   model/date/cost). Gate: `dialogue-gessler-hat` capture shows painted portrait, 404 path still falls back.
9. OFL fonts (`public/assets/fonts/` + manifest + CREDITS, `ui.css` `@font-face`, no remote loads): display
   (e.g. IM Fell English) + body (e.g. EB Garamond / Alegreya Sans). Gate: title/menu/journal captures at
   1080p + 720p pass, offline + `base './'` intact.
10. Alloc kills (no look change): HUD compass rebuild (`src/ui/hud.ts`), combat hover allocs
    (`src/ui/combatUi.ts:90-112`), `updateHud` POI loop (`src/exploration/hud.ts:29-46`). Gate: flyover hitch
    evidence, `flyover-streaming` report, no behaviour change.
11. Adaptive view radius: drop `viewDistance` one step on sustained hitch (>3 × 25 ms in 2 s), restore on
    settle. Gate: `flyover-streaming` hitch counts down, never below 1500 m unlogged.

## 4. Execution order

1. Voice probe (Step 0 key check → `--tier probe` → extrapolation table). Blocks ALL bulk voice work.
2. Voice Tier 0 pipeline + runtime + validation (OpenAI default; ElevenLabs A/B only if key present).
3. Flow music in play-frequency order (user generates; implementer wires with fallback).
4. Procedural SFX tail + crossfade + combat layer (independent of Flow).
5. Visuals 1–6 (renderer/atmosphere, each gated by captures).
6. Characters + portraits + fonts (content-visible).
7. Alloc kills + adaptive radius.
8. Full finalgate 20/20 + playthrough first/last 18/18 + critic re-score ≥8 + blind comparison
   (`docs/PHASES.md`); `STATUS.json` updated. Save schema stays frozen unless a migration ships with tests;
   `GEOGRAPHY_VERSION` bumped only on generation/classification changes (never delete player saves).

Per-increment gate: failing-first tests where applicable; `npm test` + `typecheck` +
`node tools/check-imports.mjs` + `npm run build`; captures inspected as PNGs (never Boolean-pass only);
report renderer/resolution/counts/errors/warnings; budgets hard.

## 5. Open questions (blocking bulk, NOT the probe)

1. `ELEVENLABS_API_KEY`: supplied (enables hero A/B) or OpenAI-only? Step 0 resolves with zero spend.
2. `gpt-4o-mini-tts` vs `tts-1` for Gessler/narrator: decided at the Tier 0 listening gate, not now.
3. Flow per-generation credit cost (unknown until first generation): record actuals in `CREDITS-music.md`,
   re-plan retakes if a bed costs more than ~200 credits.
4. Tier 2 bulk provider (OpenAI vs ElevenLabs): decided at the Tier 1 gate from real cost + listening evidence.
