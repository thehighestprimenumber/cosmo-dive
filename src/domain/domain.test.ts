import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, mondayOf, startOfDay, weekday } from './dates';
import { goalTitle } from './format';
import { generateGoal, isRecoveryWeek, kindForDay, PLAN_VERSION } from './generator';
import { dedupeActivities, measure, progressOf } from './progress';
import { computeStreak } from './streak';
import { DEFAULT_SETTINGS, type Activity, type DayResult, type DayStatus, type Settings } from './types';
import { secondsInZone, zoneOf } from './zones';

const settings: Settings = { ...DEFAULT_SETTINGS, startDate: '2026-11-02', onboarded: true };

function act(date: string, opts: Partial<Activity> & { hourStart?: number; minutes?: number } = {}): Activity {
  const start = startOfDay(date).getTime() + (opts.hourStart ?? 9) * 3_600_000;
  const minutes = opts.minutes ?? 30;
  return {
    id: `${date}-${opts.hourStart ?? 9}-${opts.sport ?? 'walk'}`,
    sport: 'walk',
    start,
    end: start + minutes * 60_000,
    durationS: minutes * 60,
    distanceM: 3000,
    hr: [],
    origin: 'test',
    ...opts,
  };
}

describe('dates', () => {
  it('handles weekdays and ranges', () => {
    expect(weekday('2026-11-19')).toBe(4); // Thursday
    expect(mondayOf('2026-11-19')).toBe('2026-11-16');
    expect(mondayOf('2026-11-16')).toBe('2026-11-16');
    expect(mondayOf('2026-11-22')).toBe('2026-11-16'); // Sunday
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysBetween('2026-03-01', '2026-04-01')).toBe(31);
  });
});

describe('zones', () => {
  it('classifies bpm by % of max', () => {
    expect(zoneOf(100, 200)).toBe(1);
    expect(zoneOf(125, 200)).toBe(2);
    expect(zoneOf(99, 200)).toBe(0);
    expect(zoneOf(195, 200)).toBe(5);
  });

  it('counts time between samples and caps gaps', () => {
    const t0 = 0;
    const samples = [
      { t: t0, bpm: 125 },
      { t: t0 + 30_000, bpm: 125 },
      { t: t0 + 60_000, bpm: 165 }, // zone 4 from here
      { t: t0 + 90_000, bpm: 125 },
      { t: t0 + 600_000, bpm: 125 }, // 8.5 min gap, capped at 60 s
    ];
    expect(secondsInZone(samples, 2, 200)).toBe(30 + 30 + 60);
    expect(secondsInZone(samples, 4, 200)).toBe(30);
  });
});

describe('progress', () => {
  it('counts rides at 1/rideFactor for distance goals', () => {
    const goal = { kind: 'distance' as const, meters: 5000, suggestedSport: 'walk' as const };
    const acts = [act('2026-11-19', { distanceM: 2000 }), act('2026-11-19', { sport: 'ride', distanceM: 9000, hourStart: 17 })];
    expect(measure(goal, acts, settings)).toBe(5000);
    expect(progressOf(goal, acts, settings).done).toBe(true);
  });

  it('adds up durations of any sport', () => {
    const goal = { kind: 'duration' as const, seconds: 3600 };
    const acts = [act('2026-11-19', { minutes: 20 }), act('2026-11-19', { sport: 'ride', minutes: 30, hourStart: 17 })];
    const p = progressOf(goal, acts, settings);
    expect(p.value).toBe(3000);
    expect(p.done).toBe(false);
  });

  it('drops overlapping duplicates', () => {
    const a = act('2026-11-19', { id: 'samsung', minutes: 40 });
    const b = act('2026-11-19', { id: 'other', minutes: 38 });
    const c = act('2026-11-19', { id: 'evening', hourStart: 18 });
    expect(dedupeActivities([a, b, c]).map((x) => x.id)).toEqual(['samsung', 'evening']);
  });
});

describe('format', () => {
  it('describes goals', () => {
    expect(goalTitle({ kind: 'distance', meters: 5000, suggestedSport: 'walk' }, settings)).toBe('Walk 5 km (or ride 15 km)');
    expect(goalTitle({ kind: 'duration', seconds: 2400 }, settings)).toBe('Move for 40 min');
    expect(goalTitle({ kind: 'hr_zone', zone: 2, seconds: 1200 }, settings)).toBe('20 min in Zone 2');
  });
});

const v3 = (date: string, goal: DayResult['goal'], done: boolean, base: number, value = 0): DayResult => ({
  date,
  goal,
  value,
  done,
  planVersion: PLAN_VERSION,
  meta: { base, notes: [] },
});

/** First day on/after `from` whose goal type is `kind`. */
function dayOfKind(kind: string, from = '2026-11-18', hasHr = false): string {
  let d = from;
  while (kindForDay(d, hasHr) !== kind) d = addDays(d, 1);
  return d;
}

