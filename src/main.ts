/**
 * Bootstrap. Owns the game-state machine transitions, the frame loop and the harness API.
 * ARCHITECTURE.md §6–7. Integrator-owned.
 */
import { GameContext } from '@core/context';
import type { GameState } from '@core/state';
import { Name } from '@core/components';
import { loadContent } from './content';
import * as worldMod from './world';
import * as saveMod from './save';
import * as partyMod from './party';
import * as explorationMod from './exploration';
import * as combatMod from './combat';
import * as questMod from './quest';
import * as uiMod from './ui';
import scenarios from '../tools/harness/scenarios.json';
import type { CombatCommand } from '@core/services';

const params = new URLSearchParams(location.search);
const HARNESS = params.get('harness') === '1';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLElement;
const seedParam = params.get('seed');
const ctx = new GameContext(canvas, uiRoot, seedParam ? Number(seedParam) : 1291);
ctx.harness = HARNESS;

// ---------- console capture (harness) ----------
const consoleLog = { errors: [] as string[], warnings: [] as string[] };
if (HARNESS) {
  const fmt = (a: unknown[]) => a.map((x) => (x instanceof Error ? `${x.message}\n${x.stack ?? ''}` : typeof x === 'string' ? x : safeJson(x))).join(' ');
  const origError = console.error.bind(console);
  const origWarn = console.warn.bind(console);
  console.error = (...a: unknown[]) => { consoleLog.errors.push(fmt(a)); origError(...a); };
  console.warn = (...a: unknown[]) => { consoleLog.warnings.push(fmt(a)); origWarn(...a); };
  window.addEventListener('error', (e) => consoleLog.errors.push(`window.error: ${e.message} @${e.filename}:${e.lineno}`));
  window.addEventListener('unhandledrejection', (e) => consoleLog.errors.push(`unhandledrejection: ${String((e as PromiseRejectionEvent).reason)}`));
}
function safeJson(x: unknown): string { try { return JSON.stringify(x); } catch { return String(x); } }

// ---------- state transitions ----------
ctx.events.on('request-state', (to) => {
  ctx.state.transition(to as GameState);
});
ctx.state.onChange((from, to) => {
  ctx.events.emit('state-changed', from, to);
  const ex = ctx.services.tryGet('exploration');
  ex?.setControlEnabled(to === 'explore');
  ctx.clock.paused = !(to === 'explore' || to === 'cutscene');
  const ui = ctx.services.tryGet('ui');
  ui?.showHud(to === 'explore');
});

// ---------- frame loop ----------
let last = performance.now();
let hitches = 0;
let frames = 0;
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  ctx.elapsed += dt;
  const s = ctx.state.state;
  if (s === 'explore' || s === 'combat' || s === 'dialogue' || s === 'cutscene') ctx.playtimeSec += dt;
  ctx.clock.tick(dt);
  ctx.scheduler.run('always', dt);
  ctx.scheduler.run(s === 'combat' ? 'combat' : 'explore', dt);
  ctx.gfx.render();
  frames++;
  const fm = ctx.gfx.frameMs;
  if (fm.length && fm[fm.length - 1] > 16.7 && s !== 'loading' && s !== 'boot') hitches++;
  requestAnimationFrame(frame);
}

// ---------- boot ----------
async function boot(): Promise<void> {
  loadContent(ctx.content);
  const problems = ctx.content.validate();
  for (const p of problems) console.warn(`[content] ${p}`);
  // Module registration order = dependency order.
  await worldMod.register(ctx);
  await saveMod.register(ctx);
  await partyMod.register(ctx);
  await explorationMod.register(ctx);
  await combatMod.register(ctx);
  await questMod.register(ctx);
  await uiMod.register(ctx);
  requestAnimationFrame(frame);
  ctx.state.transition('title');
  if (!HARNESS) {
    const ui = ctx.services.tryGet('ui');
    if (ui) ui.openMenu('title');
    else console.warn('no UI module yet; press N for a new game in the console: window.__game.newGame()');
  }
}

