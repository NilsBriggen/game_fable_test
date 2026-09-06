/**
 * i18n translation validator (Phase 4 4.3 main track). Run:
 * `npx vitest run --config tools/i18n/vitest.config.ts`
 *
 * For each `tools/i18n/strings.<locale>.json` present (de, gsw):
 * 1. parses as JSON (a broken file fails loudly, not silently);
 * 2. asserts 100% ID coverage against the frozen `strings.en.json` snapshot (no missing, no orphan IDs —
 *    orphan = translator worked from a stale snapshot or invented keys);
 * 3. asserts every translated value's `{placeholder}` set equals the en source's (substitution happens
 *    downstream of t(), so a renamed/dropped placeholder would leak raw `{...}` or crash formatting).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));

function placeholderSet(s: string): Set<string> {
  const out = new Set<string>();
  for (const m of s.matchAll(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g)) out.add(m[1]);
  return out;
}

const en: Record<string, string> = JSON.parse(readFileSync(join(dir, 'strings.en.json'), 'utf8'));

describe('i18n translation files', () => {
  for (const locale of ['de', 'gsw']) {
    describe(`strings.${locale}.json`, () => {
      const path = join(dir, `strings.${locale}.json`);
      const delivered = existsSync(path);
      if (!delivered) {
        it.skip('not yet delivered by the translation lane', () => {});
      } else {
        const table: Record<string, string> = JSON.parse(readFileSync(path, 'utf8'));
        it('covers 100% of en IDs with no orphans', () => {
          const missing = Object.keys(en).filter((id) => !(id in table));
          const orphans = Object.keys(table).filter((id) => !(id in en));
          expect({ missing: missing.slice(0, 10), missingCount: missing.length }).toEqual({ missing: [], missingCount: 0 });
          expect({ orphans: orphans.slice(0, 10), orphanCount: orphans.length }).toEqual({ orphans: [], orphanCount: 0 });
        });
        it('preserves every placeholder set exactly', () => {
          const bad: string[] = [];
          for (const [id, src] of Object.entries(en)) {
            const dst = table[id];
            if (typeof dst !== 'string') continue;
            const a = [...placeholderSet(src)].sort().join(',');
            const b = [...placeholderSet(dst)].sort().join(',');
            if (a !== b) bad.push(`${id}: en={${a}} vs ${locale}={${b}}`);
            if (!dst.length) bad.push(`${id}: empty translation`);
          }
          expect(bad.slice(0, 10)).toEqual([]);
        });
      }
    });
  }
});
