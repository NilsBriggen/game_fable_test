import { describe, it, expect, vi } from 'vitest';
import { createAudio, volumeToGain } from './audio';

/** Minimal stub AudioContext graph: records connects/starts without real audio. */
function stubContextFactory() {
  const nodes: { started: string[]; stopped: string[]; connected: number } = { started: [], stopped: [], connected: 0 };
  const param = (v: number) => ({ value: v, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() });
  const gainNode = () => ({ gain: param(0), connect: vi.fn(() => { nodes.connected++; }), disconnect: vi.fn() });
  const ctx = {
    state: 'running',
    currentTime: 0,
    sampleRate: 44100,
    destination: {},
    createGain: vi.fn(gainNode),
    createOscillator: vi.fn(() => ({ type: '', frequency: param(440), connect: vi.fn(), start: vi.fn(() => { nodes.started.push('osc'); }), stop: vi.fn() })),
    createBufferSource: vi.fn(() => ({
      buffer: null, loop: false, connect: vi.fn(),
      start: vi.fn(() => { nodes.started.push('src'); }), stop: vi.fn(() => { nodes.stopped.push('src'); }),
    })),
    createBiquadFilter: vi.fn(() => ({ type: '', frequency: param(800), connect: vi.fn() })),
    createBuffer: vi.fn((_ch: number, len: number, _rate: number) => ({ getChannelData: () => new Float32Array(len) })),
    resume: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
    __nodes: nodes,
  };
  return { ctx, factory: () => ctx };
}

describe('volumeToGain', () => {
  it('maps 0..1 to a perceptual (quadratic) curve, clamped', () => {
    expect(volumeToGain(0)).toBe(0);
    expect(volumeToGain(1)).toBe(1);
    expect(volumeToGain(0.5)).toBeCloseTo(0.25);
    expect(volumeToGain(0.8)).toBeCloseTo(0.64);
    expect(volumeToGain(-1)).toBe(0);
    expect(volumeToGain(2)).toBe(1);
  });
});

