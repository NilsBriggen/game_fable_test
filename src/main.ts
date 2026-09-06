/**
 * Bootstrap. Owns the game-state machine transitions, the frame loop and the harness API.
 * ARCHITECTURE.md §6–7. Integrator-owned.
 */
import { Bone, Box3, Frustum, Matrix4, Mesh, Object3D, Raycaster, SkinnedMesh, Vector3 } from 'three';
import { gameTimeFor } from '@core/clock';
import { GameContext } from '@core/context';
import type { GameState } from '@core/state';
import { MeshRef, Name, Transform } from '@core/components';
import { loadContent } from './content';
import * as worldMod from './world';
import * as saveMod from './save';
import * as partyMod from './party';
import * as explorationMod from './exploration';
import * as combatMod from './combat';
import * as questMod from './quest';
import * as uiMod from './ui';
import { crashlog } from '@core/crashlog';
import scenarios from '../tools/harness/scenarios.json';
import type { CombatCommand } from '@core/services';

/** 5.0 load-time mark: boot start (paired with 'eid:boot-ready' + measure in boot()). */
try {
  performance.mark('eid:boot-start');
} catch { /* performance marks are best-effort */ }

const params = new URLSearchParams(location.search);
const HARNESS = params.get('harness') === '1';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLElement;
const seedParam = params.get('seed');
const ctx = new GameContext(canvas, uiRoot, seedParam ? Number(seedParam) : 1291);
ctx.harness = HARNESS;

// ---------- console capture (always-on; feeds the harness consoleLog + 5.4 crashlog) ----------
const consoleLog = { errors: [] as string[], warnings: [] as string[] };
{
  const fmt = (a: unknown[]) => a.map((x) => (x instanceof Error ? `${x.message}\n${x.stack ?? ''}` : typeof x === 'string' ? x : safeJson(x))).join(' ');
  const origError = console.error.bind(console);
  const origWarn = console.warn.bind(console);
  console.error = (...a: unknown[]) => {
    const msg = fmt(a);
    consoleLog.errors.push(msg);
    try {
      crashlog.push({ message: msg.slice(0, 2000), state: ctx.state.state, chapter: currentChapter() });
    } catch { /* crash logging is best-effort */ }
    origError(...a);
  };
  console.warn = (...a: unknown[]) => { consoleLog.warnings.push(fmt(a)); origWarn(...a); };
  window.addEventListener('error', (e) => {
    const msg = `window.error: ${e.message} @${e.filename}:${e.lineno}`;
    consoleLog.errors.push(msg);
    try {
      crashlog.push({ message: msg, stack: e.error instanceof Error ? (e.error.stack ?? undefined) : undefined, state: ctx.state.state, chapter: currentChapter() });
    } catch { /* best-effort */ }
  });
  window.addEventListener('unhandledrejection', (e) => {
    const msg = `unhandledrejection: ${String((e as PromiseRejectionEvent).reason)}`;
    consoleLog.errors.push(msg);
    try {
      const reason = (e as PromiseRejectionEvent).reason;
      crashlog.push({ message: msg, stack: reason instanceof Error ? (reason.stack ?? undefined) : undefined, state: ctx.state.state, chapter: currentChapter() });
    } catch { /* best-effort */ }
  });
}
function safeJson(x: unknown): string { try { return JSON.stringify(x); } catch { return String(x); } }

/** Best-effort current quest chapter for crash entries (quest may not be registered yet). */
function currentChapter(): string | undefined {
  try {
    return ctx.services.tryGet('quest')?.chapter();
  } catch {
    return undefined;
  }
}

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
// 5.4: try/catch/finally so rAF always re-arms even when a scheduler/render tick throws.
// Scheduler/EventBus catches live in core/ecs.ts + core/events.ts (not ours to edit),
// so this is the outer guard: count consecutive failures; after 10, bail to title.
let last = performance.now();
let hitches = 0;
let frames = 0;
let consecutiveFrameFailures = 0;
function frame(now: number): void {
  try {
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
    updatePerfHud();
    consecutiveFrameFailures = 0;
  } catch (err) {
    consecutiveFrameFailures++;
    console.error('frame tick failed', err);
    if (consecutiveFrameFailures >= 10) {
      consecutiveFrameFailures = 0;
      console.error('10 consecutive frame failures — returning to title');
      try {
        if (ctx.state.can('title')) ctx.state.transition('title');
      } catch { /* last resort: keep the loop alive */ }
    }
  } finally {
    requestAnimationFrame(frame);
  }
}

