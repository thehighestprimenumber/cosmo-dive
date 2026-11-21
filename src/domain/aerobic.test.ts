import { describe, expect, it } from 'vitest';
import { isAerobicPhase, zone2Minutes } from './aerobic';
import { addDays, startOfDay } from './dates';
import { generateGoal, kindForDay } from './generator';
import { DEFAULT_SETTINGS, type Activity } from './types';

const trek = { name: 'Sierra Norte', km: 15, date: '2027-07-07', days: 3, ascentM: 900, altitudeM: 3000 };
const preEventMonday = '2027-06-28';

describe('aerobic base phase (event at altitude)', () => {
  it('runs the 16 weeks before the pre-event week, only for 1500 m+', () => {
    expect(isAerobicPhase(addDays(preEventMonday, -1), trek)).toBe(true);
    expect(isAerobicPhase(addDays(preEventMonday, -7 * 16), trek)).toBe(true);
    expect(isAerobicPhase(addDays(preEventMonday, -7 * 16 - 1), trek)).toBe(false);
    expect(isAerobicPhase(preEventMonday, trek)).toBe(false); // the lighter week before: not a base week
    expect(isAerobicPhase(addDays(preEventMonday, -7), { ...trek, altitudeM: 800 })).toBe(false);
    expect(isAerobicPhase(addDays(preEventMonday, -7), { ...trek, altitudeM: undefined })).toBe(false);
  });

  it('about half the regular days become Zone 2', () => {
    const week = Array.from({ length: 7 }, (_, i) => addDays('2027-05-03', i));
    const count = (aerobic: boolean) => week.filter((d) => kindForDay(d, true, aerobic) === 'hr_zone').length;
    expect(count(true)).toBeGreaterThanOrEqual(3);
    expect(count(true)).toBeGreaterThan(count(false));
    expect(week.every((d) => kindForDay(d, false, true) !== 'hr_zone')).toBe(true); // no heart rate data
  });

  it('heart-rate goals are always Zone 2, 70% of the day’s time instead of 50%', () => {
    const settings = { ...DEFAULT_SETTINGS, startDate: '2027-04-05', event: trek };
    let day = '2027-05-03';
    while (kindForDay(day, true) !== 'hr_zone' || kindForDay(day, true, true) !== 'hr_zone') day = addDays(day, 1);
    const hrWalk: Activity = {
      id: 'hr', sport: 'walk', start: startOfDay(addDays(day, -2)).getTime(), end: startOfDay(addDays(day, -2)).getTime() + 3_600_000,
      durationS: 3600, distanceM: 5000, hr: [{ t: 0, bpm: 120 }, { t: 1000, bpm: 121 }], origin: 't',
    };
    const make = (aerobic: boolean) =>
      generateGoal({ date: day, settings, activities: [hrWalk], history: [], dayKm: 5, aerobic }).goal as { zone: number; seconds: number };
    expect(make(true).zone).toBe(2);
    expect(make(true).seconds).toBeGreaterThan(make(false).seconds);
  });

  it('counts this week’s Zone 2 minutes, any sport', () => {
    const start = startOfDay('2027-05-04').getTime();
    const kayak: Activity = {
      id: 'k', sport: 'other', start, end: start + 1_800_000, durationS: 1800, distanceM: null, origin: 't',
      hr: Array.from({ length: 31 }, (_, i) => ({ t: start + i * 60_000, bpm: 120 })), // 120 bpm = Zone 2 at max 185
    };
    expect(zone2Minutes([kayak], '2027-05-03', '2027-05-09', 185)).toBe(30);
  });
});