// ---------- new game / load flows (used by UI and harness) ----------
export async function newGame(creation?: Partial<import('@core/services').PlayerCreation>, opts: { skipIntro?: boolean } = {}): Promise<void> {
  const svc = ctx.services;
  ctx.state.transition('loading');
  svc.tryGet('ui')?.loading(true, 'The valleys of the Reuss, August 1291');
  ctx.resetWorld();
  ctx.reseed(ctx.seed);
  ctx.clock.set(gameTimeForStart());
  const party = svc.tryGet('party');
  const ex = svc.tryGet('exploration');
  const quest = svc.tryGet('quest');
  let playerId: number | null = null;
  if (party) {
    playerId = party.createPlayer({
      givenName: creation?.givenName ?? 'Kuoni', familyName: creation?.familyName ?? 'Imhof', origin: creation?.origin ?? 'uri',
      attributes: creation?.attributes ?? { strength: 12, agility: 12, endurance: 12, wits: 10, presence: 10 },
      background: creation?.background ?? 'saeumer',
    });
  }
  const chapter = 'prologue-1291';
  if (quest) await quest.setChapter(chapter);
  if (ex) {
    ex.populate(chapter);
    const start = 'poi.fluelen';
    if (playerId !== null) ex.teleport(playerId, ...poiXZ(start));
    else ex.spawnPlayer(start);
    await svc.get('world').streamAround(...poiXZ(start), 800);
  }
  svc.tryGet('ui')?.loading(false);
  ctx.state.transition('explore');
  ctx.events.emit('new-game');
  if (quest && !opts.skipIntro) quest.start('quest.der-eid');
}

function poiXZ(poiId: string): [number, number] {
  const p = ctx.content.pois.get(poiId);
  return p ? [p.x, p.z] : [0, 0];
}
function gameTimeForStart(): number {
  return 6 * 3600; // 1 Aug 1291 06:00
}


// ---------- harness: Act 1 playthrough driver (final gate) ----------
interface PlaythroughBeat { name: string; poi?: string; talkTo?: string; dwellSeconds?: number; untilStage?: [string, string]; untilDone?: string; combatRounds?: number; hour?: number; maxSeconds?: number }
// Mirrors src/quest/walkthrough.test.ts: arrive (presence gates), talk to the quest NPC where the stage needs it, fights auto-play.
const ACT1_BEATS: PlaythroughBeat[] = [
  { name: '01-fluelen-news', poi: 'poi.fluelen', dwellSeconds: 8, untilStage: ['quest.der-eid', 'fluelen-news'] },
  { name: '02-altdorf-arrive', poi: 'poi.altdorf', untilStage: ['quest.der-eid', 'altdorf-message'] },
  { name: '03-altdorf-fuerst', poi: 'poi.altdorf', talkTo: 'npc.walter-fuerst', untilStage: ['quest.der-eid', 'escort'] },
  { name: '04-brunnen-quay-fight', poi: 'poi.brunnen', combatRounds: 40, untilStage: ['quest.der-eid', 'travel-ruetli'] },
  { name: '05-ruetli-oath', poi: 'poi.ruetli', hour: 22, untilDone: 'quest.der-eid' },
  { name: '06-altdorf-1307-hat', poi: 'poi.altdorf', untilStage: ['quest.der-hut', 'travel-tellsplatte'] },
  { name: '07-tellsplatte', poi: 'poi.tellsplatte', untilStage: ['quest.der-hut', 'travel-hohle-gasse'] },
  { name: '08-hohle-gasse-fight', poi: 'poi.hohle-gasse', combatRounds: 40, untilStage: ['quest.der-hut', 'burgenbruch'] },
  { name: '09-zwing-uri', poi: 'poi.zwing-uri', untilDone: 'quest.der-hut' },
  { name: '10-marchenstreit-schwyz', poi: 'poi.schwyz', untilStage: ['quest.marchenstreit', 'travel-einsiedeln'] },
  { name: '11-einsiedeln-raid', poi: 'poi.einsiedeln', combatRounds: 40, untilDone: 'quest.marchenstreit' },
  { name: '12-muster-sattel', poi: 'poi.sattel-letzi', untilStage: ['quest.muster-1315', 'travel-zug'] },
  { name: '13-scout-zug', poi: 'poi.zug', untilDone: 'quest.muster-1315' },
  { name: '14-morgarten-battle', poi: 'poi.morgarten', hour: 8, combatRounds: 60, untilDone: 'quest.morgarten' },
  { name: '15-brunnen-pact', poi: 'poi.brunnen', untilDone: 'quest.brunnen-1315' },
];

