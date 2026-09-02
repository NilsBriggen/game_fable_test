/**
 * Save module. ARCHITECTURE.md §3.4, §4 (SaveService), §5.7.
 * Registers `SaveService`, an autosave scheduler (`always`-phase system), and F5/F9 quick-save/load.
 */
import type { GameContext } from '@core/context';
import type { SaveMeta } from '@core/schemas';
import type { SaveService } from '@core/services';
import { Transform } from '@core/components';
import type { SaveHost } from './host';
import type { SaveStore } from './db';
import { createSaveStore, decodeSave, encodeSave, metaFromSave } from './db';
import { applyWorldState, buildSnapshot } from './snapshot';
import { migrateToCurrent } from './migrations';

const AUTOSAVE_SLOT = 0;
const QUICKSAVE_SLOT = 1;
const AUTOSAVE_INTERVAL_SEC = 10 * 60;
const NEW_GAME_AUTOSAVE_DELAY_MS = 2000;

/** The `SaveService` implementation. Exported (with `createSaveService`) so tests can exercise it
 * against a synthetic `SaveHost` without going through `register`/`GameContext`. */
export class SaveServiceImpl implements SaveService {
  constructor(private host: SaveHost, private store: SaveStore) {}

  async save(slot: number, label?: string): Promise<SaveMeta> {
    const createdAt = await this.existingCreatedAt(slot);
    const save = buildSnapshot(this.host, slot, label);
    if (createdAt) save.createdAt = createdAt;
    const bytes = await encodeSave(save);
    const meta = metaFromSave(save, bytes.byteLength, this.host.clock.calendar().label);
    await this.store.put(slot, bytes, meta);
    return meta;
  }

  async load(slot: number): Promise<void> {
    const host = this.host;
    const ui = host.services.tryGet('ui');
    host.events.emit('request-state', 'loading');
    ui?.loading(true, 'Loading…');
    try {
      const bytes = await this.store.get(slot);
      if (!bytes) throw new Error(`No save in slot ${slot}`);
      const raw = await decodeSave(bytes);
      const save = migrateToCurrent(raw);

      applyWorldState(host, save);

      const quest = host.services.tryGet('quest');
      const exploration = host.services.tryGet('exploration');
      const combat = host.services.tryGet('combat');
      const world = host.services.tryGet('world');

      if (quest) {
        quest.restore({ quests: save.quests, reputation: save.reputation, flags: save.flags, journal: save.journal, chapter: save.chapter });
      }
      if (exploration) exploration.setDiscovered(save.discovered);

      // Let modules re-create transient components (meshes, etc.) from the restored persistent ones.
      host.events.emit('loaded');

      if (exploration && world) {
        const player = exploration.getPlayer();
        const t = player !== null ? host.world.get(player, Transform) : undefined;
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
      host.events.emit('request-state', 'title');
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
    if (typeof raw !== 'object' || raw === null || typeof (raw as { schemaVersion?: unknown }).schemaVersion !== 'number') {
      throw new Error('Invalid save: missing schemaVersion');
    }
    const save = migrateToCurrent(raw);
    save.slot = slot;
    const bytes = await encodeSave(save);
    const meta = metaFromSave(save, bytes.byteLength, this.host.clock.calendar().label);
    await this.store.put(slot, bytes, meta);
    return meta;
  }

  private async existingCreatedAt(slot: number): Promise<string | undefined> {
    try {
      const bytes = await this.store.get(slot);
      if (!bytes) return undefined;
      const save = await decodeSave(bytes);
      return save.createdAt;
    } catch {
      return undefined; // corrupt/missing prior save: just start a fresh createdAt
    }
  }
}

export function createSaveService(host: SaveHost, store: SaveStore): SaveService {
  return new SaveServiceImpl(host, store);
}

export async function register(ctx: GameContext): Promise<void> {
  const store = createSaveStore();
  const svc = new SaveServiceImpl(ctx, store);
  ctx.services.register('save', svc);

  function triggerAutosave(): void {
    void svc.autosave().catch((err) => console.error('[save] autosave failed', err));
  }

  // Autosave once, 2s after a new game starts (and after each subsequent 'new-game', e.g. harness re-rolls).
  ctx.events.on('new-game', () => {
    setTimeout(triggerAutosave, NEW_GAME_AUTOSAVE_DELAY_MS);
  });

  // Autosave on quest milestones — deferred to the next 'explore' tick if currently in combat/dialogue/cutscene.
  // Subscribed lazily since the quest module may register after this one.
  let pendingAutosave = false;
  let questHooked = false;
  function requestAutosave(): void {
    if (ctx.state.state === 'explore') triggerAutosave();
    else pendingAutosave = true;
  }

  // Time-based autosave: every 10 minutes of playtime, checked once per second, only while exploring.
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
          quest.on('quest-completed', requestAutosave);
          quest.on('quest-advanced', requestAutosave);
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
