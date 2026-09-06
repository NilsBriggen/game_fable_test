import { describe, it, expect } from 'vitest';
import { ContentRegistry } from '@core/content';
import { loadContent } from '@content/index';
import { fillEnCatalog } from './index';
import { strings } from '@core/i18n';
import { makeTestContext } from './testHarness';

/**
 * 4.3 i18n drift guard: the runtime catalog fill (`fillEnCatalog`, used by the game) and the frozen
 * translator snapshot (`tools/i18n/strings.en.json`, produced by `tools/i18n/extract.test.ts`) must
 * agree exactly. If content text changes, re-run the extractor to re-freeze — translators work from
 * the snapshot, and a silent desync would strand their IDs.
 *
 * NOTE: this test reads the snapshot JSON via fetch-free file access — it runs under vitest's node
 * environment where dynamic import of JSON is available; keep it dependency-free.
 */
describe('i18n snapshot drift', () => {
  it('fillEnCatalog output matches the frozen strings.en.json', async () => {
    const mod = (await import('../../tools/i18n/strings.en.json')) as { default: Record<string, string> };
    const snapshot = mod.default;
    const ctx = makeTestContext(1);
    loadContent(ctx.content);
    fillEnCatalog(ctx);
    const live: Record<string, string> = {};
    // read back through the catalog via t() over snapshot keys plus size check
    for (const id of Object.keys(snapshot)) live[id] = strings.t(id);
    expect(live).toEqual(snapshot);
    expect(strings.enSize()).toBe(Object.keys(snapshot).length);
    void ContentRegistry;
  });
});
