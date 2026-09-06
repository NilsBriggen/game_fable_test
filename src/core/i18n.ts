/**
 * i18n — locale catalog, loader, and display-time lookup (Phase 4 4.3 main track).
 *
 * Design (keeps translators decoupled from main):
 * - String IDs are stable, additive-only after the snapshot freeze:
 *   `quest.<qid>.title`, `quest.<qid>.stage.<sid>.journal`, `quest.<qid>.stage.<sid>.objective`,
 *   `dlg.<did>.node.<nid>.text`, `dlg.<did>.node.<nid>.variant.<n>`, `dlg.<did>.node.<nid>.choice.<n>`,
 *   plus UI chrome `ui.*`, cutscene captions `cs.<cid>.shot.<n>`, toast/journal misc `misc.*`.
 * - Content defs are NEVER rewritten per language. Everything resolves at display time via `t()`:
 *   the dialogue runner (`quest/dialogue.ts`), the quest machine journal path (`quest/quests.ts`),
 *   and UI chrome call sites.
 * - Locales: `en` is builtin (extracted from content at load — the source of truth); `de`/`gsw` are
 *   JSON overlays keyed by the same IDs, missing keys fall back to `en`. Placeholders like
 *   `{player}`/`{origin}`/`{time}` are preserved byte-identical — substitution still happens
 *   downstream of `t()`, so translators must not rename or drop them.
 * - `tools/i18n/strings.en.json` is the frozen export translators work from (extraction entry:
 *   `tools/i18n/extract.test.ts`); `tools/i18n/check.test.ts` validates a translation file (parse, 100% ID
 *   coverage, placeholder set equality). Run: `npx vitest run --config tools/i18n/vitest.config.ts`.
 */

export type LocaleId = 'en' | 'de' | 'gsw';

export const LOCALES: { id: LocaleId; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'de', label: 'Deutsch' },
  { id: 'gsw', label: 'Schwyzerdütsch (Experiment)' },
];

export function isLocaleId(v: unknown): v is LocaleId {
  return v === 'en' || v === 'de' || v === 'gsw';
}

/** `{player}`-style placeholder names found in a string — order-free set for validation. */
export function placeholderSet(s: string): Set<string> {
  const out = new Set<string>();
  for (const m of s.matchAll(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g)) out.add(m[1]);
  return out;
}

/**
 * Minimal catalog: `en` table is filled by extraction at content-load time; overlays are loaded
 * from JSON (`setOverlay`). Lookup falls back to `en`, then to the id itself (never undefined —
 * a missing key renders visibly wrong, not blank).
 */
export class StringCatalog {
  private en = new Map<string, string>();
  private overlays = new Map<LocaleId, Map<string, string>>();
  private locale: LocaleId = 'en';

  setLocale(locale: LocaleId): void { this.locale = locale; }
  getLocale(): LocaleId { return this.locale; }

  /** Bulk-load the `en` source table (extraction output). Replaces, does not merge. */
  loadEn(table: Record<string, string>): void {
    this.en = new Map(Object.entries(table));
  }

  /** Load one translation overlay (translator JSON). Replaces that locale's overlay. */
  setOverlay(locale: LocaleId, table: Record<string, string>): void {
    this.overlays.set(locale, new Map(Object.entries(table)));
  }

  /** Display-time lookup with en-fallback, then id-fallback. No substitution here. */
  t(id: string): string {
    if (this.locale !== 'en') {
      const hit = this.overlays.get(this.locale)?.get(id);
      if (hit !== undefined) return hit;
    }
    return this.en.get(id) ?? id;
  }

  enSize(): number { return this.en.size; }
  overlaySize(locale: LocaleId): number { return this.overlays.get(locale)?.size ?? 0; }

  /** IDs present in `en` but missing from the overlay — the translator's remaining work. */
  missingIn(locale: LocaleId): string[] {
    const over = this.overlays.get(locale);
    const out: string[] = [];
    for (const id of this.en.keys()) if (!over?.has(id)) out.push(id);
    return out;
  }
}

/** Shared singleton: content extraction fills it, UI/quest read through it. */
export const strings = new StringCatalog();