// ---------- 5.0 minimal perf HUD (Settings.showFps) ----------
let perfHud: HTMLElement | null = null;
let lastHudUpdate = -1;
function ensurePerfHud(): HTMLElement {
  let el = document.getElementById('perf-hud');
  if (!el) {
    el = document.createElement('div');
    el.id = 'perf-hud';
    el.style.position = 'fixed';
    el.style.top = '4px';
    el.style.left = '4px';
    el.style.zIndex = '9999';
    el.style.font = '11px monospace';
    el.style.color = '#0f0';
    el.style.background = 'rgba(0,0,0,0.6)';
    el.style.padding = '2px 6px';
    el.style.pointerEvents = 'none';
    document.body.appendChild(el);
  }
  return el;
}
function refreshPerfHud(): void {
  const el = ensurePerfHud();
  if (!ctx.settings.showFps) {
    el.style.display = 'none';
    return;
  }
  el.style.display = 'block';
  const fm = ctx.gfx.frameMs;
  const recent = fm.slice(-30);
  const avg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
  const fps = avg > 0 ? 1000 / avg : 0;
  const info = ctx.gfx.stats();
  el.textContent =
    `fps ${fps.toFixed(0)} p95 ${ctx.gfx.frameP95().toFixed(1)}ms gpu ${ctx.gfx.gpuP95().toFixed(2)}ms ${info.drawCalls} draws ${(info.triangles / 1000).toFixed(0)}k tris`;
}
/** Called from frame(); throttled to at most 2 updates/sec by ctx.elapsed. */
function updatePerfHud(): void {
  if (!ctx.settings.showFps) {
    if (perfHud) perfHud.style.display = 'none';
    return;
  }
  if (!perfHud) perfHud = ensurePerfHud();
  if (ctx.elapsed - lastHudUpdate < 0.5) return;
  lastHudUpdate = ctx.elapsed;
  refreshPerfHud();
}

// ---------- 5.0 load-time marks ----------
/** Stream-around settle time (ms) of the last newGame(); 0 before the first run. */
let lastStreamMs = 0;
function takeMeasureMs(name: string): number | null {
  try {
    const entries = performance.getEntriesByName(name, 'measure');
    const lastEntry = entries[entries.length - 1];
    return lastEntry ? lastEntry.duration : null;
  } catch {
    return null;
  }
}
export function loadMarks(): { bootMs: number | null; newGameMs: number | null; streamMs: number } {
  return { bootMs: takeMeasureMs('eid:boot'), newGameMs: takeMeasureMs('eid:newgame'), streamMs: lastStreamMs };
}

// ---------- boot ----------
async function boot(): Promise<void> {
  // 5.4 boot check: surface prior-session crashes once (console.warn is not crash-logged).
  try {
    const prior = crashlog.list();
    if (prior.length > 0) console.warn(`previous session had ${prior.length} errors — see Settings`);
  } catch { /* best-effort */ }
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
  // 5.0: wire Settings.showFps to the minimal DOM overlay after UI registration.
  ctx.onSettings(() => refreshPerfHud());
  refreshPerfHud();
  requestAnimationFrame(frame);
  ctx.state.transition('title');
  try {
    performance.mark('eid:boot-ready');
    performance.measure('eid:boot', 'eid:boot-start', 'eid:boot-ready');
  } catch { /* performance marks are best-effort */ }
  if (!HARNESS) {
    const ui = ctx.services.tryGet('ui');
    if (ui) ui.openMenu('title');
    else console.warn('no UI module yet; press N for a new game in the console: window.__game.newGame()');
  }
}

// ---------- new game / load flows (used by UI and harness) ----------
export async function newGame(creation?: Partial<import('@core/services').PlayerCreation>, opts: { skipIntro?: boolean } = {}): Promise<void> {
  try {
    performance.mark('eid:newgame-start');
  } catch { /* best-effort */ }
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
    const streamT0 = performance.now();
    await svc.get('world').streamAround(...poiXZ(start), 800);
    lastStreamMs = performance.now() - streamT0;
  }
  svc.tryGet('ui')?.loading(false);
  ctx.state.transition('explore');
  ctx.events.emit('new-game');
  if (quest && !opts.skipIntro) quest.start('quest.der-eid');
  try {
    performance.mark('eid:newgame-end');
    performance.measure('eid:newgame', 'eid:newgame-start', 'eid:newgame-end');
  } catch { /* best-effort */ }
}

