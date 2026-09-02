/**
 * Dialogue panel: portrait, speaker name, typewriter text (skippable), numbered choices with skill-check
 * odds and letterbox. Implements `UiService['dialogue']` — `show()` resolves with the chosen index once
 * `quest/dialogue.ts` awaits it. ARCHITECTURE.md §5.6/§5.8.
 */
import type { DialogueNodeView } from '@core/services';
import { el, clear } from './dom';
import { formatCheckOdds } from './helpers';
import { portraitSvg } from './icons';

const TYPE_MS_PER_CHAR = 16;

export interface DialogueUi {
  show(node: DialogueNodeView): Promise<number>;
  hide(): void;
}

export function createDialogueUi(mount: HTMLElement, menuOpen: () => boolean = () => false): DialogueUi {
  const letterTop = el('div', { class: 'dlg-letterbox top', style: 'height:0' });
  const letterBottom = el('div', { class: 'dlg-letterbox bottom', style: 'height:0' });
  const panelRoot = el('div', { id: 'dialogue-root' });
  panelRoot.hidden = true;
  mount.append(letterTop, letterBottom, panelRoot);

  let typeTimer: number | null = null;
  let resolveCurrent: ((i: number) => void) | null = null;
  let cleanupCurrent: (() => void) | null = null;

  function letterbox(on: boolean): void {
    letterTop.style.height = on ? '12vh' : '0';
    letterBottom.style.height = on ? '12vh' : '0';
  }

  function stopTyping(): void {
    if (typeTimer !== null) { window.clearInterval(typeTimer); typeTimer = null; }
  }

  function show(node: DialogueNodeView): Promise<number> {
    stopTyping();
    if (cleanupCurrent) { cleanupCurrent(); cleanupCurrent = null; }
    if (resolveCurrent) { resolveCurrent(0); resolveCurrent = null; }
    return new Promise((resolve) => {
      resolveCurrent = resolve;
      letterbox(true);
      panelRoot.hidden = false;
      clear(panelRoot);

      const portrait = el('div', { class: 'dlg-portrait', html: portraitSvg(node.speakerPortrait ?? node.speakerName, '#6b1f24', 64) });
      const textEl = el('div', { class: 'dlg-text' }, [el('span', { class: 'typed' }), el('span', { class: 'cursor' }, ['▌'])]);
      const choicesEl = el('div', { class: 'dlg-choices' });
      const skipHint = el('div', { class: 'dlg-skip' }, ['click / Enter to continue']);

      const panel = el('div', { class: 'eid-panel dlg-panel', style: 'position:relative' }, [
        node.speakerName ? portrait : null,
        el('div', { class: 'dlg-body' }, [
          node.speakerName ? el('div', { class: 'dlg-speaker' }, [node.speakerName]) : null,
          textEl,
          choicesEl,
        ]),
        skipHint,
      ]);
      panelRoot.appendChild(panel);

      const typedSpan = textEl.querySelector('.typed') as HTMLSpanElement;
      const cursorSpan = textEl.querySelector('.cursor') as HTMLSpanElement;
      let i = 0;
      let finished = false;

      function finishType(): void {
        stopTyping();
        typedSpan.textContent = node.text;
        cursorSpan.style.visibility = 'hidden';
        finished = true;
        skipHint.style.display = 'none';
        renderChoices();
      }

      function renderChoices(): void {
        clear(choicesEl);
        node.choices.forEach((c, idx) => {
          const row = el('div', { class: `dlg-choice${c.enabled ? '' : ' disabled'}`, onclick: () => pick(idx) }, [
            el('span', { class: 'num' }, [`${idx + 1}`]),
            el('span', {}, [c.text]),
            typeof c.checkOdds === 'number'
              ? el('span', { class: 'odds' }, [formatCheckOdds(c.hint ?? 'Check', c.checkOdds)])
              : c.hint ? el('span', { class: 'hint' }, [`(${c.hint})`]) : null,
          ]);
          choicesEl.appendChild(row);
        });
        if (node.choices.length === 0) {
          choicesEl.appendChild(el('div', { class: 'dlg-choice', onclick: () => pick(0) }, [el('span', { class: 'num' }, ['↵']), el('span', {}, ['Continue'])]));
        }
      }

      function pick(idx: number): void {
        if (!finished) { finishType(); return; }
        const choice = node.choices[idx];
        if (node.choices.length > 0 && (!choice || !choice.enabled)) return;
        cleanup();
        resolveCurrent = null;
        resolve(idx);
      }

      const keyHandler = (e: KeyboardEvent) => {
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
        if (menuOpen()) return; // a pause menu over the conversation owns the keyboard
        if (e.key >= '1' && e.key <= '9') { pick(Number(e.key) - 1); return; }
        if (e.key === 'Enter' || e.key === ' ') { pick(0); }
      };
      window.addEventListener('keydown', keyHandler);
      const clickAdvance = () => { if (!finished) finishType(); };
      textEl.addEventListener('click', clickAdvance);
      skipHint.addEventListener('click', clickAdvance);

      function cleanup(): void {
        window.removeEventListener('keydown', keyHandler);
        cleanupCurrent = null;
      }
      cleanupCurrent = cleanup;

      typeTimer = window.setInterval(() => {
        i++;
        typedSpan.textContent = node.text.slice(0, i);
        if (i >= node.text.length) finishType();
      }, TYPE_MS_PER_CHAR);
    });
  }

  function hide(): void {
    stopTyping();
    if (cleanupCurrent) { cleanupCurrent(); cleanupCurrent = null; }
    panelRoot.hidden = true;
    clear(panelRoot);
    letterbox(false);
    if (resolveCurrent) { resolveCurrent(0); resolveCurrent = null; }
  }

  return { show, hide };
}
