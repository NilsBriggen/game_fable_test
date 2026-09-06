# Eidgenossen — Art Direction

Status: direction note for Phase 2 (technical + assets ACTIVE per `docs/PHASES.md`).
Date: 2026-09-06. Canon is `LORE.md`.
This file sets look targets only; it grants no acceptance and claims no completion.

## 1. Direction statement

Target a KCD-muted overcast Central Switzerland: cool desaturated mid-tones for rock,
lake, and sky, broken by warm sun-break accents on pasture, timber, and skin. Cliffs
read limestone-grey with damp streaking, woods read dark spruce mass with altitude
banding, settlements read timber/plaster/stone under steep shingle or tile roofs.
UI stays parchment/ink with restrained gold and faction red/green accents.
Recovered frames are direction anchors (faults to fix, not scores):

- `title` (title.png, lake valley vista): keep readable layered depth (water/shore/
  peaks/sky) and a high-contrast title-safe band; fix washed sky and flat water.
- `lake-overview-seelisberg` (high Urnersee overlook): fix stretched cliff UVs, flat
  cyan water with no reflection/roughness variation, washed horizon, card-like trees.
- `ruetli-dawn` (meadow: 3 figures, hut, boat): keep low-camera pastoral framing; fix
  thin ground cover, floaty prop grounding, weak costume separation at dawn exposure.
- `portrait-woman.png` + `face-test.png` (painted portrait candidates): keep painterly
  skin/cloth separation and soft key light; fix waxy smoothing and period breaks in
  haircut, neckline, and jewellery before adoption as portrait baseline.

## 2. Palette and typography

Keep the existing CSS vars in `src/ui/ui.css` (`:root`, first 60 lines): `--parchment` /
`--parchment-deep` / `--parchment-dark`, `--ink` / `--ink-soft` / `--ink-faint`, `--gold` /
`--gold-bright`, `--habsburg` / `--habsburg-bright`, `--laender` / `--laender-bright`.
Do not rename or fork them; add shades only as new vars with one consumer. World palette
follows the same logic: limestone-grey cliffs, dark spruce woods, slate lake blue-green
water; warm straw/amber reserved for sun-breaks, hearth light, and title accents.
Habsburg red-white-red appears only as livery/field-sign cloth, never as UI wash.
Type: self-hosted OFL-licensed fonts only under `public/assets/fonts/`, each with a manifest
entry (`tools/assets/*manifest*.json`) and a CREDITS row. No remote font loads: the build
serves from `./` on an itch.io sub-path and must work offline. Fallback stack stays
`Georgia, 'Iowan Old Style', 'Palatino Linotype', Palatino, serif` per `src/ui/ui.css`.

## 3. Pillar look targets

- Renderer/lighting: single WebGLRenderer, ACES, PCFSoft; terrain inside the CSM path;
  IBL/PMREM ambient plus restrained post (AA, grade, vignette/grain; minimal bloom).
- Terrain: single splat-shaded heightfield; altitude-ordered grass/meadow/forest/rock/
  scree/snow/mud/yard/track with shore blending and dry pads. Reuse cached `ai-terrain/`
  albedos (9 PNG layers + seamless JPGs, `review-seam`/`review-rest`, `backup-cc0/`).
- Sky/weather/water: Preetham sky with volumetric-feel cloud, lightning, GPU rain/snow;
  wet sheen on props/characters; planar/SSR reflection on high only; per-lake levels.
- Vegetation/rocks: pooled instanced spruce >> fir > beech > larch by altitude (`LORE.md`
  §10); 60/250 m tiers plus impostors, wind sway, worked-woodland glades; bedded limestone.
- Settlements/props: Blockbau on drystone plinth, Laube gallery, stone-weighted shingle
  roofs; stone/limewash/Fachwerk town houses with tile in Luzern/Zug/Sarnen; plain wooden bridge.
- Characters/combat bodies: cotte+hose+Gugel/coif (men); gown+apron+veil/wimple (married
  women); gambeson+Eisenhut (militia); mail+red-white-red surcoat, bascinet+aventail (Habsburg).
- UI/portraits/map: parchment panels, ink text, gold focus rings; shaded icons; painted
  portraits in `portrait-woman`/`face-test` manner; parchment map with fog-of-war and zoom.
- VFX/feel: sparse period-plausible sprites (dust, spray, smoke, snow drift, torch glow);
  hit feedback, shake/tweens, BG3-readable hover without fantasy glows or number clutter.

## 4. LORE gate checklist (blocks adoption)

Per `LORE.md` §§1, 7-8. Reject any asset or text showing: plate harness; windlass-spanned
crossbows (stirrup + belt hook only); Kapellbrücke form (plain wooden bridge only); Swiss
cross as a flag (field sign from 1339 at earliest, later act); potatoes, maize, tomatoes,
tobacco, or chocolate in stalls/meals/props; modern "canton" in NPC speech (UI-only) or the
word "Switzerland"; a literal Pilatus dragon (monk-told folk tale: lammergeier + smuggler).
Invention log rule: every invented person, place use, prop form, or wording not attested H/L
goes to `LORE.md` §10 as an append-only row (ID, what, author, justification). Unlogged
invention is not shippable.

## 5. Asset provenance rule

Fixed order: manifest row → fetcher script → CREDITS row → wire with procedural/CC0
fallback that survives file deletion. Record author, source URL, licence, files, and sizes;
check intended-use terms before fetching. AI rows use `AI-generated (model, date, cost)`
with prompt/seed kept with the fetcher. Never label third-party or AI art fully original
or CC0. Cost discipline (OpenRouter): prefer `--pack-only` review and cached `ai-terrain/`
PNGs over new generation; cap per-asset generation, batch prompts, keep CC0/procedural
fallback as default. Price-conscious sources (free downloads, kitbash, Blender) first.

## 6. Budgets recap (harness verdicts, not art scores)

Per-scenario budgets: ≤2000 draw calls/frame, ≤3 M triangles, ≤512 MB heap, zero browser
errors and zero warnings. Frame p95 ≤16.6 ms enforced only with `--gpu` (or
`HARNESS_ENFORCE_P95=1`); SwiftShader records `p95warn` for correctness only. Target:
1080p/60 on RTX 3060/M2 class. Key scenarios (`tools/harness/scenarios.json`): `title`,
`lake-overview-seelisberg`, `ruetli-dawn`, `free-pilatus-luzern`, `sarnen-night-rain`,
`morgarten-winter`, `flyover-streaming`, `dialogue-gessler-hat`, `menu-inventory`, `menu-map`.

## 7. Portrait candidates provenance (2026-09-06)
Source: /tmp/opencode recovery (crashed-session, AI-painted candidates).
Landed: public/assets/portraits/candidate-woman.png (1495486 B, linen veil/gown woman)
+ candidate-bearded-man.png (1200225 B, bearded man in tunic).
No NPC `portrait` field uses them yet (grep: zero content hits); content pass must wire keys.
Runtime: dialogueUi portraitUrl(<key>.png) with <img> self-remove on error; portraitSvg silhouette fallback.