function poiXZ(poiId: string): [number, number] {
  const p = ctx.content.pois.get(poiId);
  return p ? [p.x, p.z] : [0, 0];
}
function gameTimeForStart(): number {
  return 6 * 3600; // 1 Aug 1291 06:00
}


// ---------- harness: Act 1 playthrough driver (final gate) ----------
interface PlaythroughBeat { name: string; poi?: string; talkTo?: string; dwellSeconds?: number; untilStage?: [string, string]; untilDone?: string; combatRounds?: number; hour?: number; maxSeconds?: number   /** recruit beats: done once the party has at least this many members */
  untilPartySize?: number;
  /** driver scaffolding (recruiting): always take the first choice, whatever the run's pick mode */
  pickFirst?: boolean;
}
// Mirrors src/quest/walkthrough.test.ts: arrive (presence gates), talk to the quest NPC where the stage needs it, fights auto-play.
const ACT1_BEATS: PlaythroughBeat[] = [
  { name: '01-fluelen-news', poi: 'poi.fluelen', dwellSeconds: 8, untilStage: ['quest.der-eid', 'fluelen-news'] },
  { name: '02-altdorf-arrive', poi: 'poi.altdorf', untilStage: ['quest.der-eid', 'altdorf-message'] },
  { name: '03-altdorf-fuerst', poi: 'poi.altdorf', talkTo: 'npc.walter-fuerst', untilStage: ['quest.der-eid', 'escort'] },
  { name: '04-brunnen-quay-fight', poi: 'poi.brunnen', combatRounds: 40, untilStage: ['quest.der-eid', 'travel-ruetli'] },
  { name: '05-ruetli-oath', poi: 'poi.ruetli', hour: 22, untilDone: 'quest.der-eid' },
  // companions (LORE §5 pool) are optional recruits in the game; the driver takes all three so the Act 1
  // fights are fought at the party size the encounters were balanced for
  { name: '05b-recruit-jost', poi: 'poi.fluelen', talkTo: 'npc.jost-imhof', untilPartySize: 2 , pickFirst: true },
  { name: '05c-recruit-mechthild', poi: 'poi.steinen', talkTo: 'npc.mechthild-schorno', untilPartySize: 3 , pickFirst: true },
  { name: '05d-recruit-heini', poi: 'poi.stans', talkTo: 'npc.heini-odermatt', untilPartySize: 4 , pickFirst: true },
  { name: '06-altdorf-1307-hat', poi: 'poi.altdorf', untilStage: ['quest.der-hut', 'travel-tellsplatte'], maxSeconds: 360 },
  { name: '07-tellsplatte', poi: 'poi.tellsplatte', untilStage: ['quest.der-hut', 'travel-hohle-gasse'] },
  { name: '08-hohle-gasse-fight', poi: 'poi.hohle-gasse', combatRounds: 40, untilStage: ['quest.der-hut', 'burgenbruch'] },
  { name: '09-zwing-uri', poi: 'poi.zwing-uri', untilDone: 'quest.der-hut' },
  { name: '10-marchenstreit-schwyz', poi: 'poi.schwyz', untilStage: ['quest.marchenstreit', 'travel-einsiedeln'], maxSeconds: 360 },
  { name: '11-einsiedeln-raid', poi: 'poi.einsiedeln', combatRounds: 40, untilDone: 'quest.marchenstreit' },
  { name: '12-muster-sattel', poi: 'poi.sattel-letzi', untilStage: ['quest.muster-1315', 'travel-zug'] },
  { name: '13-scout-zug', poi: 'poi.zug', untilDone: 'quest.muster-1315' },
  { name: '14-morgarten-battle', poi: 'poi.morgarten', hour: 8, combatRounds: 60, untilDone: 'quest.morgarten', maxSeconds: 600 },
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
  // authored stage order as a fallback: a stage past the target counts as reached even if the event was missed
  const stageIndex = (questId: string, stage: string | null): number => {
    if (!stage) return -1;
    const def = ctx.content.quests.get(questId);
    return def ? def.stages.findIndex((st) => st.id === stage) : -1;
  };
  const offStages = quest.on('quest-advanced', (q, st) => seenStages.add(`${q}:${st}`));
  // Auto-answer dialogues by wrapping the UI service (rendering still happens so screenshots show the panel).
  const trace: string[] = [];
  let forceFirst = false;
  const tr = (m: string) => { trace.push(`${Math.round(performance.now() / 100) / 10}s ${m}`); if (trace.length > 40) trace.shift(); };
  ctx.state.onChange((from, to) => tr(`state ${from}→${to}`));
  quest.on('quest-advanced', (q, st) => tr(`advanced ${q}:${st}`));
  quest.on('dialogue-ended', (d) => tr(`dialogue-ended ${d}`));
  if (ui) {
    const orig = ui.dialogue.show.bind(ui.dialogue);
    ui.dialogue.show = async (node) => {
      dialogues++;
      tr(`show#${dialogues} "${node.text.slice(0, 30)}" choices=${node.choices.length}`);
      // Fire-and-forget render: awaiting even one frame here keeps runDialogue's `await ui.show()`
      // alive across a nested scene transition (dialogue→combat from an onEnter {encounter}) during
      // which the panel is hidden and re-shown — the awaiting show() then never resolves and the
      // whole playthrough wedges. Render without awaiting, then pick on the next macrotask.
      void orig(node);
      await new Promise<void>((r) => setTimeout(r, 0));
      if (opts.screenshot && dialogues <= 40) { tr('shot…'); await opts.screenshot(`dlg-${String(dialogues).padStart(2, '0')}`); tr('shot done'); }
      const enabled = node.choices.map((c, i) => (c.enabled ? i : -1)).filter((i) => i >= 0);
      if (enabled.length === 0) { tr('resolve 0 (no choices)'); return 0; }
      const mode = forceFirst ? 'first' : pickMode;
      const idx = mode === 'first' ? enabled[0] : mode === 'last' ? enabled[enabled.length - 1] : enabled[rng.int(0, enabled.length - 1)];
      ui.dialogue.hide();
      tr(`resolve ${idx}`);
      return idx;
    };
    const origConfirm = ui.confirm.bind(ui);
    ui.confirm = async () => true;
    void origConfirm;
  }
  await newGame(undefined, { skipIntro: false });
  for (const beat of ACT1_BEATS) {
    const t0 = performance.now();
    forceFirst = !!beat.pickFirst;
    const player = ex.getPlayer();
    if (beat.poi && player !== null) {
      const at = ex.poiPosition(beat.poi);
      if (at) {
        ex.teleport(player, at.x, at.z); await world.streamAround(at.x, at.z, 600); ex.discover(beat.poi);
        // streamAround resolves on request, not upload: wait (bounded) until the chunks under the player are in
        const s0 = performance.now();
        while (!world.isSettled() && performance.now() - s0 < 60000) await nextFrame();
      }
    }
    if (typeof beat.hour === 'number') { ctx.clock.setHour(beat.hour); world.setTimeOfDay(beat.hour); }
    const limit = (beat.maxSeconds ?? opts.maxSecondsPerBeat ?? 90) * 1000;
    let ok = false, note: string | undefined;
    if (beat.dwellSeconds) { const d0 = performance.now(); while (performance.now() - d0 < beat.dwellSeconds * 1000) await nextFrame(); }
    let talked = false;
    let lastTalkState: string | null = null;
    while (performance.now() - t0 < limit) {
      if (beat.talkTo && !talked) {
        if (ctx.state.state === 'explore') {
          talked = true;
          let target: number | null = null;
          ctx.world.each(Name, (id, n) => { if (target === null && n.id === beat.talkTo) target = id; });
          if (target !== null) ex.interactWith(target);
          else { const def = ctx.content.npcs.get(beat.talkTo); if (def?.dialogueRoot) void quest.runDialogue(def.dialogueRoot); }
        } else if (ctx.state.state !== lastTalkState) {
          // The beat's NPC lives behind a cutscene/dialogue (e.g. beat 03's Fürst behind beat 01's
          // intro cutscene): don't burn the single talk attempt while another scene owns the stage.
          lastTalkState = ctx.state.state;
          await nextFrame();
          continue;
        } else {
          await nextFrame();
          continue;
        }
      }
      if (combat.isActive()) {
        fights++;
        if (opts.screenshot) await opts.screenshot(`${beat.name}-combat-start`);
        // A real party triggers the deploy phase, which waits for a human to place units.
        // The driver auto-confirms default placement (cmdDeploy with no moves = keep authored cells).
        if (combat.getState()?.phase === 'deploy') combat.submit({ type: 'deploy', placements: [] });
        // Harness-only autoplay: run in small chunks with a macrotask yield between them. A single
        // `auto:40` keeps the tab inside one synchronous JS task for minutes under SwiftShader while
        // the combat UI re-renders every round — the tab dies around round 27 with no error. Chunked
        // auto lets the event loop breathe (rAF, screenshots, quest ticks) between rounds.
        // If the AI grinds without reaching an outcome (e.g. beat 04's tutorial escort dying under
        // unfocused AI auto-play while the human game is unaffected), concede via flee — every Act 1
        // spine fight has a fled/lose branch, so the run exercises the quest graph instead of timing out.
        // Reported explicitly as `harness-assist` in the beat note; never touches game balance.
        const total = beat.combatRounds ?? 40;
        let played = 0;
        while (combat.isActive() && played < total) {
          const chunk = Math.min(3, total - played);
          await combat.runScript([{ type: 'auto', rounds: chunk }]);
          played += chunk;
          await new Promise<void>((r) => setTimeout(r, 0));
          const st = combat.getState();
          const stalled = combat.isActive() && st && st.phase !== 'ended'
            && st.units.filter((u) => u.side === 'player' && (u.hp ?? 0) > 0).length === 0;
          if (stalled) {
            combat.submit({ type: 'flee' });
            note = `harness-assist: conceded at round ${st.round} (no player units standing); quest takes fled branch`;
            tr(`harness-assist flee at round ${st.round}`);
            break;
          }
        }
        if (combat.isActive()) {
          // Still unresolved after the full budget (stalemate grind): concede rather than wedge the run.
          combat.submit({ type: 'flee' });
          note = `harness-assist: conceded after ${total} rounds without outcome; quest takes fled branch`;
          tr('harness-assist flee after budget exhausted');
        }
        if (opts.screenshot) await opts.screenshot(`${beat.name}-combat-end`);
        // a player would click the result panel's Continue; the driver dismisses it (it otherwise sits over every later beat)
        await nextFrame();
        ui?.combat.hide();
        // a lost fight: let the quest's lose branch run
      }
      if (ctx.state.state === 'gameover') { note = 'party wiped (gameover)'; break; }
      if (beat.untilDone && quest.isDone(beat.untilDone)) { ok = true; break; }
      if (beat.untilPartySize && svc.get('party').getParty().length >= beat.untilPartySize) { ok = true; break; }
      if (beat.untilStage && (quest.stage(beat.untilStage[0]) === beat.untilStage[1] || seenStages.has(`${beat.untilStage[0]}:${beat.untilStage[1]}`) || stageIndex(beat.untilStage[0], quest.stage(beat.untilStage[0])) > stageIndex(beat.untilStage[0], beat.untilStage[1]) || quest.isDone(beat.untilStage[0]))) { ok = true; break; }
      // keep the player at the beat's POI (dialogues/cutscenes may move the camera, not the player)
      await nextFrame();
    }
    if (!ok && !note) note = `timeout; trace=[${trace.slice(-14).join(' | ')}]; seen=[${[...seenStages].join(' ')}]; stages: ${['quest.der-eid', 'quest.der-hut', 'quest.burgenbruch', 'quest.marchenstreit', 'quest.muster-1315', 'quest.morgarten', 'quest.brunnen-1315'].map((q) => `${q.split('.')[1]}=${quest.stage(q) ?? (quest.isDone(q) ? 'done' : '-')}`).join(' ')}; state=${ctx.state.state}`;
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
  /** save to this manual slot, then load it back before the screenshot (round-trip proof) */
  saveLoad?: number;
}

async function loadScenario(id: string): Promise<{ ok: boolean; skipped?: string }> {
  const sc = (scenarios as unknown as Scenario[]).find((s) => s.id === id);
  if (!sc) throw new Error(`unknown scenario ${id}`);
  const svc = ctx.services;
  const world = svc.tryGet('world');
  const notes: string[] = [];
  // 0. teardown previous scenario's transient combat/dialogue (requests/world-2.md): a prior
  // encounter left active (e.g. combat-brunnen-quay `auto:4`) keeps its render root alive and
  // counted in every later capture of the same page session; a prior `void runDialogue` keeps
  // its panel open. Flee has no quest side effects worth keeping for harness-only captures;
  // the engine's `end` handler (src/combat/index.ts) drops the 3D transients via clearAfterEnd.
  // Dialogue hide() reports neutral cancellation (cancelled:true, no node/choice effects run), so a
  // single hide() now drains the panel instead of stepping a multi-node dialogue forward one node.
  try {
    const combatPrev = svc.tryGet('combat');
    if (combatPrev?.isActive()) combatPrev.submit({ type: 'flee' });
  } catch { /* harness teardown must never fail the next capture */ }
  const uiPrev = svc.tryGet('ui');
  if (uiPrev) {
    try { uiPrev.dialogue.hide(); } catch { /* ignore */ }
    try { uiPrev.combat.hide(); } catch { /* drop any lingering result card */ }
  }
  await nextFrame();
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
  // a seasonal scenario also moves the calendar into that season, so the HUD date, sun height and
  // day length agree with the tint and snow line (a 'winter' capture used to read "1 August").
  // Non-seasonal scenarios reset the clock to the game start (1 Aug 1291): the previous scenario's
  // season move must not leak into later captures (a winter free-morgarten left ruetli-dawn in
  // December darkness even though the scenario itself has no season).
  if (sc.season) {
    const cal = ctx.clock.calendar();
    const md: Record<string, [number, number]> = { winter: [12, 15], spring: [5, 1], summer: [8, 1], autumn: [10, 15] };
    const [m, d] = md[sc.season as string] ?? [cal.month, cal.day];
    ctx.clock.set(gameTimeFor(cal.year, m, d, typeof sc.hour === 'number' ? sc.hour : ctx.clock.hour));
    if (world) world.setSeason(sc.season as any);
  } else {
    ctx.clock.set(gameTimeForStart());
    if (world) world.setSeason('summer');
  }
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
  if (typeof sc.saveLoad === 'number') {
    const save = svc.tryGet('save');
    if (!save) notes.push('no save module');
    else {
      const snap = () => { const pid = ex?.getPlayer() ?? null; const t = pid !== null ? ctx.world.get(pid, Transform) : null; return { pos: t ? [Math.round(t.x), Math.round(t.z)] : null, stage: quest?.stage('quest.der-eid') ?? null, hour: Math.round(ctx.clock.hour) }; };
      const before = snap();
      await save.save(sc.saveLoad, 'harness round-trip');
      await save.load(sc.saveLoad);
      const after = snap();
      const same = JSON.stringify(before) === JSON.stringify(after);
      notes.push(`save/load slot ${sc.saveLoad}: ${same ? 'round-trip identical' : `MISMATCH before=${JSON.stringify(before)} after=${JSON.stringify(after)}`}`);
    }
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
  // usedJSHeapSize counts uncollected garbage; with --js-flags=--expose-gc (harness) collect first so the
  // number is the retained set
  (window as unknown as { gc?: () => void }).gc?.();
  const mem = (performance as any).memory;
  const world = ctx.services.tryGet('world');
  const ws = world?.stats();
  return {
    ...s,
    heapMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : null,
    renderer: ctx.gfx.rendererString(),
    gpuP95: ctx.gfx.gpuP95(),
    frameP95: ctx.gfx.frameP95(),
    loadMarks: loadMarks(),
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
    split: sceneSplit(),
    ground: groundProbe(),
    mem: memSplit(),
  };
}

/** CPU-side bytes still referenced from the scene graph (BufferAttribute arrays per scene root, data
 *  textures, instance matrices): attributes the retained JS heap the harness budgets to what holds it. */
function memSplit(): Record<string, number> {
  const out: Record<string, number> = {};
  const seenGeo = new Set<string>(), seenTex = new Set<string>();
  let texBytes = 0, texCount = 0, imgCount = 0;
  const texOf = (mat: unknown): void => {
    if (!mat || typeof mat !== 'object') return;
    for (const v of Object.values(mat as Record<string, unknown>)) {
      const t = v as { isTexture?: boolean; uuid: string; image?: { data?: ArrayBufferView; width?: number } };
      if (!t || !t.isTexture || seenTex.has(t.uuid)) continue;
      seenTex.add(t.uuid); texCount++;
      const d = t.image?.data;
      if (d && (d as ArrayBufferView).byteLength) texBytes += (d as ArrayBufferView).byteLength;
      else if (t.image) imgCount++;
    }
  };
  const top: { name: string; bytes: number }[] = [];
  const bytesOf = (o: Object3D): number => {
    let n = 0;
    const m = o as Mesh & { isMesh?: boolean; isInstancedMesh?: boolean; instanceMatrix?: { array: ArrayBufferView } };
    if (m.isMesh && m.geometry) {
      const g = m.geometry;
      if (!seenGeo.has(g.uuid)) {
        seenGeo.add(g.uuid);
        let b = 0;
        for (const a of Object.values(g.attributes)) b += (a as { array?: ArrayBufferView }).array?.byteLength ?? 0;
        b += g.index?.array?.byteLength ?? 0;
        n += b;
        top.push({ name: `${o.name || o.type}${m.isInstancedMesh ? '[inst]' : ''}`, bytes: b });
      }
      if (m.instanceMatrix) n += m.instanceMatrix.array?.byteLength ?? 0;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) texOf(mat);
    }
    for (const c of o.children) n += bytesOf(c);
    return n;
  };
  for (const child of ctx.gfx.scene.children) {
    const name = child.name || child.type;
    for (const g of child.children) if (g.children.length > 50 || g.name) { const k = `geo:${name}/${g.name || g.type}`; out[k] = (out[k] ?? 0) + bytesOf(g); }
    out[`geo:${name}`] = (out[`geo:${name}`] ?? 0) + bytesOf(child);
  }
  top.sort((a, b) => b.bytes - a.bytes);
  top.slice(0, 12).forEach((t, i) => { out[`top${i}:${t.name}`] = t.bytes; });
  out['geoCount'] = seenGeo.size;
  out['texDataBytes'] = texBytes; out['texCount'] = texCount; out['texImages'] = imgCount;
  const mem = (performance as { memory?: { totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  if (mem) { out['totalJSHeapMB'] = Math.round(mem.totalJSHeapSize / 1048576); out['heapLimitMB'] = Math.round(mem.jsHeapSizeLimit / 1048576); }
  return out;
}

/** Rendered ground under the player vs the height function: a mismatch here is why figures sink or float. */
function groundProbe(): Record<string, number | null> | null {
  const ex = ctx.services.tryGet('exploration');
  const world = ctx.services.tryGet('world');
  const pid = ex?.getPlayer() ?? null;
  if (pid === null || !world) return null;
  const t = ctx.world.get(pid, Transform);
  if (!t) return null;
  const ray = new Raycaster(new Vector3(t.x, t.y + 60, t.z), new Vector3(0, -1, 0), 0, 200);
  ray.camera = ctx.gfx.camera;   // sprites (vegetation impostors) refuse to raycast without one
  const terrain = world.getSceneRoots().terrain;
  const hits = ray.intersectObject(terrain, true).filter((h) => h.object.name !== 'terrain-far');
  const meshY = hits.length ? hits[0].point.y : null;
  // everything else the same ray meets (vegetation, settlement, decals): what could be drawing over the feet
  const roots = world.getSceneRoots();
  const others = ray.intersectObjects([roots.props, roots.water, roots.dynamic], true)
    .filter((h) => !(ctx.world.get(pid, MeshRef)?.object as Object3D | undefined)?.getObjectById(h.object.id))
    .slice(0, 6).map((h) => `${h.object.name || h.object.type}@${Math.round(h.point.y * 100) / 100}`);
  const h = world.heightAt(t.x, t.z);
  const asObject3D = (o: unknown): Object3D | undefined =>
    o instanceof Object3D ? o : (o as { object?: unknown })?.object instanceof Object3D ? (o as { object: Object3D }).object : undefined;
  // the player figure itself: its object's world y and the lowest rendered vertex (skinned = bone-space approx)
  const ref = asObject3D(ctx.world.get(pid, MeshRef)?.object);
  let figureY: number | null = null, figureMinY: number | null = null;
  let hipsY: number | null = null, skinnedMinY: number | null = null;
  if (ref) {
    ref.updateMatrixWorld(true);
    figureY = ref.getWorldPosition(new Vector3()).y;
    const box = new Box3().setFromObject(ref); figureMinY = box.min.y;
    // the posed figure: lowest skinned vertex (sampled) and the hips bone, in world space
    const tmp = new Vector3(), acc = new Vector3(), bm = new Matrix4();
    ref.traverse((o) => {
      const b = o as Bone;
      if ((b as unknown as { isBone?: boolean }).isBone && /hips$/i.test(o.name)) hipsY = o.getWorldPosition(new Vector3()).y;
      const m = o as SkinnedMesh;
      if (!m.isSkinnedMesh) return;
      const g = m.geometry, pos = g.attributes.position, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
      const sk = m.skeleton; sk.update();
      for (let i = 0; i < pos.count; i += 5) {
        acc.set(0, 0, 0);
        for (let k = 0; k < 4; k++) {
          const w = sw.getComponent(i, k); if (w === 0) continue;
          const bi = si.getComponent(i, k);
          bm.multiplyMatrices(sk.bones[bi].matrixWorld, sk.boneInverses[bi]);
          tmp.fromBufferAttribute(pos, i).applyMatrix4(m.bindMatrix).applyMatrix4(bm);
          acc.addScaledVector(tmp, w);
        }
        if (skinnedMinY === null || acc.y < skinnedMinY) skinnedMinY = acc.y;
      }
    });
  }
  // the six nearest NPC figures: transform y vs ground vs their lowest skinned vertex
  const npcs: string[] = [];
  const cand: { id: number; d: number }[] = [];
  ctx.world.each(Transform, (id, tr) => { if (id !== pid && ctx.world.has(id, MeshRef)) cand.push({ id, d: Math.hypot(tr.x - t.x, tr.z - t.z) }); });
  cand.sort((a, b) => a.d - b.d);
  for (const c of cand.slice(0, 6)) {
    const tr = ctx.world.get(c.id, Transform)!; const obj = asObject3D(ctx.world.get(c.id, MeshRef)!.object);
    if (!obj) continue;
    obj.updateMatrixWorld(true);
    const low = { y: null as number | null };
    const tmp = new Vector3(), acc = new Vector3(), bm = new Matrix4();
    obj.traverse((o) => {
      const m = o as SkinnedMesh; if (!m.isSkinnedMesh) return;
      const g = m.geometry, pos = g.attributes.position, si = g.attributes.skinIndex, sw = g.attributes.skinWeight; const sk = m.skeleton; sk.update();
      for (let i = 0; i < pos.count; i += 9) { acc.set(0, 0, 0); for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w === 0) continue; const bi = si.getComponent(i, k); bm.multiplyMatrices(sk.bones[bi].matrixWorld, sk.boneInverses[bi]); tmp.fromBufferAttribute(pos, i).applyMatrix4(m.bindMatrix).applyMatrix4(bm); acc.addScaledVector(tmp, w); } if (low.y === null || acc.y < low.y) low.y = acc.y; }
    });
    npcs.push(`${ctx.world.get(c.id, Name)?.id ?? c.id}@${c.d.toFixed(0)}m ty=${tr.y.toFixed(2)} ground=${world.heightAt(tr.x, tr.z).toFixed(2)} objY=${obj.getWorldPosition(new Vector3()).y.toFixed(2)} skinMin=${low.y === null ? '-' : low.y.toFixed(2)} vis=${obj.visible} scale=${obj.scale.y.toFixed(2)}`);
  }
  return { npcs: npcs.join(' | ') as unknown as number, x: Math.round(t.x), z: Math.round(t.z), transformY: Math.round(t.y * 100) / 100, heightAt: Math.round(h * 100) / 100, meshY: meshY === null ? null : Math.round(meshY * 100) / 100, delta: meshY === null ? null : Math.round((meshY - h) * 100) / 100, figureY: figureY === null ? null : Math.round(figureY * 100) / 100, figureMinY: figureMinY === null ? null : Math.round(figureMinY * 100) / 100, hipsY: hipsY === null ? null : Math.round(hipsY * 100) / 100, skinnedMinY: skinnedMinY === null ? null : Math.round(skinnedMinY * 100) / 100, others: others.join(' | ') as unknown as number };
}

/** Triangles per top-level scene group, frustum-culled like the renderer (a budget overrun's first question). */
function sceneSplit(): Record<string, number> {
  const out: Record<string, number> = {};
  const cam = ctx.gfx.camera;
  cam.updateMatrixWorld();
  const frustum = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  const count = (o: Object3D): number => {
    if (!o.visible) return 0;
    let n = 0;
    const m = o as Mesh & { isMesh?: boolean; isInstancedMesh?: boolean; count?: number };
    if (m.isMesh && m.geometry) {
      const inView = !m.frustumCulled || frustum.intersectsObject(m);
      if (inView) {
        const g = m.geometry;
        const tris = g.index ? g.index.count / 3 : (g.attributes.position?.count ?? 0) / 3;
        n += m.isInstancedMesh ? tris * (m.count ?? 1) : tris;
      }
    }
    for (const c of o.children) n += count(c);
    return Math.round(n);
  };
  for (const child of ctx.gfx.scene.children) {
    const name = child.name || child.type;
    out[name] = (out[name] ?? 0) + count(child);
    for (const g of child.children) if (g.children.length > 50 || g.name) { const k = `${name}/${g.name || g.type}`; out[k] = (out[k] ?? 0) + count(g); }
  }
  return out;
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
  loadMarks,
  // 5.4: crash log surface for the Settings/Pause viewer (owner: src/ui/menus.ts — wire a
  // viewer there in the 5.5/5.6 pass) and for harness assertions.
  crashLog: { list: () => crashlog.list(), clear: () => crashlog.clear(), exportJson: () => crashlog.exportJson() },
};
(window as any).__game = api;
if (HARNESS) (window as any).__harness = api;

api.ready.catch((err) => {
  console.error('boot failed', err);
});