/** Drives Act 1 headlessly: auto-picks dialogue choices, auto-plays fights, teleports between beats. Returns a log per beat. */
async function runAct1Playthrough(opts: { pick?: 'first' | 'last' | 'random'; screenshot?: (name: string) => Promise<void>; maxSecondsPerBeat?: number } = {}) {
  const svc = ctx.services;
  const quest = svc.get('quest'), ex = svc.get('exploration'), combat = svc.get('combat'), world = svc.get('world');
  const ui = svc.tryGet('ui');
  const pickMode = opts.pick ?? 'first';
  const rng = ctx.rng.ambient;
  const log: { beat: string; ok: boolean; seconds: number; stage: string | null; note?: string; dialogues: number; fights: number }[] = [];
  let dialogues = 0, fights = 0;
  // A beat's target stage can be entered and left inside one awaited fight (escort → quay fight → travel-ruetli),
  // so "reached" means seen at any point since the beat began, not "is the current stage".
  const seenStages = new Set<string>();
  const offStages = quest.on('quest-advanced', (q, st) => seenStages.add(`${q}:${st}`));
  // Auto-answer dialogues by wrapping the UI service (rendering still happens so screenshots show the panel).
  if (ui) {
    const orig = ui.dialogue.show.bind(ui.dialogue);
    ui.dialogue.show = async (node) => {
      dialogues++;
      void orig(node); // render, but do not wait for a click
      await nextFrame(); await nextFrame();
      if (opts.screenshot && dialogues <= 40) await opts.screenshot(`dlg-${String(dialogues).padStart(2, '0')}`);
      const enabled = node.choices.map((c, i) => (c.enabled ? i : -1)).filter((i) => i >= 0);
      if (enabled.length === 0) return 0;
      const idx = pickMode === 'first' ? enabled[0] : pickMode === 'last' ? enabled[enabled.length - 1] : enabled[rng.int(0, enabled.length - 1)];
      ui.dialogue.hide();
      return idx;
    };
    const origConfirm = ui.confirm.bind(ui);
    ui.confirm = async () => true;
    void origConfirm;
  }
  await newGame(undefined, { skipIntro: false });
  for (const beat of ACT1_BEATS) {
    const t0 = performance.now();
    const player = ex.getPlayer();
    if (beat.poi && player !== null) {
      const at = ex.poiPosition(beat.poi);
      if (at) { ex.teleport(player, at.x, at.z); await world.streamAround(at.x, at.z, 600); ex.discover(beat.poi); }
    }
    if (typeof beat.hour === 'number') { ctx.clock.setHour(beat.hour); world.setTimeOfDay(beat.hour); }
    const limit = (beat.maxSeconds ?? opts.maxSecondsPerBeat ?? 90) * 1000;
    let ok = false, note: string | undefined;
    if (beat.dwellSeconds) { const d0 = performance.now(); while (performance.now() - d0 < beat.dwellSeconds * 1000) await nextFrame(); }
    let talked = false;
    while (performance.now() - t0 < limit) {
      if (beat.talkTo && !talked && ctx.state.state === 'explore') {
        talked = true;
        let target: number | null = null;
        ctx.world.each(Name, (id, n) => { if (target === null && n.id === beat.talkTo) target = id; });
        if (target !== null) ex.interactWith(target);
        else { const def = ctx.content.npcs.get(beat.talkTo); if (def?.dialogueRoot) void quest.runDialogue(def.dialogueRoot); }
      }
      if (combat.isActive()) {
        fights++;
        if (opts.screenshot) await opts.screenshot(`${beat.name}-combat-start`);
        await combat.runScript([{ type: 'auto', rounds: beat.combatRounds ?? 40 }]);
        if (opts.screenshot) await opts.screenshot(`${beat.name}-combat-end`);
        // a lost fight: let the quest's lose branch run
      }
      if (ctx.state.state === 'gameover') { note = 'party wiped (gameover)'; break; }
      if (beat.untilDone && quest.isDone(beat.untilDone)) { ok = true; break; }
      if (beat.untilStage && (quest.stage(beat.untilStage[0]) === beat.untilStage[1] || seenStages.has(`${beat.untilStage[0]}:${beat.untilStage[1]}`) || quest.isDone(beat.untilStage[0]))) { ok = true; break; }
      // keep the player at the beat's POI (dialogues/cutscenes may move the camera, not the player)
      await nextFrame();
    }
    if (!ok && !note) note = `timeout; stages: ${['quest.der-eid', 'quest.der-hut', 'quest.burgenbruch', 'quest.marchenstreit', 'quest.muster-1315', 'quest.morgarten', 'quest.brunnen-1315'].map((q) => `${q.split('.')[1]}=${quest.stage(q) ?? (quest.isDone(q) ? 'done' : '-')}`).join(' ')}; state=${ctx.state.state}`;
    if (opts.screenshot) await opts.screenshot(beat.name);
    log.push({ beat: beat.name, ok, seconds: Math.round((performance.now() - t0) / 100) / 10, stage: beat.untilStage ? quest.stage(beat.untilStage[0]) : null, note, dialogues, fights });
    if (!ok) break;
  }
  offStages();
  return { log, chapter: quest.chapter(), reputation: ['uri', 'schwyz', 'unterwalden', 'habsburg', 'einsiedeln'].map((f) => [f, quest.reputation(f)]), party: svc.get('party').getParty().length, journal: quest.journal().length };
}

