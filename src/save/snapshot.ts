/**
 * Building a `SaveFile` from live game state, and applying one back. ARCHITECTURE.md §3.4.
 * Optional services (party/quest/exploration/combat) are read via `services.tryGet` and default
 * to empty/neutral values when not registered, so this works from wave 1 (world+save only) onward.
 */
import type { SaveFile, Canton, SerializedCombat } from '@core/schemas';
import { SAVE_SCHEMA_VERSION } from '@core/schemas';
import { isDifficulty } from '@core/context';
import { Player, Transform } from '@core/components';
import type { GfxLike, SaveHost } from './host';

const DEFAULT_CHAPTER = 'prologue-1291';

function defaultQuestData(): Pick<SaveFile, 'quests' | 'reputation' | 'flags' | 'journal' | 'chapter'> {
  return { quests: {}, reputation: {}, flags: {}, journal: [], chapter: DEFAULT_CHAPTER };
}

const THUMB_MAX_BYTES = 12 * 1024;
const THUMB_QUALITIES = [0.6, 0.4, 0.3];

function approxDataUrlBytes(url: string): number {
  const comma = url.indexOf(',');
  return comma >= 0 ? Math.ceil(((url.length - comma - 1) * 3) / 4) : url.length;
}

/** Renders the current frame and draws it to a 160x90 JPEG data URL (<=12KB), retrying at lower
 * quality before giving up. Returns undefined if unavailable/unreadable — never throws. */
function renderThumbnail(gfx: GfxLike | undefined): string | undefined {
  if (!gfx || typeof document === 'undefined') return undefined;
  try {
    // The canvas's WebGL drawing buffer is typically cleared right after compositing, so grabbing
    // it lazily (e.g. from a keydown handler) captures a black/stale frame. Render synchronously,
    // then read the buffer back in the same task.
    gfx.render();
    const src = gfx.renderer.domElement;
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 90;
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) return undefined;
    ctx2d.drawImage(src, 0, 0, 160, 90);
    for (const quality of THUMB_QUALITIES) {
      const url = canvas.toDataURL('image/jpeg', quality);
      if (approxDataUrlBytes(url) <= THUMB_MAX_BYTES) return url;
    }
    return undefined; // even the lowest quality didn't fit the budget
  } catch (err) {
    console.warn('[save] thumbnail capture skipped', err);
    return undefined;
  }
}

/** Gathers a full `SaveFile` from live game state. Does not touch storage. */
export function buildSnapshot(host: SaveHost, slot: number, label?: string): SaveFile {
  // A save taken mid-`load()` (e.g. an autosave timer racing a load) would snapshot a half-restored
  // world — refuse outright rather than write a corrupt/misleading file. `SaveServiceImpl` also
  // serialises its own save()/load() calls against each other, so this is a defensive backstop.
  if (host.state.state === 'loading') {
    throw new Error('Cannot save while a load is in progress');
  }

  const now = new Date().toISOString();
  const services = host.services;
  const quest = services.tryGet('quest');
  const party = services.tryGet('party');
  const exploration = services.tryGet('exploration');
  const combat = services.tryGet('combat');
  const world = services.tryGet('world');

  const questData = quest ? quest.serialize() : defaultQuestData();
  const discovered = exploration ? exploration.discovered() : [];

  // A save taken while actively in combat must carry the combat block, or it silently reloads mid-fight
  // units into a frozen `explore` state. If combat claims to be active but has nothing to serialise,
  // that's a bug worth surfacing loudly rather than writing a misleading save.
  let combatData: SerializedCombat | undefined;
  if (combat?.isActive()) {
    const serialized = combat.serialize();
    if (!serialized) throw new Error('Cannot save: combat is active but combat.serialize() returned no state');
    combatData = serialized;
  }

  const playerId = party?.getPlayer() ?? 0;
  const partyIds = party?.getParty() ?? [];

  let playerOrigin: Canton = 'uri';
  let location = 'Unknown';
  if (playerId) {
    const p = host.world.get(playerId, Player);
    if (p) playerOrigin = p.origin;
    const t = host.world.get(playerId, Transform);
    if (t && exploration) {
      const poi = exploration.nearestPoi(t.x, t.z);
      if (poi) location = poi.name;
    }
  }

  const calendarLabel = host.clock.calendar().label;
  const finalLabel = label ?? `${calendarLabel} — ${location}`;

  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    slot,
    label: finalLabel,
    createdAt: now,
    updatedAt: now,
    seed: host.seed,
    gameTime: host.clock.time,
    chapter: questData.chapter,
    // 4.4: difficulty lives in save metadata (tolerant-optional — no schema bump: old saves simply
    // omit it and load as 'normal'). Read from the live settings via structural access so this
    // snapshot helper stays decoupled from a full GameContext import (cf. CombatHost.difficulty).
    difficulty: isDifficulty((host as { settings?: { difficulty?: unknown } }).settings?.difficulty)
      ? (host as { settings: { difficulty: 'story' | 'normal' | 'hard' } }).settings.difficulty
      : 'normal',
    world: host.world.serialize(),
    playerId,
    party: partyIds,
    quests: questData.quests,
    reputation: questData.reputation,
    discovered,
    flags: questData.flags,
    journal: questData.journal,
    combat: combatData,
    rngState: host.rng.serialize(),
    playtimeSec: host.playtimeSec,
    playerOrigin,
    location,
    weather: world?.getWeather(),
    season: host.clock.season(),
    thumbnailDataUrl: renderThumbnail(host.gfx),
  };
}

/**
 * 4.4: restores the save's difficulty metadata into live settings (tolerant: absent/unknown → 'normal',
 * no migration, no player-save deletion). Kept as a pure helper next to applyWorldState so callers
 * without a full GameContext (tests, headless hosts) can drive it through structural settings access.
 */
export function applyDifficulty(host: { settings?: { difficulty?: unknown } }, save: { difficulty?: unknown }): 'story' | 'normal' | 'hard' {
  const difficulty = isDifficulty(save.difficulty) ? save.difficulty : 'normal';
  if (host.settings) host.settings.difficulty = difficulty;
  return difficulty;
}

/**
 * Restores the core (integrator-owned) parts of a save: world, RNG streams, clock, playtime.
 * Matches ARCHITECTURE.md/§main.ts newGame ordering. Callers (src/save/index.ts) handle the
 * remaining orchestration: optional-service restore, the `'loaded'` event, streaming, and state
 * transitions, since those need try/catch + UI feedback that doesn't belong in a pure snapshot helper.
 */
export function applyWorldState(host: SaveHost, save: SaveFile): void {
  host.resetWorld();
  host.reseed(save.seed);
  host.rng.restore(save.rngState);
  host.world.load(save.world);
  host.clock.set(save.gameTime);
  host.playtimeSec = save.playtimeSec;
}
