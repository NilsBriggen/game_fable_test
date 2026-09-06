/**
 * Procedural WebAudio engine (Phase 2 task A6, UI technical only; Phase 3 3.4 music bus),
 * plus the asset-file upgrade layer (voices §1.7, Flow music §2.2 — both optional, both fall back).
 *
 * Everything *procedural* is synthesized — no audio assets required. The AudioContext is created
 * lazily on the first user gesture (autoplay-safe); every public method is a no-op when WebAudio is
 * unavailable so callers never need availability checks.
 *
 * Three layers:
 * - SFX (click/hit/splash): one-shot oscillator/noise blips straight into the master gain.
 * - Music (3.4): a tiny step-sequenced voice (`playMusic`/`stopMusic`) plus region ambience beds
 *   (`setAmbience`). Music is modal monophony in period-plausible modes (Dorian on D, Mixolydian on G)
 *   at voice/flute-like timbres — evocation, not reconstruction. No samples, no voice, no percussion
 *   beyond a soft frame-drum thump on strong beats of the battle bed.
 * - Files (voices/music upgrade): committed `.opus`/`.mp3` under `assets/voices/<locale>/` and
 *   `assets/music/` played through `<audio>` elements (streaming, no WebAudio decode, no heap cost).
 *   Missing file / 404 / disabled / no-WebAudio = silent, text/procedural bed remains — the fallback is
 *   proven by deleting one committed file. `playMusicTrack` is how committed Flow loops replace the
 *   sequencer bed; `playVoice`/`stopVoice` is how dialogue/cutscene lines speak.
 *
 * Master gain is driven by `ctx.settings.masterVolume` via `ctx.onSettings` (wired in `index.ts`).
 * Perception-correct mapping lives in `volumeToGain` (pure, unit-tested).
 */

export type MusicId = 'tavern' | 'church' | 'battle' | 'explore' | 'morgarten' | 'title';
export type AmbienceId = 'lake' | 'mountain' | 'village' | 'church' | 'none';

export interface AudioEngine {
  /** Ensure the context exists (call from a user gesture); safe to call repeatedly. */
  unlock(): void;
  /** Short UI tick for button clicks. */
  click(): void;
  /** Low thud for presented combat damage. */
  hit(): void;
  /** Sword/shield clash for presented combat attacks. */
  clash(): void;
  /** Bow/crossbow release snap. */
  twang(): void;
  /** Footstep tick (rate-limited by the caller; clicked grass, not a sample). */
  step(): void;
  /** Filtered-noise splash (lake/water moments). */
  splash(): void;
  /** Victory stinger (quest complete / combat won). */
  fanfare(): void;
  /** Defeat stinger (quest failed / combat lost). */
  lament(): void;
  /** Looped procedural wind bed; safe to call repeatedly. */
  startAmbience(): void;
  stopAmbience(): void;
  /** Region ambience bed: lake water / mountain wind / village murmur / church hush. Replaces startAmbience. */
  setAmbience(id: AmbienceId): void;
  /** Start a music bed; replaces any currently playing bed. Unknown ids stop the music. */
  playMusic(id: string): void;
  /** Stop the music bed, if any. */
  stopMusic(): void;
  /** Currently playing music id, or null. */
  currentMusic(): string | null;
  /**
   * Committed-file music upgrade (Flow §2.2): play `assets/music/<bed>.opus` (`.mp3` fallback) as a
   * loop at music-bus level; when the file is absent/unplayable, falls back to `playMusic(bed)`.
   * Resolves true when a file track started, false when the procedural fallback was used.
   */
  playMusicTrack(bed: string): Promise<boolean>;
  /** Currently playing file track bed, or null (procedural sequencer or silence). */
  currentTrack(): string | null;
  /**
   * Pre-generated voice line (§1.7): play `assets/voices/<locale>/<slug>.opus` (`.mp3` fallback),
   * stopping any current line first. Missing file / disabled / no-audio = silent no-op (text remains).
   * Voice sits at 0 dB over the −6 dB music bus; masterVolume applies.
   */
  playVoice(locale: string, slug: string): void;
  /** Stop the current voice line, if any. */
  stopVoice(): void;
  /** True while a voice line is playing. */
  voicePlaying(): boolean;
  /** Enable/disable voice playback (Settings.voicesEnabled). Disabled = silent, text remains. */
  setVoicesEnabled(on: boolean): void;
  /** Short bark earcon under HUD toasts (rate-limited by the caller). */
  barkBlip(): void;
  /**
   * One-shot stinger from committed files (`assets/music/<name>.opus`/`.mp3`, NOT looped):
   * `discover` (POI discovery), `quest-done` (quest complete), `quest-fail` (quest failed).
   * Missing file / locked / no-audio = silent no-op; never falls back to the procedural
   * fanfare/lament (callers play those themselves when they want them).
   */
  playStinger(name: string): void;
  /** Apply a 0..1 master volume (clamped, perceptual curve). */
  setVolume(v: number): void;
  dispose(): void;
}

