import { describe, it, expect } from 'vitest';
import { clampRep, isHostileRep, repBand, repToastMessage } from './reputation';
import type { FactionDef } from '@core/schemas';

const habsburg: FactionDef = { id: 'habsburg', name: 'House of Habsburg-Austria', kind: 'house', hostileTo: ['uri', 'schwyz', 'unterwalden'], hostileBelow: -40, description: '', historical: true, note: 'x' };

describe('reputation bands', () => {
  it('matches Outlaw < -60 < Suspect < -20 < Unknown < 20 < Trusted < 60 < Eidgenoss', () => {
    expect(repBand(-100)).toBe('outlaw');
    expect(repBand(-61)).toBe('outlaw');
    expect(repBand(-60)).toBe('suspect');
    expect(repBand(-21)).toBe('suspect');
    expect(repBand(-20)).toBe('unknown');
    expect(repBand(0)).toBe('unknown');
    expect(repBand(19)).toBe('unknown');
    expect(repBand(20)).toBe('trusted');
    expect(repBand(59)).toBe('trusted');
    expect(repBand(60)).toBe('eidgenoss');
    expect(repBand(100)).toBe('eidgenoss');
  });

  it('clamps to [-100, 100]', () => {
    expect(clampRep(150)).toBe(100);
    expect(clampRep(-150)).toBe(-100);
    expect(clampRep(10)).toBe(10);
  });

  it('isHostileRep: habsburg hostileBelow -40', () => {
    expect(isHostileRep(-41, habsburg, false)).toBe(true);
    expect(isHostileRep(-40, habsburg, false)).toBe(false);
    expect(isHostileRep(0, habsburg, false)).toBe(false);
  });

  it('isHostileRep: an explicit hostile flag always wins', () => {
    expect(isHostileRep(50, habsburg, true)).toBe(true);
  });

  it('isHostileRep: factions with no hostileBelow are never rep-hostile', () => {
    const uri: FactionDef = { id: 'uri', name: 'Land Uri', kind: 'canton', hostileTo: [], description: '', historical: true, note: 'x' };
    expect(isHostileRep(-100, uri, false)).toBe(false);
  });

  it('repToastMessage phrases better/worse', () => {
    expect(repToastMessage(habsburg, 10)).toMatch(/think better of you/);
    expect(repToastMessage(habsburg, -10)).toMatch(/think worse of you/);
  });
});
