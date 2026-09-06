import { describe, it, expect } from 'vitest';
import { StringCatalog, placeholderSet, isLocaleId } from './i18n';

describe('StringCatalog', () => {
  it('t() falls back to en, then to the id itself', () => {
    const c = new StringCatalog();
    c.loadEn({ 'a.b': 'Hello {player}' });
    c.setLocale('de');
    expect(c.t('a.b')).toBe('Hello {player}'); // no overlay yet → en
    c.setOverlay('de', { 'a.b': 'Hallo {player}' });
    expect(c.t('a.b')).toBe('Hallo {player}');
    expect(c.t('missing.id')).toBe('missing.id');
  });
  it('missingIn reports untranslated en IDs', () => {
    const c = new StringCatalog();
    c.loadEn({ a: 'x', b: 'y' });
    c.setOverlay('de', { a: 'x-de' });
    expect(c.missingIn('de')).toEqual(['b']);
  });
  it('placeholderSet finds {tokens}', () => {
    expect([...placeholderSet('Hi {player}, meet {origin} at {time}')].sort()).toEqual(['origin', 'player', 'time']);
    expect(placeholderSet('no tokens').size).toBe(0);
  });
  it('isLocaleId narrows en/de/gsw only', () => {
    expect(isLocaleId('de')).toBe(true);
    expect(isLocaleId('fr')).toBe(false);
    expect(isLocaleId(undefined)).toBe(false);
  });
});
