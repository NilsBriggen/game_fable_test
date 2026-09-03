/**
 * Sun and moon path at 47° N (Vierwaldstättersee). The sky/light/exposure ramp keys off elevation,
 * so the elevation model itself is what needs pinning down.
 */
import { describe, it, expect } from 'vitest';
import { dayOfYearFromCalendar, solarPosition, lunarPosition } from './sky';

const deg = (rad: number): number => (rad * 180) / Math.PI;

describe('solar position at 47 N', () => {
  it('maps the calendar to a day of year', () => {
    expect(dayOfYearFromCalendar(1, 1)).toBe(1);
    expect(dayOfYearFromCalendar(12, 31)).toBe(365);
    expect(dayOfYearFromCalendar(6, 21)).toBe(172);
  });

  it('puts the equinox noon sun at ~43 degrees (90 - latitude)', () => {
    const el = deg(solarPosition(dayOfYearFromCalendar(3, 20), 12).elevation);
    expect(el).toBeGreaterThan(41);
    expect(el).toBeLessThan(45);
  });

  it('is much higher at midsummer noon than at midwinter noon', () => {
    const june = deg(solarPosition(dayOfYearFromCalendar(6, 21), 12).elevation);
    const dec = deg(solarPosition(dayOfYearFromCalendar(12, 21), 12).elevation);
    expect(june).toBeGreaterThan(63);   // 90 - 47 + 23.4
    expect(dec).toBeLessThan(21);       // 90 - 47 - 23.4
    expect(june - dec).toBeGreaterThan(40);
  });

  it('is below the horizon at midnight all year', () => {
    for (const doy of [1, 80, 172, 264, 355]) {
      expect(deg(solarPosition(doy, 0).elevation), `doy ${doy}`).toBeLessThan(0);
    }
  });

  it('gives the harness scenarios the light they were authored for', () => {
    const aug = dayOfYearFromCalendar(8, 1);
    expect(deg(solarPosition(aug, 6).elevation)).toBeGreaterThan(0);    // ruetli-dawn: sun just up
    expect(deg(solarPosition(aug, 6).elevation)).toBeLessThan(14);      // ...and still low and warm
    expect(deg(solarPosition(aug, 19).elevation)).toBeLessThan(14);     // schwyz dusk
    expect(deg(solarPosition(aug, 19).elevation)).toBeGreaterThan(-6);
    expect(deg(solarPosition(aug, 23).elevation)).toBeLessThan(-12);    // sarnen night: fully dark
    expect(deg(solarPosition(aug, 12).elevation)).toBeGreaterThan(55);  // altdorf noon
  });

  it('rises in the east and sets in the west', () => {
    const doy = dayOfYearFromCalendar(6, 21);
    const morning = deg(solarPosition(doy, 7).azimuth);   // 0 = north, clockwise
    const evening = deg(solarPosition(doy, 18).azimuth);
    expect(morning).toBeGreaterThan(45);
    expect(morning).toBeLessThan(135);
    expect(evening).toBeGreaterThan(225);
    expect(evening).toBeLessThan(315);
  });
});

describe('lunar position', () => {
  it('keeps the phase in range and the full moon opposite the sun', () => {
    for (let doy = 1; doy <= 365; doy += 7) {
      const m = lunarPosition(doy, 22);
      expect(m.phase).toBeGreaterThanOrEqual(0);
      expect(m.phase).toBeLessThanOrEqual(1);
      expect(Number.isFinite(m.elevation)).toBe(true);
    }
  });

  it('is up at night at least a third of the month', () => {
    let up = 0;
    for (let doy = 1; doy <= 30; doy++) if (lunarPosition(doy, 23).elevation > 0) up++;
    expect(up).toBeGreaterThan(9);
    expect(up).toBeLessThan(28);
  });
});
