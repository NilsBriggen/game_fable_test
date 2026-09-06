/**
 * Dialogue panel: portrait, speaker name, typewriter text (skippable), numbered choices with skill-check
 * odds and letterbox. Implements `UiService['dialogue']` — `show()` resolves with the chosen index once
 * `quest/dialogue.ts` awaits it. ARCHITECTURE.md §5.6/§5.8. Voice (§1.7): plays `node.voiceId` on show,
 * stops on hide/pick — silent when the file is missing/disabled (text remains).
 */
import type { DialogueNodeView } from '@core/services';
import { el, clear } from './dom';
import { formatCheckOdds } from './helpers';
import { portraitSvg } from './icons';

const TYPE_MS_PER_CHAR = 16;

/** Exit fade duration (ms). Matches .dlg-panel transition in ui.css; hide() always falls
 *  back to a timeout so a panel can never strand visible if transitionend never fires. */
const EXIT_MS = 200;

/** Painted portraits live under public/assets/portraits/, served as `assets/portraits/<key>.png`
 *  (same relative convention as `assets/textures/...` and `assets/characters/...`). No art ships
 *  this phase, so the <img> removes itself on error and the portraitSvg silhouette shows through.
 *  Expected future convention: `public/assets/portraits/<npc-portrait-key>.png`, keyed off the NPC
 *  `portrait` field (src/core/schemas.ts), lowercased, non-alphanumerics stripped. */
const PORTRAIT_BASE = 'assets/portraits';

export function portraitUrl(key: string): string {
  const slug = key.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${PORTRAIT_BASE}/${slug}.png`;
}

/** Build the portrait cell: svg silhouette fallback + painted <img> on top when a portrait
 *  key is present. The img self-removes on load error (headless/404-safe). `fallback` drives the
 *  silhouette archetype (usually the speaker name); `imgKey` (usually the NPC `portrait` field)
 *  drives the painted asset lookup and is only attempted when defined. */
export function buildPortrait(fallback: string | undefined, imgKey?: string, accent = '#6b1f24', size = 64): HTMLElement {
  const portrait = el('div', { class: 'dlg-portrait', html: portraitSvg(fallback ?? 'peasant', accent, size) });
  if (imgKey) {
    const img = el('img', { class: 'dlg-portrait-img', src: portraitUrl(imgKey), alt: '' }) as HTMLImageElement;
    img.addEventListener('error', () => { img.remove(); });
    portrait.appendChild(img);
  }
  return portrait;
}

export interface DialogueUi {
  show(node: DialogueNodeView): Promise<number>;
  hide(): void;
  wasDismissed(): boolean;
}

export function createDialogueUi(
  mount: HTMLElement,
  menuOpen: () => boolean = () => false,
  /** Voice sink (§1.7): wired by ui/index.ts to the audio engine + active locale. Unset = silent. */
  voice?: { play(id: string): void; stop(): void },
): DialogueUi {
  const letterTop = el('div', { class: 'dlg-letterbox top', style: 'height:0' });
  const letterBottom = el('div', { class: 'dlg-letterbox bottom', style: 'height:0' });
  const panelRoot = el('div', { id: 'dialogue-root' });
  panelRoot.hidden = true;
  mount.append(letterTop, letterBottom, panelRoot);

  let typeTimer: number | null = null;
  let resolveCurrent: ((i: number) => void) | null = null;
  let cleanupCurrent: (() => void) | null = null;
  // Set when hide() interrupts a pending show() (pause menu, Esc, scenario teardown) rather than the
  // player picking a choice. The dialogue runner (src/quest/dialogue.ts) reads it after each awaited
  // show() to report neutral cancellation instead of treating the teardown's stale index-0 resolution
  // as a real pick. Cleared on every fresh show().
  let dismissed = false;
  // Tracks the currently visible panel so hide() can animate it out.
  let livePanel: HTMLElement | null = null;
  // Guards a pending animated exit: a fresh show() cancels it and takes over cleanup.
  let exitTimer: number | null = null;

  function nextFrame(cb: () => void): void {
    // jsdom/vitest-node have no rAF; fall back to a timer so show()/hide() still work there.
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(cb));
    else window.setTimeout(cb, 0);
  }

  function letterbox(on: boolean): void {
    // Defer one frame so the CSS height transition animates instead of snapping.
    nextFrame(() => {
      letterTop.style.height = on ? '12vh' : '0';
      letterBottom.style.height = on ? '12vh' : '0';
    });
  }

  /** Animate the panel in: inserted hidden, then revealed next frame so the transition fires. */
  function enterPanel(panel: HTMLElement): void {
    livePanel = panel;
    panel.classList.add('dlg-anim-enter');
    nextFrame(() => { panel.classList.remove('dlg-anim-enter'); });
  }

  function stopTyping(): void {
    if (typeTimer !== null) { window.clearInterval(typeTimer); typeTimer = null; }
  }

  function show(node: DialogueNodeView): Promise<number> {
    stopTyping();
    dismissed = false;
    try { voice?.stop(); } catch { /* voice must never break dialogue */ }
    // §1.7: speak the node from its stable string id; missing file/disabled = silent, text remains.
    if (node.voiceId) {
      try { voice?.play(node.voiceId); } catch { /* silent fallback */ }
    }
    if (exitTimer !== null) { window.clearTimeout(exitTimer); exitTimer = null; }
    livePanel = null;
    if (cleanupCurrent) { cleanupCurrent(); cleanupCurrent = null; }
    // Concurrent-dialogue guard: a second show() while a choice is still pending means the previous
    // conversation was superseded, not answered — mark it dismissed so the first runner reports
    // cancelled:true instead of treating this teardown's stale index-0 as a real pick.
    if (resolveCurrent) { dismissed = true; resolveCurrent(0); resolveCurrent = null; }
    return new Promise((resolve) => {
      resolveCurrent = resolve;
      letterbox(true);
      panelRoot.hidden = false;
      clear(panelRoot);

      const portrait = buildPortrait(node.speakerName, node.speakerPortrait);
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
      enterPanel(panel);

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
        try { voice?.stop(); } catch { /* silent */ }
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
    try { voice?.stop(); } catch { /* silent */ }
    if (cleanupCurrent) { cleanupCurrent(); cleanupCurrent = null; }
    if (exitTimer !== null) { window.clearTimeout(exitTimer); exitTimer = null; }
    // Exit via transition (transitionend fast-path + timeout fallback so the panel can
    // never strand visible). The letterbox collapses immediately for a snappier teardown.
    letterTop.style.height = '0';
    letterBottom.style.height = '0';
    const panel = livePanel;
    livePanel = null;
    const finish = () => {
      // A fresh show() may have taken over the root meanwhile — only tear down our own exit.
      if (livePanel) return;
      panelRoot.hidden = true;
      clear(panelRoot);
      exitTimer = null;
    };
    if (panel && panel.isConnected) {
      panel.classList.add('dlg-anim-exit');
      let done = false;
      const once = () => { if (!done) { done = true; finish(); } };
      panel.addEventListener('transitionend', once, { once: true });
      exitTimer = window.setTimeout(once, EXIT_MS + 50);
    } else {
      finish();
    }
    if (resolveCurrent) { dismissed = true; resolveCurrent(0); resolveCurrent = null; } else { dismissed = false; }
  }

  function wasDismissed(): boolean { return dismissed; }

  return { show, hide, wasDismissed };
}
