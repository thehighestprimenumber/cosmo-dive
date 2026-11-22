import { describe, expect, it } from 'vitest';
import { checkinDue, checkinReasons, type CheckinInput } from './checkin';
import { addDays } from './dates';

const THU = '2026-11-26';
const goal = { kind: 'distance' as const, meters: 5000, suggestedSport: 'walk' as const };
const day = (date: string, done: boolean, recovery = false) => ({
  date,
  goal,
  done,
  status: done ? ('done' as const) : ('rest' as const),
  meta: recovery ? { base: 0, notes: [], recovery: true } : undefined,
});
const ordinary: CheckinInput = {
  today: THU,
  todayRecovery: false,
  todayReadiness: 'normal',
  days: new Map([
    [addDays(THU, -1), day(addDays(THU, -1), true)],
    [addDays(THU, -2), day(addDays(THU, -2), false)],
  ]),
  weekPlannedKm: 28,
  weekDoneKm: 12,
  restLeftThisWeek: 1,
  streak: 6,
  lastUserMessageAt: null,
  now: new Date(2026, 10, 26, 8, 30),
};

describe('when the coach checks in', () => {
  it('an ordinary day: no check-in', () => {
    expect(checkinReasons(ordinary)).toEqual([]);
  });

  it('a recovery day, a short night, or two days without the goal', () => {
    expect(checkinReasons({ ...ordinary, todayRecovery: true })[0]).toContain('very big day');
    expect(checkinReasons({ ...ordinary, todayReadiness: 'low' })[0]).toContain('Readiness is low');
    const twoMissed = new Map([
      [addDays(THU, -1), day(addDays(THU, -1), false)],
      [addDays(THU, -2), day(addDays(THU, -2), false)],
    ]);
    expect(checkinReasons({ ...ordinary, days: twoMissed })).toEqual(['The last 2 days went without the goal.']);
    // A rested recovery day isn't "without the goal".
    const afterRecovery = new Map([
      [addDays(THU, -1), day(addDays(THU, -1), false, true)],
      [addDays(THU, -2), day(addDays(THU, -2), false)],
    ]);
    expect(checkinReasons({ ...ordinary, days: afterRecovery })).toEqual([]);
  });

  it('falling behind from Thursday, no rest days left with a streak, a recent conversation', () => {
    expect(checkinReasons({ ...ordinary, weekDoneKm: 6 })[0]).toBe('Behind on the week: 6 of 28 km with 4 days left.');
    expect(checkinReasons({ ...ordinary, weekDoneKm: 6, today: addDays(THU, -1) })).toEqual([]); // Wednesday: too early
    expect(checkinReasons({ ...ordinary, restLeftThisWeek: 0 })[0]).toContain('6-day streak');
    expect(checkinReasons({ ...ordinary, restLeftThisWeek: 0, streak: 1 })).toEqual([]);
    const yesterdayEvening = new Date(2026, 10, 25, 21, 0).getTime();
    expect(checkinReasons({ ...ordinary, lastUserMessageAt: yesterdayEvening })[0]).toContain('talked recently');
    expect(checkinReasons({ ...ordinary, lastUserMessageAt: yesterdayEvening - 3 * 86_400_000 })).toEqual([]);
  });

  it('once a day, from the morning reminder until noon', () => {
    expect(checkinDue(new Date(2026, 10, 26, 7, 59), THU, null, '08:00')).toBe(false);
    expect(checkinDue(new Date(2026, 10, 26, 8, 0), THU, null, '08:00')).toBe(true);
    expect(checkinDue(new Date(2026, 10, 26, 8, 0), THU, THU, '08:00')).toBe(false);
    expect(checkinDue(new Date(2026, 10, 26, 12, 0), THU, null, '08:00')).toBe(false);
  });
});
