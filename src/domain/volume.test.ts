import { describe, expect, it } from 'vitest';
import { cycleInfo, isPeriodWeek, lightWeekOf, nextPeriod } from './cycle';
import { addDays, startOfDay } from './dates';
import type { Activity } from './types';
import { destinationKm, planVolume, rebalancedDayKm, typicalWeekKm, weekKm, weekSplit, type WeekVolume } from './volume';

const MON = '2026-11-23';
const base = { dailyTargetKm: null, event: null, startDate: '2026-11-02' };

function walk(date: string, km: number): Activity {
  const start = startOfDay(date).getTime() + 9 * 3_600_000;
  return { id: date + km, sport: 'walk', start, end: start + 3_600_000, durationS: 3600, distanceM: km * 1000, hr: [], origin: 't' };
}

describe('cycle', () => {
  it('learns the cycle length from 2+ gaps and predicts the next periods', () => {
    const periods = [
      { start: '2026-08-03', end: '2026-08-07' },
      { start: '2026-08-31', end: '2026-09-04' },
      { start: '2026-09-29', end: '2026-10-03' },
      { start: '2026-10-27', end: '2026-10-31' },
    ];
    const info = cycleInfo(periods, [], 28)!;
    expect(info).toMatchObject({ cycleDays: 28, periodDays: 5, source: 'history' });
    expect(nextPeriod(info, '2026-11-21')).toEqual({ start: '2026-11-24', end: '2026-11-28' });
  });

  it('uses your setting with fewer cycles, and merges a tap with a record of the same period', () => {
    const info = cycleInfo([{ start: '2026-11-02', end: '2026-11-06' }], ['2026-11-03'], 30)!;
    expect(info.source).toBe('settings');
    expect(info.periods[0]).toEqual({ start: '2026-11-02', end: '2026-11-07' });
    expect(info.periods[1].start).toBe('2026-12-02');
    expect(cycleInfo([], [], 28)).toBeNull();
  });

  it('the light week is the Mon–Sun week holding most of the period', () => {
    expect(lightWeekOf({ start: '2026-11-21', end: '2026-11-25' })).toBe(MON); // Sat–Wed: 3 days in week of 23rd
    expect(lightWeekOf({ start: '2026-11-19', end: '2026-11-23' })).toBe('2026-11-16'); // Thu–Mon: 4 days earlier
    const info = cycleInfo([], ['2026-10-27'], 28)!; // next ~24 Nov
    expect(isPeriodWeek(MON, info)).toBe(true);
    expect(isPeriodWeek(addDays(MON, 7), info)).toBe(false);
  });
});

