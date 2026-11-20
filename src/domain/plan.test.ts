import { describe, expect, it } from 'vitest';
import { addDays, startOfDay } from './dates';
import { PLAN_VERSION } from './generator';
import { measure } from './progress';
import { forwardMissed, freeDays, moveSession, nextWeekVisible, planWeek, sessionOn, type WeekPlan } from './plan';
import { generateKeySession } from './sessions';
import { DEFAULT_SETTINGS, type Activity, type DayResult, type Settings } from './types';

const settings: Settings = { ...DEFAULT_SETTINGS, startDate: '2026-11-02', onboarded: true };
const MONDAY = '2026-11-23';

function walk(date: string, km: number, minutes = km * 12, id = date): Activity {
  const start = startOfDay(date).getTime() + 9 * 3_600_000;
  return { id, sport: 'walk', start, end: start + minutes * 60_000, durationS: minutes * 60, distanceM: km * 1000, hr: [], origin: 't' };
}

describe('planWeek', () => {
  it('puts the long walk on your biggest weekday and the brisk walk 2+ days away', () => {
    // Thursdays are your big days, Mondays second.
    const acts: Activity[] = [];
    for (let w = 1; w <= 8; w++) {
      acts.push(walk(addDays(MONDAY, -7 * w + 3), 9)); // Thursday
      acts.push(walk(addDays(MONDAY, -7 * w), 6)); // Monday
      acts.push(walk(addDays(MONDAY, -7 * w + 4), 5)); // Friday (too close to Thursday)
    }
    const plan = planWeek(MONDAY, MONDAY, acts, settings);
    expect(plan.sessions).toEqual([
      { kind: 'long_walk', day: addDays(MONDAY, 3), plannedDay: addDays(MONDAY, 3) },
      { kind: 'brisk_walk', day: MONDAY, plannedDay: MONDAY },
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
    expect(plan.sessions[0].day >= addDays(MONDAY, 5)).toBe(true);
  });
});

describe('moving and forwarding key sessions', () => {
  const plan: WeekPlan = {
    week: MONDAY,
    sessions: [
      { kind: 'long_walk', day: addDays(MONDAY, 5), plannedDay: addDays(MONDAY, 5) },
      { kind: 'brisk_walk', day: addDays(MONDAY, 2), plannedDay: addDays(MONDAY, 2) },
    ],
  };

  it('moves to a free day from today on, never onto the other session or a past day', () => {
    const today = addDays(MONDAY, 1);
    expect(moveSession(plan, 'long_walk', addDays(MONDAY, 3), today, false).sessions[0].day).toBe(addDays(MONDAY, 3));
    expect(moveSession(plan, 'long_walk', addDays(MONDAY, 2), today, false)).toBe(plan); // brisk is there
    expect(moveSession(plan, 'long_walk', MONDAY, today, false)).toBe(plan); // in the past
    expect(moveSession(plan, 'long_walk', today, today, true)).toBe(plan); // today already done
    expect(freeDays(plan, today, false, 'long_walk')).not.toContain(addDays(MONDAY, 2));
  });

  it('a missed key session slides to the next free day, or is dropped when the week runs out', () => {
    const wed = addDays(MONDAY, 2);
    const thu = addDays(MONDAY, 3);
    // Brisk walk was Wednesday, not done; today is Thursday and not done yet → today.
    const r = forwardMissed(plan, thu, () => false);
    expect(sessionOn(r.plan, thu)?.kind).toBe('brisk_walk');
    expect(r.moved).toHaveLength(1);
    // Today already done (with its regular goal) → tomorrow.
    const r2 = forwardMissed(plan, thu, (d) => d === thu);
    expect(sessionOn(r2.plan, addDays(MONDAY, 4))?.kind).toBe('brisk_walk');
    // Done on its day → stays.
    expect(forwardMissed(plan, thu, (d) => d === wed).plan).toEqual(plan);
    // Sunday evening, long walk (Saturday) missed and Sunday done → dropped.
    const sun = addDays(MONDAY, 6);
    const r3 = forwardMissed(plan, sun, (d) => d === sun || d === wed);
    expect(r3.plan.sessions.find((s) => s.kind === 'long_walk')?.dropped).toBe(true);
  });

  it('next week shows up on Sunday evening', () => {
    expect(nextWeekVisible(new Date(2026, 10, 29, 18, 30))).toBe(true); // Sunday
    expect(nextWeekVisible(new Date(2026, 10, 29, 12, 0))).toBe(false);
    expect(nextWeekVisible(new Date(2026, 10, 28, 20, 0))).toBe(false); // Saturday
  });
});

describe('key session targets', () => {
  const history = (kind: 'long_walk' | 'brisk_walk', done: boolean, base: number, pace?: number): DayResult => ({
    date: '2026-11-21',
    goal: kind === 'long_walk' ? { kind, meters: base } : { kind, meters: base, paceSPerKm: pace! },
    value: 0,
    done,
    planVersion: PLAN_VERSION,
    meta: { base, notes: [], ...(pace ? { pace } : {}) },
  });
  const date = '2026-12-05'; // a Saturday, not a recovery week (week 4 of a plan started 2 Nov)
  const typicalDays = Array.from({ length: 12 }, (_, i) => walk(addDays(date, -(i + 1) * 3), 5, 60));

  it('long walk starts at 30% more than a training day, or from your longer walks', () => {
    const g = generateKeySession({ date, kind: 'long_walk', settings, activities: typicalDays, history: [] });
    expect(g.goal).toEqual({ kind: 'long_walk', meters: 6500 });
    const withLong = [...typicalDays, ...[1, 2, 4, 5].map((i) => walk(addDays(date, -i * 3 - 1), 9, 110, `long${i}`))];
    expect((generateKeySession({ date, kind: 'long_walk', settings, activities: withLong, history: [] }).goal as { meters: number }).meters).toBe(9000);
  });

  it('long walk goes up 10% after a done one and holds after a miss', () => {
    const m = (h: DayResult[]) => (generateKeySession({ date, kind: 'long_walk', settings, activities: typicalDays, history: h }).goal as { meters: number }).meters;
    expect(m([history('long_walk', true, 8000)])).toBe(8800);
    expect(m([history('long_walk', false, 8000)])).toBe(8000);
  });

  it('builds toward a dated goal, tapers the week before, and is the goal on the day', () => {
    const ev = { name: 'Coastal hike', km: 15, date: '2026-12-26' };
    const s = { ...settings, event: ev };
    const m = (d: string, h: DayResult[]) =>
      (generateKeySession({ date: d, kind: 'long_walk', settings: s, activities: typicalDays, history: h }).goal as { meters: number }).meters;
    // 3 weeks out from 8 km: 2 weeks left before the taper → +3.5 km.
    expect(m('2026-12-05', [history('long_walk', false, 8000)])).toBe(11500);
    expect(m('2026-12-21', [history('long_walk', true, 15000)])).toBe(9000); // taper: 60%
    expect(m('2026-12-26', [history('long_walk', true, 15000)])).toBe(15000);
  });

  it('brisk walk: 60% of a training day, 8% faster than your usual pace, then faster when done', () => {
    const g = generateKeySession({ date, kind: 'brisk_walk', settings, activities: typicalDays, history: [] });
    expect(g.goal).toEqual({ kind: 'brisk_walk', meters: 3000, paceSPerKm: 660 }); // usual 12:00 → 11:00
    const next = generateKeySession({ date, kind: 'brisk_walk', settings, activities: typicalDays, history: [history('brisk_walk', true, 3000, 660)] });
    expect(next.goal).toEqual({ kind: 'brisk_walk', meters: 3200, paceSPerKm: 645 });
  });

  it('long walks count one outing; brisk walks count only walks at the pace', () => {
    const day = '2026-11-28';
    const acts = [walk(day, 4, 40, 'fast'), walk(day, 5, 70, 'slow')]; // 10:00 and 14:00 min/km
    expect(measure({ kind: 'long_walk', meters: 8000 }, acts, settings)).toBe(5000);
    expect(measure({ kind: 'brisk_walk', meters: 3000, paceSPerKm: 660 }, acts, settings)).toBe(4000);
  });
});
