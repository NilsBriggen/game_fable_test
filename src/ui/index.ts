/**
 * UI module entry point. ARCHITECTURE.md §4 (UiService), §5.8. DOM overlay in `ctx.uiRoot`; every screen
 * lives under src/ui/**. Vanilla TS, no framework, per BUILDER_RULES.md.
 */
import type { GameContext } from '@core/context';
import type { CombatCommand, HudState, MenuId, UiService } from '@core/services';
import { el, clear } from './dom';
import { createHud, createLoading, showConfirm } from './hud';
import { createDialogueUi } from './dialogueUi';
import { createCutsceneUi } from './cutsceneUi';
import { createCombatUi } from './combatUi';
import { renderMenu, type MenuApi } from './menus';

export async function register(ctx: GameContext): Promise<void> {
  const mount = ctx.uiRoot;
  clear(mount);

  const hud = createHud(ctx, mount);
  const dialogueUi = createDialogueUi(mount, () => currentMenu !== null);
  const cutsceneUi = createCutsceneUi(mount);
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
    if (wasFromPause && ctx.state.state === 'paused') {
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

  // ---------------- combat wiring: drive combatUi from CombatService's own event stream ----------------
  // "Wiring" (task spec): poll combat.getState() via combat.on('state')/on('event'); combatUi's own
  // show/update/hide are also exposed on UiService for any external caller, but nothing else in this
  // build calls them (src/combat/index.ts only renders the 3D scene) — so we subscribe ourselves here.
  const combat = ctx.services.tryGet('combat');
  if (combat) {
    let shown = false;
    combat.on('state', (view) => {
      if (!view) { if (shown) { shown = false; combatUi.hide(); } return; }
      if (!shown) { shown = true; combatUi.show(view); } else { combatUi.update(view); }
    });
    combat.on('end', () => { shown = false; combatUi.hideAfterResult(); });
  }

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
      else if (['explore', 'combat', 'dialogue', 'cutscene', 'gameover'].includes(ctx.state.state)) openMenu('pause');
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
  ctx.state.onChange((_from, to) => {
    if (to === 'gameover') {
      clear(gameOverRoot);
      gameOverRoot.style.display = '';
      gameOverRoot.appendChild(el('div', { class: 'eid-panel' }, [
        el('h2', {}, ['The field is lost']),
        el('div', { style: 'margin:6px 0 14px' }, ['Your company lies in the mud. The chroniclers will not record their names.']),
        el('div', { style: 'display:flex;gap:8px;justify-content:center' }, [
          el('button', { class: 'eid-btn primary', onclick: () => { gameOverRoot.style.display = 'none'; openMenu('load'); } }, ['Load']),
          el('button', { class: 'eid-btn', onclick: () => { gameOverRoot.style.display = 'none'; openMenu('title'); } }, ['Title']),
        ]),
      ]));
    } else if (gameOverRoot.style.display !== 'none') {
      gameOverRoot.style.display = 'none';
    }
    if (to === 'title' && currentMenu !== 'title') openMenu('title');
    if (to === 'creation' && currentMenu !== 'creation') openMenu('creation');
    if (to === 'explore' && (currentMenu === 'title' || currentMenu === 'creation')) closeMenu();
  });
}

// Combat command type re-exported so combatUi's callers (none yet outside this module) share the type
// without importing @core/services directly in every file.
export type { CombatCommand };
