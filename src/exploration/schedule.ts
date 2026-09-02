/**
 * NPC schedule resolution — pure functions, no ECS/Three.js, so they're directly unit-testable.
 * `ScheduleEntry[]` (core/schemas) is a sparse list of {hour, poi, activity}; `resolveSchedule` picks
 * the entry that is active at a given hour (the last entry whose `hour` is <= the query hour, wrapping
 * around midnight), and `home` stands in for a literal home POI id wherever `entry.poi === 'home'`.
 */
import type { ScheduleEntry } from '@core/schemas';

export interface ActiveEntry {
  poiId: string;
  activity: ScheduleEntry['activity'];
  offset?: [number, number];
}

/** Which schedule entry governs the NPC at `hour` (0..24, wraps). Entries with no schedule at all default
 *  to "at home, idle". */
export function resolveSchedule(schedule: ScheduleEntry[] | undefined, hour: number, home: string): ActiveEntry {
  if (!schedule || schedule.length === 0) return { poiId: home, activity: 'idle' };
  const sorted = [...schedule].sort((a, b) => a.hour - b.hour);
  const h = ((hour % 24) + 24) % 24;
  let active = sorted[sorted.length - 1]; // before the day's first entry, we're still on yesterday's last one
  for (const e of sorted) {
    if (e.hour <= h) active = e;
  }
  return { poiId: active.poi === 'home' ? home : active.poi, activity: active.activity, offset: active.offset };
}

/** The next entry after the currently-active one (for a walking NPC's destination), wrapping to the
 *  first entry of the next day. Used to give a near, simulated NPC somewhere to walk toward. */
export function nextScheduleEntry(schedule: ScheduleEntry[] | undefined, hour: number, home: string): ActiveEntry {
  if (!schedule || schedule.length === 0) return { poiId: home, activity: 'idle' };
  const sorted = [...schedule].sort((a, b) => a.hour - b.hour);
  const h = ((hour % 24) + 24) % 24;
  const next = sorted.find((e) => e.hour > h) ?? sorted[0];
  return { poiId: next.poi === 'home' ? home : next.poi, activity: next.activity, offset: next.offset };
}

/** Analytic (non-simulated) world position for a frozen NPC: snaps straight to wherever its schedule
 *  says it is right now, plus the entry's local offset if any — no incremental physics while frozen
 *  (task spec: "NPCs beyond 300 m are frozen; position computed analytically on re-entry"). */
export function analyticPosition(
  schedule: ScheduleEntry[] | undefined,
  hour: number,
  home: string,
  poiPos: (poiId: string) => { x: number; z: number } | null,
): { x: number; z: number; poiId: string; activity: ScheduleEntry['activity'] } {
  const active = resolveSchedule(schedule, hour, home);
  const base = poiPos(active.poiId) ?? poiPos(home) ?? { x: 0, z: 0 };
  const [ox, oz] = active.offset ?? [0, 0];
  return { x: base.x + ox, z: base.z + oz, poiId: active.poiId, activity: active.activity };
}
