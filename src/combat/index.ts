/**
 * Combat module entry point. ARCHITECTURE.md §5.3, §4. Registers a full `CombatService`.
 */
import type { GameContext } from '@core/context';
import type { CombatService } from '@core/services';
import { CombatEngineImpl, type CombatHost } from './engine';
import { CombatRenderer, registerCombatModels } from './render';

export async function register(ctx: GameContext): Promise<void> {
  const host: CombatHost = {
    world: ctx.world,
    content: ctx.content,
    // PartyService is a structural superset of PartyServiceLike (see engine.ts) — passed straight through.
    party: ctx.services.get('party'),
    rng: ctx.rng.combat,
    worldService: ctx.services.tryGet('world'),
    questService: ctx.services.tryGet('quest'),
    events: { emit: (event, ...args) => ctx.events.emit(event as never, ...(args as never[])) },
  };
  const engine = new CombatEngineImpl(host);

  const worldSvc = ctx.services.tryGet('world');
  if (worldSvc) registerCombatModels(worldSvc);

  const renderer = new CombatRenderer(ctx);
  engine.on('state', (view) => renderer.update(view));
  engine.on('event', (rec) => {
    renderer.onEvent(rec);
    if (rec.kind === 'damage' && rec.data && typeof rec.data.amount === 'number' && rec.unit) {
      const u = engine.getState()?.units.find((x) => x.id === rec.unit);
      if (u) renderer.spawnDamageNumber({ q: u.q, r: u.r }, rec.data.amount as number);
    }
  });

  let framing = false;
  const frameCamera = (): void => {
    const view = engine.getState();
    if (!view || framing) return;
    // the engine emits its final state after 'end' too (result card, save thumbnails): re-entering combat
    // camera mode then froze the view over the last battlefield for the rest of the chapter
    if (view.phase === 'ended') return;
    framing = true;
    try {
      const cx = view.grid.origin.x;
      const cz = view.grid.origin.z;
      // orbit the field's own height: authored reliefs now sit on the real ground, so a y=0 focus at
      // Morgarten (300 m up) pointed the camera at the sky with the grid in a corner
      const cy = view.cells.length ? view.cells.reduce((a, c) => a + c.height, 0) / view.cells.length : 0;
      const span = Math.max(view.grid.cols, view.grid.rows) * view.grid.cellM;
      const exploration = ctx.services.tryGet('exploration');
      if (exploration) {
        const rig = exploration.getCameraRig();
        rig.setMode('combat');
        // pitch is the elevation ABOVE the focus (orbitPosition adds distance·sin(pitch) to y): -0.72 put the
        // camera 20 m under the Morgarten slope looking up through the grid at the treetops
        rig.focus(cx, cy, cz, { distance: Math.max(24, span * 0.75), pitch: 0.72, yaw: view.grid.origin.yaw + 0.6, instant: true });
      } else {
        const camera = ctx.gfx.camera;
        const dist = Math.max(24, span * 0.75);
        camera.position.set(cx + dist * 0.6, cy + dist * 0.75, cz + dist * 0.6);
        camera.lookAt(cx, cy, cz);
      }
    } finally {
      framing = false;
    }
  };

  ctx.scheduler.add({
    name: 'combat-render', phase: 'combat', order: 200,
    update(dt: number) {
      renderer.tick(dt);
    },
  });

  const serviceBase: CombatService = {
    start: async (encounterId, opts) => {
      ctx.services.tryGet('world')?.setCombatFill(true);
      try {
        const result = await engine.start(encounterId, opts);
        return result;
      } finally {
        ctx.services.tryGet('world')?.setCombatFill(false);
      }
    },
    isActive: () => engine.isActive(),
    getState: () => engine.getState(),
    submit: (cmd) => engine.submit(cmd),
    previewMove: (unit, to) => engine.previewMove(unit, to),
    previewAttack: (unit, ability, target) => engine.previewAttack(unit, ability, target),
    reachable: (unit) => engine.reachable(unit),
    targets: (unit, ability) => engine.targets(unit, ability),
    cellToWorld: (cell) => engine.cellToWorld(cell),
    on: (event, cb) => engine.on(event, cb),
    serialize: () => engine.serialize(),
    restore: (s) => engine.restore(s),
    stepAi: () => engine.stepAi(),
    runScript: (cmds) => engine.runScript(cmds),
  };
  // round-2 issue 5: `resume` is deliberately NOT part of the `CombatService` interface (core-owned, out of
  // scope here) — it's an extra property on the concrete service object, reached via a cast where needed
  // (e.g. the save module's load path: `restore(s)` resolves once state is applied; a caller that wants the
  // eventual win/lose/fled outcome of a restored mid-combat save then calls `resume()` separately — never
  // `start()` again).
  const service = Object.assign(serviceBase, { resume: () => engine.resume() });

  engine.on('state', () => frameCamera());
  // the engine keeps its last state after 'end' (the UI's result card reads it); the 3D grid, unit
  // figures and floating numbers must not linger into exploration
  engine.on('end', () => renderer.clearAfterEnd());
  ctx.services.register('combat', service);
}