describe('weekly volume', () => {
  it('your typical week ignores weeks without watch data', () => {
    const acts = [
      walk(addDays(MON, -7), 20),
      walk(addDays(MON, -14), 24),
      walk(addDays(MON, -28), 22), // week -21 has no data at all
    ];
    expect(typicalWeekKm(acts, MON, 3)).toBe(22);
    expect(typicalWeekKm([walk(addDays(MON, -7), 20)], MON, 3)).toBeNull();
    expect(weekKm(acts, addDays(MON, -7), 3)).toBe(20);
  });

  it('destination: aim × 7, or what a long walk / multi-day trek needs; the higher wins', () => {
    expect(destinationKm({ dailyTargetKm: 5, event: null }, 20)).toBe(35);
    expect(destinationKm({ dailyTargetKm: null, event: { name: 'Hike', km: 15, date: '2027-03-01' } }, 20)).toBeCloseTo(45.45, 1);
    expect(destinationKm({ dailyTargetKm: null, event: { name: 'Trek', km: 15, date: '2027-07-10', days: 3 } }, 20)).toBeCloseTo(52.3, 1);
    expect(destinationKm({ dailyTargetKm: null, event: null }, 20)).toBe(25);
  });

  it('grows at most 10% a week toward the destination, holds or eases off when you did much less', () => {
    const s = { ...base, dailyTargetKm: 5 };
    const first = planVolume({ monday: MON, settings: s, startKm: 20, periodWeek: false });
    expect(first.km).toBe(20);
    const prev = (actualKm: number) => ({ volume: first, actualKm });
    expect(planVolume({ monday: addDays(MON, 7), settings: s, startKm: 20, prev: prev(20), periodWeek: false }).km).toBe(22);
    expect(planVolume({ monday: addDays(MON, 7), settings: s, startKm: 20, prev: prev(14), periodWeek: false }).km).toBe(20);
    expect(planVolume({ monday: addDays(MON, 7), settings: s, startKm: 20, prev: prev(10), periodWeek: false }).km).toBe(18);
  });

  it('the period week is light (−25%) without growing; no cycle data → every 4th week', () => {
    const s = { ...base, dailyTargetKm: 5 };
    const v = planVolume({ monday: MON, settings: s, startKm: 20, periodWeek: true });
    expect(v).toMatchObject({ light: 'period', km: 15, baseKm: 20 });
    // Plan started 2 Nov: 23 Nov is week index 3 → every-4th light week.
    expect(planVolume({ monday: MON, settings: s, startKm: 20, periodWeek: null }).light).toBe('every4');
    expect(planVolume({ monday: MON, settings: s, startKm: 20, periodWeek: false }).light).toBeNull();
  });

  it('a multi-day trek: back-to-back weeks, a lighter week before, the trek week itself', () => {
    const event = { name: 'Sierra Norte', km: 15, date: '2027-07-07', days: 3 }; // a Wednesday
    const s = { ...base, event };
    const eventMonday = '2027-07-05';
    const at = (monday: string) => planVolume({ monday, settings: s, startKm: 40, periodWeek: false });
    expect(at(addDays(eventMonday, -7 * 10)).backToBack).toBe(false); // the 8 weeks are −2 … −9
    expect(at(addDays(eventMonday, -7 * 9)).backToBack).toBe(true);
    expect(at(addDays(eventMonday, -14)).backToBack).toBe(true);
    expect(at(addDays(eventMonday, -7))).toMatchObject({ preEvent: true, km: 30 });
    expect(at(eventMonday)).toMatchObject({ eventWeek: true, km: 57 }); // 3 × 15 + 30% of 40
  });

  it('says when a dated goal can’t be reached safely', () => {
    const s = { ...base, event: { name: 'Big hike', km: 25, date: '2026-12-26' } };
    const v = planVolume({ monday: MON, settings: s, startKm: 15, periodWeek: false });
    expect(v.reachableEventKm).toBeDefined();
    expect(v.reachableEventKm!).toBeLessThan(25);
    expect(v.notes.join(' ')).toContain('safely reach');
  });

  it('splits the week: long 30%, brisk 15%, day 2 of a pair 20%, the rest over your other days', () => {
    const v = { km: 30, eventWeek: false } as WeekVolume;
    expect(weekSplit(v, 2, { long: true, brisk: true, backToBack: false, trekDays: 0 })).toMatchObject({
      longKm: 9,
      briskKm: 4.5,
      regularDayKm: 5.5, // (30 − 13.5) / 3
      regularDays: 3,
    });
    expect(weekSplit(v, 2, { long: true, brisk: true, backToBack: true, trekDays: 0 })).toMatchObject({
      b2bKm: 6,
      regularDayKm: 5.3, // (30 − 19.5) / 2
    });
  });

  it('rebalances the remaining days, within 70–130% of the plan', () => {
    const args = { plannedDayKm: 5, weekKm: 30, keyKmLeft: 13.5, daysLeft: 4, keyDaysLeft: 2, restLeft: 0 };
    expect(rebalancedDayKm({ ...args, doneKm: 6.5 })).toBe(5); // on track: 10 km over 2 days
    expect(rebalancedDayKm({ ...args, doneKm: 12 })).toBe(3.5); // did a lot (kayak!) → lighter, floor 70%
    expect(rebalancedDayKm({ ...args, doneKm: 2 })).toBe(6.5); // behind → a bit more, cap 130%
  });
});
