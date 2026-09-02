/**
 * Save module. ARCHITECTURE.md §3.4, §4 (SaveService), §5.7.
 * Registers `SaveService`, an autosave scheduler (`always`-phase system), and F5/F9 quick-save/load.
 */
import type { GameContext } from '@core/context';
import type { SaveFile, SaveMeta } from '@core/schemas';
import { AUTOSAVE_SLOT, QUICKSAVE_SLOT } from '@core/schemas';
import type { SaveService, Weather } from '@core/services';
import { Transform } from '@core/components';
import type { SaveHost } from './host';
import type { SaveStore } from './db';
import { assertSaveShape, createSaveStore, decodeSave, encodeSave, metaFromSave } from './db';
import { applyWorldState, buildSnapshot } from './snapshot';
import { migrateToCurrent } from './migrations';

const AUTOSAVE_INTERVAL_SEC = 10 * 60;
const NEW_GAME_AUTOSAVE_DELAY_MS = 2000;

/** The `SaveService` implementation. Exported (with `createSaveService`) so tests can exercise it
 * against a synthetic `SaveHost` without going through `register`/`GameContext`. */
export class SaveServiceImpl implements SaveService {
  /** save()/load() calls on this instance are serialised through here — otherwise an autosave
   * racing a load() could snapshot (or overwrite) a half-restored world. */
  private busy: Promise<void> = Promise.resolve();

