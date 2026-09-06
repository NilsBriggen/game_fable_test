# Eidgenossen

A single-player browser RPG set in the Old Swiss Confederacy, 1291–1315. Explore the Vierwaldstättersee region, meet its inhabitants and play a branching campaign through Morgarten, with turn-based party combat using mundane weapons, formations and morale. Historical events and founding legends are explicitly distinguished. No magic or default monster enemies.

Three.js r170, strict TypeScript, Vite 6, vanilla DOM UI. No backend; browser-local saves.

## Run

```sh
npm ci
npm run dev          # http://127.0.0.1:5173
npm run build        # typecheck + production bundle
npm test
node tools/check-imports.mjs
```

WASD/arrows to move, Shift to sprint, left Alt/Control to walk, Space to jump, click the canvas for mouse-look, E to interact. See in-game menus for party, quests, inventory, map and saves.

## Development and current state

Start with [AGENTS.md](AGENTS.md): implementation map, lifecycle, module boundaries, commands, testing/harness processes and concrete open findings. [ARCHITECTURE.md](ARCHITECTURE.md) records design decisions; [LORE.md](LORE.md) is the historical canon. [STATUS.json](STATUS.json) and [critic reports](tools/critic/README.md) contain dated evidence, not a blanket current pass certificate.

The 2026-09-05 documentation audit passed 39 test files / 534 tests, production build and import gate. It did not rerun browser captures or assign visual scores. Existing reports and their limitations—including assisted story progression, outstanding live-service wiring issues and unverified hardware performance—are documented in AGENTS §10.

```sh
node tools/harness/run.mjs --scenario altdorf-square-noon --out tools/harness/out/local-altdorf
npm run harness:build -- --scenario altdorf-square-noon --out tools/harness/out/local-preview
node tools/harness/playthrough.mjs --pick first --out tools/harness/out/local-story
```

The harness starts its own server and defaults to software-rendered Chromium. A numeric pass does not certify frame rate, screenshot quality or historical compliance.

## Assets

Imported and procedural assets coexist. Sources, authors and licences are recorded in [model credits](public/assets/CREDITS-models.md), [world credits](public/assets/CREDITS-world.md) and [character credits](public/assets/CREDITS-characters.md), with reproducible manifests/tooling under `tools/assets/`. Preserve licence notices; not all assets are CC0.