describe('generator', () => {
  it('gives every day a goal (rest days are flexible, not fixed)', () => {
    for (let i = 0; i < 14; i++) {
      const g = generateGoal({ date: addDays('2026-11-16', i), settings, activities: [], history: [] });
      expect(g.goal).not.toBeNull();
    }
  });

  it('is deterministic and mixes goal types across the week', () => {
    const week = Array.from({ length: 7 }, (_, i) => kindForDay(addDays('2026-11-16', i), true));
    expect(new Set(week).size).toBe(3);
    for (let i = 1; i < week.length; i++) expect(week[i]).not.toBe(week[i - 1]);
    expect(kindForDay('2026-11-19', true)).toBe(week[3]);
  });

  it('never picks heart rate goals without heart rate data', () => {
    for (let i = 0; i < 60; i++) expect(kindForDay(addDays('2026-11-02', i), false)).not.toBe('hr_zone');
  });

  it('starts from the median of your walking days, ignoring rides and short errands', () => {
    const date = dayOfKind('distance');
    const acts: Activity[] = [];
    const kms = [4.8, 5.2, 5.6, 6.0, 6.4, 7.0, 5.9, 6.1, 5.5, 6.3, 6.6];
    kms.forEach((km, i) => {
      const d = addDays(date, -(i + 1) * 3);
      acts.push(act(d, { minutes: 70, distanceM: km * 1000 }));
      // Same-day and separate-day errands, and a ride: none of them count.
      acts.push(act(d, { id: `${d}-errand`, hourStart: 14, minutes: 8, distanceM: 500 }));
      acts.push(act(addDays(d, -1), { id: `${d}-only-errand`, hourStart: 15, minutes: 9, distanceM: 600 }));
      if (i < 3) acts.push(act(addDays(d, -2), { id: `${d}-ride`, sport: 'ride', minutes: 40, distanceM: 15000 }));
    });
    const daily = generateGoal({ date, settings, activities: acts, history: [] });
    expect(daily.goal).toEqual({ kind: 'distance', meters: 6000, suggestedSport: 'walk' }); // median 6.0 km
    expect(daily.meta?.notes.join(' ')).toContain('median of 11 days');
  });

  it('looks back 90 days, not just the last 4 weeks', () => {
    const date = dayOfKind('distance');
    const acts = Array.from({ length: 9 }, (_, i) => act(addDays(date, -40 - i * 5), { minutes: 70, distanceM: 6500 }));
    const g = generateGoal({ date, settings, activities: acts, history: [] }).goal!;
    expect((g as { meters: number }).meters).toBe(6500);
  });

  it('never starts from goals made by older rules', () => {
    const date = dayOfKind('distance');
    const acts = Array.from({ length: 6 }, (_, i) => act(addDays(date, -(i + 1)), { minutes: 70, distanceM: 6000 }));
    const old: DayResult = {
      date: addDays(date, -1),
      goal: { kind: 'distance', meters: 2300, suggestedSport: 'walk' },
      value: 6000,
      done: true,
      planVersion: 2,
    };
    const g = generateGoal({ date, settings, activities: acts, history: [old] }).goal!;
    expect((g as { meters: number }).meters).toBeGreaterThanOrEqual(6000 * 0.9 * 0.9); // at most "lighter after a big day"
  });

  it('stays within 80–150% of your typical day', () => {
    const date = dayOfKind('distance');
    const acts = Array.from({ length: 6 }, (_, i) => act(addDays(date, -(i + 3)), { minutes: 70, distanceM: 6000 }));
    const spec = { kind: 'distance' as const, meters: 3000, suggestedSport: 'walk' as const };
    const g = generateGoal({ date, settings, activities: acts, history: [v3(addDays(date, -10), spec, true, 3000)] });
    expect((g.goal as { meters: number }).meters).toBe(4800);
  });

  it("progresses after successes and eases off after two misses (rest days aren't misses)", () => {
    const date = '2026-11-19';
    const kind = kindForDay(date, false);
    const spec: DayResult['goal'] =
      kind === 'distance' ? { kind, meters: 4000, suggestedSport: 'walk' } : { kind: 'duration', seconds: 1800 };
    const base = kind === 'distance' ? 4000 : 1800;
    const target = (h: DayResult[], statuses?: Map<string, DayStatus>) => {
      const g = generateGoal({ date, settings, activities: [], history: h, statuses }).goal!;
      return g.kind === 'distance' ? g.meters : (g as { seconds: number }).seconds;
    };
    const up = target([v3('2026-11-10', spec, true, base), v3('2026-11-12', spec, true, base), v3('2026-11-13', spec, true, base)]);
    expect(up).toBeGreaterThan(base);

    const twoOff = [v3('2026-11-17', spec, false, base), v3('2026-11-18', spec, false, base)];
    expect(target(twoOff, new Map([['2026-11-17', 'missed'], ['2026-11-18', 'missed']]))).toBeLessThan(base);
    expect(target(twoOff, new Map([['2026-11-17', 'rest'], ['2026-11-18', 'rest']]))).toBe(base);
  });

  it('goes a bit lighter the day after a big effort, without lowering the plan', () => {
    const date = '2026-11-19';
    const kind = kindForDay(date, false);
    const spec: DayResult['goal'] =
      kind === 'distance' ? { kind, meters: 5000, suggestedSport: 'walk' } : { kind: 'duration', seconds: 3000 };
    const base = kind === 'distance' ? 5000 : 3000;
    const other: DayResult['goal'] =
      kind === 'distance' ? { kind: 'duration', seconds: 1800 } : { kind: 'distance', meters: 5000, suggestedSport: 'walk' };
    const yesterdayBig = v3('2026-11-18', other, true, 1, (other!.kind === 'distance' ? 5000 : 1800) * 2);
    const g = generateGoal({ date, settings, activities: [], history: [v3('2026-11-11', spec, false, base), yesterdayBig] });
    const t = g.goal!.kind === 'distance' ? g.goal!.meters : (g.goal as { seconds: number }).seconds;
    expect(t).toBe(base * 0.9);
    expect(g.meta?.base).toBe(base);
    expect(g.meta?.notes.join(' ')).toContain('yesterday');
  });

  it('makes every 4th week a recovery week', () => {
    expect(isRecoveryWeek('2026-11-19', settings.startDate)).toBe(false);
    expect(isRecoveryWeek('2026-11-23', settings.startDate)).toBe(true); // week 4
    expect(isRecoveryWeek('2026-11-30', settings.startDate)).toBe(false);
  });
});