  constructor(private host: SaveHost, private store: SaveStore) {}

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.busy.then(fn, fn);
    this.busy = run.then(() => undefined, () => undefined);
    return run;
  }

  async save(slot: number, label?: string): Promise<SaveMeta> {
    return this.serialize(async () => {
      const createdAt = await this.existingCreatedAt(slot);
      const save = buildSnapshot(this.host, slot, label);
      if (createdAt) save.createdAt = createdAt;
      const bytes = await encodeSave(save);
      const meta = metaFromSave(save, bytes.byteLength);
      await this.store.put(slot, bytes, meta);
      return meta;
    });
  }

  async load(slot: number): Promise<void> {
    return this.serialize(() => this.doLoad(slot));
  }

  private async doLoad(slot: number): Promise<void> {
    const host = this.host;
    const ui = host.services.tryGet('ui');
    // Tracks whether `applyWorldState()` (resetWorld + world.load) has run. Everything before that
    // point is recoverable — the live game is untouched — so a failure there returns the player to
    // wherever they were (`ctx.state.prev`, pinned the instant we transition into 'loading' below)
    // instead of unconditionally discarding an intact in-progress game by forcing 'title'.
    let worldTouched = false;
    try {
      // Emitting 'loading' first (rather than after decode/migrate) is what makes `ctx.state.prev`
      // meaningful on failure below: it pins "the state we were in right before this load attempt".
      host.events.emit('request-state', 'loading');
      ui?.loading(true, 'Loading…');

      const bytes = await this.store.get(slot);
      if (!bytes) throw new Error(`No save in slot ${slot}`);
      const raw = await decodeSave(bytes);
      const migrated = migrateToCurrent(raw);
      assertSaveShape(migrated);
      const save: SaveFile = migrated;

      // Set *before* calling applyWorldState: once resetWorld()/world.load() have started, the live
      // world is touched even if a later step in applyWorldState throws partway through.
      worldTouched = true;
      applyWorldState(host, save);

      const quest = host.services.tryGet('quest');
      const exploration = host.services.tryGet('exploration');
      const combat = host.services.tryGet('combat');
      const world = host.services.tryGet('world');

      if (quest) {
        quest.restore({ quests: save.quests, reputation: save.reputation, flags: save.flags, journal: save.journal, chapter: save.chapter });
      }
      if (exploration) exploration.setDiscovered(save.discovered);
      if (save.weather && world) world.setWeather(save.weather as Weather);

      // Let modules re-create transient components (meshes, etc.) from the restored persistent ones.
      host.events.emit('loaded');

      if (world) {
        // save.playerId is authoritative (it's what was actually saved); exploration.getPlayer()
        // is only a fallback for the (currently stub) case where the exploration module hasn't
        // re-bound its own player entity from a 'loaded' handler yet.
        const playerEntity = save.playerId || exploration?.getPlayer() || null;
        const t = playerEntity ? host.world.get(playerEntity, Transform) : undefined;
        if (t) await world.streamAround(t.x, t.z, 800);
      }

      if (save.combat && combat) {
        await combat.restore(save.combat);
        host.events.emit('request-state', 'combat');
      } else {
        host.events.emit('request-state', 'explore');
      }
      ui?.loading(false);
    } catch (err) {
      console.error('[save] load failed', err);
      ui?.toast('Could not load save', 'warning');
      ui?.loading(false);
      host.events.emit('request-state', worldTouched ? 'title' : host.state.prev);
    }
  }

  async list(): Promise<SaveMeta[]> {
    return this.store.list();
  }

  async delete(slot: number): Promise<void> {
    await this.store.delete(slot);
  }

  async hasAny(): Promise<boolean> {
    return (await this.store.list()).length > 0;
  }

  async autosave(): Promise<SaveMeta> {
    return this.save(AUTOSAVE_SLOT, 'Autosave');
  }

  async exportJson(slot: number): Promise<string> {
    const bytes = await this.store.get(slot);
    if (!bytes) throw new Error(`No save in slot ${slot}`);
    const save = await decodeSave(bytes);
    return JSON.stringify(save, null, 2);
  }

  async importJson(json: string, slot: number): Promise<SaveMeta> {
    let raw: unknown;
    try {
      raw = JSON.parse(json);
    } catch (err) {
      throw new Error(`Invalid save JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
    const migrated = migrateToCurrent(raw);
    assertSaveShape(migrated);
    const save: SaveFile = migrated;
    save.slot = slot;
    const bytes = await encodeSave(save);
    const meta = metaFromSave(save, bytes.byteLength);
    await this.store.put(slot, bytes, meta);
    return meta;
  }

  /** Reads the previous save's `createdAt` from its stored `SaveMeta` — `SaveMeta.createdAt` is
   * already tracked per-slot by the store, so this needs no decode/decompression of the old file. */
  private async existingCreatedAt(slot: number): Promise<string | undefined> {
    try {
      const metas = await this.store.list();
      return metas.find((m) => m.slot === slot)?.createdAt;
    } catch {
      return undefined; // corrupt/missing prior save: just start a fresh createdAt
    }
  }
}

export function createSaveService(host: SaveHost, store: SaveStore): SaveService {
  return new SaveServiceImpl(host, store);
}

export async function register(ctx: GameContext): Promise<void> {
  if (ctx.services.has('save')) return; // guards against double registration, e.g. Vite HMR re-eval

  const store = createSaveStore();
  const svc = new SaveServiceImpl(ctx, store);
  ctx.services.register('save', svc);

  function triggerAutosave(): void {
    void svc.autosave().catch((err) => console.error('[save] autosave failed', err));
  }

  // Autosave requests defer to the next 'explore' tick when currently in combat/dialogue/cutscene
  // (never in the middle of one of those); fire immediately when already exploring.
  let pendingAutosave = false;
  function requestAutosave(): void {
    if (ctx.state.state === 'explore') triggerAutosave();
    else pendingAutosave = true;
  }

  // §5.7 autosave triggers:
  // - new game (deferred: 'new-game' fires just before the opening cutscene/dialogue starts)
  ctx.events.on('new-game', () => {
    setTimeout(requestAutosave, NEW_GAME_AUTOSAVE_DELAY_MS);
  });
  // - new chapter
  ctx.events.on('chapter-changed', () => requestAutosave());
  // - encounter start: this one must carry the `combat` block by design, so it saves *in* combat —
  //   call triggerAutosave() directly rather than requestAutosave(), which would defer it.
  ctx.events.on('state-changed', (from, to) => {
    if (from === 'explore' && to === 'combat') triggerAutosave();
  });
  // - quest complete/advance, and fast travel: hooked lazily below once their services exist.
  let questHooked = false;
  let explorationHooked = false;

  // - every 10 minutes of playtime, checked once per second, only while exploring.
  let lastAutosaveBucket = -1;
  let accSec = 0;
  ctx.scheduler.add({
    name: 'save-autosave',
    phase: 'always',
    order: 900,
    update(dt: number) {
      if (!questHooked) {
        const quest = ctx.services.tryGet('quest');
        if (quest) {
          questHooked = true;
          quest.on('quest-completed', () => requestAutosave());
          quest.on('quest-advanced', () => requestAutosave());
        }
      }
      if (!explorationHooked) {
        const exploration = ctx.services.tryGet('exploration');
        if (exploration) {
          explorationHooked = true;
          exploration.on('fast-travel', () => requestAutosave());
        }
      }

      accSec += dt;
      if (accSec < 1) return;
      accSec = 0;

      const exploring = ctx.state.state === 'explore';
      if (pendingAutosave && exploring) {
        pendingAutosave = false;
        triggerAutosave();
        return;
      }
      if (!exploring) return;

      const bucket = Math.floor(ctx.playtimeSec / AUTOSAVE_INTERVAL_SEC);
      if (bucket > lastAutosaveBucket && bucket > 0) {
        lastAutosaveBucket = bucket;
        triggerAutosave();
      }
    },
  });

  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', (e) => {
      if (ctx.state.state !== 'explore') return;
      if (e.key === 'F5') {
        e.preventDefault();
        void svc.save(QUICKSAVE_SLOT, 'Quicksave').then(
          (meta) => ctx.services.tryGet('ui')?.toast(`Saved: ${meta.label}`, 'info'),
          (err) => {
            console.error('[save] quicksave failed', err);
            ctx.services.tryGet('ui')?.toast('Quicksave failed', 'warning');
          },
        );
      } else if (e.key === 'F9') {
        e.preventDefault();
        void svc.load(QUICKSAVE_SLOT);
      }
    });
  }
}