/** Perceptual mapping: 0..1 slider to gain. Exported pure for unit tests. */
export function volumeToGain(v: number): number {
  const c = Math.max(0, Math.min(1, v));
  return c * c;
}

export interface AudioEngineOptions {
  /** Injectable context factory (tests stub this; default constructs a real AudioContext). */
  createContext?: () => unknown;
  /**
   * Injectable file-track player factory (tests stub this; default constructs `<audio>` elements).
   * The factory receives a volume 0..1 getter so tracks follow masterVolume without new gain staging.
   */
  createTrackPlayer?: (getVolume: () => number) => FileTrackPlayer;
  /** Base path for committed audio files (default `'assets'`, honouring the `base './'` build). */
  assetBase?: string;
}

/** Minimal streaming-file player: one `<audio>` loop for music tracks, one for voice lines. */
export interface FileTrackPlayer {
  /** Play a music-bed file loop; resolves false when the file is absent/unplayable (caller falls back). */
  playTrack(urls: string[]): Promise<boolean>;
  stopTrack(): void;
  trackBed(): string | null;
  playVoice(urls: string[]): void;
  stopVoice(): void;
  isVoicePlaying(): boolean;
  /** One-shot (non-looped) file; resolves false when absent/unplayable (caller stays silent). */
  playOnce(urls: string[]): Promise<boolean>;
  setVolume(v: number): void;
  dispose(): void;
}