// ---------- harness API ----------
interface Scenario {
  id: string; description: string; state: 'title' | 'explore';
  hour?: number; weather?: string; season?: string; chapter?: string; flags?: Record<string, unknown>;
  spawnAt?: string | { x: number; z: number }; yaw?: number;
  camera?: 'follow' | { pos: number[]; lookAt: number[] };
  flyover?: { pos: number[]; lookAt: number[] }[];
  encounter?: string; ambush?: 'player' | 'enemy'; combatScript?: string | CombatCommand[]; waitPlayerTurn?: boolean;
  dialogue?: string; menu?: string; freshGame?: boolean;
}

async function loadScenario(id: string): Promise<{ ok: boolean; skipped?: string }> {
  const sc = (scenarios as unknown as Scenario[]).find((s) => s.id === id);
  if (!sc) throw new Error(`unknown scenario ${id}`);
  const svc = ctx.services;
  const world = svc.tryGet('world');
  const notes: string[] = [];
  // 1. game state
  if (sc.state === 'title') {
    ctx.state.transition('title');
    svc.tryGet('ui')?.openMenu('title');
  } else {
    if (!svc.has('party') || !svc.has('exploration')) {
      // Wave-1 fallback: free camera over the world only.
      notes.push('no party/exploration module: free-camera only');
    } else if (ctx.state.state === 'title' || ctx.state.state === 'boot' || sc.freshGame) {
      await newGame(undefined, { skipIntro: true });
    }
    svc.tryGet('ui')?.closeMenu();
    if (ctx.state.state !== 'explore' && ctx.state.can('explore')) ctx.state.transition('explore');
  }
  // 2. chapter / flags
  const quest = svc.tryGet('quest');
  if (sc.chapter && quest) await quest.setChapter(sc.chapter);
  if (sc.flags && quest) for (const [k, v] of Object.entries(sc.flags)) quest.setFlag(k, v);
  // 3. time & weather
  if (typeof sc.hour === 'number') { ctx.clock.setHour(sc.hour); world?.setTimeOfDay(sc.hour); }
  if (sc.weather && world) world.setWeather(sc.weather as any);
  if (sc.season && world) world.setSeason(sc.season as any);
  // 4. player position
  const ex = svc.tryGet('exploration');
  if (sc.spawnAt && ex) {
    const player = ex.getPlayer();
    const at = typeof sc.spawnAt === 'string' ? ex.poiPosition(sc.spawnAt) ?? { x: 0, z: 0 } : sc.spawnAt;
    if (player !== null) ex.teleport(player, at.x, at.z, sc.yaw ?? 0);
    else ex.spawnPlayer(at, sc.yaw ?? 0);
    await world?.streamAround(at.x, at.z, 800);
  }
  // 5. camera
  if (sc.camera && sc.camera !== 'follow') {
    const pos = sc.camera.pos as [number, number, number];
    const la = sc.camera.lookAt as [number, number, number];
    const rig = ex?.getCameraRig();
    if (rig) { rig.setMode('free'); rig.setFree(pos, la); }
    else { ctx.gfx.camera.position.set(...pos); ctx.gfx.camera.lookAt(...la); }
    await world?.streamAround(pos[0], pos[2], 800);
  } else if (ex) {
    ex.getCameraRig().setMode('follow');
  }
  // 6. encounters / dialogue / menus
  if (sc.encounter) {
    const combat = svc.tryGet('combat');
    if (!combat) notes.push('no combat module');
    else {
      void combat.start(sc.encounter, { ambush: sc.ambush });
      await waitFor(() => combat.getState() !== null, 10000);
      if (sc.combatScript) {
        const script: CombatCommand[] = typeof sc.combatScript === 'string'
          ? [{ type: 'auto', rounds: Number(sc.combatScript.split(':')[1] ?? 1) }]
          : sc.combatScript;
        await combat.runScript(script);
      }
      if (sc.waitPlayerTurn) {
        // step the AI until a player-controlled unit is active (so the screenshot shows the player's HUD)
        for (let i = 0; i < 60; i++) {
          const st = combat.getState();
          const active = st?.units.find((u) => u.id === st.activeUnit);
          if (!st || st.phase === 'ended' || (active && active.isPlayerControlled)) break;
          combat.stepAi();
          await nextFrame();
        }
      }
    }
  }
  if (sc.dialogue) {
    if (!quest) notes.push('no quest module');
    else void quest.runDialogue(sc.dialogue);
  }
  if (sc.menu) {
    const ui = svc.tryGet('ui');
    if (!ui) notes.push('no ui module');
    else ui.openMenu(sc.menu as any);
  }
  if (sc.flyover) {
    const rig = ex?.getCameraRig();
    rig?.setMode('free');
    const setCam = (pos: [number, number, number], la: [number, number, number]) => {
      if (rig) rig.setFree(pos, la);
      else { ctx.gfx.camera.position.set(...pos); ctx.gfx.camera.lookAt(...la); }
    };
    const path = sc.flyover;
    const start = hitches;
    const t0 = performance.now();
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      const steps = 90;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const pos = a.pos.map((v, k) => v + (b.pos[k] - v) * t) as [number, number, number];
        const la = a.lookAt.map((v, k) => v + (b.lookAt[k] - v) * t) as [number, number, number];
        setCam(pos, la);
        await nextFrame();
      }
    }
    (window as any).__flyoverHitches = hitches - start;
    (window as any).__flyoverMs = performance.now() - t0;
  }
  return { ok: true, skipped: notes.length ? notes.join('; ') : undefined };
}

