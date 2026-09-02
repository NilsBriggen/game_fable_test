import { describe, it, expect } from 'vitest';
import { resolveSchedule, nextScheduleEntry, analyticPosition } from './schedule';
import type { ScheduleEntry } from '@core/schemas';

const SCHEDULE: ScheduleEntry[] = [
  { hour: 6, poi: 'home', activity: 'work' },
  { hour: 12, poi: 'poi.market', activity: 'market' },
  { hour: 19, poi: 'home', activity: 'tavern' },
  { hour: 22, poi: 'home', activity: 'sleep' },
];

describe('resolveSchedule (given hour -> poi)', () => {
  it('resolves to the entry whose hour is <= the query hour', () => {
    expect(resolveSchedule(SCHEDULE, 6, 'poi.home').poiId).toBe('poi.home');
    expect(resolveSchedule(SCHEDULE, 8, 'poi.home').poiId).toBe('poi.home');
    expect(resolveSchedule(SCHEDULE, 12, 'poi.home').poiId).toBe('poi.market');
    expect(resolveSchedule(SCHEDULE, 17.5, 'poi.home').poiId).toBe('poi.market');
    expect(resolveSchedule(SCHEDULE, 19, 'poi.home').activity).toBe('tavern');
    expect(resolveSchedule(SCHEDULE, 23, 'poi.home').activity).toBe('sleep');
  });

  it('wraps past midnight to the last entry of the previous day', () => {
    // 2am: before the day's first (6h) entry — still on yesterday's 22h "sleep" entry.
    expect(resolveSchedule(SCHEDULE, 2, 'poi.home').activity).toBe('sleep');
  });

  it('maps the literal "home" poi token to the given home id', () => {
    expect(resolveSchedule(SCHEDULE, 6, 'poi.steinen').poiId).toBe('poi.steinen');
    expect(resolveSchedule(SCHEDULE, 12, 'poi.steinen').poiId).toBe('poi.market'); // non-home entries pass through
  });

  it('defaults to idle at home when there is no schedule at all', () => {
    const r = resolveSchedule(undefined, 14, 'poi.home');
    expect(r).toEqual({ poiId: 'poi.home', activity: 'idle' });
    expect(resolveSchedule([], 14, 'poi.home').activity).toBe('idle');
  });

  it('order-independent: an unsorted schedule resolves the same as a sorted one', () => {
    const shuffled = [SCHEDULE[2], SCHEDULE[0], SCHEDULE[3], SCHEDULE[1]];
    expect(resolveSchedule(shuffled, 15, 'poi.home')).toEqual(resolveSchedule(SCHEDULE, 15, 'poi.home'));
  });
});

describe('nextScheduleEntry', () => {
  it('finds the next upcoming entry, wrapping to tomorrow\'s first', () => {
    expect(nextScheduleEntry(SCHEDULE, 7, 'poi.home').poiId).toBe('poi.market');
    expect(nextScheduleEntry(SCHEDULE, 23, 'poi.home').poiId).toBe('poi.home'); // wraps to 6h "work"
  });
});

describe('analyticPosition (frozen NPC re-entry snap)', () => {
  const poiPos = (id: string): { x: number; z: number } | null => {
    if (id === 'poi.home') return { x: 100, z: 200 };
    if (id === 'poi.market') return { x: 300, z: 400 };
    return null;
  };

  it('snaps straight to the active entry\'s POI position, no interpolation', () => {
    const atWork = analyticPosition(SCHEDULE, 8, 'poi.home', poiPos);
    expect(atWork).toEqual({ x: 100, z: 200, poiId: 'poi.home', activity: 'work' });
    const atMarket = analyticPosition(SCHEDULE, 13, 'poi.home', poiPos);
    expect(atMarket).toEqual({ x: 300, z: 400, poiId: 'poi.market', activity: 'market' });
  });

  it('applies the entry\'s local offset when present', () => {
    const withOffset: ScheduleEntry[] = [{ hour: 0, poi: 'home', activity: 'idle', offset: [5, -5] }];
    const pos = analyticPosition(withOffset, 10, 'poi.home', poiPos);
    expect(pos).toEqual({ x: 105, z: 195, poiId: 'poi.home', activity: 'idle' });
  });

  it('falls back to home when the resolved POI has no known position', () => {
    const missing: ScheduleEntry[] = [{ hour: 0, poi: 'poi.nowhere', activity: 'idle' }];
    const pos = analyticPosition(missing, 5, 'poi.home', poiPos);
    expect(pos.x).toBe(100);
    expect(pos.z).toBe(200);
  });
});
