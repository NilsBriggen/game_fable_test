/**
 * HUD chrome that is not a "menu": health/morale/fatigue bars, compass strip, date/region, interaction
 * prompt, quest tracker (polls `quest.activeQuests()` at 2 Hz per the task spec), toasts, the loading
 * overlay and the quick confirm dialog. ARCHITECTURE.md §5.8.
 */
import type { GameContext } from '@core/context';
import type { HudState } from '@core/services';
import { el, clear } from './dom';
import { poiIcon, ICONS } from './icons';
import { compassCardinals, compassX, pct } from './helpers';

const QUEST_POLL_MS = 500; // 2 Hz

export interface HudHandle {
  root: HTMLElement;
  setVisible(on: boolean): void;
  update(state: HudState): void;
  toast(msg: string, kind?: 'info' | 'quest' | 'skill' | 'warning'): void;
  prompt(text: string | null): void;
  dispose(): void;
}

export function createHud(ctx: GameContext, mount: HTMLElement): HudHandle {
  const root = el('div', { id: 'hud-root', class: 'hidden eid-passthrough' });

  // health / morale / fatigue
  const hpFill = el('div', { class: 'hud-bar-fill hp' });
  const hpNum = el('div', { class: 'hud-bar-num' });
  const moraleFill = el('div', { class: 'hud-bar-fill morale' });
  const moraleNum = el('div', { class: 'hud-bar-num' });
  const fatigueFill = el('div', { class: 'hud-bar-fill fatigue' });
  const fatigueNum = el('div', { class: 'hud-bar-num' });
  const bars = el('div', { class: 'hud-bars' }, [
    el('div', { class: 'hud-bar-row' }, [el('span', { class: 'hud-bar-icon', html: ICONS.heart }), el('div', { class: 'hud-bar-track' }, [hpFill, hpNum])]),
    el('div', { class: 'hud-bar-row' }, [el('span', { class: 'hud-bar-icon', html: ICONS.shieldPip }), el('div', { class: 'hud-bar-track' }, [moraleFill, moraleNum])]),
    el('div', { class: 'hud-bar-row' }, [el('span', { class: 'hud-bar-icon', html: ICONS.boot }), el('div', { class: 'hud-bar-track' }, [fatigueFill, fatigueNum])]),
  ]);

  // compass
  const compassMask = el('div', { class: 'hud-compass-mask' });
  const compass = el('div', { class: 'hud-compass' }, [el('div', { class: 'hud-compass-track' }, [compassMask])]);

  // date/time/region
  const dateEl = el('div', { class: 'date' });
  const regionEl = el('div', { class: 'region' });
  const datetime = el('div', { class: 'hud-datetime' }, [dateEl, regionEl]);

  // quest tracker
  const questTitle = el('div', { class: 'title' });
  const questObj = el('div', { class: 'obj' });
  const questTracker = el('div', { class: 'hud-quest', style: 'display:none' }, [questTitle, questObj]);

  // interaction prompt
  const promptEl = el('div', { class: 'hud-prompt eid-panel', style: 'display:none' });

  // toasts
  const toastRoot = el('div', { class: 'hud-toasts' });

  root.append(bars, compass, datetime, questTracker, promptEl, toastRoot);
  mount.appendChild(root);

  function setVisible(on: boolean): void {
    root.classList.toggle('hidden', !on);
  }

  function update(state: HudState): void {
    hpFill.style.width = `${pct(state.hp, state.hpMax)}%`;
    hpNum.textContent = `${Math.round(state.hp)}/${state.hpMax}`;
    moraleFill.style.width = `${pct(state.morale, state.moraleMax)}%`;
    moraleNum.textContent = `${Math.round(state.morale)}/${state.moraleMax}`;
    fatigueFill.style.width = `${Math.max(0, Math.min(100, state.fatigue))}%`;
    fatigueNum.textContent = `${Math.round(state.fatigue)}`;

    dateEl.textContent = state.time;
    regionEl.textContent = state.region;

    clear(compassMask);
    for (const c of compassCardinals(state.compass.yaw, 180)) {
      compassMask.appendChild(el('div', { class: 'hud-compass-letter', style: `left:${c.x * 100}%` }, [c.letter]));
    }
    for (const m of state.compass.markers) {
      const x = compassX(m.bearing, state.compass.yaw, 180);
      if (x === null) continue;
      const showDist = m.discovered && m.distance < 500;
      compassMask.appendChild(el('div', { class: `hud-compass-marker${m.discovered ? '' : ' undiscovered'}`, style: `left:${x * 100}%` }, [
        el('span', { class: 'ic', html: m.discovered ? poiIcon(m.kind as any, 14) : ICONS.compassRing }),
        showDist ? el('span', {}, [`${Math.round(m.distance)} m`]) : null,
      ]));
    }

    if (state.quest) {
      questTracker.style.display = '';
      questTitle.textContent = state.quest.title;
      questObj.textContent = state.quest.objective;
    }

    if (state.prompt) {
      promptEl.style.display = '';
      const [, key, ...rest] = /^\[(.)\]\s*(.*)$/.exec(state.prompt) ?? [null, null, state.prompt];
      clear(promptEl);
      if (key) promptEl.appendChild(el('kbd', {}, [key]));
      promptEl.appendChild(document.createTextNode(rest.join('') || state.prompt));
    } else {
      promptEl.style.display = 'none';
    }
  }

  function toast(msg: string, kind: 'info' | 'quest' | 'skill' | 'warning' = 'info'): void {
    const node = el('div', { class: `hud-toast ${kind}` }, [msg]);
    toastRoot.appendChild(node);
    setTimeout(() => node.remove(), kind === 'warning' ? 5000 : 4000);
    while (toastRoot.children.length > 6) toastRoot.removeChild(toastRoot.firstChild!);
  }

  function prompt(text: string | null): void {
    if (!text) { promptEl.style.display = 'none'; return; }
    promptEl.style.display = '';
    const m = /^\[(.)\]\s*(.*)$/.exec(text);
    clear(promptEl);
    if (m) { promptEl.appendChild(el('kbd', {}, [m[1]])); promptEl.appendChild(document.createTextNode(m[2])); }
    else promptEl.textContent = text;
  }

  // quest tracker also polled independently at 2 Hz (spec) so it stays live even between updateHud() calls
  const questInterval = window.setInterval(() => {
    const quest = ctx.services.tryGet('quest');
    if (!quest) return;
    const active = quest.activeQuests()[0];
    if (active) {
      questTracker.style.display = '';
      questTitle.textContent = active.title;
      questObj.textContent = active.objective;
    } else {
      questTracker.style.display = 'none';
    }
  }, QUEST_POLL_MS);

  function dispose(): void {
    window.clearInterval(questInterval);
    root.remove();
  }

  return { root, setVisible, update, toast, prompt, dispose };
}

