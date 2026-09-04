# Eidgenossen

A browser RPG set in the Old Swiss Confederacy, 1291–1315: free-roam exploration of the Vierwaldstättersee region
(Uri, Schwyz, Unterwalden, the Habsburg towns) and turn-based party combat with halberds, pikes, crossbows and
the Gewalthaufen. No magic, no monsters. Historical beats are played, not narrated: the Bundesbrief of 1291,
Gessler's hat, the Hohle Gasse, the Marchenstreit, Morgarten.

Three.js r170, TypeScript, Vite. No backend; saves in IndexedDB.

## Run

```
npm install
npm run dev          # http://127.0.0.1:5173
npm run build        # typecheck + production bundle
npm test             # vitest (rules, ECS, save, quest, content validation)
node tools/harness/run.mjs --scenario altdorf-square-noon     # headless screenshot + draw calls + console errors
node tools/harness/playthrough.mjs --pick first               # headless Act 1 playthrough with per-beat screenshots
```

The harness uses the bundled Chromium under software rendering in CI-like containers; frame times there are an
upper bound, draw calls / triangles / errors are the hard numbers.

## Layout

| Path | What |
|---|---|
| `ARCHITECTURE.md` | Module boundaries, data model, service interfaces, units, budgets, agent ownership |
| `LORE.md` | Historical grounding: timeline, factions, regions, characters, quest spine; every entry marked historical / legend / invented |
| `STATUS.json` | Per-module critic scores, fix rounds, open issues, escalations |
| `tools/critic/` | Critic rubric and score sheets per wave |
| `src/core` | ECS, RNG, clock, DSL, content registry, service interfaces (integrator-owned) |
| `src/world` | Terrain from the real geography, sky, water, vegetation, model library |
| `src/exploration` | Player, camera, POIs, NPCs and schedules, interaction |
| `src/combat` | Turn-based rules engine, AI, encounter renderer |
| `src/party` | Skills (learn by use), perks, items, equipment |
| `src/quest` | Quests, dialogue, reputation, cutscenes |
| `src/save` | IndexedDB persistence, migrations |
| `src/ui` | DOM HUD and menus |
| `src/content` | Data: gazetteer, regions, POIs, NPCs, items, abilities, encounters, quests, dialogues |

## Assets and provenance

Code and content are original. Every external art file is listed with its source URL, author, licence as found
and committed size (the owner's rule: any source is fine, but everything is listed):

- `public/assets/CREDITS-models.md` — buildings and props (OpenGameArt Medieval Village MegaKit, KayKit)
- `public/assets/CREDITS-world.md` — terrain textures, vegetation, sky (Poly Haven)
- `public/assets/CREDITS-characters.md` — Mixamo character bodies and animation clips (Hugging Face mirrors
  `GbotHQ/mixamo-characters`, `Leeoo/mixamo-rigs-clips`; Adobe Mixamo terms) and the Poly Haven maps of the
  procedural fallback body
- `tools/assets/*-manifest.json` — the machine-readable manifests; `node tools/assets/fetch.mjs`,
  `fetch-world.mjs` and `fetch-characters.mjs` reproduce `public/assets` and rewrite the credits files

Asset tooling (no Blender, no native binaries — the bundled headless Chromium does the work):

- `tools/assets/fbx2glb.mjs` — FBX (embedded textures) → GLB, textures downscaled, cm → m
- `tools/assets/glbsheet.mjs` — renders a GLB, optionally driven by a Mixamo clip, to a PNG evidence sheet
- `tools/harness/shrink.mjs`, `tools/harness/montage.mjs` — delivery JPEGs and side-by-side sheets from harness PNGs

Invented names, places and plots (as opposed to attested history or founding legend) are registered in `LORE.md` §10.

## Status

See `STATUS.json` and `tools/critic/*.md`. Scores are critic-assigned against Skyrim (exploration), Baldur's Gate 3
(combat) and Kingdom Come: Deliverance (tone), on harness evidence, pass bar 8/10.
