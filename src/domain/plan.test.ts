import { describe, expect, it } from 'vitest';
import { addDays, startOfDay } from './dates';
import { PLAN_VERSION } from './generator';
import { measure } from './progress';
import {
  forwardMissed,
  freeDays,
  moveSession,
  nextWeekVisible,
  normalizePlan,
  planWeek,
  sessionOn,
  type WeekPlan,
} from './plan';
import { generateKeySession } from './sessions';
import { DEFAULT_SETTINGS, type Activity, type DayResult, type Settings } from './types';

const settings: Settings = { ...DEFAULT_SETTINGS, startDate: '2026-11-02', onboarded: true };
const MONDAY = '2026-11-23';

function walk(date: string, km: number, minutes = km * 12, id = date, hour = 9): Activity {
  const start = startOfDay(date).getTime() + hour * 3_600_000;
  return { id, sport: 'walk', start, end: start + minutes * 60_000, durationS: minutes * 60, distanceM: km * 1000, hr: [], origin: 't' };
}

describe('planWeek', () => {
  it('puts the long walk on your biggest weekday and the brisk walk 2+ days away', () => {
    const acts: Activity[] = [];
    for (let w = 1; w <= 8; w++) {
      acts.push(walk(addDays(MONDAY, -7 * w + 3), 9)); // Thursday
      acts.push(walk(addDays(MONDAY, -7 * w), 6)); // Monday
      acts.push(walk(addDays(MONDAY, -7 * w + 4), 5)); // Friday (too close to Thursday)
    }
    const plan = planWeek(MONDAY, MONDAY, acts, settings);
    expect(plan.sessions).toEqual([
      { id: 'long', kind: 'long_walk', day: addDays(MONDAY, 3), plannedDay: addDays(MONDAY, 3) },
      { id: 'brisk', kind: 'brisk_walk', day: MONDAY, plannedDay: MONDAY },
    ]);
  });

  it('defaults to a Saturday long walk without history', () => {
    const plan = planWeek(MONDAY, MONDAY, [], settings);
    expect(sessionOn(plan, addDays(MONDAY, 5))?.kind).toBe('long_walk');
    expect(plan.sessions).toHaveLength(2);
  });

  it('made mid-week, it only uses the days left, and skips the brisk walk if there is no room', () => {
    const plan = planWeek(MONDAY, addDays(MONDAY, 5), [], settings); // from Saturday
    expect(plan.sessions.map((s) => s.kind)).toEqual(['long_walk']);
  });

  it('back-to-back weeks: the long walk becomes two days in a row, brisk walk 2+ days from both', () => {
    const plan = planWeek(MONDAY, MONDAY, [], settings, { backToBack: true });
    const long = plan.sessions.find((s) => s.kind === 'long_walk')!;
    const b2b = plan.sessions.find((s) => s.kind === 'back_to_back')!;
    expect(b2b.day).toBe(addDays(long.day, 1));
    const brisk = plan.sessions.find((s) => s.kind === 'brisk_walk')!;
    expect(Math.abs(startOfDay(brisk.day).getTime() - startOfDay(long.day).getTime())).toBeGreaterThanOrEqual(2 * 86_400_000);
  });

  it('trek week: only the trek days, which can’t be moved', () => {
    const trek = [addDays(MONDAY, 3), addDays(MONDAY, 4), addDays(MONDAY, 5)];
    const plan = planWeek(MONDAY, MONDAY, [], settings, { trekDays: trek });
    expect(plan.sessions.map((s) => [s.id, s.kind, s.day])).toEqual([
      ['trek-1', 'trek_day', trek[0]],
      ['trek-2', 'trek_day', trek[1]],
      ['trek-3', 'trek_day', trek[2]],
    ]);
    expect(moveSession(plan, 'trek-1', addDays(MONDAY, 6), MONDAY, false)).toBe(plan);
    expect(forwardMissed(plan, addDays(MONDAY, 6), () => false).plan).toEqual(plan);
  });

  it('old saved plans get session ids', () => {
    const old = { week: MONDAY, sessions: [{ kind: 'long_walk', day: MONDAY, plannedDay: MONDAY }] } as unknown as WeekPlan;
    expect(normalizePlan(old).sessions[0].id).toBe('long');
  });
});

