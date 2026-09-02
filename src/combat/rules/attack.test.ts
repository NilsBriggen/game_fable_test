import { describe, it, expect, vi } from 'vitest';
import { Rng } from '@core/rng';
import { rollAttack, rollD20Mode } from './attack';

describe('rollD20Mode (Edge/Burden)', () => {
  it('rolls a flat d20 with no sources', () => {
    const rng = new Rng(1);
    vi.spyOn(rng, 'die').mockReturnValueOnce(14);
    const r = rollD20Mode(rng, [], []);
    expect(r.mode).toBe('normal');
    expect(r.used).toBe(14);
    expect(r.rolls).toEqual([14]);
  });

  it('sources cancel pairwise: 2 edge + 1 burden nets to Edge (best of 2d20)', () => {
    const rng = new Rng(1);
    vi.spyOn(rng, 'die').mockReturnValueOnce(6).mockReturnValueOnce(17);
    const r = rollD20Mode(rng, ['high ground', 'flanked'], ['long range']);
    expect(r.mode).toBe('edge');
    expect(r.used).toBe(17);
  });

  it('sources cancel pairwise: equal counts net to a flat roll', () => {
    const rng = new Rng(1);
    vi.spyOn(rng, 'die').mockReturnValueOnce(9);
    const r = rollD20Mode(rng, ['high ground'], ['long range']);
    expect(r.mode).toBe('normal');
    expect(r.used).toBe(9);
  });

  it('net Burden takes the worst of 2d20', () => {
    const rng = new Rng(1);
    vi.spyOn(rng, 'die').mockReturnValueOnce(18).mockReturnValueOnce(4);
    const r = rollD20Mode(rng, [], ['long range', 'exhausted']);
    expect(r.mode).toBe('burden');
    expect(r.used).toBe(4);
  });

  it('breakdown lists every named source', () => {
    const rng = new Rng(1);
    vi.spyOn(rng, 'die').mockReturnValueOnce(10).mockReturnValueOnce(10);
    const r = rollD20Mode(rng, ['high ground', 'flanked'], []);
    expect(r.breakdown).toContain('Edge: high ground');
    expect(r.breakdown).toContain('Edge: flanked');
  });
});

describe('rollAttack', () => {
  it('a natural 20 is always a critical hit and doubles weapon dice', () => {
    const rng = new Rng(1);
    vi.spyOn(rng, 'die')
      .mockReturnValueOnce(20) // to-hit d20
      .mockReturnValueOnce(4) // first damage die (1d8)
      .mockReturnValueOnce(6); // crit second damage die
    const roll = rollAttack({
      attackBonus: 0, targetDefense: 50, edge: [], burden: [], weaponDice: '1d8', damageType: 'cut',
      damageBonus: 0, soak: { cut: 0, thrust: 0, blunt: 0 },
    }, rng);
    expect(roll.critical).toBe(true);
    expect(roll.hit).toBe(true);
    expect(roll.damageRaw).toBe(10); // 4 + 6
  });

  it('a natural 1 always misses (fumble), regardless of bonus', () => {
    const rng = new Rng(1);
    vi.spyOn(rng, 'die').mockReturnValueOnce(1);
    const roll = rollAttack({
      attackBonus: 99, targetDefense: 1, edge: [], burden: [], weaponDice: '1d8', damageType: 'cut',
      damageBonus: 0, soak: { cut: 0, thrust: 0, blunt: 0 },
    }, rng);
    expect(roll.fumble).toBe(true);
    expect(roll.hit).toBe(false);
  });

  it('soak reduces damage by type; blunt damage bypasses half of blunt soak', () => {
    const rng = new Rng(1);
    vi.spyOn(rng, 'die').mockReturnValueOnce(15).mockReturnValueOnce(6);
    const roll = rollAttack({
      attackBonus: 10, targetDefense: 10, edge: [], burden: [], weaponDice: '1d8', damageType: 'blunt',
      damageBonus: 0, soak: { cut: 0, thrust: 0, blunt: 4 },
    }, rng);
    expect(roll.hit).toBe(true);
    expect(roll.soak).toBe(2); // floor(4/2)
    expect(roll.damage).toBe(roll.damageRaw - 2);
  });

  it('full (non-blunt) soak applies in full', () => {
    const rng = new Rng(1);
    vi.spyOn(rng, 'die').mockReturnValueOnce(15).mockReturnValueOnce(3);
    const roll = rollAttack({
      attackBonus: 10, targetDefense: 10, edge: [], burden: [], weaponDice: '1d6', damageType: 'cut',
      damageBonus: 0, soak: { cut: 5, thrust: 0, blunt: 0 },
    }, rng);
    expect(roll.soak).toBe(5);
    expect(roll.damage).toBe(Math.max(0, roll.damageRaw - 5));
  });

  it('a miss deals no damage', () => {
    const rng = new Rng(1);
    vi.spyOn(rng, 'die').mockReturnValueOnce(2);
    const roll = rollAttack({
      attackBonus: 0, targetDefense: 30, edge: [], burden: [], weaponDice: '1d8', damageType: 'cut',
      damageBonus: 0, soak: { cut: 0, thrust: 0, blunt: 0 },
    }, rng);
    expect(roll.hit).toBe(false);
    expect(roll.damage).toBe(0);
  });
});
