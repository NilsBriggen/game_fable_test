/**
 * UI module entry point. ARCHITECTURE.md §4 (UiService), §5.8. DOM overlay in `ctx.uiRoot`; every screen
 * lives under src/ui/**. Vanilla TS, no framework, per BUILDER_RULES.md.
 */
import type { GameContext } from '@core/context';
import { Transform } from '@core/components';
import type { CombatCommand, HudState, MenuId, UiService } from '@core/services';
import { el, clear } from './dom';
import { createHud, createLoading, showConfirm } from './hud';
import { createDialogueUi } from './dialogueUi';
import { createCutsceneUi } from './cutsceneUi';
import { createCombatUi } from './combatUi';
import { createAudio } from './audio';
import { renderMenu, applyUiSettingsSideEffects, type MenuApi } from './menus';

export async function register(ctx: GameContext): Promise<void> {
  const mount = ctx.uiRoot;
  clear(mount);

  // ---------------- audio (engine + file upgrades: voices §1.7, Flow music §2.2) ----------------
  // Created before the service object below: quest.setMusic drives service.audio, and the quest
  // module looks the UI service up lazily — but the combat/ambience wiring further down must use
  // this same instance.
  const audio = createAudio();
  audio.setVolume(ctx.settings.masterVolume);
  audio.setVoicesEnabled(ctx.settings.voicesEnabled);
  ctx.onSettings((s) => { audio.setVolume(s.masterVolume); audio.setVoicesEnabled(s.voicesEnabled); });
  // Voice sink shared by dialogue + cutscene overlays: slug convention matches the fetcher
  // (lowercase, non-alnum → '-'); missing file / disabled = silent, text remains.
  // Voice locales are en + de only: gsw text falls back to the High German voice files.
  const voiceSink = {
    play: (id: string) => {
      const lang = ctx.settings.language === 'gsw' ? 'de' : ctx.settings.language;
      audio.playVoice(lang, id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''));
    },
    stop: () => { audio.stopVoice(); },
  };

  const hud = createHud(ctx, mount);
  const dialogueUi = createDialogueUi(mount, () => currentMenu !== null, voiceSink);
  const cutsceneUi = createCutsceneUi(mount, voiceSink);
  const combatUi = createCombatUi(ctx, mount);
  const loading = createLoading(mount);
  const menuRoot = el('div', { id: 'menu-root' });
  mount.appendChild(menuRoot);

  let currentMenu: MenuId | null = null;
  let openedFromPause = false;

  const menuApi: MenuApi = {
    ctx,
    root: menuRoot,
    openMenu: (m, d) => openMenu(m, d),
    closeMenu: () => closeMenu(),
    closeAll: () => { clear(menuRoot); openedFromPause = false; currentMenu = null; },
  };

  function openMenu(menu: MenuId, data?: unknown): void {
    openedFromPause = currentMenu === 'pause' && menu !== 'pause';
    clear(menuRoot);
    currentMenu = menu;
    // `title` and `creation` are both MenuIds *and* real GameStates (boot -> title -> creation -> explore,
    // ARCHITECTURE.md §4) — opening either requests the matching state transition. Every other menu is a
    // pause-over-something-else: request `paused` whenever we're currently in a live/pausable state and
    // not already paused.
    if (menu === 'title') {
      if (ctx.state.state !== 'title') ctx.events.emit('request-state', 'title');
    } else if (menu === 'creation') {
      if (ctx.state.state !== 'creation') ctx.events.emit('request-state', 'creation');
    } else if (ctx.state.state !== 'paused' && ctx.state.can('paused')) {
      ctx.events.emit('request-state', 'paused');
    }
    renderMenu(menuApi, menu, data);
  }

  function closeMenu(): void {
    clear(menuRoot);
    const wasFromPause = openedFromPause;
    openedFromPause = false;
    currentMenu = null;
    if (ctx.state.state === 'gameover') {
      showGameOver();
    } else if (wasFromPause && ctx.state.state === 'paused') {
      openMenu('pause');
    } else if (ctx.state.state === 'paused') {
      // Standard case (task spec): resume whatever `openMenu` paused.
      ctx.events.emit('request-state', ctx.state.prev);
    } else if (ctx.state.state === 'title') {
      // A sub-menu opened straight from the title state (Load/Settings from the title screen — these
      // never request `paused`, ctx.state.can('paused') is false there) closes back to the title screen
      // itself rather than leaving a blank frame; the title state has no "gameplay" to resume to.
      openMenu('title');
    } else if (ctx.state.state === 'creation') {
      openMenu('creation');
    }
  }

  // ---------------- audio (engine + file upgrades: voices §1.7, Flow music §2.2) ----------------
  // Created before the service object below: quest.setMusic drives service.audio, and the quest
  // module looks the UI service up lazily — but the combat/ambience wiring further down must use
  // this same instance. (voiceSink lives with the overlay construction above.)

  const service: UiService = {
    showHud(on: boolean): void {
      hud.setVisible(on);
    },
    updateHud(state: HudState): void {
      hud.update(state);
    },
    toast(msg, kind) {
      hud.toast(msg, kind);
    },
    openMenu(menu, data) {
      openMenu(menu, data);
    },
    closeMenu() {
      closeMenu();
    },
    currentMenu() {
      return currentMenu;
    },
    dialogue: dialogueUi,
    combat: combatUi,
    cutscene: cutsceneUi,
    audio,
    prompt(text) {
      hud.prompt(text);
    },
    loading(on, text) {
      loading.set(on, text);
    },
    confirm(text, ok, cancel) {
      return showConfirm(mount, text, ok, cancel);
    },
  };
  ctx.services.register('ui', service);

  // ---------------- audio wiring (unlock, clicks, ambience, combat) ----------------
  // Autoplay-safe: create/resume the context on the first real user gesture.
  const unlockAudio = (): void => {
    audio.unlock();
    window.removeEventListener('pointerdown', unlockAudio);
    window.removeEventListener('keydown', unlockAudio);
  };
  window.addEventListener('pointerdown', unlockAudio);
  window.addEventListener('keydown', unlockAudio);
  // UI feedback: click on button presses; combat damage thuds via the combat event stream.
  // (Single delegated listener on mount — menuRoot lives inside mount, so one is enough.)
  mount.addEventListener('click', (e) => {
    if ((e.target as HTMLElement | null)?.closest('button')) audio.click();
  });
  // Region ambience follows the game state: title air, explore by nearest POI kind, combat beds.
  // polled cheaply (0.5 s) — region/POI lookups are map gets, no allocation beyond the closure.
  const regionAmbience = window.setInterval(() => {
    try {
      const st = ctx.state.state;
      if (st === 'title' || st === 'creation' || st === 'boot') { audio.setAmbience('none'); return; }
      if (st === 'combat') return; // combat wiring below owns the bed during fights
      const ex = ctx.services.tryGet('exploration');
      const pid = ex?.getPlayer() ?? null;
      if (pid === null) { audio.setAmbience('none'); return; }
      const t = ctx.world.get(pid, Transform);
      const poi = t ? ex?.nearestPoi(t.x, t.z) : null;
      const kind = poi?.kind;
      if (kind === 'port' || kind === 'landmark' || poi?.id === 'poi.ruetli') audio.setAmbience('lake');
      else if (kind === 'monastery' || kind === 'church') audio.setAmbience('church');
      else if (kind === 'alp' || kind === 'wall' || kind === 'battlefield') audio.setAmbience('mountain');
      else audio.setAmbience('village');
    } catch { /* ambience must never break the frame */ }
  }, 500);
  void regionAmbience;

  // ---------------- combat wiring: drive combatUi from CombatService's own event stream ----------------
  // "Wiring" (task spec): poll combat.getState() via combat.on('state')/on('event'); combatUi's own
  // show/update/hide are also exposed on UiService for any external caller, but nothing else in this
  // build calls them (src/combat/index.ts only renders the 3D scene) — so we subscribe ourselves here.
  const combat = ctx.services.tryGet('combat');
  if (combat) {
    let shown = false;
    combat.on('state', (view) => {
      if (!view) { if (shown) { shown = false; combatUi.hide(); } return; }
      if (!shown) { shown = true; combatUi.show(view); void audio.playMusicTrack('battle'); } else { combatUi.update(view); }
    });
    combat.on('end', () => { shown = false; combatUi.hideAfterResult(); audio.stopMusic(); });
    // 3.4 audio: procedural hit thud + clash on presented combat damage/attacks, twang on shots,
    // fanfare/lament on the result card (rest/travel stay silent).
    combat.on('event', (rec) => {
      if (rec.kind === 'damage') {
        const amount = typeof rec.data?.amount === 'number' ? (rec.data.amount as number) : 0;
        if (amount > 0) audio.hit();
        else audio.clash(); // blocked/parried attacks still ring
      } else if (rec.kind === 'attack') {
        const weapon = String((rec.data as { weapon?: unknown } | undefined)?.weapon ?? '');
        if (/bow|crossbow|bolzen/i.test(weapon)) audio.twang();
        else audio.clash();
      } else if (rec.kind === 'end') {
        const outcome = (rec.data as { outcome?: string } | undefined)?.outcome;
        if (outcome === 'win') { audio.fanfare(); }
        else if (outcome === 'lose') { audio.lament(); }
      }
    });
  }
  // 3.4: quest fanfare/lament on completion/failure (the combat result card already covers fights).
  // Quest events live on the quest service's own bus (QuestEvents), not the global GameEvents bus.
  // The committed one-shot stingers layer over the procedural fanfare/lament (both play when files
  // exist; procedural alone when they don't — never silence-by-error).
  const quest = ctx.services.tryGet('quest');
  quest?.on('quest-completed', () => { audio.playStinger('quest-done'); audio.fanfare(); });
  quest?.on('quest-failed', () => { audio.playStinger('quest-fail'); audio.lament(); });

  // ---------------- keyboard ----------------
  function isTyping(): boolean {
    const t = document.activeElement as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }
  function toggleMenu(menu: MenuId): void {
    if (currentMenu === menu) closeMenu();
    else openMenu(menu);
  }
  window.addEventListener('keydown', (e) => {
    if (isTyping()) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (currentMenu) closeMenu();
      else if (['explore', 'combat', 'dialogue', 'cutscene'].includes(ctx.state.state)) openMenu('pause'); // not over the game-over screen (bughunt ui #2)
      return;
    }
    // Combat's own hotkeys (1-9, Space) are handled inside combatUi; menus only over live play.
    if (!['explore', 'dialogue', 'cutscene', 'paused'].includes(ctx.state.state)) return;
    if (e.key === 'Tab') { e.preventDefault(); toggleMenu('character'); return; }
    if (e.key === 'i' || e.key === 'I') { toggleMenu('inventory'); return; }
    if (e.key === 'j' || e.key === 'J') { toggleMenu('journal'); return; }
    if (e.key === 'm' || e.key === 'M') { toggleMenu('map'); return; }
  });

  // Boot into the title menu on the 'title' game state (main.ts also calls openMenu('title') directly
  // outside the harness; this covers state re-entry, e.g. Pause -> Title).
  const gameOverRoot = el('div', { class: 'gameover-root', style: 'display:none' });
  mount.appendChild(gameOverRoot);
  function showGameOver(): void {
    clear(gameOverRoot);
    gameOverRoot.style.display = '';
    gameOverRoot.appendChild(el('div', { class: 'eid-panel' }, [
      el('h2', {}, ['The field is lost']),
      el('div', { style: 'margin:6px 0 14px' }, ['Your company lies in the mud. The chroniclers will not record their names.']),
      el('div', { style: 'display:flex;gap:8px;justify-content:center' }, [
        el('button', { class: 'eid-btn primary', onclick: () => { gameOverRoot.style.display = 'none'; openMenu('load'); } }, ['Load']),
        el('button', { class: 'eid-btn', onclick: () => { gameOverRoot.style.display = 'none'; menuApi.closeAll(); openMenu('title'); } }, ['Title']),
      ]),
    ]));
  }
  ctx.state.onChange((_from, to) => {
    if (to === 'gameover') showGameOver();
    else if (gameOverRoot.style.display !== 'none') gameOverRoot.style.display = 'none';
    if (to === 'title' && currentMenu !== 'title') openMenu('title');
    if (to === 'creation' && currentMenu !== 'creation') openMenu('creation');
    if (to === 'explore' && (currentMenu === 'title' || currentMenu === 'creation')) closeMenu();
  });
}

// Combat command type re-exported so combatUi's callers (none yet outside this module) share the type
// without importing @core/services directly in every file.
export type { CombatCommand };