describe('moving and forwarding key sessions', () => {
  const plan: WeekPlan = {
    week: MONDAY,
    sessions: [
      { id: 'long', kind: 'long_walk', day: addDays(MONDAY, 5), plannedDay: addDays(MONDAY, 5) },
      { id: 'brisk', kind: 'brisk_walk', day: addDays(MONDAY, 2), plannedDay: addDays(MONDAY, 2) },
    ],
  };

  it('moves to a free day from today on, never onto another session or a past day', () => {
    const today = addDays(MONDAY, 1);
    expect(moveSession(plan, 'long', addDays(MONDAY, 3), today, false).sessions[0].day).toBe(addDays(MONDAY, 3));
    expect(moveSession(plan, 'long', addDays(MONDAY, 2), today, false)).toBe(plan); // brisk is there
    expect(moveSession(plan, 'long', MONDAY, today, false)).toBe(plan); // in the past
    expect(moveSession(plan, 'long', today, today, true)).toBe(plan); // today already done
    expect(freeDays(plan, today, false, 'long')).not.toContain(addDays(MONDAY, 2));
  });

  it('a missed key session slides to the next free day, or is dropped when the week runs out', () => {
    const wed = addDays(MONDAY, 2);
    const thu = addDays(MONDAY, 3);
    const r = forwardMissed(plan, thu, () => false);
    expect(sessionOn(r.plan, thu)?.kind).toBe('brisk_walk');
    expect(r.moved).toHaveLength(1);
    const r2 = forwardMissed(plan, thu, (d) => d === thu);
    expect(sessionOn(r2.plan, addDays(MONDAY, 4))?.kind).toBe('brisk_walk');
    expect(forwardMissed(plan, thu, (d) => d === wed).plan).toEqual(plan);
    const sun = addDays(MONDAY, 6);
    const r3 = forwardMissed(plan, sun, (d) => d === sun || d === wed);
    expect(r3.plan.sessions.find((s) => s.id === 'long')?.dropped).toBe(true);
  });

  it('next week shows up on Sunday evening', () => {
    expect(nextWeekVisible(new Date(2026, 10, 29, 18, 30))).toBe(true); // Sunday
    expect(nextWeekVisible(new Date(2026, 10, 29, 12, 0))).toBe(false);
    expect(nextWeekVisible(new Date(2026, 10, 28, 20, 0))).toBe(false); // Saturday
  });
});

describe('key session targets', () => {
  const date = '2026-12-05';
  const typicalDays = Array.from({ length: 12 }, (_, i) => walk(addDays(date, -(i + 1) * 3), 5, 60)); // 12:00 min/km
  const brisk = (done: boolean, pace: number): DayResult => ({
    date: '2026-11-28',
    goal: { kind: 'brisk_walk', meters: 3000, paceSPerKm: pace },
    value: 0,
    done,
    planVersion: PLAN_VERSION,
    meta: { base: 3000, notes: [], pace },
  });

  it('long walks, second days and trek days are their share of the week', () => {
    const g = generateKeySession({ date, kind: 'long_walk', settings, activities: [], history: [], targetKm: 9.3 });
    expect(g.goal).toEqual({ kind: 'long_walk', meters: 9300 });
    const t = generateKeySession({
      date,
      kind: 'trek_day',
      settings: { ...settings, event: { name: 'Sierra Norte', km: 16, date, days: 3 } },
      activities: [],
      history: [],
      targetKm: 16,
    });
    expect(t.goal).toEqual({ kind: 'long_walk', meters: 16000 });
    expect(t.meta?.notes[0]).toContain('Sierra Norte');
  });

  it('brisk walk: 8% faster than your usual pace, 2% faster after a completed one, no push in a light week', () => {
    const first = generateKeySession({ date, kind: 'brisk_walk', settings, activities: typicalDays, history: [], targetKm: 3 });
    expect(first.goal).toEqual({ kind: 'brisk_walk', meters: 3000, paceSPerKm: 660 });
    const next = generateKeySession({ date, kind: 'brisk_walk', settings, activities: typicalDays, history: [brisk(true, 660)], targetKm: 3 });
    expect((next.goal as { paceSPerKm: number }).paceSPerKm).toBe(645);
    const light = generateKeySession({ date, kind: 'brisk_walk', settings, activities: typicalDays, history: [brisk(true, 660)], targetKm: 3, light: true });
    expect((light.goal as { paceSPerKm: number }).paceSPerKm).toBe(660);
  });

  it('long walks count one outing; brisk walks count only walks at the pace', () => {
    const day = '2026-11-28';
    const acts = [walk(day, 4, 40, 'fast', 8), walk(day, 5, 70, 'slow', 17)]; // 10:00 and 14:00 min/km, hours apart
    expect(measure({ kind: 'long_walk', meters: 8000 }, acts, settings)).toBe(5000);
    expect(measure({ kind: 'brisk_walk', meters: 3000, paceSPerKm: 660 }, acts, settings)).toBe(4000);
  });

  it('a walk Samsung split into parts (breaks up to 30 min) is one outing', () => {
    // The owner's real 21 Nov walk: 3.4 + 1.7 + 0.5 + 7.7 km with 21, 24 and 19 min breaks.
    const day = '2026-11-21';
    const at = (h: number, m: number) => startOfDay(day).getTime() + (h * 60 + m) * 60_000;
    const part = (id: string, h: number, m: number, minutes: number, km: number): Activity => ({
      ...walk(day, km, minutes, id),
      start: at(h, m),
      end: at(h, m) + minutes * 60_000,
    });
    const parts = [part('a', 9, 27, 67, 3.4), part('b', 10, 55, 35, 1.7), part('c', 11, 54, 11, 0.5), part('d', 12, 24, 150, 7.7)];
    expect(measure({ kind: 'long_walk', meters: 12000 }, parts, settings)).toBeCloseTo(13300);
    // A walk later in the afternoon, after a long break, is a separate outing.
    const later = part('e', 16, 21, 8, 0.4);
    expect(measure({ kind: 'long_walk', meters: 12000 }, [...parts, later], settings)).toBeCloseTo(13300);
    const separate = [part('x', 8, 0, 60, 5), part('y', 10, 0, 60, 6)]; // 1 h break
    expect(measure({ kind: 'long_walk', meters: 12000 }, separate, settings)).toBe(6000);
  });
});
