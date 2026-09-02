/**
 * Save-file migrations. ARCHITECTURE.md §5.7.
 * Ordered list of {from, to, migrate}; `migrateToCurrent` walks a save forward step by step.
 * Saves newer than `SAVE_SCHEMA_VERSION` are refused outright — there is no way to migrate backwards.
 */
import type { SaveFile } from '@core/schemas';
import { SAVE_SCHEMA_VERSION } from '@core/schemas';

export interface Migration {
  from: number;
  to: number;
  /** `save` is untyped: at `from` it may not match the current `SaveFile` shape yet. */
  migrate(save: any): any;
}

/**
 * v0 -> v1: renames the old `questFlags` field to `flags` (the schemas.ts field SaveFile.flags carries).
 * This is a worked example exercising the migration mechanism, not a real historical schema change
 * (schema 1 is the game's only shipped schema so far).
 */
const v0ToV1: Migration = {
  from: 0,
  to: 1,
  migrate(save: any) {
    const s = { ...save };
    if ('questFlags' in s) {
      s.flags = s.questFlags;
      delete s.questFlags;
    }
    s.flags ??= {};
    s.schemaVersion = 1;
    return s;
  },
};

export const migrations: Migration[] = [v0ToV1];

/** Applies migrations in order until `save.schemaVersion === SAVE_SCHEMA_VERSION`. Throws on a newer save. */
export function migrateToCurrent(save: any): SaveFile {
  let s = save;
  let version: number = typeof s?.schemaVersion === 'number' ? s.schemaVersion : 0;
  if (version > SAVE_SCHEMA_VERSION) {
    throw new Error(
      `This save is from a newer game version (schema ${version}) than this build supports (schema ${SAVE_SCHEMA_VERSION}). ` +
      'Update the game to load it.',
    );
  }
  while (version < SAVE_SCHEMA_VERSION) {
    const m = migrations.find((mm) => mm.from === version);
    if (!m) throw new Error(`No migration path from save schema ${version} to ${SAVE_SCHEMA_VERSION}.`);
    s = m.migrate(s);
    version = m.to;
  }
  return s as SaveFile;
}