// ---------------- loading overlay ----------------

export interface LoadingHandle { set(on: boolean, text?: string): void }

export function createLoading(mount: HTMLElement): LoadingHandle {
  const textEl = el('div', { class: 'loading-text' }, ['Loading…']);
  const root = el('div', { id: 'loading-root', class: 'hidden' }, [textEl, el('div', { class: 'loading-rule' })]);
  mount.appendChild(root);
  return {
    set(on, text) {
      root.classList.toggle('hidden', !on);
      if (text) textEl.textContent = text;
    },
  };
}

// ---------------- confirm dialog ----------------

export function showConfirm(mount: HTMLElement, text: string, ok = 'Confirm', cancel = 'Cancel'): Promise<boolean> {
  return new Promise((resolve) => {
    const wrap = el('div', { class: 'eid-modal-wrap' });
    const finish = (v: boolean) => { wrap.remove(); resolve(v); };
    const panel = el('div', { class: 'eid-panel confirm-modal' }, [
      el('div', { class: 'q' }, [text]),
      el('div', { class: 'row' }, [
        el('button', { class: 'eid-btn', onclick: () => finish(false) }, [cancel]),
        el('button', { class: 'eid-btn primary', onclick: () => finish(true) }, [ok]),
      ]),
    ]);
    wrap.appendChild(panel);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) finish(false); });
    mount.appendChild(wrap);
  });
}
