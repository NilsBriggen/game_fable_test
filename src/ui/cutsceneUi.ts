/** Cutscene overlay: letterbox, fade-to-black, bottom caption fade, centred title card. ARCHITECTURE.md §5.8.
 *  Voice (§1.7): `playVoice` speaks a pre-generated caption id; silent when files are missing/disabled. */
import { el } from './dom';

export interface CutsceneUi {
  letterbox(on: boolean): void;
  caption(text: string, seconds: number): Promise<void>;
  fade(to: 'black' | 'clear', ms: number): Promise<void>;
  title(text: string, sub?: string, seconds?: number): Promise<void>;
  playVoice(id: string): void;
  stopVoice(): void;
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function createCutsceneUi(
  mount: HTMLElement,
  /** Voice sink (§1.7): wired by ui/index.ts to the audio engine + active locale. Unset = silent. */
  voice?: { play(id: string): void; stop(): void },
): CutsceneUi {
  const letterTop = el('div', { class: 'dlg-letterbox top', style: 'height:0' });
  const letterBottom = el('div', { class: 'dlg-letterbox bottom', style: 'height:0' });
  const fadeEl = el('div', { class: 'cs-fade' });
  const captionEl = el('div', { class: 'cs-caption' });
  const titleWrap = el('div', { class: 'cs-title' }, [el('div', { class: 't' }), el('div', { class: 's' })]);
  const root = el('div', { id: 'cutscene-root' }, [letterTop, letterBottom, fadeEl, captionEl, titleWrap]);
  mount.appendChild(root);

  let fadeState: 'black' | 'clear' = 'clear';

  return {
    letterbox(on: boolean): void {
      letterTop.style.height = on ? '12vh' : '0';
      letterBottom.style.height = on ? '12vh' : '0';
    },
    async caption(text: string, seconds: number): Promise<void> {
      captionEl.textContent = text;
      captionEl.style.opacity = '1';
      await wait(Math.max(0, seconds * 1000 - 400));
      captionEl.style.opacity = '0';
      await wait(400);
      try { voice?.stop(); } catch { /* silent */ }
    },
    async fade(to: 'black' | 'clear', ms: number): Promise<void> {
      if (to === fadeState) { await wait(0); return; }
      fadeEl.style.transitionDuration = `${ms}ms`;
      fadeEl.style.pointerEvents = to === 'black' ? 'auto' : 'none';
      // force reflow so the transition actually plays even if called back-to-back
      void fadeEl.offsetWidth;
      fadeEl.style.opacity = to === 'black' ? '1' : '0';
      fadeState = to;
      await wait(ms);
    },
    async title(text: string, sub?: string, seconds = 3): Promise<void> {
      (titleWrap.querySelector('.t') as HTMLElement).textContent = text;
      (titleWrap.querySelector('.s') as HTMLElement).textContent = sub ?? '';
      titleWrap.style.opacity = '1';
      await wait(seconds * 1000);
      titleWrap.style.opacity = '0';
      await wait(600);
    },
    playVoice(id: string): void {
      try { voice?.play(id); } catch { /* voice must never break a scene */ }
    },
    stopVoice(): void {
      try { voice?.stop(); } catch { /* silent */ }
    },
  };
}
