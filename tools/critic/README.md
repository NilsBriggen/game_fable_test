# Critic evidence index

`RUBRIC.md` is the active scoring policy. Files named `wave*-*.md`, `bughunt/*.md` and `lore-sweep/*.md` are historical reports from particular revisions/fix rounds, not a current backlog or operative builder instructions. They are retained because their evidence and adversarial reasoning remain useful.

Before reopening an issue, trace it through the current implementation, regression tests and dated STATUS entries. Before closing it, reproduce through the real runtime; mocked hosts can hide registration/lifetime errors. Current implementation findings and verification limitations are in [AGENTS.md](../../AGENTS.md).

Some historical paths (builder rules, old change requests, procedural-only credits) were removed in the 2026-09-05 documentation consolidation. Their appearance in an old report describes that report's evidence, not a file another agent must recreate. Useful request contents and unresolved obligations were transferred to AGENTS.

`probes/<area>/vitest.config.ts` selects separate adversarial/diagnostic tests, excluded from default `npm test`. Read probes before running/interpreting them: some print measurements and have trivial assertions. Old passing probes cannot certify current visual quality.

Harness PNGs/reports under `tools/harness/out/` are ignored local artifacts and may not exist in another checkout. A new score needs inspected fresh evidence, renderer/resolution/scenario identification and actual metrics. The rubric's world target of 1200 calls leaves headroom within the 2000-call hard limit.