describe('streak with flexible rest days', () => {
  const goal = { kind: 'duration' as const, seconds: 1800 };
  const day = (date: string, done: boolean): DayResult => ({ date, goal, value: 0, done });

  it('uses rest days for skipped days, then breaks the streak', () => {
    // Week of Mon 16 Nov, 2 rest days.
    const s = computeStreak(
      [day('2026-11-16', true), day('2026-11-17', false), day('2026-11-18', false), day('2026-11-19', false), day('2026-11-20', true)],
      '2026-11-21',
      2,
    );
    expect(s.statuses.get('2026-11-17')).toBe('rest');
    expect(s.statuses.get('2026-11-18')).toBe('rest');
    expect(s.statuses.get('2026-11-19')).toBe('missed');
    expect(s.current).toBe(1);
    expect(s.restLeftThisWeek).toBe(0);
  });

  it('training on a day you meant to rest keeps the rest day for later', () => {
    const days = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19'].map((d) => day(d, true));
    const s = computeStreak([...days, day('2026-11-20', false)], '2026-11-21', 2);
    expect(s.current).toBe(4);
    expect(s.statuses.get('2026-11-20')).toBe('rest');
    expect(s.restLeftThisWeek).toBe(1);
  });

  it('rest allowance resets every Monday and today stays pending', () => {
    const s = computeStreak(
      [day('2026-11-21', false), day('2026-11-22', false), day('2026-11-23', false), day('2026-11-24', false)],
      '2026-11-24',
      2,
    );
    expect(['rest', 'rest', 'rest', 'pending']).toEqual(
      ['2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24'].map((d) => s.statuses.get(d)),
    );
    expect(s.restLeftThisWeek).toBe(1);
  });

  it('earns a freeze every 7 done days and spends it on a miss', () => {
    const days: DayResult[] = [];
    for (let i = 0; i < 7; i++) days.push(day(addDays('2026-11-01', i), true));
    days.push(day('2026-11-08', false));
    days.push(day('2026-11-09', true));
    days.push(day('2026-11-10', false));
    const s = computeStreak(days, '2026-11-11', 0);
    expect(s.statuses.get('2026-11-08')).toBe('frozen');
    expect(s.statuses.get('2026-11-10')).toBe('missed');
    expect(s.current).toBe(0);
    expect(s.longest).toBe(8);
  });

  it('keeps old fixed rest days (no goal) as rest', () => {
    const s = computeStreak([day('2026-11-16', true), { date: '2026-11-17', goal: null, value: 0, done: false }], '2026-11-18', 0);
    expect(s.statuses.get('2026-11-17')).toBe('rest');
    expect(s.current).toBe(1);
  });
});

describe('weekSummary', () => {
  it('counts done days against 7 minus your rest days', async () => {
    const { weekSummary } = await import('./summary');
    const statuses = new Map<string, DayStatus>([
      ['2026-11-16', 'done'],
      ['2026-11-17', 'rest'],
      ['2026-11-18', 'done'],
      ['2026-11-19', 'pending'],
    ]);
    const s = weekSummary(statuses, '2026-11-19', 2, '2026-11-02');
    expect(s.days.map((d) => d.status)).toEqual(['done', 'rest', 'done', 'pending', 'future', 'future', 'future']);
    expect(s).toMatchObject({ done: 2, planned: 5, restUsed: 1 });
  });

  it('ignores days before the plan started', async () => {
    const { weekSummary } = await import('./summary');
    const s = weekSummary(new Map([['2026-11-19', 'pending']]), '2026-11-19', 2, '2026-11-19');
    expect(s.planned).toBe(4); // Thu–Sun
    expect(s.days[0].status).toBe('none');
  });
});
