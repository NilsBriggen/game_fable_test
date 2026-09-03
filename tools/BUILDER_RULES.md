# Rules for builder agents

You are one builder in a multi-agent build of *Eidgenossen* (see `ARCHITECTURE.md`, `LORE.md`). Read both fully
before writing code, then read everything in `src/core/` (the shared data model and the service interface you must
implement) and `src/content/gazetteer.ts` (shared real-place coordinates).

## Ownership
- Edit ONLY the paths listed in your task. Never edit `src/core/*`, `src/main.ts`, `ARCHITECTURE.md`, `STATUS.json`,
  `package.json`, `index.html`, `tools/harness/*`, or another module's directory.
- If you need a change in `src/core` (new component field, new service method, schema tweak): write
  `requests/<your-module>-<n>.md` (what / why / proposed diff), then WORK AROUND it inside your own module for now
  (private types, local helper). Do not block on the integrator.
- No new npm dependencies. Three.js r170 (+ `three/addons/*`), vanilla TS. External asset downloads ARE allowed from
  any source and under any licence (owner's decision): every file goes under `public/assets/**` with a row in the
  relevant `tools/assets/*-manifest.json` (URL, author, licence as found, files, sizes) and a line in
  `public/assets/CREDITS-*.md`. Procedural generation is still fine where it reaches the bar. Style target: readable,
  painterly-realistic, PBR (`MeshStandardMaterial`) with normal/roughness.
- Import rule: your module may import `@core/*`, `@content/*`, `three`, and its own files. Nothing from other modules.
  `node tools/check-imports.mjs` must stay clean.
- Do NOT run `git commit` / `git push`. The integrator commits. Do not run `git checkout`/`git stash`/`git reset`.
- Other builders are editing other directories at the same time. When `npm run typecheck` shows errors in files
  outside your paths, ignore them; YOUR files must have zero errors (`npx tsc --noEmit 2>&1 | grep 'src/<yourdir>'`).
- Do not delete or rewrite the stub `register(ctx)` signature: your module's `src/<module>/index.ts` must export
  `async function register(ctx: GameContext)` which registers your service via `ctx.services.register('<name>', impl)`
  and adds systems via `ctx.scheduler.add(...)`.

## Quality bar
- The game must stay bootable: `npm run typecheck`, `npm test` (vitest, put tests next to code as `*.test.ts`), and
  `node tools/harness/run.mjs --scenario <ids>` must run. The harness is the evidence: quote its numbers (draw calls,
  triangles, p95 frame ms, errors) in your final report and look at the PNGs it writes to `tools/harness/out/` with the
  Read tool. Fix what the screenshots show. A verbal "it works" is not accepted.
- Zero console errors and zero console warnings from your module in harness runs. (Warnings from `[stub]` modules
  that are not yours are fine.)
- Historical fidelity: everything player-facing follows `LORE.md`. Every content def has `historical` + `note`.
  If you invent something, append a row to `LORE.md` §10 (the only part of LORE.md you may edit).
- Budgets (ARCHITECTURE.md §2): ≤ 2000 draw calls, ≤ 3M triangles, no per-frame allocation storms.
- Note: the harness renders with SwiftShader (software) in this container, so frame-time numbers are an upper bound.
  Draw calls, triangles, errors and screenshots are the hard evidence.

## Final report (your last message)
1. What you implemented (files, public surface).
2. Harness numbers for the scenarios you ran, and which screenshots you inspected — with an honest description.
3. Unit tests added and their result.
4. Known gaps / not done — say so plainly, no inflation.
5. Core change requests filed (`requests/*.md`), if any.
