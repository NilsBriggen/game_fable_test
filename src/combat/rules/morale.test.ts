import { describe, it, expect, vi } from 'vitest';
import { Rng } from '@core/rng';
import { moraleCheck, moraleDc } from './morale';

describe('moraleCheck', () => {
  it('passes ("steady") when total meets or beats the DC', () => {
    const rng = new Rng(1);
    vi.spyOn(rng, 'die').mockReturnValueOnce(15);
    const r = moraleCheck({ presenceMod: 0, leadershipLevel: 0, formationBonus: 0, moraleBonusPerk: 0, dc: 10 }, rng);
    expect(r.passed).toBe(true);
    expect(r.outcome).toBe('steady');
  });

  it('fails narrowly (margin > -5) → Shaken', () => {
    const rng = new Rng(1);
    vi.spyOn(rng, 'die').mockReturnValueOnce(8);
    const r = moraleCheck({ presenceMod: 0, leadershipLevel: 0, formationBonus: 0, moraleBonusPerk: 0, dc: 10 }, rng);
    expect(r.passed).toBe(false);
    expect(r.margin).toBe(-2);
    expect(r.outcome).toBe('shaken');
  });

  it('fails by 5 or more → Routed', () => {
    const rng = new Rng(1);
    vi.spyOn(rng, 'die').mockReturnValueOnce(2);
    const r = moraleCheck({ presenceMod: 0, leadershipLevel: 0, formationBonus: 0, moraleBonusPerk: 0, dc: 10 }, rng);
    expect(r.margin).toBeLessThanOrEqual(-5);
    expect(r.outcome).toBe('routed');
  });

  it('an inHaufen unit rolls with Edge (best of 2d20)', () => {
    const rng = new Rng(1);
    vi.spyOn(rng, 'die').mockReturnValueOnce(4).mockReturnValueOnce(19);
    const r = moraleCheck({ presenceMod: 0, leadershipLevel: 0, formationBonus: 0, moraleBonusPerk: 0, dc: 10, edge: true }, rng);
    expect(r.roll).toBe(19);
    expect(r.outcome).toBe('steady');
  });

  it('leadership, formation and perk bonuses all add to the total', () => {
    const rng = new Rng(1);
    vi.spyOn(rng, 'die').mockReturnValueOnce(5);
    const r = moraleCheck({ presenceMod: 1, leadershipLevel: 50, formationBonus: 2, moraleBonusPerk: 5, dc: 10 }, rng);
    // bonus = 1 + floor(50/10) + 2 + 5 = 13; total 18 vs dc 10 -> steady
    expect(r.bonus).toBe(13);
    expect(r.outcome).toBe('steady');
  });
});

describe('moraleDc', () => {
  it('is 10 at base severity and +2 per additional severity step', () => {
    expect(moraleDc(1)).toBe(10);
    expect(moraleDc(2)).toBe(12);
    expect(moraleDc(3)).toBe(14);
  });
});
