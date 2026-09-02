# world-1: move the `free-pilatus-luzern` harness camera (or accept a documented gap)

## What

`tools/harness/scenarios.json`'s `free-pilatus-luzern` camera (`pos: [-5500, 400, -900]`) sits ~53m
*below* the terrain surface after this round's height-model fixes (`heightAt(-5500,-900) ≈ 453.5`).
Every other scenario camera in the file is now ≥5m above ground (see
`src/world/terrain-geometry.test.ts`, test group `(d)`); this is the one holdout.

## Why

The camera is positioned on the lower flank of the Pilatus/Stanserhorn massif, roughly 700m from the
Pilatus summit. Pilatus itself now renders at its correct gazetteer height (565m) — the flank rising to
~450m at a point 700m out and ~400m of elevation below the summit is a plausible real mountainside, not
a modelling bug (Pilatus really does rise ~1700m above the Luzern basin over a few km). A camera at
y=400 on that flank is genuinely likely to be below the local ground unless placed very deliberately
relative to a specific bench/ledge or road. `tools/harness/scenarios.json` is owned by the harness, not
`src/world/**`, so I can't move it myself.

## Proposed diff

Either:
- Raise the camera's `y` to something like 480–520 (with the same `pos.x`/`pos.z`), or
- Move `pos` slightly further out along the same look direction (e.g. `[-5300, 420, -1050]`), which
  should land on gentler ground closer to the Luzern-basin road network (`luzern-road`/`obwalden-road`).

I'd suggest re-running `node tools/harness/run.mjs --scenario free-pilatus-luzern` after the change and
checking the PNG shows the Luzern basin + lake arms from the flank (the acceptance picture in this
round's task), not a black/underground frame.

## Workaround in the meantime

None available from `src/world/**` — the scenario camera position is out of this module's editable
paths. The harness screenshot for this scenario should be read with this known gap in mind: the
terrain there is real (a real, steep-but-plausible Pilatus flank), the camera placement is what's
marginal.