function defaultCreateTrackPlayer(getVolume: () => number): FileTrackPlayer {
  try {
    if (typeof Audio === 'undefined') throw new Error('no Audio');
    const music = new Audio();
    music.loop = true;
    music.preload = 'auto';
    const voice = new Audio();
    voice.loop = false;
    voice.preload = 'auto';
    // One-shot stingers share the voice element's lane (never the music loop): a discovery chime or
    // quest stinger must not cut the bed, and two stingers in a row replace each other, not overlap.
    const sting = new Audio();
    sting.loop = false;
    sting.preload = 'auto';
    const apply = (): void => {
      try {
        music.volume = getVolume();
        voice.volume = getVolume();
        sting.volume = getVolume();
      } catch { /* stub — stay silent */ }
    };
    apply();
    let bed: string | null = null;
    let voiceOn = false;
    const onVoiceEnd = (): void => { voiceOn = false; };
    voice.addEventListener('ended', onVoiceEnd);
    const tryUrls = (el: HTMLAudioElement, urls: string[]): Promise<boolean> => {
      // Sequential fallback: .opus first, then .mp3. A missing file rejects on error events;
      // resolve false (never throw) so the caller can fall back to the procedural bed/text.
      return (async () => {
        for (const u of urls) {
          try {
            el.src = u;
            el.currentTime = 0;
            await el.play();
            return true;
          } catch {
            continue;
          }
        }
        return false;
      })();
    };
    return {
      async playTrack(urls: string[]): Promise<boolean> {
        apply();
        const bedName = urls[0]?.split('/').pop()?.replace(/\.(opus|mp3)$/, '') ?? null;
        const ok = await tryUrls(music, urls);
        bed = ok ? bedName : null;
        if (!ok) { try { music.removeAttribute('src'); music.load(); } catch { /* noop */ } }
        return ok;
      },
      stopTrack(): void {
        bed = null;
        try { music.pause(); music.removeAttribute('src'); music.load(); } catch { /* noop */ }
      },
      trackBed(): string | null { return bed; },
      playVoice(urls: string[]): void {
        apply();
        try { voice.pause(); } catch { /* noop */ }
        voiceOn = true;
        void tryUrls(voice, urls).then((ok) => { if (!ok) voiceOn = false; });
      },
      stopVoice(): void {
        voiceOn = false;
        try { voice.pause(); voice.removeAttribute('src'); voice.load(); } catch { /* noop */ }
      },
      isVoicePlaying(): boolean { return voiceOn && !voice.paused && !voice.ended; },
      async playOnce(urls: string[]): Promise<boolean> {
        apply();
        try { sting.pause(); } catch { /* noop */ }
        const ok = await tryUrls(sting, urls);
        if (!ok) { try { sting.removeAttribute('src'); sting.load(); } catch { /* noop */ } }
        return ok;
      },
      setVolume(v: number): void {
        try { music.volume = v; voice.volume = v; sting.volume = v; } catch { /* noop */ }
      },
      dispose(): void {
        try { voice.removeEventListener('ended', onVoiceEnd); } catch { /* noop */ }
        try { music.pause(); voice.pause(); sting.pause(); } catch { /* noop */ }
      },
    };
  } catch {
    // No DOM Audio (node/headless): silent stub — every method a no-op, never throws.
    return {
      async playTrack(): Promise<boolean> { return false; },
      stopTrack(): void {},
      trackBed(): string | null { return null; },
      playVoice(): void {},
      stopVoice(): void {},
      isVoicePlaying(): boolean { return false; },
      async playOnce(): Promise<boolean> { return false; },
      setVolume(): void {},
      dispose(): void {},
    };
  }
}

function defaultCreateContext(): unknown {
  try {
    const AC = (globalThis as unknown as {
      AudioContext?: new () => unknown;
      webkitAudioContext?: new () => unknown;
    }).AudioContext ?? (globalThis as unknown as { webkitAudioContext?: new () => unknown }).webkitAudioContext;
    return AC ? new AC() : null;
  } catch {
    return null;
  }
}