function nextFrame(): Promise<void> { return new Promise((r) => requestAnimationFrame(() => r())); }
async function waitFor(pred: () => boolean, timeoutMs: number): Promise<boolean> {
  const t0 = performance.now();
  while (!pred()) {
    if (performance.now() - t0 > timeoutMs) return false;
    await nextFrame();
  }
  return true;
}

async function screenshotReady(): Promise<void> {
  const world = ctx.services.tryGet('world');
  await waitFor(() => (world ? world.isSettled() : true), 20000);
  for (let i = 0; i < 30; i++) await nextFrame();
  ctx.gfx.frameMs.length = 0;
  hitches = 0;
  for (let i = 0; i < 120; i++) await nextFrame();
}

function stats() {
  const s = ctx.gfx.stats();
  const mem = (performance as any).memory;
  const world = ctx.services.tryGet('world');
  const ws = world?.stats();
  return {
    ...s,
    heapMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : null,
    renderer: ctx.gfx.rendererString(),
    entities: ctx.world.count(),
    chunksLoaded: ws?.chunksLoaded ?? 0,
    chunksPending: ws?.chunksPending ?? 0,
    instances: ws?.instances ?? 0,
    hitches,
    frames,
    state: ctx.state.state,
    flyoverHitches: (window as any).__flyoverHitches ?? null,
    systems: ctx.scheduler.list(),
    content: ctx.content.counts(),
    viewport: [window.innerWidth, window.innerHeight],
  };
}

const api = {
  ready: boot(),
  ctx,
  newGame,
  loadScenario,
  screenshotReady,
  stats,
  console: consoleLog,
  setCamera: (pos: [number, number, number], lookAt: [number, number, number]) => {
    const rig = ctx.services.tryGet('exploration')?.getCameraRig();
    if (rig) { rig.setMode('free'); rig.setFree(pos, lookAt); }
    else { ctx.gfx.camera.position.set(...pos); ctx.gfx.camera.lookAt(...lookAt); }
  },
  setTime: (h: number) => { ctx.clock.setHour(h); ctx.services.tryGet('world')?.setTimeOfDay(h); },
  setWeather: (w: string) => ctx.services.tryGet('world')?.setWeather(w as any),
  state: () => ctx.state.state,
  scenarios: (scenarios as unknown as Scenario[]).map((s) => s.id),
  runCombatScript: async (cmds: CombatCommand[]) => ctx.services.get('combat').runScript(cmds),
  runAct1Playthrough,
};
(window as any).__game = api;
if (HARNESS) (window as any).__harness = api;

api.ready.catch((err) => {
  console.error('boot failed', err);
});
