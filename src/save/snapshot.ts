/**
 * Building a `SaveFile` from live game state, and applying one back. ARCHITECTURE.md §3.4.
 * Optional services (party/quest/exploration/combat) are read via `services.tryGet` and default
 * to empty/neutral values when not registered, so this works from wave 1 (world+save only) onward.
 */
import type { SaveFile, Canton } from '@core/schemas';
import { SAVE_SCHEMA_VERSION } from '@core/schemas';
import { Player, Transform } from '@core/components';
import type { GfxLike, SaveHost } from './host';

const DEFAULT_CHAPTER = 'prologue-1291';

function defaultQuestData(): Pick<SaveFile, 'quests' | 'reputation' | 'flags' | 'journal' | 'chapter'> {
  return { quests: {}, reputation: {}, flags: {}, journal: [], chapter: DEFAULT_CHAPTER };
}

const THUMB_MAX_BYTES = 12 * 1024;

/** Draws the current frame to a 160x90 JPEG data URL (<=12KB). Returns undefined if unavailable/unreadable. */
function renderThumbnail(gfx: GfxLike | undefined): string | undefined {
  if (!gfx || typeof document === 'undefined') return undefined;
  try {
    const src = gfx.renderer.domElement;
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 90;
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) return undefined;
    ctx2d.drawImage(src, 0, 0, 160, 90);
    const url = canvas.toDataURL('image/jpeg', 0.6);
    const comma = url.indexOf(',');
    const approxBytes = comma >= 0 ? Math.ceil(((url.length - comma - 1) * 3) / 4) : url.length;
    if (approxBytes > THUMB_MAX_BYTES) return undefined;
    return url;
  } catch (err) {
    console.warn('[save] thumbnail capture skipped', err);
    return undefined;
  }
}

/** Gathers a full `SaveFile` from live game state. Does not touch storage. */
export function buildSnapshot(host: SaveHost, slot: number, label?: string): SaveFile {
  const now = new Date().toISOString();
  const services = host.services;
  const quest = services.tryGet('quest');
  const party = services.tryGet('party');
  const exploration = services.tryGet('exploration');
  const combat = services.tryGet('combat');

  const questData = quest ? quest.serialize() : defaultQuestData();
  const discovered = exploration ? exploration.discovered() : [];
  const combatData = combat && combat.isActive() ? (combat.serialize() ?? undefined) : undefined;

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
    thumbnailDataUrl: renderThumbnail(host.gfx),
  };
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