export function createAudio(opts: AudioEngineOptions = {}): AudioEngine {
  const create = opts.createContext ?? defaultCreateContext;
  const assetBase = opts.assetBase ?? 'assets';
  // Structural (minimal) view of the WebAudio graph — `unknown` at the boundary, narrowed here so
  // this module compiles without DOM AudioContext types and stays stub-friendly in node tests.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ac: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let master: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let musicBus: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ambience: { src: any; gain: any; id: AmbienceId } | null = null;
  let volume = 0.8;
  let disposed = false;
  // Music sequencer state (all scheduling is lookahead-based on ac.currentTime; stop cancels).
  let musicId: MusicId | null = null;
  let musicTimer: number | null = null;
  let musicStep = 0;
  // File-track upgrade layer (voices §1.7, Flow music §2.2): lazy player, unlock-gated like music.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tracks: any = null;
  let trackBed: string | null = null;
  let trackGen = 0; // guards late async playTrack resolutions after stopMusic/dispose
  let voicesOn = true;
  let unlocked = false;

  function ensure(): boolean {
    if (disposed || ac) return ac !== null;
    let ctx: unknown = null;
    try {
      ctx = create();
    } catch {
      ctx = null;
    }
    if (!ctx) return false;
    ac = ctx;
    try {
      master = ac.createGain();
      master.gain.value = volumeToGain(volume);
      master.connect(ac.destination);
      // Music sits 6 dB under SFX so beds never cover dialogue-forward sounds.
      musicBus = ac.createGain();
      musicBus.gain.value = 0.5;
      musicBus.connect(master);
    } catch {
      ac = null;
      master = null;
      musicBus = null;
      return false;
    }
    return true;
  }

  function resume(): void {
    try {
      if (ac && ac.state === 'suspended' && typeof ac.resume === 'function') void ac.resume();
    } catch { /* autoplay policy / stub — stay silent */ }
  }

  function noiseBuffer(seconds: number): unknown {
    const rate = typeof ac.sampleRate === 'number' ? ac.sampleRate : 44100;
    const buf = ac.createBuffer(1, Math.max(1, Math.floor(rate * seconds)), rate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  function blip(freq: number, dur: number, type: string, peak: number): void {
    if (!ensure() || !master) return;
    resume();
    try {
      const t = ac.currentTime;
      const osc = ac.createOscillator();
      osc.type = type;
      osc.frequency.value = freq;
      const g = ac.createGain();
      g.gain.setValueAtTime(peak, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g);
      g.connect(master);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    } catch { /* stub mismatch — stay silent */ }
  }

  function noiseBurst(dur: number, filterFreq: number, peak: number): void {
    if (!ensure() || !master) return;
    resume();
    try {
      const t = ac.currentTime;
      const src = ac.createBufferSource();
      src.buffer = noiseBuffer(dur);
      const filter = ac.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = filterFreq;
      const g = ac.createGain();
      g.gain.setValueAtTime(peak, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(filter);
      filter.connect(g);
      g.connect(master);
      src.start(t);
      src.stop(t + dur + 0.02);
    } catch { /* stub mismatch — stay silent */ }
  }

  // ---------------------------------------------------------------- music (3.4) ----------------
  // Frequencies in Hz (equal temperament, A=440). Modes, not major/minor:
  // - D Dorian (D E F G A B C): tavern dance, explore air, morgarten lament;
  // - G Mixolydian (G A B C D E F): church plainchant-ish bed, title air.
  // Melodies are short invented phrases (original, no historical claim) shaped to the mode.
  const FREQ: Record<string, number> = {
    D3: 146.83, E3: 164.81, F3: 174.61, G3: 196.0, A3: 220.0, B3: 246.94, C4: 261.63,
    D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0, B4: 493.88, C5: 523.25,
    D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.0,
  };
  interface MusicBed { bpm: number; wave: string; steps: (string | null)[]; bass?: (string | null)[]; drum?: boolean }
  const BEDS: Record<MusicId, MusicBed> = {
    // G Mixolydian air, slow — title screen.
    title: { bpm: 72, wave: 'sine', steps: ['G4', null, 'A4', 'B4', 'A4', null, 'G4', null, 'E4', 'G4', null, null, 'D4', null, null, null] },
    // D Dorian round-dance fragment, lively — tavern/rest.
    tavern: { bpm: 132, wave: 'triangle', steps: ['D4', 'F4', 'A4', 'F4', 'G4', 'A4', 'G4', 'F4', 'E4', 'F4', 'D4', null, 'D4', 'F4', 'A4', 'D5'] },
    // G Mixolydian chant fragment, very slow, low — church/monastery.
    church: { bpm: 60, wave: 'sine', steps: ['G3', null, null, null, 'A3', null, 'B3', null, null, null, 'C4', null, 'B3', null, 'A3', null], bass: ['G3', null, null, null, null, null, null, null, 'C4', null, null, null, null, null, null, null] },
    // D Dorian walking air — explore/travel.
    explore: { bpm: 96, wave: 'triangle', steps: ['D4', null, 'F4', null, 'E4', 'D4', null, 'C4', 'D4', null, 'A3', null, 'D4', null, null, null] },
    // D Dorian war-pipe fragment with frame-drum pulse — combat.
    battle: { bpm: 120, wave: 'sawtooth', steps: ['D4', 'D4', 'F4', 'A4', 'A4', 'G4', 'F4', 'E4', 'D4', 'D4', 'F4', 'D5', 'C5', 'A4', 'G4', 'F4'], drum: true },
    // D Dorian lament, sparse — Morgarten aftermath / defeat-adjacent.
    morgarten: { bpm: 66, wave: 'sine', steps: ['A4', null, null, 'G4', null, 'F4', null, null, 'E4', null, 'D4', null, null, null, null, null] },
  };
  const MUSIC_IDS = new Set<string>(Object.keys(BEDS));

  /** One sequencer voice note (music bus, so beds duck under SFX by construction). */
  function musicNote(freq: number, at: number, dur: number, wave: string, peak: number): void {
    try {
      const osc = ac.createOscillator();
      osc.type = wave;
      osc.frequency.value = freq;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(peak, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      osc.connect(g);
      g.connect(musicBus ?? master);
      osc.start(at);
      osc.stop(at + dur + 0.02);
    } catch { /* stub mismatch — stay silent */ }
  }

  function scheduleMusicLoop(): void {
    if (musicTimer !== null || musicId === null) return;
    const bed = BEDS[musicId];
    if (!bed) return;
    const stepDur = 60 / bed.bpm / 2; // eighth notes
    const tick = (): void => {
      if (disposed || musicId === null || !ac) { musicTimer = null; return; }
      const bedNow = musicId ? BEDS[musicId] : undefined;
      if (!bedNow) { musicTimer = null; return; }
      const t = ac.currentTime + 0.06;
      const step = bedNow.steps[musicStep % bedNow.steps.length];
      if (step && FREQ[step]) musicNote(FREQ[step], t, stepDur * 1.8, bedNow.wave, bedNow.wave === 'sawtooth' ? 0.10 : 0.16);
      const bass = bedNow.bass?.[musicStep % bedNow.bass.length];
      if (bass && FREQ[bass]) musicNote(FREQ[bass] / 2, t, stepDur * 3.5, 'sine', 0.10);
      if (bedNow.drum && musicStep % 4 === 0) {
        try {
          const osc = ac.createOscillator();
          osc.type = 'sine';
          osc.frequency.value = 70;
          const g = ac.createGain();
          g.gain.setValueAtTime(0.25, t);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
          osc.connect(g);
          g.connect(musicBus ?? master);
          osc.start(t);
          osc.stop(t + 0.17);
        } catch { /* stay silent */ }
      }
      musicStep++;
      try {
        musicTimer = window.setTimeout(tick, stepDur * 1000);
      } catch {
        musicTimer = null; // node tests: no window — the bed still plays its first note synchronously
      }
    };
    tick();
  }

  function stopMusicLoop(): void {
    if (musicTimer !== null) {
      try { clearTimeout(musicTimer); } catch { /* stub */ }
      musicTimer = null;
    }
    musicStep = 0;
  }

  /** Region ambience beds (3.4): filtered looped noise shaped per region. Replaces any current bed. */
  function applyAmbience(id: AmbienceId): void {
    if (ambience?.id === id) return;
    if (ambience) {
      try { ambience.src.stop(); } catch { /* already stopped */ }
      try { ambience.gain.disconnect(); } catch { /* stub */ }
      ambience = null;
    }
    if (id === 'none' || disposed) return;
    if (!ensure() || !master) return;
    resume();
    try {
      const src = ac.createBufferSource();
      src.buffer = noiseBuffer(2);
      src.loop = true;
      const filter = ac.createBiquadFilter();
      const g = ac.createGain();
      // lake: soft lapping (band-ish lowpass + slow LFO on gain); mountain: thin high wind;
      // village: low murmur; church: near-silence with a faint air tone.
      if (id === 'lake') {
        filter.type = 'lowpass'; filter.frequency.value = 700;
        g.gain.value = 0.06;
      } else if (id === 'mountain') {
        filter.type = 'highpass'; filter.frequency.value = 900;
        g.gain.value = 0.035;
      } else if (id === 'village') {
        filter.type = 'lowpass'; filter.frequency.value = 450;
        g.gain.value = 0.05;
      } else {
        filter.type = 'lowpass'; filter.frequency.value = 240;
        g.gain.value = 0.025;
      }
      src.connect(filter);
      filter.connect(g);
      g.connect(master);
      src.start();
      ambience = { src, gain: g, id };
    } catch {
      ambience = null;
    }
  }

  /**
   * Shared music start: committed file track first (when requested and unlocked), procedural
   * sequencer as fallback. `preferFile=false` keeps legacy `playMusic` behaviour (procedural only,
   * never touches `<audio>`) so existing scenes are unaffected until Flow beds land.
   */
  function playMusicTrackInternal(id: string, preferFile: boolean): Promise<boolean> {
    trackGen++;
    const gen = trackGen;
    trackBed = null;
    try { tracks?.stopTrack(); } catch { /* stub — stay silent */ }
    stopMusicLoop();
    musicId = null;
    if (!MUSIC_IDS.has(id)) return Promise.resolve(false);
    if (preferFile && unlocked && !disposed) {
      try {
        tracks ??= (opts.createTrackPlayer ?? defaultCreateTrackPlayer)(() => volumeToGain(volume));
      } catch {
        tracks = null;
      }
      if (tracks) {
        const clean = id.replace(/[^a-z-]/g, '') || id;
        return tracks.playTrack([`${assetBase}/music/${clean}.opus`, `${assetBase}/music/${clean}.mp3`]).then((ok: boolean) => {
          if (gen !== trackGen) return false; // superseded by stopMusic/playMusic meanwhile
          if (ok) {
            trackBed = id;
            return true;
          }
          startProcedural(id);
          return false;
        }).catch(() => {
          if (gen !== trackGen) return false;
          startProcedural(id);
          return false;
        });
      }
    }
    startProcedural(id);
    return Promise.resolve(trackBed !== null);
  }

  function startProcedural(id: string): void {
    if (musicId === id && musicTimer !== null) return; // idempotent
    stopMusicLoop();
    musicId = id as MusicId;
    if (!ensure() || !musicBus) { musicId = null; return; }
    resume();
    scheduleMusicLoop();
  }

  return {
    unlock(): void {
      unlocked = true;
      if (ensure()) resume();
    },
    click(): void {
      blip(660, 0.06, 'triangle', 0.12);
    },
    hit(): void {
      // Low sine thump layered over a short filtered-noise burst.
      blip(90, 0.18, 'sine', 0.5);
      noiseBurst(0.12, 500, 0.25);
    },
    clash(): void {
      // Steel on steel/wood: bright metallic ping + noise snap.
      blip(1250, 0.09, 'square', 0.10);
      noiseBurst(0.08, 3200, 0.22);
    },
    twang(): void {
      // Bow/crossbow release: short plucked snap.
      blip(320, 0.07, 'sawtooth', 0.14);
    },
    step(): void {
      // Footstep: very short soft thud (caller rate-limits; no per-frame cost here).
      blip(140, 0.045, 'sine', 0.08);
    },
    splash(): void {
      noiseBurst(0.45, 1200, 0.2);
    },
    fanfare(): void {
      // Quest-complete / victory: rising D-Dorian triad fragment, voice-like.
      if (!ensure() || !musicBus) return;
      resume();
      try {
        const t = ac.currentTime;
        const seq: [string, number][] = [['D4', 0], ['F4', 0.12], ['A4', 0.24], ['D5', 0.36]];
        for (const [n, dt] of seq) if (FREQ[n]) musicNote(FREQ[n], t + dt, 0.5, 'triangle', 0.2);
      } catch { /* stay silent */ }
    },
    lament(): void {
      // Defeat: falling minor fragment.
      if (!ensure() || !musicBus) return;
      resume();
      try {
        const t = ac.currentTime;
        const seq: [string, number][] = [['A4', 0], ['G4', 0.25], ['E4', 0.5], ['D4', 0.75]];
        for (const [n, dt] of seq) if (FREQ[n]) musicNote(FREQ[n], t + dt, 0.7, 'sine', 0.18);
      } catch { /* stay silent */ }
    },
    startAmbience(): void {
      applyAmbience('mountain');
    },
    stopAmbience(): void {
      applyAmbience('none');
    },
    setAmbience(id: AmbienceId): void {
      applyAmbience(id);
    },
    playMusic(id: string): void {
      void playMusicTrackInternal(id, false);
    },
    stopMusic(): void {
      trackGen++; // invalidate any in-flight playTrack resolution
      trackBed = null;
      try { tracks?.stopTrack(); } catch { /* stub — stay silent */ }
      stopMusicLoop();
      musicId = null;
    },
    currentMusic(): string | null {
      return trackBed ?? musicId;
    },
    async playMusicTrack(bed: string): Promise<boolean> {
      return playMusicTrackInternal(bed, true);
    },
    currentTrack(): string | null {
      return trackBed;
    },
    playVoice(locale: string, slug: string): void {
      if (!voicesOn || !unlocked || disposed) return;
      try {
        tracks ??= (opts.createTrackPlayer ?? defaultCreateTrackPlayer)(() => volumeToGain(volume));
      } catch {
        return; // no DOM Audio — silent, text remains
      }
      const cleanLocale = locale.replace(/[^a-z-]/g, '') || 'en';
      const cleanSlug = slug.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      if (!cleanSlug) return;
      try {
        tracks.playVoice([
          `${assetBase}/voices/${cleanLocale}/${cleanSlug}.opus`,
          `${assetBase}/voices/${cleanLocale}/${cleanSlug}.mp3`,
        ]);
      } catch { /* stub mismatch — stay silent */ }
    },
    stopVoice(): void {
      try { tracks?.stopVoice(); } catch { /* stub — stay silent */ }
    },
    voicePlaying(): boolean {
      try {
        return tracks?.isVoicePlaying() === true;
      } catch {
        return false;
      }
    },
    setVoicesEnabled(on: boolean): void {
      voicesOn = on;
      if (!on) {
        try { tracks?.stopVoice(); } catch { /* stub — stay silent */ }
      }
    },
    barkBlip(): void {
      // Soft 180 ms earcon under HUD toasts (caller rate-limits; no per-frame cost here).
      blip(520, 0.18, 'sine', 0.06);
    },
    playStinger(name: string): void {
      // Committed one-shot file (discover/quest-done/quest-fail); missing/disabled = silent.
      // Unlock-gated like everything else (no autoplay violation); never throws.
      if (!unlocked || disposed) return;
      const clean = name.toLowerCase().replace(/[^a-z-]+/g, '');
      if (clean !== 'discover' && clean !== 'quest-done' && clean !== 'quest-fail') return;
      try {
        tracks ??= (opts.createTrackPlayer ?? defaultCreateTrackPlayer)(() => volumeToGain(volume));
      } catch {
        return;
      }
      try {
        void tracks.playOnce([`${assetBase}/music/${clean}.opus`, `${assetBase}/music/${clean}.mp3`]);
      } catch { /* silent */ }
    },
    setVolume(v: number): void {
      volume = Math.max(0, Math.min(1, v));
      if (master) {
        try {
          master.gain.value = volumeToGain(volume);
        } catch { /* stub */ }
      }
      try { tracks?.setVolume(volumeToGain(volume)); } catch { /* stub */ }
    },
    dispose(): void {
      disposed = true;
      trackGen++;
      trackBed = null;
      try { tracks?.stopTrack(); tracks?.stopVoice(); tracks?.dispose(); } catch { /* stub */ }
      tracks = null;
      try {
        if (ambience) {
          try { ambience.src.stop(); } catch { /* already stopped */ }
          ambience = null;
        }
        if (ac && typeof ac.close === 'function') void ac.close();
      } catch { /* stay silent */ }
      ac = null;
      master = null;
      musicBus = null;
    },
  };
}