describe('audio engine', () => {
  it('lazily creates the context on first use and unlocks on gesture', () => {
    const { ctx, factory } = stubContextFactory();
    const create = vi.fn(factory);
    const audio = createAudio({ createContext: create });
    expect(create).not.toHaveBeenCalled();
    audio.unlock();
    expect(create).toHaveBeenCalledTimes(1);
    audio.click();
    expect(create).toHaveBeenCalledTimes(1); // reused, not re-created
    expect(ctx.createOscillator).toHaveBeenCalled();
    audio.dispose();
  });

  it('setVolume drives the master gain via the perceptual curve', () => {
    const { ctx, factory } = stubContextFactory();
    const audio = createAudio({ createContext: factory });
    audio.unlock();
    audio.setVolume(0.5);
    expect(ctx.createGain).toHaveBeenCalled();
    // master is the first gain node created
    const master = (ctx.createGain as ReturnType<typeof vi.fn>).mock.results[0]?.value as { gain: { value: number } };
    expect(master.gain.value).toBeCloseTo(0.25);
    audio.dispose();
  });

  it('click/hit/splash schedule oscillator/noise nodes', () => {
    const { ctx, factory } = stubContextFactory();
    const audio = createAudio({ createContext: factory });
    audio.click();
    audio.hit();
    audio.clash();
    audio.twang();
    audio.step();
    audio.splash();
    expect(ctx.createOscillator).toHaveBeenCalled();
    expect(ctx.createBufferSource).toHaveBeenCalled();
    audio.dispose();
  });

  it('fanfare/lament schedule sequencer notes without throwing', () => {
    const { factory } = stubContextFactory();
    const audio = createAudio({ createContext: factory });
    expect(() => { audio.fanfare(); audio.lament(); }).not.toThrow();
    audio.dispose();
  });

  it('startAmbience is idempotent, stopAmbience stops the loop', () => {
    const { ctx, factory } = stubContextFactory();
    const audio = createAudio({ createContext: factory });
    audio.startAmbience();
    audio.startAmbience();
    expect(ctx.__nodes.started.filter((s) => s === 'src')).toHaveLength(1);
    audio.stopAmbience();
    expect(ctx.__nodes.stopped).toHaveLength(1);
    audio.stopAmbience(); // second stop is a no-op
    expect(ctx.__nodes.stopped).toHaveLength(1);
    audio.dispose();
  });

  it('setAmbience switches beds (lake/mountain/village/church/none)', () => {
    const { ctx, factory } = stubContextFactory();
    const audio = createAudio({ createContext: factory });
    audio.setAmbience('lake');
    audio.setAmbience('lake'); // idempotent: no second source
    expect(ctx.__nodes.started.filter((s) => s === 'src')).toHaveLength(1);
    audio.setAmbience('village'); // switch: old stopped, new started
    expect(ctx.__nodes.stopped).toHaveLength(1);
    expect(ctx.__nodes.started.filter((s) => s === 'src')).toHaveLength(2);
    audio.setAmbience('none');
    expect(ctx.__nodes.stopped).toHaveLength(2);
    audio.dispose();
  });

  it('playMusic beds schedule sequencer notes; unknown ids and stopMusic silence', () => {
    const { ctx, factory } = stubContextFactory();
    const audio = createAudio({ createContext: factory });
    for (const bed of ['title', 'tavern', 'church', 'explore', 'battle', 'morgarten']) {
      audio.playMusic(bed);
      expect(audio.currentMusic()).toBe(bed);
    }
    expect(ctx.createOscillator).toHaveBeenCalled(); // sequencer voices scheduled
    audio.playMusic('nope-not-a-bed');
    expect(audio.currentMusic()).toBeNull();
    audio.playMusic('tavern');
    audio.stopMusic();
    expect(audio.currentMusic()).toBeNull();
    audio.dispose();
  });

  it('playMusic stays procedural-only (no file player touched) until beds land', () => {
    const { factory } = stubContextFactory();
    const trackCalls: string[][] = [];
    const audio = createAudio({
      createContext: factory,
      createTrackPlayer: () => ({
        playTrack: (urls: string[]) => { trackCalls.push(urls); return Promise.resolve(true); },
        stopTrack: () => {},
        trackBed: () => null,
        playVoice: () => {},
        stopVoice: () => {},
        isVoicePlaying: () => false,
        playOnce: () => Promise.resolve(false),
        setVolume: () => {},
        dispose: () => {},
      }),
    });
    audio.unlock();
    audio.playMusic('tavern');
    expect(audio.currentMusic()).toBe('tavern');
    expect(audio.currentTrack()).toBeNull();
    expect(trackCalls).toHaveLength(0);
    audio.dispose();
  });

  it('playMusicTrack falls back to the sequencer when no file exists', async () => {
    const { ctx, factory } = stubContextFactory();
    const audio = createAudio({
      createContext: factory,
      createTrackPlayer: () => ({
        playTrack: () => Promise.resolve(false), // 404 / missing file
        stopTrack: () => {},
        trackBed: () => null,
        playVoice: () => {},
        stopVoice: () => {},
        isVoicePlaying: () => false,
        playOnce: () => Promise.resolve(false),
        setVolume: () => {},
        dispose: () => {},
      }),
    });
    audio.unlock();
    await expect(audio.playMusicTrack('explore')).resolves.toBe(false);
    expect(audio.currentMusic()).toBe('explore'); // procedural fallback still plays
    expect(audio.currentTrack()).toBeNull();
    expect(ctx.createOscillator).toHaveBeenCalled();
    audio.dispose();
  });

  it('playMusicTrack uses the file when present; stopMusic clears both layers', async () => {
    const { factory } = stubContextFactory();
    let stopped = 0;
    const audio = createAudio({
      createContext: factory,
      createTrackPlayer: () => ({
        playTrack: () => Promise.resolve(true),
        stopTrack: () => { stopped++; },
        trackBed: () => 'battle',
        playVoice: () => {},
        stopVoice: () => {},
        isVoicePlaying: () => false,
        playOnce: () => Promise.resolve(false),
        setVolume: () => {},
        dispose: () => {},
      }),
    });
    audio.unlock();
    await expect(audio.playMusicTrack('battle')).resolves.toBe(true);
    expect(audio.currentTrack()).toBe('battle');
    audio.stopMusic();
    expect(audio.currentMusic()).toBeNull();
    expect(audio.currentTrack()).toBeNull();
    expect(stopped).toBeGreaterThan(0);
    audio.dispose();
  });

  it('voice is silent before unlock, silent when disabled, silent without files', () => {
    const { factory } = stubContextFactory();
    const played: string[][] = [];
    let stopped = 0;
    const audio = createAudio({
      createContext: factory,
      createTrackPlayer: () => ({
        playTrack: () => Promise.resolve(false),
        stopTrack: () => {},
        trackBed: () => null,
        playVoice: (urls: string[]) => { played.push(urls); },
        stopVoice: () => { stopped++; },
        isVoicePlaying: () => false,
        playOnce: () => Promise.resolve(false),
        setVolume: () => {},
        dispose: () => {},
      }),
    });
    audio.playVoice('en', 'dlg-gessler-hat-node-pole-text'); // locked: silent
    expect(played).toHaveLength(0);
    audio.unlock();
    audio.playVoice('en', 'dlg-gessler-hat-node-pole-text');
    expect(played).toHaveLength(1);
    expect(played[0][0]).toBe('assets/voices/en/dlg-gessler-hat-node-pole-text.opus');
    expect(played[0][1]).toBe('assets/voices/en/dlg-gessler-hat-node-pole-text.mp3');
    audio.setVoicesEnabled(false); // disabling stops the line; further plays silent
    expect(stopped).toBeGreaterThan(0);
    audio.playVoice('en', 'dlg-gessler-hat-node-pole-text');
    expect(played).toHaveLength(1);
    audio.setVoicesEnabled(true);
    expect(audio.voicePlaying()).toBe(false);
    audio.barkBlip(); // never throws, schedules on the procedural bus only
    audio.playStinger('nope'); // unknown name: silent no-op
    audio.dispose();
  });

  it('stingers are unlock-gated, whitelisted, and never throw without files', async () => {
    const { factory } = stubContextFactory();
    const played: string[][] = [];
    const audio = createAudio({
      createContext: factory,
      createTrackPlayer: () => ({
        playTrack: () => Promise.resolve(false),
        stopTrack: () => {},
        trackBed: () => null,
        playVoice: () => {},
        stopVoice: () => {},
        isVoicePlaying: () => false,
        playOnce: (urls: string[]) => { played.push(urls); return Promise.resolve(true); },
        setVolume: () => {},
        dispose: () => {},
      }),
    });
    audio.playStinger('discover'); // locked: silent
    expect(played).toHaveLength(0);
    audio.unlock();
    audio.playStinger('discover');
    expect(played).toHaveLength(1);
    expect(played[0][0]).toBe('assets/music/discover.opus');
    expect(played[0][1]).toBe('assets/music/discover.mp3');
    audio.playStinger('quest-done');
    audio.playStinger('quest-fail');
    expect(played).toHaveLength(3);
    audio.playStinger('../voices/en/x'); // not whitelisted: silent
    expect(played).toHaveLength(3);
    audio.dispose();
  });

  it('never throws when WebAudio is unavailable', () => {
    const audio = createAudio({ createContext: () => null });
    expect(() => {
      audio.unlock();
      audio.click();
      audio.hit();
      audio.clash();
      audio.twang();
      audio.step();
      audio.splash();
      audio.fanfare();
      audio.lament();
      audio.startAmbience();
      audio.stopAmbience();
      audio.setAmbience('lake');
      audio.playMusic('tavern');
      audio.stopMusic();
      audio.setVolume(0.5);
      audio.dispose();
    }).not.toThrow();
  });

  it('never throws when the factory itself throws', () => {
    const audio = createAudio({ createContext: () => { throw new Error('no audio'); } });
    expect(() => {
      audio.unlock();
      audio.click();
      audio.dispose();
    }).not.toThrow();
  });
});
