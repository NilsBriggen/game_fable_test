/**
 * Game clock. Game time is seconds since 1 August 1291 00:00 (Julian calendar).
 * Default rate: 1 real second = 20 game seconds (a day = 72 real minutes).
 */
export const EPOCH_YEAR = 1291;
export const EPOCH_MONTH = 8; // August
export const EPOCH_DAY = 1;
export const SECONDS_PER_DAY = 86400;
export const DEFAULT_RATE = 20;

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isJulianLeap(year: number): boolean {
  return year % 4 === 0;
}

/** Days from epoch (1 Aug 1291) to a Julian date. */
export function julianDayOffset(year: number, month: number, day: number): number {
  let days = 0;
  if (year >= EPOCH_YEAR) {
    for (let y = EPOCH_YEAR; y < year; y++) days += isJulianLeap(y) ? 366 : 365;
    for (let m = 1; m < month; m++) days += DAYS_IN_MONTH[m - 1] + (m === 2 && isJulianLeap(year) ? 1 : 0);
    days += day - 1;
    // subtract Jan 1..Aug 1 of the epoch year
    let epochDays = 0;
    for (let m = 1; m < EPOCH_MONTH; m++) epochDays += DAYS_IN_MONTH[m - 1] + (m === 2 && isJulianLeap(EPOCH_YEAR) ? 1 : 0);
    epochDays += EPOCH_DAY - 1;
    return days - epochDays;
  }
  throw new Error('dates before the epoch are not supported');
}

export function gameTimeFor(year: number, month: number, day: number, hour = 0, minute = 0): number {
  return julianDayOffset(year, month, day) * SECONDS_PER_DAY + hour * 3600 + minute * 60;
}

export interface CalendarDate {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number; // 0-59
  dayOfYear: number;
  monthName: string;
  /** e.g. "15 November 1315, 07:30" */
  label: string;
}

export function calendarFromGameTime(t: number): CalendarDate {
  let days = Math.floor(t / SECONDS_PER_DAY);
  const secOfDay = t - days * SECONDS_PER_DAY;
  let year = EPOCH_YEAR;
  let month = EPOCH_MONTH;
  let day = EPOCH_DAY;
  // walk forward month by month
  while (true) {
    const dim = DAYS_IN_MONTH[month - 1] + (month === 2 && isJulianLeap(year) ? 1 : 0);
    const remainingInMonth = dim - day + 1;
    if (days < remainingInMonth) {
      day += days;
      break;
    }
    days -= remainingInMonth;
    day = 1;
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }
  let doy = day;
  for (let m = 1; m < month; m++) doy += DAYS_IN_MONTH[m - 1] + (m === 2 && isJulianLeap(year) ? 1 : 0);
  const hour = Math.floor(secOfDay / 3600);
  const minute = Math.floor((secOfDay % 3600) / 60);
  return {
    year, month, day, hour, minute, dayOfYear: doy,
    monthName: MONTH_NAMES[month - 1],
    label: `${day} ${MONTH_NAMES[month - 1]} ${year}, ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
  };
}

export type Season = 'winter' | 'spring' | 'summer' | 'autumn';
export function seasonOf(t: number): Season {
  const m = calendarFromGameTime(t).month;
  if (m === 12 || m <= 2) return 'winter';
  if (m <= 5) return 'spring';
  if (m <= 8) return 'summer';
  return 'autumn';
}

export class GameClock {
  /** seconds of game time since epoch */
  time = gameTimeFor(1291, 8, 1, 6, 0);
  rate = DEFAULT_RATE;
  paused = false;
  private listeners: ((t: number, hour: number) => void)[] = [];

  tick(realDt: number): void {
    if (this.paused) return;
    this.time += realDt * this.rate;
    this.notify();
  }

  /** fraction 0..24 */
  get hour(): number {
    return ((this.time % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY / 3600;
  }

  set(time: number): void {
    this.time = time;
    this.notify();
  }

  setHour(hour: number): void {
    const dayStart = Math.floor(this.time / SECONDS_PER_DAY) * SECONDS_PER_DAY;
    this.time = dayStart + hour * 3600;
    this.notify();
  }

  advanceHours(h: number): void {
    this.time += h * 3600;
    this.notify();
  }

  calendar(): CalendarDate {
    return calendarFromGameTime(this.time);
  }

  season(): Season {
    return seasonOf(this.time);
  }

  onChange(cb: (t: number, hour: number) => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  private notify(): void {
    const h = this.hour;
    for (const l of this.listeners) l(this.time, h);
  }
}
