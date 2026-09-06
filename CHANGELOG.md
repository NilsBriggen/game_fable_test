# Changelog

## 0.2.0-phase5 — 2026-09-06

Phase 5 hardening: perf HUD + GPU probe, world-load marks, crash log,
renderer auto-detect, save freeze-report suite.
Harness: p95 16.6 ms budget enforced on `--gpu` /
`HARNESS_ENFORCE_P95=1` (software runs record only).
Build: `base: './'` for itch.io sub-path / iframe serving.

## 0.1.0 — 2026-09-05

Baseline: 534 tests passing, production bundle green, import gate ok.
Evidence in `STATUS.json` and `tools/harness/out/finalgate/report.json`.
