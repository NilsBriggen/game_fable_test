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

  // A6 perf: update() runs every frame — only touch the DOM when values actually changed.
  // Shared with the 2 Hz quest poll below so the two writers never fight (writes are skipped
  // when the shared cache already matches).
  const last: {
    hpW: string | null; hpT: string | null; moraleW: string | null; moraleT: string | null;
    fatigueW: string | null; fatigueT: string | null;
    time: string | null; region: string | null; prompt: string | null;
    questTitle: string | null; questObj: string | null; questShown: boolean;
    compassKey: string | null;
  } = {
    hpW: null, hpT: null, moraleW: null, moraleT: null, fatigueW: null, fatigueT: null,
    time: null, region: null, prompt: null,
    questTitle: null, questObj: null, questShown: false, compassKey: null,
  };

  function setWidth(elm: HTMLElement, key: 'hpW' | 'moraleW' | 'fatigueW', value: string): void {
    if (value !== last[key]) { elm.style.width = value; last[key] = value; }
  }
  function setText(elm: HTMLElement, key: 'hpT' | 'moraleT' | 'fatigueT' | 'time' | 'region' | 'questTitle' | 'questObj', value: string): void {
    if (value !== last[key]) { elm.textContent = value; last[key] = value; }
  }

  /** Show/update the tracker only when the model differs; hide only when it was shown. */
  function syncQuest(title: string | null, objective: string | null): void {
    if (title !== null && objective !== null) {
      if (!last.questShown) { questTracker.style.display = ''; last.questShown = true; }
      setText(questTitle, 'questTitle', title);
      setText(questObj, 'questObj', objective);
    } else if (last.questShown) {
      questTracker.style.display = 'none';
      last.questShown = false;
      last.questTitle = null;
      last.questObj = null;
    }
  }

  function compassKeyOf(yaw: number, markers: { bearing: number; kind: string; label: string; distance: number; discovered: boolean }[]): string {
    const parts = [yaw.toFixed(4)];
    for (const m of markers) parts.push(`${m.bearing.toFixed(3)}|${m.kind}|${Math.round(m.distance)}|${m.discovered ? 1 : 0}|${m.label}`);
    return parts.join(';');
  }

  function update(state: HudState): void {
    setWidth(hpFill, 'hpW', `${pct(state.hp, state.hpMax)}%`);
    setText(hpNum, 'hpT', `${Math.round(state.hp)}/${state.hpMax}`);
    setWidth(moraleFill, 'moraleW', `${pct(state.morale, state.moraleMax)}%`);
    setText(moraleNum, 'moraleT', `${Math.round(state.morale)}/${state.moraleMax}`);
    setWidth(fatigueFill, 'fatigueW', `${Math.max(0, Math.min(100, state.fatigue))}%`);
    setText(fatigueNum, 'fatigueT', `${Math.round(state.fatigue)}`);

    setText(dateEl, 'time', state.time);
    setText(regionEl, 'region', state.region);

    const ck = compassKeyOf(state.compass.yaw, state.compass.markers);
    if (ck !== last.compassKey) {
      last.compassKey = ck;
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
    }

    if (state.quest) syncQuest(state.quest.title, state.quest.objective);

    const rawPrompt = state.prompt ?? '';
    if (rawPrompt !== last.prompt) {
      last.prompt = rawPrompt;
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
  }

  function toast(msg: string, kind: 'info' | 'quest' | 'skill' | 'warning' = 'info'): void {
    const node = el('div', { class: `hud-toast ${kind}` }, [msg]);
    toastRoot.appendChild(node);
    setTimeout(() => node.remove(), kind === 'warning' ? 5000 : 4000);
    while (toastRoot.children.length > 6) toastRoot.removeChild(toastRoot.firstChild!);
  }

  function prompt(text: string | null): void {
    const raw = text ?? '';
    if (raw === last.prompt) return; // update() already shows the same state
    last.prompt = raw;
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
    if (active) syncQuest(active.title, active.objective);
    else syncQuest(null, null);
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
